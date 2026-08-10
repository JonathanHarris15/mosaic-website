/**
 * A member answering their own Assignment (MS-20).
 *
 * ⚠ WHY THIS IS A CLOUD FUNCTION AND NOT A BROWSER WRITE.
 *
 * Answering has to change two documents at once: the person's row in the
 * occurrence's `roster` subcollection, and the occurrence's own derived fields.
 * The occurrence is `isEditor()`-only to write for good reason — opening it to
 * members would let one restamp `visibility` or `participantIds`, which is what
 * the whole five-rung visibility ladder rests on. And the two writes must be
 * atomic, or the derived fields drift from the roster they describe, which is
 * exactly what events-store.js warns about.
 *
 * So the caller's own `personId` is checked here, against the Assignment they
 * claim, and the writes go out under the Admin SDK in one transaction.
 *
 * PURE. No Firestore, no admin SDK, no clock. `index.js` reads, asks this what
 * to do, and writes. That keeps every rule in this file testable without an
 * emulator, which is the same split assignment-conversion.js already uses.
 *
 * ⚠ THE COVER ENTRY IS RESTATED HERE, NOT IMPORTED. `functions/` deploys as its
 * own bundle and cannot require from `public/`, so the id scheme and the entry
 * shape are written out twice — the same trade this file's neighbour already
 * makes with the assignment states. `test/assignment-answer.test.js` holds the
 * two definitions against each other, and that test is the only thing stopping
 * them drifting.
 */

// The occurrence model, copied into functions/shared by
// scripts/sync-shared-to-functions.js. The rung rule that decides whether a
// declined place may be listed has ONE definition, and this is how the server
// reaches it — restating it here was three copies of one rule.
const occurrences = require("./shared/events-occurrence-core.js");

const STATES = {
  PENDING: "pending",
  CONFIRMED: "confirmed",
  DECLINED: "declined",
};

/** The only answers a person can give. Pending is where they started. */
const ANSWERS = [STATES.CONFIRMED, STATES.DECLINED];

const refuse = (code, message) => ({ok: false, code, message});

const visibilityOf = occurrences.visibilityOf;
const belongsOnList = occurrences.canBeCovered;

/**
 * Deterministic, so declining, re-confirming and declining again cannot leave
 * two rows asking for the same place.
 * @param {string} occurrenceId the occurrence
 * @param {string} roleSlug the Role
 * @param {?string} slotId the slot, or null for a one-off
 * @return {string} the cover document id
 */
function coverId(occurrenceId, roleSlug, slotId) {
  return [occurrenceId, roleSlug, slotId || "one_off"].join("__");
}

/**
 * What one open place looks like on the cover list. Everything is denormalised
 * on purpose: a row must render without opening the occurrence, because the
 * reader may not be allowed to.
 *
 * It deliberately does NOT name who declined. The list's job is "this place
 * needs somebody", and the callable that hands the place over reads the roster
 * server-side where it has no such limit.
 * @param {object} occurrence the Event occurrence
 * @param {object} assignment the Assignment being given up
 * @param {?string} roleName the Role's human name
 * @return {object} the cover entry
 */
function coverEntry(occurrence, assignment, roleName) {
  const o = occurrence || {};
  const a = assignment || {};
  return {
    occurrenceId: o.id,
    seriesId: o.seriesId || null,
    date: o.date,
    eventName: o.name || o.seriesName || "Event",
    roleSlug: a.roleSlug || null,
    slotId: a.slotId || null,
    roleName: roleName || a.label || null,
    visibility: visibilityOf(o),
  };
}

/**
 * Everyone holding a place on this Event, which is what the `participant`
 * visibility rule reads.
 *
 * ⚠ A DECLINER STAYS IN IT. They keep the Event until somebody else takes the
 * slot, so they can watch it get covered and change their mind (ADR-0018 §5).
 * Someone an editor REMOVES leaves in the same write and loses sight instantly
 * — but that is the editor's path, not this one.
 * @param {Array<object>} roster every Assignment on the occurrence
 * @return {Array<string>} the Person ids
 */
function participantIdsOf(roster) {
  const seen = [];
  (roster || []).forEach((a) => {
    if (a && a.personId && seen.indexOf(a.personId) === -1) {
      seen.push(a.personId);
    }
  });
  return seen;
}

/**
 * Does anything on this Event need an editor's eye? One rule, so the calendar
 * cell, the chip, the card border and the banner cannot disagree.
 * @param {Array<object>} roster every Assignment on the occurrence
 * @return {boolean} whether one of them is declined
 */
function needsAttentionFor(roster) {
  return (roster || []).some((a) => a && a.state === STATES.DECLINED);
}

/**
 * Decide what one answer changes.
 *
 * @param {object} spec the question
 * @param {object} spec.occurrence the Event occurrence
 * @param {Array<object>} spec.roster every Assignment on it
 * @param {?string} spec.personId the caller's own Person id
 * @param {string} spec.roleSlug the Role they are answering for
 * @param {?string} spec.slotId the slot they are answering for
 * @param {string} spec.state their answer
 * @param {string} spec.today YYYY-MM-DD in the church's timezone
 * @param {?string} spec.roleName the Role's human name, for the cover row
 * @return {object} a refusal, or everything the transaction must write
 */
function planAnswer(spec) {
  const s = spec || {};
  const roster = s.roster || [];

  if (!s.personId) {
    return refuse("permission-denied", "Only a linked account can answer.");
  }
  if (ANSWERS.indexOf(s.state) === -1) {
    return refuse("invalid-argument", "An answer is either yes or no.");
  }

  // Strictly past. The day itself has not happened yet, and refusing an answer
  // on the morning somebody most needs to give it would be the wrong way round.
  const date = s.occurrence && s.occurrence.date;
  if (!date || !s.today || date < s.today) {
    return refuse("failed-precondition", "That date has already passed.");
  }

  const held = roster.find((a) =>
    a && a.roleSlug === s.roleSlug &&
    (a.slotId || null) === (s.slotId || null));

  if (!held) {
    return refuse("not-found", "Nobody is standing in that place.");
  }
  // Someone else's place. Refused rather than quietly applied — including when
  // an editor has moved it out from under them since the page was drawn.
  if (held.personId !== s.personId) {
    return refuse(
        "permission-denied", "That place is not yours to answer for.");
  }

  // ⚠ QUIET IS A PROPERTY OF THE ASSIGNMENT, NOT OF THE ANSWER (MS-213).
  // "I cannot do this" and "and I would rather the whole church were not told"
  // are separate things, and the second one outlives the first: it still holds
  // after the decliner has invited three people and been refused by all of
  // them, which is exactly when they want to change it.
  //
  // Confirming carries it forward untouched rather than clearing it. Somebody
  // who declines quietly, changes their mind, and changes it back should not
  // find their Event advertised to the church because of the round trip.
  const quiet = (s.quiet === undefined || s.quiet === null) ?
    (held.quiet === true) :
    (s.quiet === true);

  const assignment = Object.assign({}, held, {
    state: s.state,
    quiet: quiet,
    stateSetBy: s.personId,
    stateSetAt: s.now || null,
  });

  // The derived fields are computed from the roster AS IT WILL BE, never
  // patched from what it was. Recomputing is what stops them drifting.
  const after = roster.map((a) => (a === held ? assignment : a));

  const declined = s.state === STATES.DECLINED;
  // Two quite different reasons a place stays off the list, and both are
  // absolute. The RUNG is the church's (a participant-rung Event can reach
  // nobody who is not already in it); QUIET is the person's. Neither overrides
  // the other, so it is an `and`.
  const listable = belongsOnList(s.occurrence) && !quiet;
  const id = coverId(s.occurrence.id, s.roleSlug, s.slotId);
  let cover = {action: "none", id: id};
  if (declined && listable) {
    cover = {
      action: "set",
      id: cover.id,
      entry: coverEntry(s.occurrence, assignment, s.roleName),
    };
  } else {
    // Confirming takes the place off the list — and so does declining QUIETLY,
    // which is the path somebody takes when they open one and then change their
    // mind about advertising it. Unconditional: an entry that should not be
    // there is worth deleting twice, and deleting one that was never written
    // costs nothing.
    cover = {action: "delete", id: cover.id};
  }

  return {
    ok: true,
    rosterId: [s.roleSlug, s.slotId || "x", s.personId].join("__"),
    assignment: assignment,
    derived: {
      participantIds: participantIdsOf(after),
      needsAttention: needsAttentionFor(after),
      outForCover: occurrences.outForCover(
          Object.assign({}, s.occurrence, {assignments: after})),
    },
    cover: cover,
  };
}

module.exports = {
  STATES,
  ANSWERS,
  visibilityOf,
  belongsOnList,
  coverId,
  coverEntry,
  planAnswer,
};
