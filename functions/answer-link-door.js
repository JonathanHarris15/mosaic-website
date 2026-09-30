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

const LINKS = "answer_links";
const LOOKUPS = "answer_link_lookups";
const PURPOSE_PRAYER = "prayer_request";

const CLOSED = {
  ok: false,
  code: "closed",
  message: "This link has closed.",
};

const RATE_LIMITED = {
  ok: false,
  code: "rate-limited",
  message: "Try again later.",
};

/**
 * Same closed payload every time — unknown, expired, and no-longer-subject
 * must not be distinguishable.
 * @return {Object}
 */
function closed() {
  return Object.assign({}, CLOSED);
}

/**
 * Mint a link. The raw token is returned to the caller and never stored.
 * @param {FirebaseFirestore.Firestore} db
 * @param {Object} args purpose, personId, thing, now, randomBytes
 * @return {Promise<{token: string, url: string, id: string}>}
 */
async function mintAnswerLink(db, args) {
  const bytes = args.randomBytes || crypto.randomBytes(16);
  const token = al.mintAnswerToken(bytes);
  const id = al.tokenDocumentId(token);
  const now = args.now || new Date();
  const expiresAt = al.linkExpiryAt(args.thing, now);
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
    return closed();
  }
  const gate = await unknownLookupGate(db, input.callerAddress, now);
  if (!gate.ok) {
    return Object.assign({}, RATE_LIMITED);
  }
  const id = al.tokenDocumentId(token);
  const snap = await db.collection(LINKS).doc(id).get();
  if (!snap.exists) {
    await writeLookupCounter(db, input.callerAddress, gate);
    return closed();
  }
  const link = snap.data();
  if (!al.linkUsability(link, now).open) {
    return closed();
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
  return closed();
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
  RATE_LIMITED,
  mintAnswerLink,
  handleAnswerLink,
};
