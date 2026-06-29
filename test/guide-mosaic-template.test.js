const { test } = require('node:test');
const assert = require('node:assert');

const Engine = require('../public/guide-engine.js');
const Components = require('../public/guide-components.js');
const Seed = require('../public/guide-seed.js');
const Store = require('../public/guide-store.js');

// The designed booklet (Claude Design import) is the new church default, seeded
// ALONGSIDE the kept legacy booklet. It rebuilds the same liturgy on the Mosaic
// Print pages, with the Order of Service composed from granular value Components.

const catalog = Components.defaultCatalog;

function ctx() {
    return {
        date: '2025-07-27', longDate: 'Sunday, July 27, 2025', shortDate: '07/27/25',
        theme: 'The Heavenly Prince', keyVerse: 'Daniel 8:25',
        keyVerseText: 'And he shall even rise up against the Prince of princes.',
        preacher: 'J.P. Shafer', musicLeader: 'Sam Crites', serviceLeader: 'Sam Crites',
        hasBaptism: false, removedHymns: [], baptismNames: '',
        liturgy: {
            prayerLabel: 'Pastoral Prayer',
            callToWorship: 'Isaiah 9:2–6', callToConfession: 'Ephesians 2:1–3',
            assuranceOfPardon: 'Revelation 1:4–8', scriptureReading: 'Hebrews 4:14–16',
            sermon: 'Daniel 8', benediction: 'Jude 24–25',
            preparatoryHymn: { name: 'Behold Our God' }, hymn1: { name: 'All Hail the Power' },
            hymn2: { name: 'Come, Thou Long Expected Jesus' }, hymnMid1: { name: 'Lord Have Mercy' },
            hymnMid2: { name: 'How Sweet and Aweful' }, hymnEnd1: { name: 'Christ Our Wisdom' },
            hymnEnd2: { name: 'All Glory Be to Christ' },
        },
        hymnsByField: {
            preparatoryHymn: { name: 'Behold Our God', pages: ['p.png'] },
            hymn1: { name: 'All Hail the Power', pages: ['h1.png'], attribution: 'CCLI #1' },
            hymn2: { name: 'Come, Thou Long Expected Jesus', pages: ['h2.png'] },
            hymnMid1: { name: 'Lord Have Mercy', pages: ['m1.png'] },
            hymnMid2: { name: 'How Sweet and Aweful', pages: ['m2.png'] },
            hymnEnd1: { name: 'Christ Our Wisdom', pages: ['e1.png'] },
            hymnEnd2: { name: 'All Glory Be to Christ', pages: ['e2.png'] },
        },
        schedule: [
            { id: '2025-07-27', preacher: 'Sam Crites', sermon: 'Daniel 9:1–23' },
            { id: '2025-08-03', preacher: 'Sam Crites', sermon: 'Daniel 9:24–27' },
        ],
    };
}
const values = {
    pp_nation: 'Japan', pp_continent: 'Asia', pp_capital: 'Tokyo', pp_prompts: 'Pray for Japan.',
    kids_lesson_title: 'David Showed Mercy', kids_lesson_verse: '1 Samuel 24',
    kids_summary: 'King Saul searched for David.', kids_questions: ['Why?', 'How?'],
    announcements: [{ title: 'Members Meeting', content: 'Next week.' }],
};

function resolveMosaic(serviceCtx, vals) {
    const seed = Seed.buildSeed(catalog);
    const mosaic = seed.guideTemplates.find(t => t.id === 'seed_mosaic');
    const snapshot = Store.buildSnapshot(mosaic, Store.indexById(seed.pageTemplates), Store.indexById(seed.stylePresets));
    return { snapshot, result: Engine.resolveGuide(snapshot, vals || {}, serviceCtx, catalog) };
}

test('the Mosaic booklet is the seeded default; legacy is kept but not default', () => {
    const seed = Seed.buildSeed(catalog);
    const def = seed.guideTemplates.filter(t => t.isDefault);
    assert.strictEqual(def.length, 1);
    assert.strictEqual(def[0].id, 'seed_mosaic');
    assert.ok(seed.guideTemplates.find(t => t.id === 'seed_default'), 'legacy template still seeded');
});

test('the Mosaic booklet resolves to a 16-page saddle-stitch booklet', () => {
    const { result } = resolveMosaic(ctx(), values);
    assert.strictEqual(result.total, 16);
    assert.strictEqual(result.overflow, false);
    assert.strictEqual(result.total % 4, 0);
});

test('page order matches the design gallery: cover, explainer, oos, hymns, prayer, notes, hymns, kids, back cover', () => {
    const { result } = resolveMosaic(ctx(), values);
    const ids = result.pages.map(p => p.pageTemplateId);
    assert.strictEqual(ids[0], 'seed_m_cover');
    assert.strictEqual(ids[1], 'seed_m_explainer');
    assert.strictEqual(ids[2], 'seed_m_oos');
    assert.strictEqual(ids[3], 'seed_m_hymn');
    assert.strictEqual(ids[ids.length - 1], 'seed_m_backcover');
    assert.ok(ids.includes('seed_m_notes'), 'filler notes present');
});

test('the cover carries the bound key verse + reference', () => {
    const { result } = resolveMosaic(ctx(), values);
    const cover = result.pages[0].html;
    assert.match(cover, /Prince of princes/);
    assert.match(cover, /Daniel 8:25/);
    assert.match(cover, /assets\/mosaic-icon\.png/);   // icon-only seal (design update)
    assert.match(cover, /MOSAIC CHURCH/);              // PT Serif wordmark as text
    assert.match(cover, /class="m-hex"/);              // hexagon divider, not ✦
});

test('the Order of Service page renders granular liturgy values, not <oos-list>', () => {
    const { result } = resolveMosaic(ctx(), values);
    const oos = result.pages[2].html;
    assert.doesNotMatch(oos, /<oos-list>/);            // composed from granular tags
    assert.match(oos, /Behold Our God/);               // prep hymn name
    assert.match(oos, /Isaiah 9:2–6/);                 // call-to-worship ref
    assert.match(oos, /Daniel 8/);                     // sermon ref
    assert.match(oos, /J\.P\. Shafer/);                // preacher
    assert.match(oos, /The Heavenly Prince/);          // theme
    // static left-column labels are plain page HTML
    assert.match(oos, /Moment of Silent Preparation/);
});

test('hymn pages bind their slot via params.field and show name + image', () => {
    const { result } = resolveMosaic(ctx(), values);
    const prep = result.pages.find(p => p.pageTemplateId === 'seed_m_hymn');
    assert.match(prep.html, /Behold Our God/);
    assert.match(prep.html, /p\.png/);
    assert.match(prep.html, /m-hymn-title/);          // single-image hymn keeps its big title
});

test('hymn pagination: a multi-image hymn emits one page per image, big title on the first only', () => {
    const c = ctx();
    c.hymnsByField.hymn1 = { name: 'All Hail the Power', pages: ['h1a.png', 'h1b.png'], attribution: 'CCLI #1' };
    c.hymnsByField.hymnMid1 = { name: 'Lord Have Mercy', pages: ['m1a.png', 'm1b.png'] };
    const { result } = resolveMosaic(c, values);
    const hymnPages = result.pages.filter(p => p.pageTemplateId === 'seed_m_hymn');
    const imagePages = hymnPages.filter(p => /m-hymn-img/.test(p.html));
    const titlePages = hymnPages.filter(p => /m-hymn-title/.test(p.html));
    assert.strictEqual(imagePages.length, 9);   // 5 single-image + 2×2-image = 9 pages
    assert.strictEqual(titlePages.length, 7);   // one big title per hymn slot (first page only)
    // the 2-image hymn's continuation carries the image but NOT the big title
    const cont = hymnPages.find(p => /h1b\.png/.test(p.html));
    assert.ok(cont, 'continuation page exists');
    assert.doesNotMatch(cont.html, /m-hymn-title/);
});

test('too many hymn pages auto-grow the booklet to the next multiple of 4', () => {
    const c = ctx();
    c.hymnsByField.hymn1 = { name: 'All Hail the Power', pages: ['h1a.png', 'h1b.png'] };
    c.hymnsByField.hymnMid1 = { name: 'Lord Have Mercy', pages: ['m1a.png', 'm1b.png'] };
    const { result } = resolveMosaic(c, values);
    assert.strictEqual(result.total, 20);       // 16 → 20, no overflow
    assert.strictEqual(result.overflow, false);
    assert.strictEqual(result.total % 4, 0);
});

test('the back cover carries announcements + the designed preaching schedule', () => {
    const { result } = resolveMosaic(ctx(), values);
    const back = result.pages[result.pages.length - 1].html;
    assert.match(back, /Members Meeting/);
    assert.match(back, /Jul 27/);
    assert.match(back, /Daniel 9:1–23/);
});

test('every Mosaic page resolves with no leftover unknown component tags', () => {
    const { result } = resolveMosaic(ctx(), values);
    for (const p of result.pages) {
        // any hyphenated custom tag left over means a Component failed to resolve
        const leftover = (p.html.match(/<([a-z][a-z0-9]*-[a-z0-9-]*)[\s>]/gi) || [])
            .filter(t => !/^<(div-|m-)/.test(t));   // (no such tags exist; guard only)
        const known = leftover.filter(t => catalog.get(t.replace(/[<\s>]/g, '')));
        assert.strictEqual(known.length, 0, `unresolved component(s): ${known.join(', ')} on ${p.pageTemplateId}`);
    }
});

test('the Mosaic booklet numbers from page 3 (cover + explainer are front matter)', () => {
    const { snapshot, result } = resolveMosaic(ctx(), values);
    assert.strictEqual(snapshot.numberStartPage, 3);
    assert.strictEqual(result.numberStartPage, 3);
    // cover (0), explainer (1) unnumbered; OOS (2) is the first numbered page "1"
    assert.strictEqual(Engine.pageNumber(1, result.total, result.numberStartPage), null);
    assert.deepStrictEqual(Engine.pageNumber(2, result.total, result.numberStartPage), { number: 1, side: 'right' });
});

test('notes split: one non-filler "Main Idea" page, blank continuation pages are the filler', () => {
    const { result } = resolveMosaic(ctx(), values);
    const firsts = result.pages.filter(p => p.pageTemplateId === 'seed_m_notes');
    const blanks = result.pages.filter(p => p.pageTemplateId === 'seed_m_notes_blank');
    // Exactly one first/main notes page, and it carries the heading + sermon ref.
    assert.strictEqual(firsts.length, 1);
    assert.strictEqual(firsts[0].role, 'normal');
    assert.match(firsts[0].html, /Main Idea of the Sermon/);
    assert.match(firsts[0].html, /Daniel 8/);
    // At least one blank continuation page (the filler), and NONE carry the heading.
    assert.ok(blanks.length >= 1);
    assert.ok(blanks.every(p => p.role === 'filler'));
    assert.ok(blanks.every(p => !/Main Idea of the Sermon/.test(p.html)));
    // Booklet still a clean multiple of four.
    assert.strictEqual(result.total % 4, 0);
});

test('at least one notes page is guaranteed even if the filler count were zero', () => {
    // The "Main Idea" page is a normal (non-filler) placement, so it is always
    // present regardless of how the filler math resolves.
    const seed = Seed.buildSeed(catalog);
    const mosaic = seed.guideTemplates.find(t => t.id === 'seed_mosaic');
    assert.ok(mosaic.pages.some(p => p.pageTemplateId === 'seed_m_notes' && p.role === 'normal'));
    assert.ok(mosaic.pages.some(p => p.pageTemplateId === 'seed_m_notes_blank' && p.role === 'filler'));
});

test('the Mosaic pages use the Mosaic Print style preset', () => {
    const { snapshot } = resolveMosaic(ctx(), values);
    assert.ok(snapshot.pages.every(p => /--navy:/.test(p.resolvedStylePresetCss)));
});
