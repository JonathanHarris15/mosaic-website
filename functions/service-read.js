/**
 * Reading Sundays back out (MS-262).
 *
 * `db`-injected like every other data module here, so the emulator tests can
 * drive it. The SHAPING is not done here — that is
 * shared/service-read-core.js, which the browser can load too, so an
 * assistant and the Order of Service page describe a Sunday the same way.
 *
 * ⚠ NEVER CACHED. An assistant reads a Sunday in order to decide what to
 * write to it, and may well have written to it a moment ago. Serving that
 * read from a cache would let it plan against a Sunday that no longer
 * exists — the one situation where stale data does not merely mislead, it
 * causes a bad write.
 *
 * ⚠ FieldPath IS PASSED IN, NOT REACHED FOR, for the same reason
 * liturgy-writes.js takes its serverTimestamp: a `require("firebase-admin")`
 * here binds to ONE copy of the package, and Firestore rejects a FieldPath
 * that came from a different copy than the handle did ("Detected an object
 * of type FieldPath that doesn't match the expected instance"). The tests
 * load admin from the repo root and functions/ loads its own, so reaching
 * for it works in production and fails in every test — the worst way round.
 */

const core = require("./shared/service-read-core.js");

const SERVICES = "services";

// A range read is bounded so a careless "show me everything" cannot pull the
// entire history into a conversation. Half a year of Sundays is far more
// than anyone plans at once.
const MAX_RANGE = 26;

/**
 * One Sunday.
 *
 * A date with no document is `exists: false`, not an error — most dates have
 * no document, and "nothing is planned that week" is a useful answer.
 *
 * @param {object} db the Firestore handle
 * @param {string} dateKey YYYY-MM-DD
 * @return {Promise<object>} the readable service
 */
async function getService(db, dateKey) {
  const snap = await db.collection(SERVICES).doc(dateKey).get();
  return core.readableService(dateKey, snap.exists ? snap.data() : null);
}

/**
 * Every Sunday with a document between two dates, inclusive.
 *
 * The document id IS the date, so this is an id range rather than a field
 * query — no index needed and no `date` field to drift from the id.
 *
 * Only Sundays that actually have a document come back; the gaps are simply
 * absent rather than padded with empties, so a month with two services
 * planned reads as two, not as four with two blanks.
 *
 * @param {object} db the Firestore handle
 * @param {string} from YYYY-MM-DD, inclusive
 * @param {string} through YYYY-MM-DD, inclusive
 * @param {object} opts
 * @param {object} opts.documentId admin.firestore.FieldPath.documentId()
 * @param {number} [opts.limit] cap on how many come back
 * @return {Promise<{services: Array<object>, truncated: boolean, limit: number}>}
 */
async function getServiceRange(db, from, through, {documentId, limit} = {}) {
  const cap = Math.max(1, Math.min(limit || MAX_RANGE, MAX_RANGE));

  // One more than the cap, so we can tell "exactly full" from "there was
  // more" and say so rather than silently truncating.
  const snap = await db.collection(SERVICES)
      .orderBy(documentId)
      .startAt(from)
      .endAt(through)
      .limit(cap + 1)
      .get();

  const docs = snap.docs.slice(0, cap);
  return {
    services: docs.map((d) => core.readableService(d.id, d.data())),
    truncated: snap.docs.length > cap,
    limit: cap,
  };
}

module.exports = {getService, getServiceRange, MAX_RANGE};
