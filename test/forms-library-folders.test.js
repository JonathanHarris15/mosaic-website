const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// MS-376 — the Forms library once it has folders.
//
// The page is loaded in a sandbox and exercised against the code it ships with,
// like form-answer-page.test.js. What is pinned here is the behaviour a folder
// tree gets wrong quietly: which rows a folder shows, whether a search still
// reaches every one of them, and — the one that costs a year of sign-ups — the
// count somebody is shown before they delete a folder.
//
// ⚠ The promise underneath all of it (ADR-0054) is that filing changes where a
// form is DRAWN and never whether it is. A form whose folder has been deleted
// comes back to the top level; a form nobody filed was always there. Both are
// tested, because both are ways a live form could vanish while its public link
// kept working.

const ROOT = path.join(__dirname, '..');

function loadLibrary(forms, folders) {
    const sandbox = {
        console, Promise, Date, Object, Array, Math, String, Number, JSON,
        Set, Map, encodeURIComponent, URLSearchParams, setTimeout, clearTimeout,
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    sandbox.location = { search: '', href: 'https://x/forms.html', pathname: '/forms.html' };
    sandbox.document = { getElementById: () => null };
    sandbox.FormsCore = require('../public/forms-core.js');
    sandbox.FormFoldersCore = require('../public/form-folders-core.js');
    sandbox.DateUtils = { todayStr: () => '2026-09-03' };

    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'public', 'forms.js'), 'utf8'), sandbox);

    const page = sandbox.formsPage();
    page.$nextTick = (fn) => fn && fn();
    page.loading = false;
    page.forms = forms;
    page.folders = folders;
    return page;
}

// Sign-ups/ → 2025/ → Kids/ , Sign-ups/2026/ , Feedback/ , and one unfiled form.
const LIBRARY = () => ({
    folders: [
        { id: 'signups', name: 'Sign-ups', parentId: null },
        { id: 'y2025', name: '2025', parentId: 'signups' },
        { id: 'kids', name: 'Kids', parentId: 'y2025' },
        { id: 'feedback', name: 'Feedback', parentId: null },
    ],
    forms: [
        form('f_harvest', 'Harvest supper', 'y2025', ['Are you bringing a pudding?']),
        form('f_creche', 'Creche rota', 'kids', ['Which Sundays can you help?']),
        form('f_advent', 'Advent survey', 'feedback', ['How did the season go?']),
        form('f_elder', 'Elder interview', null, ['Tell us about your walk.']),
    ],
});

function form(id, title, folderId, questions) {
    return {
        id, title, folderId,
        published: true, closed: false, rung: 'member', attribution: true,
        questions: (questions || []).map((text, i) => ({ id: 'q' + i, type: 'short_text', text })),
    };
}

const titles = (rows) => rows.map(r => r.title || r.name);

// ── What a folder shows ──────────────────────────────────────────────────────

test('the top level shows the top-level folders and the unfiled forms', () => {
    const { forms, folders } = LIBRARY();
    const page = loadLibrary(forms, folders);
    assert.deepEqual(titles(page.visibleFolders), ['Feedback', 'Sign-ups']);
    assert.deepEqual(titles(page.visible), ['Elder interview']);
});

test('opening a folder shows what is in it, and not what is below that', () => {
    const { forms, folders } = LIBRARY();
    const page = loadLibrary(forms, folders);
    page.openFolder('y2025');
    assert.deepEqual(titles(page.visibleFolders), ['Kids']);
    assert.deepEqual(titles(page.visible), ['Harvest supper'],
        'the Creche rota is one level down and should not be listed here');
});

test('the breadcrumb says where you are', () => {
    const { forms, folders } = LIBRARY();
    const page = loadLibrary(forms, folders);
    page.openFolder('kids');
    assert.deepEqual(page.breadcrumb.map(c => c.name), ['Sign-ups', '2025', 'Kids']);
});

// ── A form is never lost ─────────────────────────────────────────────────────

test('a form nobody filed is at the top level, where it can be found', () => {
    const { forms, folders } = LIBRARY();
    const page = loadLibrary(forms, folders);
    assert.ok(titles(page.visible).includes('Elder interview'));
});

test('a form whose folder has gone comes back to the top level', () => {
    // The case ADR-0054 exists for. Its public link still works, so it must
    // stay findable — a form that is live and invisible cannot be closed.
    const { forms, folders } = LIBRARY();
    forms.push(form('f_lost', 'Lost sign-up', 'a_folder_nobody_has', []));
    const page = loadLibrary(forms, folders);
    assert.ok(titles(page.visible).includes('Lost sign-up'),
        'a form pointing at a missing folder disappeared from the library');
});

// ── Search ───────────────────────────────────────────────────────────────────

test('search reaches every folder, wherever you are standing', () => {
    const { forms, folders } = LIBRARY();
    const page = loadLibrary(forms, folders);
    page.openFolder('feedback');
    page.search = 'creche';
    assert.deepEqual(titles(page.visible), ['Creche rota'],
        'a search from inside one folder should still find a form filed in another');
});

test('search reads the questions too, not only the title', () => {
    const { forms, folders } = LIBRARY();
    const page = loadLibrary(forms, folders);
    page.search = 'pudding';
    assert.deepEqual(titles(page.visible), ['Harvest supper']);
});

test('a search says where each hit was found', () => {
    const { forms, folders } = LIBRARY();
    const page = loadLibrary(forms, folders);
    assert.equal(page.pathFor(forms.find(f => f.id === 'f_creche')), 'Sign-ups / 2025 / Kids');
    assert.equal(page.pathFor(forms.find(f => f.id === 'f_elder')), 'Forms');
});

test('while searching, folders are not listed beside the results', () => {
    const { forms, folders } = LIBRARY();
    const page = loadLibrary(forms, folders);
    page.search = 'a';
    assert.deepEqual(page.visibleFolders, [],
        'a search is over every form, so a list of this folder answers a different question');
});

// ── Deleting ─────────────────────────────────────────────────────────────────

test('deleting a folder names how many forms go with it, at every depth', () => {
    const { forms, folders } = LIBRARY();
    const page = loadLibrary(forms, folders);
    page.startDeleteFolder(folders.find(f => f.id === 'signups'));
    assert.equal(page.deletingCount, 2, 'Sign-ups holds nothing directly and two forms below it');
    assert.match(page.deleteLine, /2 forms go with it/);
    assert.match(page.deleteLine, /cannot be undone/);
});

test('an empty folder says it is empty rather than naming a count', () => {
    const { forms, folders } = LIBRARY();
    folders.push({ id: 'y2026', name: '2026', parentId: 'signups' });
    const page = loadLibrary(forms, folders);
    page.startDeleteFolder(folders.find(f => f.id === 'y2026'));
    assert.equal(page.deletingCount, 0);
    assert.match(page.deleteLine, /empty/);
});

test('a folder row counts what is under it, so one holding only folders is not empty', () => {
    const { forms, folders } = LIBRARY();
    const page = loadLibrary(forms, folders);
    const line = page.folderSub(folders.find(f => f.id === 'signups'));
    assert.match(line, /1 folder/);
    assert.match(line, /2 forms/);
});

// ── Moving ───────────────────────────────────────────────────────────────────

test('a row only lights up for a drop that would actually be allowed', () => {
    const { forms, folders } = LIBRARY();
    const page = loadLibrary(forms, folders);
    page.startDrag({ id: 'signups' }, 'folder');
    assert.equal(page.mayDropOn('feedback'), true);
    assert.equal(page.mayDropOn('kids'), false, 'offered to drop a folder into its own grandchild');
    assert.equal(page.mayDropOn('signups'), false, 'offered to drop a folder into itself');

    page.startDrag({ id: 'f_elder' }, 'form');
    assert.equal(page.mayDropOn('kids'), true, 'a form goes anywhere');
});

test('the move dialog never offers a folder its own subtree', () => {
    const { forms, folders } = LIBRARY();
    const page = loadLibrary(forms, folders);
    page.startMove({ id: 'signups', name: 'Sign-ups' }, 'folder');
    const ids = page.moveOptions.map(o => o.id);
    assert.ok(!ids.includes('signups'));
    assert.ok(!ids.includes('y2025'));
    assert.ok(!ids.includes('kids'));
    assert.ok(ids.includes('feedback'));
});

// ── Two editors at once ──────────────────────────────────────────────────────

test('filing two different forms touches two different records', () => {
    // The whole reason for ADR-0054. If this ever becomes one shared write,
    // two editors filing at the same moment start losing each other's work,
    // and nothing on screen says so.
    const store = fs.readFileSync(path.join(ROOT, 'public', 'forms-store.js'), 'utf8');
    const moveForm = store.match(/async function moveForm\([\s\S]*?\n    \}/);
    assert.ok(moveForm, 'moveForm has gone missing');
    assert.match(moveForm[0], /\.doc\(formId\)/,
        'filing a form should write that form, not a shared structure record');
    assert.doesNotMatch(store, /elder_document_structure/,
        'the Forms library must not write the Document Library structure record');
});
