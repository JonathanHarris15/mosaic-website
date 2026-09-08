/**
 * Writing on a Person's Shepherding Profile, from the server (MS-278).
 *
 * ⚠ WHY THIS FILE EXISTS AT ALL. Every one of these writes already existed —
 * in a browser. The Shepherding Profile talks to Firestore directly, and an
 * assistant cannot call a browser. The MS-262 rule for the MCP is that every
 * tool delegates and never decides, so the writes needed a home on the server
 * before a single `shep_` tool could be written.
 *
 * ⚠ THE DECISIONS DID NOT MOVE. They are still in shared/shepherding-core.js —
 * what a Pastoral Record entry looks like, that the denormalised field and the
 * activity entry are one atomic batch (ADR-0005), how Membership Tags are
 * re-projected, how a Tag Merge is planned. This file is the `db` half and the
 * validation an assistant needs that a person did not: a human picking a status
 * from a matrix cannot invent `urgency: "quite"`, and an agent can.
 *
 * ⚠ `global.firebase` IS SET HERE, DELIBERATELY. shepherding-core.js's three
 * commit helpers reach for `firebase.firestore.FieldValue.serverTimestamp()` as
 * a bare global, because they were written for a browser where every script
 * shares one scope. The alternative to setting it was restating those helpers
 * server-side — which is exactly the duplicated, drifting write ADR-0005 was
 * written to end. Same trick liturgy-writes.js uses for MosaicIdentity.
 *
 * ⚠ EVERY WRITE IS AUTHORED AND MARKED. `actor` comes from mcp-actor.js, which
 * refuses rather than returning a half-author. `source` is 'mcp' and the record
 * carries `writtenVia: 'mcp'`, so an elder reading their own Pastoral Record can
 * see what an agent did.
 */

// ⚠ THE FIRESTORE SENTINELS ARE PASSED IN, NEVER REACHED FOR. `functions/`
// carries its own node_modules, so a `require("firebase-admin")` here would
// be a different copy from whatever made the Firestore handle, and every
// write would fail to serialise its own server timestamp. Same convention
// liturgy-writes.js and service-read.js already follow. See mcp-firestore.js.
const F = require("./mcp-firestore.js");

const ShepherdingCore = require("./shared/shepherding-core.js");
const DocumentBodyCore = require("./shared/document-body-core.js");
const NoteMarkdownCore = require("./shared/note-markdown-core.js");
const Actor = require("./mcp-actor.js");

const PEOPLE = "people";
const NOTES = "shepherding_notes";
const ACTIVITY = "shepherding_activity";
// ⚠ A Shepherding Tag LIVES IN `people_tags`, not in `shepherding_tags`.
// The domain name and the collection name disagree, and the collection is
// the one every page actually reads and writes (shepherding-tags.js,
// shepherding-profile.js, shepherding-people.js). `shepherding_tags` exists
// in firestore.rules and nothing uses it. Reaching for the name that reads
// correctly here would produce an empty tag list and no error at all.
const TAGS = "people_tags";

/** A refusal a tool can hand straight back to the assistant. */
function refuse(message) {
  const err = new Error(message);
  err.code = "shepherding-refused";
  return err;
}

/**
 * The Person, or a refusal naming the id that was not found.
 *
 * ⚠ READ BEFORE EVERY WRITE, NEVER TRUSTED FROM THE CALLER. A status change
 * records what it replaced, and a tag change records the tags a Person already
 * carried. An assistant working from a minute-old read would record a previous
 * value that was never there.
 *
 * @param {object} db the Firestore handle
 * @param {string} personId the Person's id
 * @return {Promise<object>} { ref, data }
 */
async function loadPerson(db, personId) {
  if (!personId) throw refuse("No person id was given.");
  const ref = db.collection(PEOPLE).doc(personId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw refuse(
        `No Person with id "${personId}". Use shep_find_person to look ` +
        "somebody up by name — never guess an id.");
  }
  return {ref, data: snap.data() || {}};
}

/** Every Shepherding Tag, by id, for naming a tag in a Tag Change. */
async function loadTags(db) {
  const snap = await db.collection(TAGS).get();
  const byId = {};
  snap.docs.forEach((doc) => {
    byId[doc.id] = Object.assign({id: doc.id}, doc.data());
  });
  return byId;
}

/**
 * The Pastoral Record entry an assistant writes, stamped so it can be told
 * apart from one a person typed.
 * @param {object} record whatever ShepherdingCore built
 * @param {string} explanation the optional annotation, or ''
 * @return {object} the record, marked
 */
function marked(record, explanation) {
  return Object.assign({}, record, Actor.provenance(), {
    source: Actor.SOURCE,
    explanation: String(explanation || "").trim(),
  });
}

// ── Shepherding Notes ──────────────────────────────────────────────────────

/**
 * A new Shepherding Note on a Person.
 *
 * The Note Type is held to the known set. An elder typing into the page may
 * coin a seventh; an assistant may not, because a made-up type is invisible in
 * every filter built on the real six and nobody would ever find the note again.
 *
 * @param {object} db the Firestore handle
 * @param {object} args
 * @param {string} args.personId who the note is about
 * @param {string} args.type the Note Type
 * @param {string} [args.subject] the Subject Line
 * @param {string} args.markdown the Note Body, as prose
 * @param {?string} [args.sourceDocumentId] the Elder Document it came from
 * @param {object} args.actor the connected Elder
 * @return {Promise<object>} { ok, noteId }
 */
async function writeNote(db, {personId, type, subject, markdown, sourceDocumentId, actor}) {
  await loadPerson(db, personId);

  const noteType = String(type || "").trim();
  if (!ShepherdingCore.NOTE_TYPES.includes(noteType)) {
    throw refuse(
        `"${noteType}" is not a Note Type. Use one of: ` +
        ShepherdingCore.NOTE_TYPES.join(", ") + ".");
  }

  const body = String(markdown || "").trim();
  if (!body) throw refuse("A note with nothing in it is not worth writing.");

  const contentJson = NoteMarkdownCore.fromMarkdown(body);
  const ref = db.collection(PEOPLE).doc(personId).collection(NOTES).doc();

  await ref.set(Object.assign({
    type: noteType,
    subject: String(subject || "").trim(),
    contentJson,
    // The plain-text copy the note list previews from. Same field the page
    // writes, taken from the same module the page reads it with.
    content: DocumentBodyCore.plainText(contentJson),
    authorUid: actor.uid,
    authorName: actor.name,
    sourceDocumentId: sourceDocumentId || null,
    createdAt: F.now(),
  }, Actor.provenance()));

  return {ok: true, noteId: ref.id, personId};
}

/**
 * One note, or a refusal. Shared by append, edit and delete.
 * @param {object} db the Firestore handle
 * @param {string} personId who the note is about
 * @param {string} noteId which note
 * @return {Promise<object>} { ref, data }
 */
async function loadNote(db, personId, noteId) {
  const ref = db.collection(PEOPLE).doc(personId).collection(NOTES).doc(noteId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw refuse(`No note "${noteId}" on that Person.`);
  }
  return {ref, data: snap.data() || {}};
}

/**
 * Add to a note that already exists.
 *
 * ⚠ THIS IS WHY IT EXISTS. Without it an assistant writes a second note about
 * the same conversation, and an elder opening the profile a week later finds
 * two half-records instead of one whole one.
 *
 * @param {object} db the Firestore handle
 * @param {object} args personId, noteId, markdown, actor
 * @return {Promise<object>} { ok, noteId }
 */
async function appendToNote(db, {personId, noteId, markdown, actor}) {
  const {ref, data} = await loadNote(db, personId, noteId);

  const body = String(markdown || "").trim();
  if (!body) throw refuse("There is nothing to add.");

  const contentJson = NoteMarkdownCore.appendMarkdown(data.contentJson, body);
  await ref.update(Object.assign({
    contentJson,
    content: DocumentBodyCore.plainText(contentJson),
    updatedAt: F.now(),
    updatedBy: actor.uid,
    updatedByName: actor.name,
  }, Actor.provenance()));

  return {ok: true, noteId, personId};
}

/**
 * Change a note that already exists. Anything not given is left as it was.
 * @param {object} db the Firestore handle
 * @param {object} args personId, noteId, type, subject, markdown, actor
 * @return {Promise<object>} { ok, noteId }
 */
async function editNote(db, {personId, noteId, type, subject, markdown, actor}) {
  const {ref} = await loadNote(db, personId, noteId);

  const update = {
    updatedAt: F.now(),
    updatedBy: actor.uid,
    updatedByName: actor.name,
  };

  if (type !== undefined && type !== null) {
    const noteType = String(type).trim();
    if (!ShepherdingCore.NOTE_TYPES.includes(noteType)) {
      throw refuse(
          `"${noteType}" is not a Note Type. Use one of: ` +
          ShepherdingCore.NOTE_TYPES.join(", ") + ".");
    }
    update.type = noteType;
  }
  if (subject !== undefined && subject !== null) {
    update.subject = String(subject).trim();
  }
  if (markdown !== undefined && markdown !== null) {
    const contentJson = NoteMarkdownCore.fromMarkdown(String(markdown));
    update.contentJson = contentJson;
    update.content = DocumentBodyCore.plainText(contentJson);
  }

  await ref.update(Object.assign(update, Actor.provenance()));
  return {ok: true, noteId, personId};
}

/**
 * Delete a note.
 *
 * ⚠ THE PAGE ASKS FIRST AND THIS CANNOT. The profile puts up a confirm dialog
 * ("this cannot be undone"); an assistant has no dialog. So the note's subject
 * and type come back in the result — an assistant that deleted the wrong one
 * can at least say what it destroyed.
 *
 * A note created from a Person Panel is refused: deleting it here would leave
 * the panel in its Elder Document pointing at nothing, and the page's own
 * delete has a whole conversation about which of the two to keep.
 *
 * @param {object} db the Firestore handle
 * @param {object} args personId, noteId
 * @return {Promise<object>} { ok, deleted }
 */
async function deleteNote(db, {personId, noteId}) {
  const {ref, data} = await loadNote(db, personId, noteId);

  if (data.sourceDocumentId) {
    throw refuse(
        "That note belongs to a Person Panel in an Elder Document. Deleting " +
        "it here would leave the panel pointing at nothing — remove the " +
        "panel from the document instead.");
  }

  await ref.delete();
  return {
    ok: true,
    deleted: {
      noteId,
      personId,
      type: data.type || "",
      subject: data.subject || "",
    },
  };
}

// ── Shepherding Status ─────────────────────────────────────────────────────

/**
 * Set a Person's Shepherding Status, logging a Status Change.
 *
 * @param {object} db the Firestore handle
 * @param {object} args personId, urgency, importance, explanation, actor
 * @return {Promise<object>} { ok, status, activityId }
 */
async function setStatus(db, {personId, urgency, importance, explanation, actor}) {
  const {data} = await loadPerson(db, personId);

  if (!ShepherdingCore.URGENCY_LEVELS.includes(urgency)) {
    throw refuse(
        `"${urgency}" is not an urgency. Use one of: ` +
        ShepherdingCore.URGENCY_LEVELS.join(", ") + ".");
  }
  if (!ShepherdingCore.IMPORTANCE_LEVELS.includes(importance)) {
    throw refuse(
        `"${importance}" is not an importance. Use one of: ` +
        ShepherdingCore.IMPORTANCE_LEVELS.join(", ") + ".");
  }

  const newStatus = {urgency, importance};
  const activityId = await ShepherdingCore.commitPastoralChange(
      db, personId,
      {shepherdingStatus: newStatus, updatedAt: F.now()},
      marked(ShepherdingCore.buildStatusChange({
        previousStatus: data.shepherdingStatus || null,
        newStatus,
        authorUid: actor.uid,
        authorName: actor.name,
        source: Actor.SOURCE,
      }), explanation));

  return {ok: true, personId, status: newStatus, activityId};
}

/**
 * Clear a Person's Shepherding Status, logging the Status Change that says so.
 * @param {object} db the Firestore handle
 * @param {object} args personId, explanation, actor
 * @return {Promise<object>} { ok, activityId }
 */
async function clearStatus(db, {personId, explanation, actor}) {
  const {data} = await loadPerson(db, personId);

  if (!data.shepherdingStatus) {
    return {ok: true, personId, status: null, activityId: null, note: "Already had no status."};
  }

  const activityId = await ShepherdingCore.commitPastoralChange(
      db, personId,
      {shepherdingStatus: null, updatedAt: F.now()},
      marked(ShepherdingCore.buildStatusChange({
        previousStatus: data.shepherdingStatus,
        newStatus: null,
        authorUid: actor.uid,
        authorName: actor.name,
        source: Actor.SOURCE,
      }), explanation));

  return {ok: true, personId, status: null, activityId};
}

// ── Shepherding Tags on a Person ───────────────────────────────────────────

/**
 * Apply or remove Shepherding Tags, one Tag Change per tag.
 *
 * ⚠ PROJECTED TAGS ARE REFUSED. A Membership Tag and the Elder Tag follow the
 * Membership Track and the Elder role; they are not manual tagging, and setting
 * one by hand would put a Person's tags and their Track into disagreement with
 * nothing to reconcile them. Same refusal the page gives.
 *
 * ⚠ `shepherdingHidden` RIDES WITH THE TAGS. A Person carrying any tag with
 * `hidePeople` is hidden from the People directory, and that flag is
 * denormalised onto the Person so the directory can filter without reading
 * every tag. Written in the same batch as the tag itself.
 *
 * @param {object} db the Firestore handle
 * @param {object} args personId, tagIds, action ('added'|'removed'), explanation, actor
 * @return {Promise<object>} { ok, changed, skipped }
 */
async function changeTags(db, {personId, tagIds, action, explanation, actor}) {
  const {data} = await loadPerson(db, personId);
  const wanted = (Array.isArray(tagIds) ? tagIds : [tagIds]).filter(Boolean);
  if (!wanted.length) throw refuse("No tags were given.");

  const allTags = await loadTags(db);
  const adding = action === "added";

  const changed = [];
  const skipped = [];
  let tags = Array.isArray(data.tags) ? data.tags.slice() : [];

  for (const tagId of wanted) {
    if (ShepherdingCore.isProjectedTagId(tagId)) {
      skipped.push({tagId, why: "set by the Membership Track or the Elder role, not by hand"});
      continue;
    }
    if (!allTags[tagId]) {
      skipped.push({tagId, why: "no Shepherding Tag with that id"});
      continue;
    }
    const carries = tags.includes(tagId);
    if (carries === adding) {
      skipped.push({tagId, why: adding ? "already carried" : "was not carried"});
      continue;
    }

    tags = adding ? tags.concat([tagId]) : tags.filter((t) => t !== tagId);

    // One Tag Change per tag, written with the Person's tags, so each is its
    // own entry in the Pastoral Record exactly as the page writes them.
    const hidePeople = Object.values(allTags)
        .filter((t) => t.hidePeople).map((t) => t.id);
    const activityId = await ShepherdingCore.commitPastoralChange(
        db, personId,
        {
          tags: adding ?
            F.arrayUnion(tagId) :
            F.arrayRemove(tagId),
          shepherdingHidden: tags.some((id) => hidePeople.includes(id)),
          updatedAt: F.now(),
        },
        marked(ShepherdingCore.buildTagChange({
          tagId,
          tagName: allTags[tagId].name || tagId,
          action,
          authorUid: actor.uid,
          authorName: actor.name,
          source: Actor.SOURCE,
        }), explanation));

    changed.push({tagId, tagName: allTags[tagId].name || tagId, activityId});
  }

  return {ok: true, personId, action, changed, skipped, tags};
}

/**
 * @param {object} db the Firestore handle
 * @param {object} args personId, tagIds, explanation, actor
 * @return {Promise<object>} what changeTags returned
 */
function addTags(db, args) {
  return changeTags(db, Object.assign({}, args, {action: "added"}));
}

/**
 * @param {object} db the Firestore handle
 * @param {object} args personId, tagIds, explanation, actor
 * @return {Promise<object>} what changeTags returned
 */
function removeTags(db, args) {
  return changeTags(db, Object.assign({}, args, {action: "removed"}));
}

// ── Membership Track and Elder Assignment ──────────────────────────────────

/**
 * Move a Person along the Membership Track, or mark them inactive.
 *
 * The Membership Tags are re-projected in the same batch and emit no Tag
 * Changes of their own — the Membership Change is the canonical record
 * (ADR-0012). That is ShepherdingCore's rule, not this file's.
 *
 * @param {object} db the Firestore handle
 * @param {object} args personId, stage, inactive, explanation, actor
 * @return {Promise<object>} { ok, membership, activityId }
 */
async function setMembershipStage(db, {personId, stage, inactive, explanation, actor}) {
  const {data} = await loadPerson(db, personId);

  const wanted = stage === null || stage === undefined || stage === "" ? null : String(stage);
  if (wanted !== null && !ShepherdingCore.MEMBERSHIP_STAGES.includes(wanted)) {
    throw refuse(
        `"${wanted}" is not a Membership Stage. Use one of: ` +
        ShepherdingCore.MEMBERSHIP_STAGES.join(", ") +
        " — or no stage at all, with inactive true, to mark somebody inactive.");
  }

  const previous = {
    stage: (data.membership && data.membership.stage) || null,
    inactive: !!(data.membership && data.membership.inactive),
  };
  const next = {stage: wanted, inactive: !!inactive};

  if (previous.stage === next.stage && previous.inactive === next.inactive) {
    return {ok: true, personId, membership: next, activityId: null,
      note: "Already on that stage."};
  }

  const activityId = await ShepherdingCore.commitMembershipChange(db, personId, {
    currentTags: data.tags || [],
    previous,
    next,
    authorUid: actor.uid,
    authorName: actor.name,
    source: Actor.SOURCE,
  });

  await annotate(db, personId, activityId, explanation);
  return {ok: true, personId, membership: next, activityId};
}

/**
 * Assign a Person to an Elder for care, or clear the assignment.
 *
 * `elderPersonId` is a PERSON id, not a uid — the whole graph is Person↔Person.
 * It is checked against the Elder Tag, because the assignable set is exactly
 * the Elder-Tag People and an assignment to somebody who is not an elder would
 * never show up in anybody's Care Group.
 *
 * @param {object} db the Firestore handle
 * @param {object} args personId, elderPersonId, explanation, actor
 * @return {Promise<object>} { ok, assignedElderId, activityId }
 */
async function setElderAssignment(db, {personId, elderPersonId, explanation, actor}) {
  const {data} = await loadPerson(db, personId);
  const nextId = elderPersonId || null;

  if (nextId && nextId === personId) {
    throw refuse("Nobody can be their own elder.");
  }

  let nextName = "";
  if (nextId) {
    const elder = await loadPerson(db, nextId);
    if (!ShepherdingCore.isElderPerson(Object.assign({id: nextId}, elder.data))) {
      throw refuse(
          `${elder.data.name || nextId} does not carry the Elder Tag, so ` +
          "nobody can be assigned to them.");
    }
    nextName = elder.data.name || "";
  }

  const prevId = (data.shepherding && data.shepherding.assignedElderId) || null;
  if (prevId === nextId) {
    return {ok: true, personId, assignedElderId: nextId, activityId: null,
      note: "Already assigned that way."};
  }

  let prevName = "";
  if (prevId) {
    const snap = await db.collection(PEOPLE).doc(prevId).get();
    prevName = (snap.exists && snap.data().name) || "";
  }

  const activityId = await ShepherdingCore.commitAssignmentChange(db, personId, {
    previous: {elderId: prevId, elderName: prevName},
    next: {elderId: nextId, elderName: nextName},
    authorUid: actor.uid,
    authorName: actor.name,
    source: Actor.SOURCE,
  });

  await annotate(db, personId, activityId, explanation);
  return {ok: true, personId, assignedElderId: nextId, activityId};
}

// ── Explanations ───────────────────────────────────────────────────────────

/**
 * Put an Explanation on a Pastoral Record entry, or replace the one there.
 *
 * An Explanation is scoped to one Status, Tag, Membership or Assignment
 * Change. It is not a Shepherding Note and carries no rich text — which is why
 * this takes plain text and the note tools take markdown.
 *
 * @param {object} db the Firestore handle
 * @param {object} args personId, activityId, explanation
 * @return {Promise<object>} { ok }
 */
async function explainChange(db, {personId, activityId, explanation}) {
  await loadPerson(db, personId);
  const ref = db.collection(PEOPLE).doc(personId)
      .collection(ACTIVITY).doc(activityId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw refuse(
        `No Pastoral Record entry "${activityId}" on that Person. Only a ` +
        "Status, Tag, Membership or Assignment Change can carry an " +
        "Explanation — a Shepherding Note is edited with shep_edit_note.");
  }
  await ref.update({explanation: String(explanation || "").trim()});
  return {ok: true, personId, activityId};
}

/**
 * Mark an entry one of ShepherdingCore's commit helpers wrote, and annotate it.
 *
 * ⚠ THE MARK IS NOT OPTIONAL, THE EXPLANATION IS. commitMembershipChange and
 * commitAssignmentChange build their own record internally and hand back only
 * its id, so there is no way to merge the provenance stamp in on the way
 * through. Without this second touch a Membership Change written by an agent
 * would be the one Pastoral Record entry nobody could tell apart from a
 * person's.
 *
 * @param {object} db the Firestore handle
 * @param {string} personId the Person
 * @param {?string} activityId the entry just written
 * @param {?string} explanation what to record, if anything
 * @return {Promise<void>}
 */
async function annotate(db, personId, activityId, explanation) {
  if (!activityId) return;
  const text = String(explanation || "").trim();
  const update = Actor.provenance();
  if (text) update.explanation = text;
  await db.collection(PEOPLE).doc(personId).collection(ACTIVITY).doc(activityId)
      .update(update);
}

module.exports = {
  writeNote,
  appendToNote,
  editNote,
  deleteNote,
  setStatus,
  clearStatus,
  addTags,
  removeTags,
  setMembershipStage,
  setElderAssignment,
  explainChange,
  // Reached for by the other shepherding modules, and worth exercising alone.
  loadPerson,
  loadTags,
  refuse,
};
