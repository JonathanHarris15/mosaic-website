/**
 * The assistant waits its turn at a held box (MS-433, ADR-0063).
 *
 * A page refuses to open a box somebody else holds, but only in the browser.
 * The assistant writes from here, so without this it could write into the
 * hymn, cell, question, paragraph or note a person is typing in at that
 * moment — and one of the two versions would quietly win.
 *
 * ⚠ THE PAGES' RULES, NOT A COPY OF THEM. Who holds a box is decided by
 * shared/presence-core.js — a live heartbeat, the Shepherding one-minute idle
 * rule, your own claim never counting — and the box keys are the ones the
 * pages claim (CareListCore, FormDocumentCore, PresenceCore.shepherdingBox,
 * the Elder Document's `document:<id>`). The server and a page therefore
 * cannot disagree about whether a box is held.
 *
 * ⚠ PRESENCE MAY REMOVE A LOCK, NEVER AN EDITOR (ADR-0035 §3). If presence
 * cannot be read, nobody is demonstrably in the box, and the write goes ahead.
 *
 * Check-then-write is not atomic: somebody could claim a box in the instant
 * between. Accepted — claims are not transactional on the pages either, and a
 * page adopts the new value live before its holder has typed into it.
 *
 * It only ever reads.
 */

const {PresenceCore} = require("./shared/presence-core.js");
const DocumentBodyCore = require("./shared/document-body-core.js");
const DocsCore = require("./shared/shepherding-documents-core.js");
const CareListCore = require("./shared/care-list-core.js");
const FormDocumentCore = require("./shared/form-document-core.js");

// Where each area keeps its claims, and the rule it holds them by.
const SHEPHERDING = {
  collection: "shepherding_presence",
  options: {idleMs: PresenceCore.SHEPHERDING_IDLE_MS},
};
const ORDER_OF_SERVICE = {collection: "presence", options: {}};

// A write tool declares that it writes no box by passing this.
const NO_BOX = Object.freeze({noBox: true});

/**
 * Everybody's presence in one area, or null if it could not be read.
 * @param {object} db the Firestore handle
 * @param {string} collection the presence collection
 * @return {Promise<?Array<object>>} entries, each with its uid
 */
async function readEntries(db, collection) {
  try {
    const snap = await db.collection(collection).get();
    return snap.docs.map((d) => Object.assign({uid: d.id}, d.data()));
  } catch (e) {
    console.warn(`Presence (${collection}) could not be read; not checking boxes:`, e);
    return null;
  }
}

/**
 * Who else holds any of these boxes or scopes.
 *
 * @param {object} db the Firestore handle
 * @param {object} args
 * @param {string} args.uid the caller, whose own claims never count
 * @param {Array<object>} [args.boxes] {scopeKey, boxKey, what}
 * @param {Array<object>} [args.scopes] {scopeKey, what} — any box inside
 * @param {object} [args.area] SHEPHERDING (default) or ORDER_OF_SERVICE
 * @param {number} [args.nowMs] for tests
 * @return {Promise<Array<object>>} [{name, uid, what, scopeKey, boxKey}]
 */
async function holders(db, {uid, boxes, scopes, area, nowMs}) {
  const wanted = (boxes || []).length + (scopes || []).length;
  if (!wanted) return [];
  const where = area || SHEPHERDING;
  const entries = await readEntries(db, where.collection);
  if (!entries) return [];
  const now = nowMs || Date.now();
  const out = [];
  const seen = {};
  const add = (entry, what) => {
    const key = entry.uid + "|" + what;
    if (seen[key]) return;
    seen[key] = true;
    out.push({
      name: String(entry.name || "").trim() || "Someone",
      uid: entry.uid,
      what,
      scopeKey: entry.scopeKey !== undefined ? entry.scopeKey : entry.dateKey,
      boxKey: entry.boxKey !== undefined ? entry.boxKey : entry.fieldKey,
    });
  };
  (boxes || []).forEach((box) => {
    const holder = PresenceCore.holderOf(entries, uid, box.scopeKey, box.boxKey, now, where.options);
    if (holder) add(holder, box.what);
  });
  (scopes || []).forEach((scope) => {
    PresenceCore.holdersInScope(entries, uid, scope.scopeKey, now, where.options)
        .forEach((holder) => add(holder, scope.what));
  });
  return out;
}

/**
 * The sentence an assistant reads when it is refused. Full names — the elder
 * reading it may know two people with the same first name.
 * @param {Array<object>} held from holders()
 * @return {string} the refusal
 */
function refusalFor(held) {
  const byWhat = {};
  held.forEach((h) => {
    byWhat[h.what] = byWhat[h.what] || [];
    if (byWhat[h.what].indexOf(h.name) === -1) byWhat[h.what].push(h.name);
  });
  const parts = Object.keys(byWhat).map((what) => {
    const names = byWhat[what];
    const who = names.length === 1 ? names[0] :
      names.slice(0, -1).join(", ") + " and " + names[names.length - 1];
    return `${who} ${names.length === 1 ? "is" : "are"} editing ${what}`;
  });
  return parts.join("; ") + " — try again shortly. Tell the elder who is " +
    "working there rather than retrying straight away.";
}

// ── The boxes each kind of write touches ─────────────────────────────────────

/** A note's editor box — which is also its Person Panel's box. */
function noteBox(personId, noteId) {
  return Object.assign(PresenceCore.shepherdingBox.note(personId, noteId), {what: "that note"});
}

/** A Task's editor box. A repeat is one box, named by its series. */
function taskBox(taskId) {
  return Object.assign(PresenceCore.shepherdingBox.task(taskId), {what: "that Task"});
}

/** One Care List cell. */
function careListCellBox(documentId, personId, columnId) {
  return Object.assign(CareListCore.box.cell(documentId, personId, columnId), {what: "that Care List cell"});
}

/** A document's title (every kind of document names it the same way). */
function titleBox(documentId) {
  return Object.assign(FormDocumentCore.box.title(documentId), {what: "the title of that document"});
}

/** One Form Document question. */
function questionBox(documentId, questionId) {
  return Object.assign(FormDocumentCore.box.question(documentId, questionId),
      {what: `question ${questionId}`});
}

/**
 * Every box in one document: anything held under `document:<id>`, and the
 * notes behind its Person Panels, which are held on the profile under the
 * person rather than the document.
 * @param {object} db the Firestore handle
 * @param {string} documentId the document
 * @param {string} what how the refusal names it
 * @return {Promise<object>} {boxes, scopes}
 */
async function documentBoxes(db, documentId, what) {
  const scopes = [{scopeKey: "document:" + documentId, what}];
  const boxes = [];
  try {
    const snap = await db.collection("elder_documents").doc(documentId).get();
    if (snap.exists) {
      panelsOf(DocumentBodyCore.bodyOfRecord(snap.data())).forEach((a) => {
        boxes.push(Object.assign(PresenceCore.shepherdingBox.note(a.personId, a.noteId),
            {what: `the Person Panel for ${a.personName || "somebody"} in ${what}`}));
      });
    }
  } catch (e) {
    // The document's own scope is still checked; its panels are a courtesy.
  }
  return {boxes, scopes};
}

function panelsOf(body) {
  const out = [];
  (function walk(node) {
    if (!node) return;
    if (node.type === "personPanel" && node.attrs && node.attrs.personId && node.attrs.noteId) {
      out.push(node.attrs);
    }
    (node.content || []).forEach(walk);
  })(body);
  return out;
}

/**
 * Every box in every document inside a Folder, at any depth.
 * @param {object} db the Firestore handle
 * @param {object} tree the Library tree
 * @param {string} folderId the Folder
 * @return {Promise<object>} {boxes, scopes}
 */
async function folderBoxes(db, tree, folderId) {
  const folder = DocsCore.getFolderById(tree, folderId);
  if (!folder) return {boxes: [], scopes: []};
  const all = {boxes: [], scopes: []};
  for (const id of DocsCore.getAllDocIds(folder)) {
    const one = await documentBoxes(db, id, "a document in that Folder");
    all.boxes.push(...one.boxes);
    all.scopes.push(...one.scopes);
  }
  return all;
}

/**
 * The Order of Service boxes a liturgy or note write touches. A slot is held
 * as `liturgy.<field>` on the Order of Service page and as either that or the
 * bare field on the Services page, so both are checked.
 * @param {string} dateKey the Sunday
 * @param {Array<string>} fields the fields or elements written
 * @return {Array<object>} boxes
 */
function liturgyBoxes(dateKey, fields) {
  const out = [];
  (fields || []).forEach((field) => {
    const what = `${field} on ${dateKey}`;
    out.push({scopeKey: dateKey, boxKey: "liturgy." + field, what});
    out.push({scopeKey: dateKey, boxKey: field, what});
  });
  return out;
}

module.exports = {
  NO_BOX,
  SHEPHERDING,
  ORDER_OF_SERVICE,
  holders,
  refusalFor,
  noteBox,
  taskBox,
  careListCellBox,
  titleBox,
  questionBox,
  documentBoxes,
  folderBoxes,
  liturgyBoxes,
};
