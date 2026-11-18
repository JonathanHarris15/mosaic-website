/**
 * @fileoverview Pure conversion logic for turning Assignments into Involvement
 * records once an Event's date has passed (MS-151, ADR-0018 §1). No Firebase
 * I/O — the orchestrator in index.js reads Firestore and performs the writes;
 * this module only decides and shapes, so every rule here is unit-testable
 * directly. Same split as prayer-request.js.
 *
 * AN ASSIGNMENT IS THE PLAN; AN INVOLVEMENT IS THE FACT.
 *
 * Today the app writes a serve record the moment somebody is assigned —
 * including for a Sunday six weeks away — so the serve log already counts
 * serving that has not happened. This is the fix.
 *
 * The rules, applied only after the date has passed:
 *
 *   Confirmed → an Involvement record. They said yes, the day came, it counts.
 *   Declined  → nothing, ever.
 *   Pending   → nothing, but NOT discarded. It stays as an open question for an
 *               editor to answer later ("4 people were never confirmed — did
 *               they serve?").
 *
 * Silence is never counted as a yes, and never silently dropped. A fairness
 * engine reading a serve log full of silent gaps LOOKS like it is working while
 * quietly concluding that nobody has served in months, and hands the most
 * overworked people another round.
 *
 * ── One statement of the rules ───────────────────────────────────────────────
 * The rules themselves (the states, the Involvement id, the serve record, and
 * what converts) are events-occurrence-core's, required from functions/shared.
 * They used to be restated here, because the browser module could not be
 * required from functions — it can (scripts/sync-shared-to-functions.js), and a
 * domain rule stated twice is a rule that can drift: drift here means the serve
 * log lies. This file keeps only what is the job's own: the church's clock and
 * the window it looks back over.
 */

/** The church's local timezone. "The date has passed" means passed HERE. */
const CHURCH_TIMEZONE = "America/Chicago";

/**
 * How far back the scheduled job looks. Long enough to cover any plausible lag
 * (a missed run, a function outage, a state flipped late), short enough
 * that the daily scan stays cheap. Anything older is resolved by hand —
 * the "did they serve?" surface writes its Involvement directly rather
 * than waiting for this job, and the People's Directory has always
 * allowed a manual add.
 */
const LOOKBACK_DAYS = 45;

const Occ = require("./shared/events-occurrence-core.js");

const {STATES, ONE_OFF_SLUG, SUNDAY_SERVICE_ID} = Occ;

/**
 * Today's date in the church's timezone, as YYYY-MM-DD. A job running at 1am
 * Central must not think it is already tomorrow because the server is in UTC.
 * @param {Date} now
 * @return {string}
 */
function churchToday(now) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: CHURCH_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type) => parts.find((p) => p.type === type).value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/**
 * Shift a YYYY-MM-DD date by whole days. UTC arithmetic on a date-only string
 * has no DST to trip over.
 * @param {string} dateStr
 * @param {number} days
 * @return {string}
 */
function shiftDate(dateStr, days) {
  const [y, m, d] = String(dateStr).split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/**
 * The window of past dates this run is responsible for.
 * @param {Date} now
 * @return {{today: string, from: string, to: string}}
 */
function conversionWindow(now) {
  const today = churchToday(now);
  return {
    today,
    from: shiftDate(today, -LOOKBACK_DAYS),
    // Strictly BEFORE today. An Event happening today has not passed yet, and
    // converting it would be the very bug this job exists to fix.
    to: shiftDate(today, -1),
  };
}

/**
 * Has this Event's date passed, in the church's timezone?
 * @param {string} date YYYY-MM-DD
 * @param {string} today YYYY-MM-DD, church-local
 * @return {boolean}
 */
function hasPassed(date, today) {
  return !!date && date < today;
}

// The Involvement id, the serve record, and the split into serves and open
// questions — one definition, shared with the browser.
const {involvementIdFor, serveRecordFor, conversion} = Occ;

module.exports = {
  CHURCH_TIMEZONE,
  LOOKBACK_DAYS,
  STATES,
  ONE_OFF_SLUG,
  SUNDAY_SERVICE_ID,
  churchToday,
  shiftDate,
  conversionWindow,
  hasPassed,
  involvementIdFor,
  serveRecordFor,
  conversion,
};
