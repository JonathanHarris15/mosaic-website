/**
 * The hymn registry reads, lifted out of the getHymnIndex callable so the MCP
 * server (MS-262) can serve the same data without a second copy of the
 * mapping drifting from this one.
 *
 * TWO WAYS IN, AND THEY ARE FOR DIFFERENT CALLERS:
 *
 *   getHymnIndex  — the whole registry. What the website's hymn picker wants:
 *                   it draws the entire list and filters it on screen, so
 *                   fetching it once and caching for five minutes is exactly
 *                   right.
 *
 *   lookupHymns   — the few hymns somebody actually asked about. What an
 *                   assistant wants: "have we sung Holy Holy Holy lately"
 *                   should not drag the entire registry through a
 *                   conversation to answer.
 *
 * ⚠ THE CACHE IS FOR THE PICKER, NOT FOR ASSISTANTS. An assistant reads hymn
 * usage in order to decide what to write to a Sunday, and may have written
 * one a moment ago — five-minute-old counts would have it plan against a
 * history that has already moved. So lookupHymns never caches, and the MCP
 * server asks getHymnIndex for a fresh read explicitly.
 */

const CACHE_TTL_MS = 1000 * 60 * 5; // 5 minutes

// Firestore takes at most 30 values in an `in` query.
const IN_CHUNK = 30;

let cachedIndex = null;
let lastCacheTime = 0;

/** The stored shape, reduced to what a picker or an assistant needs. */
function toRow(doc) {
  const data = doc.data();
  return {
    id: doc.id,
    hymn_name: data.hymn_name || "Unknown",
    variations: data.versions ? data.versions.length : 0,
    music_writer: data.music_writer || "Unknown",
    lyrics_writer: data.lyrics_writer || "Unknown",
    last_played_date: data.last_played_date || null,
    times_played: data.times_played || 0,
    tags: data.tags || [],
    database_url: `/hymns/${doc.id}`,
  };
}

/**
 * Every hymn, with how often and how recently it has been sung.
 *
 * @param {object} db the Firestore handle
 * @param {function(string): void} [log] optional logger
 * @param {{fresh?: boolean}} [opts] `fresh` skips and refills the cache
 * @return {Promise<Array<object>>} the index
 */
async function getHymnIndex(db, log, opts) {
  const say = log || (() => {});
  const fresh = !!(opts && opts.fresh);

  if (!fresh && cachedIndex && (Date.now() - lastCacheTime < CACHE_TTL_MS)) {
    say("Returning index from memory cache.");
    return cachedIndex;
  }

  say("Fetching hymn index from Firestore...");
  const snapshot = await db.collection("hymns").orderBy("hymn_name").get();
  const rows = snapshot.docs.map(toRow);

  say(`Returning index with ${rows.length} hymns.`);
  cachedIndex = rows;
  lastCacheTime = Date.now();
  return rows;
}

/**
 * Just the hymns somebody asked about. Never cached — see the file header.
 *
 * `names` are matched exactly (that is what an `in` query does), so a near
 * miss finds nothing rather than something wrong. `search` is a
 * case-sensitive PREFIX, which is what a Firestore range query can do
 * without a full scan — "Holy" finds "Holy Holy Holy", "holy" does not, and
 * neither finds "O Holy Night". That limitation is stated in the tool
 * description so an assistant can fall back to the full index rather than
 * conclude a hymn does not exist.
 *
 * @param {object} db the Firestore handle
 * @param {object} args
 * @param {Array<string>} [args.names] exact hymn names
 * @param {string} [args.search] a name prefix
 * @param {number} [args.limit] cap on rows returned
 * @return {Promise<{hymns: Array<object>, notFound: Array<string>}>}
 */
async function lookupHymns(db, {names, search, limit} = {}) {
  const cap = Math.max(1, Math.min(limit || 50, 200));
  const wanted = (Array.isArray(names) ? names : [])
      .map((n) => String(n || "").trim()).filter(Boolean);
  const found = new Map();

  for (let i = 0; i < wanted.length; i += IN_CHUNK) {
    const chunk = wanted.slice(i, i + IN_CHUNK);
    const snap = await db.collection("hymns")
        .where("hymn_name", "in", chunk).get();
    snap.docs.forEach((d) => found.set(d.id, toRow(d)));
  }

  const prefix = String(search || "").trim();
  if (prefix) {
    //  sorts above any ordinary character, so this is "everything
    // starting with `prefix`" expressed as a range.
    const snap = await db.collection("hymns")
        .orderBy("hymn_name")
        .startAt(prefix)
        .endAt(prefix + "")
        .limit(cap)
        .get();
    snap.docs.forEach((d) => found.set(d.id, toRow(d)));
  }

  const hymns = Array.from(found.values()).slice(0, cap);

  // Naming what was asked for and not found matters more than it looks: an
  // assistant that just gets a short list cannot tell "we have never sung
  // that" from "you spelled it differently".
  const matchedNames = new Set(hymns.map((h) => h.hymn_name));
  const notFound = wanted.filter((n) => !matchedNames.has(n));

  return {hymns, notFound};
}

/** Drops the cache. For tests — nothing in production needs this. */
function _resetCache() {
  cachedIndex = null;
  lastCacheTime = 0;
}

module.exports = {getHymnIndex, lookupHymns, _resetCache, CACHE_TTL_MS};
