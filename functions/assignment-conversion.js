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
 * ── Kept honest ──────────────────────────────────────────────────────────────
 * These rules are stated twice: here, and in public/events-occurrence-core.js
 * for the browser. Cloud Functions deploy only the functions/ directory, so the
 * browser module cannot be required from here. A duplicated domain rule is a
 * rule that can drift, and drift here means the serve log lies — so
 * test/assignment-conversion.test.js asserts the two agree, exactly as
 * roles-core.js and relationship-group-core.js are pinned to each other.
 */

/** The church's local timezone. "The date has passed" means passed HERE. */
const CHURCH_TIMEZONE = "America/Chicago";

/**
 * How far back the scheduled job looks. Long enough to cover any plausible lag
 * (a missed run, a function outage, a state flipped late), short enough that the
 * daily scan stays cheap. Anything older is resolved by hand — the "did they
 * serve?" surface writes its Involvement directly rather than waiting for this
 * job, and the People's Directory has always allowed a manual add.
 */
const LOOKBACK_DAYS = 45;

/** The three states an Assignment can be in. */
const STATES = {
  PENDING: "pending",
  CONFIRMED: "confirmed",
  DECLINED: "declined",
};

/**
 * The ONE reserved slug every one-off Role's Involvement is written under.
 * Never an invented slug per job: RolesCore.roleBySlug resolves names only for
 * liturgical Roles and stored Role Definitions, so an invented slug would render
 * as nothing on every surface showing serve history (ADR-0018 §4).
 */
const ONE_OFF_SLUG = "one_off";

/** The series a record with no series reads as (EventsCore.seriesIdOf). */
const SUNDAY_SERVICE_ID = "sunday_service";

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

/**
 * A deterministic Involvement id, so running the job twice writes one record
 * rather than two. The slot (or the one-off job) is part of the key because one
 * person can legitimately hold two Roles at a single Event.
 * @param {{id?: string, date?: string}} occurrence
 * @param {{roleSlug?: string, slotId?: string, oneOffId?: string,
 *          personId?: string}} assignment
 * @return {string}
 */
function involvementIdFor(occurrence, assignment) {
  const o = occurrence || {};
  const a = assignment || {};
  const within = a.oneOffId || a.slotId || "x";
  return [o.id || o.date, a.roleSlug, within, a.personId].join("__");
}

/**
 * The Involvement an Assignment becomes. Carries the Event series, because
 * fairness is counted per series (ADR-0016 §5) — someone can be overdue for
 * Sunday setup and fresh for a midweek Role at the same time.
 *
 * A one-off Role writes under the reserved slug with its label preserved in
 * metadata, so the person who quietly unlocks the hall every week reads as
 * somebody who serves rather than somebody who never helps.
 *
 * @param {object} occurrence
 * @param {object} assignment
 * @return {object}
 */
function serveRecordFor(occurrence, assignment) {
  const o = occurrence || {};
  const a = assignment || {};
  const record = {
    involvementId: involvementIdFor(o, a),
    personId: a.personId,
    type: a.roleSlug,
    serviceDate: o.date,
    seriesId: o.seriesId || SUNDAY_SERVICE_ID,
  };
  if (a.roleSlug === ONE_OFF_SLUG) {
    record.metadata = {
      label: a.label || null,
      oneOffId: a.oneOffId || null,
    };
  }
  return record;
}

/**
 * Split one past Event's assignments into what converts and what stays a
 * question. Safe against an Event with no assignments at all.
 *
 * @param {{id?: string, date?: string, seriesId?: string,
 *          assignments?: Array<object>}} occurrence
 * @return {{serves: Array<object>, questions: Array<object>}}
 */
function conversion(occurrence) {
  const serves = [];
  const questions = [];

  ((occurrence && occurrence.assignments) || []).forEach((assignment) => {
    const state = (assignment && assignment.state) || STATES.PENDING;

    if (state === STATES.CONFIRMED) {
      serves.push(serveRecordFor(occurrence, assignment));
    } else if (state === STATES.PENDING) {
      questions.push({
        personId: assignment.personId,
        roleSlug: assignment.roleSlug,
        label: assignment.label || null,
        assignment: assignment,
      });
    }
    // Declined falls through deliberately. It is neither a serve record nor a
    // question — they told us, so there is nothing to ask and nothing to count.
  });

  return {serves, questions};
}

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
