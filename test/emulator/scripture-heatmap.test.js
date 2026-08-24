const {describe, test, before, beforeEach} = require('node:test');
const assert = require('node:assert');

const H = require('./harness.js');
const {getScriptureHeatmap} = require('../../functions/scripture-heatmap.js');

// oos_get_scripture_heatmap (MS-262). A plain read, but a real Firestore
// round-trip is worth pinning: orderBy() silently drops any document missing
// the field it orders on, which a hand-written fake would not catch.

const suite = H.skipReason
    ? (name) => test(name, {skip: H.skipReason}, () => {})
    : describe;

suite('oos_get_scripture_heatmap reads', () => {
    let db;

    before(() => {
        db = H.connect();
    });

    beforeEach(async () => {
        await H.wipe();
    });

    test('returns every reference used, with its count and last-used date', async () => {
        await db.collection('scripture_usage').doc('John 3:16').set({
            reference: 'John 3:16', count: 4, lastUsed: '2026-01-04',
        });
        await db.collection('scripture_usage').doc('Romans 8:28').set({
            reference: 'Romans 8:28', count: 1, lastUsed: '2025-11-02',
        });

        const rows = await getScriptureHeatmap(db);
        assert.deepStrictEqual(rows, [
            {reference: 'John 3:16', count: 4, lastUsed: '2026-01-04'},
            {reference: 'Romans 8:28', count: 1, lastUsed: '2025-11-02'},
        ]);
    });

    test('an empty collection returns an empty list, not an error', async () => {
        assert.deepStrictEqual(await getScriptureHeatmap(db), []);
    });
});
