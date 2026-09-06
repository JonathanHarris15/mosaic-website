/**
 * The Shepherding Tags themselves, from the server (MS-278).
 *
 * Not applying a tag to a Person — that is shepherding-writes.js, and it logs a
 * Tag Change. This is the vocabulary: making a tag, renaming one, folding two
 * into one, throwing one away.
 *
 * ⚠ A TAG'S IDENTITY IS NOT ITS NAME (ADR-0011). The id is a stable auto-id and
 * the name is a label on top of it. A Rename therefore changes exactly one
 * field and touches no carrier, no Filtered View and no Tag Change. Anything
 * here that moved carriers on a rename would be a bug, not a feature.
 *
 * ⚠ A MERGE IS THE MOST DESTRUCTIVE THING THE MCP CAN DO, AND IT SHIPS ANYWAY.
 * Folding one tag into another rewrites every carrier's `tags` array and
 * re-points every Tag Change in every Pastoral Record, then deletes the tag id.
 * There is no undo. That risk was put to Jonathan on 2026-09-04 and accepted,
 * so what this file adds instead of a refusal is a plan an assistant has to
 * read back: `previewMerge` says which tags, how many people and which id
 * survives, and the merge itself reports the same numbers afterwards.
 *
 * ⚠ A PROJECTED TAG IS NOT EDITABLE HERE. Membership Tags and the Elder Tag
 * follow the Membership Track and the Elder role; renaming or deleting one
 * would leave the projection rebuilding it on the next change, so it is refused
 * exactly as the Manage Tags page refuses it.
 */

const admin = require("firebase-admin");

global.firebase = {firestore: {FieldValue: admin.firestore.FieldValue}};

const ShepherdingCore = require("./shared/shepherding-core.js");
const {refuse} = require("./shepherding-writes.js");

const PEOPLE = "people";
const ACTIVITY = "shepherding_activity";
// See shepherding-writes.js — the domain name and the collection name disagree.
const TAGS = "people_tags";

// Firestore caps a batch at 500 writes. The page chunks for the same reason;
// a merge across a big directory is easily more than one batch.
const BATCH_LIMIT = 450;

/** Every tag, as a list, sorted the way the Manage Tags page sorts them. */
async function listTags(db) {
  const snap = await db.collection(TAGS).get();
  const tags = snap.docs.map((doc) => {
    const data = doc.data() || {};
    return {
      tagId: doc.id,
      name: data.name || doc.id,
      // Two different hides, and confusing them is the classic mistake:
      // one hides the tag's NAME, the other hides the PEOPLE carrying it.
      hiddenFromOthers: !!data.hiddenFromOthers,
      hidePeople: !!data.hidePeople,
      projected: ShepherdingCore.isProjectedTagId(doc.id),
    };
  });
  tags.sort((a, b) => a.name.localeCompare(b.name));
  return {count: tags.length, tags};
}

/** One tag, or a refusal. */
async function loadTag(db, tagId) {
  if (!tagId) throw refuse("No tag id was given.");
  const ref = db.collection(TAGS).doc(tagId);
  const snap = await ref.get();
  if (!snap.exists) throw refuse(`No Shepherding Tag with id "${tagId}".`);
  return {ref, data: snap.data() || {}};
}

/** Refuses a Membership Tag or the Elder Tag, which are not manual tagging. */
function refuseIfProjected(tagId, what) {
  if (!ShepherdingCore.isProjectedTagId(tagId)) return;
  throw refuse(
      `"${tagId}" is set by the Membership Track or the Elder role, not by ` +
      `hand, so it cannot be ${what}. Change the Person's Membership Stage ` +
      "instead.");
}

/**
 * A new Shepherding Tag.
 *
 * @param {object} db the Firestore handle
 * @param {object} args name, hidePeople, hiddenFromOthers
 * @return {Promise<object>} { ok, tagId }
 */
async function createTag(db, {name, hidePeople, hiddenFromOthers}) {
  const label = String(name || "").trim();
  if (!label) throw refuse("A tag needs a name.");

  const existing = await listTags(db);
  const clash = existing.tags.find(
      (t) => t.name.toLowerCase() === label.toLowerCase());
  if (clash) {
    throw refuse(
        `There is already a tag called "${clash.name}" (${clash.tagId}). ` +
        "Use that one rather than making a second with the same name.");
  }

  const ref = await db.collection(TAGS).add({
    name: label,
    hiddenFromOthers: !!hiddenFromOthers,
    hidePeople: !!hidePeople,
  });

  return {ok: true, tagId: ref.id, name: label};
}

/**
 * Change a tag's display name, and nothing else.
 * @param {object} db the Firestore handle
 * @param {object} args tagId, name
 * @return {Promise<object>} { ok, tagId, name }
 */
async function renameTag(db, {tagId, name}) {
  refuseIfProjected(tagId, "renamed");
  const {ref, data} = await loadTag(db, tagId);

  const label = String(name || "").trim();
  if (!label) throw refuse("A tag needs a name.");
  if (label === data.name) return {ok: true, tagId, name: label, note: "Already called that."};

  const existing = await listTags(db);
  const clash = existing.tags.find(
      (t) => t.tagId !== tagId && t.name.toLowerCase() === label.toLowerCase());
  if (clash) {
    throw refuse(`There is already a tag called "${clash.name}".`);
  }

  await ref.update({name: label});
  return {
    ok: true,
    tagId,
    previousName: data.name || "",
    name: label,
    // Said out loud because it is the whole point of a stable id, and because
    // an assistant reporting back to an elder should be able to reassure them.
    note: "Renamed only. Everyone carrying the tag still carries it.",
  };
}

/**
 * Which People a tag would affect, without touching anything.
 *
 * The read half of a merge or a delete, offered on its own so an assistant can
 * say what is about to happen before it happens.
 *
 * @param {object} db the Firestore handle
 * @param {Array<string>} tagIds the tags in question
 * @return {Promise<object>} { carriers, byTag }
 */
async function carriersOf(db, tagIds) {
  const byTag = {};
  const carriers = {};

  for (const tagId of tagIds) {
    const snap = await db.collection(PEOPLE)
        .where("tags", "array-contains", tagId).get();
    byTag[tagId] = snap.docs.length;
    snap.docs.forEach((doc) => {
      carriers[doc.id] = Object.assign({id: doc.id}, doc.data());
    });
  }

  return {carriers, byTag};
}

/**
 * What a merge would do, in numbers, before it does it.
 *
 * @param {object} db the Firestore handle
 * @param {object} args tagIds (the ones folded away), survivorTagId
 * @return {Promise<object>} the plan, in words and numbers
 */
async function previewMerge(db, {tagIds, survivorTagId}) {
  const merged = (tagIds || []).filter((id) => id && id !== survivorTagId);
  if (!merged.length) throw refuse("Nothing to merge into the survivor.");

  const survivor = await loadTag(db, survivorTagId);
  const names = {};
  for (const tagId of merged) {
    refuseIfProjected(tagId, "merged");
    names[tagId] = (await loadTag(db, tagId)).data.name || tagId;
  }

  const {byTag, carriers} = await carriersOf(db, merged);

  return {
    survivor: {tagId: survivorTagId, name: survivor.data.name || survivorTagId},
    merging: merged.map((tagId) => ({tagId, name: names[tagId], carriers: byTag[tagId]})),
    peopleAffected: Object.keys(carriers).length,
    reversible: false,
    note:
      "This cannot be undone. The merged tags are deleted, their carriers are " +
      `moved onto "${survivor.data.name || survivorTagId}", and their Tag ` +
      "Changes are re-pointed at it so it inherits the Tag Hold. Read this " +
      "back to the elder before calling shep_merge_tags.",
  };
}

/** Apply a list of (batch) => void operations, respecting Firestore's cap. */
async function commitInChunks(db, ops) {
  for (let i = 0; i < ops.length; i += BATCH_LIMIT) {
    const batch = db.batch();
    ops.slice(i, i + BATCH_LIMIT).forEach((op) => op(batch));
    await batch.commit();
  }
}

/**
 * Fold one or more tags into a survivor.
 *
 * The plan is ShepherdingCore.planTagMerge — the same pure function the Manage
 * Tags page uses — so an agent's merge and an elder's merge leave the database
 * in the same state.
 *
 * @param {object} db the Firestore handle
 * @param {object} args tagIds, survivorTagId
 * @return {Promise<object>} what was done
 */
async function mergeTags(db, {tagIds, survivorTagId}) {
  const preview = await previewMerge(db, {tagIds, survivorTagId});
  const merged = preview.merging.map((m) => m.tagId);

  const {carriers} = await carriersOf(db, merged);
  const all = await listTags(db);

  // Each carrier's Tag Changes, so the merge can re-point them and the survivor
  // inherits the history — and with it the earlier, longer Tag Hold.
  const people = [];
  for (const id of Object.keys(carriers)) {
    const snap = await db.collection(PEOPLE).doc(id).collection(ACTIVITY).get();
    people.push(Object.assign({}, carriers[id], {
      activity: snap.docs.map((d) => Object.assign({id: d.id}, d.data())),
    }));
  }

  const plan = ShepherdingCore.planTagMerge({
    people,
    mergedTagIds: merged,
    survivorTagId,
  });

  // Which tags still hide their carriers once the merged ones are gone.
  const hidePeopleIds = all.tags
      .filter((t) => t.hidePeople && !merged.includes(t.tagId))
      .map((t) => t.tagId);
  const survivorName = preview.survivor.name;

  const ops = [];
  plan.personUpdates.forEach((update) => ops.push((batch) => {
    batch.update(db.collection(PEOPLE).doc(update.personId), {
      tags: update.newTags,
      shepherdingHidden: update.newTags.some((t) => hidePeopleIds.includes(t)),
    });
  }));
  plan.activityRewrites.forEach((rewrite) => ops.push((batch) => {
    batch.update(
        db.collection(PEOPLE).doc(rewrite.personId)
            .collection(ACTIVITY).doc(rewrite.activityId),
        {tagId: survivorTagId, tagName: survivorName});
  }));
  plan.deleteTagIds.forEach((tagId) => ops.push((batch) => {
    batch.delete(db.collection(TAGS).doc(tagId));
  }));

  await commitInChunks(db, ops);

  return {
    ok: true,
    survivor: preview.survivor,
    merged: preview.merging,
    peopleMoved: plan.personUpdates.length,
    tagChangesRepointed: plan.activityRewrites.length,
    tagsDeleted: plan.deleteTagIds,
  };
}

/**
 * Delete a tag, taking it off everyone who carries it.
 *
 * ⚠ THE PAGE ASKS FIRST AND THIS CANNOT. So the carrier count comes back in the
 * result, and `previewMerge`'s sibling read is available beforehand. An
 * assistant deleting a tag off forty people should be able to say it did.
 *
 * @param {object} db the Firestore handle
 * @param {object} args tagId
 * @return {Promise<object>} what was done
 */
async function deleteTag(db, {tagId}) {
  refuseIfProjected(tagId, "deleted");
  const {data} = await loadTag(db, tagId);

  const all = await listTags(db);
  const otherHidePeople = all.tags
      .filter((t) => t.tagId !== tagId && t.hidePeople)
      .map((t) => t.tagId);

  const snap = await db.collection(PEOPLE)
      .where("tags", "array-contains", tagId).get();

  const ops = snap.docs.map((doc) => (batch) => {
    const update = {tags: admin.firestore.FieldValue.arrayRemove(tagId)};
    if (data.hidePeople) {
      const remaining = (doc.data().tags || []).filter((t) => t !== tagId);
      update.shepherdingHidden = remaining.some((t) => otherHidePeople.includes(t));
    }
    batch.update(doc.ref, update);
  });
  ops.push((batch) => batch.delete(db.collection(TAGS).doc(tagId)));

  await commitInChunks(db, ops);

  return {
    ok: true,
    tagId,
    name: data.name || tagId,
    removedFrom: snap.docs.length,
    // Deliberately not deleted: the Tag Changes stay. A Person's Pastoral
    // Record is a history, and rewriting history because a label was retired
    // is a bigger act than deleting the label.
    note: "Tag Changes in the Pastoral Record are left as they are — the tag " +
      "was really applied at the time, and the record says so.",
  };
}

module.exports = {
  listTags,
  createTag,
  renameTag,
  previewMerge,
  mergeTags,
  deleteTag,
};
