const { test } = require('node:test');
const assert = require('node:assert');

const Engine = require('../public/guide-engine.js');
const Components = require('../public/guide-components.js');

const catalog = Components.defaultCatalog;

// ── tag scanning & attribute parsing ──────────────────────────────────────────

test('parseAttrs reads quoted, single-quoted, and bare-boolean attributes', () => {
    assert.deepStrictEqual(Engine.parseAttrs('key="hymn1" label=\'A B\' required'),
        { key: 'hymn1', label: 'A B', required: true });
    assert.deepStrictEqual(Engine.parseAttrs(''), {});
    assert.deepStrictEqual(Engine.parseAttrs('render-as="bullets"'), { 'render-as': 'bullets' });
});

test('forEachTag finds only hyphenated custom tags, in document order', () => {
    const seen = [];
    Engine.forEachTag('<div><service-date format="long"></service-date><b>x</b><key-verse-ref/></div>',
        (name) => seen.push(name));
    assert.deepStrictEqual(seen, ['service-date', 'key-verse-ref']);
});

// ── Entry Field derivation ────────────────────────────────────────────────────

test('forEachTag treats Components as leaf placeholders (no double-visit of nested tags)', () => {
    const seen = [];
    Engine.forEachTag('<oos-list><input-text key="k"></input-text></oos-list><service-theme></service-theme>',
        (name) => seen.push(name));
    // The inner input-text is inside oos-list's body and must NOT be visited again.
    assert.deepStrictEqual(seen, ['oos-list', 'service-theme']);
});

test('a Component nested in another tag body is discarded cleanly (no duplicate, no leaked close tag)', () => {
    const page = { html: '<oos-list><input-text key="k"></input-text></oos-list>' };
    const out = Engine.expandPage(page, { k: 'FILL' }, { liturgy: {} }, catalog);
    assert.match(out[0].html, /Order of Service/);                 // oos-list rendered
    assert.ok(!/<\/oos-list>/.test(out[0].html), 'no leaked literal close tag');
    assert.ok(!/FILL/.test(out[0].html), 'nested input not separately rendered');
});

test('deriveEntryFields does not false-duplicate an Input nested in another tag', () => {
    const res = Engine.deriveEntryFields('<input-text key="k"><input-text key="k"></input-text></input-text>', catalog);
    assert.deepStrictEqual(res.fields.map(f => f.key), ['k']);
    assert.deepStrictEqual(res.duplicates, []);                  // inner tag skipped, not counted
});

test('deriveEntryFields collects Input Component fields and ignores Bound ones', () => {
    const html = '<oos-list></oos-list><input-text key="a" label="A"></input-text><input-list key="b" render-as="bullets"></input-list>';
    const { fields } = Engine.deriveEntryFields(html, catalog);
    assert.deepStrictEqual(fields.map(f => f.key), ['a', 'b']);
    assert.strictEqual(fields[0].type, 'text');
    assert.strictEqual(fields[1].type, 'list');
});

test('deriveEntryFields flags duplicate keys and unknown tags', () => {
    const html = '<input-text key="a"></input-text><input-text key="a"></input-text><made-up-tag></made-up-tag>';
    const res = Engine.deriveEntryFields(html, catalog);
    assert.deepStrictEqual(res.fields.map(f => f.key), ['a']); // first wins, second is the dup
    assert.deepStrictEqual(res.duplicates, ['a']);
    assert.deepStrictEqual(res.unknownTags, ['made-up-tag']);
});

test('validatePageHtml is ok for a clean page and not ok with problems', () => {
    assert.strictEqual(Engine.validatePageHtml('<input-text key="a"></input-text>', catalog).ok, true);
    const bad = Engine.validatePageHtml('<typo-tag></typo-tag><input-text key="x"></input-text><input-text key="x"></input-text>', catalog);
    assert.strictEqual(bad.ok, false);
    assert.strictEqual(bad.problems.length, 2);
});

// ── inline expansion ──────────────────────────────────────────────────────────

test('expandPage (single) replaces Input + Bound tags inline with one page', () => {
    const page = { pageTemplateId: 'p', role: 'normal', emitsPages: 'single',
        html: 'Theme: <service-theme></service-theme> / <input-text key="x"></input-text>' };
    const ctx = { theme: 'Grace' };
    const out = Engine.expandPage(page, { x: 'filled' }, ctx, catalog);
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0].html, 'Theme: Grace / filled');
    assert.strictEqual(out[0].pageTemplateId, 'p');
});

test('input-text value is HTML-escaped; input-richtext is not', () => {
    const page = { html: '<input-text key="t"></input-text>|<input-richtext key="r"></input-richtext>' };
    const out = Engine.expandPage(page, { t: '<b>x</b>', r: '<b>y</b>' }, {}, catalog);
    assert.strictEqual(out[0].html, '&lt;b&gt;x&lt;/b&gt;|<b>y</b>');
});

// ── multi-page expansion (hymn sheet) ─────────────────────────────────────────

function hymnPage(field, extra) {
    return { pageTemplateId: 'seed_hymn', role: 'normal', emitsPages: 'component',
        html: '<hymn-sheet></hymn-sheet>', params: Object.assign({ field }, extra) };
}

test('a hymn slot with N sheet images emits N physical pages', () => {
    const ctx = { liturgy: { hymn1: { id: 'h', name: 'Amazing Grace' } },
        hymnsByField: { hymn1: { name: 'Amazing Grace', pages: ['a.png', 'b.png', 'c.png'], attribution: 'Public Domain' } } };
    const out = Engine.expandPage(hymnPage('hymn1'), {}, ctx, catalog);
    assert.strictEqual(out.length, 3);
    assert.match(out[0].html, /Amazing Grace/);
    assert.match(out[0].html, /a\.png/);
    assert.match(out[0].html, /\(next page\)/);          // not the last page
    assert.match(out[2].html, /Public Domain/);          // attribution on the last page
});

test('a literal hymn (no images) emits one placeholder page', () => {
    const ctx = { liturgy: { hymn1: { id: null, name: 'Old Hymn' } }, hymnsByField: {} };
    const out = Engine.expandPage(hymnPage('hymn1'), {}, ctx, catalog);
    assert.strictEqual(out.length, 1);
    assert.match(out[0].html, /No music sheet found/);
});

test('a removed hymn slot, and hymn2 under baptism, emit zero pages', () => {
    const base = { liturgy: { hymn1: { name: 'H1' }, hymn2: { name: 'H2' } },
        hymnsByField: { hymn1: { name: 'H1', pages: ['x.png'] }, hymn2: { name: 'H2', pages: ['y.png'] } } };

    const removedCtx = Object.assign({ removedHymns: ['hymn1'] }, base);
    assert.strictEqual(Engine.expandPage(hymnPage('hymn1'), {}, removedCtx, catalog).length, 0);

    const baptismCtx = Object.assign({ hasBaptism: true, removedHymns: [] }, base);
    assert.strictEqual(Engine.expandPage(hymnPage('hymn2', { 'omit-on-baptism': true }), {}, baptismCtx, catalog).length, 0);
    // …but hymn2 still emits when there is no baptism.
    const noBaptism = Object.assign({ hasBaptism: false, removedHymns: [] }, base);
    assert.strictEqual(Engine.expandPage(hymnPage('hymn2', { 'omit-on-baptism': true }), {}, noBaptism, catalog).length, 1);
});

// ── filler ────────────────────────────────────────────────────────────────────

function snap(pages, target) { return { targetPageCount: target || 16, pages }; }
const plain = (id, role) => ({ pageTemplateId: id, role: role || 'normal', emitsPages: 'single', html: id });

test('filler expands to hit the target page count exactly', () => {
    // 5 real pages + a filler, target 16 -> 11 filler pages, 16 total.
    const s = snap([plain('a'), plain('b'), plain('c'), plain('notes', 'filler'), plain('d'), plain('e')], 16);
    const r = Engine.resolveGuide(s, {}, {}, catalog);
    assert.strictEqual(r.realCount, 5);
    assert.strictEqual(r.fillerCount, 11);
    assert.strictEqual(r.total, 16);
    assert.strictEqual(r.overflow, false);
});

test('every physical page is tagged with the snapshot page it came from', () => {
    const s = snap([plain('a'), plain('notes', 'filler'), plain('z')], 6);
    const r = Engine.resolveGuide(s, {}, {}, catalog);
    assert.strictEqual(r.pages[0].snapshotIndex, 0);          // 'a'
    assert.strictEqual(r.pages[1].snapshotIndex, 1);          // filler clone -> the filler page
    assert.strictEqual(r.pages[r.pages.length - 1].snapshotIndex, 2); // 'z'
});

test('filler is inserted at its template position in reading order', () => {
    const s = snap([plain('a'), plain('notes', 'filler'), plain('z')], 6);
    const r = Engine.resolveGuide(s, {}, {}, catalog);
    // a, [fillers...], z
    assert.strictEqual(r.pages[0].pageTemplateId, 'a');
    assert.strictEqual(r.pages[r.pages.length - 1].pageTemplateId, 'z');
    assert.strictEqual(r.pages[1].role, 'filler');
    assert.strictEqual(r.total, 6);
});

test('filler keeps at least one page and flags overflow past the target', () => {
    const many = [];
    for (let i = 0; i < 16; i++) many.push(plain('p' + i));
    many.push(plain('notes', 'filler'));
    const r = Engine.resolveGuide(snap(many, 16), {}, {}, catalog);
    assert.strictEqual(r.realCount, 16);
    assert.strictEqual(r.fillerCount, 1);      // minimum one filler, never zero
    assert.strictEqual(r.total, 17);
    assert.strictEqual(r.overflow, true);
});

// ── imposition ────────────────────────────────────────────────────────────────

test('imposeSpreads reproduces the old hand-written 16-page table', () => {
    const pages = Array.from({ length: 16 }, (_, i) => i);
    const spreads = Engine.imposeSpreads(pages);
    const got = spreads.map(s => [s.leftIdx, s.rightIdx]);
    assert.deepStrictEqual(got, [
        [15, 0], [1, 14], [13, 2], [3, 12], [11, 4], [5, 10], [9, 6], [7, 8],
    ]);
});

test('imposeSpreads pads non-multiples of 4 with blank leaves', () => {
    const spreads = Engine.imposeSpreads([0, 1, 2, 3, 4]); // 5 -> padded to 8
    assert.strictEqual(spreads.length, 4);
    // the two indices of every spread sum to n-1 (=7 here)
    for (const s of spreads) assert.strictEqual(s.leftIdx + s.rightIdx, 7);
    // padded leaves are null
    assert.strictEqual(spreads[0].left, null);
});

test('every multiple-of-4 count imposes into n/2 spreads summing to n-1', () => {
    for (const n of [4, 8, 12, 16, 20, 24]) {
        const spreads = Engine.imposeSpreads(Array.from({ length: n }, (_, i) => i));
        assert.strictEqual(spreads.length, n / 2);
        for (const s of spreads) assert.strictEqual(s.leftIdx + s.rightIdx, n - 1);
    }
});

test('pageNumber: outer pages unnumbered, interior numbered by reading position', () => {
    assert.strictEqual(Engine.pageNumber(0, 16), null);
    assert.strictEqual(Engine.pageNumber(15, 16), null);
    assert.deepStrictEqual(Engine.pageNumber(1, 16), { number: 1, side: 'left' });
    assert.deepStrictEqual(Engine.pageNumber(2, 16), { number: 2, side: 'right' });
    assert.deepStrictEqual(Engine.pageNumber(14, 16), { number: 14, side: 'right' });
});
