/**
 * The Firestore half of the attendance rule (MS-425, ADR-0066).
 *
 * The decisions live in attendance-rule.js, pure. This reads the Person,
 * their latest Membership Change, and Attendance under Event occurrences
 * dated inside the window, then — if the rule says move — writes the
 * slider's move in one transaction: stage, re-projected tags, one
 * Membership Change. The transaction re-reads the Person and aborts if
 * they are no longer a Visitor, so two marks landing together produce one
 * entry.
 *
 * Takes a `db` rather than reaching for one, so test/emulator/ can drive
 * the writes against real Firestore semantics. Same split as
 * member-sync / trade-writes.
 */

const admin = require("firebase-admin");
const rule = require("./attendance-rule");
const track = require("./membership-track");

const PEOPLE = "people";
const ACTIVITY = "shepherding_activity";
const OCCURRENCES = "event_occurrences";
const ATTENDANCE = "attendance";
const TAGS = "people_tags";

/**
 * Church-local day of a Firestore Timestamp, or null if it cannot be read.
 * @param {?FirebaseFirestore.Timestamp} createdAt The stamp.
 * @return {?string} YYYY-MM-DD, or null.
 */
function dayOf(createdAt) {
  if (!createdAt || typeof createdAt.toDate !== "function") return null;
  const date = createdAt.toDate();
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  return rule.churchToday(date);
}

/**
 * The day of this Person's most recent Membership Change, or null if they
 * have never had one. No composite index: kind is a single-field query,
 * and the latest stamp is picked in memory.
 * @param {FirebaseFirestore.Firestore} db The database.
 * @param {string} personId The Person.
 * @return {Promise<?string>} YYYY-MM-DD, or null.
 */
async function lastMembershipChangeDay(db, personId) {
  const snap = await db.collection(PEOPLE).doc(personId)
      .collection(ACTIVITY)
      .where("kind", "==", "membership_change")
      .get();
  let latestMs = -1;
  let latest = null;
  snap.forEach((doc) => {
    const created = doc.get("createdAt");
    if (!created || typeof created.toMillis !== "function") return;
    const ms = created.toMillis();
    if (ms >= latestMs) {
      latestMs = ms;
      latest = created;
    }
  });
  return dayOf(latest);
}

/**
 * Occurrence dates inside the window on which this Person has Attendance.
 * Listed by date range, then the Attendance record (id = Person id) is
 * read under each — no collection-group query, no new index.
 * @param {FirebaseFirestore.Firestore} db The database.
 * @param {string} personId The Person.
 * @param {string} today Church-local YYYY-MM-DD.
 * @return {Promise<Array<string>>} Occurrence dates.
 */
async function attendanceDatesInWindow(db, personId, today) {
  const start = rule.windowStart(today);
  const occSnap = await db.collection(OCCURRENCES)
      .where("date", ">=", start)
      .where("date", "<=", today)
      .get();
  if (occSnap.empty) return [];

  const refs = occSnap.docs.map((doc) =>
    doc.ref.collection(ATTENDANCE).doc(personId));
  const attSnaps = await db.getAll(...refs);
  const dates = [];
  attSnaps.forEach((att, i) => {
    const date = occSnap.docs[i].get("date");
    if (att.exists && typeof date === "string") dates.push(date);
  });
  return dates;
}

/**
 * Read the Person, stop unless they are an eligible Visitor, count visit
 * days, and move them to Regular Attender in one transaction when the
 * rule says so.
 * @param {FirebaseFirestore.Firestore} db The database.
 * @param {Object} args Who and when.
 * @param {string} args.personId The Person marked present.
 * @param {string} [args.today] Church-local YYYY-MM-DD; defaults to now.
 * @return {Promise<Object>} `{moved, reason?, days?}`.
 */
async function applyAttendanceRule(db, args) {
  const personId = args && args.personId;
  if (!personId) return {moved: false, reason: "no_person"};
  const today = args.today || rule.churchToday(new Date());

  const personRef = db.collection(PEOPLE).doc(personId);
  const personSnap = await personRef.get();
  if (!personSnap.exists) return {moved: false, reason: "missing"};

  const membership = personSnap.data().membership || {};
  if (!rule.isEligible(membership)) {
    return {moved: false, reason: "ineligible"};
  }

  const lastChangeDay = await lastMembershipChangeDay(db, personId);
  const dates = await attendanceDatesInWindow(db, personId, today);
  const days = rule.visitDays(dates, today, lastChangeDay);
  if (!rule.shouldMove(membership, days)) {
    return {moved: false, reason: "threshold", days};
  }

  const now = admin.firestore.FieldValue.serverTimestamp();
  return db.runTransaction(async (tx) => {
    const live = await tx.get(personRef);
    if (!live.exists) return {moved: false, reason: "missing"};
    const data = live.data();
    if (!rule.isEligible(data.membership || {})) {
      return {moved: false, reason: "ineligible"};
    }

    const update = rule.regularAttenderAdvanceUpdate(data.tags);
    update.updatedAt = now;
    tx.update(personRef, update);
    tx.set(
        personRef.collection(ACTIVITY).doc(),
        Object.assign(rule.buildAttendanceRuleRecord(days), {createdAt: now}));

    const projected = track.membershipTagsFor({
      stage: track.REGULAR_ATTENDER_STAGE,
    });
    for (const tag of projected) {
      tx.set(db.collection(TAGS).doc(tag), {name: tag}, {merge: true});
    }
    return {moved: true, days};
  });
}

/**
 * Run the rule and never throw. The Attendance write has already
 * committed; a failure here must not retry forever or fail the greeter.
 * @param {FirebaseFirestore.Firestore} db The database.
 * @param {Object} args Who and when (see `applyAttendanceRule`).
 * @param {Function} [logFn] Optional logger (the Functions `log`).
 * @return {Promise<Object>} The result, or `{moved:false, reason:"error"}`.
 */
async function applyAttendanceRuleSafe(db, args, logFn) {
  try {
    const result = await applyAttendanceRule(db, args);
    if (result && result.moved && logFn) {
      logFn(`Attendance rule advanced ${args.personId} ` +
          `to ${track.REGULAR_ATTENDER_STAGE}`);
    }
    return result;
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    if (logFn) {
      logFn(`Attendance rule failed for ${args && args.personId}: ` +
          message);
    }
    return {moved: false, reason: "error", error: err};
  }
}

module.exports = {
  applyAttendanceRule,
  applyAttendanceRuleSafe,
  lastMembershipChangeDay,
};
