// MS-245 — the Planning view.
//
// The table opened out to every liturgy slot, so a service guide session can
// fill one hymn slot down twelve Sundays instead of opening twelve Sundays one
// at a time.
//
// Two things here are worth pinning against a careless edit later:
//
//   1. The columns come from ONE list. The header, the cell and the editor that
//      opens when you click are all read off PLANNING_COLUMNS, because three
//      hand-kept lists is how a column ends up with a heading and no way to
//      type into it.
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

    vm.createContext(sandbox);
    vm.runInContext(SRC, sandbox, { filename: 'service-calendar.js' });
    // Top-level const/let are lexical bindings, not globals, so the tables come
    // back through the export seam rather than off the sandbox.
    return Object.assign(sandbox, sandbox.module.exports);
}

// ── The columns Jonathan asked for ────────────────────────────────────────

test('every liturgy slot from the ticket has a column', () => {
    const sb = load();
    const fields = sb.PLANNING_COLUMNS.map(c => c.field);

    // Jonathan listed these in the room as Preparatory, Worship Hymn 1, Hymn 2,
    // confession/assurance, Hymn 3, Hymn 4, pastoral prayer, Hymn 5, Hymn 6.
    // He then chose to keep the code's names for them, so these are those.
    [
        'preparatoryHymn',
        'hymn1',
        'hymn2',
        'callToConfession',
        'assuranceOfPardon',
        'hymnMid1',
        'hymnMid2',
        'hymnEnd1',
        'hymnEnd2',
        // Added on review: the pastoral prayer's scripture reference and the
        // benediction's.
        'scriptureReading',
        'benediction',
    ].forEach(f => assert.ok(fields.includes(f), `no column for ${f}`));
});

test('the pastoral prayer reference is its own column, beside the people', () => {
    // The existing Pastoral Prayer column carries the two people prayed for.
    // This one is the scripture reference — a different thing, a different
    // field, and it must not be mistaken for a duplicate and removed.
    const sb = load();
    const col = sb.PLANNING_COLUMNS.find(c => c.field === 'scriptureReading');
    assert.ok(col, 'no column for the pastoral prayer reference');
    assert.match(col.label, /Pastoral Prayer/);
    assert.strictEqual(col.type, 'verse', 'a reference is picked, not typed freehand');
});

test('the columns read left to right in the order the service runs', () => {
    const sb = load();
    const order = sb.PLANNING_COLUMNS.map(c => c.field);
    const pos = f => order.indexOf(f);

    assert.ok(pos('preparatoryHymn') < pos('hymn1'), 'the preparatory hymn opens');
    assert.ok(pos('hymn1') < pos('callToConfession'), 'praise before confession');
    assert.ok(pos('callToConfession') < pos('assuranceOfPardon'), 'the call precedes the assurance');
    assert.ok(pos('assuranceOfPardon') < pos('hymnMid1'));
    assert.ok(pos('hymnMid2') < pos('scriptureReading'), 'the prayer follows the middle hymns');
    assert.ok(pos('scriptureReading') < pos('hymnEnd1'), 'the closing hymns come after');
    assert.ok(pos('benediction') === order.length - 1, 'the benediction sends everyone home');
});

test('the pastoral prayer is not doubled up', () => {
    // The table already carries a Pastoral Prayer column; a second one would be
    // two boxes writing the same two fields.
    const sb = load();
    const fields = sb.PLANNING_COLUMNS.map(c => c.field);
    assert.ok(!fields.includes('prayerMale'));
    assert.ok(!fields.includes('prayerFemale'));
    assert.match(HTML + SRC, /Pastoral Prayer/, 'and it is still there');
});

test('all seven hymn slots are editable as hymns, not as loose text', () => {
    const sb = load();
    // Array.from: the vm builds these with its own Array, so a strict compare
    // against a host-realm literal fails on the prototype alone.
    assert.deepStrictEqual(Array.from(sb.LITURGY_HYMN_FIELDS).sort(), [
        'hymn1', 'hymn2', 'hymnEnd1', 'hymnEnd2', 'hymnMid1', 'hymnMid2', 'preparatoryHymn'
    ]);
});

test('the scripture slots open the verse picker, and so does the sermon', () => {
    const sb = load();
    ['sermon', 'callToConfession', 'assuranceOfPardon'].forEach(f =>
        assert.ok(sb.LITURGY_VERSE_FIELDS.includes(f), `${f} should use the verse picker`));
});

test('no column is both a hymn and a scripture', () => {
    const sb = load();
    const both = Array.from(sb.LITURGY_HYMN_FIELDS).filter(f => sb.LITURGY_VERSE_FIELDS.includes(f));
    assert.deepStrictEqual(both, []);
});

test('one list drives the header, the cell and the editor', () => {
    // If a column is ever added by hand to the header without joining this
    // list, it gets a heading and no way to type into it.
    const sb = load();
    sb.PLANNING_COLUMNS.forEach(c => {
        assert.ok(c.label, 'a column needs a heading');
        assert.ok(c.cell, 'a column needs a cell class to be filled through');
        assert.ok(c.field, 'a column needs a liturgy field to write');
        assert.ok(['hymn', 'verse'].includes(c.type), `${c.field} has no editor type`);
    });

    const classes = sb.PLANNING_COLUMNS.map(c => c.cell);
    assert.strictEqual(new Set(classes).size, classes.length, 'cell classes must be distinct');
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

test('the liturgy columns are hidden until the Planning view is on', () => {
    // They live in the markup either way, so turning the view on is a class
    // rather than a re-render — a re-render would take away the box somebody
    // was typing in.
    assert.match(HTML, /\.planning-col\s*\{\s*display:\s*none/);
    assert.match(HTML, /\.planning-mode\s+\.planning-col\s*\{\s*display:\s*table-cell/);
    assert.match(SRC, /planning-col/, 'the cells must carry the class');
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

test('the month separator still spans the whole row', () => {
    // A hard-coded colspan would leave the month heading short by nine columns
    // the moment the Planning view opened.
    assert.match(SRC, /colspan="\$\{10 \+ PLANNING_COLUMNS\.length\}"/);
});

// ── Writing a slot ────────────────────────────────────────────────────────

test('a liturgy slot is written by path, so nothing else on the Sunday moves', () => {
    // The same rule as MS-243: update() reads 'liturgy.hymn1' as a path to one
    // field. set(merge) would read it as a field NAME containing a dot and
    // build a second liturgy beside the real one.
    assert.match(SRC, /await ref\.update\(\{ \[`liturgy\.\$\{field\}`\]: value/);
});

test('choosing a hymn from the list keeps its id, and typing over it does not', () => {
    // A literal that kept the old id would read as one hymn and print another.
    assert.match(SRC, /chosen && chosen\.name === typed[\s\S]{0,80}\{ id: null, name: typed \}/);
});
