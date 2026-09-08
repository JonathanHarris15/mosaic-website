/**
 * The shepherding surfaces that carry a payload instead of prose (MS-278).
 *
 * Three groups of tools, in one file because they are one idea used three
 * times. A Form Document and a Care List are both an Elder Document with a
 * different `docType` and something other than a Note Body inside (ADR-0055
 * says exactly that), and a Filtered View is the filter a Care List reads,
 * standing on its own. Splitting them across three files would have put the
 * same filter shape in three places.
 *
 *   FORM DOCUMENTS   a Form Template filled in once — an Elder Interview, not a
 *                    poll. It keeps a COPY of the template's questions, so
 *                    editing the template afterwards never reaches a document
 *                    already written (ADR-0055).
 *
 *   CARE LISTS       a filtered list of People with elder-written cells beside
 *                    each. ⚠ Cell content is PRIVATE TO THE DOCUMENT and does
 *                    not reach anybody's Shepherding Profile. That was raised
 *                    as the weakest reason to give an assistant a tool and
 *                    accepted anyway (2026-09-04), so the tool descriptions
 *                    point at shep_write_note for anything that should be
 *                    findable from the Person's side.
 *
 *   FILTERED VIEWS   ⚠ SHARED, NOT PERSONAL. A view appears as a table widget
 *                    on EVERY elder's Shepherd Landing Page. An assistant
 *                    making a scratch view to answer a question has redecorated
 *                    everybody's landing page, so the tools say so.
 *
 * Follow-up Reminders are here too, being the landing page's other furniture.
 * They disappear on their own after their due date, which makes a wrong one
 * self-cleaning and is why they need no confirmation an agent cannot give.
 */

// ⚠ THE FIRESTORE SENTINELS ARE PASSED IN, NEVER REACHED FOR. `functions/`
// carries its own node_modules, so a `require("firebase-admin")` here would
// be a different copy from whatever made the Firestore handle, and every
// write would fail to serialise its own server timestamp. Same convention
// liturgy-writes.js and service-read.js already follow. See mcp-firestore.js.
const F = require("./mcp-firestore.js");

const FormsCore = require("./shared/forms-core.js");
const DocsCore = require("./shared/shepherding-documents-core.js");
const NoteMarkdownCore = require("./shared/note-markdown-core.js");
const Actor = require("./mcp-actor.js");
const {refuse, loadPerson} = require("./shepherding-writes.js");
const {loadDocument, withTree} = require("./shepherding-doc-writes.js");
const Read = require("./shepherding-read.js");

const DOCUMENTS = "elder_documents";
const FORMS = "forms";
const VIEWS = "shepherding_views";
const REMINDERS = "shepherding_reminders";

// The one column a Care List has before an elder adds any of their own.
const DEFAULT_COLUMN = {id: "col_default", name: "Notes"};

// ═══════════════════════════════════════════════════════════════════════════
//  Form Documents
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The Form Templates that can be filled in as a document.
 *
 * A `responses` form is a survey a stranger answers, and is not something an
 * elder starts a document from — so only `document`-mode templates are listed,
 * which is what the New Document menu offers.
 *
 * @param {object} db the Firestore handle
 * @return {Promise<object>} { count, templates }
 */
async function listFormTemplates(db) {
  const snap = await db.collection(FORMS).get();
  const templates = snap.docs
      .map((doc) => Object.assign({id: doc.id}, doc.data()))
      .filter((form) => FormsCore.isDocumentMode(form))
      .map((form) => ({
        templateId: form.id,
        title: form.title || "Untitled form",
        shepherdingDoc: !!form.shepherdingDoc,
        questions: (form.questions || [])
            .filter((q) => q && !q.retired)
            .map(questionRow),
      }));

  templates.sort((a, b) => a.title.localeCompare(b.title));
  return {count: templates.length, templates};
}

/** One question, as much of it as an assistant needs to answer it. */
function questionRow(question) {
  return {
    questionId: question.id,
    text: question.text || "",
    type: question.type,
    required: !!question.required,
    options: question.options || undefined,
    // Said plainly, because these two are the ones an agent cannot do.
    answerable: FormsCore.asksSomething(question.type) &&
      question.type !== "file" && question.type !== "image",
  };
}

/**
 * Start a Form Document from a template.
 *
 * ⚠ THE QUESTIONS ARE COPIED, NEVER REFERENCED (ADR-0055). A record has to keep
 * the question it was actually asked. Editing the template a year later must
 * not reach into an interview already written, and a document whose template
 * has since been deleted still has to open.
 *
 * @param {object} db the Firestore handle
 * @param {object} args templateId, personId, title, folderId, actor
 * @return {Promise<object>} { ok, documentId }
 */
async function createFormDocument(db, {templateId, personId, title, folderId, actor}) {
  const snap = await db.collection(FORMS).doc(templateId).get();
  if (!snap.exists) throw refuse(`No Form Template with id "${templateId}".`);

  const template = Object.assign({id: templateId}, snap.data());
  if (!FormsCore.isDocumentMode(template)) {
    throw refuse(
        `"${template.title || templateId}" is a form people answer, not one ` +
        "filled in once as a record, so no document can be started from it.");
  }

  let subject = null;
  if (personId) {
    const person = await loadPerson(db, personId);
    subject = {personId, name: person.data.name || ""};
  }

  const shepherding = !!template.shepherdingDoc;
  if (shepherding && !personId) {
    throw refuse(
        `"${template.title || templateId}" is a personal shepherding ` +
        "document — it has to be about somebody. Give a personId.");
  }

  const record = DocsCore.buildElderDocument({
    title: String(title || "").trim() || template.title || "New Document",
    docType: "form",
    author: {uid: actor.uid, name: actor.name},
    timestamp: F.now(),
    ownerPersonId: personId || null,
    templateId,
    questions: template.questions || null,
    shepherdingDoc: shepherding,
    answers: subject ? {[FormsCore.SUBJECT_QUESTION_ID]: subject} : null,
    inLibrary: shepherding ? true : null,
  });

  const ref = db.collection(DOCUMENTS).doc();
  await ref.set(Object.assign({}, record, Actor.provenance()));
  await withTree(db, (tree) => {
    const target = folderId && folderId !== DocsCore.ROOT ?
      DocsCore.getFolderById(tree, folderId) : tree;
    const parent = target || tree;
    if (!parent.children) parent.children = [];
    parent.children.push({type: "document", id: ref.id});
    return true;
  });

  return {
    ok: true,
    documentId: ref.id,
    title: record.title,
    personId: personId || null,
    questions: (record.questions || []).filter((q) => !q.retired).map(questionRow),
  };
}

/**
 * A Form Document, its questions and whatever has been answered so far.
 * @param {object} db the Firestore handle
 * @param {object} args documentId
 * @return {Promise<object>} the document
 */
async function getFormDocument(db, {documentId}) {
  const {data} = await loadDocument(db, documentId);
  if ((data.docType || "note") !== "form") {
    throw refuse("That is not a Form Document.");
  }

  const answers = data.answers || {};
  return {
    documentId,
    title: data.title || "",
    templateId: data.templateId || null,
    ownerPersonId: data.ownerPersonId || null,
    author: data.authorName || "",
    writtenVia: data.writtenVia || "page",
    questions: (data.questions || []).map((q) => Object.assign(questionRow(q), {
      answer: q.id in answers ? answers[q.id] : null,
      // A retired question keeps its column because it still holds an answer.
      retired: !!q.retired,
    })),
  };
}

/**
 * Fill in, or change, a Form Document's answers.
 *
 * ⚠ AN UPLOAD IS SKIPPED AND SAID TO BE SKIPPED. A `file` or `image` question
 * wants bytes; an assistant has none. Leaving it silently blank would look like
 * an answered form with a gap, so it comes back in `skipped` instead.
 *
 * ⚠ ONLY THE ANSWERS MOVE. The questions are the record's own copy and are
 * never rewritten from here.
 *
 * @param {object} db the Firestore handle
 * @param {object} args documentId, answers (by question id), actor
 * @return {Promise<object>} what was answered and what was not
 */
async function answerFormDocument(db, {documentId, answers, actor}) {
  const {ref, data} = await loadDocument(db, documentId);
  if ((data.docType || "note") !== "form") {
    throw refuse("That is not a Form Document.");
  }

  const questions = data.questions || [];
  const byId = {};
  questions.forEach((q) => {
    if (q && q.id) byId[q.id] = q;
  });

  const merged = Object.assign({}, data.answers || {});
  const skipped = [];
  const proposed = {};

  for (const [questionId, value] of Object.entries(answers || {})) {
    const question = byId[questionId];
    if (!question) {
      skipped.push({questionId, why: "this document does not ask that"});
      continue;
    }
    if (!FormsCore.asksSomething(question.type)) {
      skipped.push({questionId, why: "a section heading asks nothing"});
      continue;
    }
    if (question.type === "file" || question.type === "image") {
      skipped.push({questionId, why: "an upload needs a file, which an assistant has none of"});
      continue;
    }
    proposed[questionId] = value;
  }

  // The same check the fill-in page runs, from the same module, so an assistant
  // cannot put a value into a document a person could not — a date that is not
  // a date, a choice that was never offered.
  const problems = FormsCore.answerProblems(
      {mode: "document", questions}, proposed);
  problems.forEach((problem) => {
    delete proposed[problem.id];
    skipped.push({questionId: problem.id, why: problem.why});
  });

  Object.assign(merged, proposed);
  const answered = Object.keys(proposed);

  await ref.update(Object.assign({
    answers: merged,
    updatedAt: F.now(),
    updatedByName: actor.name,
  }, Actor.provenance()));

  return {ok: true, documentId, answered, skipped};
}

// ═══════════════════════════════════════════════════════════════════════════
//  Care Lists
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The filter shape a Care List and a Filtered View both take.
 *
 * One reader, so the two cannot come to disagree about what a filter is — and
 * so it matches what shep_list_people accepts, which is how an assistant can
 * try a filter out before saving it to everybody's landing page.
 *
 * @param {object} filter whatever the caller gave
 * @return {object} the stored shape
 */
function filterConfig(filter) {
  const f = filter || {};
  return {
    filterTags: (f.tagIds || f.filterTags || []).filter(Boolean),
    filterMode: f.tagMode === "all" || f.filterMode === "all" ? "all" : "any",
    statusZoneFilters: (f.statusZones || f.statusZoneFilters || []).filter(Boolean),
    tagHoldFilters: f.tagHoldFilters || {},
    tagHoldCmp: f.tagHoldCmp || {},
    sortBy: "name",
  };
}

/**
 * A new Care List.
 * @param {object} db the Firestore handle
 * @param {object} args title, filter, viewId, columns, folderId, actor
 * @return {Promise<object>} { ok, documentId }
 */
async function createCareList(db, {title, filter, viewId, columns, folderId, actor}) {
  const record = DocsCore.buildElderDocument({
    title: String(title || "").trim() || "New Care List",
    docType: "care-list",
    author: {uid: actor.uid, name: actor.name},
    timestamp: F.now(),
    filterId: viewId || null,
    filterConfig: viewId ? null : filterConfig(filter),
  });

  record.careListColumns = (columns || []).length ?
    columns.map((name, i) => ({id: "col_" + (i + 1), name: String(name)})) :
    [Object.assign({}, DEFAULT_COLUMN)];
  record.careListData = {};

  const ref = db.collection(DOCUMENTS).doc();
  await ref.set(Object.assign({}, record, Actor.provenance()));
  await withTree(db, (tree) => {
    const target = folderId && folderId !== DocsCore.ROOT ?
      DocsCore.getFolderById(tree, folderId) : tree;
    const parent = target || tree;
    if (!parent.children) parent.children = [];
    parent.children.push({type: "document", id: ref.id});
    return true;
  });

  return {
    ok: true,
    documentId: ref.id,
    title: record.title,
    columns: record.careListColumns,
  };
}

/** One Care List, or a refusal. */
async function loadCareList(db, documentId) {
  const {ref, data} = await loadDocument(db, documentId);
  if ((data.docType || "note") !== "care-list") {
    throw refuse("That is not a Care List.");
  }
  return {ref, data};
}

/** The Care List's columns, in the shape the editor stores them. */
function columnsOf(data) {
  return (data.careListColumns && data.careListColumns.length) ?
    data.careListColumns : [Object.assign({}, DEFAULT_COLUMN)];
}

/**
 * A Care List: who is on it, and what each cell says.
 * @param {object} db the Firestore handle
 * @param {object} args documentId
 * @return {Promise<object>} the list
 */
async function getCareList(db, {documentId}) {
  const {data} = await loadCareList(db, documentId);

  let filter = data.filterConfig || null;
  if (data.filterId) {
    const view = await db.collection(VIEWS).doc(data.filterId).get();
    filter = view.exists ? view.data() : null;
  }

  const columns = columnsOf(data);
  const listed = filter ? await Read.listPeople(db, {
    tagIds: filter.filterTags || [],
    tagMode: filter.filterMode || "any",
    statusZones: filter.statusZoneFilters || [],
    limit: 500,
  }) : {people: []};

  const cells = data.careListData || {};
  return {
    documentId,
    title: data.title || "",
    columns,
    rows: listed.people.map((person) => ({
      personId: person.personId,
      name: person.name,
      cells: columns.reduce((out, column) => {
        const body = (cells[person.personId] || {})[column.id];
        out[column.id] = body ? NoteMarkdownCore.toMarkdown(body) : "";
        return out;
      }, {}),
    })),
    note: "Cell content lives in this document only — it does not reach " +
      "anybody's Shepherding Profile. Use shep_write_note for anything that " +
      "should be findable from the Person's side.",
  };
}

/**
 * Add a column to a Care List.
 * @param {object} db the Firestore handle
 * @param {object} args documentId, name, actor
 * @return {Promise<object>} { ok, columns }
 */
async function addCareListColumn(db, {documentId, name, actor}) {
  const {ref, data} = await loadCareList(db, documentId);
  const label = String(name || "").trim();
  if (!label) throw refuse("A column needs a name.");

  const columns = columnsOf(data);
  // Ids are positional and must not collide with one already in use, including
  // one whose column was removed — a reused id would inherit its old cells.
  const used = new Set(columns.map((c) => c.id));
  let n = columns.length + 1;
  while (used.has("col_" + n)) n += 1;

  const added = {id: "col_" + n, name: label};
  await ref.update(Object.assign({
    careListColumns: columns.concat([added]),
    updatedAt: F.now(),
    updatedByName: actor.name,
  }, Actor.provenance()));

  return {ok: true, documentId, column: added, columns: columns.concat([added])};
}

/**
 * Write one Person's cell in a Care List.
 * @param {object} db the Firestore handle
 * @param {object} args documentId, personId, columnId, markdown, actor
 * @return {Promise<object>} { ok }
 */
async function writeCareListCell(db, {documentId, personId, columnId, markdown, actor}) {
  const {ref, data} = await loadCareList(db, documentId);
  await loadPerson(db, personId);

  const columns = columnsOf(data);
  const column = columnId ?
    columns.find((c) => c.id === columnId) : columns[0];
  if (!column) {
    throw refuse(
        `No column "${columnId}" on that Care List. It has: ` +
        columns.map((c) => `${c.id} (${c.name})`).join(", ") + ".");
  }

  const cells = Object.assign({}, data.careListData || {});
  cells[personId] = Object.assign({}, cells[personId] || {}, {
    [column.id]: NoteMarkdownCore.fromMarkdown(String(markdown || "")),
  });

  await ref.update(Object.assign({
    careListData: cells,
    updatedAt: F.now(),
    updatedByName: actor.name,
  }, Actor.provenance()));

  return {ok: true, documentId, personId, columnId: column.id};
}

// ═══════════════════════════════════════════════════════════════════════════
//  Filtered Views and Follow-up Reminders
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Every Filtered View on the Shepherd Landing Page.
 * @param {object} db the Firestore handle
 * @return {Promise<object>} { count, views }
 */
async function listViews(db) {
  const snap = await db.collection(VIEWS).orderBy("createdAt", "asc").get();
  return {
    count: snap.docs.length,
    views: snap.docs.map((doc) => {
      const data = doc.data();
      return {
        viewId: doc.id,
        title: data.title || "",
        tagIds: data.filterTags || [],
        tagMode: data.filterMode || "any",
        statusZones: data.statusZoneFilters || [],
        createdBy: data.createdByName || "",
      };
    }),
  };
}

/**
 * A new Filtered View.
 *
 * ⚠ EVERY ELDER SEES THIS. It is a widget on the shared Shepherd Landing Page,
 * not a private saved search. An assistant wanting to answer a question about
 * who matches a filter should call shep_list_people, which changes nothing.
 *
 * @param {object} db the Firestore handle
 * @param {object} args title, filter, actor
 * @return {Promise<object>} { ok, viewId }
 */
async function createView(db, {title, filter, actor}) {
  const label = String(title || "").trim();
  if (!label) throw refuse("A Filtered View needs a title.");

  const ref = await db.collection(VIEWS).add(Object.assign(
      filterConfig(filter),
      {
        title: label,
        createdBy: actor.uid,
        createdByName: actor.name,
        createdAt: F.now(),
      },
      Actor.provenance()));

  return {
    ok: true,
    viewId: ref.id,
    title: label,
    note: "This is now on every elder's Shepherd Landing Page.",
  };
}

/**
 * Change a Filtered View.
 * @param {object} db the Firestore handle
 * @param {object} args viewId, title, filter, actor
 * @return {Promise<object>} { ok, viewId }
 */
async function updateView(db, {viewId, title, filter, actor}) {
  const ref = db.collection(VIEWS).doc(viewId);
  const snap = await ref.get();
  if (!snap.exists) throw refuse(`No Filtered View with id "${viewId}".`);

  const update = {updatedAt: F.now(), updatedByName: actor.name};
  if (title !== undefined && title !== null) update.title = String(title).trim();
  if (filter) Object.assign(update, filterConfig(filter));

  await ref.update(Object.assign(update, Actor.provenance()));
  return {ok: true, viewId};
}

/**
 * Delete a Filtered View.
 * @param {object} db the Firestore handle
 * @param {object} args viewId
 * @return {Promise<object>} what was deleted
 */
async function deleteView(db, {viewId}) {
  const ref = db.collection(VIEWS).doc(viewId);
  const snap = await ref.get();
  if (!snap.exists) throw refuse(`No Filtered View with id "${viewId}".`);

  const title = (snap.data() || {}).title || "";

  // A Care List can be built on a preset view. Deleting the view out from
  // under it leaves a list that opens on nobody, so say which ones.
  const docs = await db.collection(DOCUMENTS).where("filterId", "==", viewId).get();

  await ref.delete();
  return {
    ok: true,
    deleted: {viewId, title},
    careListsAffected: docs.docs.map((d) => ({
      documentId: d.id,
      title: (d.data() || {}).title || "",
    })),
    note: "Gone from every elder's Shepherd Landing Page.",
  };
}

/**
 * The Follow-up Reminders still standing.
 *
 * Past ones are not listed because they are not there — a reminder disappears
 * on its own after its due date, which is the whole shape of the feature.
 *
 * @param {object} db the Firestore handle
 * @return {Promise<object>} { count, reminders }
 */
async function listReminders(db) {
  const snap = await db.collection(REMINDERS)
      .where("dueDatetime", ">=", new Date())
      .orderBy("dueDatetime", "asc").get();

  return {
    count: snap.docs.length,
    reminders: snap.docs.map((doc) => {
      const data = doc.data();
      return {
        reminderId: doc.id,
        title: data.title || "",
        due: Read.isoOf(data.dueDatetime),
        createdBy: data.createdByName || "",
        writtenVia: data.writtenVia || "page",
      };
    }),
  };
}

/**
 * A new Follow-up Reminder, visible to all elders.
 * @param {object} db the Firestore handle
 * @param {object} args title, due (ISO), personIds, actor
 * @return {Promise<object>} { ok, reminderId }
 */
async function createReminder(db, {title, due, personIds, actor}) {
  const label = String(title || "").trim();
  if (!label) throw refuse("A reminder needs something to say.");

  const when = new Date(due);
  if (!due || isNaN(when.getTime())) {
    throw refuse(`"${due}" is not a date and time. Use an ISO timestamp.`);
  }

  // Mentioned People are checked, not taken on trust — a reminder about
  // somebody who is not in the directory is a reminder nobody can act on.
  const mentioned = [];
  for (const personId of (personIds || [])) {
    const person = await loadPerson(db, personId);
    mentioned.push({personId, name: person.data.name || ""});
  }

  const ref = await db.collection(REMINDERS).add(Object.assign({
    title: label,
    dueDatetime: F.timestampFrom(when),
    mentions: mentioned,
    createdBy: actor.uid,
    createdByName: actor.name,
    createdAt: F.now(),
  }, Actor.provenance()));

  return {ok: true, reminderId: ref.id, title: label, due: when.toISOString()};
}

/**
 * Delete a Follow-up Reminder.
 * @param {object} db the Firestore handle
 * @param {object} args reminderId
 * @return {Promise<object>} what was deleted
 */
async function deleteReminder(db, {reminderId}) {
  const ref = db.collection(REMINDERS).doc(reminderId);
  const snap = await ref.get();
  if (!snap.exists) throw refuse(`No Follow-up Reminder with id "${reminderId}".`);
  const title = (snap.data() || {}).title || "";
  await ref.delete();
  return {ok: true, deleted: {reminderId, title}};
}

module.exports = {
  listFormTemplates,
  createFormDocument,
  getFormDocument,
  answerFormDocument,
  createCareList,
  getCareList,
  addCareListColumn,
  writeCareListCell,
  listViews,
  createView,
  updateView,
  deleteView,
  listReminders,
  createReminder,
  deleteReminder,
  filterConfig,
};
