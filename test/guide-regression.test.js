const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// MS-146 — the control, landed before anything in MS-99 moves.
//
// The Service Guide is the booklet handed out every Sunday. It reads the
// liturgical roles stored on a Service — who is preaching, leading, playing —
// as denormalised fields on `services/{date}`. MS-99 builds a whole Event and
// assignment model around those fields, and the single largest risk in the
// ticket is disturbing the artefact that has to print correctly every week.
//
// So: an UNCHANGED Service must render a BYTE-IDENTICAL guide. Not a fuzzy
// match, not "contains the preacher's name" — the whole booklet, character for
// character, against a committed golden file.
//
// The golden file was generated from the code as it stood BEFORE any MS-99
// work, which is what makes this a genuine control rather than a description of
// whatever the code ended up doing. Regenerate it only when a guide change is
// genuinely intended, and read the diff before you do:
//
//     node test/guide-regression.test.js --write-golden

const Engine = require('../public/guide-engine.js');
const Components = require('../public/guide-components.js');
const Seed = require('../public/guide-seed.js');
const Store = require('../public/guide-store.js');
const DateUtils = require('../public/date-utils.js');

// Browser globals the guide modules reach for.
global.DateUtils = DateUtils;
global.GuideComponents = Components;
global.firebase = { firestore: { FieldPath: { documentId: () => '__id__' } } };

const GOLDEN = path.join(__dirname, 'fixtures', 'service-guide-golden.html');

// ── The fixed Service ─────────────────────────────────────────────────────────
//
// Frozen on purpose: every liturgical role field the guide reads is populated
// with a distinctive value, so a field that is renamed, removed, or re-sourced
// onto the new Assignment model drops its name out of the rendered booklet and
// the byte comparison goes red.

const SERVICE_DATE = '2026-06-14';

const SERVICE = Object.freeze({
    theme: 'The Faithfulness of God',
    keyVerse: 'Lamentations 3:22-23',
    // The liturgical Roles, as denormalised fields (ADR-0018 §2 leaves these alone).
    serviceLeader: 'Sam Leader',
    preacher: 'John Preacher',
    musicLeader: 'Mary Music',
    musicHelpers: ['Hal Helper', 'Nina Notes'],
    sermonette: 'Sid Sermonette',
    hasBaptism: false,
    removedHymns: [],
    liturgy: {
        prayerLabel: 'Pastoral Prayer',
        callToWorship: 'Psalm 100',
        sermon: 'Romans 8:28',
        preparatoryHymn: { id: 'prep', name: 'Prep' },
        hymn1: { id: 'h1', name: 'Holy Holy Holy' },
        hymn2: { id: 'h2', name: 'Be Thou My Vision' },
        hymnMid1: { id: 'm1', name: 'It Is Well' },
        hymnMid2: { id: 'm2', name: 'Amazing Grace' },
        hymnEnd1: { id: 'e1', name: 'Doxology' },
        hymnEnd2: { id: 'e2', name: 'Great Is Thy Faithfulness' },
    },
});

const HYMNS = Object.freeze({
    prep: { hymn_name: 'Prep', versions: [{ pages: ['prep.png'] }], attribution: 'A' },
    h1: { hymn_name: 'Holy Holy Holy', versions: [{ pages: ['h1a.png', 'h1b.png'] }], attribution: 'Heber' },
    h2: { hymn_name: 'Be Thou My Vision', versions: [{ pages: ['h2.png'] }] },
    m1: { hymn_name: 'It Is Well', versions: [{ pages: ['m1.png'] }] },
    m2: { hymn_name: 'Amazing Grace', versions: [{ pages: ['m2.png'] }] },
    e1: { hymn_name: 'Doxology', versions: [{ pages: ['e1.png'] }] },
    e2: { hymn_name: 'Great Is Thy Faithfulness', versions: [{ pages: ['e2.png'] }] },
});

// The Generator Component values the person assembling the booklet supplies.
const ENTRY_VALUES = Object.freeze({ pp_nation: 'Japan', pp_capital: 'Tokyo' });

// ── A tiny fake Firestore ─────────────────────────────────────────────────────

function fakeDb(data) {
    function collection(name) {
        const docs = data[name] || {};
        return {
            doc(id) {
                return { async get() { return { exists: id in docs, id, data: () => docs[id] }; } };
            },
            where() { return this; },
            async get() {
                return { docs: Object.keys(docs).map(id => ({ id, data: () => docs[id] })) };
            },
        };
    }
    return { collection };
}

// ── Rendering the whole booklet, deterministically ────────────────────────────
//
// The ESV lookup is stubbed with a fixed string so the golden does not depend on
// a network call. Everything else is the real chain the two guide pages use:
// resolveServiceContext -> buildSnapshot -> resolveGuide.

async function renderGuide() {
    const db = fakeDb({ services: { [SERVICE_DATE]: SERVICE }, hymns: HYMNS });
    const { context } = await Store.resolveServiceContext(db, SERVICE_DATE, {
        esvFetch: async () => 'The steadfast love of the LORD never ceases; his mercies never come to an end.',
    });

    const seed = Seed.buildSeed(Components.defaultCatalog);
    const snapshot = Store.buildSnapshot(
        seed.guideTemplate,
        Store.indexById(seed.pageTemplates),
        Store.indexById(seed.stylePresets)
    );
    return Engine.resolveGuide(snapshot, ENTRY_VALUES, context, Components.defaultCatalog);
}

// The serialised booklet: every physical page, in order, with its role and HTML.
// Page-level metadata is included because a page silently changing role or
// position is as much a regression as its content changing.
function serialise(result) {
    const header = [
        `<!-- service-guide golden — service ${SERVICE_DATE} -->`,
        `<!-- total=${result.total} realCount=${result.realCount} fillerCount=${result.fillerCount} -->`,
        `<!-- target=${result.target} numberStartPage=${result.numberStartPage} overflow=${result.overflow} -->`,
    ].join('\n');

    const pages = result.pages.map((page, i) => [
        `<!-- page ${i + 1} role=${page.role || ''} snapshotIndex=${page.snapshotIndex} -->`,
        page.html || '',
    ].join('\n'));

    return [header, ...pages].join('\n') + '\n';
}

// ── The regression itself ─────────────────────────────────────────────────────

test('an unchanged Service renders a byte-identical Service Guide', async () => {
    const actual = serialise(await renderGuide());

    assert.ok(
        fs.existsSync(GOLDEN),
        'the golden booklet is missing — regenerate it deliberately, never as a fix for a red test'
    );
    const expected = fs.readFileSync(GOLDEN, 'utf8');

    // Exact, not fuzzy. A first-difference report, because a 16-page diff is
    // unreadable and the character offset is what tells you which page moved.
    if (actual !== expected) {
        let at = 0;
        while (at < actual.length && at < expected.length && actual[at] === expected[at]) at++;
        const window = 160;
        assert.fail(
            'the Service Guide changed for an unchanged Service.\n' +
            `first difference at character ${at}\n` +
            `expected: ${JSON.stringify(expected.slice(at, at + window))}\n` +
            `actual:   ${JSON.stringify(actual.slice(at, at + window))}`
        );
    }
});

test('every liturgical role feeding the guide still reaches the booklet', async () => {
    const rendered = serialise(await renderGuide());

    // Named individually so the failure says WHICH role stopped arriving. If a
    // field is renamed, removed, or re-sourced onto an Assignment, its name
    // vanishes from the booklet and this goes red pointing straight at it.
    const LITURGICAL = [
        ['serviceLeader', 'Sam Leader'],
        ['preacher', 'John Preacher'],
        ['musicLeader', 'Mary Music'],
    ];

    LITURGICAL.forEach(([field, name]) => {
        assert.ok(
            rendered.includes(name),
            `the liturgical role "${field}" no longer reaches the printed guide — ` +
            `"${name}" is absent from the rendered booklet`
        );
    });
});

test('the booklet is a whole number of leaves, as the printer requires', async () => {
    const result = await renderGuide();
    assert.strictEqual(result.total % 4, 0, 'a booklet must be a multiple of 4 pages');
    assert.strictEqual(result.overflow, false, 'the booklet auto-sizes and never overflows');
});

// ── Regenerating ──────────────────────────────────────────────────────────────

if (process.argv.includes('--write-golden')) {
    renderGuide().then(result => {
        fs.mkdirSync(path.dirname(GOLDEN), { recursive: true });
        fs.writeFileSync(GOLDEN, serialise(result), 'utf8');
        console.log('wrote ' + GOLDEN);
    });
}
