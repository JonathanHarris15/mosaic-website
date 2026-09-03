const { test } = require('node:test');
const assert = require('node:assert');

// MS-375 — the shape of a filed Forms library.
//
// A Form Folder is its own record carrying a name and the folder it sits in;
// a Form Template carries the folder IT sits in. Neither knows its children,
// so every question the library asks — where am I, what is in here, how much
// goes if I delete this, may I drop this there — is a walk over two flat lists.
// That walk is this module, and it is pure: no Firestore, no page.
//
// ⚠ This is deliberately NOT how the Document Library stores folders. That page
// keeps one nested tree in a single record and rewrites it whole. Forms are open
// to editors rather than a handful of elders, so a whole-record write loses a
// colleague's change, and a form missing from the tree would vanish from the
// library while its public link kept working. ADR-0054 carries the reasoning.
//
// The tests below lean on that: the lists are flat, so the interesting cases are
// all about a walk that has to terminate — a parent that has gone, and a pair of
// folders that claim each other.

const Folders = require('../public/form-folders-core.js');

// A small library, three deep:
//
//   Sign-ups/                 (signups)
//     2025/                   (y2025)      → "Harvest supper"
//       Kids/                 (kids)       → "Creche rota"
//     2026/                   (y2026)
//   Feedback/                 (feedback)   → "Advent survey"
//   (top level)                            → "Elder interview"
const LIBRARY = () => ({
    folders: [
        { id: 'signups', name: 'Sign-ups', parentId: null },
        { id: 'y2025', name: '2025', parentId: 'signups' },
        { id: 'kids', name: 'Kids', parentId: 'y2025' },
        { id: 'y2026', name: '2026', parentId: 'signups' },
        { id: 'feedback', name: 'Feedback', parentId: null },
    ],
    forms: [
        { id: 'f_harvest', title: 'Harvest supper', folderId: 'y2025' },
        { id: 'f_creche', title: 'Creche rota', folderId: 'kids' },
        { id: 'f_advent', title: 'Advent survey', folderId: 'feedback' },
        { id: 'f_elder', title: 'Elder interview', folderId: null },
    ],
});

const ids = list => list.map(x => x.id);

// ── Where am I ───────────────────────────────────────────────────────────────

test('the breadcrumb reads from the top level down to the folder you are in', () => {
    const { folders } = LIBRARY();
    assert.deepEqual(ids(Folders.breadcrumbFor(folders, 'kids')), ['signups', 'y2025', 'kids']);
    assert.deepEqual(Folders.breadcrumbFor(folders, 'kids').map(f => f.name),
        ['Sign-ups', '2025', 'Kids']);
});

test('at the top level the breadcrumb is empty — the page draws "Forms" itself', () => {
    const { folders } = LIBRARY();
    assert.deepEqual(Folders.breadcrumbFor(folders, null), []);
    assert.deepEqual(Folders.breadcrumbFor(folders, undefined), []);
});

test('a folder nobody has heard of reads as the top level, not as a crash', () => {
    const { folders } = LIBRARY();
    assert.deepEqual(Folders.breadcrumbFor(folders, 'no_such_folder'), []);
});

test('a folder whose parent has gone still says where it is, as far as it can', () => {
    // The parent record is missing — deleted, or never written. The folder is
    // still real and still holds forms, so the library has to keep drawing it.
    const folders = [{ id: 'orphan', name: 'Orphan', parentId: 'vanished' }];
    assert.deepEqual(ids(Folders.breadcrumbFor(folders, 'orphan')), ['orphan']);
});

test('two folders that claim each other do not hang the page', () => {
    // Not reachable through the interface, but a half-finished move or a hand
    // edit can write it. A walk that loops here freezes the library.
    const folders = [
        { id: 'a', name: 'A', parentId: 'b' },
        { id: 'b', name: 'B', parentId: 'a' },
    ];
    const crumbs = Folders.breadcrumbFor(folders, 'a');
    assert.ok(crumbs.length <= 2, 'the breadcrumb walked in a circle');
});

// ── What is in here ──────────────────────────────────────────────────────────

test('a folder lists the folders directly inside it, by name', () => {
    const { folders } = LIBRARY();
    assert.deepEqual(ids(Folders.childFolders(folders, 'signups')), ['y2025', 'y2026']);
});

test('the top level lists the folders with no parent', () => {
    const { folders } = LIBRARY();
    assert.deepEqual(ids(Folders.childFolders(folders, null)), ['feedback', 'signups']);
});

test('a folder lists the forms directly in it, and not the ones deeper down', () => {
    const { forms } = LIBRARY();
    assert.deepEqual(ids(Folders.formsIn(forms, 'y2025')), ['f_harvest']);
    assert.deepEqual(ids(Folders.formsIn(forms, 'kids')), ['f_creche']);
});

test('a form with no folder shows at the top level', () => {
    // The one that matters most: a form is reachable by its public link whether
    // or not anybody filed it, so it must never be missing from the library.
    const { forms } = LIBRARY();
    assert.deepEqual(ids(Folders.formsIn(forms, null)), ['f_elder']);
});

test('a form filed into a folder that has since gone comes back to the top level', () => {
    const { folders } = LIBRARY();
    const forms = [{ id: 'f_lost', title: 'Lost', folderId: 'deleted_folder' }];
    assert.deepEqual(ids(Folders.formsIn(forms, null, folders)), ['f_lost'],
        'a form pointing at a folder nobody has is invisible in the library');
});

// ── How much goes with it ────────────────────────────────────────────────────

test('the delete count reaches every depth, not just the top one', () => {
    const { folders, forms } = LIBRARY();
    // Sign-ups holds nothing directly; 2025 holds one and Kids holds one.
    assert.equal(Folders.formsUnder(folders, forms, 'signups').length, 2);
    assert.equal(Folders.formsUnder(folders, forms, 'y2025').length, 2);
    assert.equal(Folders.formsUnder(folders, forms, 'kids').length, 1);
});

test('an empty folder counts nothing', () => {
    const { folders, forms } = LIBRARY();
    assert.equal(Folders.formsUnder(folders, forms, 'y2026').length, 0);
});

test('the folders that would go with it are named too', () => {
    const { folders } = LIBRARY();
    assert.deepEqual(Folders.descendantFolderIds(folders, 'signups').sort(),
        ['kids', 'y2025', 'y2026']);
    assert.deepEqual(Folders.descendantFolderIds(folders, 'kids'), []);
});

// ── May I drop this there ────────────────────────────────────────────────────

test('a folder may move to the top level and into an unrelated folder', () => {
    const { folders } = LIBRARY();
    assert.equal(Folders.canMoveFolder(folders, 'kids', null).ok, true);
    assert.equal(Folders.canMoveFolder(folders, 'kids', 'feedback').ok, true);
});

test('a folder may not move inside itself', () => {
    const { folders } = LIBRARY();
    const verdict = Folders.canMoveFolder(folders, 'signups', 'signups');
    assert.equal(verdict.ok, false);
    assert.ok(verdict.why, 'a refusal with no sentence is a greyed box');
});

test('a folder may not move inside its own descendant — the subtree would be lost', () => {
    const { folders } = LIBRARY();
    const verdict = Folders.canMoveFolder(folders, 'signups', 'kids');
    assert.equal(verdict.ok, false);
    assert.ok(verdict.why);
});

test('a folder may not move into one that does not exist', () => {
    const { folders } = LIBRARY();
    assert.equal(Folders.canMoveFolder(folders, 'kids', 'nowhere').ok, false);
});

test('descent is asked of the tree, not of the name', () => {
    const { folders } = LIBRARY();
    assert.equal(Folders.isDescendant(folders, 'kids', 'signups'), true);
    assert.equal(Folders.isDescendant(folders, 'kids', 'feedback'), false);
    assert.equal(Folders.isDescendant(folders, 'signups', 'kids'), false);
    assert.equal(Folders.isDescendant(folders, 'kids', 'kids'), false,
        'a folder is not its own descendant');
});

// ── Move to… ─────────────────────────────────────────────────────────────────

test('the move dialog offers every folder, with its depth, and the top level', () => {
    const { folders } = LIBRARY();
    const targets = Folders.moveTargets(folders, null);
    assert.deepEqual(targets.map(t => t.id),
        [Folders.TOP_LEVEL, 'feedback', 'signups', 'y2025', 'kids', 'y2026']);
    assert.deepEqual(targets.map(t => t.depth), [0, 1, 1, 2, 3, 2]);
});

test('the move dialog never offers a folder its own subtree', () => {
    const { folders } = LIBRARY();
    const targets = Folders.moveTargets(folders, 'signups').map(t => t.id);
    assert.ok(!targets.includes('signups'), 'offered to move a folder into itself');
    assert.ok(!targets.includes('y2025'), 'offered to move a folder into its own child');
    assert.ok(!targets.includes('kids'), 'offered to move a folder into its own grandchild');
    assert.ok(targets.includes('feedback'), 'an unrelated folder should still be offered');
    assert.ok(targets.includes(Folders.TOP_LEVEL), 'the top level should always be offered');
});

// ── Names ────────────────────────────────────────────────────────────────────

test('a folder name is trimmed and capped, because a breadcrumb has to fit a phone', () => {
    assert.equal(Folders.normaliseFolderName('  Sign-ups  '), 'Sign-ups');
    assert.equal(Folders.normaliseFolderName('x'.repeat(200)).length,
        Folders.MAX_FOLDER_NAME_LENGTH);
});

test('a folder nobody named still has a name to draw', () => {
    assert.equal(Folders.normaliseFolderName(''), Folders.DEFAULT_FOLDER_NAME);
    assert.equal(Folders.normaliseFolderName('   '), Folders.DEFAULT_FOLDER_NAME);
    assert.equal(Folders.normaliseFolderName(null), Folders.DEFAULT_FOLDER_NAME);
});

// ── The record ───────────────────────────────────────────────────────────────

test('a folder record carries a name and its parent, and nothing about its children', () => {
    const record = Folders.buildFolder({ name: '  2027 ', parentId: 'signups' });
    assert.equal(record.name, '2027');
    assert.equal(record.parentId, 'signups');
    assert.ok(!('children' in record),
        'a folder that knows its children is the shared tree this design rejected');
});

test('a folder with no parent is at the top level, stored as null rather than missing', () => {
    const record = Folders.buildFolder({ name: 'Feedback' });
    assert.equal(record.parentId, null);
});
