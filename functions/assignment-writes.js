/**
 * The Firestore half of answering and taking an Assignment (MS-20, MS-217).
 *
 * ⚠ WHY THIS IS ITS OWN FILE. Both callables split the same way: every DECISION
 * lives in a pure module (`assignment-answer.js`, `assignment-take.js`), well
 * tested without an emulator — and the WRITES lived inline in `index.js`,
 * tested by nothing. So the rules were guarded and the plumbing was not guarded
 * at all, which is the wrong way round: a rule that breaks throws, a
 * transaction that half-lands is silent.
 *
 * Everything here takes `db` as its first argument. That is the whole reason
 * the file exists — `admin.firestore()` reached for inside a callable cannot be
 * pointed at an emulator, so the writes could not be exercised. Given a handle,
 * `test/emulator/assignment-writes.test.js` runs them against real Firestore
 * semantics: real transactions, real retries, real contention.
 *
 * ⚠ THE THREE WRITES ARE ONE TRANSACTION. The roster row, the occurrence's
 * derived fields (`participantIds`, `needsAttention`, `outForCover`) and the
 * cover entry land together or not at all. Split up, the derived fields drift
 * from the roster they describe — and those are the fields the security rules
 * read, so the drift is not cosmetic.
 *
 * No clock and no `admin` import: `today` and `now` come in from the caller, so
 * a test can put the writes on any date it likes.
 */

const aa = require("./assignment-answer");
const at = require("./assignment-take");
const coverCore = require("./shared/cover-core.js");
const awayCore = require("./shared/away-core.js");

const OCCURRENCES = "event_occurrences";
// Where Event series live — the home of the Cross-Role Rules (MS-221).
const SERIES = "events";
const COVER = "cover";

/**
 * Did this fail because somebody else was writing the same place at the same
 * moment?
 *
 * ⚠ LOSING A RACE IS AN ANSWER, NOT A FAULT. A Firestore read-write transaction
 * takes locks, and two of them reaching for one slot can end with the loser
 * being told the transaction is closed rather than being retried — the Node SDK
 * does not classify that as transient, so it comes back as a raw gRPC error.
 * Left alone, the member who was half a second slower sees "Something went
 * wrong" instead of "somebody got there first", which is the one thing they
 * most need to be told.
 *
 * Deliberately narrow. Anything that is not contention still throws, because a
 * genuine fault quietly rendered as "try again" is how a broken write stays
 * broken for a month.
 *
 * Found by test/emulator/assignment-writes.test.js, which is the entire reason
 * that suite exists.
 *
 * @param {*} e whatever was thrown
 * @return {boolean} whether somebody else got there first
 */
function isContention(e) {
  if (!e) return false;
  if (e.code === 10) return true; // gRPC ABORTED — retries exhausted
  const text = String((e && e.details) || (e && e.message) || "");
  return text.indexOf("Transaction is invalid or closed") !== -1 ||
    text.indexOf("Too much contention") !== -1;
}

/**
 * Run a transaction, turning contention into a refusal the caller can render.
 * @param {Object} db the Firestore handle
 * @param {function} body the transaction
 * @param {string} message what to tell somebody who lost the race
 * @return {Promise<Object>} the plan, or a refusal
 */
function runOrLose(db, body, message) {
  return db.runTransaction(body).catch((e) => {
    if (!isContention(e)) throw e;
    return {ok: false, code: "aborted", message: message};
  });
}

/**
 * Everything the eligibility rules need about one Person and one Role, read
 * before the transaction opens. None of it is contended: the race is over who
 * holds the slot, and that is re-read inside.
 *
 * ⚠ EVERY INPUT HERE IS PART OF THE WALL. A rule whose data is missing does not
 * fail loudly — `candidatesFor` simply finds nothing to object to and waves the
 * person through. An empty `groups` list silently disables every group
 * restriction; an empty `awayPersonIds` silently forgets that somebody said
 * they would not be there. So each one is either genuinely loaded, or the Role
 * genuinely has no rule that reads it.
 *
 * @param {Object} db the Firestore handle
 * @param {?string} personId the caller's Person id, or null
 * @param {string} roleSlug the Role they want a place in
 * @param {string} date the occurrence's own date, which Away is judged on
 * @return {Promise<Object>} the person, the Role definition, and the rules
 */
/**
 * The Cross-Role Rules stored on an Event series (MS-221).
 *
 * A rule about a PAIR of Roles belongs to neither of them, so it lives on the
 * Event that runs both. A one-off Event has no series and therefore no rules,
 * which is right: the rule is a standing arrangement, not a decision about one
 * date.
 *
 * @param {Object} db the Firestore handle
 * @param {?string} seriesId the series the occurrence belongs to
 * @return {Promise<Array<Object>>} its cross-Role rules, or none
 */
async function seriesRules(db, seriesId) {
  if (!seriesId) return [];
  const snap = await db.collection(SERIES).doc(seriesId).get();
  if (!snap.exists) return [];
  const rules = snap.data().crossRoleRules;
  return Array.isArray(rules) ? rules : [];
}

async function takeContext(db, personId, roleSlug, date, seriesId) {
  const empty = {
    person: null, roleDef: null,
    relationships: [], groups: [], awayPersonIds: [], crossRoleRules: [],
  };
  if (!personId) return empty;

  const personSnap = await db.collection("people").doc(personId).get();
  if (!personSnap.exists) return empty;
  const person = Object.assign({id: personSnap.id}, personSnap.data());

  // ⚠ THE COLLECTION IS `roles`. Named wrongly, this query returns nothing,
  // roleDef is null, and every Role rule silently stops being checked — the
  // eligibility wall would permit anything while looking like it worked.
  const roleSnap = await db.collection("roles")
      .where("slug", "==", roleSlug).limit(1).get();
  const roleDef = roleSnap.empty ? null :
    Object.assign({id: roleSnap.docs[0].id}, roleSnap.docs[0].data());

  // ⚠ The Event's rules about a PAIR of Roles (MS-221). They live on the
  // SERIES, not on either Role, so a Role whose own definition has no group
  // rule can still be constrained by one — which is exactly why `wantsGroups`
  // below has to ask about these too. Miss that and the groups list arrives
  // empty, `sharedGroups` finds nothing, and the rule silently permits
  // everything a member asks for while the editor's picker refuses it.
  const crossRoleRules = (await seriesRules(db, seriesId))
      .filter((r) => ((r && r.roleSlugs) || []).indexOf(roleSlug) !== -1);

  const restrictions = (roleDef && roleDef.restrictions) || [];
  const kinds = restrictions.map((r) => r && r.kind);
  const wantsEdges = kinds.indexOf("notTogether") !== -1;
  const wantsGroups = kinds.indexOf("sameGroup") !== -1 ||
    kinds.indexOf("notSameGroup") !== -1 ||
    crossRoleRules.length > 0;

  // Away is judged on the occurrence's own date — being away on the 16th says
  // nothing about the 23rd. Their own Away does not refuse them (ADR-0030 §3),
  // but cover-core still has to SEE it to warn them about it.
  const awaySnap = await db.collection("people").doc(personId)
      .collection("away").get();
  const stretches = awaySnap.docs.map((d) => d.data());
  const awayPersonIds = awayCore.isAwayOn(stretches, date) ? [personId] : [];

  // Firestore cannot express "fromId == me OR toId == me" in one query, so an
  // edge is looked for from both ends and merged.
  const relationships = [];
  if (wantsEdges) {
    const [out, back] = await Promise.all([
      db.collection("relationships").where("fromId", "==", personId).get(),
      db.collection("relationships").where("toId", "==", personId).get(),
    ]);
    const seen = new Set();
    [].concat(out.docs, back.docs).forEach((d) => {
      if (seen.has(d.id)) return;
      seen.add(d.id);
      relationships.push(Object.assign({id: d.id}, d.data()));
    });
  }

  // A Group's leader is deliberately NOT inside memberIds (ADR-0014 §5), so
  // leading one has to be asked for separately or a leader would read as
  // belonging to no group at all.
  const groups = [];
  if (wantsGroups) {
    const [asMember, asLeader] = await Promise.all([
      db.collection("relationship_groups")
          .where("memberIds", "array-contains", personId).get(),
      db.collection("relationship_groups")
          .where("leaderId", "==", personId).get(),
    ]);
    const seen = new Set();
    [].concat(asMember.docs, asLeader.docs).forEach((d) => {
      if (seen.has(d.id)) return;
      seen.add(d.id);
      groups.push(Object.assign({id: d.id}, d.data()));
    });
  }

  return {
    person: person,
    roleDef: roleDef,
    relationships: relationships,
    groups: groups,
    awayPersonIds: awayPersonIds,
    crossRoleRules: crossRoleRules,
  };
}

/**
 * Write one member's answer to their own Assignment.
 *
 * The roster is a subcollection, not a field — Firestore cannot hide a field
 * from a reader, so that is where the Assignments live. It is read INSIDE the
 * transaction, so a concurrent editor reassignment loses the race rather than
 * being silently overwritten by it.
 *
 * @param {Object} db the Firestore handle
 * @param {Object} spec what is being answered
 * @param {?string} spec.personId the caller's own Person id
 * @param {string} spec.occurrenceId the occurrence
 * @param {string} spec.roleSlug the Role being answered for
 * @param {?string} spec.slotId its slot
 * @param {string} spec.state the answer — confirmed or declined
 * @param {string} spec.today YYYY-MM-DD in the church's timezone
 * @param {*} spec.now a timestamp to stamp the answer with
 * @return {Promise<Object>} the plan that was written, or a refusal
 */
async function answer(db, spec) {
  const s = spec || {};
  const occurrenceRef = db.collection(OCCURRENCES).doc(s.occurrenceId);
  const rosterCol = occurrenceRef.collection("roster");

  return runOrLose(db, async (tx) => {
    const occSnap = await tx.get(occurrenceRef);
    if (!occSnap.exists) {
      return {ok: false, code: "not-found", message: "That Event has gone."};
    }
    const occurrence = Object.assign({id: occSnap.id}, occSnap.data());

    const rosterSnap = await tx.get(rosterCol);
    const roster = rosterSnap.docs.map((d) => d.data());

    // `roleName` is deliberately not passed through from the caller.
    // RolesCore.roleBySlug is the one way a slug becomes a human name and it
    // lives in the browser; letting a caller send one up would put arbitrary
    // text on other people's screens. A one-off Role carries its own label on
    // the Assignment, and that is what gets used.
    const plan = aa.planAnswer({
      occurrence: occurrence,
      roster: roster,
      personId: s.personId,
      roleSlug: s.roleSlug,
      slotId: s.slotId || null,
      state: s.state,
      // Whether this one goes on the open list, or stays between the decliner
      // and the people they ask (MS-213). Absent means "leave it as it was" —
      // confirming must not quietly re-advertise something.
      quiet: s.quiet,
      today: s.today,
      now: s.now || null,
    });
    if (!plan.ok) return plan;

    tx.set(rosterCol.doc(plan.rosterId), plan.assignment, {merge: true});
    tx.update(occurrenceRef, {
      participantIds: plan.derived.participantIds,
      needsAttention: plan.derived.needsAttention,
      outForCover: plan.derived.outForCover,
    });

    const coverRef = db.collection(COVER).doc(plan.cover.id);
    if (plan.cover.action === "set") {
      tx.set(coverRef, plan.cover.entry);
    } else if (plan.cover.action === "delete") {
      // Unconditional. An entry that should not be there is worth deleting
      // twice, and deleting one that was never written costs nothing.
      tx.delete(coverRef);
    }

    return plan;
  }, "Somebody was changing that at the same moment. Try again.");
}

/**
 * Hand one open place to the member taking it.
 *
 * ⚠ THE PLACE CHANGES HANDS AS A DELETE PLUS A CREATE. A roster row's id
 * carries the personId, so the old row is a different document from the new one
 * and would otherwise simply remain — two people standing in one slot, with
 * `participantIds` honestly listing both.
 *
 * Nothing is reserved while somebody reads the cover list. Two people can press
 * Take in the same second, and an editor can refill the place from the Roles
 * tab while they do. The transaction re-reads and `planTake` decides, so the
 * loser is told plainly rather than overwriting whoever got there first.
 *
 * @param {Object} db the Firestore handle
 * @param {Object} spec what is being taken
 * @param {?string} spec.personId the taker's own Person id
 * @param {?string} spec.rank the taker's permission level
 * @param {string} spec.occurrenceId the occurrence
 * @param {string} spec.roleSlug the Role of the place
 * @param {?string} spec.slotId its slot
 * @param {string} spec.today YYYY-MM-DD in the church's timezone
 * @param {*} spec.now a timestamp to stamp the new Assignment with
 * @return {Promise<Object>} the plan that was written, or a refusal
 */
async function take(db, spec) {
  const s = spec || {};
  const occurrenceRef = db.collection(OCCURRENCES).doc(s.occurrenceId);
  const rosterCol = occurrenceRef.collection("roster");

  // Read outside the transaction: the Person, the Role, and everything the
  // eligibility rules need. None of it is what the race is about — the race is
  // over who holds the slot, and that is re-read inside.
  //
  // The date has to come off the DOCUMENT, not off the id. A series' occurrence
  // id ends in its date, but a one-off Event's is an auto-id (ADR-0018 §3) —
  // deriving the date from the id would judge Away against ten characters of
  // random string on every one-off.
  const dateSnap = await occurrenceRef.get();
  if (!dateSnap.exists) {
    return {ok: false, code: "not-found", message: "That Event has gone."};
  }
  const context = await takeContext(
      db, s.personId, s.roleSlug, dateSnap.data().date,
      dateSnap.data().seriesId);

  return runOrLose(db, async (tx) => {
    const occSnap = await tx.get(occurrenceRef);
    if (!occSnap.exists) {
      return {ok: false, code: "not-found", message: "That Event has gone."};
    }
    const occurrence = Object.assign({id: occSnap.id}, occSnap.data());

    const rosterSnap = await tx.get(rosterCol);
    const roster = rosterSnap.docs.map((d) => d.data());

    const slot = (context.roleDef && (context.roleDef.slots || [])
        .find((sl) => sl.id === (s.slotId || null))) || null;

    const verdict = coverCore.verdictFor({
      rank: s.rank,
      person: context.person,
      occurrence: occurrence,
      roleDef: context.roleDef,
      slot: slot,
      context: {
        people: context.person ? [context.person] : [],
        relationships: context.relationships,
        groups: context.groups,
        awayPersonIds: context.awayPersonIds,
        assigned: roster.filter((a) => a.roleSlug === s.roleSlug)
            .map((a) => ({slotId: a.slotId, personId: a.personId})),
        assignedElsewhere: roster.filter((a) => a.roleSlug !== s.roleSlug)
            .map((a) => ({
              personId: a.personId,
              roleSlug: a.roleSlug,
              allowsAnotherRole: false,
            })),
        crossRoleRules: context.crossRoleRules,
      },
    });

    const plan = at.planTake({
      occurrence: occurrence,
      roster: roster,
      personId: s.personId,
      roleSlug: s.roleSlug,
      slotId: s.slotId || null,
      verdict: verdict,
      today: s.today,
      now: s.now || null,
    });
    if (!plan.ok) return plan;

    // Delete then create — the id carries the person, so these are two
    // different documents.
    tx.delete(rosterCol.doc(plan.removeRosterId));
    tx.set(rosterCol.doc(plan.rosterId), plan.assignment);
    tx.update(occurrenceRef, {
      participantIds: plan.derived.participantIds,
      needsAttention: plan.derived.needsAttention,
      outForCover: plan.derived.outForCover,
    });
    tx.delete(db.collection(COVER).doc(plan.cover.id));

    return plan;
  }, "Somebody has already sorted that one out.");
}

module.exports = {
  OCCURRENCES,
  COVER,
  takeContext,
  answer,
  take,
};
