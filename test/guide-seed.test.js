const { test } = require('node:test');
const assert = require('node:assert');

const Engine = require('../public/guide-engine.js');
const Components = require('../public/guide-components.js');
const Seed = require('../public/guide-seed.js');
const Store = require('../public/guide-store.js');

// ADR-0008 v1 acceptance gate: the developer-seeded default Service Guide
// Template, run through the new pure engine, reproduces today's 16-page booklet —
// same page order, same conditional hymn/baptism behaviour, same saddle-stitch
// imposition — but now every page is a composable Page Template.

const catalog = Components.defaultCatalog;

// A representative Sunday: every hymn slot filled (hymn1 spans two sheet images),
// no baptism, nothing removed. Mirrors the data the old loadService/
// fetchHymnDetails/fetchSchedule produced.
function fixtureContext(overrides) {
    const base = {
        date: '2026-06-14',
        longDate: 'Sunday, June 14, 2026',
        shortDate: '06/14/26',
        theme: 'The Faithfulness of God',
        keyVerse: 'Lamentations 3:22-23',
        keyVerseText: 'The steadfast love of the LORD never ceases.',
        preacher: 'John Preacher',
        musicLeader: 'Mary Music',
        serviceLeader: 'Sam Leader',
        hasBaptism: false,
        removedHymns: [],
        baptismNames: '',
        liturgy: {
            prayerLabel: 'Pastoral Prayer',
            callToWorship: 'Psalm 100',
            callToConfession: '1 John 1:8',
            assuranceOfPardon: '1 John 1:9',
            scriptureReading: 'Romans 8',
            sermon: 'Romans 8:28',
            benediction: 'Numbers 6',
            preparatoryHymn: { id: 'p', name: 'Prep Hymn' },
            hymn1: { id: 'h1', name: 'Holy Holy Holy' },
            hymn2: { id: 'h2', name: 'Be Thou My Vision' },
            hymnMid1: { id: 'm1', name: 'It Is Well' },
            hymnMid2: { id: 'm2', name: 'Amazing Grace' },
            hymnEnd1: { id: 'e1', name: 'Doxology' },
            hymnEnd2: { id: 'e2', name: 'Great Is Thy Faithfulness' },
            prayerMale: { id: 'pm', name: 'Bob' },
            prayerFemale: { id: 'pf', name: 'Alice' },
        },
        hymnsByField: {
            preparatoryHymn: { name: 'Prep Hymn', pages: ['prep.png'] },
            hymn1: { name: 'Holy Holy Holy', pages: ['h1a.png', 'h1b.png'], attribution: 'Heber, 1826' },
            hymn2: { name: 'Be Thou My Vision', pages: ['h2.png'] },
            hymnMid1: { name: 'It Is Well', pages: ['m1.png'] },
            hymnMid2: { name: 'Amazing Grace', pages: ['m2.png'] },
            hymnEnd1: { name: 'Doxology', pages: ['e1.png'] },
            hymnEnd2: { name: 'Great Is Thy Faithfulness', pages: ['e2.png'] },
        },
        schedule: [
            { id: '2026-06-14', preacher: 'John Preacher', sermon: 'Romans 8:28' },
            { id: '2026-06-21', preacher: 'Guest', sermon: 'Acts 2' },
        ],
    };
    return Object.assign(base, overrides || {});
}

const fixtureValues = {
    pp_nation: 'Japan', pp_continent: 'Asia', pp_capital: 'Tokyo', pp_population: '125M',
    pp_language: 'Japanese', pp_total_languages: '15', pp_literacy: '99%',
    pp_christian: '1%', pp_evangelical: '0.5%', pp_unevangelized: '60%',
    pp_country_image: 'data:image/png;base64,xyz',
    pp_prompts: ['Pray for the church', 'Pray for missionaries'],
    kids_lesson_title: 'The Good Shepherd', kids_lesson_verse: 'John 10',
    kids_summary: ['Jesus cares for his sheep'],
    kids_questions: ['Who is the shepherd?'],
    announcements: [{ title: 'Prayer Meeting', content: 'Wednesday 7pm' }],
};

function resolveFixture(ctx, values) {
    const seed = Seed.buildSeed(catalog);
    const snapshot = Store.buildSnapshot(
        seed.guideTemplate,
        Store.indexById(seed.pageTemplates),
        Store.indexById(seed.stylePresets));
    return { snapshot, result: Engine.resolveGuide(snapshot, values || {}, ctx, catalog) };
}

test('the seeded default produces exactly a 16-page booklet for a full service', () => {
    const { result } = resolveFixture(fixtureContext(), fixtureValues);
    assert.strictEqual(result.total, 16);
    assert.strictEqual(result.overflow, false);
});

test('page order matches today: title, oos, opening hymns, prayer, notes, response hymns, kids, announcements', () => {
    const { result } = resolveFixture(fixtureContext(), fixtureValues);
    const ids = result.pages.map(p => p.pageTemplateId);
    const roles = result.pages.map(p => p.role);

    // First eight reading positions are fixed.
    assert.strictEqual(ids[0], 'seed_title');
    assert.strictEqual(ids[1], 'seed_oos');
    // hymn pages: prep(1) + h1(2) + h2(1) + mid1(1) + mid2(1) = 6 hymn pages (idx 2..7)
    for (let i = 2; i <= 7; i++) assert.strictEqual(ids[i], 'seed_hymn', `page ${i} is a hymn`);
    assert.strictEqual(ids[8], 'seed_prayer');

    // The Filler (Sermon Notes) sits after the prayer, before the response hymns.
    const firstFiller = roles.indexOf('filler');
    assert.strictEqual(firstFiller, 9);
    assert.strictEqual(ids[firstFiller], 'seed_notes');

    // Response hymns, then kids, then announcements close the booklet.
    assert.strictEqual(ids[ids.length - 1], 'seed_announcements');
    assert.strictEqual(ids[ids.length - 2], 'seed_kids');
});

test('real page count drives the filler so the booklet always totals the target', () => {
    const { result } = resolveFixture(fixtureContext(), fixtureValues);
    // title+oos+prayer+kids+announcements (5) + hymn pages (1+2+1+1+1+1+1 = 8) = 13 real
    assert.strictEqual(result.realCount, 13);
    assert.strictEqual(result.fillerCount, 3);
    assert.strictEqual(result.total, 16);
});

test('a baptism omits the hymn2 sheet pages and the booklet still totals 16', () => {
    const ctx = fixtureContext({ hasBaptism: true, baptismNames: 'Jane Doe, John Doe' });
    const { result } = resolveFixture(ctx, fixtureValues);
    assert.strictEqual(result.total, 16);
    // one fewer real hymn page (hymn2 dropped) -> one more filler page
    assert.strictEqual(result.realCount, 12);
    assert.strictEqual(result.fillerCount, 4);
    // the OOS list hides the hymn2 row and shows the Baptism row with names
    const oos = result.pages[1].html;
    assert.match(oos, /Baptism/);
    assert.match(oos, /Jane Doe, John Doe/);
});

test('removing a hymn slot drops its pages and the filler absorbs them', () => {
    const ctx = fixtureContext({ removedHymns: ['hymnEnd2'] });
    const { result } = resolveFixture(ctx, fixtureValues);
    assert.strictEqual(result.total, 16);
    assert.strictEqual(result.realCount, 12);   // 13 - hymnEnd2's one page
    assert.strictEqual(result.fillerCount, 4);
});

test('bound data lands on the right pages (date, theme, verse, leaders, schedule)', () => {
    const { result } = resolveFixture(fixtureContext(), fixtureValues);
    assert.match(result.pages[0].html, /Sunday, June 14, 2026/);          // title
    const oos = result.pages[1].html;
    assert.match(oos, /The Faithfulness of God/);                          // theme
    assert.match(oos, /steadfast love of the LORD/);                       // key verse text
    assert.match(oos, /Lamentations 3:22-23/);                            // key verse ref
    assert.match(oos, /John Preacher/);                                    // preacher footer
    assert.match(oos, /Holy Holy Holy/);                                   // hymn1 in the list
    // announcements page carries the preaching schedule
    const ann = result.pages.find(p => p.pageTemplateId === 'seed_announcements').html;
    assert.match(ann, /Preaching Schedule/);
    assert.match(ann, /06\/21\/26/);
});

test('filled Entry Field values render on the prayer / kids / announcements pages', () => {
    const { result } = resolveFixture(fixtureContext(), fixtureValues);
    const prayer = result.pages.find(p => p.pageTemplateId === 'seed_prayer').html;
    assert.match(prayer, /Japan/);
    assert.match(prayer, /Tokyo/);
    assert.match(prayer, /Pray for missionaries/);
    assert.match(prayer, /data:image\/png/);                              // country map image
    const kids = result.pages.find(p => p.pageTemplateId === 'seed_kids').html;
    assert.match(kids, /The Good Shepherd/);
    assert.match(kids, /Who is the shepherd\?/);
    const ann = result.pages.find(p => p.pageTemplateId === 'seed_announcements').html;
    assert.match(ann, /Prayer Meeting/);
    assert.match(ann, /Wednesday 7pm/);
});

test('the resolved 16 pages impose to the same saddle-stitch table as today', () => {
    const { result } = resolveFixture(fixtureContext(), fixtureValues);
    const spreads = Engine.imposeSpreads(result.pages);
    const got = spreads.map(s => [s.leftIdx, s.rightIdx]);
    assert.deepStrictEqual(got, [
        [15, 0], [1, 14], [13, 2], [3, 12], [11, 4], [5, 10], [9, 6], [7, 8],
    ]);
});

test('seeded Page Templates cache the Entry Fields their HTML declares', () => {
    const seed = Seed.buildSeed(catalog);
    const prayer = seed.pageTemplates.find(p => p.id === 'seed_prayer');
    const keys = prayer.entryFields.map(f => f.key);
    assert.ok(keys.includes('pp_nation'));
    assert.ok(keys.includes('pp_prompts'));
    // the Order of Service page is all Bound Components — no Entry Fields
    const oos = seed.pageTemplates.find(p => p.id === 'seed_oos');
    assert.strictEqual(oos.entryFields.length, 0);
});
