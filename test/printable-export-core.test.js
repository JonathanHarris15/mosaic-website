const { test } = require('node:test');
const assert = require('node:assert');

const Export = require('../public/printable-export-core.js');
const Data = require('../public/printable-data-core.js');
const Render = require('../public/printable-render-core.js');
const Core = require('../public/printable-core.js');

test('blank pad count makes the length a multiple of 4, and 0 stays 0', () => {
    assert.equal(Export.blankPadCount(0), 0);
    assert.equal(Export.paddedPageCount(0), 0);
    assert.equal(Export.blankPadCount(1), 3);
    assert.equal(Export.paddedPageCount(1), 4);
    assert.equal(Export.blankPadCount(2), 2);
    assert.equal(Export.paddedPageCount(3), 4);
    assert.equal(Export.blankPadCount(4), 0);
    assert.equal(Export.paddedPageCount(4), 4);
    assert.equal(Export.paddedPageCount(5), 8);
    assert.equal(Export.paddedPageCount(7), 8);
    assert.equal(Export.paddedPageCount(8), 8);
});

test('padEntries appends blanks and never reorders content (no imposition)', () => {
    const entries = [
        { key: 'cover', page: { id: 'cover', nodes: [{ id: 't', tag: 'p', text: 'Cover' }] }, nodes: [{ id: 't', tag: 'p', text: 'Cover' }] },
        { key: 'oos', page: { id: 'oos', nodes: [] }, nodes: [{ id: 'o', tag: 'p', text: 'OOS' }] },
        { key: 'hymn', page: { id: 'hymn', nodes: [] }, nodes: [{ id: 'h', tag: 'img', attrs: { src: 'ag1.png' } }] },
    ];
    const keys = entries.map(e => e.key);
    const padded = Export.padEntries(entries);
    assert.equal(padded.length % 4, 0);
    assert.equal(padded.length, 4);
    assert.deepEqual(padded.slice(0, 3).map(e => e.key), keys, 'content order is the layout order');
    assert.equal(padded[3].blank, true);
    assert.deepEqual(padded[3].nodes, []);
    assert.ok(!Export.imposeSpreads, 'software imposition is not in this module');
    assert.ok(!Export.saddleStitch);
});

test('odd-length sample Sunday content pads to ×4 after bind', () => {
    const TODAY = '2026-09-03';
    const bundle = {
        services: {
            '2026-09-06': {
                theme: 'Grace',
                liturgy: { preparatoryHymn: { id: 'h1', name: 'Amazing Grace' } },
                typedContent: {
                    pastoralPrayer: { nation: 'Kenya' },
                    mosaicKids: { lessonTitle: 'The Lost Sheep' },
                    announcements: [{ title: 'Picnic', content: 'Park' }],
                },
            },
        },
        hymns: {
            h1: { hymn_name: 'Amazing Grace', versions: [{ pages: ['ag1.png', 'ag2.png'] }] },
        },
    };
    const hymns = Data.resolve('sunday_hymns', {}, bundle, { today: TODAY });
    const typed = Data.resolve('sunday_typed', {}, bundle, { today: TODAY });
    assert.equal(hymns.rows.length, 2, 'both sheet pages bind');
    assert.equal(typed.rows[0].prayerNation, 'Kenya');

    const t = Core.buildTemplate({ paper: 'letter', dpi: 96 });
    const page = Core.buildPage(t, { id: 'booklet', nodes: [
        { id: 'nation', tag: 'p', text: 'Country', bind: { text: { scope: 'global', source: 'sunday_typed', field: 'prayerNation' } } },
        { id: 'sheet', tag: 'div', repeat: { source: 'sunday_hymns', params: {}, overflow: 'new-page', layout: { maxPerPage: 1 } }, children: [
            { id: 'img', tag: 'img', attrs: { src: '' }, bind: { src: { scope: 'item', field: 'image' } } },
        ] },
    ] });
    const expanded = Render.expandPage(page, {
        rowsFor: (node) => node.repeat ? hymns.rows : null,
        valueFor: (bind, row) => {
            if (bind.scope === 'item') return row[bind.field] ? { ok: true, value: row[bind.field] } : { ok: false, why: 'blank' };
            const v = typed.rows[0][bind.field];
            return v ? { ok: true, value: v } : { ok: false, why: 'empty' };
        },
    });
    assert.equal(expanded.nodes[0].text, 'Kenya');
    assert.deepEqual(expanded.nodes[1].children.map(c => c.children[0].attrs.src), ['ag1.png', 'ag2.png']);

    // One laid-out page (no measure host) plus the two hymn images on it →
    // treat as 3 leaves the way a 3-page booklet would, then pad.
    const entries = [
        { key: 'cover', page: page, nodes: [{ id: 'c', tag: 'p', text: 'Cover' }] },
        { key: 'h1', page: page, nodes: [{ id: 'i1', tag: 'img', attrs: { src: 'ag1.png' } }] },
        { key: 'h2', page: page, nodes: [{ id: 'i2', tag: 'img', attrs: { src: 'ag2.png' } }] },
    ];
    const padded = Export.padEntries(entries);
    assert.equal(padded.length % 4, 0);
    assert.equal(padded.length, 4);
    assert.deepEqual(padded.slice(0, 3).map(e => e.key), ['cover', 'h1', 'h2']);
});
