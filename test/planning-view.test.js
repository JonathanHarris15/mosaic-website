// MS-245 — the Planning view, and the table's liturgy columns (ADR-0080).
//
// The table carries one column per Liturgy Element of the orders toggled on
// above it, so a service guide session can fill one hymn slot down twelve
// Sundays instead of opening twelve Sundays one at a time.
//
// Two things here are worth pinning against a careless edit later:
//
//   1. The columns come from ONE place. The header, the cell and the editor
//      that opens when you click are all read off the congregation's elements
//      (liturgyColumns / liturgyElementFor), because hand-kept lists are how a
//      column ends up with a heading and no way to type into it.
//
//   2. A hymn slot is {id, name}, and a slot typed in freehand must drop the
//      old id. Keep it and the cell reads one hymn while the printed guide
//      fetches another — the worst kind of wrong, because it looks right.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PUBLIC = path.join(__dirname, '..', 'public');
const SRC = fs.readFileSync(path.join(PUBLIC, 'service-calendar.js'), 'utf8');
const HTML = fs.readFileSync(path.join(PUBLIC, 'service-calendar.html'), 'utf8');
const Liturgy = require('../public/liturgy-order-core.js');

function load() {
    const sandbox = {
        console: { log() {}, warn() {}, error() {} },
        setTimeout() { return 0; }, clearTimeout() {}, setInterval() {}, clearInterval() {},
        Promise, Date, Object, Array, Math, String, Number, JSON, Set, Map,
        encodeURIComponent, URLSearchParams, Boolean, Error,
        module: { exports: {} },
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    sandbox.location = { search: '', href: '' };
    sandbox.localStorage = { getItem: () => null, setItem() {} };
    sandbox.auth = { onAuthStateChanged() {}, currentUser: null };
    sandbox.document = {
        addEventListener() {}, getElementById() { return null; },
        querySelector() { return null; }, querySelectorAll() { return []; },
        createElement: () => ({ classList: { add() {} }, style: {}, textContent: '', innerHTML: '' }),
        body: { classList: { contains: () => false } },
    };
    sandbox.DateUtils = require('../public/date-utils.js');
    sandbox.HymnRegistry = require('../public/hymn-registry.js');
    sandbox.LiturgyOrderCore = Liturgy;

    vm.createContext(sandbox);
    vm.runInContext(SRC, sandbox, { filename: 'service-calendar.js' });
    // Top-level const/let are lexical bindings, not globals, so the tables come
    // back through the export seam rather than off the sandbox.
    return Object.assign(sandbox, sandbox.module.exports);
}

// ── The columns: the toggled orders' elements ─────────────────────────────

const STANDARD_IDS = [
    'preparatoryHymn', 'callToWorship', 'hymn1', 'hymn2', 'callToConfession',
    'assuranceOfPardon', 'hymnMid1', 'hymnMid2', 'scriptureReading', 'sermon',
    'baptism', 'hymnEnd1', 'hymnEnd2', 'benediction',
];

// A congregation with a second order that shares some of Standard's elements
// and adds one of its own. Fictional, like every fixture here.
function twoOrderCatalog() {
    const seed = Liturgy.standardCatalog();
    return Liturgy.catalogFrom({
        elements: seed.elements.concat([
            { id: 'lordsSupper', name: 'Lord\'s Supper', primitive: 'text', hasRole: true, hasNote: false },
        ]),
        orders: seed.orders.concat([
            { id: 'communion', name: 'Communion', elementIds: ['hymn1', 'lordsSupper', 'sermon', 'benediction'] },
        ]),
    });
}

test('with nothing remembered, the columns are Standard\'s elements in service order', () => {
    const sb = load();
    assert.deepStrictEqual(Array.from(sb.currentTableOrderIds()), ['standard']);
    assert.deepStrictEqual(sb.liturgyColumns().map(c => c.id), STANDARD_IDS);
});

test('the columns read left to right in the order the service runs', () => {
    const sb = load();
    const order = sb.liturgyColumns().map(c => c.id);
    const pos = f => order.indexOf(f);

    assert.ok(pos('preparatoryHymn') < pos('hymn1'), 'the preparatory hymn opens');
    assert.ok(pos('hymn1') < pos('callToConfession'), 'praise before confession');
    assert.ok(pos('callToConfession') < pos('assuranceOfPardon'), 'the call precedes the assurance');
    assert.ok(pos('assuranceOfPardon') < pos('hymnMid1'));
    assert.ok(pos('hymnMid2') < pos('scriptureReading'), 'the prayer follows the middle hymns');
    assert.ok(pos('scriptureReading') < pos('hymnEnd1'), 'the closing hymns come after');
    assert.ok(pos('benediction') === order.length - 1, 'the benediction sends everyone home');
});

test('a shared element is one column, and Standard\'s come first', () => {
    const sb = load();
    sb.setLiturgyCatalog(twoOrderCatalog());
    sb.setTableOrderIds(['communion', 'standard']);

    const ids = sb.liturgyColumns().map(c => c.id);
    STANDARD_IDS.forEach((id, i) => {
        if (i === 0) return;
        assert.ok(ids.indexOf(STANDARD_IDS[i - 1]) < ids.indexOf(id), `${id} stayed in Standard's order`);
    });
    assert.strictEqual(ids.filter(id => id === 'sermon').length, 1, 'the shared sermon is one column');
    assert.strictEqual(ids.filter(id => id === 'lordsSupper').length, 1, 'Communion adds the supper once');
    assert.ok(ids.indexOf('hymn1') < ids.indexOf('lordsSupper') && ids.indexOf('lordsSupper') < ids.indexOf('sermon'),
        'the supper sits between the hymn and the sermon it follows');
    const supper = sb.liturgyColumns().find(c => c.id === 'lordsSupper');
    assert.strictEqual(supper.orderName, 'Communion');
    assert.strictEqual(supper.label, 'Communion · Lord\'s Supper');
    const hymn = sb.liturgyColumns().find(c => c.id === 'hymn1');
    assert.strictEqual(hymn.orderName, '', 'a column two orders share is not labelled with one of them');
});

test('an order toggled on alone gives its own elements, in its own order', () => {
    const sb = load();
    sb.setLiturgyCatalog(twoOrderCatalog());
    sb.setTableOrderIds(['communion']);
    assert.deepStrictEqual(sb.liturgyColumns().map(c => c.id),
        ['hymn1', 'lordsSupper', 'sermon', 'benediction']);
});

test('the toggled orders are remembered on this device', () => {
    const sb = load();
    const writes = {};
    sb.localStorage.setItem = (k, v) => { writes[k] = v; };
    sb.setLiturgyCatalog(twoOrderCatalog());
    sb.setTableOrderIds(['standard', 'communion']);
    assert.strictEqual(sb.TABLE_ORDERS_KEY, 'calendarLiturgyOrders');
    assert.deepStrictEqual(JSON.parse(writes.calendarLiturgyOrders), ['standard', 'communion']);
});

test('a remembered order that has since been deleted is let go', () => {
    const sb = load();
    sb.localStorage.getItem = (k) => (k === 'calendarLiturgyOrders' ? '["gone","communion"]' : null);
    sb.setLiturgyCatalog(twoOrderCatalog());
    assert.deepStrictEqual(Array.from(sb.currentTableOrderIds()), ['communion']);
});

test('the pastoral prayer reference is its own column, beside the people', () => {
    // The Prayed For column carries the two people prayed for. The element
    // "Pastoral Prayer" is the scripture reference — a different thing, a
    // different field, and it must not be mistaken for a duplicate.
    const sb = load();
    const col = sb.liturgyColumns().find(c => c.id === 'scriptureReading');
    assert.ok(col, 'no column for the pastoral prayer reference');
    assert.match(col.name, /Pastoral Prayer/);
    assert.strictEqual(col.primitive, 'scripture', 'a reference is picked, not typed freehand');
});

test('the people prayed for are not elements, so they are never doubled up', () => {
    const sb = load();
    assert.strictEqual(sb.liturgyElementFor('prayerMale'), null);
    assert.strictEqual(sb.liturgyElementFor('prayerFemale'), null);
    assert.match(SRC, /Prayed For/, 'and their column is still there');
});

test('every song column opens the hymn editor, every scripture column the verse picker', () => {
    const sb = load();
    const songs = sb.liturgyColumns().filter(c => c.primitive === 'song').map(c => c.id).sort();
    assert.deepStrictEqual(songs, [
        'hymn1', 'hymn2', 'hymnEnd1', 'hymnEnd2', 'hymnMid1', 'hymnMid2', 'preparatoryHymn'
    ]);
    ['sermon', 'callToConfession', 'assuranceOfPardon', 'benediction'].forEach(f =>
        assert.strictEqual(sb.liturgyElementFor(f).primitive, 'scripture', `${f} should use the verse picker`));
    assert.match(SRC, /element && element\.primitive === 'song'[\s\S]{0,80}openHymnEditor/);
    assert.match(SRC, /element && element\.primitive === 'scripture'/);
});

test('a text element typed into the table is written under liturgy, not on the Sunday itself', () => {
    assert.match(SRC, /if \(element\) \{\s*await writeLiturgyField\(dateKey, field, newVal\);/);
});

test('a people element is shown but not edited in the table', () => {
    // Naming a baptism candidate writes the candidate's own record too
    // (ADR-0006); that belongs to the Order of Service. A hymn and a
    // scripture reading are the cells this table writes.
    assert.match(SRC, /canEdit && \(element\.primitive === 'song' \|\| element\.primitive === 'scripture'\)/);
});

test('the sermon, baptism and old pastoral prayer reference are no longer fixed columns', () => {
    assert.ok(!/sermon-cell|baptism-cell|prayer-ref-cell|PLANNING_COLUMNS/.test(SRC));
});

// ── How a hymn slot reads ─────────────────────────────────────────────────

test('a chosen hymn shows its name', () => {
    const sb = load();
    assert.strictEqual(sb.hymnCellText({ id: 'H12', name: 'Holy Holy Holy' }), 'Holy Holy Holy');
});

test('an empty slot shows a dash rather than nothing', () => {
    const sb = load();
    assert.strictEqual(sb.hymnCellText(null), '—');
    assert.strictEqual(sb.hymnCellText(undefined), '—');
    assert.strictEqual(sb.hymnCellText({ id: null, name: '' }), '—');
});

test('a hymn typed in freehand still shows', () => {
    // The Order of Service has always allowed a hymn the index has never heard
    // of. The Planning view must not be stricter, or a hymn nobody has
    // catalogued yet cannot be planned.
    const sb = load();
    assert.strictEqual(sb.hymnCellText({ id: null, name: 'A New Song' }), 'A New Song');
});

test('a legacy slot stored as a bare string still reads', () => {
    const sb = load();
    assert.strictEqual(sb.hymnCellText('Old Hundredth'), 'Old Hundredth');
});

// ── The markup ────────────────────────────────────────────────────────────

test('every order has a toggle over the table, and a way to manage them', () => {
    assert.match(HTML, /id="table-orders"[\s\S]{0,600}x-for="o in liturgyOrders"[\s\S]{0,300}toggleTableOrder\(o\.id\)/);
    assert.match(HTML, /href="liturgy-orders\.html"/);
    assert.match(HTML, /<script src="liturgy-order-core\.js"><\/script>[\s\S]*<script src="service-calendar\.js"><\/script>/);
});

test('the liturgy columns are on the table whether or not the Planning view is', () => {
    assert.ok(!/planning-col/.test(SRC + HTML));
});

test('the Planning view is offered only on the table', () => {
    assert.match(HTML, /x-show="view === 'table'"[\s\S]{0,400}planning = !planning/);
});

test('the Directory folds to a rail and the page gives up its width', () => {
    assert.match(HTML, /planning-rail/);
    assert.match(HTML, /planning-wide/);
    assert.match(HTML, /\.planning-wide\s*\{\s*max-width:\s*none/);
});

// ── The Directory drawer ──────────────────────────────────────────────────

test('the rail arrow opens the dates rather than leaving the Planning view', () => {
    // It used to drop you out of the view entirely, which is a heavy answer to
    // "let me glance at the dates".
    assert.match(HTML, /@click="railOpen = !railOpen"/);
    assert.ok(!/@click="planning = false"/.test(HTML),
        'the rail must not carry a leave-the-view button any more');
});

test('the drawer lies over the table instead of pushing it', () => {
    // Pushing would shift every column sideways each time somebody checked a
    // date, which is worse than the problem it solves.
    assert.match(HTML, /\.planning-rail\.rail-open\s*\{[^}]*position:\s*absolute/);
    assert.match(HTML, /\.planning-rail\.rail-open\s*\{[^}]*z-index:\s*50/);
});

test('choosing a date shuts the drawer behind you', () => {
    assert.match(HTML, /@click="if \(isRail\) railOpen = false"/);
});

test('clicking away shuts it too', () => {
    assert.match(HTML, /x-show="isRail && railOpen"[\s\S]{0,120}@click="railOpen = false"/);
});

test('leaving the Planning view puts the drawer away', () => {
    assert.match(SRC, /calendarPlanning[\s\S]{0,400}this\.railOpen = false/);
});

test('the drawer is never remembered across a page load', () => {
    // A glance at the dates is not a state to leave a page in.
    const sb = load();
    assert.ok(/railOpen: false/.test(SRC), 'railOpen should start closed');
    assert.ok(!/calendarRailOpen/.test(SRC), 'and must not be persisted');
});

test('the rail centres its compass by rule, not by luck', () => {
    // justify-between and justify-center on one element is settled by
    // stylesheet order rather than by which class Alpine wrote last — which is
    // exactly how the compass ended up sitting off to one side.
    assert.match(HTML, /\.planning-rail:not\(\.rail-open\) h2 \{ justify-content: center !important; \}/);
});

// Draw the table into a stand-in DOM and hand back the header and the first
// month band, as markup.
function drawTable(sb) {
    const made = [];
    const container = { innerHTML: '', appendChild(n) { made.push(n); } };
    sb.document.getElementById = (id) => (id === 'calendar-table-container' ? container : null);
    sb.document.createElement = () => {
        const n = { className: '', innerHTML: '', dataset: {}, children: [], appendChild(c) { this.children.push(c); } };
        made.push(n);
        return n;
    };
    sb.renderTable({ 2026: { August: [new Date(2026, 7, 16)] } });
    const thead = made.find(n => /<th/.test(n.innerHTML));
    const band = made.find(n => /colspan=/.test(n.innerHTML));
    const dateRow = made.find(n => n.dataset && n.dataset.serviceDate);
    return { thead: thead.innerHTML, band: band.innerHTML, row: dateRow.innerHTML };
}

test('the month separator spans the whole row, however many orders are on', () => {
    // The label sits in the sticky date column; the filler cell carries the
    // rest of the band, so its span is every column but the date.
    assert.match(SRC, /sticky-col-left bg-surface-container-low\/90 backdrop-blur-sm/);
    [['standard'], ['standard', 'communion'], ['communion'], []].forEach(ids => {
        const sb = load();
        sb.setLiturgyCatalog(twoOrderCatalog());
        sb.setTableOrderIds(ids);
        const { thead, band, row } = drawTable(sb);
        const headings = (thead.match(/<th\b/g) || []).length;
        const span = Number(band.match(/colspan="(\d+)"/)[1]);
        assert.strictEqual(span, headings - 1, `band short or long with ${ids.join('+') || 'nothing'} on`);
        assert.strictEqual((row.match(/<td\b/g) || []).length, headings, 'a cell under every heading');
    });
});

test('the header keeps the identity columns and names each element once', () => {
    const sb = load();
    sb.setLiturgyCatalog(twoOrderCatalog());
    sb.setTableOrderIds(['standard', 'communion']);
    const { thead, row } = drawTable(sb);
    const names = Array.from(thead.matchAll(/<th[^>]*>([^<]*)<\/th>/g)).map(m => m[1]);
    assert.deepStrictEqual(names.slice(0, 7),
        ['Date', 'Theme', 'Leader', 'Preacher', 'Music', 'Prayers', 'Prayed For']);
    assert.strictEqual(names[names.length - 1], 'Actions');
    assert.deepStrictEqual(names.slice(7, -1), sb.liturgyColumns().map(c => sb.escapeHtml(c.label)));
    assert.ok(names.includes(sb.escapeHtml('Communion · Lord\'s Supper')), 'a column only Communion uses names Communion');
    assert.ok(names.includes('Hymn of Praise'), 'a shared hymn stays the hymn, with no order in front of it');
    assert.doesNotMatch(row, /liturgy-carrier/,
        'a person is the element\'s own field, not a second line under every row');
});

test('a Sunday fills the element its own order lined up, and leaves the other quiet', () => {
    const sb = load();
    const cat = Liturgy.catalogFrom({
        elements: [
            { id: 'hA', name: 'Hymn', kind: 'hymn' },
            { id: 'hB', name: 'Hymn', kind: 'hymn' },
            { id: 'pA', name: 'Prayer', kind: 'prayer' },
            { id: 'bA', name: 'Baptism', kind: 'person' },
            { id: 'hC', name: 'Hymn', kind: 'hymn' },
            { id: 'pB', name: 'Prayer', kind: 'prayer' },
        ],
        orders: [
            { id: 'liturgy1', name: 'Liturgy 1', elementIds: ['hA', 'hB', 'pA'] },
            { id: 'liturgy2', name: 'Liturgy 2', elementIds: ['bA', 'hC', 'pB'] },
        ],
    });
    sb.setLiturgyCatalog(cat);
    sb.setTableOrderIds(['liturgy1', 'liturgy2']);
    const cols = sb.liturgyColumns();
    const cells = cols.map(c => {
        const classes = new Set();
        return {
            dataset: { column: c.key, element: c.id },
            style: {},
            textContent: '—',
            classList: {
                add(name) { classes.add(name); },
                remove(name) { classes.delete(name); },
                has(name) { return classes.has(name); },
            },
            parentElement: { querySelector() { return null; } },
            classes,
        };
    });
    sb.document.querySelectorAll = () => [{
        dataset: { serviceDate: '2026-08-16' },
        querySelector() { return null; },
        querySelectorAll(sel) { return sel === '.liturgy-cell' ? cells : []; },
    }];
    sb.injectServiceData({
        '2026-08-16': {
            liturgyOrderId: 'liturgy2',
            liturgy: {
                bA: [{ name: 'Ada' }],
                hC: { name: 'Old Hundredth' },
                pB: 'Thanks',
            },
        },
    });
    assert.strictEqual(cells[0].textContent, '—', 'Liturgy 1\'s opening hymn is not this Sunday\'s');
    assert.strictEqual(cells[0].classes.has('liturgy-cell--gap'), true);
    assert.strictEqual(cells[1].textContent, 'Ada');
    assert.strictEqual(cells[1].dataset.element, 'bA');
    assert.strictEqual(cells[2].textContent, 'Old Hundredth');
    assert.strictEqual(cells[2].dataset.element, 'hC', 'the shared hymn column writes Liturgy 2\'s own hymn');
    assert.strictEqual(cells[2].classes.has('liturgy-cell--gap'), false);
    assert.strictEqual(cells[3].textContent, 'Thanks');
});

// ── Writing a slot ────────────────────────────────────────────────────────

test('a liturgy slot is written by path, so nothing else on the Sunday moves', () => {
    // The same rule as MS-243: update() reads 'liturgy.hymn1' as a path to one
    // field. set(merge) would read it as a field NAME containing a dot and
    // build a second liturgy beside the real one.
    assert.match(SRC, /ref\.update\([\s\S]{0,60}\[`liturgy\.\$\{field\}`\]: value/);
});

test('choosing a hymn from the list keeps its id, and typing over it does not', () => {
    // A literal that kept the old id would read as one hymn and print another.
    assert.match(SRC, /chosen && chosen\.name === typed[\s\S]{0,80}\{ id: null, name: typed \}/);
});
