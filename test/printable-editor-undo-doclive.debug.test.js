const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// Debug harness (MS-721 undo regression): simulates Printable editor history
// + DocLive adopt without Firebase login. Writes NDJSON to
// /opt/cursor/logs/debug.log (or TMPDIR fallback).

const LOG = process.env.UNDO_DEBUG_LOG
    || (fs.existsSync('/opt/cursor/logs')
        ? '/opt/cursor/logs/debug.log'
        : path.join(os.tmpdir(), 'printable-undo-debug.log'));

const PrintableCore = require('../public/printable-core.js');
const DocLive = require('../public/doc-live-core.js');
global.PrintableCore = PrintableCore;
global.DocLive = DocLive;

function clearLog() {
    try { fs.mkdirSync(path.dirname(LOG), { recursive: true }); } catch (e) { /* ok */ }
    try { fs.writeFileSync(LOG, ''); } catch (e) { /* ok */ }
}

function installLogWriter() {
    global.__UNDO_DEBUG_LOGS = [];
    global.__undoDebugWrite = (payload) => {
        fs.appendFileSync(LOG, JSON.stringify(payload) + '\n');
    };
}

function readLog() {
    try {
        return fs.readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
    } catch (e) {
        return [];
    }
}

function loadEditor() {
    const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'printable-editor.js'), 'utf8');
    const win = {
        location: { search: '?id=p1', href: '' },
        localStorage: { getItem: () => null, setItem() {} },
        addEventListener() {},
        removeEventListener() {},
    };
    const windowProxy = new Proxy(win, {
        get: (t, k) => (k in t ? t[k] : undefined),
    });
    global.window = windowProxy;
    global.document = {
        getElementById: () => null,
        querySelector: () => null,
        activeElement: { tagName: 'BODY', isContentEditable: false, closest: () => null },
        createElement: () => ({
            style: {}, classList: { add() {}, remove() {}, toggle() {} },
            appendChild() {}, setAttribute() {}, addEventListener() {},
        }),
    };
    return new Function('window', src + '; return printableEditor;')(windowProxy)();
}

function bootEditor(text) {
    const pe = loadEditor();
    const built = PrintableCore.buildPrintable({
        name: 'Undo probe',
        template: { paper: 'letter' },
        pages: [{
            id: 'pg1',
            nodes: [{ id: 'n1', tag: 'p', text: text, style: {}, attrs: {}, children: [] }],
        }],
    });
    pe.project = Object.assign(
        { id: 'p1', createdAt: null, createdBy: null, createdByName: null },
        built,
    );
    pe.selection = { pageId: 'pg1', nodeId: null };
    pe.loading = false;
    pe.canEdit = true;
    pe.permissionLevel = 'editor';
    pe.problem = '';
    pe.saveStatus = 'saved';
    pe.changedElsewhere = false;
    pe.renaming = false;
    pe.saving = false;
    pe._saveTimer = null;
    pe.id = 'p1';
    pe.renderAll = () => {};
    pe.readProps = () => {};
    pe.fitToView = () => {};
    pe.mount = () => {};
    // Avoid the 1.5s autosave timer hitting missing Firebase/AccessCore stubs.
    pe.save = async () => {};
    // Seed history the way init() does, then attach DocLive (no MosaicLiveRead → no watch).
    pe.adoptPrintable(PrintableCore.buildPrintable(pe.project));
    pe.startLive(Object.assign({ id: 'p1' }, PrintableCore.buildPrintable(pe.project)));
    return pe;
}

function settle(pe) {
    if (pe && pe._saveTimer) clearTimeout(pe._saveTimer);
}

function nodeText(pe) {
    return pe.project.pages[0].nodes[0].text;
}

function simulateOwnSave(pe) {
    const written = JSON.parse(JSON.stringify(pe.project));
    const ticket = pe._live.saving();
    pe._live.saved(ticket, written);
    const storeRecord = PrintableCore.buildPrintable(written);
    const echo = Object.assign({}, storeRecord, {
        updatedAt: { seconds: 99 },
        updatedByName: 'probe',
        createdAt: null,
        createdBy: null,
        createdByName: null,
    });
    return { written, echo, result: pe._live.remote(echo, { pendingWrites: false }) };
}

clearLog();
installLogWriter();

test('H1 control: matching save echo keeps undo', () => {
    installLogWriter();
    const pe = bootEditor('A');
    try {
        pe.project.pages[0].nodes[0].text = 'B';
        pe.commit();
        const { result } = simulateOwnSave(pe);
        assert.equal(result, 'ignored');
        assert.equal(nodeText(pe), 'B');
        pe.undo();
        assert.equal(nodeText(pe), 'A', 'undo must restore pre-edit text after a matching echo');
        const logs = readLog();
        assert.ok(logs.some((l) => l.message === 'DocLive.remote' && l.data && l.data.result === 'ignored'));
        assert.ok(logs.some((l) => l.message === 'undo() → restore'));
    } finally {
        settle(pe);
    }
});

test('H1 mechanism: fingerprint-mismatched adopt wipes history so undo is a no-op', () => {
    installLogWriter();
    const pe = bootEditor('A');
    try {
        pe.project.pages[0].nodes[0].text = 'B';
        pe.commit();
        const written = JSON.parse(JSON.stringify(pe.project));
        const ticket = pe._live.saving();
        pe._live.saved(ticket, written);
        // Remote copy that buildPrintable still accepts but fingerprints differently
        // (bookletExport flips). This is the DocLive adopt-when-clean path.
        const echoBad = PrintableCore.buildPrintable(written);
        echoBad.bookletExport = true;
        const result = pe._live.remote(echoBad, { pendingWrites: false });
        assert.equal(result, 'adopted');
        assert.equal(nodeText(pe), 'B');
        pe.undo();
        assert.equal(nodeText(pe), 'B', 'undo is a no-op after adoptPrintable resets history');
        const logs = readLog();
        assert.ok(logs.some((l) => l.message === 'DocLive.remote' && l.data && l.data.result === 'adopted'));
        assert.ok(logs.some((l) => l.message === 'adoptPrintable() wiping history'));
        assert.ok(logs.some((l) => l.message === 'undo() early return' && l.data && l.data.historyLen === 1));
        assert.ok(logs.some((l) => l.message === 'commit()' && l.data && l.data.historyLenAfter >= 2));
    } finally {
        settle(pe);
    }
});

test('H2: commit() pushes a new history entry for a real edit', () => {
    installLogWriter();
    const pe = bootEditor('A');
    try {
        pe.project.pages[0].nodes[0].text = 'edited';
        pe.commit();
        const logs = readLog().filter((l) => l.message === 'commit()');
        const last = logs[logs.length - 1];
        assert.ok(last);
        assert.equal(last.data.pushed, true);
        assert.ok(last.data.historyLenAfter >= 2);
    } finally {
        settle(pe);
    }
});

test('H3: restore() calls touch() (marks edited / schedules save)', () => {
    installLogWriter();
    const pe = bootEditor('A');
    try {
        pe.project.pages[0].nodes[0].text = 'B';
        pe.commit();
        pe.undo();
        const logs = readLog();
        assert.ok(logs.some((l) => l.message === 'restore() → touch()'));
        assert.ok(logs.some((l) => l.message === 'touch()' && l.hypothesisId === 'H3'));
    } finally {
        settle(pe);
    }
});
