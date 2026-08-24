/**
 * The Firestore half of oos_get_scripture_heatmap (MS-262).
 *
 * `db` taken as an argument for the same reason as assignment-writes.js and
 * liturgy-writes.js: `admin.firestore()` reached for inside a callable
 * cannot be pointed at the test emulator.
 *
 * Reads `scripture_usage/{reference}`, written by
 * updateOrderOfServiceUsageStats (index.js) — `count` and `lastUsed` per
 * reference. Same shape and pattern as getHymnIndex: today this collection
 * is only read client-side, by public/usage-stats-store.js on the Analytics
 * page.
 */

const SCRIPTURE_USAGE = "scripture_usage";

/**
 * Every scripture reference used at least once, with its usage count and
 * last-used date.
 * @param {object} db the Firestore handle
 * @return {Promise<Array<{reference: string, count: number, lastUsed: ?string}>>}
 */
async function getScriptureHeatmap(db) {
  const snap = await db.collection(SCRIPTURE_USAGE).orderBy("reference").get();
  return snap.docs.map((doc) => {
    const data = doc.data();
    return {
      reference: data.reference || doc.id,
      count: data.count || 0,
      lastUsed: data.lastUsed || null,
    };
  });
}

module.exports = {getScriptureHeatmap};
