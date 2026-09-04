const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// MS-392 — the Printables library.
//
// The page is loaded in a sandbox and exercised against the code it ships
// with, the way forms-library-folders.test.js drives the Forms library. What is
// pinned is the behaviour a folder tree gets wrong quietly — which rows a
// folder shows, whether a search still reaches every one of them, the count
// somebody is shown before they delete a folder — and the two things this
// library adds: a copy gets a name of its own, and a project is never lost.

const ROOT = path.join(__dirname, '..');

function loadLibrary(printables, folders) {
    const sandbox = {
        console, Promise, Date, Object, Array, Math, String, Number, JSON,
        Set, Map, encodeURIComponent, URLSearchParams, setTimeout, clearTimeout,
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    sandbox.location = { search: '', href: 'https://x/printables.html', pathname: '/printables.html' };
    sandbox.document = { getElementById: () => null };
    sandbox.FilingCore = require('../public/filing-core.js');
    sandbox.PrintableCore = require('../public/printable-core.js');

    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'public', 'printables.js'), 'utf8'), sandbox);

    const page = sandbox.printablesPage();
    page.$nextTick = (fn) => fn && fn();
    page.loading = false;
    page.printables = printables;
    page.folders = folders;
    return page;
}

// Members' meetings/ → 2026/ , Sundays/ , and one unfiled printable.
const LIBRARY = () => ({
    folders: [
        { id: 'meetings', name: 'Members\' meetings', parentId: null },
        { id: 'y2026', name: '2026', parentId: 'meetings' },
        { id: 'sundays', name: 'Sundays', parentId: null },
    ],
    printables: [
        printable('p_dir', 'Membership directory', 'y2026', 3),
        printable('p_guide', 'Service guide', 'sundays', 4),
        printable('p_flyer', 'Harvest flyer', null, 0),
    ],
});

function printable(id, name, folderId, pages) {
    return {
        id, name, folderId,
        template: pages ? { label: 'Letter · landscape · 150 dpi' } : null,
        pages: Array.from({ length: pages }, (_, i) => ({ id: 'pg' + i })),
    };
}

const names = rows => rows.map(r => r.name);

// ── What a folder shows ──────────────────────────────────────────────────────

test('the top level shows the top-level folders and the unfiled printables', () => {
    const { printables, folders } = LIBRARY();
    const page = loadLibrary(printables, folders);
    assert.deepEqual(names(page.visibleFolders), ['Members\' meetings', 'Sundays']);
    assert.deepEqual(names(page.visible), ['Harvest flyer']);
});

test('opening a folder shows what is in it, and not what is below that', () => {
    const { printables, folders } = LIBRARY();
    const page = loadLibrary(printables, folders);
    page.openFolder('meetings');
    assert.deepEqual(names(page.visibleFolders), ['2026']);
    assert.deepEqual(page.visible, [], 'the directory is one level down');
    page.openFolder('y2026');
    assert.deepEqual(names(page.visible), ['Membership directory']);
});

test('the breadcrumb says where you are', () => {
    const { printables, folders } = LIBRARY();
    const page = loadLibrary(printables, folders);
    page.openFolder('y2026');
    assert.deepEqual(page.breadcrumb.map(c => c.name), ['Members\' meetings', '2026']);
});

// ── A printable is never lost ────────────────────────────────────────────────

test('a printable whose folder has gone comes back to the top level', () => {
    const { printables, folders } = LIBRARY();
    printables.push(printable('p_lost', 'Lost handout', 'a_folder_nobody_has', 1));
    const page = loadLibrary(printables, folders);
    assert.ok(names(page.visible).includes('Lost handout'),
        'a printable pointing at a missing folder disappeared from the library');
});

// ── Search ───────────────────────────────────────────────────────────────────

test('search reaches every folder and says where each hit was found', () => {
    const { printables, folders } = LIBRARY();
    const page = loadLibrary(printables, folders);
    page.openFolder('sundays');
    page.search = 'directory';
    assert.deepEqual(names(page.visible), ['Membership directory']);
    assert.equal(page.pathFor(page.visible[0]), 'Members\' meetings / 2026');
    assert.equal(page.pathFor(printables[2]), 'Printables');
    assert.deepEqual(page.visibleFolders, [], 'folders are not listed beside search results');
});

// ── What a row says ──────────────────────────────────────────────────────────

test('a row says which paper it is on and how far it has grown', () => {
    const { printables, folders } = LIBRARY();
    const page = loadLibrary(printables, folders);
    assert.equal(page.subFor(printables[0]), 'Letter · landscape · 150 dpi · 3 pages');
    assert.equal(page.subFor(printables[2]), 'Not started',
        'a project nobody has opened says so rather than "0 pages"');
});

test('a folder row counts what is under it, so one holding only folders is not empty', () => {
    const { printables, folders } = LIBRARY();
    const page = loadLibrary(printables, folders);
    assert.equal(page.folderSub(folders[0]), '1 folder · 1 printable');
});

// ── Deleting ─────────────────────────────────────────────────────────────────

test('deleting a folder names how many printables go with it, at every depth', () => {
    const { printables, folders } = LIBRARY();
    const page = loadLibrary(printables, folders);
    page.startDeleteFolder(folders[0]);
    assert.equal(page.deletingCount, 1);
    assert.match(page.deleteLine, /One printable goes with it/);
    assert.match(page.deleteLine, /cannot be undone/);
});

// ── Moving ───────────────────────────────────────────────────────────────────

test('a row only lights up for a drop that would actually be allowed', () => {
    const { printables, folders } = LIBRARY();
    const page = loadLibrary(printables, folders);
    page.startDrag({ id: 'meetings' }, 'folder');
    assert.equal(page.mayDropOn('sundays'), true);
    assert.equal(page.mayDropOn('y2026'), false, 'offered to drop a folder into its own child');
    page.startDrag({ id: 'p_flyer' }, 'printable');
    assert.equal(page.mayDropOn('y2026'), true, 'a printable goes anywhere');
});

test('the move dialog calls the top level Printables and never offers a folder its own subtree', () => {
    const { printables, folders } = LIBRARY();
    const page = loadLibrary(printables, folders);
    page.startMove({ id: 'meetings', name: 'Members\' meetings' }, 'folder');
    assert.equal(page.moveOptions[0].name, 'Printables');
    const ids = page.moveOptions.map(o => o.id);
    assert.ok(!ids.includes('meetings') && !ids.includes('y2026'));
    assert.ok(ids.includes('sundays'));
});

// ── Copies ───────────────────────────────────────────────────────────────────

test('a copy is named beside the original and never collides with an earlier copy', () => {
    const Core = require('../public/printable-core.js');
    assert.equal(Core.copyName('Directory', ['Directory']), 'Directory copy');
    assert.equal(Core.copyName('Directory', ['Directory', 'Directory copy']), 'Directory copy 2');
    assert.equal(Core.copyName('Directory copy', ['Directory copy', 'Directory copy 2']), 'Directory copy 3',
        'copying a copy counts from the original name, not "copy copy"');
});

test('a duplicate keeps the paper, the pages and where it was filed, and nothing about who made it', () => {
    const Core = require('../public/printable-core.js');
    const original = Object.assign(Core.buildPrintable({
        name: 'Directory', folderId: 'y2026',
        template: { paper: 'letter', orientation: 'landscape', dpi: 150 },
        pages: [{ id: 'pg1', nodes: [{ id: 'n1', tag: 'p', text: 'Jane', bind: { text: { field: 'name' } } }] }],
    }), { createdByName: 'Somebody', updatedAt: 'yesterday' });
    const copy = Core.duplicatePrintable(original, ['Directory']);
    assert.equal(copy.name, 'Directory copy');
    assert.equal(copy.folderId, 'y2026');
    assert.deepEqual(copy.template, original.template);
    assert.deepEqual(copy.pages, original.pages);
    assert.notEqual(copy.pages, original.pages, 'the pages are a copy, not shared');
    assert.equal(copy.createdByName, undefined);
    assert.equal(copy.updatedAt, undefined);
});

// ── Two editors at once ──────────────────────────────────────────────────────

test('filing two different printables touches two different records', () => {
    const store = fs.readFileSync(path.join(ROOT, 'public', 'printable-store.js'), 'utf8');
    const move = store.match(/async function movePrintable\([\s\S]*?\n    \}/);
    assert.ok(move, 'movePrintable has gone missing');
    assert.match(move[0], /\.doc\(id\)/,
        'filing a printable should write that printable, not a shared structure record');
    assert.doesNotMatch(store, /elder_document_structure/);
});
