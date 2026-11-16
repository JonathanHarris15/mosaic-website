/**
 * @fileoverview The Answer link door (MS-513, ADR-0067). Shape-check,
 * address throttle, hash lookup, open check, then purpose dispatch.
 * Person and thing come off the link document. A Linked User may call
 * with no token for their own open items. Takes `db` so emulator tests
 * can drive it. No network.
 */

const crypto = require("crypto");
const al = require("./answer-link");
const pr = require("./prayer-request");
const writes = require("./prayer-request-writes");
const tw = require("./trade-writes");
const {inviteeView} = require("./trade-invitation-text");

const LINKS = "answer_links";
const LOOKUPS = "answer_link_lookups";
const PURPOSE_PRAYER = "prayer_request";
const PURPOSE_TRADE = "trade_invitation";

const CLOSED = {
  ok: false,
  code: "closed",
  message: "This link has closed.",
};

const NOT_FOUND = {
  ok: false,
  code: "not-found",
  message: "This link is invalid or has expired.",
};

const EXPIRED = {
  ok: false,
  code: "failed-precondition",
  message: "This link is invalid or has expired.",
};

const RATE_LIMITED = {
  ok: false,
  code: "rate-limited",
  message: "Try again later.",
};

/**
 * @return {Object}
 */
function closed() {
  return Object.assign({}, CLOSED);
}

/**
 * @return {Object}
 */
function invalidLink() {
  return Object.assign({}, NOT_FOUND);
}

/**
 * @return {Object}
 */
function expiredLink() {
  return Object.assign({}, EXPIRED);
}

/**
 * Mint a link. The raw token is returned to the caller and never stored.
 * @param {FirebaseFirestore.Firestore} db
 * @param {Object<string, *>} args purpose, personId, thing, now,
 *   randomBytes, and endDate (YYYY-MM-DD) when the thing is not itself the
 *   date the link dies with, as for a Trade invitation
 * @return {Promise<{token: string, url: string, id: string, expiresAt: Date}>}
 */
async function mintAnswerLink(db, args) {
  const bytes = args.randomBytes || crypto.randomBytes(16);
  const token = al.mintAnswerToken(bytes);
  const id = al.tokenDocumentId(token);
  const now = args.now || new Date();
  const expiresAt = al.linkExpiryAt(args.endDate || args.thing, now);
  await db.collection(LINKS).doc(id).set({
    purpose: args.purpose,
    personId: args.personId,
    thing: args.thing,
    expiresAt: expiresAt,
    createdAt: now,
    saveTimestamps: [],
  });
  return {token, url: al.buildAnswerUrl(token), id, expiresAt};
}

/**
 * @param {?string} address
 * @return {string}
 */
function addressDocId(address) {
  return al.hashCallerAddress(address == null ? "" : address);
}

/**
 * @param {FirebaseFirestore.Firestore} db
 * @param {?string} address
 * @param {Date} now
 * @return {Promise<Object>}
 */
async function unknownLookupGate(db, address, now) {
  const id = addressDocId(address);
  const snap = await db.collection(LOOKUPS).doc(id).get();
  const data = snap.exists ? snap.data() : {};
  return al.unknownLookupRateDecision(data, now);
}

/**
 * @param {FirebaseFirestore.Firestore} db
 * @param {?string} address
 * @param {Object} decision
 * @return {Promise<void>}
 */
async function writeLookupCounter(db, address, decision) {
  if (!decision.ok) return;
  const id = addressDocId(address);
  await db.collection(LOOKUPS).doc(id).set({
    lookupTimestamps: decision.lookupTimestamps,
  }, {merge: true});
}

/**
 * The door. `input` is already shaped: op, token, answer, thing, now,
 * callerAddress, personId (from the signed-in user record, never the body).
 * @param {FirebaseFirestore.Firestore} db
 * @param {Object} input
 * @return {Promise<Object>}
 */
async function handleAnswerLink(db, input) {
  const now = input.now || new Date();
  const op = input.op;
  if (op !== "read" && op !== "answer") {
    return {ok: false, code: "invalid-argument", message: "Unknown operation."};
  }
  const token = typeof input.token === "string" ? input.token.trim() : "";
  if (token) {
    return handleToken(db, {input, token, op, now});
  }
  return handleSignedIn(db, {input, op, now});
}

/**
 * @param {FirebaseFirestore.Firestore} db
 * @param {Object} args
 * @return {Promise<Object>}
 */
async function handleToken(db, args) {
  const {input, token, op, now} = args;
  if (!al.looksLikeAnswerToken(token)) {
    return invalidLink();
  }
  const gate = await unknownLookupGate(db, input.callerAddress, now);
  if (!gate.ok) {
    return Object.assign({}, RATE_LIMITED);
  }
  const id = al.tokenDocumentId(token);
  const snap = await db.collection(LINKS).doc(id).get();
  if (!snap.exists) {
    await writeLookupCounter(db, input.callerAddress, gate);
    return invalidLink();
  }
  const link = snap.data();
  if (!al.linkUsability(link, now).open) {
    return expiredLink();
  }
  return dispatchPurpose(db, {
    op,
    link,
    linkRef: snap.ref,
    answer: input.answer,
    now,
    viaAnswerLink: true,
  });
}

/**
 * @param {FirebaseFirestore.Firestore} db
 * @param {Object} args
 * @return {Promise<Object>}
 */
async function handleSignedIn(db, args) {
  const {input, op, now} = args;
  const personId = input.personId;
  if (!personId) {
    return closed();
  }
  const todayDate = pr.churchDateParts(now).date;
  const items = await writes.openItemsForPerson(db, {
    personId,
    todayDate,
  });
  if (op === "read") {
    return {ok: true, items};
  }
  let chosen = items.length === 1 ? items[0] : null;
  if (!chosen && input.thing) {
    chosen = items.find((it) => it.thing === input.thing) || null;
  }
  if (!chosen) {
    return closed();
  }
  return dispatchPurpose(db, {
    op: "answer",
    link: {
      purpose: chosen.purpose,
      personId,
      thing: chosen.thing,
    },
    linkRef: null,
    answer: input.answer,
    now,
    viaAnswerLink: false,
  });
}

/**
 * @param {FirebaseFirestore.Firestore} db
 * @param {Object} args
 * @return {Promise<Object>}
 */
async function dispatchPurpose(db, args) {
  const purpose = args.link && args.link.purpose;
  if (purpose === PURPOSE_PRAYER) {
    return prayerPurpose(db, args);
  }
  if (purpose === PURPOSE_TRADE) {
    return tradeInvitationPurpose(tradeDeps(db), args);
  }
  return closed();
}

/**
 * What the Trade invitation purpose reads and moves, from Firestore.
 * @param {FirebaseFirestore.Firestore} db
 * @return {*}
 */
function tradeDeps(db) {
  return {
    loadTrade: async (/** @type {string} */ id) => {
      const snap = await db.collection(tw.TRADES).doc(id).get();
      return snap.exists ? Object.assign({id: snap.id}, snap.data()) : null;
    },
    firstNameOf: async (/** @type {string} */ personId) => {
      if (!personId) return "";
      const snap = await db.collection("people").doc(personId).get();
      const data = snap.data();
      return pr.firstNameOf((data && data.name) || "");
    },
    offer: (/** @type {*} */ spec) => tw.offer(db, spec),
    refuse: (/** @type {*} */ spec) => tw.refuse(db, spec),
  };
}

/**
 * A Trade invitation answered through its link (MS-249). The invitee can
 * take the place or say no, and nothing else: offering one of their own
 * places would show the link holder their other Assignments. Both answers
 * are the existing Trade moves, with the invitee off the link as the actor,
 * so every eligibility and visibility check still runs.
 * @param {*} deps loadTrade, firstNameOf, offer, refuse
 * @param {*} args op, link, answer, now, linkRef
 * @return {Promise<Object<string, *>>}
 */
async function tradeInvitationPurpose(deps, args) {
  const personId = args.link.personId;
  const tradeId = args.link.thing;
  const today = pr.churchDateParts(args.now).date;

  const viewNow = async () => {
    const trade = await deps.loadTrade(tradeId);
    if (!trade || trade.counterpartyId !== personId) return null;
    return inviteeView(trade, {
      inviteeId: personId,
      inviterFirstName: await deps.firstNameOf(trade.holderId),
      today: today,
    });
  };

  const before = await viewNow();
  if (!before) return closed();
  const shown = (/** @type {*} */ view) =>
    ({ok: true, purpose: PURPOSE_TRADE, thing: tradeId, view: view});
  if (args.op === "read") return shown(before);

  const answer = String(args.answer || "");
  if (answer !== "take" && answer !== "refuse") {
    return {ok: false, code: "invalid-argument",
      message: "Say yes or no."};
  }
  // Nothing left to answer: show where it stands rather than a refusal.
  if (before.canAnswer.indexOf(answer) === -1) return shown(before);

  if (args.linkRef) {
    const linkSnap = await args.linkRef.get();
    const save = al.saveRateDecision(linkSnap.data() || {}, args.now);
    if (!save.ok) return Object.assign({}, RATE_LIMITED);
    await args.linkRef.set({saveTimestamps: save.saveTimestamps},
        {merge: true});
  }

  const spec = {tradeId: tradeId, actorId: personId, today: today,
    now: args.now};
  // An empty reply to an invitation settles it: they were asked, so their
  // answer is the agreement (CONTEXT.md, Trade).
  const result = answer === "take" ?
    await deps.offer(Object.assign({offered: []}, spec)) :
    await deps.refuse(spec);
  // ⚠ NOT THE MOVE'S OWN CODE. The page reads failed-precondition as an
  // expired link, so "the Role does not allow you" would show as a dead link.
  if (!result || !result.ok) {
    return {ok: false, code: "refused",
      message: (result && result.message) || "That did not work."};
  }
  return shown(await viewNow() || before);
}

/**
 * @param {FirebaseFirestore.Firestore} db
 * @param {Object} args
 * @return {Promise<Object>}
 */
async function prayerPurpose(db, args) {
  const personId = args.link.personId;
  const serviceDate = args.link.thing;
  const now = args.now;
  const todayDate = pr.churchDateParts(now).date;
  if (args.op === "read") {
    const state = await writes.loadPrayerAnswerState(db, {
      personId, serviceDate, todayDate,
      viaAnswerLink: args.viaAnswerLink,
    });
    if (!state.ok) return closed();
    return {ok: true, purpose: PURPOSE_PRAYER, thing: serviceDate,
      view: state.view};
  }

  if (!String(args.answer || "").trim()) {
    return {ok: false, code: "invalid-argument", message: "Write something."};
  }

  if (args.linkRef) {
    const linkSnap = await args.linkRef.get();
    const link = linkSnap.exists ? linkSnap.data() : {};
    const save = al.saveRateDecision(link, now);
    if (!save.ok) {
      return Object.assign({}, RATE_LIMITED);
    }
    const result = await writes.saveFormAnswer(db, {
      personId, serviceDate, todayDate,
      answerText: args.answer,
      now,
      viaAnswerLink: true,
    });
    if (result.ok) {
      await args.linkRef.set({saveTimestamps: save.saveTimestamps},
          {merge: true});
    }
    if (!result.ok && result.code === "closed") return closed();
    return result;
  }

  const result = await writes.saveFormAnswer(db, {
    personId, serviceDate, todayDate,
    answerText: args.answer,
    now,
    viaAnswerLink: false,
  });
  if (!result.ok && result.code === "closed") return closed();
  return result;
}

module.exports = {
  LINKS,
  LOOKUPS,
  CLOSED,
  NOT_FOUND,
  EXPIRED,
  RATE_LIMITED,
  mintAnswerLink,
  handleAnswerLink,
  tradeInvitationPurpose,
};
