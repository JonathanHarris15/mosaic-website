// Service Guide — Builder/Generator surface model (ADR-0010).
//
// These specify the *pure* behaviour behind the Order of Service editor's new
// "Use legacy system" toggle + Service Guide Template dropdown:
//   - every Component declares which surface informs it (builder vs generator);
//   - a snapshot's Entry Fields partition by that surface;
//   - a template's builder-surface section components (baptism, prayer subjects,
//     congregational prayer) are discoverable so the Builder can prompt them;
//   - which guide system a week uses (legacy vs v2) and where "Generate" routes;
//   - two parties writing one shared values map merge rather than clobber.
//
// Pure data in, pure data out — no DOM, no Firestore (run under `node --test`).

const test = require('node:test');
const assert = require('node:assert');

const Components = require('../public/guide-components.js');
const Engine = require('../public/guide-engine.js');
const Seed = require('../public/guide-seed.js');
const Store = require('../public/guide-store.js');

const catalog = Components.defaultCatalog;

// A frozen default snapshot, the way a week's Order of Service editor builds it.
function defaultSnapshot() {
    const seed = Seed.buildSeed(catalog);
    return Store.buildSnapshot(
        seed.guideTemplate,
        Store.indexById(seed.pageTemplates),
        Store.indexById(seed.stylePresets),
    );
}

// ── 1. Every Component declares a surface ────────────────────────────────────
test('every catalog Component declares surface builder or generator', () => {
    for (const c of catalog.all()) {
        assert.ok(
            c.surface === 'builder' || c.surface === 'generator',
            `Component <${c.tag}> must declare surface builder|generator, got ${c.surface}`,
        );
    }
});

test('the weekly fill-in input components are generator-surface (Party 2)', () => {
    for (const tag of ['input-text', 'input-richtext', 'input-image', 'input-list']) {
        assert.equal(catalog.get(tag).surface, 'generator', `<${tag}> should be generator`);
    }
});

test('baptism, prayer subjects and congregational prayer are builder-surface section components', () => {
    for (const tag of ['baptism-candidates', 'pastoral-prayer-subjects', 'congregational-prayer']) {
        const c = catalog.get(tag);
        assert.ok(c, `catalog must contain <${tag}>`);
        assert.equal(c.surface, 'builder', `<${tag}> should be builder-surface`);
        assert.ok(c.section, `<${tag}> should name the bespoke Builder section it drives`);
    }
});

// ── 2. deriveEntryFields stamps surface ──────────────────────────────────────
test('derived Entry Fields carry their Component surface', () => {
    const html = '<input-text key="pp_nation" label="Nation" required></input-text>';
    const { fields } = Engine.deriveEntryFields(html, catalog);
    assert.equal(fields.length, 1);
    assert.equal(fields[0].key, 'pp_nation');
    assert.equal(fields[0].surface, 'generator');
});

// ── 3. partitionEntryFields splits a snapshot by surface ─────────────────────
test('partitionEntryFields buckets each field by its surface', () => {
    const snapshot = {
        pages: [{
            entryFields: [
                { key: 'pp_nation', surface: 'generator' },
                { key: 'baptism_who', surface: 'builder' },
                { key: 'announcements', surface: 'generator' },
            ],
        }],
    };
    const { builder, generator } = Store.partitionEntryFields(snapshot);
    assert.deepEqual(builder.map(f => f.key), ['baptism_who']);
    assert.deepEqual(generator.map(f => f.key), ['pp_nation', 'announcements']);
});

test('the default booklet asks Party 2 (generator) for its fill-ins, none on the builder', () => {
    const { builder, generator } = Store.partitionEntryFields(defaultSnapshot());
    // Nation/Capital, kids, announcements are all generator-surface.
    const genKeys = generator.map(f => f.key);
    assert.ok(genKeys.includes('pp_nation'));
    assert.ok(genKeys.includes('pp_capital'));
    assert.ok(genKeys.includes('announcements'));
    // No generic builder-surface Entry Fields exist yet (baptism etc. are bespoke
    // section components, not input fields).
    assert.deepEqual(builder, []);
});

// ── 4. builder section components are discoverable from a snapshot ────────────
test('builderSections lists the bespoke builder components a template requests', () => {
    const snapshot = {
        pages: [
            { html: '<pastoral-prayer-subjects></pastoral-prayer-subjects>' },
            { html: '<baptism-candidates></baptism-candidates>' },
        ],
    };
    const sections = Store.builderSections(snapshot, catalog);
    assert.ok(sections.includes('pastoral-prayer-subjects'));
    assert.ok(sections.includes('baptism'));
});

test('templateIncludesBaptism is true only when the snapshot places the baptism component', () => {
    const withBaptism = { pages: [{ html: '<baptism-candidates></baptism-candidates>' }] };
    const without = { pages: [{ html: '<oos-list></oos-list>' }] };
    assert.equal(Store.templateIncludesBaptism(withBaptism, catalog), true);
    assert.equal(Store.templateIncludesBaptism(without, catalog), false);
});

test('the default template does not request baptism (variant templates ship later)', () => {
    assert.equal(Store.templateIncludesBaptism(defaultSnapshot(), catalog), false);
});

test('the default template requests the pastoral-prayer-subjects section (today\'s booklet shows subjects)', () => {
    assert.ok(Store.builderSections(defaultSnapshot(), catalog).includes('pastoral-prayer-subjects'));
});

// ── 5. which guide system a week uses, and where Generate routes ─────────────
test('guideSystemOf defaults a fresh week to v2', () => {
    assert.equal(Store.guideSystemOf({}), 'v2');
    assert.equal(Store.guideSystemOf({ guideSystem: 'v2' }), 'v2');
});

test('guideSystemOf honours an explicit legacy toggle', () => {
    assert.equal(Store.guideSystemOf({ guideSystem: 'legacy' }), 'legacy');
});

test('guideSystemOf falls back to legacy for a pre-existing elements-blob week', () => {
    // Back-compat: weeks created before the toggle carry no guideSystem.
    assert.equal(Store.guideSystemOf({ guide: { elements: [{ type: 'order_of_service' }] } }), 'legacy');
});

test('guideHref routes legacy weeks to the legacy generator and v2 weeks to the new one', () => {
    assert.equal(
        Store.guideHref({ guideSystem: 'legacy' }, '2026-07-05'),
        'service-guide.html?date=2026-07-05',
    );
    assert.equal(
        Store.guideHref({ guideSystem: 'v2' }, '2026-07-05'),
        'service-guide-editor.html?date=2026-07-05',
    );
});

// ── 6. two parties merge into one shared values map ──────────────────────────
test('mergeValues lets a later save add keys without clobbering the other surface', () => {
    const afterBuilder = { baptism_who: 'Jane Doe' };
    const fromGenerator = { pp_nation: 'Japan', pp_capital: 'Tokyo' };
    const merged = Store.mergeValues(afterBuilder, fromGenerator);
    assert.deepEqual(merged, { baptism_who: 'Jane Doe', pp_nation: 'Japan', pp_capital: 'Tokyo' });
});

test('mergeValues overwrites only the keys the incoming surface re-sends', () => {
    const existing = { pp_nation: 'Japan', announcements: ['a'] };
    const incoming = { pp_nation: 'Kenya' };
    assert.deepEqual(Store.mergeValues(existing, incoming), { pp_nation: 'Kenya', announcements: ['a'] });
});

test('mergeValues does not mutate its inputs', () => {
    const existing = { a: 1 };
    const incoming = { b: 2 };
    Store.mergeValues(existing, incoming);
    assert.deepEqual(existing, { a: 1 });
    assert.deepEqual(incoming, { b: 2 });
});
