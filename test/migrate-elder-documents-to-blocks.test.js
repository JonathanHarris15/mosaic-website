const { test } = require('node:test');
const assert = require('node:assert');

const M = require('../scripts/migrate-elder-documents-to-blocks.js');
const Body = require('../public/document-body-core.js');

// Storing every Elder Document's body as Blocks ahead of time (MS-503).
// Pages convert a document when they open it; this does the rest in advance,
// and names any document it cannot convert without changing it.

const text = (t) => ({ type: 'text', text: t });
const legacy = (extra) => Object.assign({
    title: 'Minutes',
    docType: 'note',
    contentJson: { type: 'doc', content: [
        { type: 'heading', attrs: { level: 2 }, content: [text('Elders')] },
        { type: 'paragraph', content: [text('Opened in prayer.')] },
        { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [text('Visits')] }] }] },
    ] },
}, extra);

test('a legacy note is converted, and its Blocks give back the same body', () => {
    const plan = M.planFor(legacy());
    assert.strictEqual(plan.action, 'convert');
    assert.ok(Body.sameBodyIgnoringIds(Body.bodyOfBlocks(plan.blocks), legacy().contentJson));
});

test('a document already stored as Blocks is left alone', () => {
    const plan = M.planFor({ docType: 'note', blocks: Body.blocksOfBody(legacy().contentJson) });
    assert.strictEqual(plan.action, 'skip');
});

test('a Care List and a Form Document are left alone', () => {
    assert.strictEqual(M.planFor({ docType: 'care-list', careListData: {} }).action, 'skip');
    assert.strictEqual(M.planFor({ docType: 'form', answers: {} }).action, 'skip');
});

test('a document too big to fit as Blocks is named, not written', () => {
    const huge = 'x'.repeat(M.MAX_BYTES + 10);
    const plan = M.planFor(legacy({ contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [text(huge)] }] } }));
    assert.strictEqual(plan.action, 'refuse');
    assert.match(plan.reason, /too large/);
});

// A stand-in database holding documents by id, with transactions.
function fakeDb(docs) {
    const store = JSON.parse(JSON.stringify(docs));
    const refOf = (id) => ({ id, get: async () => snapOf(id) });
    const snapOf = (id) => ({ id, ref: refOf(id), exists: id in store, data: () => JSON.parse(JSON.stringify(store[id])) });
    return {
        store,
        collection: () => ({ get: async () => ({ size: Object.keys(store).length, docs: Object.keys(store).map(snapOf) }) }),
        runTransaction: async (fn) => fn({
            get: async (ref) => snapOf(ref.id),
            update: (ref, patch) => {
                Object.keys(patch).forEach(k => {
                    if (patch[k] === 'DELETE') delete store[ref.id][k]; else store[ref.id][k] = patch[k];
                });
            },
        }),
    };
}
const FieldValue = { delete: () => 'DELETE' };
const quiet = () => {};

test('a dry run writes nothing', async () => {
    const db = fakeDb({ a: legacy() });
    const out = await M.run({ db, FieldValue, write: false, log: quiet });
    assert.strictEqual(out.convert, 1);
    assert.strictEqual(out.written, 0);
    assert.ok('contentJson' in db.store.a);
});

test('a real run converts, and a second run finds nothing to do', async () => {
    const db = fakeDb({ a: legacy(), b: legacy({ title: 'Other' }), c: { docType: 'care-list' } });
    const first = await M.run({ db, FieldValue, write: true, log: quiet });
    assert.strictEqual(first.written, 2);
    assert.ok(!('contentJson' in db.store.a));
    assert.ok(Body.hasBlocks(db.store.a));
    const second = await M.run({ db, FieldValue, write: true, log: quiet });
    assert.strictEqual(second.convert, 0);
    assert.strictEqual(second.written, 0);
});

test('a document a page converted in the meantime is not converted again', async () => {
    const db = fakeDb({ a: legacy() });
    const byPage = Body.blocksOfBody(legacy().contentJson);
    db.store.a.blocks = byPage;
    delete db.store.a.contentJson;
    const wrote = await M.convertOne(db, FieldValue, { id: 'a' });
    assert.strictEqual(wrote, false);
    assert.deepStrictEqual(db.store.a.blocks, byPage);
});
