/**
 * Scripture usage reads (MS-262).
 *
 * `db`-injected for the same reason as every other data module here: an
 * `admin.firestore()` reached for inside a callable cannot be pointed at the
 * test emulator.
 *
 * Reads `scripture_usage/{reference}`, written by
 * updateOrderOfServiceUsageStats (index.js) — `count` and `lastUsed` per
 * reference. Until this ticket the collection was only ever read
 * client-side, on the Analytics page (public/usage-stats-store.js).
 *
 * TWO WAYS IN, AND THEY ARE FOR DIFFERENT CALLERS:
 *
 *   getScriptureHeatmap — every reference on record. What the Analytics page
 *                         wants, because it draws the whole heat map.
 *
 *   lookupScripture     — just the references somebody asked about. What an
 *                         assistant wants: "have we used John 3:16 recently"
 *                         should not drag every reference the church has
 *                         ever used through a conversation to answer.
 *
 * ⚠ NEITHER IS CACHED. An assistant reads usage in order to decide what to
 * write, and may have written a moment ago.
 */

const SCRIPTURE_USAGE = "scripture_usage";

/** The stored shape, as a plain row. */
function toRow(id, data) {
  return {
    reference: (data && data.reference) || id,
    count: (data && data.count) || 0,
    lastUsed: (data && data.lastUsed) || null,
  };
}

/**
 * Every scripture reference used at least once, with its usage count and
 * last-used date.
 * @param {object} db the Firestore handle
 * @return {Promise<Array<object>>} every reference on record
 */
async function getScriptureHeatmap(db) {
  const snap = await db.collection(SCRIPTURE_USAGE).orderBy("reference").get();
  return snap.docs.map((doc) => toRow(doc.id, doc.data()));
}

/**
 * Just the references somebody asked about.
 *
 * `references` are looked up by document id, which IS the reference string —
 * so they must match exactly, punctuation and spacing included ("John 3:16",
 * not "john 3 16"). `book` is a case-sensitive PREFIX over the same ids, so
 * "John" catches every John reference but not "1 John" — which is a genuinely
 * different book, so that is correct rather than a limitation.
 *
 * ⚠ A REFERENCE THAT COMES BACK WITH count 0 HAS NEVER BEEN USED, and that
 * is the useful answer, not a miss. It is reported explicitly rather than
 * left out, because an assistant handed a short list cannot otherwise tell
 * "never preached" from "you spelled it differently".
 *
 * @param {object} db the Firestore handle
 * @param {object} args
 * @param {Array<string>} [args.references] exact references
 * @param {string} [args.book] a reference prefix, usually a book name
 * @param {number} [args.limit] cap on rows returned
 * @return {Promise<{scripture: Array<object>, neverUsed: Array<string>}>}
 */
async function lookupScripture(db, {references, book, limit} = {}) {
  const cap = Math.max(1, Math.min(limit || 50, 200));
  const wanted = (Array.isArray(references) ? references : [])
      .map((r) => String(r || "").trim()).filter(Boolean);

  const found = new Map();
  const neverUsed = [];

  if (wanted.length) {
    const snaps = await db.getAll(
        ...wanted.map((r) => db.collection(SCRIPTURE_USAGE).doc(r)));
    snaps.forEach((snap, i) => {
      if (snap.exists) {
        found.set(snap.id, toRow(snap.id, snap.data()));
      } else {
        neverUsed.push(wanted[i]);
      }
    });
  }

  const prefix = String(book || "").trim();
  if (prefix) {
    const snap = await db.collection(SCRIPTURE_USAGE)
        .orderBy("reference")
        .startAt(prefix)
        .endAt(prefix + "")
        .limit(cap)
        .get();
    snap.docs.forEach((d) => found.set(d.id, toRow(d.id, d.data())));
  }

  return {
    scripture: Array.from(found.values()).slice(0, cap),
    neverUsed,
  };
}

module.exports = {getScriptureHeatmap, lookupScripture};
