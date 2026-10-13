const { test } = require('node:test');
const assert = require('node:assert');

// MS-393 — what a Printable's pages are made of.
//
// A page is a tree of elements at a physical size. The tree is the record and
// the HTML is a projection of it (ADR-0056), so the thing these tests lean on
// hardest is the round trip: page → HTML → page must give back the same
// elements, styles and bindings, because the code view edits the HTML and
// hands it straight back.

const Core = require('../public/printable-core.js');

// ── Paper ────────────────────────────────────────────────────────────────────

test('Letter landscape at 150 dpi is 1650 × 1275 pixels', () => {
    const t = Core.buildTemplate({ paper: 'letter', orientation: 'landscape', dpi: 150 });
    assert.equal(t.widthPx, 1650);
    assert.equal(t.heightPx, 1275);
    assert.equal(t.widthIn, 11);
    assert.equal(t.heightIn, 8.5);
    assert.equal(t.label, 'Letter · landscape · 150 dpi');
});

test('portrait keeps the paper the way round it is listed', () => {
    const t = Core.buildTemplate({ paper: 'a4', orientation: 'portrait', dpi: 96 });
    assert.equal(t.widthPx, Math.round(8.27 * 96));
    assert.equal(t.heightPx, Math.round(11.69 * 96));
});

test('an unknown density falls back to the default rather than a zero-size page', () => {
    const t = Core.buildTemplate({ paper: 'letter', dpi: 72 });
    assert.equal(t.dpi, Core.DEFAULT_DPI);
    assert.ok(t.widthPx > 0 && t.heightPx > 0);
});

test('a custom size is taken in inches as given', () => {
    const t = Core.buildTemplate({ widthIn: 3, heightIn: 4, dpi: 300, label: 'Card' });
    assert.equal(t.paper, 'custom');
    assert.equal(t.widthPx, 900);
    assert.equal(t.heightPx, 1200);
    assert.match(t.label, /^Card/);
});

test('the default margin is half an inch in the page\'s own pixels', () => {
    const t = Core.buildTemplate({ paper: 'letter', dpi: 150 });
    const page = Core.buildPage(t, {});
    assert.deepEqual(page.margins, { top: 75, right: 75, bottom: 75, left: 75 });
});

test('a page laid out at 150 dpi prints scaled to true inches', () => {
    assert.equal(Core.printScale({ dpi: 150 }), 0.64);
    assert.equal(Core.printScale({ dpi: 96 }), 1);
});

// ── Elements ─────────────────────────────────────────────────────────────────

test('a div with children is a box, a p is text, an img is an image', () => {
    assert.equal(Core.kindOf(Core.buildNode({ tag: 'div', children: [{ tag: 'p', text: 'x' }] })), 'box');
    assert.equal(Core.kindOf(Core.buildNode({ tag: 'p', text: 'x' })), 'text');
    assert.equal(Core.kindOf(Core.buildNode({ tag: 'img' })), 'image');
    assert.equal(Core.kindOf(Core.buildNode({ tag: 'div' })), 'box', 'an empty div is still a box');
});

test('the toolbar\'s elements scale with the density so they are visible at 300 dpi', () => {
    const at96 = Core.newText(96);
    const at300 = Core.newText(300);
    assert.equal(at96.style['font-size'], '16px');
    assert.equal(at300.style['font-size'], '50px');
});

function directoryPage() {
    const t = Core.buildTemplate({ paper: 'letter', orientation: 'landscape', dpi: 150 });
    const header = Core.buildNode({ id: 'hdr', tag: 'div', name: 'Header', style: { 'display': 'flex' }, children: [
        { id: 'ttl', tag: 'h1', text: 'Membership directory', style: { 'font-size': '40px' } },
    ] });
    const card = Core.buildNode({ id: 'card', tag: 'div', name: 'Person card',
        repeat: { source: 'people', params: { membership: 'members' }, layout: { direction: 'row', perLine: 3, gap: 12 }, overflow: 'new-page' },
        children: [
            { id: 'photo', tag: 'img', attrs: { src: '', alt: 'Photo' }, style: { width: '120px' }, bind: { src: { scope: 'item', field: 'photo' } } },
            { id: 'nm', tag: 'p', text: 'Jane Example', bind: { text: { scope: 'item', field: 'name' } } },
        ] });
    return { template: t, page: Core.buildPage(t, { id: 'pg1', nodes: [header, card], css: '.card { color: red; }' }) };
}

// ── Hug, Fixed, Fill (MS-402) ────────────────────────────────────────────────
//
// The panel shows one of three words per axis and never stores it — it reads
// the element's own style back. So every test here goes both ways: what a mode
// writes, and what that writing reads as.

const PAGE = Core.layoutOf({});                                     // a page, or any plain box
const ROW = Core.layoutOf({ display: 'flex' });
const COLUMN = Core.layoutOf({ display: 'flex', 'flex-direction': 'column' });
const ABSOLUTE = { layout: 'absolute', align: '' };

test('a box straight on the page is already filling the width and hugging the height', () => {
    const style = Core.newBox(150).style;
    assert.equal(Core.sizeMode(style, PAGE, 'width'), 'fill');
    assert.equal(Core.sizeMode(style, PAGE, 'height'), 'hug');
});

test('dragging a box to a size makes it fixed, and Fill hands the width back to the margins', () => {
    const dragged = { width: '795px', height: '94px' };
    assert.equal(Core.sizeMode(dragged, PAGE, 'width'), 'fixed');
    const patch = Core.setSizeMode(dragged, PAGE, 'width', 'fill');
    assert.equal(patch.width, '');
    assert.equal(Core.sizeMode(Object.assign({}, dragged, patch), PAGE, 'width'), 'fill');
});

test('Fixed rounds the measurement it is given into pixels', () => {
    assert.equal(Core.setSizeMode({}, PAGE, 'width', 'fixed', 240.6).width, '241px');
    assert.equal(Core.setSizeMode({}, PAGE, 'width', 'fixed', '50%').width, '50%');
});

test('across a row, filling the width is a share of the row and hugging gives it back', () => {
    const fill = Core.setSizeMode({}, ROW, 'width', 'fill');
    assert.equal(fill.flex, '1 1 0');
    assert.equal(fill.width, '');
    assert.equal(Core.sizeMode(fill, ROW, 'width'), 'fill');

    const hug = Core.setSizeMode(fill, ROW, 'width', 'hug');
    assert.equal(hug.flex, '');
    assert.equal(Core.sizeMode(Object.assign({}, fill, hug), ROW, 'width'), 'hug');
});

test('down a column the width is the other axis, so filling it is stretch and not a share', () => {
    const fill = Core.setSizeMode({}, COLUMN, 'width', 'fill');
    assert.equal(fill.flex, undefined);
    assert.equal(fill.width, '');
    assert.equal(Core.sizeMode(fill, COLUMN, 'width'), 'fill');
    assert.equal(Core.sizeMode(Core.setSizeMode({}, COLUMN, 'width', 'hug'), COLUMN, 'width'), 'hug');
});

test('a child told to sit at one end of a column is hugging, whatever the panel last wrote', () => {
    const style = { 'align-self': 'flex-start' };
    assert.equal(Core.sizeMode(style, COLUMN, 'width'), 'hug');
    const patch = Core.setSizeMode(style, COLUMN, 'width', 'fill');
    assert.equal(patch['align-self'], '');
});

test('when the parent aligns its children to the start, Fill has to say stretch itself', () => {
    const where = Core.layoutOf({ display: 'flex', 'flex-direction': 'column', 'align-items': 'flex-start' });
    assert.equal(Core.setSizeMode({}, where, 'width', 'fill')['align-self'], 'stretch');
});

test('the height of a box on the page fills by running to the bottom margin, and reads as Fill not Fixed', () => {
    const patch = Core.setSizeMode({}, PAGE, 'height', 'fill');
    assert.equal(patch.height, '100%');
    assert.equal(Core.sizeMode(patch, PAGE, 'height'), 'fill');
    assert.equal(Core.sizeMode({ height: '100%' }, ROW, 'height'), 'fixed');
});

test('an element dragged loose of the flow fills by taking the whole space, both ways', () => {
    assert.equal(Core.setSizeMode({}, ABSOLUTE, 'width', 'fill').width, '100%');
    assert.equal(Core.sizeMode({ width: '100%' }, ABSOLUTE, 'width'), 'fill');
    assert.equal(Core.sizeMode({}, ABSOLUTE, 'width'), 'hug');
});

test('a page that lays its own elements out in a row is read as a row', () => {
    assert.deepEqual(Core.layoutOf({ display: 'flex', 'flex-direction': 'row-reverse' }), { layout: 'row', align: '' });
    assert.equal(Core.layoutOf({ display: 'grid' }).layout, 'grid');
    assert.equal(Core.layoutOf({ display: 'inline-block' }).layout, 'block');
});

// ── The four sides (MS-402) ──────────────────────────────────────────────────

test('one value is all four sides, two are the pairs, three name the bottom on its own', () => {
    assert.deepEqual(Core.readSides('12px'), { ok: true, top: 12, right: 12, bottom: 12, left: 12 });
    assert.deepEqual(Core.readSides('12px 20px'), { ok: true, top: 12, right: 20, bottom: 12, left: 20 });
    assert.deepEqual(Core.readSides('1px 2px 3px'), { ok: true, top: 1, right: 2, bottom: 3, left: 2 });
    assert.deepEqual(Core.readSides('1px 2px 3px 4px'), { ok: true, top: 1, right: 2, bottom: 3, left: 4 });
});

test('nothing written is nothing on any side, and a bare 0 is still a zero', () => {
    assert.deepEqual(Core.readSides(''), { ok: true, top: 0, right: 0, bottom: 0, left: 0 });
    assert.equal(Core.readSides('0').top, 0);
    assert.equal(Core.readSides('-4px').top, -4);
});

test('a value the panel cannot take apart is handed back untouched rather than rounded off', () => {
    assert.deepEqual(Core.readSides('1rem'), { ok: false, raw: '1rem' });
    assert.deepEqual(Core.readSides('5%'), { ok: false, raw: '5%' });
    assert.equal(Core.readSides('calc(1px + 2px)').ok, false);
    assert.equal(Core.readSides('1px 2px 3px 4px 5px').ok, false);
});

test('four sides are written as short as they will go, and read back the same', () => {
    assert.equal(Core.writeSides({ top: 8, right: 8, bottom: 8, left: 8 }), '8px');
    assert.equal(Core.writeSides({ top: 8, right: 16, bottom: 8, left: 16 }), '8px 16px');
    assert.equal(Core.writeSides({ top: 1, right: 2, bottom: 3, left: 4 }), '1px 2px 3px 4px');
    const sides = { top: 4, right: 0, bottom: 12, left: 0 };
    assert.deepEqual(Core.readSides(Core.writeSides(sides)), Object.assign({ ok: true }, sides));
});

test('which fidelity a value is asking for', () => {
    assert.equal(Core.sidesMode({ top: 3, right: 3, bottom: 3, left: 3 }), 'all');
    assert.equal(Core.sidesMode({ top: 3, right: 5, bottom: 3, left: 5 }), 'pairs');
    assert.equal(Core.sidesMode({ top: 3, right: 5, bottom: 4, left: 5 }), 'four');
});

// ── Walking ──────────────────────────────────────────────────────────────────

test('insert, update, move, duplicate and remove all return a new page and leave the old one alone', () => {
    const { page } = directoryPage();
    const before = JSON.stringify(page);

    const inserted = Core.insertNode(page, 'hdr', Core.buildNode({ tag: 'p', text: 'Sub' }));
    assert.equal(Core.findNode(inserted, 'hdr').children.length, 2);

    const updated = Core.updateNode(inserted, 'ttl', { style: { color: 'navy', 'font-size': '' }, text: 'Directory' });
    const ttl = Core.findNode(updated, 'ttl');
    assert.equal(ttl.style.color, 'navy');
    assert.equal(ttl.style['font-size'], undefined, 'an emptied style is removed, not kept as blank');
    assert.equal(ttl.text, 'Directory');

    const moved = Core.moveNode(updated, 'nm', 'hdr', 0);
    assert.equal(moved.ok, true);
    assert.equal(Core.findNode(moved.page, 'hdr').children[0].id, 'nm');
    assert.equal(Core.findNode(moved.page, 'card').children.length, 1);

    const dup = Core.duplicateNode(moved.page, 'card');
    assert.equal(dup.nodes.length, 3);
    assert.notEqual(dup.nodes[2].id, 'card');
    assert.equal(dup.nodes[2].repeat.source, 'people', 'a copy keeps its repeat');

    const removed = Core.removeNode(dup, 'hdr');
    assert.equal(removed.nodes.length, 2);

    assert.equal(JSON.stringify(page), before, 'the original page was mutated');
});

test('an element refuses to move inside itself or its own child, with a reason', () => {
    const { page } = directoryPage();
    assert.equal(Core.moveNode(page, 'card', 'card').ok, false);
    const verdict = Core.moveNode(page, 'card', 'nm');
    assert.equal(verdict.ok, false);
    assert.match(verdict.why, /already contains/);
});

test('moving within one list lands where it was asked, not one off', () => {
    const t = Core.buildTemplate({});
    const page = Core.buildPage(t, { nodes: [
        { id: 'a', tag: 'div' }, { id: 'b', tag: 'div' }, { id: 'c', tag: 'div' },
    ] });
    const r = Core.moveNode(page, 'a', null, 2);
    assert.deepEqual(r.page.nodes.map(n => n.id), ['b', 'a', 'c']);
    const r2 = Core.moveNode(page, 'c', null, 0);
    assert.deepEqual(r2.page.nodes.map(n => n.id), ['c', 'a', 'b']);
});

test('inserting into a text element lands beside it, since text cannot hold children', () => {
    const { page } = directoryPage();
    const next = Core.insertNode(page, 'ttl', Core.buildNode({ tag: 'p', text: 'x' }));
    assert.equal(Core.findNode(next, 'hdr').children.length, 2);
    assert.equal(Core.findNode(next, 'ttl').children.length, 0);
});

test('wrapping puts a box around an element in its place', () => {
    const { page, template } = directoryPage();
    const next = Core.wrapNode(page, 'ttl', template.dpi);
    const hdr = Core.findNode(next, 'hdr');
    assert.equal(hdr.children.length, 1);
    assert.equal(hdr.children[0].tag, 'div');
    assert.equal(hdr.children[0].children[0].id, 'ttl');
});

// ── The round trip ───────────────────────────────────────────────────────────

test('a page becomes HTML that carries ids, styles, bindings and repeats', () => {
    const { page } = directoryPage();
    const html = Core.pageToHtml(page);
    assert.match(html, /<div data-pid="hdr" data-name="Header" style="display: flex">/);
    assert.match(html, /<h1 data-pid="ttl" style="font-size: 40px">Membership directory<\/h1>/);
    assert.match(html, /<img data-pid="photo" src="" alt="Photo" style="width: 120px" data-bind="/);
    assert.match(html, /data-repeat="/);
});

test('HTML → page → HTML gives back the same tree, styles, bindings and repeats', () => {
    const { page } = directoryPage();
    const html = Core.pageToHtml(page);
    const back = Core.htmlToNodes(html);
    assert.equal(back.ok, true, back.problems.join(' '));
    const again = Core.buildPage(Core.buildTemplate({}), Object.assign({}, page, { nodes: back.nodes }));
    assert.deepEqual(again.nodes, page.nodes);
    assert.equal(Core.pageToHtml(again), html);
});

test('text in the HTML survives escaping both ways', () => {
    const t = Core.buildTemplate({});
    const page = Core.buildPage(t, { nodes: [{ id: 'x', tag: 'p', text: 'Fish & Chips <3 "quoted"' }] });
    const back = Core.htmlToNodes(Core.pageToHtml(page));
    assert.equal(back.nodes[0].text, 'Fish & Chips <3 "quoted"');
});

test('markup pasted from elsewhere becomes editable elements with fresh ids', () => {
    const back = Core.htmlToNodes('<section class="hero"><h2>Hello</h2>Loose text<img src="a.png"></section>');
    assert.equal(back.ok, true);
    const section = back.nodes[0];
    assert.equal(section.tag, 'section');
    assert.equal(section.attrs.class, 'hero');
    assert.ok(section.id, 'an element without a data-pid is given one');
    assert.equal(section.children.length, 3);
    assert.equal(section.children[0].text, 'Hello');
    assert.equal(section.children[1].tag, 'span', 'loose text is wrapped so it can be selected');
    assert.equal(section.children[1].text, 'Loose text');
    assert.equal(section.children[2].tag, 'img');
});

test('malformed HTML is refused with the line, never rebuilt from a guess', () => {
    const unclosed = Core.htmlToNodes('<div>\n<p>Hello\n</div>');
    assert.equal(unclosed.ok, false);
    assert.match(unclosed.problems[0], /line 3/i);
    assert.match(unclosed.problems[0], /<\/div>/);
    assert.deepEqual(unclosed.nodes, []);

    const open = Core.htmlToNodes('<div><p>Hello</p>');
    assert.equal(open.ok, false);
    assert.match(open.problems[0], /<div> on line 1 is never closed/);
});

test('a comment in the code is skipped rather than becoming an element', () => {
    const back = Core.htmlToNodes('<!-- header -->\n<p>Hi</p>');
    assert.equal(back.ok, true);
    assert.equal(back.nodes.length, 1);
});

test('a list can ask to be left out when it has no rows', () => {
    const kept = Core.buildNode({ tag: 'div', repeat: { source: 'people', overflow: 'new-page' } });
    assert.equal(kept.repeat.omitWhenEmpty, false);
    const html = '<div data-repeat=\'{"source":"sunday_hymns","params":{"slot":"hymn2"},"overflow":"new-page","omitWhenEmpty":true}\'></div>';
    const back = Core.htmlToNodes(html);
    assert.equal(back.ok, true, (back.problems || []).join(' '));
    assert.equal(back.nodes[0].repeat.omitWhenEmpty, true);
    assert.equal(back.nodes[0].repeat.overflow, 'new-page');
    const round = Core.htmlToNodes(Core.pageToHtml(Core.buildPage(Core.buildTemplate({}), { nodes: back.nodes })));
    assert.equal(round.nodes[0].repeat.omitWhenEmpty, true);
});

// MS-743 — intentional row range on a Repeat (1-based inclusive; to 0 = through end).
test('a Repeat remembers a from/to row range; defaults keep the whole list', () => {
    const whole = Core.buildRepeat({ source: 'people' });
    assert.equal(whole.from, 0);
    assert.equal(whole.to, 0);
    const half = Core.buildRepeat({ source: 'people', from: 1, to: 5 });
    assert.equal(half.from, 1);
    assert.equal(half.to, 5);
    const html = '<div data-repeat=\'{"source":"people","from":6,"to":0}\'></div>';
    const back = Core.htmlToNodes(html);
    assert.equal(back.ok, true, (back.problems || []).join(' '));
    assert.equal(back.nodes[0].repeat.from, 6);
    assert.equal(back.nodes[0].repeat.to, 0);
});

test('sliceRows takes a 1-based inclusive range; 0 to means through the end', () => {
    const rows = ['a', 'b', 'c', 'd', 'e'];
    assert.deepEqual(Core.sliceRows(rows, 0, 0), rows);
    assert.deepEqual(Core.sliceRows(rows, 1, 0), rows);
    assert.deepEqual(Core.sliceRows(rows, 1, 3), ['a', 'b', 'c']);
    assert.deepEqual(Core.sliceRows(rows, 3, 0), ['c', 'd', 'e']);
    assert.deepEqual(Core.sliceRows(rows, 4, 5), ['d', 'e']);
    assert.deepEqual(Core.sliceRows(rows, 6, 0), []);
    assert.deepEqual(Core.sliceRows(rows, 3, 2), []);
    assert.deepEqual(Core.sliceRows(rows, 1, 99), rows);
    assert.equal(Core.sliceRows(null, 1, 2), null);
});

// ── The record ───────────────────────────────────────────────────────────────

test('a printable rebuilds its pages through the model, so every page has margins and a stylesheet', () => {
    const p = Core.buildPrintable({
        name: 'Directory',
        template: { paper: 'letter', orientation: 'landscape', dpi: 150 },
        pages: [{ nodes: [{ tag: 'p', text: 'x' }] }],
    });
    assert.equal(p.version, Core.RECORD_VERSION);
    assert.equal(p.template.widthPx, 1650);
    assert.equal(p.pages.length, 1);
    assert.ok(p.pages[0].id);
    assert.deepEqual(p.pages[0].margins, { top: 75, right: 75, bottom: 75, left: 75 });
    assert.equal(p.pages[0].css, '');
    assert.equal(p.bookletExport, false, 'a directory is not a Sunday booklet unless flagged');
});

test('event fields survive build and duplicate', () => {
    const p = Core.buildPrintable({
        name: 'Pickup',
        template: { paper: 'letter' },
        pages: [],
        inputs: [
            { id: 'in1', label: '  Home team  ', kind: 'text' },
            { id: 'in2', label: 'Players', kind: 'list', fields: [
                { id: 'c1', label: 'Name', kind: 'text' },
                { id: '', label: 'Dropped', kind: 'text' },
            ] },
            { id: 'in1', label: 'Duplicate id', kind: 'image' },
        ],
    });
    assert.equal(p.inputs.length, 2);
    assert.equal(p.inputs[0].label, 'Home team');
    assert.equal(p.inputs[1].fields.length, 1);
    assert.equal(p.inputs[1].fields[0].id, 'c1');
    const copy = Core.duplicatePrintable(p, ['Pickup']);
    assert.equal(copy.inputs[0].id, 'in1');
    assert.equal(copy.inputs[1].kind, 'list');
});

test('bookletExport survives build and duplicate', () => {
    const p = Core.buildPrintable({
        name: 'Sunday booklet',
        bookletExport: true,
        template: { paper: 'letter' },
        pages: [],
    });
    assert.equal(p.bookletExport, true);
    const copy = Core.duplicatePrintable(p, ['Sunday booklet']);
    assert.equal(copy.bookletExport, true);
    assert.equal(Core.buildPrintable({ name: 'x', bookletExport: 'yes' }).bookletExport, false);
});

test('a version-1 record (library only, no paper yet) still opens', () => {
    const old = { version: 1, name: 'Old one', folderId: null, template: null, pages: [] };
    const p = Core.migrate(old);
    assert.equal(p.name, 'Old one');
    assert.equal(p.template, null);
    assert.deepEqual(p.pages, []);
    assert.equal(p.version, Core.RECORD_VERSION);
});

test('a custom template keeps the paper, margins, stylesheet and elements of the page it came from', () => {
    const { page, template } = directoryPage();
    const custom = Core.buildCustomTemplate({ name: 'Directory page', template, page });
    assert.equal(custom.name, 'Directory page');
    assert.equal(custom.template.widthPx, 1650);
    assert.equal(custom.page.css, '.card { color: red; }');
    assert.equal(custom.page.nodes.length, 2);
    assert.equal(custom.page.nodes[1].repeat.source, 'people');
});

test('the page container carries its size, margins as padding, and its background', () => {
    const { page, template } = directoryPage();
    const style = Core.pageContainerStyle(template, page);
    assert.equal(style.width, '1650px');
    assert.equal(style.height, '1275px');
    assert.equal(style.padding, '75px 75px 75px 75px');
    assert.equal(style['background-color'], '#ffffff');
});

// ── Linked to an event ───────────────────────────────────────────────────────

test('an overflow continuation is a real page that remembers which list it continues', () => {
    const t = Core.buildTemplate({ paper: 'letter', dpi: 96 });
    const page = Core.buildPage(t, {
        id: 'pg2',
        name: 'Directory 2',
        continues: { from: 'pg1', repeat: 'card' },
        nodes: [{ tag: 'p', text: 'Page number' }],
    });
    assert.deepEqual(page.continues, { from: 'pg1', repeat: 'card' });
    assert.equal(page.name, 'Directory 2');
    assert.equal(Core.buildPage(t, { id: 'plain' }).continues, null);
});

test('copying a list page joins that list instead of starting another', () => {
    const { page } = directoryPage();
    assert.deepEqual(Core.continuesForCopy(page), { from: 'pg1', repeat: 'card' });
    const next = Core.buildPage(Core.buildTemplate({ paper: 'letter', dpi: 96 }), {
        id: 'pg2',
        continues: { from: 'pg1', repeat: 'card' },
        nodes: page.nodes,
    });
    assert.deepEqual(Core.continuesForCopy(next), { from: 'pg1', repeat: 'card' });
    const cover = Core.buildPage(Core.buildTemplate({ paper: 'letter', dpi: 96 }), {
        id: 'cover',
        nodes: [{ id: 't', tag: 'h1', text: 'Cover' }],
    });
    assert.equal(Core.continuesForCopy(cover), null);
});

test('deleting the page a list started on hands the list to the next page', () => {
    const t = Core.buildTemplate({ paper: 'letter', dpi: 96 });
    const card = { id: 'card', tag: 'div', repeat: { source: 'people', overflow: 'new-page' }, children: [] };
    const origin = Core.buildPage(t, { id: 'pg1', name: 'Members', nodes: [card] });
    const two = Core.buildPage(t, {
        id: 'pg2', name: 'Members', continues: { from: 'pg1', repeat: 'card' },
        nodes: [{ id: 'card2', tag: 'div', repeat: { source: 'people', overflow: 'new-page' }, children: [] }],
    });
    const three = Core.buildPage(t, {
        id: 'pg3', name: 'Members', continues: { from: 'pg1', repeat: 'card' },
        nodes: [{ id: 'card3', tag: 'div', repeat: { source: 'people', overflow: 'new-page' }, children: [] }],
    });
    const left = Core.pagesWithout([origin, two, three], ['pg1']);
    assert.deepEqual(left.map(p => p.id), ['pg2', 'pg3']);
    assert.equal(left[0].continues, null);
    assert.deepEqual(left[1].continues, { from: 'pg2', repeat: 'card2' });
});

test('deleting a middle continuation leaves the list pointing at its start', () => {
    const t = Core.buildTemplate({ paper: 'letter', dpi: 96 });
    const origin = Core.buildPage(t, { id: 'pg1', nodes: [] });
    const two = Core.buildPage(t, { id: 'pg2', continues: { from: 'pg1', repeat: 'card' }, nodes: [] });
    const three = Core.buildPage(t, { id: 'pg3', continues: { from: 'pg1', repeat: 'card' }, nodes: [] });
    const left = Core.pagesWithout([origin, two, three], ['pg2']);
    assert.deepEqual(left.map(p => p.id), ['pg1', 'pg3']);
    assert.equal(left[0].continues, null);
    assert.deepEqual(left[1].continues, { from: 'pg1', repeat: 'card' });
});

test('continuation runs: bounds, no insert between sheets, move as a block (MS-760)', () => {
    const t = Core.buildTemplate({ paper: 'letter', dpi: 96 });
    const cover = Core.buildPage(t, { id: 'cover', name: 'Cover', nodes: [] });
    const origin = Core.buildPage(t, { id: 'pg1', name: 'List', nodes: [] });
    const two = Core.buildPage(t, { id: 'pg2', continues: { from: 'pg1', repeat: 'card' }, nodes: [] });
    const three = Core.buildPage(t, { id: 'pg3', continues: { from: 'pg1', repeat: 'card' }, nodes: [] });
    const back = Core.buildPage(t, { id: 'back', name: 'Back', nodes: [] });
    const pages = [cover, origin, two, three, back];
    assert.deepEqual(Core.continuationRunBounds(pages, 'pg2'), { start: 1, end: 3, originId: 'pg1' });
    assert.deepEqual(Core.continuationRunBounds(pages, 'cover'), { start: 0, end: 0, originId: 'cover' });
    assert.equal(Core.canInsertAfter(pages, 0), true, 'after cover is fine');
    assert.equal(Core.canInsertAfter(pages, 1), false, 'not between origin and first continuation');
    assert.equal(Core.canInsertAfter(pages, 2), false, 'not between continuations');
    assert.equal(Core.canInsertAfter(pages, 3), true, 'after the run is fine');
    assert.equal(Core.canInsertAfter(pages, 4), true, 'after the last page is fine');
    const moved = Core.movePageRun(pages, 'pg2', -1);
    assert.deepEqual(moved.map(p => p.id), ['pg1', 'pg2', 'pg3', 'cover', 'back'], 'the whole run moves earlier');
    const movedDown = Core.movePageRun(pages, 'cover', 1);
    assert.deepEqual(movedDown.map(p => p.id), ['pg1', 'pg2', 'pg3', 'cover', 'back'], 'cover jumps past the whole run');
});

test('a page drag lands in a gap between runs, never on a page or inside a run', () => {
    const t = Core.buildTemplate({ paper: 'letter', dpi: 96 });
    const cover = Core.buildPage(t, { id: 'cover', name: 'Cover', nodes: [] });
    const origin = Core.buildPage(t, { id: 'pg1', name: 'List', nodes: [] });
    const two = Core.buildPage(t, { id: 'pg2', continues: { from: 'pg1', repeat: 'card' }, nodes: [] });
    const three = Core.buildPage(t, { id: 'pg3', continues: { from: 'pg1', repeat: 'card' }, nodes: [] });
    const back = Core.buildPage(t, { id: 'back', name: 'Back', nodes: [] });
    const pages = [cover, origin, two, three, back];

    assert.deepEqual(Core.pageReorderSlots(pages, 'pg2'), [-1, 4], 'the list run can move before the cover or after the back, not into its own gap');
    assert.deepEqual(Core.pageReorderSlots(pages, 'cover'), [3, 4], 'cover can follow the run or the back');
    assert.equal(Core.pageReorderTarget(pages, -1), 'cover');
    assert.equal(Core.pageReorderTarget(pages, 3), 'back');
    assert.equal(Core.pageReorderTarget(pages, 4), null);

    const beforeCover = Core.reorderPageRunBefore(pages, 'pg2', Core.pageReorderTarget(pages, -1));
    assert.deepEqual(beforeCover.map(p => p.id), ['pg1', 'pg2', 'pg3', 'cover', 'back']);
    const afterBack = Core.reorderPageRunBefore(pages, 'pg2', Core.pageReorderTarget(pages, 4));
    assert.deepEqual(afterBack.map(p => p.id), ['cover', 'back', 'pg1', 'pg2', 'pg3']);
    const split = Core.reorderPageRunBefore(pages, 'back', 'pg2');
    assert.deepEqual(split.map(p => p.id), ['cover', 'back', 'pg1', 'pg2', 'pg3'], 'a landing aimed inside a run snaps to the run boundary');

    const gaps = [
        { after: -1, top: 0, bottom: 14, legal: true },
        { after: 0, top: 200, bottom: 214, legal: false },
        { after: 3, top: 800, bottom: 814, legal: true },
    ];
    assert.equal(Core.nearestPageReorderSlot(gaps, 30), -1, 'the pointer near the top gap lands there');
    assert.equal(Core.nearestPageReorderSlot(gaps, 190), null, 'the gap the page already occupies is not a landing');
    assert.equal(Core.nearestPageReorderSlot(gaps, 760), 3, 'the nearer legal gap, past the middle of the run');
});

test('cloning a page for overflow remints every id and keeps the design', () => {
    const { page, template } = directoryPage();
    const copy = Core.clonePage(template, page, { continues: { from: page.id, repeat: 'card' } });
    assert.ok(copy.id && copy.id !== page.id);
    assert.deepEqual(copy.continues, { from: page.id, repeat: 'card' });
    assert.equal(copy.css, page.css);
    assert.equal(copy.nodes.length, page.nodes.length);
    assert.equal(copy.nodes[1].repeat.source, 'people');
    assert.notEqual(copy.nodes[0].id, page.nodes[0].id);
    assert.notEqual(copy.nodes[1].id, page.nodes[1].id);
    assert.notEqual(copy.nodes[1].children[1].id, page.nodes[1].children[1].id);
    assert.equal(copy.nodes[1].children[1].bind.text.field, 'name');
});

test('linking adds an id once and unlinking removes it, leaving the rest alone', () => {
    assert.deepEqual(Core.linkPrintable(['a'], 'b'), ['a', 'b']);
    assert.deepEqual(Core.linkPrintable(['a', 'b'], 'b'), ['a', 'b'], 'linking twice is one link');
    assert.deepEqual(Core.unlinkPrintable(['a', 'b'], 'a'), ['b']);
    assert.deepEqual(Core.unlinkPrintable(undefined, 'a'), []);
});

test('a page number is an element that sits on the page, and mirroring is off until asked', () => {
    const n = Core.newPageNumber(96);
    assert.equal(Core.kindOf(n), 'page-number');
    assert.equal(n.pageNumber.mirror, false);
    assert.equal(n.pageNumber.anchor, 'bottom-right');
    assert.equal(n.pageNumber.inset, 36);

    const home = Core.placePageNumber(n, { pageIndex: 0 });
    const next = Core.placePageNumber(n, { pageIndex: 1 });
    assert.equal(home.text, '1');
    assert.equal(next.text, '2');
    assert.equal(home.style.position, 'absolute');
    assert.equal(home.style.right, '36px');
    assert.equal(home.style.bottom, '36px');
    assert.equal(next.style.right, home.style.right, 'without mirroring the place does not move');
    assert.equal(next.style.bottom, home.style.bottom);
    assert.equal(n.pageNumber.mirror, false, 'drawing does not change the element');

    const page = Core.buildPage(Core.buildTemplate({ paper: 'letter', dpi: 96 }), { nodes: [Core.newBox(96)] });
    const boxId = page.nodes[0].id;
    const inserted = Core.insertNode(page, boxId, n);
    assert.equal(inserted.nodes.length, 2);
    assert.equal(Core.kindOf(inserted.nodes[1]), 'page-number');
    assert.equal(inserted.nodes[0].children.length, 0, 'it does not go inside the box');
    const moved = Core.moveNode(inserted, inserted.nodes[1].id, boxId, 0);
    assert.equal(moved.ok, false);
    assert.equal(Core.wrapNode(inserted, inserted.nodes[1].id, 96).nodes.length, 2);
});

test('mirroring reflects a page number across the middle on every other page', () => {
    const placed = Core.buildNode({
        tag: 'p',
        pageNumber: { mirror: true, anchor: 'bottom-right', inset: 48, left: 10, top: 10 },
    });
    const odd = Core.placePageNumber(placed, { pageIndex: 0 });
    const even = Core.placePageNumber(placed, { pageIndex: 1 });
    assert.equal(odd.style.right, '48px');
    assert.equal(odd.style.left, undefined);
    assert.equal(even.style.left, '48px');
    assert.equal(even.style.right, undefined);
    assert.equal(even.style.bottom, '48px');

    const free = Core.buildNode({
        tag: 'p',
        pageNumber: { mirror: true, anchor: 'free', left: 40, top: 700, inset: 36 },
    });
    assert.equal(Core.placePageNumber(free, { pageIndex: 0 }).style.left, '40px');
    assert.equal(Core.placePageNumber(free, { pageIndex: 1 }).style.right, '40px');
    assert.equal(Core.placePageNumber(free, { pageIndex: 1 }).style.top, '700px');
    assert.equal(Core.pageNumberHomeLeft(740, 20, 800, true), 40);
    assert.equal(Core.pageNumberHomeLeft(40, 20, 800, false), 40);

    const middle = Core.buildNode({
        tag: 'p',
        pageNumber: { mirror: true, anchor: 'center', inset: 0, left: 0, top: 0 },
    });
    const a = Core.placePageNumber(middle, { pageIndex: 0 });
    const b = Core.placePageNumber(middle, { pageIndex: 2 });
    const c = Core.placePageNumber(middle, { pageIndex: 1 });
    assert.equal(a.style.left, '50%');
    assert.equal(b.style.left, '50%');
    assert.equal(c.style.left, '50%');
    assert.equal(a.style.transform, c.style.transform);

    const kept = Core.updateNode(
        Core.buildPage(Core.buildTemplate({}), { nodes: [placed] }),
        placed.id,
        { pageNumber: { mirror: false } },
    );
    assert.equal(Core.findNode(kept, placed.id).pageNumber.mirror, false);
    assert.equal(Core.findNode(kept, placed.id).pageNumber.anchor, 'bottom-right');
    assert.equal(Core.findNode(kept, placed.id).pageNumber.inset, 48);
});

test('a page number round-trips through the code view, and an old chip becomes one', () => {
    const n = Core.buildNode({
        tag: 'p',
        name: 'Folio',
        pageNumber: { mirror: true, anchor: 'bottom-left', inset: 24, left: 8, top: 9 },
    });
    const back = Core.htmlToNodes(Core.nodeToHtml(n, 0));
    assert.equal(back.ok, true);
    assert.deepEqual(back.nodes[0].pageNumber, n.pageNumber);
    assert.equal(back.nodes[0].name, 'Folio');

    const legacy = Core.buildNode({
        tag: 'p',
        text: '1',
        style: { left: '40px', top: '12px', position: 'absolute' },
        bind: {
            text: { source: 'insert_page_number', field: 'number', params: { startAt: 3 } },
            class: { source: 'insert_page_number', field: 'edgeClass' },
        },
    });
    assert.equal(Core.kindOf(legacy), 'page-number');
    assert.equal(legacy.pageNumber.mirror, true);
    assert.equal(legacy.pageNumber.anchor, 'free');
    assert.equal(legacy.pageNumber.left, 40);
    assert.equal(legacy.pageNumber.top, 12);
    assert.equal(legacy.bind, undefined);
});
