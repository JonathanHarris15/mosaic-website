// MS-493 / MS-496 — folder trees change one change at a time, and arrive live.
//
// Two things are pinned here:
//
//   1. No page and no phone screen writes a tree record. Every one of them used
//      to write back the whole tree it had loaded, so two elders filing at the
//      same moment lost one of the changes. A change now goes to the server
//      (the shepherdingTree callable), which applies it to the latest tree.
//   2. A tree arriving while an elder is mid-action does not disturb them: the
//      folder they are in survives, a folder that went takes them to its
//      nearest parent, and their own change still on its way stays on screen.
//
// The web directory is loaded in a sandbox against the code it ships with; the
// phone screens are read as source, like the other mobile wiring tests.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PUBLIC = path.join(__dirname, '..', 'public');
const read = (f) => fs.readFileSync(path.join(PUBLIC, f), 'utf8');

// ── Nobody writes a tree record ──────────────────────────────────────────────

test('no page or phone screen writes a folder tree record', () => {
    const writers = [
        'shepherding-documents.js', 'shepherding-form-document.js', 'shepherding-profile.js',
        'mobile/data.js', 'mobile/screens-documents.js', 'mobile/screens-shepherd.js', 'mobile/document-tree.js',
    ];
    writers.forEach(file => {
        const src = read(file);
        const writes = src.match(/elder_document_structure["']\)\s*\.doc\([^)]*\)\s*\.(set|update)\(/g);
        assert.strictEqual(writes, null, file + ' writes a tree record directly: ' + writes);
    });
    assert.ok(!/saveStructure\(|saveDocumentStructure/.test(read('shepherding-documents.js') + read('mobile/data.js')
        + read('mobile/screens-documents.js') + read('mobile/screens-shepherd.js')),
        'a whole-tree save is still there');
});

test('every tree change goes through the one client door to the server', () => {
    assert.match(read('document-tree-client.js'), /httpsCallable\('shepherdingTree'\)/);
    assert.match(read('mobile/data.js'), /window\.DocumentTree\.change\(/);
    assert.match(read('shepherding-documents.js'), /DocumentTree\.change\(this\.structureDocId, change\)/);
    ['mobile/screens-documents.js', 'mobile/screens-shepherd.js'].forEach(file => {
        assert.match(read(file), /M\.documentTree\.useDocumentTree\(/, file + ' does not use the shared live tree');
    });
    const html = read('mobile.html');
    assert.ok(html.indexOf('document-tree-client.js') < html.indexOf('mobile/document-tree.js'));
    assert.ok(html.indexOf('mobile/document-tree.js') < html.indexOf('mobile/screens-documents.js'));
    const libraryHtml = read('shepherding-documents.html');
    assert.ok(libraryHtml.indexOf('document-tree-client.js') < libraryHtml.indexOf('src="shepherding-documents.js"'));
    const profileHtml = read('shepherding-profile.html');
    assert.ok(profileHtml.indexOf('document-tree-client.js') < profileHtml.indexOf('src="shepherding-documents.js"'));
});

test('the phone deletes as the website does: a profile document leaves the Library, and stays', () => {
    const library = read('mobile/screens-documents.js');
    assert.match(library, /DC\.removalPlan\(ids, docs, false\)/);
    assert.match(library, /optElderDocsOutOfLibrary\(plan\.optOut\)/);
    assert.match(read('shepherding-documents.js'), /Docs\.removalPlan\(docIds, this\.allDocs, this\.isProfileScope\)/);
});

// ── The web directory, live ──────────────────────────────────────────────────

function loadDirectory(config) {
    let factory = null;
    const sandbox = {
        console, Promise, JSON, Object, Array, String, Math, Date, setTimeout, clearTimeout,
        URLSearchParams,
        document: { addEventListener: (name, cb) => { if (name === 'alpine:init') sandbox._init = cb; } },
        Alpine: { data: (name, fn) => { factory = fn; } },
        ShepherdingDocsCore: require('../public/shepherding-documents-core.js'),
        window: { addEventListener: () => {} },
    };
    const calls = [];
    sandbox.DocumentTree = {
        change: (treeId, change) => {
            calls.push({ treeId, change });
            return new Promise(resolve => { sandbox._resolve = resolve; });
        },
    };
    vm.createContext(sandbox);
    vm.runInContext(read('shepherding-documents.js'), sandbox);
    sandbox._init();
    const page = factory(config || {});
    page.$nextTick = (fn) => fn && fn();
    page.toasts = [];
    page.showToast = (message, type) => page.toasts.push({ message, type });
    return { page, calls, sandbox };
}

const tree = () => ({
    children: [
        { type: 'folder', id: 'A', name: '2026', children: [
            { type: 'folder', id: 'B', name: 'September', children: [{ type: 'document', id: 'd1' }] },
        ] },
        { type: 'document', id: 'd2' },
    ],
});

test('a tree that arrives keeps the elder in the folder they are in', () => {
    const { page } = loadDirectory();
    page.adoptTree(tree());
    page.currentPath = ['A', 'B'];
    const next = tree();
    next.children.push({ type: 'folder', id: 'C', name: 'Made by Ann', children: [] });
    page.adoptTree(next);
    assert.deepStrictEqual(Array.from(page.currentPath), ['A', 'B']);
    assert.ok(page.structure.children.some(c => c.id === 'C'), 'the new folder did not arrive');
    assert.strictEqual(page.toasts.length, 0);
});

test('a folder deleted under the elder takes them to its nearest parent, and says so', () => {
    const { page } = loadDirectory();
    page.adoptTree(tree());
    page.currentPath = ['A', 'B'];
    const next = tree();
    next.children[0].children = [];
    page.adoptTree(next);
    assert.deepStrictEqual(Array.from(page.currentPath), ['A']);
    assert.match(page.toasts[0].message, /deleted/);
});

test('an open rename survives a change elsewhere, and closes when its folder goes', () => {
    const { page } = loadDirectory();
    page.adoptTree(tree());
    page.renamingItemId = 'B';
    page.renameValue = 'Sept';
    const elsewhere = tree();
    elsewhere.children.push({ type: 'document', id: 'd9' });
    page.adoptTree(elsewhere);
    assert.strictEqual(page.renamingItemId, 'B');
    assert.strictEqual(page.renameValue, 'Sept', 'what was typed was lost');

    const gone = tree();
    gone.children[0].children = [];
    page.adoptTree(gone);
    assert.strictEqual(page.renamingItemId, null);
});

test('a change of our own still on its way stays on screen when somebody else\'s tree arrives', async () => {
    const { page, calls, sandbox } = loadDirectory();
    page.adoptTree(tree());
    const saving = page.changeTree({ op: 'createFolder', parentId: '__root__', folderId: 'N', name: 'New Folder' });
    assert.deepStrictEqual(calls.map(c => [c.treeId, c.change.op]), [['root', 'createFolder']]);
    assert.ok(page.structure.children.some(c => c.id === 'N'), 'the click did not show at once');

    // Ann's change arrives before ours has been applied on the server.
    const theirs = tree();
    theirs.children.push({ type: 'document', id: 'd9' });
    page.adoptTree(theirs);
    assert.ok(page.structure.children.some(c => c.id === 'N'), 'our own folder flickered out');
    assert.ok(page.structure.children.some(c => c.id === 'd9'), 'their change did not arrive');

    sandbox._resolve({ ok: true, changed: true });
    await saving;
    assert.ok(page.structure.children.some(c => c.id === 'N'), 'a confirmed change flickered out before its tree arrived');

    // The next tree carries it; after that it is no longer laid on top.
    const withOurs = JSON.parse(JSON.stringify(theirs));
    withOurs.children.unshift({ type: 'folder', id: 'N', name: 'New Folder', children: [] });
    page.adoptTree(withOurs);
    assert.strictEqual(page.pendingTree.length, 0);
});

test('a change somebody overwrote after ours was confirmed does not stay on screen', async () => {
    const { page, sandbox } = loadDirectory();
    page.adoptTree(tree());
    const saving = page.changeTree({ op: 'renameFolder', folderId: 'A', name: 'Foo' });
    sandbox._resolve({ ok: true, changed: true });
    await saving;
    const overwritten = tree();
    overwritten.children[0].name = 'Bar';
    page.adoptTree(overwritten);
    assert.strictEqual(page.structure.children[0].name, 'Bar');
});

test('a refused change comes off the screen straight away', async () => {
    const { page, sandbox } = loadDirectory();
    page.adoptTree(tree());
    sandbox.DocumentTree.change = () => Promise.reject(new Error('That folder no longer exists.'));
    const ok = await page.changeTree({ op: 'createFolder', parentId: '__root__', folderId: 'N', name: 'New Folder' });
    assert.strictEqual(ok, false);
    assert.ok(!page.structure.children.some(c => c.id === 'N'));
    assert.match(page.toasts[0].message, /no longer exists/);
});

test('a profile tab sends its changes to that person\'s tree', () => {
    const { page, calls } = loadDirectory({ structureDocId: 'person_p1', ownerPersonId: 'p1', embedded: true });
    page.adoptTree({ children: [] });
    page.changeTree({ op: 'file', docId: 'd1', folderId: '__root__' });
    assert.strictEqual(calls[0].treeId, 'person_p1');
});
