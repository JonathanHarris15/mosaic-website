/**
 * Writing and restoring guidance files (MS-262).
 *
 * ⚠ THIS IS THE ASSISTANT EDITING ITS OWN INSTRUCTIONS, and that is a
 * different act from editing a Sunday. Every other write changes ONE Sunday,
 * on a page people look at weekly; a wrong one is obvious and gets undone. A
 * guidance edit changes how the assistant behaves on every Sunday from then
 * on, and nobody reads the MCP Manager page weekly.
 *
 * What makes that acceptable is the history: every change is snapshotted and
 * any older version can be restored. The safety is not that a bad edit
 * cannot happen — it is that it cannot happen QUIETLY or PERMANENTLY.
 *
 * ⚠ THE HISTORY IS NOT WRITTEN HERE. It is written by a Firestore trigger
 * (onGuidanceWritten in index.js) that fires on any write to the collection,
 * from any door. Recording it in this file would mean the page's own saves
 * went unrecorded, and a history that covers some writers is worse than none
 * — it reads as a complete account while quietly omitting half the edits.
 */

const Core = require("./shared/mcp-guidance-core.js");

const GUIDANCE = "mcp_guidance";

/**
 * Create or update one guidance file.
 *
 * A file is addressed by its slug, not by a document id, because that is
 * what an assistant knows. An unknown slug creates a new file; a known one
 * edits it in place, keeping its address.
 *
 * @param {object} db the Firestore handle
 * @param {object} args
 * @param {string} args.slug the file's address
 * @param {object} args.fields title / summary / body / enabled
 * @param {string} args.uid who is answerable
 * @param {?string} args.name their name, for the history
 * @param {string} args.source 'assistant' | 'page' | 'restore'
 * @param {*} args.serverTimestamp a server timestamp value
 * @return {Promise<object>} {ok, action, slug} or {ok:false, problems}
 */
async function updateGuidance(db, {slug, fields, uid, name, source, serverTimestamp}) {
  const existing = await bySlug(db, slug);

  // An edit only has to send what it is changing; the rest stands. An
  // assistant asked to "soften that last line" should not have to resend
  // the title and summary to do it, and requiring that invites it to
  // reconstruct them slightly wrong.
  const merged = Core.normalize(Object.assign(
      {},
      existing ? Core.snapshotOf(existing) : {enabled: true},
      fields || {},
      {slug},
  ));

  const problems = Core.validate(merged);
  if (problems.length) return {ok: false, problems};

  const clash = await bySlug(db, merged.slug);
  if (clash && (!existing || clash.id !== existing.id)) {
    return {
      ok: false,
      problems: [`Another file already uses the address "${merged.slug}".`],
    };
  }

  const record = Object.assign({}, merged, {
    updatedAt: serverTimestamp,
    updatedByUid: uid || null,
    updatedByName: name || null,
    updatedVia: Core.SOURCES.includes(source) ? source : "assistant",
  });

  if (existing) {
    await db.collection(GUIDANCE).doc(existing.id).update(record);
    return {ok: true, action: "updated", slug: merged.slug, id: existing.id};
  }

  const ref = await db.collection(GUIDANCE).add(record);
  return {ok: true, action: "created", slug: merged.slug, id: ref.id};
}

/**
 * Put an older version back.
 *
 * ⚠ A RESTORE IS ITSELF A CHANGE, not a rewind of the record. The old
 * snapshot is written forward as the current content, so the history keeps
 * growing and the restore is in it. Rolling the history back instead would
 * make undoing an undo impossible, and would quietly erase the evidence of
 * whatever went wrong.
 *
 * @param {object} db the Firestore handle
 * @param {object} args
 * @param {string} args.id the guidance document id
 * @param {string} args.versionId which version to put back
 * @param {string} args.uid who is answerable
 * @param {?string} args.name their name
 * @param {*} args.serverTimestamp a server timestamp value
 * @return {Promise<object>} {ok} or {ok:false, reason}
 */
async function restoreVersion(db, {id, versionId, uid, name, serverTimestamp}) {
  const [docSnap, versionSnap] = await Promise.all([
    db.collection(GUIDANCE).doc(id).get(),
    db.collection(GUIDANCE).doc(id).collection("versions").doc(versionId).get(),
  ]);

  if (!docSnap.exists) return {ok: false, reason: "no-such-file"};
  if (!versionSnap.exists) return {ok: false, reason: "no-such-version"};

  const snapshot = Core.snapshotOf(versionSnap.data());

  // ⚠ A RESTORE MUST NOT BE ABLE TO MAKE A FILE UNREACHABLE. The address is
  // how an assistant asks for a file, so writing back a version whose slug
  // is missing or malformed would leave the writing intact and the file
  // findable by nobody — the worst shape of all, because it looks fine on
  // the page. A version filed before the address existed keeps the one the
  // file has now rather than clearing it.
  if (!Core.isValidSlug(snapshot.slug)) {
    const current = docSnap.data();
    if (!Core.isValidSlug(current && current.slug)) {
      return {ok: false, reason: "no-valid-address"};
    }
    snapshot.slug = current.slug;
  }

  await db.collection(GUIDANCE).doc(id).update(Object.assign({}, snapshot, {
    updatedAt: serverTimestamp,
    updatedByUid: uid || null,
    updatedByName: name || null,
    updatedVia: "restore",
  }));

  return {ok: true, restored: versionId, slug: snapshot.slug};
}

/**
 * The versions of one file, newest first.
 * @param {object} db the Firestore handle
 * @param {string} id the guidance document id
 * @param {number} [limit] how many to return
 * @return {Promise<Array<object>>} the history
 */
async function listVersions(db, id, limit) {
  const snap = await db.collection(GUIDANCE).doc(id)
      .collection("versions")
      .orderBy("savedAt", "desc")
      .limit(Math.max(1, Math.min(limit || 50, 200)))
      .get();

  return snap.docs.map((d) => Object.assign({id: d.id}, d.data()));
}

/**
 * One file by its address, or null.
 * @param {object} db the Firestore handle
 * @param {string} slug the address
 * @return {Promise<?object>} the file
 */
async function bySlug(db, slug) {
  const snap = await db.collection(GUIDANCE)
      .where("slug", "==", String(slug || ""))
      .limit(1)
      .get();
  return snap.empty ? null :
    Object.assign({id: snap.docs[0].id}, snap.docs[0].data());
}

module.exports = {updateGuidance, restoreVersion, listVersions, bySlug};
