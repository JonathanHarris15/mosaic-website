/**
 * @fileoverview The assignment reminder core (MS-248, reworked). Who to
 * text about which places, and when. Pure: no Firestore, no send, and no
 * clock of its own — the scheduler passes today's church-local date in.
 *
 * Two kinds of message come out of one plan:
 *
 *  - A NUDGE to somebody who has not settled a place: still Unconfirmed, or
 *    Declined with nobody having taken it yet. The first goes when the date
 *    is 6 days away (the Monday before a Sunday), then every other day until
 *    the date — 6, 4, 2 — and it stops the moment they confirm or somebody
 *    else takes the place. Never on the day the Assignment was made, and
 *    never on the date itself.
 *  - A REMINDER the morning before, to somebody who has confirmed, naming
 *    the Role and who else is serving in it.
 *
 * Assignment states, "is this date happening" and the Assignment's key are
 * read through the shared occurrence model, never restated here.
 */

const Occ = require("./shared/events-occurrence-core.js");
const Roles = require("./shared/roles-core.js");
const {churchDateParts} = require("./notification-core");
const {shiftDate} = require("./assignment-conversion");

const PURPOSE = "assignment_nudge";
const REMINDER_PURPOSE = "assignment_reminder";
const WORDING = "nudge";
const REMINDER_WORDING = "reminder";

/** The first nudge goes when the date is this many days away. */
const FIRST_DAYS_OUT = 6;
/** Days between one nudge and the next. */
const NUDGE_EVERY = 2;

/** Which message a send is. */
const KIND = Object.freeze({NUDGE: "nudge", REMINDER: "reminder"});

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
 *   originalDate?: string,
 *   assignments?: Array<Assignment>,
 * }} Occurrence
 */

/**
 * What the scheduler remembers about one Assignment. `firstDate` and
 * `secondDate` are the older two-nudge shape, still read so a place nudged
 * before the rework is not nudged again the same week.
 * @typedef {{
 *   id?: string,
 *   personId?: string,
 *   occurrenceId?: ?string,
 *   roleSlug?: ?string,
 *   slotId?: ?string,
 *   oneOffId?: ?string,
 *   lastNudgeDate?: ?string,
 *   lastNudgeChannel?: ?string,
 *   nudgeCount?: number,
 *   reminderDate?: ?string,
 *   reminderChannel?: ?string,
 *   firstDate?: ?string,
 *   secondDate?: ?string,
 * }} NudgeRecord
 */

/**
 * One Assignment a send is about.
 * @typedef {{
 *   recordId: string,
 *   occurrenceId: string,
 *   roleSlug: string,
 *   slotId: ?string,
 *   oneOffId: ?string,
 *   date: string,
 * }} DueAssignment
 */

/**
 * One message to one Person.
 * @typedef {{
 *   kind: string,
 *   personId: string,
 *   date: string,
 *   assignments: Array<DueAssignment>,
 *   values: Object<string, string>,
 * }} NudgeSend
 */

const DEFAULT_TEXT = "You still have not confirmed or traded your service " +
  "role for {date} and it is {days} away. Please do so now: {link}";
const DEFAULT_PUSH = {
  title: "Can you make it?",
  body: "You still have not confirmed or traded your service role for " +
    "{date}. Tap to answer.",
};

const REMINDER_TEXT = "This is a reminder for your upcoming service role " +
  "tomorrow: {role}.{serving} Thank you for serving!";
const REMINDER_PUSH = {
  title: "Serving tomorrow",
  body: "{role}. Thank you for serving!",
};

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday",
  "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

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
 * The dates the scheduler reads: tomorrow to 6 days out.
 * @param {string} today church-local YYYY-MM-DD
 * @return {{from: string, to: string}}
 */
function lookAhead(today) {
  return {
    from: shiftDate(today, 1),
    to: shiftDate(today, FIRST_DAYS_OUT),
  };
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
  return churchDateParts(when).date;
}

/**
 * "Sunday, November 22".
 * @param {string} dateStr YYYY-MM-DD
 * @return {string}
 */
function longDate(dateStr) {
  const d = utcDay(dateStr);
  return `${WEEKDAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${
    d.getUTCDate()}`;
}

/**
 * "1 day", "4 days".
 * @param {number} n
 * @return {string}
 */
function daysLabel(n) {
  return n === 1 ? "1 day" : `${n} days`;
}

/**
 * The record an Assignment is remembered under: the Assignment's own key
 * (occurrence, Role, slot or one-off job, and Person — the same key its
 * Involvement is later written under). The Person in it is what gives
 * somebody taking over an Assignment their own clock.
 *
 * A moved date is the same instance on another day (ADR-0018), so it keeps
 * the key of the date the pattern first put it on, and with it what it has
 * already been sent. ⚠ `originalDate`, not `movedFrom`: that is only the
 * last hop.
 * @param {Occurrence} occurrence
 * @param {Assignment} assignment
 * @return {string}
 */
function nudgeRecordId(occurrence, assignment) {
  const first = occurrence.originalDate || occurrence.movedFrom;
  const keyedOn = first && occurrence.seriesId ?
    {id: Occ.occurrenceId(occurrence.seriesId, first)} :
    occurrence;
  return Occ.involvementIdFor(keyedOn, assignment);
}

/**
 * A Role's name as a person reads it.
 * @param {Assignment} assignment
 * @param {Object<string, string>} roleNames slug → name
 * @return {string}
 */
function roleName(assignment, roleNames) {
  const slug = assignment.roleSlug || "";
  if (slug === Occ.ONE_OFF_SLUG) return assignment.label || "A job";
  return (roleNames && roleNames[slug]) || slug;
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
 * Whether two roster rows are the same Role (and, for a one-off, the same
 * job) — what "serving in this role with you" means.
 * @param {Assignment} a
 * @param {Assignment} b
 * @return {boolean}
 */
function sameRole(a, b) {
  if ((a.roleSlug || "") !== (b.roleSlug || "")) return false;
  if (a.roleSlug === Occ.ONE_OFF_SLUG) {
    return (a.oneOffId || null) === (b.oneOffId || null);
  }
  return true;
}

/**
 * Who else is down for this Role on this date, by name. Somebody who has
 * declined is not serving.
 * @param {Occurrence} occurrence
 * @param {Assignment} mine
 * @param {Object<string, string>} names personId → name
 * @return {Array<string>}
 */
function servingWith(occurrence, mine, names) {
  return (occurrence.assignments || [])
      .filter((a) => a && a.personId && a.personId !== mine.personId &&
        sameRole(a, mine) &&
        Occ.stateOf(a) !== Occ.STATES.DECLINED)
      .map((a) => (names && names[a.personId || ""]) || "")
      .filter(Boolean);
}

/**
 * What nudgePlan is asked. today is church-local YYYY-MM-DD; roleNames
 * maps a Role's slug to its name; names maps a Person's id to their name.
 * @typedef {{
 *   occurrences?: Array<Occurrence>,
 *   records?: Array<NudgeRecord>,
 *   today: string,
 *   roleNames?: Object<string, string>,
 *   names?: Object<string, string>,
 * }} NudgePlanArgs
 */

/**
 * The last day this Assignment was nudged, in either record shape.
 * @param {?NudgeRecord} rec
 * @return {?string}
 */
function lastNudged(rec) {
  if (!rec) return null;
  return rec.lastNudgeDate || rec.secondDate || rec.firstDate || null;
}

/**
 * Whether this Assignment is still waiting on its holder: Unconfirmed, or
 * Declined and not yet taken by anybody.
 * @param {Assignment} assignment
 * @return {boolean}
 */
function unsettled(assignment) {
  const state = Occ.stateOf(assignment);
  return state === Occ.STATES.PENDING || state === Occ.STATES.DECLINED;
}

/**
 * Whether a nudge is due on this Assignment today.
 * @param {Assignment} assignment
 * @param {?NudgeRecord} rec
 * @param {number} daysOut
 * @param {string} today
 * @return {boolean}
 */
function nudgeDue(assignment, rec, daysOut, today) {
  if (daysOut < 1 || daysOut > FIRST_DAYS_OUT) return false;
  if (!unsettled(assignment)) return false;
  // The day they were put on the place they were told so already, and the
  // day they declined it they know.
  if (churchDateOf(assignment.stateSetAt) === today) return false;
  const last = lastNudged(rec);
  if (!last) return true;
  return daysBetween(last, today) >= NUDGE_EVERY;
}

/**
 * Whether the day-before reminder is due on this Assignment today.
 * @param {Assignment} assignment
 * @param {?NudgeRecord} rec
 * @param {number} daysOut
 * @return {boolean}
 */
function reminderDue(assignment, rec, daysOut) {
  if (daysOut !== 1) return false;
  if (Occ.stateOf(assignment) !== Occ.STATES.CONFIRMED) return false;
  return !(rec && rec.reminderDate);
}

/**
 * The key of one row: who, and what. Grouping a person's places on one
 * date into one message.
 * @param {string} kind
 * @param {string} personId
 * @param {string} date
 * @return {string}
 */
function groupKey(kind, personId, date) {
  return `${kind}|${personId}|${date}`;
}

/**
 * Who to text now, about what. A nudge names every unsettled place a
 * Person has on one date; a reminder is one per confirmed place, since
 * each names the people serving in that Role.
 *
 * @param {NudgePlanArgs} args
 * @return {Array<NudgeSend>}
 */
function nudgePlan(args) {
  const a = args;
  const today = a.today;
  /** @type {Object<string, NudgeRecord>} */
  const records = {};
  (a.records || []).forEach((r) => {
    if (r && r.id) records[r.id] = r;
  });

  /** @type {Map<string, NudgeSend>} */
  const nudges = new Map();
  /** @type {Array<NudgeSend>} */
  const reminders = [];

  (a.occurrences || []).forEach((occurrence) => {
    if (!occurrence || !occurrence.date) return;
    if (Occ.notHappening(occurrence)) return;
    const daysOut = daysBetween(today, occurrence.date);

    (occurrence.assignments || []).forEach((assignment) => {
      if (!assignment || !assignment.personId) return;
      if (Roles.LITURGICAL_SLUGS.indexOf(assignment.roleSlug || "") !== -1) {
        return;
      }
      const personId = assignment.personId;
      const recordId = nudgeRecordId(occurrence, assignment);
      const rec = records[recordId] || null;
      /** @type {DueAssignment} */
      const due = {
        recordId: recordId,
        occurrenceId: occurrence.id || "",
        roleSlug: assignment.roleSlug || "",
        slotId: assignment.slotId || null,
        oneOffId: assignment.oneOffId || null,
        date: occurrence.date || "",
      };

      if (nudgeDue(assignment, rec, daysOut, today)) {
        const key = groupKey(KIND.NUDGE, personId, occurrence.date || "");
        const send = nudges.get(key) || {
          kind: KIND.NUDGE,
          personId: personId,
          date: occurrence.date || "",
          assignments: [],
          values: {
            date: longDate(occurrence.date || ""),
            days: daysLabel(daysOut),
          },
        };
        send.assignments.push(due);
        nudges.set(key, send);
        return;
      }

      if (reminderDue(assignment, rec, daysOut)) {
        const others = servingWith(occurrence, assignment, a.names || {});
        reminders.push({
          kind: KIND.REMINDER,
          personId: personId,
          date: occurrence.date || "",
          assignments: [due],
          values: {
            role: roleName(assignment, a.roleNames || {}),
            serving: others.length ?
              ` You will be serving with ${joinWithAnd(others)}.` : "",
          },
        });
      }
    });
  });

  const out = Array.from(nudges.values()).concat(reminders);
  out.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
  return out;
}

/**
 * The people a reminder names who are not already known by name: every
 * other holder of a confirmed Assignment's Role on a date tomorrow.
 * @param {Array<Occurrence>} occurrences
 * @param {string} today
 * @return {Array<string>} person ids
 */
function namesNeeded(occurrences, today) {
  const ids = new Set();
  (occurrences || []).forEach((o) => {
    if (!o || !o.date || daysBetween(today, o.date) !== 1) return;
    (o.assignments || []).forEach((x) => {
      if (x && x.personId) ids.add(x.personId);
    });
  });
  return Array.from(ids);
}

/**
 * What a record is stamped with. channel is push, text or none.
 * @typedef {{
 *   kind: string,
 *   assignment: Partial<DueAssignment>,
 *   personId: string,
 *   today: string,
 *   channel?: ?string,
 * }} StampArgs
 */

/**
 * An Assignment's record after this run's message. Every attempt is
 * stamped whatever the outcome, so a failing text is not repeated every
 * hour; the next nudge two days on is the retry.
 * @param {?NudgeRecord} existing the record before
 * @param {StampArgs} s
 * @return {NudgeRecord}
 */
function stampedRecord(existing, s) {
  const p = s.assignment || {};
  /** @type {NudgeRecord} */
  const base = Object.assign({
    personId: s.personId,
    occurrenceId: p.occurrenceId || null,
    roleSlug: p.roleSlug || null,
    slotId: p.slotId || null,
    oneOffId: p.oneOffId || null,
    lastNudgeDate: null,
    lastNudgeChannel: null,
    nudgeCount: 0,
    reminderDate: null,
    reminderChannel: null,
  }, existing || {});
  if (s.kind === KIND.REMINDER) {
    base.reminderDate = s.today;
    base.reminderChannel = s.channel || null;
  } else {
    base.lastNudgeDate = s.today;
    base.lastNudgeChannel = s.channel || null;
    base.nudgeCount = (Number(base.nudgeCount) || 0) + 1;
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
  const reminder = send.kind === KIND.REMINDER;
  return {
    personId: send.personId,
    purpose: reminder ? REMINDER_PURPOSE : PURPOSE,
    wording: reminder ? REMINDER_WORDING : WORDING,
    url: `${origin}/commitments.html`,
    serviceDate: send.date || null,
    expectReply: false,
    values: Object.assign({}, send.values),
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
 * Wording in the shape the send path loads. The nudge's saved values win
 * over its defaults, each field on its own; the reminder is fixed.
 *
 * ⚠ The saved nudge keys are new (`reminderNudge…`). The older `nudgeText`
 * filled {places}, which this wording no longer has, so it is not read.
 * @param {?Object<string, *>} config app_config/prayer_request_sms
 * @return {Object<string, *>}
 */
function templatesForSendPath(config) {
  const c = config || {};
  return {
    text: {
      [WORDING]: trimmed(c.reminderNudgeText) || DEFAULT_TEXT,
      [REMINDER_WORDING]: REMINDER_TEXT,
    },
    textFallback: {
      [WORDING]: DEFAULT_TEXT,
      [REMINDER_WORDING]: REMINDER_TEXT,
    },
    push: {
      [WORDING]: {
        title: trimmed(c.reminderNudgePushTitle) || DEFAULT_PUSH.title,
        body: trimmed(c.reminderNudgePushBody) || DEFAULT_PUSH.body,
      },
      [REMINDER_WORDING]: REMINDER_PUSH,
    },
    pushFallback: {
      [WORDING]: DEFAULT_PUSH,
      [REMINDER_WORDING]: REMINDER_PUSH,
    },
  };
}

/**
 * The admin switch. Off unless somebody turned it on. It covers every
 * assignment message: the "you have been assigned" text, the nudges and
 * the day-before reminder.
 * @param {?Object<string, *>} config app_config/prayer_request_sms
 * @return {boolean}
 */
function nudgingOn(config) {
  return !!(config && config.nudgeEnabled === true);
}

module.exports = {
  lookAhead,
  longDate,
  nudgeRecordId,
  nudgePlan,
  namesNeeded,
  stampedRecord,
  notifyRequest,
  templatesForSendPath,
  nudgingOn,
};
