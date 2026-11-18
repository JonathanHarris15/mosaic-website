/**
 * @fileoverview The Firestore half of the "you have been assigned" and
 * "an Admin has taken you off" texts.
 * Thin: on a roster write it asks the rules whether this is a new
 * placement, claims the person's notice record so a burst sends once, and
 * sends through the one send path. Outside the church's hours the text is
 * held, and the hourly job sends it at 8am if any of the places still
 * stands.
 *
 * `assignment_notices/{personId}` is not a log — "did we tell them?" stays
 * in `notifications`, which the send path writes. It only makes a burst
 * send once and holds a text overnight.
 */

const {
  isNewPlacement,
  isRemoval,
  removedByEditor,
  removedRequest,
  coveredByBurst,
  notifyRequest,
} = require("./assignment-assigned");
const {nudgingOn, longDate} = require("./assignment-nudge");
const {loadRoleNames} = require("./assignment-nudge-firestore");
const Occ = require("./shared/events-occurrence-core.js");

/** @typedef {import("firebase-admin/firestore").Firestore} Firestore */

const NOTICES = "assignment_notices";
const OCCURRENCES = "event_occurrences";

/**
 * Everything a run needs, passed in.
 * @typedef {{
 *   origin: string,
 *   configDoc: string,
 *   today: () => string,
 *   nowMs: () => number,
 *   now: () => *,
 *   arrayUnion: (...items: Array<*>) => *,
 *   log?: (message: string) => void,
 *   tellPerson: (deps: *, request: Object<string, *>) => Promise<*>,
 *   notifierDeps: *,
 * }} AssignedDeps
 */

/**
 * Whether the occurrence is still ahead and happening.
 * @param {Firestore} db
 * @param {string} occurrenceId
 * @param {string} today
 * @return {Promise<boolean>}
 */
async function stillAhead(db, occurrenceId, today) {
  const snap = await db.collection(OCCURRENCES).doc(occurrenceId).get();
  if (!snap.exists) return false;
  const occ = snap.data() || {};
  if (Occ.notHappening(occ)) return false;
  return !!occ.date && occ.date >= today;
}

/**
 * Send, and write down how it went: held for the morning, or sent.
 * @param {Firestore} db
 * @param {AssignedDeps} deps
 * @param {string} personId
 * @return {Promise<boolean>} whether it went
 */
async function deliver(db, deps, personId) {
  const ref = db.collection(NOTICES).doc(personId);
  let result = null;
  try {
    result = await deps.tellPerson(
        deps.notifierDeps, notifyRequest(personId, deps.origin));
  } catch (err) {
    if (deps.log) deps.log(`Assigned text to ${personId} failed: ${err}`);
  }
  if (result && result.skipped === "window") {
    await ref.set({held: true, lastSentAt: null}, {merge: true});
    return false;
  }
  await ref.set({
    held: false,
    placements: [],
    lastSentAt: deps.now(),
    lastAccepted: !!(result && result.accepted),
  }, {merge: true});
  return !!(result && result.accepted);
}

/**
 * One roster write. Sends the text when it is an editor putting somebody
 * on a place and no text went to them in the last few minutes.
 * @param {Firestore} db
 * @param {AssignedDeps} deps
 * @param {{occurrenceId: string, before: *, after: *}} change
 * @return {Promise<string>} what happened, for the log
 */
async function noticePlacement(db, deps, change) {
  const nowMs = deps.nowMs();
  if (!isNewPlacement(change.before, change.after, nowMs)) return "not-new";
  const config = (await db.doc(deps.configDoc).get()).data() || {};
  if (!nudgingOn(config)) return "off";
  if (!(await stillAhead(db, change.occurrenceId, deps.today()))) {
    return "past";
  }

  const personId = change.after.personId;
  const ref = db.collection(NOTICES).doc(personId);
  // Claimed in a transaction: twenty places written at once fire twenty
  // triggers, and exactly one of them may send.
  const claimed = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const notice = snap.exists ? snap.data() : null;
    const placement = {occurrenceId: change.occurrenceId};
    if (coveredByBurst(notice, nowMs) || (notice && notice.held)) {
      tx.set(ref, {placements: deps.arrayUnion(placement)}, {merge: true});
      return false;
    }
    tx.set(ref, {
      personId: personId,
      lastSentAt: deps.now(),
      placements: deps.arrayUnion(placement),
    }, {merge: true});
    return true;
  });
  if (!claimed) return "covered";
  return (await deliver(db, deps, personId)) ? "sent" : "held-or-failed";
}

/**
 * A removed place in words: "Sound on Sunday, November 22".
 * @param {Firestore} db
 * @param {Object<string, *>} row the removed roster row
 * @param {string} date YYYY-MM-DD
 * @return {Promise<string>}
 */
async function placeWords(db, row, date) {
  let role = row.label || "";
  if (row.roleSlug !== Occ.ONE_OFF_SLUG) {
    const names = await loadRoleNames(db);
    role = names[row.roleSlug] || row.roleSlug || "";
  }
  return `${role || "service"} on ${longDate(date)}`;
}

/**
 * Whether this person is still off the place: not back on it since.
 * @param {Firestore} db
 * @param {{occurrenceId: string, personId: string, roleSlug: string,
 *   slotId: ?string, oneOffId: ?string}} r
 * @return {Promise<boolean>}
 */
async function stillOff(db, r) {
  const rows = await db.collection(OCCURRENCES).doc(r.occurrenceId)
      .collection("roster").where("personId", "==", r.personId).get();
  return !rows.docs.some((d) => {
    const x = d.data() || {};
    return (x.roleSlug || "") === (r.roleSlug || "") &&
      (x.slotId || null) === (r.slotId || null) &&
      (x.oneOffId || null) === (r.oneOffId || null);
  });
}

/**
 * Send one removal text. Outside the church's hours it is kept on the
 * person's notice record for the hourly sweep.
 * @param {Firestore} db
 * @param {AssignedDeps} deps
 * @param {Object<string, *>} r personId, occurrenceId, roleSlug, slotId,
 *   oneOffId, place, date
 * @return {Promise<string>}
 */
async function deliverRemoval(db, deps, r) {
  let result = null;
  try {
    result = await deps.tellPerson(deps.notifierDeps,
        removedRequest(r.personId, r.place, deps.origin, r.date));
  } catch (err) {
    if (deps.log) deps.log(`Removed text to ${r.personId} failed: ${err}`);
  }
  if (result && result.skipped === "window") {
    await db.collection(NOTICES).doc(r.personId).set({
      heldRemovals: deps.arrayUnion(r),
      hasHeldRemovals: true,
    }, {merge: true});
    return "held";
  }
  return result && result.accepted ? "sent" : "failed";
}

/**
 * One roster write. Tells somebody an editor has taken them off a place.
 * @param {Firestore} db
 * @param {AssignedDeps} deps
 * @param {{occurrenceId: string, before: *, after: *}} change
 * @return {Promise<string>} what happened, for the log
 */
async function noticeRemoval(db, deps, change) {
  const before = change.before;
  if (!isRemoval(before, change.after)) return "not-removal";
  const occSnap = await db.collection(OCCURRENCES)
      .doc(change.occurrenceId).get();
  if (!occSnap.exists) return "gone";
  const occ = occSnap.data() || {};
  // A moved date takes its whole roster with it; nobody was taken off.
  if (occ.movedTo || Occ.notHappening(occ)) return "not-happening";
  if (!occ.date || occ.date < deps.today()) return "past";
  const config = (await db.doc(deps.configDoc).get()).data() || {};
  if (!nudgingOn(config)) return "off";
  const roster = await db.collection(OCCURRENCES).doc(change.occurrenceId)
      .collection("roster").get();
  if (!removedByEditor(before, roster.docs.map((d) => d.data()))) {
    return "not-editor";
  }
  return deliverRemoval(db, deps, {
    personId: before.personId,
    occurrenceId: change.occurrenceId,
    roleSlug: before.roleSlug || "",
    slotId: before.slotId || null,
    oneOffId: before.oneOffId || null,
    place: await placeWords(db, before, occ.date),
    date: occ.date,
  });
}

/**
 * Whether any of the places a held text was about still stands: the
 * person is still on that date's roster and the date is still ahead.
 * @param {Firestore} db
 * @param {string} personId
 * @param {Array<{occurrenceId: string}>} placements
 * @param {string} today
 * @return {Promise<boolean>}
 */
async function anyStillStands(db, personId, placements, today) {
  const seen = new Set();
  for (const p of placements || []) {
    if (!p || !p.occurrenceId || seen.has(p.occurrenceId)) continue;
    seen.add(p.occurrenceId);
    if (!(await stillAhead(db, p.occurrenceId, today))) continue;
    const rows = await db.collection(OCCURRENCES).doc(p.occurrenceId)
        .collection("roster").where("personId", "==", personId).get();
    if (!rows.empty) return true;
  }
  return false;
}

/**
 * The hourly sweep: send the texts held overnight, if what they were about
 * still stands.
 * @param {Firestore} db
 * @param {AssignedDeps} deps
 * @return {Promise<number>} how many were sent
 */
async function sweepHeldNotices(db, deps) {
  const config = (await db.doc(deps.configDoc).get()).data() || {};
  if (!nudgingOn(config)) return 0;
  let sent = 0;
  // Removals held overnight: each still true only if they are still off
  // the place and the date is still ahead.
  const removals = await db.collection(NOTICES)
      .where("hasHeldRemovals", "==", true).get();
  for (const doc of removals.docs) {
    const held = (doc.data() || {}).heldRemovals || [];
    await doc.ref.set({heldRemovals: [], hasHeldRemovals: false},
        {merge: true});
    for (const r of held) {
      if (!r || !r.occurrenceId) continue;
      if (!(await stillAhead(db, r.occurrenceId, deps.today()))) continue;
      if (!(await stillOff(db, r))) continue;
      if ((await deliverRemoval(db, deps, r)) === "sent") sent += 1;
    }
  }

  const snap = await db.collection(NOTICES).where("held", "==", true).get();
  for (const doc of snap.docs) {
    const notice = doc.data() || {};
    if (!(await anyStillStands(
        db, doc.id, notice.placements || [], deps.today()))) {
      await doc.ref.set({held: false, placements: []}, {merge: true});
      continue;
    }
    if (await deliver(db, deps, doc.id)) sent += 1;
  }
  return sent;
}

module.exports = {
  noticeRemoval,
  noticePlacement,
  sweepHeldNotices,
};
