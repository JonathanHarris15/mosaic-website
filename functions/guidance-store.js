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
 */

const GUIDANCE = "mcp_guidance";

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
async function listGuidance(db) {
  const snap = await db.collection(GUIDANCE)
      .where("enabled", "==", true)
      .get();

  return snap.docs
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
async function getGuidance(db, slug) {
  const snap = await db.collection(GUIDANCE)
      .where("slug", "==", String(slug || ""))
      .where("enabled", "==", true)
      .limit(1)
      .get();

  return snap.empty ? null : toRow(snap.docs[0]);
}

module.exports = {listGuidance, getGuidance, GUIDANCE};
