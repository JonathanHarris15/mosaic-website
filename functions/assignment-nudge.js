/**
 * @fileoverview The nudge core (MS-248). Who to nudge, about which places,
 * and when. Pure: no Firestore, no send, and no clock of its own — the
 * scheduler passes today's church-local date in.
 *
 * A NUDGE is a Notification to somebody still Unconfirmed as their date
 * nears. Two at most per place: a first at 5 days out, a second at 3 if
 * they still have not answered, by the other route from the first
 * (ADR-0036: a feature's own second chance is how it copes with a push
 * that never landed). Any answer stops them. Editors are never sent one.
 *
 * Assignment states, "is this date happening" and the place's key are read
 * through the shared occurrence model, never restated here.
 */

const Occ = require("./shared/events-occurrence-core.js");
const Roles = require("./shared/roles-core.js");

const PURPOSE = "assignment_nudge";
const WORDING = "nudge";

/** The first nudge goes when the date is this many days away. */
const FIRST_DAYS_OUT = 5;
/** The second goes at this many days away or fewer. */
const SECOND_DAYS_OUT = 3;

const CHURCH_TIMEZONE = "America/Chicago";

/**
 * One row of an occurrence's roster.
 * @typedef {{
 *   personId?: string,
 *   roleSlug?: string,
 *   slotId?: ?string,
 *   oneOffId?: ?string,
 *   label?: ?string,
 *   state?: string,
 *   stateSetAt?: *,
 * }} Assignment
 */

/**
 * A dated Event occurrence with its roster read in.
 * @typedef {{
 *   id?: string,
 *   seriesId?: string,
 *   date?: string,
 *   name?: string,
 *   seriesName?: string,
 *   visibility?: string,
 *   cancelled?: boolean,
 *   movedTo?: string,
 *   movedFrom?: string,
 *   assignments?: Array<Assignment>,
 * }} Occurrence
 */

/**
 * What the scheduler remembers about one place's nudges.
 * @typedef {{
 *   id?: string,
 *   personId?: string,
 *   occurrenceId?: ?string,
 *   roleSlug?: ?string,
 *   slotId?: ?string,
 *   oneOffId?: ?string,
 *   firstDate?: ?string,
 *   firstChannel?: ?string,
 *   secondDate?: ?string,
 *   secondChannel?: ?string,
 * }} NudgeRecord
 */

/**
 * One place in a nudge.
 * @typedef {{
 *   recordId: string,
 *   occurrenceId: string,
 *   roleSlug: string,
 *   slotId: ?string,
 *   oneOffId: ?string,
 *   date: string,
 *   stage: string,
 *   previousChannel: ?string,
 *   words: string,
 * }} Place
 */

/**
 * One Notification to one Person, naming every place due for them.
 * @typedef {{
 *   personId: string,
 *   places: Array<Place>,
 *   escalate: boolean,
 *   previousChannel: ?string,
 *   values: {places: string},
 * }} NudgeSend
 */

const DEFAULT_TEXT = "Hi {name}, you're down for {places} and haven't " +
  "said yet whether you can make it. Let the church know here: {link}";
const DEFAULT_PUSH = {
  title: "Can you make it?",
  body: "You're down for {places}. Tap to answer.",
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * @param {string} dateStr YYYY-MM-DD
 * @return {Date} midnight UTC that day
 */
function utcDay(dateStr) {
  const [y, m, d] = String(dateStr).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/**
 * Whole days from one YYYY-MM-DD to another.
 * @param {string} from
 * @param {string} to
 * @return {number}
 */
function daysBetween(from, to) {
  return Math.round((utcDay(to).getTime() - utcDay(from).getTime()) /
    86400000);
}

/**
 * @param {string} dateStr YYYY-MM-DD
 * @param {number} days
 * @return {string}
 */
function shiftDate(dateStr, days) {
  const d = utcDay(dateStr);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * The dates the scheduler reads: tomorrow to 5 days out.
 * @param {string} today church-local YYYY-MM-DD
 * @return {{from: string, to: string}}
 */
function lookAhead(today) {
  return {from: shiftDate(today, 1), to: shiftDate(today, FIRST_DAYS_OUT)};
}

/**
 * The church-local date an instant fell on, or null when it is missing.
 * Accepts a Firestore Timestamp, a Date, an ISO string or epoch millis.
 * @param {*} at
 * @return {?string}
 */
function churchDateOf(at) {
  if (!at) return null;
  let when = null;
  if (typeof at.toDate === "function") when = at.toDate();
  else if (at instanceof Date) when = at;
  else if (typeof at === "string" || typeof at === "number") {
    when = new Date(at);
  }
  if (!when || isNaN(when.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: CHURCH_TIMEZONE,
    year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(when);
  /**
   * @param {string} type
   * @return {string}
   */
  const get = (type) => {
    const part = parts.find((p) => p.type === type);
    return part ? part.value : "";
  };
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/**
 * "Sun 20 Sep".
 * @param {string} dateStr YYYY-MM-DD
 * @return {string}
 */
function shortDate(dateStr) {
  const d = utcDay(dateStr);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${
    MONTHS[d.getUTCMonth()]}`;
}

/**
 * The record a place's nudges are remembered under. The Involvement key, so
 * it names the occurrence, the Role, the slot or one-off job, and the Person
 * — which is what gives somebody taking over a place their own clock.
 * @param {Occurrence} occurrence
 * @param {Assignment} assignment
 * @return {string}
 */
function nudgeRecordId(occurrence, assignment) {
  return Occ.involvementIdFor(occurrence, assignment);
}

/**
 * How one place reads in a message.
 * @param {Occurrence} occurrence
 * @param {Assignment} assignment
 * @param {Object<string, string>} roleNames slug → name
 * @return {string}
 */
function placeWords(occurrence, assignment, roleNames) {
  const slug = assignment.roleSlug || "";
  const role = slug === Occ.ONE_OFF_SLUG ?
    (assignment.label || "A job") :
    ((roleNames && roleNames[slug]) || slug);
  const when = `${role} on ${shortDate(occurrence.date || "")}`;
  // A lock screen is seen by more people than a participant-rung Event
  // admits, so its title stays off it.
  if (Occ.visibilityOf(occurrence) === "participant") return when;
  const event = occurrence.name || occurrence.seriesName || "";
  return event ? `${when} (${event})` : when;
}

/**
 * "A", "A and B", "A, B and C".
 * @param {Array<string>} items
 * @return {string}
 */
function joinWithAnd(items) {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * What nudgePlan is asked. today is church-local YYYY-MM-DD; roleNames
 * maps a Role's slug to its name.
 * @typedef {{
 *   occurrences?: Array<Occurrence>,
 *   records?: Array<NudgeRecord>,
 *   today: string,
 *   roleNames?: Object<string, string>,
 * }} NudgePlanArgs
 */

/**
 * What a record is stamped with. channel is push, text or none.
 * @typedef {{
 *   place: Partial<Place>,
 *   personId: string,
 *   today: string,
 *   channel?: ?string,
 * }} StampArgs
 */

/**
 * Whether this Assignment can be nudged at all today.
 * @param {Occurrence} occurrence
 * @param {Assignment} assignment
 * @param {string} today
 * @return {boolean}
 */
function nudgeable(occurrence, assignment, today) {
  if (!assignment || !assignment.personId) return false;
  if (Occ.stateOf(assignment) !== Occ.STATES.PENDING) return false;
  if (Roles.LITURGICAL_SLUGS.indexOf(assignment.roleSlug || "") !== -1) {
    return false;
  }
  if (churchDateOf(assignment.stateSetAt) === today) return false;
  return true;
}

/**
 * Which stage of nudge, if any, a place is due.
 * @param {?NudgeRecord} rec its record
 * @param {number} daysOut
 * @param {string} today
 * @return {?string} first, second, or null
 */
function stageDue(rec, daysOut, today) {
  if (!rec || !rec.firstDate) return "first";
  if (rec.secondDate) return null;
  if (daysOut > SECOND_DAYS_OUT) return null;
  if (!(rec.firstDate < today)) return null;
  return "second";
}

/**
 * Who to nudge now, about what. One entry per Person, naming every place
 * due for them in this run; it escalates when any place is on its second.
 *
 * Nobody is nudged twice on one church-local day: a Person with any record
 * stamped today waits for tomorrow.
 *
 * @param {NudgePlanArgs} args
 * @return {Array<NudgeSend>}
 */
function nudgePlan(args) {
  const a = args;
  const today = a.today;
  /** @type {Object<string, NudgeRecord>} */
  const records = {};
  const stampedToday = new Set();
  (a.records || []).forEach((r) => {
    if (!r || !r.id) return;
    records[r.id] = r;
    if (r.firstDate === today || r.secondDate === today) {
      stampedToday.add(r.personId);
    }
  });

  /** @type {Map<string, Array<Place>>} */
  const byPerson = new Map();
  (a.occurrences || []).forEach((occurrence) => {
    if (!occurrence || !occurrence.date) return;
    if (Occ.notHappening(occurrence)) return;
    const daysOut = daysBetween(today, occurrence.date);
    if (daysOut < 1 || daysOut > FIRST_DAYS_OUT) return;

    (occurrence.assignments || []).forEach((assignment) => {
      if (!nudgeable(occurrence, assignment, today)) return;
      const personId = assignment.personId || "";
      if (stampedToday.has(personId)) return;
      const recordId = nudgeRecordId(occurrence, assignment);
      const rec = records[recordId] || null;
      const stage = stageDue(rec, daysOut, today);
      if (!stage) return;

      const list = byPerson.get(personId) || [];
      byPerson.set(personId, list);
      list.push({
        recordId: recordId,
        occurrenceId: occurrence.id || "",
        roleSlug: assignment.roleSlug || "",
        slotId: assignment.slotId || null,
        oneOffId: assignment.oneOffId || null,
        date: occurrence.date || "",
        stage: stage,
        previousChannel: stage === "second" && rec ?
          (rec.firstChannel || null) : null,
        words: placeWords(occurrence, assignment, a.roleNames || {}),
      });
    });
  });

  /** @type {Array<NudgeSend>} */
  const out = [];
  byPerson.forEach((places, personId) => {
    places.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
    const seconds = places.filter((p) => p.stage === "second");
    out.push({
      personId: personId,
      places: places,
      escalate: seconds.length > 0,
      previousChannel: seconds.length ? seconds[0].previousChannel : null,
      values: {places: joinWithAnd(places.map((p) => p.words))},
    });
  });
  return out;
}

/**
 * A place's record after this run's nudge. Every attempt is stamped
 * whatever the outcome; the second nudge is the retry.
 * @param {?NudgeRecord} existing the record before
 * @param {StampArgs} s
 * @return {NudgeRecord}
 */
function stampedRecord(existing, s) {
  const p = s.place || {};
  /** @type {NudgeRecord} */
  const base = Object.assign({
    personId: s.personId,
    occurrenceId: p.occurrenceId || null,
    roleSlug: p.roleSlug || null,
    slotId: p.slotId || null,
    oneOffId: p.oneOffId || null,
    firstDate: null,
    firstChannel: null,
    secondDate: null,
    secondChannel: null,
  }, existing || {});
  if (p.stage === "second") {
    base.secondDate = s.today;
    base.secondChannel = s.channel || null;
  } else {
    base.firstDate = s.today;
    base.firstChannel = s.channel || null;
  }
  return base;
}

/**
 * What the send path is asked. Who, what and where — never push or text.
 * @param {NudgeSend} send one entry from nudgePlan
 * @param {string} origin the site the Commitments page lives on
 * @return {Object<string, *>}
 */
function notifyRequest(send, origin) {
  return {
    personId: send.personId,
    purpose: PURPOSE,
    wording: WORDING,
    url: `${origin}/commitments.html`,
    escalate: !!send.escalate,
    previousChannel: send.previousChannel || null,
    expectReply: false,
    values: {places: send.values.places},
  };
}

/**
 * @param {*} v
 * @return {string}
 */
function trimmed(v) {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * Nudge wording in the shape the send path loads, saved values over the
 * defaults, each field on its own.
 * @param {?Object<string, *>} config app_config/prayer_request_sms
 * @return {Object<string, *>}
 */
function templatesForSendPath(config) {
  const c = config || {};
  return {
    text: {[WORDING]: trimmed(c.nudgeText) || DEFAULT_TEXT},
    textFallback: {[WORDING]: DEFAULT_TEXT},
    push: {[WORDING]: {
      title: trimmed(c.pushNudgeTitle) || DEFAULT_PUSH.title,
      body: trimmed(c.pushNudgeBody) || DEFAULT_PUSH.body,
    }},
    pushFallback: {[WORDING]: DEFAULT_PUSH},
  };
}

/**
 * The admin switch. Off unless somebody turned it on.
 * @param {?Object<string, *>} config app_config/prayer_request_sms
 * @return {boolean}
 */
function nudgingOn(config) {
  return !!(config && config.nudgeEnabled === true);
}

module.exports = {
  lookAhead,
  nudgeRecordId,
  nudgePlan,
  stampedRecord,
  notifyRequest,
  templatesForSendPath,
  nudgingOn,
};
