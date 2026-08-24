/**
 * The Firestore half of oos_update_liturgy (MS-262).
 *
 * Same split as assignment-writes.js: the shape/allowlist DECISIONS live in
 * shared/liturgy-save-core.js, pure and unit-tested; this takes `db` so the
 * actual write — including the not-found-yet fallback and the authorship
 * stamp — can be exercised against a real Firestore emulator rather than a
 * hand-written fake.
 *
 * Mirrors public/service-calendar.js's writeLiturgyField() exactly, widened
 * from one slot to a partial set of slots: try an `.update()` with dot-paths
 * first (so an untouched field is never even in the write), and only fall
 * back to `.set(doc, {merge: true})` if the Sunday has no document yet.
 *
 * global.MosaicIdentity is set before requiring service-authorship.js
 * because that module (like its own test) reaches for MosaicIdentity as a
 * bare global rather than requiring it — it is written to run in a browser,
 * where both scripts share one global scope.
 */

global.MosaicIdentity = require("./shared/mosaic-identity.js");
const ServiceAuthorship = require("./shared/service-authorship.js");
const LiturgySaveCore = require("./shared/liturgy-save-core.js");

const SERVICES = "services";
const USERS = "users";

/**
 * Who is calling, as a Person — freshly resolved every call. Unlike
 * MosaicIdentity.me() (built for a browser tab that is always the same
 * person), a Cloud Functions instance answers many different callers in
 * turn, so nothing here is cached across calls.
 * @param {object} db the Firestore handle
 * @param {string} uid the caller's Firebase uid
 * @return {Promise<?object>} the identity, or null if we cannot say who this is
 */
function resolveIdentity(db, uid) {
  return global.MosaicIdentity.resolve({
    uid,
    db,
    getUserData: async (u) => {
      const snap = await db.collection(USERS).doc(u).get();
      return snap.exists ? snap.data() : null;
    },
  });
}

/**
 * Merge a partial set of liturgy fields into one Sunday's document.
 *
 * @param {object} db the Firestore handle
 * @param {object} args
 * @param {string} args.dateKey the `services/{dateKey}` doc id (YYYY-MM-DD)
 * @param {object} args.fields the proposed partial update, editor-field-named
 * @param {string} args.uid the calling editor's Firebase uid, for the
 *   authorship stamp — never used for the permission check, which is the
 *   onCall wrapper's job before this is ever reached.
 * @param {*} args.serverTimestamp admin.firestore.FieldValue.serverTimestamp()
 * @param {*} args.deleteField admin.firestore.FieldValue.delete()
 * @return {Promise<object>} { ok: true, updated } or
 *   { ok: false, rejectedFields, invalidFields }
 */
async function updateLiturgy(db, {dateKey, fields, uid, serverTimestamp, deleteField}) {
  const {rejectedFields, invalidFields} = LiturgySaveCore.validateLiturgyUpdate(fields);
  if (rejectedFields.length || invalidFields.length) {
    return {ok: false, rejectedFields, invalidFields};
  }

  const paths = LiturgySaveCore.toUpdatePaths(fields);
  if (!Object.keys(paths).length) {
    return {ok: true, updated: {}};
  }

  const identity = await resolveIdentity(db, uid);
  const authorship = ServiceAuthorship.stampsFor(
      paths, identity, serverTimestamp, deleteField);

  const ref = db.collection(SERVICES).doc(dateKey);
  try {
    await ref.update(Object.assign(
        {}, paths, authorship, {updatedAt: serverTimestamp}));
  } catch (e) {
    if (e.code !== 5 && e.code !== "not-found") throw e; // gRPC NOT_FOUND = 5
    const nested = ServiceAuthorship.nestStamps(authorship, deleteField);
    await ref.set(Object.assign(
        {}, LiturgySaveCore.toNestedDoc(fields), {updatedAt: serverTimestamp},
        nested ? {[ServiceAuthorship.FIELD]: nested} : {}
    ), {merge: true});
  }

  return {ok: true, updated: fields};
}

module.exports = {updateLiturgy, resolveIdentity};
