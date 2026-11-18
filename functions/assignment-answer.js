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
 * The place's identity, its cover entry and the occurrence's derived fields are
 * PlaceCore's (public/place-core.js, synced into functions/shared). They used
 * to be restated here, in assignment-take.js, in trade-writes.js and in the
 * browser, and the copies disagreed about one-off jobs.
 */

// The occurrence model, copied into functions/shared by
// scripts/sync-shared-to-functions.js. The rung rule that decides whether a
// declined place may be listed has ONE definition, and this is how the server
// reaches it — restating it here was three copies of one rule.
const occurrences = require("./shared/events-occurrence-core.js");
const place = require("./shared/place-core.js");

const STATES = place.STATES;

/** The only answers a person can give. Pending is where they started. */
const ANSWERS = [STATES.CONFIRMED, STATES.DECLINED];

const refuse = (code, message) => ({ok: false, code, message});

const visibilityOf = occurrences.visibilityOf;
const belongsOnList = occurrences.canBeCovered;

/**
 * Decide what one answer changes.
 *
 * @param {object} spec the question
 * @param {object} spec.occurrence the Event occurrence
 * @param {Array<Object<string, *>>} spec.roster every Assignment on it
 * @param {?string} spec.personId the caller's own Person id
 * @param {string} spec.roleSlug the Role they are answering for
 * @param {?string} spec.slotId the slot they are answering for
 * @param {?string} [spec.oneOffId] which one-off job, when it is one (MS-818)
 * @param {string} spec.state their answer
 * @param {boolean} [spec.quiet] whether a decline stays off the open list
 * @param {string} spec.today YYYY-MM-DD in the church's timezone
 * @param {*} [spec.now] a timestamp to stamp the answer with
 * @param {?string} spec.roleName the Role's human name, for the cover row
 * @return {Object<string, *>} a refusal, or everything the transaction must
 *   write
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
  // A cancelled or moved date is not happening on this day. Its roster is
  // kept (so un-cancelling restores it), but a place on it cannot be
  // answered or taken — the same gate the nudge job reads.
  if (occurrences.notHappening(s.occurrence)) {
    return refuse("failed-precondition", "That date is not happening.");
  }

  // ⚠ ONE-OFF JOBS SHARE A SLUG AND HAVE NO SLOT (MS-818). Every one-off on an
  // Event is `one_off` with a null slot, so slug and slot alone found the FIRST
  // one-off, whoever's it was. The one-off's own id tells them apart; a caller
  // that does not send one (an older page) still finds their own, because the
  // caller's row is preferred over anybody else's.
  const candidates = roster.filter((a) => place.samePlace(a, s));
  const held = candidates.find((a) => a.personId === s.personId) ||
    candidates[0];

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

  // Off the list unless it is declined, not quiet, and on an Event whose rung
  // can reach anybody (PlaceCore.isListed). Confirming takes it off, and so
  // does declining QUIETLY. The delete is unconditional: an entry that should
  // not be there is worth deleting twice.
  const id = place.coverIdFor(s.occurrence.id, held);
  const cover = place.isListed(s.occurrence, assignment) ?
    {action: "set", id: id,
      entry: place.coverEntryFor(s.occurrence, assignment, s.roleName)} :
    {action: "delete", id: id};

  return {
    ok: true,
    // The row is written back where it is filed, never under an id built from
    // the request (MS-818): that id ignored the one-off's own id, so answering
    // one wrote a second copy beside it.
    rosterId: place.rosterIdFor(held),
    held: held,
    assignment: assignment,
    derived: place.derivedFields(s.occurrence, after),
    cover: cover,
  };
}

module.exports = {
  STATES,
  ANSWERS,
  visibilityOf,
  belongsOnList,
  planAnswer,
};
