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
    assert.ok(!Export.imposeSpreads, 'flat export does not impose; folio is folioSpreads');
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

    const booklet = Export.exportEntries(entries, {
        pages: [{ nodes: [
            { bind: { text: { scope: 'global', source: 'sunday_typed', field: 'prayerNation' } } },
        ] }],
    });
    assert.equal(booklet.length % 4, 0);
    assert.equal(booklet.length, 4);
});

test('a non-booklet Printable does not pad and is not a Sunday booklet path', () => {
    const directory = {
        name: 'Directory',
        pages: [{ nodes: [
            { tag: 'p', text: 'Name', bind: { text: { scope: 'item', field: 'name' } },
                repeat: { source: 'people', params: {} } },
        ] }],
    };
    assert.equal(Export.isSundayBookletPath(directory), false);
    assert.equal(Export.wantsBookletPad(directory), false);
    const entries = [
        { key: 'p1', page: { id: 'p1', nodes: [] }, nodes: [{ id: 'n', tag: 'p', text: 'Ada' }] },
    ];
    const printed = Export.exportEntries(entries, directory);
    assert.equal(printed.length, 1, 'a 1-page directory is not forced to four leaves');
    assert.equal(Export.exportPageCount(entries.length, directory), 1);
    assert.equal(Export.exportPadCount(entries.length, directory), 0);
    assert.deepEqual(printed.map(e => e.key), ['p1']);
});

test('Sunday booklet binds and bookletExport flag both take the pad path', () => {
    const hymns = {
        pages: [{ nodes: [
            { repeat: { source: 'sunday_hymns', params: {} }, children: [
                { bind: { src: { scope: 'item', field: 'image' } } },
            ] },
        ] }],
    };
    const typed = {
        pages: [{ nodes: [
            { bind: { text: { scope: 'global', source: 'sunday_typed', field: 'prayerNation' } } },
        ] }],
    };
    const flagged = { bookletExport: true, pages: [{ nodes: [{ tag: 'p', text: 'Cover' }] }] };
    const liturgyOnly = {
        pages: [{ nodes: [
            { bind: { text: { scope: 'global', source: 'sunday', field: 'theme' } } },
        ] }],
    };
    assert.equal(Export.isSundayBookletPath(hymns), true);
    assert.equal(Export.isSundayBookletPath(typed), true);
    assert.equal(Export.isSundayBookletPath(flagged), true);
    assert.equal(Export.isSundayBookletPath(liturgyOnly), false, 'liturgy-only is not the Sunday booklet path');

    const three = [
        { key: 'a', page: { id: 'a' }, nodes: [] },
        { key: 'b', page: { id: 'b' }, nodes: [] },
        { key: 'c', page: { id: 'c' }, nodes: [] },
    ];
    assert.equal(Export.exportEntries(three, hymns).length % 4, 0);
    assert.equal(Export.exportEntries(three, flagged).length, 4);
    assert.equal(Export.exportEntries(three, liturgyOnly).length, 3);
    assert.equal(Export.exportPageCount(3, typed), 4);
    assert.equal(Export.exportPadCount(3, typed), 1);
});

test('view-only print chrome distinguishes folio from flat print and has no booklet banner', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const html = fs.readFileSync(path.join(__dirname, '../public/printable-view.html'), 'utf8');
    assert.doesNotMatch(html, /Printing this booklet/,
        'the booklet-mode banner is gone; the buttons carry the distinction');
    assert.doesNotMatch(html, /pv-booklet/,
        'the booklet-mode banner class must not return');
    assert.match(html, /printFolio\(\)|onFolioClick/, 'the view page offers folio print');
    assert.match(html, />menu_book</, 'folio uses the menu_book icon');
    assert.match(html, /aria-label="Print folio"/);
    assert.match(html, /aria-label="Print"/);
    assert.match(html, /folioPadOpen|openFolioPad/, 'folio pad tool is on the view page');
    assert.match(html, /pv-folio-board|folio-pad__board/, 'folio pad lays pages out visually');
    assert.match(html, /folioPadBrushLabel/, 'folio pad names the brush on the side rail');
    assert.match(html, /folioPadTargetCount/, 'side rail names how many pages the fold needs');
    const editor = fs.readFileSync(path.join(__dirname, '../public/printable-editor.html'), 'utf8');
    assert.match(editor, /printFolio\(\)/, 'the editor File menu offers folio print');
    assert.match(editor, />menu_book</, 'editor folio uses the menu_book icon');
    assert.match(editor, /folioPadOpen|openFolioPad/, 'folio pad tool is on the editor');
    assert.match(editor, /pe-folio-board|folio-pad__board/, 'editor folio pad lays pages out visually');
    const editorJs = fs.readFileSync(path.join(__dirname, '../public/printable-editor.js'), 'utf8');
    assert.match(editorJs, /mountFolioPrint/, 'editor folio print uses the shared sheet builder');
    assert.match(editorJs, /mountFolioPadBoard|insertFolioBrushAt/, 'editor folio pad uses brush + gap insert');
    const viewJs = fs.readFileSync(path.join(__dirname, '../public/printable-view.js'), 'utf8');
    assert.match(viewJs, /mountFolioPadBoard|insertFolioBrushAt/, 'view folio pad uses brush + gap insert');
    const dom = fs.readFileSync(path.join(__dirname, '../public/printable-dom.js'), 'utf8');
    assert.match(dom, /function mountFolioPadBoard/, 'shared board painter lives in printable-dom');
});

// MS-763: quieter fill-in header; Folio/Print can file a flat snapshot on the linked event.
test('fill-in header drops status chips and offers Save PDF on Folio and Print when linked', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const html = fs.readFileSync(path.join(__dirname, '../public/printable-view.html'), 'utf8');
    const viewJs = fs.readFileSync(path.join(__dirname, '../public/printable-view.js'), 'utf8');
    assert.doesNotMatch(html, /m-header__chip/, 'As-of / paper chips are gone from the fill-in header');
    assert.doesNotMatch(html, /As of '\s*\+\s*viewDate/, 'As-of chip text is gone');
    assert.doesNotMatch(html, /showWarnings/, 'gaps warning toggle is gone');
    assert.doesNotMatch(html, /m-notice--warning/, 'gaps warning notice is gone');
    assert.match(html, /Save PDF to event files/, 'Folio and Print offer filing a snapshot');
    assert.match(html, /canSaveSnapshot/, 'save option is gated on a linked occurrence');
    assert.match(html, /event-attachments-core\.js/, 'view page loads attachment helpers');
    assert.match(html, /printable-pdf\.js/, 'view page loads the PDF renderer');
    assert.match(viewJs, /get canSaveSnapshot/, 'linked occurrence gates the save option');
    assert.match(viewJs, /saveSnapshotToEvent/, 'view can file a snapshot on the linked event');
    assert.match(viewJs, /PrintablePdf\.render/, 'snapshot uses the same flat PDF path as the event Files tab');
    assert.match(viewJs, /saveAttachment/, 'snapshot is an ordinary event attachment');
});

test('folioSpreads matches the service guide imposition table', () => {
    const Engine = require('../public/guide-engine.js');
    const pages = Array.from({ length: 16 }, (_, i) => ({
        key: 'p' + i,
        page: { id: 'p' + i, nodes: [{ id: 't' + i, tag: 'p', text: String(i) }] },
        nodes: [{ id: 't' + i, tag: 'p', text: String(i) }],
    }));
    const spreads = Export.folioSpreads(pages);
    const guide = Engine.imposeSpreads(pages);
    assert.equal(spreads.length, 8);
    assert.deepEqual(spreads.map(s => [s.leftIdx, s.rightIdx]), guide.map(s => [s.leftIdx, s.rightIdx]));
    assert.deepEqual(spreads.map(s => [s.leftIdx, s.rightIdx]), [
        [15, 0], [1, 14], [13, 2], [3, 12], [11, 4], [5, 10], [9, 6], [7, 8],
    ]);
    assert.equal(spreads[0].right, pages[0], 'the cover stays the right-hand page of the outer sheet');
    assert.equal(spreads[0].left.key, 'p15');
});

test('folioSpreads pads any Printable to a multiple of 4, including a one-page directory', () => {
    const one = [{ key: 'only', page: { id: 'only', nodes: [] }, nodes: [{ id: 'n', tag: 'p', text: 'Ada' }] }];
    const spreads = Export.folioSpreads(one);
    assert.equal(spreads.length, 2, '4 leaves → 2 sheets');
    for (const s of spreads) assert.equal(s.leftIdx + s.rightIdx, 3);
    assert.equal(spreads[0].right.key, 'only');
    assert.equal(spreads[0].left.blank, true);
    assert.deepEqual(spreads[0].left.nodes, []);
    assert.equal(Export.folioSpreads([]).length, 0);

    const five = [0, 1, 2, 3, 4].map(i => ({ key: 'k' + i, page: { id: 'k' + i }, nodes: [] }));
    const padded = Export.folioSpreads(five);
    assert.equal(padded.length, 4, '5 pages pad to 8 leaves, 4 sheets');
    assert.equal(padded[0].left.blank, true);
    for (const s of padded) assert.equal(s.leftIdx + s.rightIdx, 7);
});

test('folio pad tool duplicates a page into a temporary stack until ×4 without splitting overflow runs', () => {
    const five = [0, 1, 2, 3, 4].map(i => ({
        key: 'k' + i,
        page: { id: 'k' + i, name: 'Sheet ' + (i + 1), nodes: [] },
        nodes: [{
            id: 'n' + i,
            tag: 'p',
            text: String(i + 1),
            pageNumber: { mirror: false, anchor: 'free', inset: 36, left: 40, top: 700 },
        }],
    }));
    assert.equal(Export.folioNeedsPad(five), true);
    assert.equal(Export.folioPadNeed(five), 3);
    assert.equal(Export.folioReadyToPrint(five), false);

    const working = Export.cloneEntriesForFolio(five);
    assert.equal(working.length, 5);
    working[0].nodes[0].text = 'MUTATE-ORIGINAL-GUARD';
    assert.notEqual(five[0].nodes[0].text, 'MUTATE-ORIGINAL-GUARD', 'clone is deep');

    let stack = Export.cloneEntriesForFolio(five);
    let r = Export.applyFolioPad(stack, { kind: 'duplicate', sourceIndex: 4, afterIndex: 4 });
    assert.equal(r.ok, true);
    stack = r.entries;
    assert.equal(stack.length, 6);
    assert.equal(stack[5].folioPad, true);
    assert.equal(stack[5].folioDuplicate, true);
    assert.equal(stack[5].nodes[0].text, '6', 'page numbers restamp for the print order');
    assert.equal(five.length, 5, 'source layout is unchanged');
    assert.equal(five[4].nodes[0].text, '5', 'source page number stays');

    r = Export.applyFolioPad(stack, { kind: 'duplicate', sourceIndex: 4, afterIndex: 5 });
    assert.equal(r.ok, true);
    stack = r.entries;
    r = Export.applyFolioPad(stack, { kind: 'blank', afterIndex: stack.length - 1 });
    assert.equal(r.ok, true);
    stack = r.entries;
    assert.equal(stack.length, 8);
    assert.equal(Export.folioReadyToPrint(stack), true);
    assert.equal(Export.folioNeedsPad(stack), false);
    assert.equal(stack[7].blank, true);
    assert.equal(stack[7].folioPad, true);

    const spreads = Export.folioSpreads(stack);
    assert.equal(spreads.length, 4, 'already ×4 stack needs no further blank pad');
    assert.ok(spreads.every(s => s.left && s.right), 'every sheet has two leaves');

    const overflow = [
        { key: 'a', page: { id: 'a', nodes: [] }, nodes: [] },
        { key: 'b', page: { id: 'b', continues: { from: 'a' }, nodes: [] }, nodes: [] },
        { key: 'c', page: { id: 'c', nodes: [] }, nodes: [] },
    ];
    assert.equal(Export.canInsertAfterEntry(overflow, 0), false, 'cannot split an overflow run');
    assert.equal(Export.canInsertAfterEntry(overflow, 1), true);
    const bad = Export.applyFolioPad(overflow, { kind: 'duplicate', sourceIndex: 2, afterIndex: 0 });
    assert.equal(bad.ok, false);
    const slots = Export.folioInsertAfterOptions(overflow).map(o => o.afterIndex);
    assert.deepEqual(slots, [-1, 1, 2]);

    const removed = Export.removeFolioPadAt(stack, 7);
    assert.equal(removed.ok, true);
    assert.equal(removed.entries.length, 7);
    assert.equal(Export.folioReadyToPrint(removed.entries), false);
    const dropSaved = Export.removeFolioPadAt(stack, 0);
    assert.equal(dropSaved.ok, true, 'any page can be dropped from the print-only stack');
    assert.equal(dropSaved.entries.length, 7);
    assert.equal(stack.length, 8, 'source stack is unchanged');
    const one = Export.cloneEntriesForFolio([stack[0]]);
    const keepLast = Export.removeFolioPadAt(one, 0);
    assert.equal(keepLast.ok, false, 'the last page cannot be removed');
});

test('a half-letter folio sheet is letter landscape, matching the service guide @page', () => {
    const half = { widthIn: 5.5, heightIn: 8.5, dpi: 96 };
    const sheet = Export.folioSheet(half);
    assert.deepEqual(sheet, { pageWidthIn: 5.5, pageHeightIn: 8.5, widthIn: 11, heightIn: 8.5 });
    const css = Export.folioPrintCss(half, 1);
    assert.match(css, /@page \{ size: 11in 8.5in; margin: 0; \}/);
    assert.match(css, /\.pr-folio-leaf \{ width: 5\.5in; height: 8\.5in;/);
    assert.match(css, /scale\(1\)/);
    const dense = Export.folioPrintCss({ widthIn: 5.5, heightIn: 8.5 }, 96 / 150);
    assert.match(dense, /scale\(0\.64\)/);
    const a5 = Export.folioSheet({ widthIn: 5.83, heightIn: 8.27 });
    assert.equal(a5.widthIn, 11.66);
    assert.equal(a5.heightIn, 8.27);
});
