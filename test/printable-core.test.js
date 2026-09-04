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

test('linking adds an id once and unlinking removes it, leaving the rest alone', () => {
    assert.deepEqual(Core.linkPrintable(['a'], 'b'), ['a', 'b']);
    assert.deepEqual(Core.linkPrintable(['a', 'b'], 'b'), ['a', 'b'], 'linking twice is one link');
    assert.deepEqual(Core.unlinkPrintable(['a', 'b'], 'a'), ['b']);
    assert.deepEqual(Core.unlinkPrintable(undefined, 'a'), []);
});
