const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Printable editor undo vs DocLive adopt (MS-721): a remote copy that does
// not change pages/inputs must leave the undo stack alone.

const PrintableCore = require('../public/printable-core.js');
const DocLive = require('../public/doc-live-core.js');
global.PrintableCore = PrintableCore;
global.DocLive = DocLive;

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
    pe.save = async () => {};
    const record = Object.assign({ id: 'p1' }, PrintableCore.buildPrintable(pe.project));
    pe.startLive(record);
    // init() sets history to [snapshot()] before edits. commit() on an empty
    // stack pushes the current snapshot the same way; then re-load DocLive so
    // that seed is not left as an unsaved edit.
    pe.commit();
    settle(pe);
    pe._live.loaded(record);
    pe.saveStatus = 'saved';
    return pe;
}

function settle(pe) {
    if (pe && pe._saveTimer) clearTimeout(pe._saveTimer);
}

function nodeText(pe) {
    return pe.project.pages[0].nodes[0].text;
}

test('edit+commit grows history; matching DocLive echo leaves undo working', () => {
    const pe = bootEditor('A');
    try {
        pe.project.pages[0].nodes[0].text = 'B';
        pe.commit();

        const written = JSON.parse(JSON.stringify(pe.project));
        const ticket = pe._live.saving();
        pe._live.saved(ticket, written);
        const echo = Object.assign({}, PrintableCore.buildPrintable(written), {
            updatedAt: { seconds: 99 },
            updatedByName: 'probe',
            createdAt: null,
            createdBy: null,
            createdByName: null,
        });
        assert.equal(pe._live.remote(echo, { pendingWrites: false }), 'ignored');

        assert.equal(nodeText(pe), 'B');
        pe.undo();
        assert.equal(nodeText(pe), 'A');
    } finally {
        settle(pe);
    }
});

test('fingerprint-mismatched adopt with the same pages/inputs preserves undo', () => {
    const pe = bootEditor('A');
    try {
        pe.project.pages[0].nodes[0].text = 'B';
        pe.commit();

        const written = JSON.parse(JSON.stringify(pe.project));
        const ticket = pe._live.saving();
        pe._live.saved(ticket, written);

        // Same pages/inputs, different whole-document fingerprint (bookletExport).
        const echoBad = PrintableCore.buildPrintable(written);
        echoBad.bookletExport = true;
        assert.equal(pe._live.remote(echoBad, { pendingWrites: false }), 'adopted');
        assert.equal(pe.project.bookletExport, true);
        assert.equal(nodeText(pe), 'B');

        pe.undo();
        assert.equal(nodeText(pe), 'A', 'undo must survive a no-op pages/inputs adopt');
    } finally {
        settle(pe);
    }
});

test('a truly different remote while clean resets history so undo cannot revive the old edit', () => {
    const pe = bootEditor('A');
    try {
        pe.project.pages[0].nodes[0].text = 'B';
        pe.commit();

        const written = JSON.parse(JSON.stringify(pe.project));
        const ticket = pe._live.saving();
        pe._live.saved(ticket, written);

        const theirs = PrintableCore.buildPrintable(written);
        theirs.pages[0].nodes[0].text = 'Theirs';
        assert.equal(pe._live.remote(theirs, { pendingWrites: false }), 'adopted');
        assert.equal(nodeText(pe), 'Theirs');

        pe.undo();
        assert.equal(nodeText(pe), 'Theirs', 'history was reset; undo is a no-op');
    } finally {
        settle(pe);
    }
});
