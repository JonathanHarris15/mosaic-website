// Pure decision logic for the attendance rule (MS-425, ADR-0066).
//
// A Visitor marked present at the Kiosk becomes Regular Attender when they
// have Attendance on 4 distinct calendar days inside a rolling 2-calendar-month
// window. The Firestore trigger in index.js and the writer in
// attendance-rule-writes.js wrap these decisions with reads and one atomic
// move; the rules themselves — who is eligible, which days count, when to
// move, and the Membership Change the Pastoral Record will render — live here
// so they can be unit-tested with no Firestore.
//
// The move is the slider's move (ADR-0012): stage + re-projected tags + one
// Membership Change. Attribution follows the account-sync precedent
// (ADR-0026): no person, "Attendance rule", source attendance_rule.

const track = require("./membership-track");
const {churchToday} = require("./assignment-conversion");

const VISIT_THRESHOLD = 4;
const WINDOW_MONTHS = 2;
const AUTHOR_NAME = "Attendance rule";
const SOURCE = "attendance_rule";

const MONTH_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * Last day of a 1-indexed month in UTC, so 31 Oct / 30 Apr clamping has no
 * DST to trip over.
 * @param {number} year Full year.
 * @param {number} month1to12 Month number, 1 = January.
 * @return {number} The last calendar day of that month.
 */
function daysInMonth(year, month1to12) {
  return new Date(Date.UTC(year, month1to12, 0)).getUTCDate();
}

/**
 * Pad a year-month-day to YYYY-MM-DD.
 * @param {number} year Full year.
 * @param {number} month Month number, 1 = January.
 * @param {number} day Day of month.
 * @return {string} YYYY-MM-DD.
 */
function ymd(year, month, day) {
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

/**
 * True only when the Person's stage is Visitor and they are not Inactive.
 * Every other stage, no stage, and Inactive refuse — the rule never puts
 * anyone onto the Track and never reactivates anyone.
 * @param {?Object} membership The Person's `membership` block.
 * @return {boolean} True when the rule may consider them.
 */
function isEligible(membership) {
  const m = membership || {};
  return m.stage === track.VISITOR_STAGE && !m.inactive;
}

/**
 * The first day of the rolling window: the same calendar day two months
 * earlier, clamped to that month's end (31 Oct → 31 Aug; 30 Apr → last day
 * of February).
 * @param {string} today Church-local YYYY-MM-DD.
 * @return {string} Window start, YYYY-MM-DD.
 */
function windowStart(today) {
  const [year, month, day] = String(today).split("-").map(Number);
  let y = year;
  let m = month - WINDOW_MONTHS;
  if (m <= 0) {
    m += 12;
    y -= 1;
  }
  return ymd(y, m, Math.min(day, daysInMonth(y, m)));
}

/**
 * Distinct visit days that count: on or after the window start, on or before
 * today, and strictly after the last Membership Change day. Same-day
 * duplicates collapse; dates after today are dropped.
 * @param {?Array<string>} occurrenceDates Occurrence dates (YYYY-MM-DD).
 * @param {string} today Church-local YYYY-MM-DD.
 * @param {?string} lastChangeDay Day of the latest Membership Change, or none.
 * @return {Array<string>} Counted days, sorted.
 */
function visitDays(occurrenceDates, today, lastChangeDay) {
  const start = windowStart(today);
  const seen = new Set();
  for (const date of occurrenceDates || []) {
    if (typeof date !== "string" || !date) continue;
    if (date < start || date > today) continue;
    if (lastChangeDay && date <= lastChangeDay) continue;
    seen.add(date);
  }
  return Array.from(seen).sort();
}

/**
 * Eligible and at least 4 counted visit days.
 * @param {?Object} membership The Person's `membership` block.
 * @param {?Array<string>} days Counted visit days.
 * @return {boolean} True when the Person should become Regular Attender.
 */
function shouldMove(membership, days) {
  return isEligible(membership) && (days || []).length >= VISIT_THRESHOLD;
}

/**
 * The `people/{id}` field update that advances a Visitor to Regular
 * Attender. Dotted paths so only the stage moves — `joinedAt` and the
 * back-compat `status` field on the membership object are preserved — and
 * the tags are re-projected from the new stage.
 *
 * The caller adds `updatedAt` (a server timestamp is not a plain value).
 * @param {?Array<string>} currentTags The Person's existing tags.
 * @return {Object} The update to apply.
 */
function regularAttenderAdvanceUpdate(currentTags) {
  const next = {stage: track.REGULAR_ATTENDER_STAGE, inactive: false};
  return {
    "membership.stage": track.REGULAR_ATTENDER_STAGE,
    "membership.inactive": false,
    "tags": track.applyMembershipTags(currentTags, next),
  };
}

/**
 * "20 Jul, 3 Aug, 31 Aug, 14 Sep" — day without a leading zero, English
 * short month, no year. The locked copy from the parent PRD.
 * @param {string} date YYYY-MM-DD.
 * @return {string} The short day.
 */
function formatShortDay(date) {
  const parts = String(date).split("-").map(Number);
  const month = MONTH_SHORT[parts[1] - 1] || "";
  return `${parts[2]} ${month}`;
}

/**
 * The explanation naming every counted day.
 * @param {Array<string>} days Counted visit days, already sorted.
 * @return {string} The explanation.
 */
function formatVisitExplanation(days) {
  const list = (days || []).map(formatShortDay).join(", ");
  const n = (days || []).length;
  const noun = n === 1 ? "day" : "days";
  return `Marked present on ${n} ${noun} in two months: ${list}.`;
}

/**
 * The Pastoral Record entry for the move. An editor moving the stage slider
 * logs a Membership Change (ADR-0012); a stage moved by the attendance rule
 * has to log one too. `authorUid` is null because no human did it.
 *
 * Mirrors buildMembershipChange in public/shepherding-core.js. The caller
 * adds `createdAt`.
 * @param {Array<string>} days The counted visit days, already sorted.
 * @return {Object} The shepherding_activity record.
 */
function buildAttendanceRuleRecord(days) {
  return {
    kind: "membership_change",
    previousStage: track.VISITOR_STAGE,
    newStage: track.REGULAR_ATTENDER_STAGE,
    previousInactive: false,
    newInactive: false,
    authorUid: null,
    authorName: AUTHOR_NAME,
    source: SOURCE,
    sourceDocumentId: null,
    explanation: formatVisitExplanation(days),
  };
}

module.exports = {
  VISIT_THRESHOLD,
  WINDOW_MONTHS,
  AUTHOR_NAME,
  SOURCE,
  isEligible,
  churchToday,
  windowStart,
  visitDays,
  shouldMove,
  regularAttenderAdvanceUpdate,
  formatVisitExplanation,
  buildAttendanceRuleRecord,
};
