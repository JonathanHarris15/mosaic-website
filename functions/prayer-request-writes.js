/**
 * @fileoverview Firestore writes for a Prayer Request (MS-513). Reply path
 * and page (form) path share the note decision so a second note is never
 * minted. No network — the caller sends any thank-you.
 */

const pr = require("./prayer-request");

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
 * Apply a texted reply: fill once, generate one note, record noteId.
 * @param {FirebaseFirestore.Firestore} db
 * @param {Object} args personId, serviceDate, replyText, now
 * @return {Promise<{filled: boolean, noteId: ?string}>}
 */
async function applyReply(db, args) {
  const text = String(args.replyText || "").trim();
  const {personId, serviceDate} = args;
  if (!personId || !serviceDate || !text) {
    return {filled: false, noteId: null};
  }
  const personRef = db.collection("people").doc(personId);
  const reqRef = requestRef(db, personId, serviceDate);
  const [personSnap, reqSnap] = await Promise.all([
    personRef.get(), reqRef.get(),
  ]);
  if (reqSnap.exists && (reqSnap.data().prayerRequest || "").trim()) {
    return {filled: false, noteId: null};
  }
  const personName = personSnap.exists ? (personSnap.data().name || "") : "";
  const note = pr.buildPrayerRequestNote({
    personName, serviceDate, requestText: text,
  });
  const now = args.now || new Date();
  const noteRef = personRef.collection("shepherding_notes").doc();
  await noteRef.set({
    type: note.type,
    subject: note.subject,
    content: note.content,
    contentJson: note.contentJson,
    authorName: "Prayer Request (texted)",
    authorUid: null,
    createdAt: now,
  });
  await reqRef.set({
    serviceDate,
    prayerRequest: text,
    prayerRequestSource: "reply",
    requestFilledAt: now,
    noteGenerated: true,
    noteId: noteRef.id,
    noteGeneratedText: text,
  }, {merge: true});
  await personRef.update({lastNoteAt: now});
  return {filled: true, noteId: noteRef.id};
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
  const liturgy = svcSnap.exists ? (svcSnap.data().liturgy || {}) : {};
  const personSnap = await db.collection("people").doc(personId).get();
  const reqSnap = await requestRef(db, personId, serviceDate).get();
  const req = reqSnap.exists ? reqSnap.data() : {};
  const viaAnswerLink = args.viaAnswerLink !== false;
  const may = pr.mayAnswerPrayerRequest({
    personId,
    serviceDate,
    todayDate,
    liturgy,
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
  const now = args.now || new Date();
  const personRef = db.collection("people").doc(personId);
  const reqRef = requestRef(db, personId, serviceDate);
  const req = loaded.req || {};
  const hadRequestBefore = !!(req.prayerRequest || "").trim();

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

  let noteId = req.noteId || null;
  let noteGeneratedText = req.noteGeneratedText || null;
  const personName = loaded.personSnap && loaded.personSnap.exists ?
    (loaded.personSnap.data().name || "") : "";
  const note = pr.buildPrayerRequestNote({
    personName, serviceDate, requestText: text,
  });

  if (decision.action === "create") {
    const noteRef = personRef.collection("shepherding_notes").doc();
    await noteRef.set({
      type: note.type,
      subject: note.subject,
      content: note.content,
      contentJson: note.contentJson,
      authorName: "Prayer Request (form)",
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
    prayerRequestSource: "form",
    requestFilledAt: req.requestFilledAt || now,
    changedAt: now,
    noteGenerated: true,
    noteId,
    noteGeneratedText,
  }, {merge: true});

  const after = await loadPrayerAnswerState(db, args);
  return {ok: true, view: after.view, noteId};
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
