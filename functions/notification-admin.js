/**
 * @fileoverview Admin view of Notifications — masking, the type registry,
 * the send-flow picture, and callable handlers. No Firebase, no network.
 * Callables inject I/O so `npm test` can exercise the guards without
 * loading firebase-functions (same seam as access-assert.js).
 *
 * This module does not pick a channel and does not change tellPerson.
 */

const nc = require("./notification-core");

/** Last N characters of a token the browser is allowed to see. */
const TOKEN_MASK_VISIBLE = 6;

/** A device not rewritten in this many days is flagged stale. */
const STALE_AFTER_DAYS = 30;

/** Distinct purpose written for an admin's own-device test push. */
const TEST_PUSH_PURPOSE = "admin_test_push";

/** Default page length for the sent log. */
const DEFAULT_PAGE_SIZE = 25;

/** Hard cap so a caller cannot ask the function for the whole log. */
const MAX_PAGE_SIZE = 100;

/**
 * Read-only note: older outbound texts may still live in sms_messages
 * until the MS-253 copy runs in prod. This module never reads or writes
 * that collection.
 */
const OLDER_HISTORY_NOTE =
    "Older texts may still be in sms_messages until the MS-253 copy " +
    "runs in production. That copy is not run from here.";

/**
 * A callable refusal the index.js wrapper maps onto HttpsError.
 * @param {string} code Firebase callable code
 * @param {string} message what to say
 * @return {Error}
 */
function refuse(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

/**
 * Hide a device token. Never returns the full string once it is long
 * enough to hide.
 * @param {?string} token
 * @return {string}
 */
function maskToken(token) {
  if (typeof token !== "string" || !token) return "";
  if (token.length <= TOKEN_MASK_VISIBLE) {
    return "•".repeat(token.length);
  }
  return "…" + token.slice(-TOKEN_MASK_VISIBLE);
}

/**
 * Milliseconds from a Date, a Firestore timestamp, or millis.
 * @param {*} value
 * @return {number}
 */
function createdAtMs(value) {
  if (value == null) return 0;
  if (typeof value === "number") return value;
  if (value instanceof Date) return value.getTime();
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.seconds === "number") {
    return value.seconds * 1000;
  }
  if (typeof value._seconds === "number") {
    return value._seconds * 1000;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Whether a token has gone quiet.
 * @param {*} updatedAt Date / timestamp / millis
 * @param {Date} now
 * @param {number} [days]
 * @return {boolean}
 */
function isTokenStale(updatedAt, now, days) {
  const limit = typeof days === "number" ? days : STALE_AFTER_DAYS;
  const ms = createdAtMs(updatedAt);
  if (!ms) return true;
  const age = (now instanceof Date ? now.getTime() : createdAtMs(now)) - ms;
  return age >= limit * 24 * 60 * 60 * 1000;
}

/**
 * Church-local display string for a log row.
 * @param {*} when
 * @return {string}
 */
function formatChurchLocal(when) {
  const ms = createdAtMs(when);
  if (!ms) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: nc.CHURCH_TIMEZONE,
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(ms));
}

/**
 * accepted | failed | unreachable
 * @param {Object} row
 * @return {string}
 */
function classifyStatus(row) {
  if (row && row.unreachable) return "unreachable";
  if (row && row.accepted) return "accepted";
  return "failed";
}

/**
 * @param {Object} row
 * @param {Object} filters channel, purpose, status
 * @return {boolean}
 */
function rowMatchesFilters(row, filters) {
  const f = filters || {};
  if (f.channel && row.channel !== f.channel) return false;
  if (f.purpose && row.purpose !== f.purpose) return false;
  if (f.status && classifyStatus(row) !== f.status) return false;
  return true;
}

/**
 * Newest-first page with an optional createdAt+id cursor.
 * @param {Array<Object>} rows
 * @param {Object} opts channel, purpose, status, cursor, pageSize
 * @return {{rows: Array, nextCursor: ?Object}}
 */
function pageNotifications(rows, opts) {
  const o = opts || {};
  const size = Math.min(
      Math.max(o.pageSize || DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const list = (rows || []).filter((r) => rowMatchesFilters(r, o));
  list.sort((a, b) => {
    const delta = createdAtMs(b.createdAt) - createdAtMs(a.createdAt);
    if (delta !== 0) return delta;
    return String(b.id || "").localeCompare(String(a.id || ""));
  });
  let start = 0;
  if (o.cursor && o.cursor.createdAtMs != null) {
    const curMs = o.cursor.createdAtMs;
    const curId = String(o.cursor.id || "");
    start = list.findIndex((r) => {
      const ms = createdAtMs(r.createdAt);
      if (ms < curMs) return true;
      if (ms > curMs) return false;
      return String(r.id || "") < curId;
    });
    if (start < 0) start = list.length;
  }
  const page = list.slice(start, start + size);
  const more = start + size < list.length;
  const last = page[page.length - 1];
  return {
    rows: page,
    nextCursor: more && last ? {
      createdAtMs: createdAtMs(last.createdAt),
      id: last.id,
    } : null,
  };
}

/**
 * A log row safe for the browser. Drops any token field.
 * @param {Object} row
 * @param {string} personName
 * @return {Object}
 */
function decorateLogRow(row, personName) {
  const src = row || {};
  return {
    id: src.id || "",
    personId: src.personId || null,
    personName: personName || "",
    channel: src.channel || "none",
    purpose: src.purpose || "",
    wording: src.wording || null,
    serviceDate: src.serviceDate || null,
    status: classifyStatus(src),
    accepted: !!src.accepted,
    unreachable: !!src.unreachable,
    churchLocalTime: formatChurchLocal(src.createdAt),
    createdAtMs: createdAtMs(src.createdAt),
    title: src.title || null,
    body: src.body || null,
    url: src.url || null,
    to: src.to || null,
  };
}

/**
 * A device row safe for the browser. Never includes `token`.
 * @param {Object} doc id, token, platform, updatedAt
 * @param {Object} ctx now, recentPushFailed, uid, personId, personName
 * @return {Object}
 */
function decorateDevice(doc, ctx) {
  const c = ctx || {};
  const now = c.now || new Date();
  const updatedAt = doc && doc.updatedAt;
  return {
    id: doc && doc.id || "",
    uid: c.uid || doc && doc.uid || "",
    personId: c.personId || null,
    personName: c.personName || "",
    platform: (doc && doc.platform) || "unknown",
    lastSeenMs: createdAtMs(updatedAt) || null,
    lastSeenChurchLocal: formatChurchLocal(updatedAt),
    maskedToken: maskToken(doc && doc.token),
    stale: isTokenStale(updatedAt, now),
    failed: !!c.recentPushFailed,
  };
}

/**
 * How a Notification is handled, derived from notification-core so the
 * picture cannot invent a different window or a different dead-token set.
 * @return {Object}
 */
function sendFlow() {
  const dead = Array.from(nc.DEAD_TOKEN_CODES);
  const afterPush = {
    accepted: nc.afterPushAttempt({
      anyAccepted: true, anyRetryable: false, hasPhone: true,
    }),
    retryable: nc.afterPushAttempt({
      anyAccepted: false, anyRetryable: true, hasPhone: true,
    }),
    allDeadHasPhone: nc.afterPushAttempt({
      anyAccepted: false, anyRetryable: false, hasPhone: true,
    }),
    allDeadNoPhone: nc.afterPushAttempt({
      anyAccepted: false, anyRetryable: false, hasPhone: false,
    }),
  };
  return {
    timezone: nc.CHURCH_TIMEZONE,
    windowOpenHour: nc.WINDOW_OPEN_HOUR,
    windowCloseHour: nc.WINDOW_CLOSE_HOUR,
    deadTokenCodes: dead,
    afterPush: afterPush,
    steps: [
      {
        id: "trigger",
        title: "A trigger fires",
        body: "A schedule, a Firestore write, or someone pressing Send now.",
      },
      {
        id: "tell",
        title: "tellPerson",
        body: "The caller names a Person and a purpose, never a channel.",
      },
      {
        id: "window",
        title: `${nc.WINDOW_OPEN_HOUR}am–${nc.WINDOW_CLOSE_HOUR - 12}pm ` +
            "church-local",
        body: `Scheduled sends wait for ${nc.WINDOW_OPEN_HOUR}:00–` +
            `${nc.WINDOW_CLOSE_HOUR}:00 ${nc.CHURCH_TIMEZONE}. ` +
            "A manual send goes now.",
      },
      {
        id: "token",
        title: "Live device token?",
        body: "Push if the Linked User holds one; a text if they hold " +
            "a phone instead.",
      },
      {
        id: "push",
        title: "Push",
        body: "Each live token is offered to FCM.",
      },
      {
        id: "accepted",
        title: "Accepted — done",
        body: "The provider took it. We do not ask again, and we do " +
            "not send a text. Outcome: " + afterPush.accepted + ".",
      },
      {
        id: "dead",
        title: "Dead token deleted",
        body: dead.join(", ") + " — that device doc is removed.",
      },
      {
        id: "fallback",
        title: "Text fallback or unreachable",
        body: "Every token dead and a phone exists → text in this " +
            "same run (" + afterPush.allDeadHasPhone + "). No phone → " +
            afterPush.allDeadNoPhone + ". A retryable error waits (" +
            afterPush.retryable + "), it does not become a text.",
      },
      {
        id: "log",
        title: "One log row",
        body: "Written to notifications: Person, channel, purpose, " +
            "and whether the provider took it.",
      },
    ],
  };
}

/**
 * Every Notification type and trigger on main. Counts are filled later
 * from the log; this table is the authored registry.
 */
const NOTIFICATION_TYPES = [
  {
    id: "prayer_request_initial",
    purpose: "prayer_request",
    wording: "initial",
    label: "Pastoral prayer — initial ask",
    programmatic: true,
    manual: true,
    wiredToNotifier: true,
    channels: ["push", "text"],
    recipients: "Pastoral-prayer subjects (prayerMale / prayerFemale) " +
        "with an empty request",
    killSwitch: "app_config/prayer_request_sms.autoSendEnabled " +
        "(schedule only)",
    window: "8am–8pm church-local; a manual Send now bypasses it",
    wordingSource: "app_config/prayer_request_sms initial + " +
        "pushInitialTitle / pushInitialBody",
    triggers: [
      {
        kind: "schedule",
        name: "sendPrayerRequestTexts",
        detail: "Hourly. Five days out.",
      },
      {
        kind: "manual",
        name: "sendPrayerRequestNow",
        detail: "Service Builder button (canDecide).",
      },
    ],
  },
  {
    id: "prayer_request_reminder",
    purpose: "prayer_request",
    wording: "reminder",
    label: "Pastoral prayer — reminder",
    programmatic: true,
    manual: true,
    wiredToNotifier: true,
    channels: ["push", "text"],
    recipients: "The same subjects, still empty three days out",
    killSwitch: "app_config/prayer_request_sms.autoSendEnabled " +
        "(schedule only)",
    window: "8am–8pm church-local; a manual Send now bypasses it",
    wordingSource: "app_config/prayer_request_sms reminder + " +
        "pushReminderTitle / pushReminderBody",
    triggers: [
      {
        kind: "schedule",
        name: "sendPrayerRequestTexts",
        detail: "Hourly. Escalates to the other channel.",
      },
      {
        kind: "manual",
        name: "sendPrayerRequestNow",
        detail: "Repeat press after the initial has gone.",
      },
    ],
  },
  {
    id: "prayer_request_thankyou",
    purpose: "prayer_request_thankyou",
    wording: null,
    label: "Prayer thank-you",
    programmatic: true,
    manual: false,
    wiredToNotifier: false,
    channels: ["text"],
    recipients: "The person who just replied with a request",
    killSwitch: "None — fires with the inbound reply",
    window: "None — a reply is answered when it arrives",
    wordingSource: "app_config/prayer_request_sms thankyou",
    triggers: [
      {
        kind: "webhook",
        name: "smsInbound",
        detail: "Textbelt reply with purpose prayer_request.",
      },
    ],
  },
  {
    id: "elder_digest",
    purpose: "elder_digest",
    wording: null,
    label: "Elder digest",
    programmatic: true,
    manual: false,
    wiredToNotifier: false,
    channels: ["text"],
    recipients: "Everyone with the Elder tag and a phone",
    killSwitch: "None — independent of autoSendEnabled. Only when " +
        "the completing fill came by text reply.",
    window: "None — fires on the completing write",
    wordingSource: "app_config/prayer_request_sms elderDigest",
    triggers: [
      {
        kind: "firestore",
        name: "notifyEldersOnPrayerComplete",
        detail: "people/{id}/prayer_requests/{serviceDate} write.",
      },
    ],
  },
  {
    id: "event_announcement",
    purpose: "event_announcement",
    wording: "tell",
    label: "Event announcement tell",
    programmatic: true,
    manual: false,
    wiredToNotifier: false,
    channels: ["push", "text"],
    recipients: "The announcement's audience when a told moment is due",
    killSwitch: "None on the job; each announcement is opted in as told",
    window: "8am–8pm church-local (the hourly job)",
    wordingSource: "app_config/prayer_request_sms " +
        "eventAnnouncementText + pushEventAnnouncementTitle/Body",
    triggers: [
      {
        kind: "schedule",
        name: "sendEventAnnouncementTells",
        detail: "Hourly, but notifierDeps is not wired yet " +
            "(MS-623 follow-up). Records no real sends.",
      },
    ],
  },
  {
    id: "sms_test",
    purpose: "test",
    wording: null,
    label: "SMS test",
    programmatic: false,
    manual: true,
    wiredToNotifier: false,
    channels: ["text"],
    recipients: "The phone number the admin typed",
    killSwitch: "Admins only (assertAdmin)",
    window: "None",
    wordingSource: "The Test & Debug box on this dashboard",
    triggers: [
      {
        kind: "manual",
        name: "smsSendTest",
        detail: "Admin Dashboard Send Test.",
      },
    ],
  },
  {
    id: "admin_test_push",
    purpose: TEST_PUSH_PURPOSE,
    wording: "admin_test",
    label: "Admin test push",
    programmatic: false,
    manual: true,
    wiredToNotifier: false,
    channels: ["push"],
    recipients: "The signed-in admin's own devices only",
    killSwitch: "Admins only (assertAdmin). Confirmation required.",
    window: "None — a human is sending now",
    wordingSource: "Fixed test copy. Not tellPerson — no text fallback.",
    triggers: [
      {
        kind: "manual",
        name: "adminSendTestPush",
        detail: "Push notifications tab, Send test push to myself.",
      },
    ],
  },
];

/**
 * Which registry row a log row belongs to.
 * @param {Object} row
 * @return {?string}
 */
function typeIdForRow(row) {
  if (!row || !row.purpose) return null;
  if (row.purpose === "prayer_request") {
    return row.wording === "reminder" ?
      "prayer_request_reminder" : "prayer_request_initial";
  }
  if (row.purpose === "prayer_request_thankyou") {
    return "prayer_request_thankyou";
  }
  if (row.purpose === "elder_digest") return "elder_digest";
  if (row.purpose === "event_announcement") return "event_announcement";
  if (row.purpose === "test") return "sms_test";
  if (row.purpose === TEST_PUSH_PURPOSE) return "admin_test_push";
  return null;
}

/**
 * Last-sent and 7 / 30 day counts for each type.
 * @param {Array<Object>} rows
 * @param {Date} now
 * @return {Array<Object>}
 */
function summarizeTypes(rows, now) {
  const nowMs = now instanceof Date ? now.getTime() : createdAtMs(now);
  const d7 = nowMs - 7 * 24 * 60 * 60 * 1000;
  const d30 = nowMs - 30 * 24 * 60 * 60 * 1000;
  const stats = {};
  NOTIFICATION_TYPES.forEach((t) => {
    stats[t.id] = {d7: 0, d30: 0, lastSentMs: null};
  });
  (rows || []).forEach((row) => {
    const id = typeIdForRow(row);
    if (!id || !stats[id]) return;
    const ms = createdAtMs(row.createdAt);
    if (!ms) return;
    if (ms >= d7) stats[id].d7 += 1;
    if (ms >= d30) stats[id].d30 += 1;
    if (stats[id].lastSentMs == null || ms > stats[id].lastSentMs) {
      stats[id].lastSentMs = ms;
    }
  });
  return NOTIFICATION_TYPES.map((t) => Object.assign({}, t, {
    counts: {d7: stats[t.id].d7, d30: stats[t.id].d30},
    lastSentMs: stats[t.id].lastSentMs,
    lastSentChurchLocal: stats[t.id].lastSentMs ?
      formatChurchLocal(stats[t.id].lastSentMs) : null,
  }));
}

/**
 * Throws unless the caller is admin or super_admin.
 * @param {Object} auth request.auth
 * @param {Function} loadPermission uid → permissionLevel
 * @return {Promise<void>}
 */
async function assertAdminCaller(auth, loadPermission) {
  if (!auth || !auth.uid) {
    throw refuse("unauthenticated", "Sign in to use the admin tools.");
  }
  const level = await loadPermission(auth.uid);
  if (level !== "admin" && level !== "super_admin") {
    throw refuse("permission-denied", "Admins only.");
  }
}

/**
 * @param {Object} data
 * @return {void}
 */
function requireConfirm(data) {
  if (!data || data.confirm !== true) {
    throw refuse("failed-precondition", "Confirmation required.");
  }
}

/**
 * @param {Object} deps
 * @param {Object} request
 * @return {Promise<Object>}
 */
async function handleRevokeToken(deps, request) {
  await assertAdminCaller(request.auth, deps.loadPermission);
  requireConfirm(request.data);
  const uid = request.data && request.data.uid;
  const tokenId = request.data && request.data.tokenId;
  if (!uid || !tokenId) {
    throw refuse("invalid-argument", "uid and tokenId are required.");
  }
  const exists = await deps.tokenExists(uid, tokenId);
  if (!exists) {
    throw refuse("not-found", "That device token is already gone.");
  }
  await deps.deleteToken(uid, tokenId);
  return {revoked: true};
}

/**
 * Send a test push to the signed-in admin's own tokens only.
 * Client-supplied uid / token / personId are ignored. Dead tokens are
 * deleted. There is no text fallback — this is not tellPerson.
 * @param {Object} deps
 * @param {Object} request
 * @return {Promise<Object>}
 */
async function handleSendTestPush(deps, request) {
  await assertAdminCaller(request.auth, deps.loadPermission);
  requireConfirm(request.data);
  const uid = request.auth.uid;
  const tokens = await deps.loadTokens(uid);
  const personId = deps.loadPersonIdForUid ?
    await deps.loadPersonIdForUid(uid) : null;
  const live = (tokens || []).filter((t) => t && t.token);
  const title = "Mosaic test push";
  const body = "This reached one of your own devices.";

  if (live.length === 0) {
    await deps.writeLog({
      personId: personId || null,
      channel: "none",
      purpose: TEST_PUSH_PURPOSE,
      wording: "admin_test",
      accepted: false,
      unreachable: true,
      title: title,
      body: body,
    });
    return {sent: false, reason: "no_tokens", accepted: false};
  }

  let anyAccepted = false;
  let anyRetryable = false;
  for (const token of live) {
    let result;
    try {
      result = await deps.sendPush({
        token: token.token,
        title: title,
        body: body,
      });
    } catch (err) {
      result = {accepted: false, error: err};
    }
    if (result && result.accepted) {
      anyAccepted = true;
      continue;
    }
    if (nc.isDeadToken(result && result.error)) {
      await deps.deleteToken(uid, token.id);
    } else {
      anyRetryable = true;
    }
  }

  if (anyAccepted) {
    await deps.writeLog({
      personId: personId || null,
      channel: "push",
      purpose: TEST_PUSH_PURPOSE,
      wording: "admin_test",
      accepted: true,
      title: title,
      body: body,
    });
    return {sent: true, accepted: true, channel: "push"};
  }

  await deps.writeLog({
    personId: personId || null,
    channel: "none",
    purpose: TEST_PUSH_PURPOSE,
    wording: "admin_test",
    accepted: false,
    unreachable: !anyRetryable,
    title: title,
    body: body,
  });
  return {
    sent: false,
    accepted: false,
    reason: anyRetryable ? "retryable" : "dead_tokens",
    unreachable: !anyRetryable,
  };
}

/**
 * @param {Object} deps
 * @param {Object} request
 * @return {Promise<Object>}
 */
async function handleListNotifications(deps, request) {
  await assertAdminCaller(request.auth, deps.loadPermission);
  const data = request.data || {};
  const opts = {
    channel: data.channel || null,
    purpose: data.purpose || null,
    status: data.status || null,
    cursor: data.cursor || null,
    pageSize: data.pageSize || DEFAULT_PAGE_SIZE,
  };
  const loaded = await deps.loadNotificationRows(opts);
  const page = Array.isArray(loaded) ?
    pageNotifications(loaded, opts) : loaded;
  const names = await deps.loadPeopleNames(
      (page.rows || []).map((r) => r.personId).filter(Boolean));
  const rows = (page.rows || []).map((r) => {
    return decorateLogRow(r, names[r.personId] || "");
  });
  return {
    rows: rows,
    nextCursor: page.nextCursor || null,
    olderHistoryNote: OLDER_HISTORY_NOTE,
  };
}

/**
 * @param {Object} deps
 * @param {Object} request
 * @return {Promise<Object>}
 */
async function handleListDevices(deps, request) {
  await assertAdminCaller(request.auth, deps.loadPermission);
  const now = deps.now ? deps.now() : new Date();
  const tokens = await deps.loadAllTokens();
  const failed = deps.loadRecentPushFailures ?
    await deps.loadRecentPushFailures() : new Set();
  return {
    devices: (tokens || []).map((doc) => decorateDevice(doc, {
      now: now,
      uid: doc.uid,
      personId: doc.personId,
      personName: doc.personName,
      recentPushFailed: failed.has(doc.uid) || failed.has(doc.personId),
    })),
  };
}

/**
 * @param {Object} deps
 * @param {Object} request
 * @return {Promise<Object>}
 */
async function handleOverview(deps, request) {
  await assertAdminCaller(request.auth, deps.loadPermission);
  const now = deps.now ? deps.now() : new Date();
  const rows = deps.loadRecentNotifications ?
    await deps.loadRecentNotifications() : [];
  return {
    flow: sendFlow(),
    types: summarizeTypes(rows, now),
    olderHistoryNote: OLDER_HISTORY_NOTE,
    staleAfterDays: STALE_AFTER_DAYS,
  };
}

module.exports = {
  TOKEN_MASK_VISIBLE,
  STALE_AFTER_DAYS,
  TEST_PUSH_PURPOSE,
  OLDER_HISTORY_NOTE,
  NOTIFICATION_TYPES,
  maskToken,
  createdAtMs,
  isTokenStale,
  formatChurchLocal,
  classifyStatus,
  pageNotifications,
  decorateLogRow,
  decorateDevice,
  sendFlow,
  typeIdForRow,
  summarizeTypes,
  assertAdminCaller,
  handleRevokeToken,
  handleSendTestPush,
  handleListNotifications,
  handleListDevices,
  handleOverview,
};
