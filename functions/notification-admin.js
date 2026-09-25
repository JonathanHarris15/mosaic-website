/**
 * @fileoverview What an admin may see and do about Notifications.
 *
 * Reads the two things the ADR-0036 rules keep away from a browser — the
 * Device tokens under `users/{uid}/push_tokens`, which only their owner may
 * read, and the `notifications` log — and hands back shapes that carry no
 * whole token. The owner-only rule is not widened for this page; the Admin
 * SDK is.
 *
 * Every dependency is passed in, so the whole file runs in `npm test` with no
 * Firestore, no network and no clock. functions/index.js is the only place
 * that knows this is Firestore.
 *
 * ⚠ NOTHING HERE DECIDES A ROUTE. The send path's decisions stay in
 * notification-core.js; this module reports them and, for the self-test,
 * borrows exactly one of them (isDeadToken) so a test push cleans up after
 * itself the same way a real one does.
 */

const nc = require("./notification-core");
const core = require("./shared/notification-admin-core.js");

const DAY_MS = 24 * 60 * 60 * 1000;

/** Rows read per Firestore round trip while filling a filtered page. */
const LOG_BATCH = 100;

/**
 * How many rows one page request may look through before giving up and
 * handing back a cursor. A narrow filter over a long log would otherwise
 * read the whole collection to fill twenty rows.
 */
const SCAN_BUDGET = 600;

/** Page size, and the ceiling a caller may ask for. */
const DEFAULT_PAGE = 25;
const MAX_PAGE = 100;

/** How far back the overview counts. The registry shows 7- and 30-day. */
const OVERVIEW_DAYS = 30;

/** A ceiling on the overview read, so a busy month cannot run away. */
const OVERVIEW_LIMIT = 2000;

/**
 * The self-test's wording, fixed in code. An editable test message is a test
 * that can be dressed up as a real pastoral ask.
 */
const TEST_PUSH_TITLE = "Mosaic test";
const TEST_PUSH_BODY =
  "This is a test push from the Admin Dashboard. Nobody else was sent it.";

/**
 * A refusal the callable maps onto HttpsError, in the shape access-assert.js
 * already uses.
 * @param {string} code an HttpsError code
 * @param {string} message what to say
 * @return {Error}
 */
function refuse(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

/**
 * @param {*} value
 * @return {string}
 */
function trimmed(value) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * The send path's own numbers, for a picture that cannot drift from it.
 * @return {Object} openHour, closeHour, timezone, deadCodes
 */
function sendConstants() {
  return {
    openHour: nc.WINDOW_OPEN_HOUR,
    closeHour: nc.WINDOW_CLOSE_HOUR,
    timezone: nc.CHURCH_TIMEZONE,
    deadCodes: Array.from(nc.DEAD_TOKEN_CODES).sort(),
  };
}

/**
 * @param {Object} deps
 * @return {Date}
 */
function nowOf(deps) {
  return (deps && deps.now && deps.now()) || new Date();
}

/**
 * Sends and problems over a span, for the strip at the top of the tab.
 * @param {Array<Object>} rows raw log rows
 * @param {Date} now
 * @param {number} days
 * @return {Object}
 */
function countRecent(rows, now, days) {
  const cutoff = now.getTime() - days * DAY_MS;
  const totals = {days: days, total: 0, push: 0, text: 0, problems: 0};
  (rows || []).forEach((row) => {
    const when = core.toDate(row && row.createdAt);
    if (!when || when.getTime() < cutoff) return;
    totals.total += 1;
    if (row.channel === "push") totals.push += 1;
    if (row.channel === "text") totals.text += 1;
    if (core.isProblem(row)) totals.problems += 1;
  });
  return totals;
}

/**
 * Everything the tab needs before an admin touches a control: the picture of
 * the send path, the registry with its recent counts, and the headline
 * numbers.
 * @param {Object} deps readLogSince, countDevices, now
 * @return {Promise<Object>}
 */
async function overview(deps) {
  const now = nowOf(deps);
  const since = new Date(now.getTime() - OVERVIEW_DAYS * DAY_MS);
  const rows = await deps.readLogSince(since, OVERVIEW_LIMIT);
  const constants = sendConstants();
  const summary = core.summariseTypes(rows, now);
  const devices = await deps.countDevices();

  return {
    now: now.toISOString(),
    constants: constants,
    flow: core.buildPushFlow(constants),
    types: core.NOTIFICATION_TYPES.map((type) => Object.assign({}, type, {
      windowLabel: core.windowLabel(type.window, constants),
      stats: summary.byType[type.id],
    })),
    unmatched: summary.unmatched,
    recent: {
      week: countRecent(rows, now, 7),
      month: countRecent(rows, now, 30),
    },
    devices: devices,
    staleAfterDays: core.TOKEN_STALE_DAYS,
    agingAfterDays: core.TOKEN_AGING_DAYS,
  };
}

/**
 * One filled page of the log, newest first.
 *
 * Filters are applied after the read rather than in the query on purpose:
 * an equality filter beside `orderBy(createdAt)` needs a composite index per
 * combination, and this log is church-sized. The scan budget is what keeps
 * an unlucky filter from reading the collection.
 *
 * @param {Object} deps readLogPage, namesFor, now
 * @param {Object} args limit, cursor, and the filter fields
 * @return {Promise<Object>} rows, nextCursor, scanned
 */
async function history(deps, args) {
  const a = args || {};
  const now = nowOf(deps);
  const constants = sendConstants();
  const wanted = Math.min(
      MAX_PAGE, Math.max(1, parseInt(a.limit, 10) || DEFAULT_PAGE));
  const filters = {
    channel: trimmed(a.channel),
    status: trimmed(a.status),
    typeId: trimmed(a.typeId),
    search: trimmed(a.search),
  };

  let before = core.parseCursor(trimmed(a.cursor));
  let cursor = null;
  let scanned = 0;
  let exhausted = false;
  const kept = [];

  while (kept.length < wanted && scanned < SCAN_BUDGET && !exhausted) {
    const batch = await deps.readLogPage({limit: LOG_BATCH, before: before});
    if (!batch || !batch.length) {
      exhausted = true;
      break;
    }
    let consumed = 0;
    for (const row of batch) {
      cursor = core.formatCursor(row.cursor) || cursor;
      scanned += 1;
      consumed += 1;
      const described = core.describeLogRow(row, {
        now: now, timezone: constants.timezone, names: {},
      });
      if (core.matchesFilter(described, filters)) kept.push(described);
      if (kept.length >= wanted) break;
    }
    // A short batch only means the end of the log when the whole of it was
    // looked at. Filling the page half way through one says nothing.
    if (consumed === batch.length && batch.length < LOG_BATCH) exhausted = true;
    before = core.parseCursor(cursor);
  }

  // Names last, and only for the rows that survived — a page of twenty is
  // twenty reads at worst rather than six hundred.
  const ids = [];
  kept.forEach((row) => {
    if (row.personId && ids.indexOf(row.personId) === -1) {
      ids.push(row.personId);
    }
  });
  const names = ids.length ? await deps.namesFor(ids) : {};
  kept.forEach((row) => {
    row.personName = names[row.personId] || "";
  });

  return {
    rows: kept,
    nextCursor: exhausted ? null : cursor,
    scanned: scanned,
    filtered: !!(filters.channel || filters.status || filters.typeId ||
      filters.search),
    timezone: constants.timezone,
  };
}

/**
 * Every Device token in the church, grouped by the person holding it, with
 * the token masked before it leaves this process.
 *
 * "Failing" is derived from the log rather than stamped on the token: the
 * most recent push aimed at that person was not accepted. Writing a flag
 * onto the token document would mean the send path growing a write it does
 * not have, and this page inventing state the send path does not keep.
 *
 * @param {Object} deps listTokens, loadOwners, readLogSince, now
 * @return {Promise<Object>}
 */
async function devices(deps) {
  const now = nowOf(deps);
  const tokens = await deps.listTokens();
  const byUid = new Map();
  (tokens || []).forEach((token) => {
    if (!token || !token.uid || !token.token) return;
    if (!byUid.has(token.uid)) byUid.set(token.uid, []);
    byUid.get(token.uid).push(core.describeDevice(token, now));
  });

  const uids = Array.from(byUid.keys());
  const owners = await deps.loadOwners(uids);
  const ownerByUid = new Map();
  (owners || []).forEach((owner) => {
    if (owner && owner.uid) ownerByUid.set(owner.uid, owner);
  });

  const since = new Date(now.getTime() - OVERVIEW_DAYS * DAY_MS);
  const rows = await deps.readLogSince(since, OVERVIEW_LIMIT);
  const lastPush = new Map();
  (rows || []).forEach((row) => {
    if (!row || row.channel !== "push" || !row.personId) return;
    const when = core.toDate(row.createdAt);
    if (!when) return;
    const held = lastPush.get(row.personId);
    if (!held || when.getTime() > held.at) {
      lastPush.set(row.personId, {
        at: when.getTime(),
        accepted: row.accepted === true,
      });
    }
  });

  const people = uids.map((uid) => {
    const owner = ownerByUid.get(uid) || {};
    const last = owner.personId ? lastPush.get(owner.personId) : null;
    const list = byUid.get(uid).slice().sort((a, b) => {
      return String(b.lastSeen || "").localeCompare(String(a.lastSeen || ""));
    });
    return {
      uid: uid,
      personId: owner.personId || null,
      name: owner.name || "",
      email: owner.email || "",
      devices: list,
      failing: !!(last && !last.accepted),
      lastPushAt: last ? new Date(last.at).toISOString() : null,
      lastPushAccepted: last ? last.accepted : null,
      lastPushWhen: last ?
        core.churchLocalLabel(new Date(last.at), nc.CHURCH_TIMEZONE) : "",
    };
  });

  people.sort((a, b) => {
    const byName = String(a.name || "~").localeCompare(String(b.name || "~"));
    return byName !== 0 ? byName : a.uid.localeCompare(b.uid);
  });

  return {
    people: people,
    summary: core.summariseDevices(people),
    staleAfterDays: core.TOKEN_STALE_DAYS,
    agingAfterDays: core.TOKEN_AGING_DAYS,
  };
}

/**
 * Take one device off a User. The document is theirs by the rules and this
 * deletes it with the Admin SDK, which is exactly what signing out does — so
 * the next launch with permission writes a fresh one.
 * @param {Object} deps getToken, deleteToken
 * @param {Object} args uid, tokenId
 * @return {Promise<Object>}
 */
async function revokeToken(deps, args) {
  const uid = trimmed(args && args.uid);
  const tokenId = trimmed(args && args.tokenId);
  if (!uid || !tokenId) {
    throw refuse("invalid-argument", "Name the device to revoke.");
  }
  const existing = await deps.getToken(uid, tokenId);
  if (!existing) {
    throw refuse("not-found", "That device is already gone.");
  }
  await deps.deleteToken(uid, tokenId);
  return {
    revoked: true,
    uid: uid,
    tokenId: tokenId,
    masked: core.maskToken(existing.token),
  };
}

/**
 * Push to the signed-in admin's own devices, and nobody else's.
 *
 * ⚠ THE CALLER'S UID IS THE ONLY ADDRESS THIS FUNCTION HAS. It takes no
 * recipient, no token and no person; index.js passes `request.auth.uid` and
 * anything else on the payload is not read. That is what makes "test the
 * push path" a safe button to put on a page: the worst it can do is buzz the
 * phone of the person pressing it.
 *
 * @param {Object} deps tokensFor, sendPush, deleteToken, ownerOf, writeLog
 * @param {Object} args callerUid — and nothing else is honoured
 * @return {Promise<Object>}
 */
async function testPushToSelf(deps, args) {
  const uid = trimmed(args && args.callerUid);
  if (!uid) throw refuse("unauthenticated", "Sign in first.");

  const held = await deps.tokensFor(uid);
  const live = (held || []).filter((token) => token && token.token);
  if (!live.length) {
    throw refuse("failed-precondition",
        "No Mosaic device is signed in as you. Open the app on your phone, " +
        "allow notifications, then try again.");
  }

  let accepted = 0;
  let retryable = 0;
  const removed = [];

  for (const token of live) {
    let result;
    try {
      result = await deps.sendPush({
        token: token.token,
        title: TEST_PUSH_TITLE,
        body: TEST_PUSH_BODY,
        url: "",
      });
    } catch (err) {
      result = {accepted: false, error: err};
    }
    if (result && result.accepted) {
      accepted += 1;
      continue;
    }
    if (nc.isDeadToken(result && result.error)) {
      await deps.deleteToken(uid, token.id);
      removed.push(core.maskToken(token.token));
    } else {
      retryable += 1;
    }
  }

  const owner = await deps.ownerOf(uid);
  await deps.writeLog({
    personId: (owner && owner.personId) || null,
    channel: "push",
    purpose: core.TEST_PUSH_PURPOSE,
    wording: null,
    serviceDate: null,
    accepted: accepted > 0,
    url: null,
    title: TEST_PUSH_TITLE,
    body: TEST_PUSH_BODY,
    devices: live.length,
    removed: removed.length,
  });

  return {
    attempted: live.length,
    accepted: accepted,
    retryable: retryable,
    removed: removed,
  };
}

module.exports = {
  DEFAULT_PAGE,
  MAX_PAGE,
  LOG_BATCH,
  SCAN_BUDGET,
  OVERVIEW_DAYS,
  OVERVIEW_LIMIT,
  TEST_PUSH_TITLE,
  TEST_PUSH_BODY,
  sendConstants,
  countRecent,
  overview,
  history,
  devices,
  revokeToken,
  testPushToSelf,
};
