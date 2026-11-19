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
const place = require("./shared/place-core.js");
const {loadRoleRegistry} = require("./roles-read");
const eventsCore = require("./shared/events-core.js");
const rolesCore = require("./shared/roles-core.js");

/** @typedef {import("firebase-admin/firestore").Firestore} Firestore */

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
 * Make the cover list for one occurrence say what is true of it NOW.
 *
 * ⚠ THE COVER LIST IS A DERIVED VIEW. It is what PlaceCore.desiredCover says
 * the occurrence and its roster produce, and this is the only thing that
 * keeps it so. It used to be written by the doors that settle a place and
 * swept, delete-only, by the roster trigger — so nothing put a moved date's
 * declined places back on it, nothing took a cancelled date's off it, and
 * nothing re-stamped an entry when its Event was made more private (the rule
 * reads the entry's OWN `visibility`, so a stale stamp is a stale disclosure).
 *
 * Now both triggers — a roster row written, or the occurrence itself written —
 * reconcile the whole occurrence. The doors that answer, take, settle and
 * change reach still write their own entry in their own transaction, so the
 * list is right the moment they return; this is what makes it right whatever
 * door the change came through.
 *
 * Read again inside a transaction, never trusted from the trigger's copy:
 * triggers arrive late and out of order (MS-819). Writes only what differs, so
 * a reconcile that finds the list right writes nothing.
 *
 * @param {Firestore} db the Firestore handle
 * @param {string} occurrenceId the occurrence
 * @param {Object} [opts]
 * @param {function(string): ?string} [opts.roleNameOf] slug → Role name;
 *   read from /roles when not given
 * @param {boolean} [opts.dryRun] work out the changes and write nothing
 * @return {Promise<{set: Array<*>, remove: Array<string>}>} what changed
 */
async function reconcileCover(db, occurrenceId, opts) {
  const o = opts || {};
  const roleNameOf = o.roleNameOf || (await loadRoleRegistry(db)).nameOf;
  const occurrenceRef = db.collection(OCCURRENCES).doc(occurrenceId);
  const listed = db.collection(COVER).where("occurrenceId", "==", occurrenceId);

  return db.runTransaction(async (tx) => {
    const occSnap = await tx.get(occurrenceRef);
    const existing = await tx.get(listed);
    let desired = {};
    if (occSnap.exists) {
      const rosterSnap = await tx.get(occurrenceRef.collection("roster"));
      desired = place.desiredCover(
          Object.assign({id: occSnap.id}, occSnap.data()),
          rosterSnap.docs.map((d) => d.data()),
          roleNameOf);
    }
    const changes = place.coverChanges(
        existing.docs.map((d) => ({id: d.id, data: d.data()})), desired);
    if (o.dryRun) return changes;
    changes.set.forEach((c) => tx.set(db.collection(COVER).doc(c.id), c.entry));
    changes.remove.forEach((id) => tx.delete(db.collection(COVER).doc(id)));
    return changes;
  });
}

/**
 * The people already on an occurrence's roster — loaded only when one of the
 * rules judges a line-up, since a line-up has to know who is on the team and
 * the take itself only ever loads the one person taking.
 * @param {Object} db the Firestore handle
 * @param {Array<Object>} roster the occurrence's assignments
 * @param {Object} context what takeContext returned
 * @return {Promise<Array<Object>>} their Person records
 */
async function rosterPeople(db, roster, context) {
  const rules = ((context.roleDef && context.roleDef.restrictions) || [])
      .concat(context.crossRoleRules || []);
  if (!rolesCore.judgesLineups(rules)) return [];
  const ids = [...new Set((roster || []).map((a) => a.personId).filter(Boolean))];
  if (!ids.length) return [];
  const snaps = await db.getAll(...ids.map((id) => db.collection("people").doc(id)));
  return snaps.filter((d) => d.exists)
      .map((d) => Object.assign({id: d.id}, d.data()));
}

/**
 * The Event series an occurrence belongs to, or null for a one-off Event.
 * @param {Object} db the Firestore handle
 * @param {?string} seriesId the series id
 * @return {Promise<?Object>} the series document's data
 */
async function loadSeries(db, seriesId) {
  if (!seriesId) return null;
  const snap = await db.collection(SERIES).doc(seriesId).get();
  return snap.exists ? Object.assign({id: snap.id}, snap.data()) : null;
}

/**
 * Loads the person, Role, relationships, groups, Away and Cross-Role
 * Rules an eligibility check needs for one Assignment.
 * @param {Object} db the Firestore handle
 * @param {string} personId who is being considered
 * @param {string} roleSlug the Role they would take
 * @param {string} date the occurrence date (YYYY-MM-DD)
 * @param {?string} seriesId the series the occurrence belongs to
 * @return {Promise<Object>} person, roleDef, relationships, groups,
 *   awayPersonIds, crossRoleRules
 */
async function takeContext(db, personId, roleSlug, date, seriesId) {
  const empty = {
    person: null, roleDef: null,
    relationships: [], groups: [], awayPersonIds: [], crossRoleRules: [],
  };
  if (!personId) return empty;

  const personSnap = await db.collection("people").doc(personId).get();
  if (!personSnap.exists) return empty;
  const person = Object.assign({id: personSnap.id}, personSnap.data());

  // ⚠ ONE RESOLVER (roles-read.js). A Role stored without a slug still
  // resolves, and one whose slug another definition shares resolves to
  // nothing — so the take is refused as a gone Role rather than judged
  // against whichever of the two came back first.
  //
  // Who the Role needs, its rules and its rest belong to the EVENT that runs
  // it, so the stored Role is read through this series' version of it
  // (EventsCore.effectiveRole) — the same answer the editor's picker gets.
  const series = await loadSeries(db, seriesId);
  const roleDef = eventsCore.effectiveRole(
      series, (await loadRoleRegistry(db)).find(roleSlug));

  // ⚠ The Event's rules about a PAIR of Roles (MS-221). They live on the
  // SERIES, not on either Role, so a Role whose own definition has no group
  // rule can still be constrained by one — which is exactly why `wantsGroups`
  // below has to ask about these too. Miss that and the groups list arrives
  // empty, `sharedGroups` finds nothing, and the rule silently permits
  // everything a member asks for while the editor's picker refuses it.
  const crossRoleRules = eventsCore.crossRoleRulesOf(series)
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
 * @param {?string} [spec.oneOffId] which one-off job, when it is one
 * @param {string} spec.state the answer — confirmed or declined
 * @param {boolean} [spec.quiet] whether a decline stays off the open list;
 *   absent leaves it as it was
 * @param {string} spec.today YYYY-MM-DD in the church's timezone
 * @param {*} spec.now a timestamp to stamp the answer with
 * @return {Promise<Object>} the plan that was written, or a refusal
 */
async function answer(db, spec) {
  const s = Object.assign({}, spec || {});
  if (s.roleSlug && s.roleSlug !== place.ONE_OFF_SLUG) {
    s.roleName = (await loadRoleRegistry(db)).nameOf(s.roleSlug);
  }
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

    // `roleName` is never taken from the caller — that would put arbitrary
    // text on other people's screens. It is resolved here, from /roles, the
    // same way the reconcile names an entry; a one-off names itself.
    const plan = aa.planAnswer({
      occurrence: occurrence,
      roster: roster,
      personId: s.personId,
      roleSlug: s.roleSlug,
      slotId: s.slotId || null,
      oneOffId: s.oneOffId || null,
      state: s.state,
      // Whether this one goes on the open list, or stays between the decliner
      // and the people they ask (MS-213). Absent means "leave it as it was" —
      // confirming must not quietly re-advertise something.
      quiet: s.quiet,
      today: s.today,
      now: s.now || null,
      roleName: s.roleName || null,
    });
    if (!plan.ok) return plan;

    // Back onto the document the row was read from (MS-818), which for a row
    // filed under an older id is not the id the plan would build.
    const at = roster.indexOf(plan.held);
    const filedAs = at === -1 ? plan.rosterId : rosterSnap.docs[at].id;
    delete plan.held;
    tx.set(rosterCol.doc(filedAs), plan.assignment, {merge: true});
    tx.update(occurrenceRef, plan.derived);

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
 * @param {?string} [spec.oneOffId] which one-off job, when it is one
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
      roleSlug: s.roleSlug,
      roleDef: context.roleDef,
      slot: slot,
      context: {
        people: context.person ? [context.person] : [],
        knownPeople: await rosterPeople(db, roster, context),
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
      oneOffId: s.oneOffId || null,
      verdict: verdict,
      today: s.today,
      now: s.now || null,
    });
    if (!plan.ok) return plan;

    // Delete then create — the id carries the person, so these are two
    // different documents.
    tx.delete(rosterCol.doc(plan.removeRosterId));
    tx.set(rosterCol.doc(plan.rosterId), plan.assignment);
    tx.update(occurrenceRef, plan.derived);
    tx.delete(db.collection(COVER).doc(plan.cover.id));

    // What the decliner's "taken" text names (outside the race; only words).
    /** @type {*} */
    const told = plan;
    /** @type {*} */
    const ctx = context;
    told.date = occurrence.date || null;
    told.roleName = told.assignment.roleSlug === place.ONE_OFF_SLUG ?
      (told.assignment.label || "job") :
      ((ctx.roleDef && ctx.roleDef.name) || s.roleSlug);
    return told;
  }, "Somebody has already sorted that one out.");
}

module.exports = {
  OCCURRENCES,
  COVER,
  takeContext,
  rosterPeople,
  reconcileCover,
  answer,
  take,
};
