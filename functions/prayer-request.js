/**
 * @fileoverview Pure pastoral-prayer domain logic for the Prayer Request
 * texting flow. No Firebase or Textbelt I/O — the orchestrator in index.js
 * loads the editable templates, performs sends, and writes Firestore; this
 * module only decides and shapes, so every rule here is unit-testable
 * directly.
 */

const nc = require("./notification-core");

/**
 * The church's local timezone, and the send window, live on the notification
 * core so a text and a push share one clock. Re-exported so existing callers
 * (`pr.WINDOW_OPEN_HOUR`, `pr.churchDateParts`) keep their names.
 */
const CHURCH_TIMEZONE = nc.CHURCH_TIMEZONE;
const WINDOW_OPEN_HOUR = nc.WINDOW_OPEN_HOUR;
const WINDOW_CLOSE_HOUR = nc.WINDOW_CLOSE_HOUR;

/** First send happens when the service is this many days away (or fewer). */
const INITIAL_DAYS_OUT = 5;

/** Reminder send happens when the service is this many days away (or fewer). */
const REMINDER_DAYS_OUT = 3;

/**
 * Canonical default Prayer Request message templates. {name} is replaced with
 * the subject's first name when sent. These are the server-side fallback when
 * app_config/prayer_request_sms has no (or a blank) value for a kind. KEEP IN
 * SYNC with PRAYER_MESSAGE_DEFAULTS in public/admin-dashboard.js, which seeds
 * the editor with the same text.
 * @type {{initial: string, reminder: string, thankyou: string}}
 */
const DEFAULT_PRAYER_MESSAGES = {
  initial: "Hi {name}, this is Mosaic Church. You're in our pastoral prayer " +
    "this Sunday. What would you like us to pray about? (This information " +
    "will be private and only shared with Elders) Just reply to this message.",
  reminder: "Hi {name}, a gentle reminder from Mosaic Church — we'd love to " +
    "pray for you this Sunday. What would you like us to pray about? (This " +
    "information will be private and only shared with Elders) Just reply " +
    "here whenever you're ready.",
  thankyou: "Thank you, {name}. We'll be lifting this up in prayer this " +
    "Sunday. — Mosaic Church",
  elderDigest: "Mosaic prayer requests for {date}:\n{requests}",
};

/**
 * Lock-screen wording per purpose. A text runs long; a title does not.
 * KEEP IN SYNC with DEFAULT_PUSH_WORDING in public/admin-dashboard.js and
 * public/mobile/data.js. {name} is the subject's first name.
 * @type {Object}
 */
const DEFAULT_PUSH_WORDING = {
  initial: {
    title: "Sunday's prayer",
    body: "{name}, you're in this Sunday's pastoral prayer. " +
      "What can we pray about?",
  },
  reminder: {
    title: "Prayer reminder",
    body: "{name}, we'd still love to know what to pray about this Sunday.",
  },
  thankyou: {
    title: "Thank you",
    body: "Thank you, {name}. We'll be praying this Sunday.",
  },
};

/** Purposes that have a lock-screen title and body. */
const PUSH_WORDING_KINDS = ["initial", "reminder", "thankyou"];

/**
 * Config field for one half of a push template, e.g. pushInitialTitle.
 * @param {string} kind initial | reminder | thankyou
 * @param {string} part title | body
 * @return {string}
 */
function pushConfigKey(kind, part) {
  const cap = kind.charAt(0).toUpperCase() + kind.slice(1);
  const which = part === "title" ? "Title" : "Body";
  return `push${cap}${which}`;
}

/**
 * The first whitespace-delimited token of a full name.
 * @param {string} name
 * @return {string}
 */
function firstNameOf(name) {
  if (typeof name !== "string") return "";
  const trimmed = name.trim();
  if (!trimmed) return "";
  return trimmed.split(/\s+/)[0];
}

/**
 * Merges a saved config over the defaults per field, treating a missing or
 * blank value as "use the default" so a half-filled config doc still renders
 * complete messages.
 * @param {?Object} config - app_config/prayer_request_sms data (or null).
 * @return {{initial: string, reminder: string, thankyou: string}}
 */
function resolveTemplates(config) {
  const data = config || {};
  const pick = (kind) => {
    const v = typeof data[kind] === "string" ? data[kind].trim() : "";
    return v || DEFAULT_PRAYER_MESSAGES[kind];
  };
  return {
    initial: pick("initial"),
    reminder: pick("reminder"),
    thankyou: pick("thankyou"),
    elderDigest: pick("elderDigest"),
  };
}

/**
 * Push title and body per purpose. A blank field uses that field's default,
 * so a half-filled config still renders a complete lock screen.
 * @param {?Object} config app_config/prayer_request_sms, or null.
 * @return {Object} initial, reminder, thankyou — each {title, body}
 */
function resolvePushWording(config) {
  const data = config || {};
  const out = {};
  for (const kind of PUSH_WORDING_KINDS) {
    const titleRaw = data[pushConfigKey(kind, "title")];
    const bodyRaw = data[pushConfigKey(kind, "body")];
    const title = typeof titleRaw === "string" ? titleRaw.trim() : "";
    const body = typeof bodyRaw === "string" ? bodyRaw.trim() : "";
    out[kind] = {
      title: title || DEFAULT_PUSH_WORDING[kind].title,
      body: body || DEFAULT_PUSH_WORDING[kind].body,
    };
  }
  return out;
}

/**
 * Renders one Prayer Request message, substituting the subject's first name for
 * every {name} placeholder (falling back to "there" when unknown).
 * @param {'initial'|'reminder'|'thankyou'} kind
 * @param {string} firstName
 * @param {{initial: string, reminder: string, thankyou: string}} [templates]
 * @return {string}
 */
function renderPrayerRequestMessage(kind, firstName, templates) {
  const tpl = (templates && templates[kind]) ||
    DEFAULT_PRAYER_MESSAGES[kind] || "";
  const name = (typeof firstName === "string" && firstName.trim()) ?
    firstName.trim() : "there";
  return tpl.split("{name}").join(name);
}

/**
 * The church-local date (YYYY-MM-DD) and hour (0-23) for an instant.
 * Defined on the notification core; this name stays for existing callers.
 * @param {Date} now
 * @return {{date: string, hour: number}}
 */
function churchDateParts(now) {
  return nc.churchDateParts(now);
}

/**
 * Whole days from todayDate to serviceDate (both YYYY-MM-DD). Negative if the
 * service date is in the past.
 * @param {string} serviceDate
 * @param {string} todayDate
 * @return {number}
 */
function daysUntil(serviceDate, todayDate) {
  const toUTC = (d) => {
    const [y, m, day] = d.split("-").map(Number);
    return Date.UTC(y, m - 1, day);
  };
  return Math.round((toUTC(serviceDate) - toUTC(todayDate)) / 86400000);
}

/**
 * Whether this subject can be told at all: a live device token or a phone.
 * A token with no phone is still reachable. Neither is not.
 * @param {Object} state hasPhone, hasDeviceToken
 * @return {boolean}
 */
function canBeTold(state) {
  return !!(state && (state.hasPhone || state.hasDeviceToken));
}

/**
 * The automatic (scheduler) decision: what ask, if any, to send a pastoral-
 * prayer subject right now.
 * @param {Object} state
 * @param {number} state.daysUntilService
 * @param {number} state.localHour church-local hour (0-23)
 * @param {boolean} state.hasPhone
 * @param {boolean} [state.hasDeviceToken]
 * @param {boolean} state.requestFilled request already provided
 * @param {?string} state.initialSentDate church-local date the initial went out
 * @param {boolean} state.reminderSent
 * @param {string} state.today church-local date (YYYY-MM-DD)
 * @return {'initial'|'reminder'|'none'}
 */
function prayerRequestAction(state) {
  const {
    daysUntilService,
    localHour,
    requestFilled,
    initialSentDate,
    reminderSent,
    today,
  } = state;

  if (!canBeTold(state)) return "none";
  if (requestFilled) return "none";
  if (daysUntilService < 0) return "none";
  if (!nc.isInsideSendWindow(localHour)) return "none";

  const initialSent = !!initialSentDate;
  if (!initialSent) {
    return daysUntilService <= INITIAL_DAYS_OUT ? "initial" : "none";
  }

  // Initial already sent — the reminder fires only at the three-day mark and
  // never on the same church-local day the initial went out (late entries).
  if (!reminderSent &&
      daysUntilService <= REMINDER_DAYS_OUT &&
      initialSentDate < today) {
    return "reminder";
  }
  return "none";
}

/**
 * The manual ("Send now") decision: a human is choosing to send now, so the
 * timing/quiet-hours guards are bypassed, but the hard guards remain — refuse
 * when nobody can be reached, or the request is already filled. Initial if
 * none sent yet, reminder once it has (a repeat click re-sends the reminder
 * as a deliberate nudge).
 * @param {Object} state
 * @param {boolean} state.hasPhone
 * @param {boolean} [state.hasDeviceToken]
 * @param {boolean} state.requestFilled
 * @param {?string} state.initialSentDate
 * @param {boolean} state.reminderSent
 * @return {'initial'|'reminder'|'none'}
 */
function manualPrayerRequestKind(state) {
  const {requestFilled, initialSentDate} = state;
  if (!canBeTold(state)) return "none";
  if (requestFilled) return "none";
  return initialSentDate ? "reminder" : "initial";
}

/**
 * What the send path should be asked for this ask. The reminder escalates:
 * the first ask may not have landed, so this one takes the other route.
 * @param {'initial'|'reminder'|'none'} action
 * @return {?{purpose: string, wording: string, escalate: boolean}}
 */
function prayerNotifyRequest(action) {
  if (action !== "initial" && action !== "reminder") return null;
  return {
    purpose: "prayer_request",
    wording: action,
    escalate: action === "reminder",
  };
}

/**
 * The URL a prayer ask leads to. MS-247 mints the Answer link and passes it
 * in. Until then this returns null rather than inventing /a/<token>.
 * @param {?string} url
 * @return {?string}
 */
function prayerAskUrl(url) {
  if (typeof url === "string" && url.trim()) return url.trim();
  return null;
}

/**
 * Minimal TipTap/ProseMirror document wrapping a line of plain text, matching
 * the shape a Shepherding Note's contentJson takes.
 * @param {string} text
 * @return {Object}
 */
function tiptapFromText(text) {
  const value = typeof text === "string" ? text : "";
  const paragraph = {type: "paragraph"};
  if (value) {
    paragraph.content = [{type: "text", text: value}];
  }
  return {type: "doc", content: [paragraph]};
}

/**
 * Builds the core "Prayer Request" Shepherding Note payload from a reply. The
 * caller adds author and timestamp fields before writing.
 * @param {{personName: string, serviceDate: string, requestText: string}} args
 * @return {Object} type, subject, content, contentJson
 */
function buildPrayerRequestNote(args) {
  const {serviceDate, requestText} = args;
  const text = (requestText || "").trim();
  return {
    type: "Prayer Request",
    subject: `Prayer Request — ${serviceDate}`,
    content: text,
    contentJson: tiptapFromText(text),
  };
}

/**
 * Decides whether the elder digest should be sent after a Prayer Request write.
 * Fires only when every designated subject is now filled, the write that
 * completed the set came by text reply, and the set was not already complete
 * before this write (so manual fills and later edits never trigger it).
 * @param {Object} args
 * @param {Array} args.subjectStates one per designated subject, each
 *   {filled}
 * @param {?string} args.changedSource prayerRequestSource of the
 *   just-written doc
 * @param {boolean} args.wasCompleteBefore all subjects filled before
 *   this write
 * @return {boolean}
 */
function elderDigestDecision({
  subjectStates, changedSource, wasCompleteBefore,
}) {
  if (!Array.isArray(subjectStates) || subjectStates.length === 0) return false;
  if (!subjectStates.every((s) => s && s.filled)) return false;
  if (wasCompleteBefore) return false;
  return changedSource === "reply";
}

const DIGEST_MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const DIGEST_WEEKDAYS = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
];

/**
 * Renders a YYYY-MM-DD service date as a friendly "Weekday, Month D, YYYY".
 * Computed in UTC so it is deterministic regardless of host timezone.
 * @param {string} serviceDate
 * @return {string}
 */
function formatServiceDate(serviceDate) {
  const [y, m, d] = String(serviceDate || "").split("-").map(Number);
  if (!y || !m || !d) return String(serviceDate || "");
  const weekday = DIGEST_WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${weekday}, ${DIGEST_MONTHS[m - 1]} ${d}, ${y}`;
}

/**
 * Renders the elder digest: substitutes {date} with the friendly service date
 * and {requests} with one "Name — request" line per filled subject.
 * @param {string} [template]
 * @param {Object} data serviceDate and subjects (name, request)
 * @return {string}
 */
function renderElderDigest(template, data) {
  const tpl = (typeof template === "string" && template) ?
    template : DEFAULT_PRAYER_MESSAGES.elderDigest;
  const {serviceDate, subjects} = data;
  const requests = (subjects || [])
      .map((s) => `${s.name} — ${s.request}`)
      .join("\n");
  return tpl
      .split("{date}").join(formatServiceDate(serviceDate))
      .split("{requests}").join(requests);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    CHURCH_TIMEZONE,
    INITIAL_DAYS_OUT,
    REMINDER_DAYS_OUT,
    WINDOW_OPEN_HOUR,
    WINDOW_CLOSE_HOUR,
    DEFAULT_PRAYER_MESSAGES,
    DEFAULT_PUSH_WORDING,
    PUSH_WORDING_KINDS,
    pushConfigKey,
    firstNameOf,
    resolveTemplates,
    resolvePushWording,
    renderPrayerRequestMessage,
    churchDateParts,
    daysUntil,
    prayerRequestAction,
    manualPrayerRequestKind,
    prayerNotifyRequest,
    prayerAskUrl,
    tiptapFromText,
    buildPrayerRequestNote,
    elderDigestDecision,
    formatServiceDate,
    renderElderDigest,
  };
}
