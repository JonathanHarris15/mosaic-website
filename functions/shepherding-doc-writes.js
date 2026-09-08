/**
 * The Document Library, from the server (MS-278).
 *
 * Elder Documents and the folder tree they live in — and `addPersonPanel`,
 * which is the tool this whole ticket exists for: one meeting transcript
 * becomes one Meeting Minutes document with a Shepherding Note landing on each
 * Person named in it, in a single agent run, with nobody typing anything into
 * the Shepherding System.
 *
 * ⚠ TWO PLACES, ONE ACT. A document is a record in `elder_documents`; where it
 * SITS is a node in the single `elder_document_structure/root` tree. Creating
 * one is therefore two writes and forgetting the second produces a document
 * that exists and cannot be found. The tree walking is
 * shared/shepherding-documents-core.js, the same pure engine both library pages
 * use — the persistence is the only part that is ours.
 *
 * ⚠ THE STRUCTURE DOCUMENT IS REWRITTEN WHOLE. That is the Library's existing
 * design (ADR-0054 contrasts it with Forms deliberately), and it is safe for a
 * handful of elders clicking. An agent moving documents in a loop makes a
 * lost-update race likelier, so every tree change here happens inside a
 * Firestore transaction — read, change, write, one atom. The page does not do
 * this and does not need to; an agent does.
 *
 * ⚠ THE AUTHOR RULE IS THE CORE'S, NOT OURS. `buildElderDocument` refuses a
 * document it cannot attribute rather than emitting one (MS-283). Every create
 * here goes through it.
 */

// ⚠ THE FIRESTORE SENTINELS ARE PASSED IN, NEVER REACHED FOR. `functions/`
// carries its own node_modules, so a `require("firebase-admin")` here would
// be a different copy from whatever made the Firestore handle, and every
// write would fail to serialise its own server timestamp. Same convention
// liturgy-writes.js and service-read.js already follow. See mcp-firestore.js.
const F = require("./mcp-firestore.js");

const DocsCore = require("./shared/shepherding-documents-core.js");
const DocumentBodyCore = require("./shared/document-body-core.js");
const NoteMarkdownCore = require("./shared/note-markdown-core.js");
const Actor = require("./mcp-actor.js");
const {refuse, loadPerson} = require("./shepherding-writes.js");

const DOCUMENTS = "elder_documents";
const STRUCTURE = "elder_document_structure";
const STRUCTURE_DOC = "root";
const PEOPLE = "people";
const NOTES = "shepherding_notes";

/** The folder tree, or an empty one the first time anybody looks. */
async function loadTree(db) {
  const snap = await db.collection(STRUCTURE).doc(STRUCTURE_DOC).get();
  const data = snap.exists ? snap.data() : null;
  return (data && data.children) ? data : {children: []};
}

/**
 * Read the tree, change it, write it back — as one atom.
 *
 * @param {object} db the Firestore handle
 * @param {function(object): *} change given the tree, mutates it; whatever it
 *   returns is handed back to the caller. Throw to abort the whole thing.
 * @return {Promise<*>} what `change` returned
 */
async function withTree(db, change) {
  const ref = db.collection(STRUCTURE).doc(STRUCTURE_DOC);
  let result = null;
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() : null;
    const tree = (data && data.children) ? data : {children: []};
    result = change(tree);
    tx.set(ref, {children: tree.children});
  });
  return result;
}

/** An Elder Document, or a refusal. */
async function loadDocument(db, documentId) {
  if (!documentId) throw refuse("No document id was given.");
  const ref = db.collection(DOCUMENTS).doc(documentId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw refuse(
        `No Elder Document with id "${documentId}". Use shep_list_documents ` +
        "to see what the Library holds.");
  }
  return {ref, data: snap.data() || {}};
}

/** One document, as a row in a listing. */
function documentRow(id, data) {
  return {
    documentId: id,
    title: data.title || "Untitled Document",
    docType: data.docType || "note",
    author: data.authorName || "",
    ownerPersonId: data.ownerPersonId || null,
    writtenVia: data.writtenVia || "page",
    preview: DocumentBodyCore.bodyPreview(data.contentJson, 120),
  };
}

/**
 * What is in the Library, or in one Folder of it.
 *
 * @param {object} db the Firestore handle
 * @param {object} args
 * @param {?string} [args.folderId] the Folder to look in; the top level if absent
 * @param {boolean} [args.recursive] every document at any depth below it
 * @return {Promise<object>} folders and documents
 */
async function listDocuments(db, {folderId, recursive}) {
  const tree = await loadTree(db);
  const node = folderId && folderId !== DocsCore.ROOT ?
    DocsCore.getFolderById(tree, folderId) : tree;
  if (!node) throw refuse(`No Folder with id "${folderId}".`);

  const docIds = recursive ?
    DocsCore.getAllDocIds(node) :
    (node.children || []).filter((c) => c.type === "document").map((c) => c.id);

  const snaps = await Promise.all(docIds.map(
      (id) => db.collection(DOCUMENTS).doc(id).get()));

  return {
    folderId: folderId || DocsCore.ROOT,
    folderName: node.name || "Document Library",
    folders: (node.children || [])
        .filter((c) => c.type === "folder")
        .map((c) => ({folderId: c.id, name: c.name || "", items: (c.children || []).length})),
    documents: snaps
        .filter((s) => s.exists)
        .map((s) => documentRow(s.id, s.data())),
    // A tree node pointing at a document that no longer exists is possible —
    // the two live in different places. Said out loud rather than silently
    // shortening the list.
    danglingIds: snaps.filter((s) => !s.exists).map((s) => s.id),
  };
}

/**
 * One Elder Document, Note Body and all.
 * @param {object} db the Firestore handle
 * @param {object} args documentId
 * @return {Promise<object>} the document
 */
async function getDocument(db, {documentId}) {
  const {data} = await loadDocument(db, documentId);
  return Object.assign(documentRow(documentId, data), {
    body: NoteMarkdownCore.toMarkdown(data.contentJson),
    // A Care List and a Form Document carry a payload instead of prose, and
    // reading their body as markdown would say nothing. Their own tools open
    // them properly.
    payload: data.docType === "care-list" ? "Use shep_get_care_list." :
      data.docType === "form" ? "Use shep_get_form_document." : null,
  });
}

/**
 * A new Elder Document.
 *
 * @param {object} db the Firestore handle
 * @param {object} args title, markdown, folderId, ownerPersonId, actor
 * @return {Promise<object>} { ok, documentId }
 */
async function createDocument(db, {title, markdown, folderId, ownerPersonId, actor}) {
  if (ownerPersonId) await loadPerson(db, ownerPersonId);

  const record = DocsCore.buildElderDocument({
    title: String(title || "").trim() || undefined,
    docType: "note",
    author: {uid: actor.uid, name: actor.name},
    timestamp: F.now(),
    ownerPersonId: ownerPersonId || null,
  });

  record.contentJson = markdown ?
    NoteMarkdownCore.fromMarkdown(markdown) : NoteMarkdownCore.emptyBody();

  const ref = db.collection(DOCUMENTS).doc();
  await ref.set(Object.assign({}, record, Actor.provenance()));

  const filed = await withTree(db, (tree) => {
    const target = folderId && folderId !== DocsCore.ROOT ?
      DocsCore.getFolderById(tree, folderId) : tree;
    if (!target) return false;
    if (!target.children) target.children = [];
    target.children.push({type: "document", id: ref.id});
    return true;
  });

  if (!filed) {
    // The record exists but nothing points at it. Put it at the top level
    // rather than leaving a document nobody can reach.
    await withTree(db, (tree) => DocsCore.fileInRoot(tree, ref.id));
  }

  return {
    ok: true,
    documentId: ref.id,
    title: record.title,
    folderId: filed ? (folderId || DocsCore.ROOT) : DocsCore.ROOT,
    note: filed ? undefined :
      `No Folder "${folderId}" — the document was filed at the top level.`,
  };
}

/**
 * Replace an Elder Document's body, its title, or both.
 * @param {object} db the Firestore handle
 * @param {object} args documentId, title, markdown, actor
 * @return {Promise<object>} { ok, documentId }
 */
async function updateDocument(db, {documentId, title, markdown, actor}) {
  const {ref, data} = await loadDocument(db, documentId);
  refuseIfNotProse(data, "written into");

  const update = {updatedAt: F.now(), updatedByName: actor.name};
  if (title !== undefined && title !== null) update.title = String(title).trim();
  if (markdown !== undefined && markdown !== null) {
    update.contentJson = NoteMarkdownCore.fromMarkdown(String(markdown));
  }

  await ref.update(Object.assign(update, Actor.provenance()));
  return {ok: true, documentId};
}

/**
 * Add to the end of an Elder Document rather than replacing it.
 * @param {object} db the Firestore handle
 * @param {object} args documentId, markdown, actor
 * @return {Promise<object>} { ok, documentId }
 */
async function appendToDocument(db, {documentId, markdown, actor}) {
  const {ref, data} = await loadDocument(db, documentId);
  refuseIfNotProse(data, "written into");

  const body = String(markdown || "").trim();
  if (!body) throw refuse("There is nothing to add.");

  await ref.update(Object.assign({
    contentJson: NoteMarkdownCore.appendMarkdown(data.contentJson, body),
    updatedAt: F.now(),
    updatedByName: actor.name,
  }, Actor.provenance()));

  return {ok: true, documentId};
}

/** A Care List and a Form Document hold a payload, not prose. */
function refuseIfNotProse(data, what) {
  const docType = data.docType || "note";
  if (docType === "note") return;
  throw refuse(
      `That is a ${docType === "care-list" ? "Care List" : "Form Document"}, ` +
      `which holds its own payload rather than a Note Body, so it cannot be ` +
      `${what} this way.`);
}

/**
 * Change an Elder Document's title.
 * @param {object} db the Firestore handle
 * @param {object} args documentId, title, actor
 * @return {Promise<object>} { ok, documentId, title }
 */
async function renameDocument(db, {documentId, title, actor}) {
  const {ref} = await loadDocument(db, documentId);
  const name = String(title || "").trim();
  if (!name) throw refuse("A document needs a title.");
  await ref.update(Object.assign(
      {title: name, updatedAt: F.now(), updatedByName: actor.name},
      Actor.provenance()));
  return {ok: true, documentId, title: name};
}

/**
 * Move a document into a Folder. Only the tree changes; the record does not.
 * @param {object} db the Firestore handle
 * @param {object} args documentId, folderId
 * @return {Promise<object>} { ok }
 */
async function moveDocument(db, {documentId, folderId}) {
  await loadDocument(db, documentId);
  const moved = await withTree(db, (tree) => DocsCore.moveNode(
      tree, {type: "document", id: documentId}, folderId || DocsCore.ROOT));
  if (!moved) throw refuse(`No Folder with id "${folderId}".`);
  return {ok: true, documentId, folderId: folderId || DocsCore.ROOT};
}

/**
 * Delete an Elder Document, and unhook it from the tree.
 *
 * ⚠ THE PAGE ASKS FIRST AND THIS CANNOT, so the title comes back in the result.
 *
 * @param {object} db the Firestore handle
 * @param {object} args documentId
 * @return {Promise<object>} what was deleted
 */
async function deleteDocument(db, {documentId}) {
  const {ref, data} = await loadDocument(db, documentId);
  await withTree(db, (tree) => DocsCore.removeFromTree(tree, documentId));
  await ref.delete();
  return {
    ok: true,
    deleted: {documentId, title: data.title || "", docType: data.docType || "note"},
    note: "Shepherding Notes made from Person Panels in this document stay on " +
      "their People — they are the record, this was the meeting.",
  };
}

// ── Folders ────────────────────────────────────────────────────────────────

/**
 * A new Folder.
 * @param {object} db the Firestore handle
 * @param {object} args name, parentFolderId
 * @return {Promise<object>} { ok, folderId }
 */
async function createFolder(db, {name, parentFolderId}) {
  const label = String(name || "").trim();
  if (!label) throw refuse("A folder needs a name.");

  const folderId = DocsCore.newId();
  const made = await withTree(db, (tree) => {
    const parent = parentFolderId && parentFolderId !== DocsCore.ROOT ?
      DocsCore.getFolderById(tree, parentFolderId) : tree;
    if (!parent) return false;
    if (!parent.children) parent.children = [];
    parent.children.push({type: "folder", id: folderId, name: label, children: []});
    return true;
  });

  if (!made) throw refuse(`No Folder with id "${parentFolderId}" to put it in.`);
  return {ok: true, folderId, name: label};
}

/**
 * Rename a Folder.
 * @param {object} db the Firestore handle
 * @param {object} args folderId, name
 * @return {Promise<object>} { ok, folderId, name }
 */
async function renameFolder(db, {folderId, name}) {
  const label = String(name || "").trim();
  if (!label) throw refuse("A folder needs a name.");

  const renamed = await withTree(db, (tree) => {
    const folder = DocsCore.getFolderById(tree, folderId);
    if (!folder) return false;
    folder.name = label;
    return true;
  });

  if (!renamed) throw refuse(`No Folder with id "${folderId}".`);
  return {ok: true, folderId, name: label};
}

/**
 * Move a Folder, and everything under it, into another Folder.
 * @param {object} db the Firestore handle
 * @param {object} args folderId, targetFolderId
 * @return {Promise<object>} { ok }
 */
async function moveFolder(db, {folderId, targetFolderId}) {
  const target = targetFolderId || DocsCore.ROOT;

  const moved = await withTree(db, (tree) => {
    const folder = DocsCore.getFolderById(tree, folderId);
    if (!folder) throw refuse(`No Folder with id "${folderId}".`);

    // ⚠ A FOLDER CANNOT BE MOVED INSIDE ITSELF. The tree would stop being a
    // tree, and because moveNode lifts the subtree out BEFORE looking for the
    // target, the target goes with it — so everything under the folder drops
    // out of the Library at once and the failure reads as "no such folder".
    //
    // ⚠ THREE ARGUMENTS, AND THE ORDER IS NOT OBVIOUS: is `target` a descendant
    // of `folderId`? Called with two, `ancestorId` is undefined, the lookup
    // finds nothing, and the guard quietly answers "no" to every question it is
    // asked. It did exactly that until an emulator test moved a folder into its
    // own child and watched the Library empty.
    if (target === folderId) {
      throw refuse("A folder cannot be moved into itself.");
    }
    if (target !== DocsCore.ROOT && DocsCore.isDescendant(tree, target, folderId)) {
      throw refuse("A folder cannot be moved into one of its own sub-folders.");
    }
    return DocsCore.moveNode(tree, {type: "folder", id: folderId}, target);
  });

  if (!moved) throw refuse(`No Folder with id "${target}".`);
  return {ok: true, folderId, targetFolderId: target};
}

/**
 * Delete a Folder and every Elder Document inside it, at any depth.
 *
 * ⚠ THE PAGE PUTS UP A DIALOG WITH A COUNT AND THIS CANNOT. So the count is
 * refused into the assistant's face instead: without `confirmDocumentCount`
 * matching what is actually in there, nothing is deleted. An agent that has not
 * looked cannot delete forty documents by accident, and an agent that has
 * looked can say exactly what it is about to destroy.
 *
 * @param {object} db the Firestore handle
 * @param {object} args folderId, confirmDocumentCount
 * @return {Promise<object>} what was deleted
 */
async function deleteFolder(db, {folderId, confirmDocumentCount}) {
  const tree = await loadTree(db);
  const folder = DocsCore.getFolderById(tree, folderId);
  if (!folder) throw refuse(`No Folder with id "${folderId}".`);

  const docIds = DocsCore.getAllDocIds(folder);

  if (Number(confirmDocumentCount) !== docIds.length) {
    throw refuse(
        `"${folder.name || folderId}" holds ${docIds.length} document(s), at ` +
        "any depth, and deleting the folder deletes every one of them. Call " +
        `again with confirmDocumentCount: ${docIds.length} if that is really ` +
        "what the elder asked for.");
  }

  await withTree(db, (t) => DocsCore.removeFromTree(t, folderId));
  for (const id of docIds) {
    await db.collection(DOCUMENTS).doc(id).delete();
  }

  return {
    ok: true,
    deleted: {folderId, name: folder.name || "", documents: docIds.length},
  };
}

// ── The Person Panel ───────────────────────────────────────────────────────

/**
 * Put a Person Panel into an Elder Document, creating the Shepherding Note it
 * is linked to.
 *
 * ⚠ THIS IS THE TOOL MS-278 WAS RAISED FOR. An elder meeting produces one
 * document and a note per Person discussed. Done by hand that is the
 * pre-meeting admin the whole ticket is about; done here it is one call per
 * person, and each note lands on that Person's Shepherding Profile carrying
 * `sourceDocumentId` back to the meeting it came from.
 *
 * The panel is an atom node in the document's Note Body. Its body lives in the
 * note, with `bodySnapshot` as the copy the document renders without a second
 * read — a JSON STRING, which is what the editor's node attribute holds.
 *
 * @param {object} db the Firestore handle
 * @param {object} args documentId, personId, noteType, markdown, actor
 * @return {Promise<object>} { ok, noteId }
 */
async function addPersonPanel(db, {documentId, personId, noteType, markdown, actor}) {
  const {ref, data} = await loadDocument(db, documentId);
  refuseIfNotProse(data, "given a Person Panel");
  const person = await loadPerson(db, personId);

  const ShepherdingCore = require("./shared/shepherding-core.js");
  const type = String(noteType || "Elder Meeting").trim();
  if (!ShepherdingCore.NOTE_TYPES.includes(type)) {
    throw refuse(
        `"${type}" is not a Note Type. Use one of: ` +
        ShepherdingCore.NOTE_TYPES.join(", ") + ".");
  }

  const contentJson = NoteMarkdownCore.fromMarkdown(String(markdown || ""));

  // The note first. A panel pointing at a note that failed to write is the
  // orphan the page has a whole recovery path for; there is no reason to make
  // one deliberately.
  const noteRef = db.collection(PEOPLE).doc(personId).collection(NOTES).doc();
  await noteRef.set(Object.assign({
    type,
    // A Person Panel has no Subject Line — the person's name and the document's
    // title are the context (CONTEXT.md, Person Panel).
    subject: "",
    contentJson,
    content: DocumentBodyCore.plainText(contentJson),
    authorUid: actor.uid,
    authorName: actor.name,
    sourceDocumentId: documentId,
    createdAt: F.now(),
  }, Actor.provenance()));

  const panel = {
    type: "personPanel",
    attrs: {
      personId,
      noteId: noteRef.id,
      personName: person.data.name || "",
      noteType: type,
      bodySnapshot: JSON.stringify(contentJson),
    },
  };

  const body = data.contentJson && data.contentJson.content ?
    data.contentJson : NoteMarkdownCore.emptyBody();

  await ref.update(Object.assign({
    contentJson: {
      type: "doc",
      // A panel appended to the empty paragraph a new document starts with
      // would leave a blank line above every panel.
      content: body.content
          .filter((node, i) => !(i === 0 && node.type === "paragraph" &&
            !(node.content && node.content.length) && body.content.length === 1))
          .concat([panel]),
    },
    updatedAt: F.now(),
    updatedByName: actor.name,
  }, Actor.provenance()));

  return {
    ok: true,
    documentId,
    personId,
    personName: person.data.name || "",
    noteId: noteRef.id,
    noteType: type,
  };
}

module.exports = {
  listDocuments,
  getDocument,
  createDocument,
  updateDocument,
  appendToDocument,
  renameDocument,
  moveDocument,
  deleteDocument,
  createFolder,
  renameFolder,
  moveFolder,
  deleteFolder,
  addPersonPanel,
  // Shared with the Care List and Form Document tools, which are Elder
  // Documents with a different docType.
  loadDocument,
  loadTree,
  withTree,
  documentRow,
};
