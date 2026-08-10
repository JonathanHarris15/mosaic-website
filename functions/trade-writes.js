/**
 * The Firestore half of every way a Trade moves (MS-190, MS-211).
 *
 * Five moves: invite somebody, withdraw an invitation, refuse (available at
 * both ends), offer (the reply, carrying your own Assignments), and accept,
 * which settles it. `trade-core.js` decides which are legal and whether a
 * settlement still stands; this reads, asks, and writes.
 *
 * Same split, and the same reason, as assignment-writes.js: everything takes
 * `db` rather than reaching for one, so test/emulator/ can drive the
 * transactions against real Firestore semantics. That is not a style
 * preference — MS-217 found a bug in the first hour of being able to do it.
 *
 * ⚠ ACCEPT IS THE ONE WITH TEETH. It moves two people's Assignments, two
 * occurrences' derived fields and a cover entry, and kills every competing
 * Trade — in ONE transaction. Half of that landing leaves two people believing
 * they hold the same Saturday, and the derived fields are what the security
 * rules read, so the drift is not cosmetic.
 *
 * ⚠ ELIGIBILITY IS CHECKED ON BOTH SIDES (ADR-0030). The person taking the
 * declined Assignment AND the person receiving whatever came back. Checking one
 * end would let a legal-looking swap seat somebody the Role refuses.
 *
 * ⚠ VISIBILITY IS ABSOLUTE, AND IT IS THE ONE THAT LEAKS. Taking an Assignment
 * writes you into `participantIds`, which is what grants sight of the Event. So
 * an offer may only name Assignments the OTHER party can already see, and
 * somebody may only be invited to an Assignment THEY can already see. Without
 * both, a member could hand a stranger a view of the elders' diary by offering
 * them a place in it.
 */

const tradeCore = require("./shared/trade-core.js");
const coverCore = require("./shared/cover-core.js");
const occurrences = require("./shared/events-occurrence-core.js");
const aw = require("./assignment-writes");

const TRADES = "trades";
const OCCURRENCES = "event_occurrences";
const COVER = "cover";

const STATES = {
  PENDING: "pending",
  CONFIRMED: "confirmed",
  DECLINED: "declined",
};

const refuse = (code, message, reason) =>
  ({ok: false, code: code, message: message, reason: reason || null});

/**
 * How a trade-core reason reads to whoever is being refused, and with what
 * HttpsError code. A reason with no entry here is still refused — it simply
 * gets the general wording, which is the right way round for a fail-closed
 * default.
 */
const WORDING = {
  notYours: ["permission-denied", "That one is not yours to answer."],
  yourself: ["failed-precondition", "You cannot trade with yourself."],
  over: ["failed-precondition", "That conversation has already ended."],
  datePassed: ["failed-precondition", "That date has already passed."],
  capReached: ["failed-precondition",
    "You have already asked three people. Wait, or withdraw one."],
  alreadyAsked: ["failed-precondition", "You have already asked them."],
  nothingOffered: ["invalid-argument",
    "Offer something of your own, or simply take it from the cover list."],
  notOffered: ["failed-precondition", "That one was not offered."],
  coveredMoved: ["aborted", "Somebody has already sorted that one out."],
  coveredTaken: ["aborted", "They have taken that one back."],
  offeredMoved: ["aborted", "That one is no longer theirs to give."],
  offeredDeclined: ["aborted",
    "That one is looking for cover itself now."],
  unknownAction: ["invalid-argument", "That is not something you can do."],
};

/**
 * Turn a trade-core reason into a refusal a surface can render.
 * @param {string} reason the machine reason
 * @return {object} the refusal
 */
function refusalFor(reason) {
  const said = WORDING[reason] ||
    ["failed-precondition", "That is not something you can do."];
  return refuse(said[0], said[1], reason);
}

/**
 * Contention, told plainly — the same bargain assignment-writes.js strikes, and
 * for the same reason. Losing a race is an answer, not a fault.
 * @param {Object} db the Firestore handle
 * @param {function} body the transaction
 * @param {string} message what to tell somebody who lost it
 * @return {Promise<Object>} the result, or a refusal
 */
function runOrLose(db, body, message) {
  return db.runTransaction(body).catch((e) => {
    const text = String((e && e.details) || (e && e.message) || "");
    const contention = (e && e.code === 10) ||
      text.indexOf("Transaction is invalid or closed") !== -1 ||
      text.indexOf("Too much contention") !== -1;
    if (!contention) throw e;
    return refuse("aborted", message);
  });
}

// ── Reading the world ───────────────────────────────────────────────────────

/**
 * One Assignment as it actually stands: who holds it and in what state.
 * @param {Object} tx the transaction
 * @param {Object} db the Firestore handle
 * @param {Object} ref the Assignment reference
 * @return {Promise<?Object>} {personId, state} or null if it has gone
 */
async function readAssignment(tx, db, ref) {
  const occRef = db.collection(OCCURRENCES).doc(ref.occurrenceId);
  // ⚠ THE OCCURRENCE ITSELF, NOT JUST THE ROSTER. `outForCover` is a question
  // about the Event's RUNG as much as its roster, and rebuilding the derived
  // fields without it would stamp every Event as coverable.
  const [occSnap, rosterSnap] = await Promise.all([
    tx.get(occRef),
    tx.get(occRef.collection("roster")),
  ]);
  if (!occSnap.exists) return null;

  const rows = rosterSnap.docs.map((d) => d.data());
  const held = rows.find((a) =>
    a && a.roleSlug === ref.roleSlug &&
    (a.slotId || null) === (ref.slotId || null));
  if (!held) return null;
  return {
    personId: held.personId,
    state: held.state || STATES.PENDING,
    row: held,
    roster: rows,
    occurrence: Object.assign({id: occSnap.id}, occSnap.data()),
  };
}

/**
 * The permission level of somebody who is not the caller. Needed because
 * visibility is judged for BOTH parties, and only one of them is on the phone.
 * @param {Object} db the Firestore handle
 * @param {string} personId whose rank
 * @return {Promise<?string>} their rank, or null
 */
async function rankOf(db, personId) {
  if (!personId) return null;
  const snap = await db.collection("users")
      .where("personId", "==", personId).limit(1).get();
  if (snap.empty) return null;
  const user = snap.docs[0].data();
  return user.permissionLevel || user.role || null;
}

/**
 * May this Person even SEE this Event? Asked before anything else, because
 * somebody refused at the rung must learn nothing about what is behind it —
 * not the Role, not the date, not that it exists.
 * @param {Object} db the Firestore handle
 * @param {string} personId who is looking
 * @param {string} occurrenceId what at
 * @return {Promise<boolean>} whether they may see it
 */
async function canSee(db, personId, occurrenceId) {
  const snap = await db.collection(OCCURRENCES).doc(occurrenceId).get();
  if (!snap.exists) return false;
  const occurrence = Object.assign({id: snap.id}, snap.data());
  const rank = await rankOf(db, personId);
  return occurrences.canSee(rank, occurrence, personId);
}

/**
 * Whether this Person may be seated in this place, by the Role's own rules.
 *
 * ⚠ A MISSING VERDICT IS A REFUSAL, never a default yes. An eligibility check
 * that silently passes when its wiring breaks is worse than one that was never
 * written, because it looks like it worked.
 *
 * @param {Object} db the Firestore handle
 * @param {string} personId who
 * @param {Object} ref the Assignment they would take
 * @param {Array<Object>} roster the Event's roster as freshly read
 * @return {Promise<Object>} cover-core's verdict
 */
async function verdictFor(db, personId, ref, roster) {
  const occSnap = await db.collection(OCCURRENCES).doc(ref.occurrenceId).get();
  if (!occSnap.exists) {
    return {permitted: false, reason: "notVisible", warning: null};
  }
  const occurrence = Object.assign({id: occSnap.id}, occSnap.data());
  const rank = await rankOf(db, personId);
  const context = await aw.takeContext(db, personId, ref.roleSlug, ref.date);
  const slot = (context.roleDef && (context.roleDef.slots || [])
      .find((sl) => sl.id === (ref.slotId || null))) || null;

  return coverCore.verdictFor({
    rank: rank,
    person: context.person,
    occurrence: occurrence,
    roleDef: context.roleDef,
    slot: slot,
    context: {
      people: context.person ? [context.person] : [],
      relationships: context.relationships,
      groups: context.groups,
      awayPersonIds: context.awayPersonIds,
      // The person leaving is still on the roster at this point, and the place
      // they are leaving is the one being taken — so their own row is dropped
      // rather than counting as a clash with themselves.
      assigned: (roster || [])
          .filter((a) => a.roleSlug === ref.roleSlug &&
            (a.slotId || null) !== (ref.slotId || null))
          .map((a) => ({slotId: a.slotId, personId: a.personId})),
      assignedElsewhere: (roster || [])
          .filter((a) => a.roleSlug !== ref.roleSlug)
          .map((a) => ({
            personId: a.personId,
            roleSlug: a.roleSlug,
            allowsAnotherRole: false,
          })),
    },
  });
}

/**
 * Fill in everything about an Assignment the caller must NOT be trusted for.
 *
 * ⚠ THE DATE COMES OFF THE OCCURRENCE, NEVER OFF THE REQUEST. The date is the
 * only clock in this whole feature — it decides what is dead, what may still be
 * offered, and what a settlement may touch. A caller who could send their own
 * would be able to trade a Saturday that has already happened.
 *
 * Same for the Role's name: `roleBySlug` is how a slug becomes a human name and
 * it lives in the browser. A caller sending one up would put arbitrary text
 * on somebody else's screen.
 *
 * @param {Object} db the Firestore handle
 * @param {Object} ref what the caller named: occurrenceId, roleSlug, slotId
 * @return {Promise<?Object>} the reference, the Event's name and the Role's
 */
async function describeAssignment(db, ref) {
  const r = ref || {};
  if (!r.occurrenceId || !r.roleSlug) return null;

  const [occSnap, roleSnap] = await Promise.all([
    db.collection(OCCURRENCES).doc(r.occurrenceId).get(),
    db.collection("roles").where("slug", "==", r.roleSlug).limit(1).get(),
  ]);
  if (!occSnap.exists) return null;

  const occurrence = occSnap.data();
  const role = roleSnap.empty ? null : roleSnap.docs[0].data();
  return {
    assignment: {
      occurrenceId: r.occurrenceId,
      roleSlug: r.roleSlug,
      slotId: r.slotId || null,
      date: occurrence.date,
    },
    eventName: occurrence.name || occurrence.seriesName || "Event",
    roleName: (role && role.name) || null,
  };
}

// ── The five moves ──────────────────────────────────────────────────────────

/**
 * Ask somebody to take an Assignment you have declined.
 * @param {Object} db the Firestore handle
 * @param {Object} spec the invitation
 * @return {Promise<Object>} the Trade written, or a refusal
 */
async function invite(db, spec) {
  const s = spec || {};
  const said = await describeAssignment(db, s.assignment);
  if (!said) return refuse("not-found", "That Event has gone.");
  const ref = said.assignment;

  // ⚠ THE RUNG, FIRST AND ABSOLUTELY. Inviting somebody to a place they cannot
  // see would tell them it exists, which is the whole thing the rung protects.
  const theyCanSee = await canSee(db, s.counterpartyId, ref.occurrenceId);
  if (!theyCanSee) {
    return refuse("failed-precondition",
        "They are not able to see that one.", "notVisible");
  }

  return runOrLose(db, async (tx) => {
    const held = await readAssignment(tx, db, ref);
    if (!held || held.personId !== s.actorId) {
      return refusalFor(tradeCore.REASONS.NOT_YOURS);
    }
    if (held.state !== STATES.DECLINED) {
      return refuse("failed-precondition",
          "Decline it first — then you can ask somebody.");
    }

    const siblings = await liveOn(tx, db, ref, s.today);
    const plan = tradeCore.planTransition({
      action: tradeCore.ACTIONS.INVITE,
      actorId: s.actorId,
      assignment: ref,
      holderId: s.actorId,
      counterpartyId: s.counterpartyId,
      siblings: siblings,
      today: s.today,
    });
    if (!plan.ok) return refusalFor(plan.reason);

    const doc = db.collection(TRADES).doc();
    tx.set(doc, {
      origin: plan.origin,
      state: plan.to,
      assignment: ref,
      eventName: said.eventName,
      roleName: said.roleName,
      holderId: s.actorId,
      counterpartyId: s.counterpartyId,
      partyIds: [s.actorId, s.counterpartyId],
      offered: [],
      chosen: null,
      openedAt: s.now || null,
      settledAt: null,
      closedBy: null,
      closedBecause: null,
      // Who has read this once it ends. Per person, because one party
      // dismissing a notice must not dismiss the other party's.
      seenBy: [],
    });

    return {ok: true, tradeId: doc.id, state: plan.to};
  }, "Somebody was changing that at the same moment. Try again.");
}

/**
 * Every live Trade on one Assignment — what the cap counts, and what dies when
 * one settles. Read inside the transaction, so a fourth invitation racing a
 * third loses rather than sneaking past the cap.
 * @param {Object} tx the transaction
 * @param {Object} db the Firestore handle
 * @param {Object} ref the Assignment
 * @param {string} today the church's today
 * @return {Promise<Array<Object>>} the live Trades
 */
async function liveOn(tx, db, ref, today) {
  const snap = await tx.get(db.collection(TRADES)
      .where("assignment.occurrenceId", "==", ref.occurrenceId));
  const all = snap.docs.map((d) => Object.assign({id: d.id}, d.data()));
  return tradeCore.liveOnes(all, today)
      .filter((t) => tradeCore.sameAssignment(t.assignment, ref));
}

/**
 * Take back an invitation you sent, or an offer you made.
 * @param {Object} db the Firestore handle
 * @param {Object} spec which one
 * @return {Promise<Object>} the outcome
 */
function withdraw(db, spec) {
  return step(db, spec, tradeCore.ACTIONS.WITHDRAW);
}

/**
 * Say no — available to the invited person, and to the holder facing an offer.
 * @param {Object} db the Firestore handle
 * @param {Object} spec which one
 * @return {Promise<Object>} the outcome
 */
function refuseTrade(db, spec) {
  return step(db, spec, tradeCore.ACTIONS.REFUSE);
}

/**
 * The moves that only rewrite the Trade itself.
 * @param {Object} db the Firestore handle
 * @param {Object} spec which one
 * @param {string} action the move
 * @return {Promise<Object>} the outcome
 */
function step(db, spec, action) {
  const s = spec || {};
  return runOrLose(db, async (tx) => {
    const ref = db.collection(TRADES).doc(s.tradeId);
    const snap = await tx.get(ref);
    if (!snap.exists) {
      return refuse("not-found", "That one has gone.");
    }
    const trade = Object.assign({id: snap.id}, snap.data());

    const plan = tradeCore.planTransition({
      trade: trade, action: action, actorId: s.actorId, today: s.today,
    });
    if (!plan.ok) return refusalFor(plan.reason);

    // ⚠ WHO ENDED IT IS RECORDED, and it is not bookkeeping (MS-212). It is
    // what stops the app telling somebody their own news back: the person who
    // tapped Refuse gets no notice about a refusal, and the person on the other
    // end does.
    tx.update(ref, {
      state: plan.to,
      closedAt: s.now || null,
      closedBy: s.actorId || null,
      closedBecause: null,
    });
    return {ok: true, tradeId: trade.id, state: plan.to};
  }, "Somebody was changing that at the same moment. Try again.");
}

/**
 * Put your own Assignments up — either replying to an invitation, or offering
 * uninvited against something on the cover list.
 *
 * ⚠ AN EMPTY REPLY TO AN INVITATION SETTLES IT. They were asked, so their
 * answer IS the agreement; there is nobody left to accept it. An empty
 * UNINVITED offer is refused instead, because taking something nobody offered
 * you is the cover list's Take button and that is one tap.
 *
 * @param {Object} db the Firestore handle
 * @param {Object} spec the offer
 * @return {Promise<Object>} the outcome
 */
async function offer(db, spec) {
  const s = spec || {};

  // Read the Trade first, because a reply and an uninvited offer need
  // different things checked and only the document says which this is.
  let trade = null;
  if (s.tradeId) {
    const snap = await db.collection(TRADES).doc(s.tradeId).get();
    if (!snap.exists) return refuse("not-found", "That one has gone.");
    trade = Object.assign({id: snap.id}, snap.data());
  }

  const holderId = trade ? trade.holderId : s.holderId;

  // ⚠ EVERY REFERENCE IS RE-RESOLVED FROM FIRESTORE. A reply reuses the one
  // already on the Trade; an uninvited offer names an Assignment the caller
  // chose, and every date they put up is filled in here rather than taken from
  // the request. The date decides what is dead.
  let said = null;
  if (!trade) {
    said = await describeAssignment(db, s.assignment);
    if (!said) return refuse("not-found", "That Event has gone.");
  }
  const ref = trade ? trade.assignment : said.assignment;

  const offered = [];
  for (const put of s.offered || []) {
    const told = await describeAssignment(db, put);
    if (!told) return refuse("not-found", "One of those dates has gone.");
    offered.push(told.assignment);
  }

  // ⚠ BOTH RUNGS, BEFORE ANYTHING ELSE.
  //
  // The offerer must be able to see what they are offering against, or an
  // uninvited offer becomes a way to probe for Events you cannot see. And the
  // HOLDER must be able to see every Assignment put up, because accepting one
  // writes them into its `participantIds` — which is precisely how sight of an
  // Event is granted. Offering somebody a place in the elders' diary would
  // otherwise hand them the diary.
  const offererSees = await canSee(db, s.actorId, ref.occurrenceId);
  if (!offererSees) {
    return refuse("permission-denied", "That one is not open to you.",
        "notVisible");
  }
  for (const put of offered) {
    const holderSees = await canSee(db, holderId, put.occurrenceId);
    if (!holderSees) {
      return refuse("failed-precondition",
          "They are not able to see one of the dates you offered.",
          "notVisible");
    }
  }

  return runOrLose(db, async (tx) => {
    const plan = trade ?
      tradeCore.planTransition({
        trade: trade, action: tradeCore.ACTIONS.OFFER,
        actorId: s.actorId, offered: offered, today: s.today,
      }) :
      tradeCore.planTransition({
        action: tradeCore.ACTIONS.OFFER, actorId: s.actorId,
        assignment: ref, holderId: holderId, counterpartyId: s.actorId,
        offered: offered, today: s.today,
      });
    if (!plan.ok) return refusalFor(plan.reason);

    // Their reply was "yes, I'll just take it". Nothing is left to accept.
    if (plan.settles) {
      return settle(tx, db, {
        trade: trade, chosen: null, today: s.today, now: s.now,
        actorId: s.actorId, verdicts: s.verdicts,
      });
    }

    if (trade) {
      tx.update(db.collection(TRADES).doc(trade.id), {
        state: plan.to, offered: offered, offeredAt: s.now || null,
      });
      return {ok: true, tradeId: trade.id, state: plan.to};
    }

    const doc = db.collection(TRADES).doc();
    tx.set(doc, {
      origin: plan.origin,
      state: plan.to,
      assignment: ref,
      eventName: said.eventName,
      roleName: said.roleName,
      holderId: holderId,
      counterpartyId: s.actorId,
      partyIds: [holderId, s.actorId],
      offered: offered,
      chosen: null,
      openedAt: s.now || null,
      settledAt: null,
      closedBy: null,
      closedBecause: null,
      seenBy: [],
    });
    return {ok: true, tradeId: doc.id, state: plan.to};
  }, "Somebody was changing that at the same moment. Try again.");
}

/**
 * Take one of the Assignments offered, which settles the whole thing.
 * @param {Object} db the Firestore handle
 * @param {Object} spec which one, and which Assignment
 * @return {Promise<Object>} the outcome
 */
async function accept(db, spec) {
  const s = spec || {};
  const snap = await db.collection(TRADES).doc(s.tradeId).get();
  if (!snap.exists) return refuse("not-found", "That one has gone.");
  const trade = Object.assign({id: snap.id}, snap.data());

  // The chosen one is matched against what is ON the Trade, so the caller's
  // own date is never consulted — planTransition returns the stored reference.
  const plan = tradeCore.planTransition({
    trade: trade, action: tradeCore.ACTIONS.ACCEPT,
    actorId: s.actorId, chosen: s.chosen, today: s.today,
  });
  if (!plan.ok) return refusalFor(plan.reason);

  return runOrLose(db, (tx) => settle(tx, db, {
    trade: trade, chosen: plan.chosen, today: s.today, now: s.now,
    actorId: s.actorId,
  }), "Somebody has already sorted that one out.");
}

/**
 * The settlement itself, inside somebody else's transaction.
 *
 * ⚠ EVERYTHING HERE LANDS TOGETHER OR NOT AT ALL: two roster rows deleted and
 * two created, two occurrences' derived fields, the cover entry, the Trade, and
 * every competing Trade that dies with it.
 *
 * @param {Object} tx the open transaction
 * @param {Object} db the Firestore handle
 * @param {Object} s the settlement
 * @return {Promise<Object>} the outcome
 */
async function settle(tx, db, s) {
  const trade = s.trade;
  const chosen = s.chosen || null;

  // Re-read every Assignment involved. Nothing was reserved while the offer
  // sat, so this is the only moment anybody knows whether it still stands.
  const read = {};
  const covered = await readAssignment(tx, db, trade.assignment);
  read[tradeCore.assignmentKey(trade.assignment)] = covered;
  let back = null;
  if (chosen) {
    back = await readAssignment(tx, db, chosen);
    read[tradeCore.assignmentKey(chosen)] = back;
  }

  // ⚠ BOTH PARTIES, NOT JUST THE HOLDER. Sarah is giving up her Coffee here,
  // and she may well have offered that same Coffee to Ray in a conversation Bob
  // is not in — `partyIds` on that one is [Ray, Sarah] and contains no Bob at
  // all. Asking only about the holder left it live, pointing at a Saturday that
  // had just changed hands, and Ray found out by having his acceptance refused.
  const siblings = await tx.get(db.collection(TRADES)
      .where("partyIds", "array-contains-any",
          [trade.holderId, trade.counterpartyId]));
  const nearby = siblings.docs.map((d) => Object.assign({id: d.id}, d.data()));

  const verdict = tradeCore.arbitrate({
    trade: trade, chosen: chosen, read: read,
    siblings: nearby, today: s.today,
  });
  if (!verdict.ok) return refusalFor(verdict.reason);

  // ⚠ ELIGIBILITY, ON BOTH SIDES. Read outside the transaction's contended set
  // — none of it is what the race is about — but refused inside it, so a
  // settlement that would seat somebody the Role refuses writes nothing.
  for (const move of verdict.moves) {
    const roster = tradeCore.sameAssignment(move.assignment, trade.assignment) ?
      (covered && covered.roster) : (back && back.roster);
    const allowed = await verdictFor(db, move.to, move.assignment, roster);
    if (allowed.permitted !== true) {
      return refuse("failed-precondition",
          "That swap would put somebody in a place the Role does not allow.",
          allowed.reason);
    }
  }

  // Both arrive Confirmed. Neither person is asked to agree to something they
  // just negotiated for.
  verdict.moves.forEach((move) => {
    const source = tradeCore.sameAssignment(move.assignment, trade.assignment) ?
      covered : back;
    const rosterCol = db.collection(OCCURRENCES)
        .doc(move.assignment.occurrenceId).collection("roster");

    // ⚠ DELETE PLUS CREATE. The row's id carries the personId, so an update
    // would leave both people standing in one slot.
    const moved = Object.assign({}, source.row, {
      personId: move.to,
      state: STATES.CONFIRMED,
      stateSetBy: move.to,
      stateSetAt: s.now || null,
    });
    tx.delete(rosterCol.doc(rosterIdFor(source.row)));
    tx.set(rosterCol.doc(rosterIdFor(moved)), moved);

    const after = source.roster.map((a) => (a === source.row ? moved : a));
    const occRef = db.collection(OCCURRENCES).doc(move.assignment.occurrenceId);
    tx.update(occRef, {
      participantIds: participantIdsOf(after),
      needsAttention: after.some((a) => a && a.state === STATES.DECLINED),
      outForCover: occurrences.outForCover(
          Object.assign({}, source.occurrence, {assignments: after})),
    });

    tx.delete(db.collection(COVER).doc(coverId(move.assignment)));
  });

  tx.update(db.collection(TRADES).doc(trade.id), {
    state: tradeCore.STATES.SETTLED,
    chosen: chosen,
    settledAt: s.now || null,
    closedAt: s.now || null,
    closedBy: s.actorId || null,
    closedBecause: null,
  });

  // Settling cleans up LOUDLY. An offer that simply stops being answered
  // teaches somebody not to make the next one.
  //
  // ⚠ `closedBy` IS THE SETTLER, WHO IS USUALLY IN NEITHER OF THESE. That is
  // the point: everybody in a Trade that died here learns why, and the one
  // person who already knows — because they are the one who did it — does not
  // get told about their own act.
  verdict.dying.forEach((other) => {
    tx.update(db.collection(TRADES).doc(other.id), {
      state: tradeCore.STATES.WITHDRAWN,
      closedAt: s.now || null,
      closedBy: s.actorId || null,
      closedBecause: tradeCore.CAUSES.SETTLED,
    });
  });

  return {
    ok: true,
    tradeId: trade.id,
    state: tradeCore.STATES.SETTLED,
    moves: verdict.moves,
    dying: verdict.dying.map((t) => t.id),
    telling: verdict.telling,
  };
}

/**
 * The roster document id, as events-store.js builds it.
 * @param {Object} a the Assignment
 * @return {string} its document id
 */
function rosterIdFor(a) {
  return [a.roleSlug, a.oneOffId || a.slotId || "x", a.personId].join("__");
}

/**
 * The cover document id, as assignment-answer.js builds it.
 * @param {Object} ref the Assignment reference
 * @return {string} the cover document id
 */
function coverId(ref) {
  return [ref.occurrenceId, ref.roleSlug, ref.slotId || "one_off"].join("__");
}

/**
 * Everyone holding a place, which is what the participant rule reads.
 * @param {Array<Object>} roster the Assignments
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
 * Push a quiet Assignment onto the open cover list, or pull an open one back
 * off it (MS-213).
 *
 * ⚠ THIS IS THE ESCALATION, and it is the reason quiet is safe to offer at all.
 * Somebody who declines quietly, asks the three people they know, and is
 * refused by all three has somewhere to go. Without it, choosing quiet would be
 * choosing a dead end.
 *
 * Going the other way — open back to quiet — is refused while somebody has an
 * uninvited offer live against it. They answered an advertisement in good
 * faith; withdrawing the advertisement out from under them would leave their
 * offer pointing at something they can no longer see.
 *
 * @param {Object} db the Firestore handle
 * @param {Object} spec which Assignment, and which way
 * @return {Promise<Object>} the outcome
 */
async function setReach(db, spec) {
  const s = spec || {};
  const said = await describeAssignment(db, s.assignment);
  if (!said) return refuse("not-found", "That Event has gone.");
  const ref = said.assignment;

  return runOrLose(db, async (tx) => {
    const held = await readAssignment(tx, db, ref);
    if (!held || held.personId !== s.actorId) {
      return refusalFor(tradeCore.REASONS.NOT_YOURS);
    }
    if (held.state !== STATES.DECLINED) {
      return refuse("failed-precondition",
          "Only a place you have declined can go looking for somebody.");
    }

    // The rung is the church's rule and the member does not get a vote on it.
    // A participant-rung Event can reach nobody who is not already in it, so
    // "open" there would advertise to an empty room.
    if (!s.quiet && !occurrences.canBeCovered(held.occurrence)) {
      return refuse("failed-precondition",
          "This one cannot go on the open list — only people you ask " +
          "directly can see it.");
    }

    if (s.quiet) {
      const nearby = await liveOn(tx, db, ref, s.today);
      const answered = nearby.some((t) =>
        t.origin === tradeCore.ORIGINS.OFFER);
      if (answered) {
        return refuse("failed-precondition",
            "Somebody has already offered to swap for this one. " +
            "Answer them first.");
      }
    }

    const rosterCol = db.collection(OCCURRENCES)
        .doc(ref.occurrenceId).collection("roster");
    tx.update(rosterCol.doc(rosterIdFor(held.row)), {quiet: s.quiet === true});

    const coverRef = db.collection(COVER).doc(coverId(ref));
    if (s.quiet) {
      tx.delete(coverRef);
    } else {
      tx.set(coverRef, {
        occurrenceId: ref.occurrenceId,
        seriesId: held.occurrence.seriesId || null,
        date: ref.date,
        eventName: said.eventName,
        roleSlug: ref.roleSlug,
        slotId: ref.slotId,
        roleName: said.roleName,
        visibility: occurrences.visibilityOf(held.occurrence),
      });
    }

    return {ok: true, quiet: s.quiet === true};
  }, "Somebody was changing that at the same moment. Try again.");
}

// ── Cleanup from outside the conversation (MS-212) ──────────────────────────

/**
 * Why a live Trade about this place can no longer happen — or null if it still
 * can. Three quite different things, and a reader deserves to be told which,
 * because each leaves them with a different thought about what to do next.
 * @param {?Object} held the Assignment as it now stands, or null if it has gone
 * @param {Object} trade the live Trade about it
 * @return {?string} one of tradeCore.CAUSES, or null to leave it alone
 */
function causeFor(held, trade) {
  if (!held) return tradeCore.CAUSES.GONE;
  if (held.personId !== trade.holderId) return tradeCore.CAUSES.FILLED;
  if (held.state !== STATES.DECLINED) return tradeCore.CAUSES.KEPT;
  return null;
}

/**
 * End every live Trade about an Assignment that has stopped looking for cover.
 *
 * ⚠ THIS IS THE EDITOR'S BACKSTOP, AND THE EDITOR DOES NOTHING SPECIAL. Filling
 * a place already overwrites the roster row; the Trades simply have to notice.
 * Which is why this hangs off the roster write rather than off a button —
 * auto-assign, the roster grid, a drag on the calendar and a straight edit are
 * four doors to the same act, and a cleanup wired to one of them is a cleanup
 * that quietly does not run for the other three.
 *
 * ⚠ `closedBy` IS NULL, on purpose. Nobody in the conversation ended this, so
 * everybody in it hears about it — including whoever was holding the place.
 *
 * @param {Object} db the Firestore handle
 * @param {Object} spec which Assignment, and the church's today
 * @return {Promise<Object>} what was closed, and why
 */
function sweepAssignment(db, spec) {
  const s = spec || {};
  const ref = {
    occurrenceId: s.occurrenceId,
    roleSlug: s.roleSlug,
    slotId: s.slotId || null,
  };

  return runOrLose(db, async (tx) => {
    const held = await readAssignment(tx, db, ref);
    // The date is still the only clock: `liveOn` drops anything already past,
    // so a Saturday that has gone needs no cleanup and no scheduled job.
    const nearby = await liveOn(tx, db, ref, s.today);

    const closed = [];
    nearby.forEach((trade) => {
      const because = causeFor(held, trade);
      if (!because) return;
      tx.update(db.collection(TRADES).doc(trade.id), {
        state: tradeCore.STATES.WITHDRAWN,
        closedAt: s.now || null,
        closedBy: null,
        closedBecause: because,
      });
      closed.push({id: trade.id, because: because});
    });

    return {ok: true, closed: closed};
  }, "Somebody was changing that at the same moment. Try again.");
}

/**
 * Mark an ended Trade as read by one of its two parties.
 *
 * ⚠ PER PERSON, NOT PER TRADE. Both parties are usually being told the same
 * news, and one of them dismissing it must not dismiss the other's.
 *
 * ⚠ AND ONLY ONCE IT HAS ENDED. Clearing a live one would let somebody silence
 * a notice before the thing it is about has happened — they would then never be
 * told, which is precisely the failure this whole sub-task exists to close.
 *
 * @param {Object} db the Firestore handle
 * @param {Object} spec which Trade, and who has read it
 * @return {Promise<Object>} the outcome
 */
function markSeen(db, spec) {
  const s = spec || {};
  return runOrLose(db, async (tx) => {
    const ref = db.collection(TRADES).doc(s.tradeId);
    const snap = await tx.get(ref);
    if (!snap.exists) return refuse("not-found", "That one has gone.");
    const trade = Object.assign({id: snap.id}, snap.data());

    if (trade.holderId !== s.actorId && trade.counterpartyId !== s.actorId) {
      return refusalFor(tradeCore.REASONS.NOT_YOURS);
    }
    if (!tradeCore.isDead(trade, s.today)) {
      return refuse("failed-precondition",
          "That one is still going — answer it rather than clearing it.");
    }

    const seen = (trade.seenBy || []).slice();
    if (seen.indexOf(s.actorId) === -1) seen.push(s.actorId);
    tx.update(ref, {seenBy: seen});

    return {ok: true, tradeId: trade.id};
  }, "Somebody was changing that at the same moment. Try again.");
}

module.exports = {
  TRADES,
  setReach,
  sweepAssignment,
  markSeen,
  invite,
  withdraw,
  refuse: refuseTrade,
  offer,
  accept,
  rankOf,
  canSee,
};
