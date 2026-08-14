// Autosave on the page editors (Order of Service, both Service Guide editors).
//
// These pages used to wait for a Save button. Now they write themselves a
// beat after the last edit, and the button only means "write it now". What is
// worth pinning is not that a timer exists but the three things that make an
// autosave safe to leave running:
//
//   1. it coalesces — a burst of typing is one write, not one write per key;
//   2. pressing Save cancels the pending timer, so you never get two writes;
//   3. it re-checks that something actually changed before writing, because
//      saving the Order of Service edits the very object the watcher watches,
//      and without that check the page would save itself forever.
//
// The components are loaded the way the calendar page tests load theirs: the
// real file, in a sandbox, with the browser edges stubbed. Timers are ours, so
// "1.5 seconds later" is a function call rather than a wait.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PUBLIC = path.join(__dirname, '..', 'public');

// A clock the test drives. Mirrors setTimeout/clearTimeout closely enough for
// a debounce: last-one-wins, cancellable, and fired by hand.
function fakeClock() {
    const timers = new Map();
    let nextId = 1;
    return {
        setTimeout(fn, delay) {
            const id = nextId++;
            timers.set(id, { fn, delay });
            return id;
        },
        clearTimeout(id) { timers.delete(id); },
        get pending() { return timers.size; },
        delays() { return [...timers.values()].map(t => t.delay); },
        // Fire everything still armed, the way the browser would once the
        // debounce elapses with no further edits.
        async runAll() {
            const due = [...timers.values()];
            timers.clear();
            for (const t of due) await t.fn();
        },
    };
}

function loadComponent(scriptFile, factoryName, overrides) {
    const clock = fakeClock();
    const sandbox = {
        console: { log() {}, warn() {}, error() {} },
        setTimeout: clock.setTimeout,
        clearTimeout: clock.clearTimeout,
        setInterval() {}, clearInterval() {},
        Promise, Date, Object, Array, Math, String, Number, JSON, Set, Map,
        encodeURIComponent, URLSearchParams,
        module: { exports: {} },
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    sandbox.location = { search: '?date=2026-08-16', href: '' };
    sandbox.auth = { onAuthStateChanged() {} };
    sandbox.getUserData = async () => ({});
    sandbox.db = {};
    sandbox.document = { addEventListener() {}, getElementById() { return null; } };
    sandbox.DateUtils = require('../public/date-utils.js');
    sandbox.GuideStore = require('../public/guide-store.js');
    Object.assign(sandbox, overrides || {});

    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(PUBLIC, scriptFile), 'utf8'), sandbox, { filename: scriptFile });

    assert.strictEqual(typeof sandbox[factoryName], 'function',
        scriptFile + ' does not define ' + factoryName);

    const page = sandbox[factoryName]();
    page.$watch = () => {};
    page.$nextTick = fn => fn();
    page.$refs = {};
    return { page, clock };
}

// ── The Order of Service ─────────────────────────────────────────────────────

function orderOfService() {
    const { page, clock } = loadComponent('service-builder.js', 'serviceForm');
    page.canEdit = true;
    page.date = '2026-08-16';
    // Saved state and current state agree: nothing to write.
    page.originalService = JSON.stringify(page.service);
    const writes = [];
    page.save = async function (manual) {
        writes.push({ manual: !!manual });
        this.originalService = JSON.stringify(this.service);
    };
    return { page, clock, writes };
}

test('a burst of typing is one write, not one per keystroke', async () => {
    const { page, clock, writes } = orderOfService();
    page.service.theme = 'The Heavenly Prince';

    page.scheduleSave();
    page.scheduleSave();
    page.scheduleSave();

    assert.strictEqual(clock.pending, 1, 'each edit should replace the pending save, not add one');
    await clock.runAll();
    assert.strictEqual(writes.length, 1);
});

test('the Order of Service waits longer than the other editors', () => {
    const { page, clock } = orderOfService();
    page.service.theme = 'changed';
    page.scheduleSave();
    // This save also settles who served and re-runs fairness, so it is
    // deliberately slower off the mark than the 1.5s used elsewhere.
    assert.deepStrictEqual(clock.delays(), [3000]);
});

test('a Sunday nobody has touched is never written back', async () => {
    const { page, clock, writes } = orderOfService();

    page.scheduleSave();            // armed, but nothing actually changed
    await clock.runAll();

    assert.strictEqual(writes.length, 0,
        'opening a Sunday must not save it — that is what would make every page view a write');
});

test('the save that follows a save stops, instead of looping', async () => {
    const { page, clock, writes } = orderOfService();
    page.service.theme = 'The Heavenly Prince';

    page.scheduleSave();
    await clock.runAll();
    assert.strictEqual(writes.length, 1);

    // Saving rewrites parts of `service`, which trips the watcher again. That
    // second pass must find nothing owed and stop.
    page.scheduleSave();
    await clock.runAll();
    assert.strictEqual(writes.length, 1, 'the watcher fired by our own save must not save again');
});

test('a save already in flight does not arm another', () => {
    const { page, clock } = orderOfService();
    page.service.theme = 'changed';
    page.saving = true;

    page.scheduleSave();

    assert.strictEqual(clock.pending, 0);
});

test('a viewer never autosaves', () => {
    const { page, clock } = orderOfService();
    page.canEdit = false;
    page.service.theme = 'changed';

    page.scheduleSave();

    assert.strictEqual(clock.pending, 0);
});

test('pressing Save cancels the pending autosave, so the write happens once', async () => {
    // The real save() here, not the stub — it is the one that clears the timer.
    const { page, clock } = loadComponent('service-builder.js', 'serviceForm');
    page.canEdit = true;
    page.date = '2026-08-16';
    page.originalService = JSON.stringify(page.service);
    page.service.theme = 'changed';

    page.scheduleSave();
    assert.strictEqual(clock.pending, 1);

    // save() clears the timer before anything else. It then fails against the
    // stubbed db, which is fine — the timer is the subject here.
    try { await page.save(true); } catch { /* no Firestore in a sandbox */ }

    assert.strictEqual(clock.pending, 0, 'a manual save must disarm the pending one');
});

test('a save that fails does not queue itself again', async () => {
    // Otherwise a Sunday you have no permission to save asks Firestore again
    // every three seconds for as long as the tab is open.
    const { page, clock } = loadComponent('service-builder.js', 'serviceForm');
    page.canEdit = true;
    page.date = '2026-08-16';
    page.originalService = JSON.stringify(page.service);
    page.service.theme = 'changed';

    try { await page.save(true); } catch { /* the stubbed db has no batch() */ }

    assert.ok(page.isDirty, 'the edit is still owed');
    assert.strictEqual(clock.pending, 0, 'but nothing is armed to retry it on a timer');
});

// ── The Service Guide editor (v2) ────────────────────────────────────────────

test('the guide editor waits 1.5s, the house debounce', () => {
    const { page, clock } = loadComponent('service-guide-editor.js', 'guideEditorV2');
    page.permissionLevel = 'editor';
    page.snapshot = { pages: [] };

    page.scheduleSave();

    assert.deepStrictEqual(clock.delays(), [1500]);
    assert.strictEqual(page.saveStatus, 'unsaved');
});

test('the guide editor does not autosave before a template is loaded', () => {
    const { page, clock } = loadComponent('service-guide-editor.js', 'guideEditorV2');
    page.permissionLevel = 'editor';
    page.snapshot = null;

    page.scheduleSave();

    assert.strictEqual(clock.pending, 0);
});

test('a viewer cannot autosave the guide', () => {
    const { page, clock } = loadComponent('service-guide-editor.js', 'guideEditorV2');
    page.permissionLevel = 'viewer';
    page.snapshot = { pages: [] };

    page.scheduleSave();

    assert.strictEqual(clock.pending, 0);
});

// ── The legacy Service Guide ─────────────────────────────────────────────────

test('the legacy guide editor debounces on the same 1.5s', () => {
    const { page, clock } = loadComponent('service-guide.js', 'guideEditor');

    page.scheduleSave();
    page.scheduleSave();

    assert.deepStrictEqual(clock.delays(), [1500]);
    assert.strictEqual(page.saveStatus, 'unsaved');
});
