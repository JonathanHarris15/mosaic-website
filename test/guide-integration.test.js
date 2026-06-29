const { test } = require('node:test');
const assert = require('node:assert');

// End-to-end wiring check for the browser adapter the two new pages depend on:
// resolveServiceContext (Firestore reads) -> buildSnapshot (from the seed) ->
// resolveGuide (the pure engine). Runs against a tiny fake Firestore + stubbed
// browser globals, so the integration the UI relies on is verified without a
// browser.

const Engine = require('../public/guide-engine.js');
const Components = require('../public/guide-components.js');
const Seed = require('../public/guide-seed.js');
const Store = require('../public/guide-store.js');
const DateUtils = require('../public/date-utils.js');

// Browser globals the adapter reaches for.
global.DateUtils = DateUtils;
global.GuideComponents = Components;
global.firebase = { firestore: { FieldPath: { documentId: () => '__id__' } } };

// ── tiny fake Firestore ───────────────────────────────────────────────────────
function fakeDb(data) {
    // data = { services: { '2026-06-14': {...} }, hymns: { h1: {...} } }
    function collection(name) {
        const docs = data[name] || {};
        const api = {
            doc(id) {
                return { async get() { return { exists: id in docs, id, data: () => docs[id] }; } };
            },
            // where().where().get() — ignore the predicates, return all docs.
            where() { return this; },
            async get() {
                return { docs: Object.keys(docs).map(id => ({ id, data: () => docs[id] })) };
            },
        };
        return api;
    }
    return { collection };
}

const SERVICE = {
    theme: 'The Faithfulness of God',
    keyVerse: 'Lamentations 3:22-23',
    preacher: 'John Preacher', musicLeader: 'Mary Music', serviceLeader: 'Sam Leader',
    hasBaptism: false, removedHymns: [],
    liturgy: {
        prayerLabel: 'Pastoral Prayer', callToWorship: 'Psalm 100', sermon: 'Romans 8:28',
        preparatoryHymn: { id: 'prep', name: 'Prep' }, hymn1: { id: 'h1', name: 'Holy Holy Holy' },
        hymn2: { id: 'h2', name: 'Be Thou My Vision' }, hymnMid1: { id: 'm1', name: 'It Is Well' },
        hymnMid2: { id: 'm2', name: 'Amazing Grace' }, hymnEnd1: { id: 'e1', name: 'Doxology' },
        hymnEnd2: { id: 'e2', name: 'Great Is Thy Faithfulness' },
    },
};
const HYMNS = {
    prep: { hymn_name: 'Prep', versions: [{ pages: ['prep.png'] }], attribution: 'A' },
    h1: { hymn_name: 'Holy Holy Holy', versions: [{ pages: ['h1a.png', 'h1b.png'] }], attribution: 'Heber' },
    h2: { hymn_name: 'Be Thou My Vision', versions: [{ pages: ['h2.png'] }] },
    m1: { hymn_name: 'It Is Well', versions: [{ pages: ['m1.png'] }] },
    m2: { hymn_name: 'Amazing Grace', versions: [{ pages: ['m2.png'] }] },
    e1: { hymn_name: 'Doxology', versions: [{ pages: ['e1.png'] }] },
    e2: { hymn_name: 'Great Is Thy Faithfulness', versions: [{ pages: ['e2.png'] }] },
};

test('resolveServiceContext reads names, hymn images, and schedule', async () => {
    const db = fakeDb({ services: { '2026-06-14': SERVICE }, hymns: HYMNS });
    const { context } = await Store.resolveServiceContext(db, '2026-06-14', { esvFetch: async () => 'The steadfast love of the LORD' });
    assert.strictEqual(context.theme, 'The Faithfulness of God');
    assert.strictEqual(context.preacher, 'John Preacher');
    assert.strictEqual(context.keyVerseText, 'The steadfast love of the LORD');
    assert.deepStrictEqual(context.hymnsByField.hymn1.pages, ['h1a.png', 'h1b.png']);
    assert.strictEqual(context.hymnsByField.hymn1.attribution, 'Heber');
    assert.ok(context.schedule.length >= 1);
    assert.match(context.longDate, /2026/);
});

test('the full chain (context -> seed snapshot -> engine) yields a 16-page booklet', async () => {
    const db = fakeDb({ services: { '2026-06-14': SERVICE }, hymns: HYMNS });
    const { context } = await Store.resolveServiceContext(db, '2026-06-14', { esvFetch: async () => 'verse' });

    const seed = Seed.buildSeed(Components.defaultCatalog);
    const snapshot = Store.buildSnapshot(seed.guideTemplate, Store.indexById(seed.pageTemplates), Store.indexById(seed.stylePresets));
    const result = Engine.resolveGuide(snapshot, { pp_nation: 'Japan', pp_capital: 'Tokyo' }, context, Components.defaultCatalog);

    assert.strictEqual(result.total, 16);
    assert.strictEqual(result.overflow, false);
    // hymn1's two sheet images each become their own physical page
    assert.ok(result.pages.some(p => /h1a\.png/.test(p.html)));
    assert.ok(result.pages.some(p => /h1b\.png/.test(p.html)));
    assert.strictEqual(result.pages.filter(p => /h1a\.png|h1b\.png/.test(p.html)).length, 2);
    // saved value flows through
    assert.ok(result.pages.some(p => /Japan/.test(p.html)));
});

test('a missing service still resolves (empty booklet context, no throw)', async () => {
    const db = fakeDb({ services: {}, hymns: {} });
    const { context, service } = await Store.resolveServiceContext(db, '2030-01-06', {});
    assert.strictEqual(service.theme, undefined);
    assert.strictEqual(context.theme, '');
    assert.deepStrictEqual(context.hymnsByField, {});
});
