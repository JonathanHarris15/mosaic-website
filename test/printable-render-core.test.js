const { test } = require('node:test');
const assert = require('node:assert');

// MS-396 / MS-397 — a page with its data poured in.
//
// The expansion is what the canvas, the view page and the print layer all
// draw from, so what is pinned is the shape it hands back: one copy per row
// with the first keeping the element's own id, bindings applied where a value
// exists and left as stand-ins where one does not, and a warning for every
// gap. The fit arithmetic is pinned separately because a wrong binary search
// is the kind of bug that only shows on page four of a long directory.

const Render = require('../public/printable-render-core.js');
const Core = require('../public/printable-core.js');

function directoryPage() {
    const t = Core.buildTemplate({ paper: 'letter', dpi: 96 });
    return Core.buildPage(t, { id: 'pg1', nodes: [
        { id: 'ttl', tag: 'h1', text: 'Directory', bind: { text: { scope: 'global', source: 'sunday', params: {}, field: 'theme' } } },
        { id: 'card', tag: 'div', name: 'Card', repeat: { source: 'people', params: {}, layout: { direction: 'row', perLine: 3, gap: 10 }, overflow: 'new-page' }, children: [
            { id: 'photo', tag: 'img', attrs: { src: '' }, bind: { src: { scope: 'item', field: 'photo' } } },
            { id: 'nm', tag: 'p', text: 'Jane Example', bind: { text: { scope: 'item', field: 'name' } } },
            { id: 'ph', tag: 'p', text: '555 0100', bind: { text: { scope: 'item', field: 'phone' } } },
        ] },
        { id: 'foot', tag: 'p', text: 'Back page' },
    ] });
}

const ROWS = [
    { name: 'Anna Baker', photo: 'a.jpg', phone: '1' },
    { name: 'Ben Carter', photo: '', phone: '' },
    { name: 'Cara Abbott', photo: 'c.jpg', phone: '3' },
];

function data(rows, globals) {
    return {
        rowsFor: (node) => node.repeat ? rows : null,
        valueFor: (bind, row) => {
            if (bind.scope === 'item') {
                if (!row) return { ok: false, why: 'Not inside a list.' };
                const v = row[bind.field];
                return v ? { ok: true, value: v } : { ok: false, why: 'No ' + bind.field + ' for ' + row.name + '.' };
            }
            const g = (globals || {})[bind.source + '.' + bind.field];
            return g ? { ok: true, value: g } : { ok: false, why: 'Nothing planned.' };
        },
    };
}

test('an iterated element is drawn once per row, the first copy keeping its own id', () => {
    const r = Render.expandPage(directoryPage(), data(ROWS, { 'sunday.theme': 'Grace' }));
    const list = r.nodes[1];
    assert.equal(list.attrs['data-list-of'], 'card');
    assert.equal(list.children.length, 3);
    assert.equal(list.children[0].id, 'card');
    assert.equal(list.children[1].id, 'card~1');
    assert.equal(list.children[1].children[1].id, 'nm~1');
    assert.equal(list.children[0].repeat, undefined, 'a copy does not carry the repeat');
    assert.equal(Render.originalId('nm~2'), 'nm');
    assert.equal(Render.originalId('card'), 'card');
});

test('bound values land in text and src; a missing value keeps the stand-in and warns once', () => {
    const r = Render.expandPage(directoryPage(), data(ROWS, { 'sunday.theme': 'Grace' }));
    assert.equal(r.nodes[0].text, 'Grace');
    const copies = r.nodes[1].children;
    assert.equal(copies[0].children[1].text, 'Anna Baker');
    assert.equal(copies[0].children[0].attrs.src, 'a.jpg');
    assert.equal(copies[1].children[0].attrs.src, '', 'Ben has no photo: the box stays, the src stays empty');
    assert.equal(copies[1].children[2].text, '555 0100', 'no phone: the stand-in shows');
    const messages = r.warnings.map(w => w.message);
    assert.ok(messages.includes('No photo for Ben Carter.'));
    assert.ok(messages.includes('No phone for Ben Carter.'));
    assert.equal(r.warnings.filter(w => w.nodeId === 'ph').length, 1);
});

test('a global binding that cannot resolve keeps its stand-in and warns', () => {
    const r = Render.expandPage(directoryPage(), data(ROWS, {}));
    assert.equal(r.nodes[0].text, 'Directory');
    assert.ok(r.warnings.some(w => w.nodeId === 'ttl' && w.message === 'Nothing planned.'));
});

test('with no data loaded the stand-in is drawn once, still inside its list', () => {
    const r = Render.expandPage(directoryPage(), { rowsFor: () => null, valueFor: () => ({ ok: false, why: 'No data loaded.' }) });
    const list = r.nodes[1];
    assert.equal(list.children.length, 1);
    assert.equal(list.children[0].id, 'card');
    assert.equal(list.children[0].children[1].text, 'Jane Example');
});

test('an empty list draws nothing and says so', () => {
    const r = Render.expandPage(directoryPage(), data([], {}));
    assert.equal(r.nodes[1].children.length, 0);
    assert.ok(r.warnings.some(w => w.nodeId === 'card' && /empty/.test(w.message)));
});

test('the list wrapper is laid out across, down, or in columns filled top to bottom', () => {
    assert.equal(Render.layoutStyle({ layout: { direction: 'row', perLine: 3, gap: 8 } }, 10)['grid-template-columns'], 'repeat(3, minmax(0, 1fr))');
    assert.equal(Render.layoutStyle({ layout: { direction: 'column', perLine: 1, gap: 8 } }, 10)['flex-direction'], 'column');
    const cols = Render.layoutStyle({ layout: { direction: 'column', perLine: 2, gap: 8 } }, 7);
    assert.equal(cols['grid-auto-flow'], 'column');
    assert.equal(cols['grid-template-rows'], 'repeat(4, auto)');
});

test('the overflowing lists on a page are found in tree order', () => {
    assert.deepEqual(Render.overflowingRepeats(directoryPage()).map(n => n.id), ['card']);
});

// ── Fitting ──────────────────────────────────────────────────────────────────

test('the largest number of rows that fit is found by bisection', () => {
    // Rows 1..7 fit, 8 does not.
    const fits = n => n <= 7;
    assert.equal(Render.largestFitting(20, fits), 7);
    assert.equal(Render.largestFitting(5, fits), 5, 'everything fits');
    assert.equal(Render.largestFitting(20, () => false), 1, 'a row taller than the page still goes somewhere');
    assert.equal(Render.largestFitting(0, fits), 0);
    assert.equal(Render.largestFitting(20, fits, 4), 4, 'a cap holds');
});

test('pages are planned slice by slice until the rows run out', () => {
    const rows = Array.from({ length: 10 }, (_, i) => i);
    const plan = Render.planPages(rows, 0, (pageIndex, start, n) => n <= (pageIndex === 0 ? 4 : 3));
    assert.deepEqual(plan.map(p => [p.start, p.end]), [[0, 4], [4, 7], [7, 10]]);
});
