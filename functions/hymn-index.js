/**
 * The hymn index read, lifted out of the getHymnIndex callable so the MCP
 * server (MS-262) can serve the same list without a second copy of the
 * mapping drifting from this one.
 *
 * ⚠ BEHAVIOUR UNCHANGED. This is the same query, the same field mapping and
 * the same 5-minute in-memory cache getHymnIndex has always had — it is
 * `db`-injected and moved, not rewritten. The callable in index.js is now a
 * thin wrapper over it, so the browser's hymn picker and an assistant asking
 * "what have we sung lately" cannot be told different things.
 *
 * The cache lives here, module-scoped, exactly as it lived in index.js: one
 * Cloud Functions instance reuses it across calls and a recycled instance
 * simply starts cold again.
 */

const CACHE_TTL_MS = 1000 * 60 * 5; // 5 minutes

let cachedIndex = null;
let lastCacheTime = 0;

/**
 * Every hymn, with how often and how recently it has been sung.
 * @param {object} db the Firestore handle
 * @param {function(string): void} [log] optional logger
 * @return {Promise<Array<object>>} the index
 */
async function getHymnIndex(db, log) {
  const say = log || (() => {});

  if (cachedIndex && (Date.now() - lastCacheTime < CACHE_TTL_MS)) {
    say("Returning index from memory cache.");
    return cachedIndex;
  }

  say("Fetching hymn index from Firestore...");
  const hymnsSnapshot = await db.collection("hymns").orderBy("hymn_name").get();

  const hymnIndexData = hymnsSnapshot.docs.map((doc) => {
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
  });

  say(`Returning index with ${hymnIndexData.length} hymns.`);
  cachedIndex = hymnIndexData;
  lastCacheTime = Date.now();
  return hymnIndexData;
}

/** Drops the cache. For tests — nothing in production needs this. */
function _resetCache() {
  cachedIndex = null;
  lastCacheTime = 0;
}

module.exports = {getHymnIndex, _resetCache, CACHE_TTL_MS};
