// @ts-nocheck
/**
 * @fileoverview Firestore writes for a Prayer Request (MS-513). Reply path
 * and page (form) path share the note decision so a second note is never
 * minted. No network — the caller sends any thank-you.
 *
 * Reply and Answer-link form share one request doc. The newest submission
 * replaces the text. The generated Shepherding Note is updated in place
 * when nobody has edited it; a hand-edited note is left alone. An
 * elder-typed request is not replaced.
 */

const pr = require("./prayer-request");
const liturgyCatalog = require("./liturgy-catalog");
const LiturgyOrders = require("./shared/liturgy-order-core");

/**
 * @param {FirebaseFirestore.Firestore} db
 * @param {string} personId
 * @param {string} serviceDate
 * @return {FirebaseFirestore.DocumentReference}
 */
function requestRef(db, personId, serviceDate) {
  return db.collection("people").doc(personId)
      .collection("prayer_requests").doc(serviceDate);
}

/**
 * A text reply or Answer form replaces stored member text. An elder-typed
 * request stays. No text yet is open.
 * @param {?string} existingSource
 * @param {boolean} hasExistingText
 * @return {boolean}
 */
function memberChannelReplaces(existingSource, hasExistingText) {
  if (!hasExistingText) return true;
  return existingSource !== "elder";
}

/**
 * Author stamped on the Shepherding Note the first time a channel writes it.
 * A later channel updates the body and leaves this name.
 * @param {string} source reply | form
 * @return {string}
 */
function noteAuthorName(source) {
  return source === "reply" ?
    "Prayer Request (texted)" : "Prayer Request (form)";
}

/**
 * Store a member's reply or form text. Newest wins. One note.
 * @param {FirebaseFirestore.Firestore} db
 * @param {Object} args personId, serviceDate, text, source, now
 * @return {Promise<{stored: boolean, noteId: ?string, replaced: boolean}>}
 */
async function writeMemberChannel(db, args) {
  const text = String(args.text || "").trim();
  const source = args.source === "form" ? "form" :
    (args.source === "reply" ? "reply" : "");
  const {personId, serviceDate} = args;
  if (!personId || !serviceDate || !text || !source) {
    return {stored: false, noteId: null, replaced: false};
  }
  const personRef = db.collection("people").doc(personId);
  const reqRef = requestRef(db, personId, serviceDate);
  const [personSnap, reqSnap] = await Promise.all([
    personRef.get(), reqRef.get(),
  ]);
  const req = reqSnap.exists ? (reqSnap.data() || {}) : {};
  const existing = String(req.prayerRequest || "").trim();
  const existingSource = req.prayerRequestSource || null;
  if (!memberChannelReplaces(existingSource, !!existing)) {
    return {stored: false, noteId: req.noteId || null, replaced: false};
  }
  if (existing === text && existingSource === source) {
    return {stored: false, noteId: req.noteId || null, replaced: false};
  }

  const hadRequestBefore = !!existing;
  let noteText = null;
  if (req.noteId) {
    const noteSnap = await personRef.collection("shepherding_notes")
        .doc(req.noteId).get();
    noteText = noteSnap.exists ? (noteSnap.data().content || "") : null;
  }
  const decision = pr.prayerRequestNoteDecision({
    hadRequestBefore,
    noteId: req.noteId || null,
    noteText,
    noteGeneratedText: req.noteGeneratedText || null,
  });
  const now = args.now || new Date();
  const personName = personSnap.exists ? (personSnap.data().name || "") : "";
  const note = pr.buildPrayerRequestNote({
    personName, serviceDate, requestText: text,
  });
  let noteId = req.noteId || null;
  let noteGeneratedText = req.noteGeneratedText || null;
  if (decision.action === "create") {
    const noteRef = personRef.collection("shepherding_notes").doc();
    await noteRef.set({
      type: note.type,
      subject: note.subject,
      content: note.content,
      contentJson: note.contentJson,
      authorName: noteAuthorName(source),
      authorUid: null,
      createdAt: now,
    });
    noteId = noteRef.id;
    noteGeneratedText = text;
    await personRef.update({lastNoteAt: now});
  } else if (decision.action === "update" && noteId) {
    await personRef.collection("shepherding_notes").doc(noteId).update({
      content: note.content,
      contentJson: note.contentJson,
    });
    noteGeneratedText = text;
  }

  await reqRef.set({
    serviceDate,
    prayerRequest: text,
    prayerRequestSource: source,
    requestFilledAt: req.requestFilledAt || now,
    changedAt: now,
    noteGenerated: true,
    noteId,
    noteGeneratedText,
  }, {merge: true});
  return {stored: true, noteId, replaced: hadRequestBefore};
}

/**
 * Apply a texted reply. A later reply replaces a form answer or an
 * earlier reply. An elder-typed request is left alone.
 * @param {FirebaseFirestore.Firestore} db
 * @param {Object} args personId, serviceDate, replyText, now
 * @return {Promise<{filled: boolean, noteId: ?string, replaced: boolean}>}
 */
async function applyReply(db, args) {
  const written = await writeMemberChannel(db, {
    personId: args.personId,
    serviceDate: args.serviceDate,
    text: args.replyText,
    source: "reply",
    now: args.now,
  });
  return {
    filled: written.stored,
    noteId: written.noteId,
    replaced: written.replaced,
  };
}

/**
 * What the page may show for one Person and Sunday.
 * @param {FirebaseFirestore.Firestore} db
 * @param {Object} args personId, serviceDate, todayDate
 * @return {Promise<Object>}
 */
async function loadPrayerAnswerState(db, args) {
  const {personId, serviceDate, todayDate} = args;
  const svcSnap = await db.collection("services").doc(serviceDate).get();
  const service = svcSnap.exists ? (svcSnap.data() || {}) : {};
  const liturgy = service.liturgy || {};
  let subjectIds = null;
  let noticeDays = null;
  try {
    const catalog = await liturgyCatalog.loadLiturgyCatalog(db);
    const order = LiturgyOrders.orderFor(service, catalog);
    const plan = pr.prayerNoticePlan({liturgy, elements: order.elements});
    subjectIds = plan.subjects.map((s) => s.id);
    const mine = plan.subjects.find((s) => s.id === personId);
    if (mine) noticeDays = mine.noticeDays;
  } catch (err) {
    subjectIds = null;
  }
  const personSnap = await db.collection("people").doc(personId).get();
  const reqSnap = await requestRef(db, personId, serviceDate).get();
  const req = reqSnap.exists ? reqSnap.data() : {};
  const viaAnswerLink = args.viaAnswerLink !== false;
  const may = pr.mayAnswerPrayerRequest({
    personId,
    serviceDate,
    todayDate,
    liturgy,
    subjectIds,
    noticeDays,
    viaAnswerLink,
    initialSentDate: req.initialSentDate || null,
  });
  if (!may) return {ok: false};
  const firstName = personSnap.exists ? (personSnap.data().name || "") : "";
  return {
    ok: true,
    liturgy,
    req,
    personSnap,
    view: pr.prayerAnswerPageView({
      firstName,
      serviceDate,
      prayerRequest: req,
    }),
  };
}

/**
 * Save a page answer. No thank-you text.
 * @param {FirebaseFirestore.Firestore} db
 * @param {Object} args personId, serviceDate, answerText, now, todayDate
 * @return {Promise<Object>}
 */
async function saveFormAnswer(db, args) {
  const text = String(args.answerText || "").trim();
  if (!text) {
    return {ok: false, code: "invalid-argument", message: "Write something."};
  }
  const loaded = await loadPrayerAnswerState(db, args);
  if (!loaded.ok) return {ok: false, code: "closed"};
  if (loaded.view.eldersAlreadyHaveIt) {
    return {
      ok: false,
      code: "already-have-it",
      view: loaded.view,
      message: "The elders already have a request for this Sunday.",
    };
  }

  const {personId, serviceDate} = args;
  const written = await writeMemberChannel(db, {
    personId,
    serviceDate,
    text,
    source: "form",
    now: args.now,
  });
  const after = await loadPrayerAnswerState(db, args);
  return {ok: true, view: after.view, noteId: written.noteId};
}

/**
 * Upcoming Sundays this Linked User may answer without a token.
 * @param {FirebaseFirestore.Firestore} db
 * @param {Object} args personId, todayDate
 * @return {Promise<Array>}
 */
async function openItemsForPerson(db, args) {
  const {personId, todayDate} = args;
  if (!personId) return [];
  const snap = await db.collection("services").get();
  const items = [];
  for (const doc of snap.docs) {
    if (doc.id < todayDate) continue;
    const state = await loadPrayerAnswerState(db, {
      personId,
      serviceDate: doc.id,
      todayDate,
      viaAnswerLink: false,
    });
    if (state.ok) {
      items.push({
        purpose: "prayer_request",
        thing: doc.id,
        view: state.view,
      });
    }
  }
  return items;
}

module.exports = {
  applyReply,
  loadPrayerAnswerState,
  saveFormAnswer,
  openItemsForPerson,
};
