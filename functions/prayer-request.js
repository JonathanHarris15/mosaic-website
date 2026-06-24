/**
 * @fileoverview Pure pastoral-prayer domain logic for the Prayer Request texting
 * flow. No Firebase or Textbelt I/O — the orchestrator in index.js loads the
 * editable templates, performs sends, and writes Firestore; this module only
 * decides and shapes, so every rule here is unit-testable directly.
 */

/** The church's local timezone — drives the send window and day countdown. */
const CHURCH_TIMEZONE = "America/Chicago";

/** First send happens when the service is this many days away (or fewer). */
const INITIAL_DAYS_OUT = 5;

/** Reminder send happens when the service is this many days away (or fewer). */
const REMINDER_DAYS_OUT = 3;

/** Earliest hour (inclusive, 24h church-local) a text may be sent. */
const WINDOW_OPEN_HOUR = 8;

/** Hour (exclusive, 24h church-local) after which no text may be sent. */
const WINDOW_CLOSE_HOUR = 20;

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
 * Renders one Prayer Request message, substituting the subject's first name for
 * every {name} placeholder (falling back to "there" when unknown).
 * @param {'initial'|'reminder'|'thankyou'} kind
 * @param {string} firstName
 * @param {{initial: string, reminder: string, thankyou: string}} [templates]
 * @return {string}
 */
function renderPrayerRequestMessage(kind, firstName, templates) {
  const tpl = (templates && templates[kind]) || DEFAULT_PRAYER_MESSAGES[kind] || "";
  const name = (typeof firstName === "string" && firstName.trim()) ?
    firstName.trim() : "there";
  return tpl.split("{name}").join(name);
}

/**
 * The church-local date (YYYY-MM-DD) and hour (0-23) for an instant.
 * @param {Date} now
 * @return {{date: string, hour: number}}
 */
function churchDateParts(now) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: CHURCH_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(now);

  const get = (type) => parts.find((p) => p.type === type).value;
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  let hour = parseInt(get("hour"), 10);
  if (hour === 24) hour = 0; // Some ICU builds render midnight as "24".
  return {date, hour};
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
 * The automatic (scheduler) decision: what text, if any, to send a pastoral-
 * prayer subject right now.
 * @param {Object} state
 * @param {number} state.daysUntilService
 * @param {number} state.localHour church-local hour (0-23)
 * @param {boolean} state.hasPhone
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
    hasPhone,
    requestFilled,
    initialSentDate,
    reminderSent,
    today,
  } = state;

  if (!hasPhone) return "none";
  if (requestFilled) return "none";
  if (daysUntilService < 0) return "none";
  if (localHour < WINDOW_OPEN_HOUR || localHour >= WINDOW_CLOSE_HOUR) {
    return "none";
  }

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
 * The manual ("Send now") decision: a human is choosing to text now, so the
 * timing/quiet-hours guards are bypassed, but the hard guards remain — refuse
 * with no phone or an already-filled request. Initial if none sent yet, reminder
 * once it has (a repeat click re-sends the reminder as a deliberate nudge).
 * @param {Object} state
 * @param {boolean} state.hasPhone
 * @param {boolean} state.requestFilled
 * @param {?string} state.initialSentDate
 * @param {boolean} state.reminderSent
 * @return {'initial'|'reminder'|'none'}
 */
function manualPrayerRequestKind(state) {
  const {hasPhone, requestFilled, initialSentDate} = state;
  if (!hasPhone) return "none";
  if (requestFilled) return "none";
  return initialSentDate ? "reminder" : "initial";
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
 * @return {{type: string, subject: string, content: string, contentJson: Object}}
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
 * @param {Array<{filled: boolean}>} args.subjectStates - one per designated subject
 * @param {?string} args.changedSource - prayerRequestSource of the just-written doc
 * @param {boolean} args.wasCompleteBefore - all subjects filled before this write
 * @return {boolean}
 */
function elderDigestDecision({subjectStates, changedSource, wasCompleteBefore}) {
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
 * @param {{serviceDate: string, subjects: Array<{name: string, request: string}>}} data
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
    firstNameOf,
    resolveTemplates,
    renderPrayerRequestMessage,
    churchDateParts,
    daysUntil,
    prayerRequestAction,
    manualPrayerRequestKind,
    tiptapFromText,
    buildPrayerRequestNote,
    elderDigestDecision,
    formatServiceDate,
    renderElderDigest,
  };
}
