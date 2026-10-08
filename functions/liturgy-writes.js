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
const Liturgy = require("./shared/liturgy-order-core.js");
const ReadCore = require("./shared/service-read-core.js");
const {loadLiturgyCatalog} = require("./liturgy-catalog.js");

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
 * The Sunday's document (normalised) and the elements of the Liturgy Order
 * it follows — what a write is checked against (MS-715).
 *
 * Read fresh every call: an assistant may have changed the order a moment
 * ago, and validating against a cached order is how a write lands in a slot
 * the page no longer shows.
 *
 * @param {object} db the Firestore handle
 * @param {string} dateKey YYYY-MM-DD
 * @return {Promise<object>} {exists, doc, order, elements}
 */
async function sundayInOrder(db, dateKey) {
  const [snap, catalog] = await Promise.all([
    db.collection(SERVICES).doc(dateKey).get(),
    loadLiturgyCatalog(db),
  ]);
  const raw = snap.exists ? snap.data() : null;
  const doc = raw ? ReadCore.normalizeServiceDoc(raw) : null;
  const order = Liturgy.orderFor(doc, catalog);
  return {
    exists: !!raw,
    doc,
    order,
    elements: Liturgy.elementsOf(order),
  };
}

/**
 * Merge a partial set of liturgy fields into one Sunday's document.
 *
 * ⚠ CHECKED AGAINST THAT SUNDAY'S OWN ORDER (MS-715). The keys are the
 * element ids of the Liturgy Order the Sunday follows — the `field` values
 * oos_get_service returns — not the Standard seed's. A key the order does
 * not contain is refused by name; nothing is ever stored where no page
 * shows it.
 *
 * ⚠ AN UNCHANGED VALUE IS NOT WRITTEN. Only fields whose value actually
 * differs reach Firestore, so repeating a write stamps no `updatedAt` and
 * moves no `decidedBy` credit.
 *
 * @param {object} db the Firestore handle
 * @param {object} args
 * @param {string} args.dateKey the `services/{dateKey}` doc id (YYYY-MM-DD)
 * @param {object} args.fields the proposed partial update, keyed by element id
 * @param {string} args.uid the calling editor's Firebase uid, for the
 *   authorship stamp — never used for the permission check, which is the
 *   caller's job before this is ever reached.
 * @param {*} args.serverTimestamp admin.firestore.FieldValue.serverTimestamp()
 * @param {*} args.deleteField admin.firestore.FieldValue.delete()
 * @return {Promise<object>} {ok: true, updated, written, unchanged, order}
 *   or {ok: false, rejectedFields, invalidFields, message, accepts, order}
 */
async function updateLiturgy(db, {
  dateKey, fields, uid, serverTimestamp, deleteField,
}) {
  const sunday = await sundayInOrder(db, dateKey);
  const plan = LiturgySaveCore.planOrderWrite(
      fields, sunday.elements, sunday.doc);
  const order = {id: sunday.order.id, name: sunday.order.name};

  if (plan.rejected.length || plan.invalid.length) {
    return {
      ok: false,
      rejectedFields: plan.rejected.map((r) => r.field),
      invalidFields: plan.invalid.map((r) => r.field),
      message: LiturgySaveCore.describeRefusal(
          plan, sunday.elements, sunday.order),
      accepts: ["theme", "keyVerse"].concat(
          LiturgySaveCore.writableFieldsOf(sunday.elements)
              .map((f) => f.field)),
      order,
    };
  }

  const paths = LiturgySaveCore.changePaths(plan.changes);
  if (!Object.keys(paths).length) {
    return {ok: true, updated: {}, written: [],
      unchanged: plan.unchanged, order};
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
        {}, LiturgySaveCore.changeDoc(plan.changes),
        {updatedAt: serverTimestamp},
        nested ? {[ServiceAuthorship.FIELD]: nested} : {},
    ), {merge: true});
  }

  return {
    ok: true,
    updated: plan.changes,
    written: plan.written,
    unchanged: plan.unchanged,
    order,
  };
}

module.exports = {updateLiturgy, resolveIdentity, sundayInOrder};
