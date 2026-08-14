// MS-244 — the Service Calendar keeps up with the room.
//
// The calendar used to read every Service once, when the page opened, and never
// look again. That is fine for one person checking next Sunday and useless for
// a service guide session, where a dozen men fill in Sundays side by side: you
// cannot see the work happening next to you, so two people pick up the same
// Sunday because neither can tell the other already has it.
//
// So it listens now. Which introduces the opposite hazard — a snapshot landing
// while somebody is halfway through typing a hymn, reaching in and rewriting
// the box under their hands. The guard is that every inline editor on this page
// hides its cell and puts an input in its place, so a hidden cell IS someone
// editing, and no separate register of who-has-what can drift out of step with
// what is actually on screen.
//
// Loaded the way the other page tests load theirs: the real file, in a sandbox,
// with the browser edges stubbed.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PUBLIC = path.join(__dirname, '..', 'public');

// A Firestore stand-in that hands back the snapshot callback rather than any
// data, so a test can decide when a change arrives and what is in it.
function fakeDb() {
    const listeners = [];
    let getCalls = 0;
    return {
        listeners,
        get getCalls() { return getCalls; },
        collection(name) {
            return {
                name,
                get() { getCalls++; return Promise.resolve({ forEach() {} }); },
                onSnapshot(onNext, onError) {
                    listeners.push({ name, onNext, onError });
                    return () => {};
                }
            };
        },
        // Deliver a snapshot to every listener. `docs` is {id: data}.
        emit(docs) {
            const snapshot = {
                forEach(fn) {
                    for (const [id, data] of Object.entries(docs)) {
                        fn({ id, data: () => data });
                    }
                }
            };
            listeners.forEach(l => l.onNext(snapshot));
        }
    };
}

function load(overrides) {
    const sandbox = {
        console: { log() {}, warn() {}, error() {} },
        setTimeout(fn) { return 0; },
        clearTimeout() {}, setInterval() {}, clearInterval() {},
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
        addEventListener() {},
        getElementById() { return null; },
        querySelector() { return null; },
        querySelectorAll() { return []; },
        createElement() { return { classList: { add() {}, contains: () => false }, style: {}, setAttribute() {}, appendChild() {} }; },
        body: { classList: { contains: () => false } },
    };
    sandbox.DateUtils = require('../public/date-utils.js');
    Object.assign(sandbox, overrides || {});

    vm.createContext(sandbox);
    vm.runInContext(
        fs.readFileSync(path.join(PUBLIC, 'service-calendar.js'), 'utf8'),
        sandbox, { filename: 'service-calendar.js' });
    return sandbox;
}

// A cell, near enough: the inline editors only ever touch style, textContent,
// classList, title and the odd attribute.
function cell(overrides = {}) {
    return Object.assign({
        style: {},
        textContent: '',
        classList: { add() {}, remove() {}, contains: () => false },
        setAttribute() {},
        querySelectorAll: () => [],
    }, overrides);
}

// ── It listens rather than looking once ───────────────────────────────────

test('the calendar subscribes to services instead of reading them once', async () => {
    const db = fakeDb();
    const sb = load({ db });

    const pending = sb.loadServiceData();
    db.emit({});
    await pending;

    assert.strictEqual(db.listeners.length, 1, 'expected exactly one listener');
    assert.strictEqual(db.listeners[0].name, 'services');
    assert.strictEqual(db.getCalls, 0, 'a one-shot get() is the bug this replaces');
});

test('the first snapshot is what the initial load waits for', async () => {
    const db = fakeDb();
    const sb = load({ db });

    let settled = false;
    const pending = sb.loadServiceData().then(() => { settled = true; });

    await Promise.resolve();
    assert.strictEqual(settled, false, 'must not resolve before any data arrives');

    db.emit({ '2026-08-16': { theme: 'Grace' } });
    await pending;
    assert.strictEqual(settled, true, 'the first snapshot should settle the load');
});

// A rendered row, near enough for injectServiceData to walk.
function row(dateKey, cells) {
    return {
        dataset: { serviceDate: dateKey },
        querySelector(sel) { return cells[sel] || null; },
    };
}

test("someone else's edit reaches your screen without a reload", async () => {
    const themeCell = cell({ textContent: '—' });
    const db = fakeDb();
    const sb = load({ db });
    sb.document.querySelectorAll = () => [row('2026-08-16', { '.theme-cell': themeCell })];

    const pending = sb.loadServiceData();
    db.emit({ '2026-08-16': { theme: 'Grace' } });
    await pending;
    assert.strictEqual(themeCell.textContent, 'Grace');

    // The whole point: a SECOND change, with nobody touching this page.
    db.emit({ '2026-08-16': { theme: 'Mercy' } });
    assert.strictEqual(themeCell.textContent, 'Mercy',
        'a later snapshot must reach the screen too, not just the first');
});

test('a Sunday emptied upstream goes back to a dash', async () => {
    const themeCell = cell({ textContent: '—' });
    const db = fakeDb();
    const sb = load({ db });
    sb.document.querySelectorAll = () => [row('2026-08-16', { '.theme-cell': themeCell })];

    const pending = sb.loadServiceData();
    db.emit({ '2026-08-16': { theme: 'Grace' } });
    await pending;

    db.emit({});
    assert.strictEqual(themeCell.textContent, '—');
});

test('a live snapshot does not reach into the box you are typing in', async () => {
    // The cell is hidden because its editor is open — see setupInlineEdit.
    const busy = cell({ textContent: 'Grace', style: { display: 'none' } });
    const idle = cell({ textContent: '—' });
    const db = fakeDb();
    const sb = load({ db });
    sb.document.querySelectorAll = () => [row('2026-08-16', {
        '.theme-cell': busy,
        '.sermon-cell': idle,
    })];

    const pending = sb.loadServiceData();
    db.emit({ '2026-08-16': { theme: 'Mercy', liturgy: { sermon: 'Romans 8' } } });
    await pending;

    assert.strictEqual(busy.textContent, 'Grace', 'your open box must hold still');
    assert.strictEqual(idle.textContent, 'Romans 8', 'every other cell still updates');
});

test('a listener that errors is dropped, so a later call can try again', async () => {
    const db = fakeDb();
    const sb = load({ db });

    const pending = sb.loadServiceData();
    db.listeners[0].onError(new Error('permission-denied'));
    await pending;

    const again = sb.loadServiceData();
    db.emit({});
    await again;

    assert.strictEqual(db.listeners.length, 2, 'a dead subscription must not be kept');
});

// ── It does not type over you ─────────────────────────────────────────────

test('a hidden cell is read as one somebody is editing', () => {
    const sb = load({ db: fakeDb() });
    assert.strictEqual(sb.isCellBeingEdited(cell({ style: { display: 'none' } })), true);
    assert.strictEqual(sb.isCellBeingEdited(cell({ style: { display: '' } })), false);
    assert.strictEqual(sb.isCellBeingEdited(null), false);
});

test('a snapshot rewrites an idle cell', () => {
    const sb = load({ db: fakeDb() });
    const c = cell({ textContent: 'Old Hymn' });

    assert.strictEqual(sb.setCellText(c, 'New Hymn'), true);
    assert.strictEqual(c.textContent, 'New Hymn');
});

test('a snapshot leaves the box you are typing in alone', () => {
    const sb = load({ db: fakeDb() });
    // setupInlineEdit hides the cell and puts an input in its place.
    const c = cell({ textContent: 'Come Thou Fount', style: { display: 'none' } });

    assert.strictEqual(sb.setCellText(c, 'It Is Well'), false);
    assert.strictEqual(c.textContent, 'Come Thou Fount',
        'the value under an open editor must not move');
});

test("a person's id is held back with their name, so a cell never half-updates", () => {
    // The id travels with the name. Writing one without the other would leave
    // a cell reading one person and linking to another.
    const sb = load({ db: fakeDb() });
    const busy = cell({ style: { display: 'none' } });
    assert.strictEqual(sb.setCellText(busy, 'Bill Smith'), false,
        'false is the signal the caller uses to skip the id too');
});

test('a cell rebuilt wholesale is left whole while any part of it is edited', () => {
    const sb = load({ db: fakeDb() });
    const editing = cell({ style: { display: 'none' } });
    const idle = cell({ style: {} });

    const container = { querySelectorAll: () => [idle, editing] };
    assert.strictEqual(sb.hasEditorOpen(container), true,
        'innerHTML = "" here would delete the box being typed in');

    assert.strictEqual(sb.hasEditorOpen({ querySelectorAll: () => [idle] }), false);
    assert.strictEqual(sb.hasEditorOpen(null), false);
});

// ── Legacy dotted keys still fold back ────────────────────────────────────

test('a legacy dotted key is still folded into its nested shape', () => {
    const sb = load({ db: fakeDb() });
    const out = sb.normalizeServiceDoc({ 'liturgy.sermon': 'Romans 8', theme: 'Grace' });

    assert.strictEqual(out.liturgy.sermon, 'Romans 8');
    assert.strictEqual(out.theme, 'Grace');
    assert.ok(!('liturgy.sermon' in out));
});

test('a properly nested value wins over the legacy dotted one', () => {
    const sb = load({ db: fakeDb() });
    const out = sb.normalizeServiceDoc({
        liturgy: { sermon: 'John 1' },
        'liturgy.sermon': 'Romans 8'
    });
    assert.strictEqual(out.liturgy.sermon, 'John 1');
});

// ── Assigned travels the same way ─────────────────────────────────────────

test('someone else assigning a Sunday shows up on your screen', async () => {
    // Assigned is a field on the Service, and the badge is drawn by
    // injectServiceData, so it rides the same listener as everything else.
    // Pinned because it is the sort of thing that only APPEARS to work: the
    // first person to try it sees their own write and assumes the room does.
    const btn = cell({ innerHTML: '' });
    const db = fakeDb();
    const sb = load({ PersonPhotoCore: require('../public/person-photo-core.js') });
    sb.db = db;
    // An editor: the empty badge is an invitation, and only they get one.
    sb.document.body = { classList: { contains: (c) => c === 'can-edit' } };
    sb.document.querySelectorAll = () => [row('2026-08-16', { '.assigned-btn': btn })];

    const pending = sb.loadServiceData();
    db.emit({ '2026-08-16': {} });
    await pending;
    assert.match(btn.innerHTML, /person_add/, 'starts unassigned');

    // Another editor, on another machine, picks somebody.
    db.emit({ '2026-08-16': { assignedWriter: { id: 'p-1', name: 'Bill Smith' } } });

    assert.match(btn.innerHTML, />BS</, 'their initials should arrive without a reload');
    assert.match(btn.title, /Bill Smith is writing this Sunday/);
});

test('un-assigning travels too', async () => {
    const btn = cell({ innerHTML: '' });
    const db = fakeDb();
    const sb = load({ PersonPhotoCore: require('../public/person-photo-core.js') });
    sb.db = db;
    // An editor: the empty badge is an invitation, and only they get one.
    sb.document.body = { classList: { contains: (c) => c === 'can-edit' } };
    sb.document.querySelectorAll = () => [row('2026-08-16', { '.assigned-btn': btn })];

    const pending = sb.loadServiceData();
    db.emit({ '2026-08-16': { assignedWriter: { id: 'p-1', name: 'Bill Smith' } } });
    await pending;

    db.emit({ '2026-08-16': { assignedWriter: null } });
    assert.match(btn.innerHTML, /person_add/, 'the badge should go back to empty');
});
