const { test } = require('node:test');
const assert = require('node:assert');

const Engine = require('../public/guide-engine.js');
const Components = require('../public/guide-components.js');
const Seed = require('../public/guide-seed.js');
const Store = require('../public/guide-store.js');

const catalog = Components.defaultCatalog;

function seedSnapshot() {
    const seed = Seed.buildSeed(catalog);
    return Store.buildSnapshot(seed.guideTemplate, Store.indexById(seed.pageTemplates), Store.indexById(seed.stylePresets));
}

// ── normalizeServiceData folds legacy dotted keys ─────────────────────────────

test('normalizeServiceData folds dotted keys, nested value wins', () => {
    const out = Store.normalizeServiceData({ theme: 'T', 'liturgy.sermon': 'Rom 8', liturgy: { callToWorship: 'Ps 100' } });
    assert.strictEqual(out.theme, 'T');
    assert.strictEqual(out.liturgy.callToWorship, 'Ps 100');
    assert.strictEqual(out.liturgy.sermon, 'Rom 8');
});

test('baptismNamesOf reads the candidate array or a legacy string', () => {
    assert.strictEqual(Store.baptismNamesOf({ baptism: [{ name: 'A' }, { name: 'B' }] }), 'A, B');
    assert.strictEqual(Store.baptismNamesOf({ baptism: 'Legacy Name' }), 'Legacy Name');
    assert.strictEqual(Store.baptismNamesOf({}), '');
});

// ── buildSnapshot freezes the template into a self-contained structure ─────────

test('buildSnapshot flattens placements with html, css, preset css, params, role', () => {
    const snap = seedSnapshot();
    assert.strictEqual(snap.targetPageCount, 16);
    assert.strictEqual(snap.guideTemplateId, 'seed_default');

    const oos = snap.pages[1];
    assert.strictEqual(oos.pageTemplateId, 'seed_oos');
    assert.match(oos.html, /oos-list/);
    assert.match(oos.resolvedStylePresetCss, /latex-hr/);  // inherited Mosaic Booklet preset

    // a hymn placement carries its bound slot via params
    const hymnPrep = snap.pages[2];
    assert.strictEqual(hymnPrep.pageTemplateId, 'seed_hymn');
    assert.strictEqual(hymnPrep.emitsPages, 'component');
    assert.strictEqual(hymnPrep.params.field, 'preparatoryHymn');

    // the notes page is the Filler
    const filler = snap.pages.find(p => p.role === 'filler');
    assert.strictEqual(filler.pageTemplateId, 'seed_notes');
});

test('the snapshot is frozen: editing the source template does not change it', () => {
    const seed = Seed.buildSeed(catalog);
    const ptById = Store.indexById(seed.pageTemplates);
    const snap = Store.buildSnapshot(seed.guideTemplate, ptById, Store.indexById(seed.stylePresets));
    const before = snap.pages[1].html;
    // mutate the source page template after snapshotting
    ptById.seed_oos.html = '<p>changed</p>';
    assert.strictEqual(snap.pages[1].html, before);
});

// ── buildGuideRecord + v2/legacy detection ───────────────────────────────────

test('buildGuideRecord stamps the v2 format and carries snapshot + values', () => {
    const snap = seedSnapshot();
    const rec = Store.buildGuideRecord({ id: 'seed_default' }, snap, { pp_nation: 'Japan' });
    assert.strictEqual(rec.format, 'v2');
    assert.strictEqual(rec.guideTemplateId, 'seed_default');
    assert.strictEqual(rec.values.pp_nation, 'Japan');
    assert.strictEqual(rec.snapshot, snap);
});

test('v2 vs legacy guide detection', () => {
    assert.strictEqual(Store.isV2Guide({ format: 'v2', snapshot: {} }), true);
    assert.strictEqual(Store.isV2Guide({ elements: [] }), false);
    assert.strictEqual(Store.isV2Guide(null), false);
    assert.strictEqual(Store.isLegacyGuide({ elements: [{ type: 'title_page' }] }), true);
    assert.strictEqual(Store.isLegacyGuide({ format: 'v2', snapshot: {} }), false);
    assert.strictEqual(Store.isLegacyGuide(null), false); // no guide at all is "new", not legacy
});

// ── override preserves surviving values (ADR-0008 §6) ─────────────────────────

test('preserveValues keeps values whose Entry Field keys survive, drops the rest', () => {
    const snap = seedSnapshot();
    const old = { pp_nation: 'Japan', kids_lesson_title: 'Shepherd', vanished_key: 'gone' };
    const kept = Store.preserveValues(old, snap);
    assert.strictEqual(kept.pp_nation, 'Japan');
    assert.strictEqual(kept.kids_lesson_title, 'Shepherd');
    assert.ok(!('vanished_key' in kept), 'a key not declared by any page is dropped');
});

test('snapshotEntryFields lists every Entry Field across the booklet, de-duped', () => {
    const snap = seedSnapshot();
    const keys = Engine.snapshotEntryFields(snap).map(f => f.key);
    assert.ok(keys.includes('pp_nation'));
    assert.ok(keys.includes('announcements'));
    assert.ok(keys.includes('kids_questions'));
    assert.strictEqual(new Set(keys).size, keys.length, 'no duplicate keys');
});

// ── tasks-remaining computed generically from required Entry Fields ───────────

test('isEntryFieldFilled understands text, image, and list values', () => {
    assert.strictEqual(Store.isEntryFieldFilled('x', { type: 'text' }), true);
    assert.strictEqual(Store.isEntryFieldFilled('  ', { type: 'text' }), false);
    assert.strictEqual(Store.isEntryFieldFilled('data:...', { type: 'image' }), true);
    assert.strictEqual(Store.isEntryFieldFilled([], { type: 'list' }), false);
    assert.strictEqual(Store.isEntryFieldFilled(['a'], { type: 'list' }), true);
    assert.strictEqual(Store.isEntryFieldFilled([{ title: '' }], { type: 'list' }), false);
    assert.strictEqual(Store.isEntryFieldFilled([{ title: 'Notice' }], { type: 'list' }), true);
});

test('an empty booklet has the three tasks of today (prayer, kids, announcements)', () => {
    const snap = seedSnapshot();
    assert.strictEqual(Store.tasksRemaining(snap, {}), 3);
});

test('filling a page\'s required fields clears its task', () => {
    const snap = seedSnapshot();
    const values = { pp_nation: 'Japan', pp_capital: 'Tokyo' }; // prayer page complete
    assert.strictEqual(Store.tasksRemaining(snap, values), 2);

    const all = {
        pp_nation: 'Japan', pp_capital: 'Tokyo',
        kids_lesson_title: 'Shepherd', kids_lesson_verse: 'John 10',
        announcements: [{ title: 'Notice', content: 'x' }],
    };
    assert.strictEqual(Store.tasksRemaining(snap, all), 0);
});

test('nextTaskPageIndex points at the first page still needing input', () => {
    const snap = seedSnapshot();
    // prayer page (index 8 in the snapshot placements) is the first required page
    const idx = Store.nextTaskPageIndex(snap, {});
    assert.strictEqual(snap.pages[idx].pageTemplateId, 'seed_prayer');
    assert.strictEqual(Store.nextTaskPageIndex(snap, {
        pp_nation: 'J', pp_capital: 'T',
        kids_lesson_title: 'S', kids_lesson_verse: 'J',
        announcements: [{ title: 'N' }],
    }), -1);
});
