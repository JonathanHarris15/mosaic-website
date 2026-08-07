/**
 * A member taking an Assignment off the cover list (MS-20, ADR-0030).
 *
 * ⚠ THE ELIGIBILITY VERDICT IS AN INPUT. Whether this Person MAY take this
 * place is `cover-core`'s question, and answering it needs the whole of
 * RolesCore. This module answers the separate question of what the WRITE looks
 * like once the verdict is known — and that is where the race lives.
 *
 * A missing verdict is a refusal. It never defaults to yes: an eligibility
 * check that silently passes when the wiring breaks is worse than one that was
 * never there, because it looks like it worked.
 *
 * ⚠ A ROSTER ROW'S ID CONTAINS THE personId. It is built as
 * `{roleSlug}__{slotId}__{personId}` in events-store.js, so a place changing
 * hands is a DELETE plus a CREATE,
 * never an update. Treating it as an update leaves two people standing in one
 * slot, and the derived fields would agree with both of them.
 *
 * ⚠ NOTHING IS RESERVED while somebody is looking at the cover list. Two people
 * can press Take in the same second, and an editor can refill the place from
 * the Roles tab while they do. The transaction re-reads the roster and this
 * decides — the loser gets a clean, explained refusal rather than silence. A
 * lock would be worse than the race: a place held by an offer somebody forgot
 * about is a place nobody can fill.
 *
 * PURE. No Firestore, no admin SDK, no clock.
 */

const STATES = {
  PENDING: "pending",
  CONFIRMED: "confirmed",
  DECLINED: "declined",
};

const refuse = (code, message, extra) =>
  Object.assign({ok: false, code, message}, extra || {});

/**
 * The roster document id for one Assignment. Restated from events-store.js,
 * which owns it; `test/assignment-take.test.js` pins the shape.
 * @param {object} assignment the Assignment
 * @return {string} its roster document id
 */
function rosterIdFor(assignment) {
  const a = assignment || {};
  return [
    a.roleSlug,
    a.oneOffId || a.slotId || "x",
    a.personId,
  ].join("__");
}

/**
 * Deterministic cover document id — must match `coverId` in
 * assignment-answer.js and cover-store.js.
 * @param {string} occurrenceId the occurrence
 * @param {string} roleSlug the Role
 * @param {?string} slotId the slot, or null for a one-off
 * @return {string} the cover document id
 */
function coverId(occurrenceId, roleSlug, slotId) {
  return [occurrenceId, roleSlug, slotId || "one_off"].join("__");
}

/**
 * Everyone holding a place on this Event, which is what the `participant`
 * visibility rule reads.
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
 * Does anything on this Event still need an editor's eye?
 * @param {Array<object>} roster every Assignment on the occurrence
 * @return {boolean} whether one of them is declined
 */
function needsAttentionFor(roster) {
  return (roster || []).some((a) => a && a.state === STATES.DECLINED);
}

/**
 * Decide what taking one open place changes.
 *
 * @param {object} spec the question
 * @param {object} spec.occurrence the Event occurrence
 * @param {Array<object>} spec.roster every Assignment on it, freshly read
 * @param {?string} spec.personId the taker's own Person id
 * @param {string} spec.roleSlug the Role of the place being taken
 * @param {?string} spec.slotId its slot
 * @param {?object} spec.verdict cover-core's answer for this Person
 * @param {string} spec.today YYYY-MM-DD in the church's timezone
 * @param {*} spec.now a timestamp to stamp the new Assignment with
 * @return {object} a refusal, or everything the transaction must write
 */
function planTake(spec) {
  const s = spec || {};
  const roster = s.roster || [];

  if (!s.personId) {
    return refuse(
        "permission-denied", "Only a linked account can take a place.");
  }

  // A missing verdict is a no. Never a default yes.
  if (!s.verdict || s.verdict.permitted !== true) {
    return refuse(
        "failed-precondition",
        (s.verdict && s.verdict.message) ||
          "That place is not one you can take.",
        {reason: (s.verdict && s.verdict.reason) || null});
  }

  const date = s.occurrence && s.occurrence.date;
  if (!date || !s.today || date < s.today) {
    return refuse("failed-precondition", "That date has already passed.");
  }

  const held = roster.find((a) =>
    a && a.roleSlug === s.roleSlug &&
    (a.slotId || null) === (s.slotId || null));

  if (!held) {
    return refuse("not-found", "That place is no longer on the Event.");
  }

  // ⚠ THE RACE. Between the list being drawn and Take being pressed, somebody
  // else may have taken it or an editor may have refilled it. Either way the
  // place is not going spare any more, and the honest answer is to say so
  // rather than to overwrite whoever is now standing in it.
  if (held.state !== STATES.DECLINED) {
    return refuse("aborted", "Somebody has already sorted that one out.");
  }
  if (held.personId === s.personId) {
    return refuse(
        "failed-precondition",
        "That place is already yours — confirm it rather than taking it.");
  }

  // The place keeps everything about itself; only the person changes. The old
  // holder's answer does not survive onto the new row, and does not need to:
  // a refilled slot keeps no record of who declined (ADR-0018 §5).
  const assignment = Object.assign({}, held, {
    personId: s.personId,
    state: STATES.CONFIRMED,
    stateSetBy: s.personId,
    stateSetAt: s.now || null,
  });

  const after = roster.map((a) => (a === held ? assignment : a));

  return {
    ok: true,
    // Delete first, then create. The id carries the person, so these are two
    // different documents and the old one would otherwise simply remain.
    removeRosterId: rosterIdFor(held),
    rosterId: rosterIdFor(assignment),
    assignment: assignment,
    derived: {
      participantIds: participantIdsOf(after),
      needsAttention: needsAttentionFor(after),
    },
    cover: {
      action: "delete",
      id: coverId(s.occurrence.id, s.roleSlug, s.slotId),
    },
    // They marked themselves Away on this date and took it anyway. Permitted —
    // overruling your own stated plans is changing your mind (ADR-0030 §3) —
    // but they should be told what they just did.
    warning: s.verdict.warning || null,
  };
}

module.exports = {
  STATES,
  rosterIdFor,
  coverId,
  planTake,
};
