/**
 * Reading the guidance files an assistant pulls down through the MCP
 * (MS-262). Editors write them on the MCP Manager page; this only reads.
 *
 * `db`-injected like every other data module here.
 *
 * ⚠ NEVER CACHED. An editor rewrites guidance precisely because the
 * assistant is doing something they want changed. A five-minute cache would
 * mean fixing the wording and watching it carry on regardless — the sort of
 * thing that gets a feature abandoned rather than reported.
 *
 * ⚠ DISABLED FILES ARE INVISIBLE, NOT MERELY UNLISTED. A file switched off
 * is switched off for reading too. Leaving it readable-by-address would make
 * the toggle a suggestion, and an assistant that had been told a URI once
 * would keep following retired instructions.
 *
 * ⚠ AND SO ARE LOCKED ONES, FOR THE SAME REASON. A file marked elder-only is
 * not merely left out of an editor's list — it cannot be fetched by address
 * either. Guidance is instructions an assistant follows, so elder-only
 * guidance can name people and say how to handle them; a lock that only hid
 * the file from a listing would be a lock an assistant walks straight past the
 * first time it is told the address.
 *
 * ⚠ THE FILTERING HERE IS THE REAL GATE FOR THE MCP. These run through the
 * Admin SDK, which goes past firestore.rules entirely. The rules protect the
 * BROWSER; this protects the assistant. Neither covers the other.
 */

const GUIDANCE = "mcp_guidance";

/**
 * Whether this caller may read elder-only guidance.
 * @param {object} [options] {level} the caller's permission level
 * @return {boolean} true for an elder or a super admin
 */
function readsLocked(options) {
  const level = options && options.level;
  return level === "elder" || level === "super_admin";
}

/** The stored shape, as the MCP serves it. */
function toRow(doc) {
  const d = doc.data();
  return {
    id: doc.id,
    slug: d.slug || doc.id,
    title: d.title || "Untitled",
    summary: d.summary || "",
    body: d.body || "",
    updatedAt: d.updatedAt || null,
    updatedByName: d.updatedByName || null,
    eldersOnly: d.eldersOnly === true,
  };
}

/**
 * Every guidance file currently switched on, without their bodies.
 *
 * The body is left out on purpose: this is the list an assistant reads to
 * decide WHICH file it needs, and including every body would return the
 * whole library every time somebody asked what was available.
 *
 * @param {object} db the Firestore handle
 * @return {Promise<Array<object>>} slug, title and summary for each
 */
async function listGuidance(db, options) {
  const snap = await db.collection(GUIDANCE)
      .where("enabled", "==", true)
      .get();

  const locked = readsLocked(options);

  return snap.docs
      .filter((doc) => locked || (doc.data() || {}).eldersOnly !== true)
      .map(toRow)
      .map(({body, ...rest}) => rest)
      .sort((a, b) => a.title.localeCompare(b.title));
}

/**
 * One guidance file, in full, by its slug.
 *
 * Returns null when there is no such file or it is switched off — the caller
 * turns that into a readable refusal rather than an empty document, because
 * an assistant handed an empty body would follow no guidance and never
 * mention it.
 *
 * @param {object} db the Firestore handle
 * @param {string} slug the file's address
 * @return {Promise<?object>} the file, or null
 */
async function getGuidance(db, slug, options) {
  const snap = await db.collection(GUIDANCE)
      .where("slug", "==", String(slug || ""))
      .where("enabled", "==", true)
      .limit(1)
      .get();

  if (snap.empty) return null;

  // Locked and the caller is not an elder: the same answer as "no such file".
  // Saying "that one is elder-only" would confirm it exists and hand over its
  // address, which is most of what the lock is for.
  const doc = snap.docs[0];
  if ((doc.data() || {}).eldersOnly === true && !readsLocked(options)) return null;

  return toRow(doc);
}

module.exports = {listGuidance, getGuidance, readsLocked, GUIDANCE};
