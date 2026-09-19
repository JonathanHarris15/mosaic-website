/**
 * The Firestore half of the attendance rule (MS-425, ADR-0066).
 *
 * The decisions live in attendance-rule.js, pure. This reads the Person,
 * their latest Membership Change, and Attendance under Event occurrences
 * dated inside the window, then — if the rule says move — writes the
 * slider's move in one transaction: stage, re-projected tags, one
 * Membership Change. The transaction re-reads the Person and the latest
 * Membership Change, then recounts, and aborts if they are no longer a
 * Visitor or the reset now leaves them short — so two marks landing
 * together produce one entry, and an elder move-back in the same
 * second is not overwritten (MS-544).
 *
 * Takes a `db` rather than reaching for one, so test/emulator/ can drive
 * the writes against real Firestore semantics. Same split as
 * member-sync / trade-writes.
 */

const rule = require("./attendance-rule");
const track = require("./membership-track");

const PEOPLE = "people";
const ACTIVITY = "shepherding_activity";
const OCCURRENCES = "event_occurrences";
const ATTENDANCE = "attendance";
const TAGS = "people_tags";

/**
 * This Person's Membership Changes. One query, used both for the
 * exported helper and the transactional re-read, so they cannot drift.
 * @param {FirebaseFirestore.DocumentReference} personRef The Person.
 * @return {FirebaseFirestore.Query} kind == membership_change.
 */
function membershipChanges(personRef) {
  return personRef.collection(ACTIVITY)
      .where("kind", "==", "membership_change");
}

/**
 * Church-local day of the latest Membership Change in a snapshot.
 * @param {FirebaseFirestore.QuerySnapshot} snap The changes.
 * @return {?string} YYYY-MM-DD, or null.
 */
function lastChangeDayFromSnap(snap) {
  const stamps = [];
  snap.forEach((doc) => stamps.push(doc.get("createdAt")));
  return rule.lastChangeDayFromStamps(stamps);
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
  const snap = await membershipChanges(
      db.collection(PEOPLE).doc(personId)).get();
  return lastChangeDayFromSnap(snap);
}

/**
 * Re-read the reset boundary inside a transaction so an elder move-back
 * that landed after the un-transacted reads is not ignored (MS-568).
 * @param {FirebaseFirestore.Transaction} tx The open transaction.
 * @param {FirebaseFirestore.DocumentReference} personRef The Person.
 * @return {Promise<?string>} YYYY-MM-DD, or null.
 */
async function lastMembershipChangeDayInTx(tx, personRef) {
  const snap = await tx.get(membershipChanges(personRef));
  return lastChangeDayFromSnap(snap);
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
 * rule says so. The latest Membership Change is re-read inside that
 * transaction, before the count that can promote.
 * @param {FirebaseFirestore.Firestore} db The database.
 * @param {Object} args Who and when.
 * @param {string} args.personId The Person marked present.
 * @param {string} [args.today] Church-local YYYY-MM-DD; defaults to now.
 * @param {*} args.now Server timestamp (or a Timestamp in tests). The
 *     trigger passes `FieldValue.serverTimestamp()` from the same Admin
 *     SDK as `db`, so the emulator and production do not mix prototypes.
 * @return {Promise<Object>} `{moved, reason?, days?}`.
 */
async function applyAttendanceRule(db, args) {
  const personId = args && args.personId;
  if (!personId) return {moved: false, reason: "no_person"};
  const today = args.today || rule.churchToday(new Date());
  const now = args.now;

  const personRef = db.collection(PEOPLE).doc(personId);
  const personSnap = await personRef.get();
  if (!personSnap.exists) return {moved: false, reason: "missing"};

  const membership = personSnap.data().membership || {};
  if (!rule.isEligible(membership)) {
    return {moved: false, reason: "ineligible"};
  }

  const dates = await attendanceDatesInWindow(db, personId, today);
  // Cheap refuse: even with no reset they do not have 4 days in the window.
  // The live Membership Change is re-read inside the transaction before
  // the count that can promote (MS-568).
  const unconstrained = rule.visitDays(dates, today, null);
  if (unconstrained.length < rule.VISIT_THRESHOLD) {
    return {moved: false, reason: "threshold", days: unconstrained};
  }

  if (!now) return {moved: false, reason: "no_now"};
  return db.runTransaction(async (tx) => {
    const live = await tx.get(personRef);
    if (!live.exists) return {moved: false, reason: "missing"};
    const data = live.data();
    if (!rule.isEligible(data.membership || {})) {
      return {moved: false, reason: "ineligible"};
    }

    const lastChangeDay = await lastMembershipChangeDayInTx(tx, personRef);
    const days = rule.visitDays(dates, today, lastChangeDay);
    if (!rule.shouldMove(data.membership || {}, days)) {
      return {moved: false, reason: "threshold", days};
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
