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
 * Refuses anything that did not arrive as an answered question.
 *
 * ⚠ THE SECOND PRESS IS A FACT ON THE WIRE, NOT A STATE IN A BROWSER. The
 * page asks before it revokes and before it test-pushes, but a callable is
 * reachable without the page — so the confirmation travels with the call and
 * the server refuses a request that does not carry it. A mistyped curl, a
 * replayed fetch from the console, or a future caller that forgot the dialog
 * is refused here rather than obeyed.
 *
 * Checked BEFORE anything is read or deleted, so a refusal costs one
 * Firestore read for the admin gate and nothing else.
 *
 * @param {Object} data request.data
 * @return {void}
 */
function requireConfirm(data) {
  if (!data || data.confirm !== true) {
    throw refuse("failed-precondition",
        "This needs confirming. Press the button again to go ahead.");
  }
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
 * the send path, the registry with its recent counts, the headline numbers,
 * and the device list.
 *
 * ⚠ THE DEVICE LIST IS IN HERE RATHER THAN BEHIND ITS OWN CALLABLE, and that
 * is the whole point. Both halves want the same two reads — every Device
 * token in the church, and thirty days of the log — and two callables meant
 * opening the tab did each of them twice. One call, one pass over each.
 *
 * @param {Object} deps listTokens, readLogSince, loadOwners, now
 * @return {Promise<Object>}
 */
async function overview(deps) {
  const now = nowOf(deps);
  const since = new Date(now.getTime() - OVERVIEW_DAYS * DAY_MS);
  const [tokens, rows] = await Promise.all([
    deps.listTokens(),
    deps.readLogSince(since, OVERVIEW_LIMIT),
  ]);
  const owners = await deps.loadOwners(holderUids(tokens));
  const constants = sendConstants();
  const summary = core.summariseTypes(rows, now);

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
    devices: deviceHolders({tokens, owners, rows, now}),
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
 * The uids holding at least one live Device token, in first-seen order.
 * @param {Array<Object>} tokens
 * @return {Array<string>}
 */
function holderUids(tokens) {
  const seen = [];
  (tokens || []).forEach((token) => {
    if (!token || !token.uid || !token.token) return;
    if (seen.indexOf(token.uid) === -1) seen.push(token.uid);
  });
  return seen;
}

/**
 * The most recent push aimed at each Person and at each User, off the log.
 *
 * ⚠ BOTH KEYS, DELIBERATELY. A send-path push is addressed to a Person and
 * resolved through `people.userId`, so its row names a personId — but the
 * self-test push is addressed to a uid, and an admin whose account has no
 * linked Person would write a row naming nobody. Keyed on personId alone,
 * that admin's refused test push was invisible on the very list it was
 * pressed from.
 *
 * @param {Array<Object>} rows raw log rows
 * @return {Map<string, {at: number, accepted: boolean}>}
 */
function lastPushByKey(rows) {
  const last = new Map();
  const note = (key, at, accepted) => {
    if (!key) return;
    const held = last.get(key);
    if (!held || at > held.at) last.set(key, {at: at, accepted: accepted});
  };
  (rows || []).forEach((row) => {
    if (!row || row.channel !== "push") return;
    const when = core.toDate(row.createdAt);
    if (!when) return;
    note(row.personId, when.getTime(), row.accepted === true);
    note(row.toUid, when.getTime(), row.accepted === true);
  });
  return last;
}

/**
 * Every Device token in the church, grouped by the person holding it, with
 * the token masked before it leaves this process.
 *
 * Pure: `overview` does the reading, because the same two reads answer the
 * rest of the tab. "Failing" is derived here rather than stamped on the
 * token — a flag on the token document would mean the send path growing a
 * write it does not have, and this page inventing state the send path does
 * not keep.
 *
 * @param {Object} args tokens, owners, rows, now
 * @return {Object}
 */
function deviceHolders(args) {
  const a = args || {};
  const now = a.now || new Date();
  const byUid = new Map();
  (a.tokens || []).forEach((token) => {
    if (!token || !token.uid || !token.token) return;
    if (!byUid.has(token.uid)) byUid.set(token.uid, []);
    byUid.get(token.uid).push(core.describeDevice(token, now));
  });

  const ownerByUid = new Map();
  (a.owners || []).forEach((owner) => {
    if (owner && owner.uid) ownerByUid.set(owner.uid, owner);
  });

  const lastPush = lastPushByKey(a.rows);

  const people = Array.from(byUid.keys()).map((uid) => {
    const owner = ownerByUid.get(uid) || {};
    const last = (owner.personId && lastPush.get(owner.personId)) ||
      lastPush.get(uid) || null;
    const list = byUid.get(uid).slice().sort((one, two) => {
      return String(two.lastSeen || "")
          .localeCompare(String(one.lastSeen || ""));
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

  // Named people first, in name order, then the accounts with no linked
  // Person — a foyer kiosk is not who an admin came to this list to find.
  const label = (person) => person.name || person.email || person.uid;
  people.sort((one, two) => {
    if (!!one.name !== !!two.name) return one.name ? -1 : 1;
    return label(one).localeCompare(label(two)) ||
      one.uid.localeCompare(two.uid);
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
 * @param {Object} args confirm, uid, tokenId
 * @return {Promise<Object>}
 */
async function revokeToken(deps, args) {
  requireConfirm(args);
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
 * @param {Object} args callerUid and confirm — nothing else is honoured
 * @return {Promise<Object>}
 */
async function testPushToSelf(deps, args) {
  const uid = trimmed(args && args.callerUid);
  if (!uid) throw refuse("unauthenticated", "Sign in first.");
  requireConfirm(args);

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
    // The only send that names a User rather than a Person, so the only one
    // whose row has to. Without it an admin with no linked Person could
    // never see their own refused test on the device list.
    toUid: uid,
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
  requireConfirm,
  holderUids,
  lastPushByKey,
  deviceHolders,
  overview,
  history,
  revokeToken,
  testPushToSelf,
};
