const { test } = require('node:test');
const assert = require('node:assert');

const Core = require('../public/shepherding-documents-core.js');

// A small library tree:
//   root
//   ├── folderA
//   │   ├── doc1
//   │   └── folderB
//   │       └── doc2
//   └── doc3
function sampleTree() {
    return {
        children: [
            {
                type: 'folder', id: 'A', name: 'Folder A', children: [
                    { type: 'document', id: 'doc1' },
                    {
                        type: 'folder', id: 'B', name: 'Folder B', children: [
                            { type: 'document', id: 'doc2' },
                        ],
                    },
                ],
            },
            { type: 'document', id: 'doc3' },
        ],
    };
}

test('getFolderById finds nested folders and returns null for missing / document ids', () => {
    const t = sampleTree();
    assert.strictEqual(Core.getFolderById(t, 'B').name, 'Folder B');
    assert.strictEqual(Core.getFolderById(t, 'A').id, 'A');
    assert.strictEqual(Core.getFolderById(t, 'doc1'), null); // documents are not folders
    assert.strictEqual(Core.getFolderById(t, 'nope'), null);
});

test('findParent returns the containing node, including the root', () => {
    const t = sampleTree();
    assert.strictEqual(Core.findParent(t, 'doc3'), t);        // root-level doc
    assert.strictEqual(Core.findParent(t, 'doc1').id, 'A');
    assert.strictEqual(Core.findParent(t, 'doc2').id, 'B');
    assert.strictEqual(Core.findParent(t, 'B').id, 'A');
    assert.strictEqual(Core.findParent(t, 'ghost'), null);
});

test('findPathToFolder returns the folder-id chain', () => {
    const t = sampleTree();
    assert.deepStrictEqual(Core.findPathToFolder(t, 'B'), ['A', 'B']);
    assert.deepStrictEqual(Core.findPathToFolder(t, 'A'), ['A']);
    assert.strictEqual(Core.findPathToFolder(t, 'missing'), null);
});

test('treeDocIds / getAllDocIds collect every document id in the subtree', () => {
    const t = sampleTree();
    assert.deepStrictEqual(Core.treeDocIds(t).sort(), ['doc1', 'doc2', 'doc3']);
    assert.deepStrictEqual(Core.getAllDocIds(Core.getFolderById(t, 'A')).sort(), ['doc1', 'doc2']);
    assert.deepStrictEqual(Core.getAllDocIds(Core.getFolderById(t, 'B')), ['doc2']);
});

test('containsDoc answers library-membership for a document id', () => {
    const t = sampleTree();
    assert.strictEqual(Core.containsDoc(t, 'doc2'), true);
    assert.strictEqual(Core.containsDoc(t, 'doc3'), true);
    assert.strictEqual(Core.containsDoc(t, 'not-here'), false);
});

test('removeFromTree deletes a node wherever it sits and reports success', () => {
    const t = sampleTree();
    assert.strictEqual(Core.removeFromTree(t, 'doc2'), true);
    assert.strictEqual(Core.containsDoc(t, 'doc2'), false);
    assert.strictEqual(Core.getFolderById(t, 'B').children.length, 0);

    assert.strictEqual(Core.removeFromTree(t, 'A'), true); // removing a folder takes its subtree
    assert.strictEqual(Core.getFolderById(t, 'A'), null);
    assert.deepStrictEqual(Core.treeDocIds(t), ['doc3']);

    assert.strictEqual(Core.removeFromTree(t, 'already-gone'), false);
});

test('isDescendant guards against moving a folder into its own subtree', () => {
    const t = sampleTree();
    assert.strictEqual(Core.isDescendant(t, 'B', 'A'), true);  // B is inside A
    assert.strictEqual(Core.isDescendant(t, 'A', 'B'), false); // A is not inside B
    assert.strictEqual(Core.isDescendant(t, 'A', 'missing'), false);
});

test('getFolderOptions flattens folders with depth and honours excludeId', () => {
    const t = sampleTree();
    assert.deepStrictEqual(Core.getFolderOptions(t), [
        { id: 'A', name: 'Folder A', depth: 0 },
        { id: 'B', name: 'Folder B', depth: 1 },
    ]);
    // Excluding a folder omits that folder (used so you can't pick the item itself).
    assert.deepStrictEqual(Core.getFolderOptions(t, 'A'), []); // A excluded; B is only reached via A
    assert.deepStrictEqual(Core.getFolderOptions(t, 'B'), [{ id: 'A', name: 'Folder A', depth: 0 }]);
});

test('moveNode relocates a document to another folder and to the root', () => {
    const t = sampleTree();
    assert.strictEqual(Core.moveNode(t, { type: 'document', id: 'doc3' }, 'B'), true);
    assert.deepStrictEqual(Core.getAllDocIds(Core.getFolderById(t, 'B')).sort(), ['doc2', 'doc3']);
    assert.strictEqual(Core.findParent(t, 'doc3').id, 'B');

    assert.strictEqual(Core.moveNode(t, { type: 'document', id: 'doc3' }, Core.ROOT), true);
    assert.strictEqual(Core.findParent(t, 'doc3'), t);
});

test('moveNode carries a folder subtree along', () => {
    const t = sampleTree();
    assert.strictEqual(Core.moveNode(t, { type: 'folder', id: 'B' }, Core.ROOT), true);
    // B moved to root, still holding doc2.
    assert.strictEqual(Core.findParent(t, 'B'), t);
    assert.deepStrictEqual(Core.getAllDocIds(Core.getFolderById(t, 'B')), ['doc2']);
    // A no longer contains B.
    assert.strictEqual(Core.getFolderById(Core.getFolderById(t, 'A'), 'B'), null);
});

test('moveNode returns false when the target folder is gone', () => {
    const t = sampleTree();
    assert.strictEqual(Core.moveNode(t, { type: 'document', id: 'doc3' }, 'ghost-folder'), false);
});

// The MS-98 "same file in two places" rule: a document referenced by a person's
// tree AND the library root tree must survive removal from one of them.
test('a document shared between two trees is only orphaned when absent from BOTH', () => {
    const library = { children: [{ type: 'document', id: 'shared' }] };
    const profile = { children: [{ type: 'document', id: 'shared' }, { type: 'document', id: 'private' }] };

    // Opting out of the library removes it there but the profile still references it →
    // the underlying elder_documents record must be kept.
    Core.removeFromTree(library, 'shared');
    const stillReferenced = Core.containsDoc(library, 'shared') || Core.containsDoc(profile, 'shared');
    assert.strictEqual(stillReferenced, true, 'shared doc is still owned by the profile');

    // Deleting from the owning profile too leaves it referenced nowhere → safe to delete.
    Core.removeFromTree(profile, 'shared');
    const orphaned = !Core.containsDoc(library, 'shared') && !Core.containsDoc(profile, 'shared');
    assert.strictEqual(orphaned, true);

    // A profile-only doc was never in the library, so it must not leak there.
    assert.strictEqual(Core.containsDoc(library, 'private'), false);
    assert.strictEqual(Core.containsDoc(profile, 'private'), true);
});

// ── One change to a tree (MS-493) ────────────────────────────────────────────
//
// Every writer — the Library page, a profile's Documents tab, the phone and the
// assistant — applies ONE change to the LATEST tree, never a whole tree it
// loaded earlier. These are the changes, and what each does.

test('a tree is the Library or one person\'s, and nothing else', () => {
    assert.strictEqual(Core.isTreeId('root'), true);
    assert.strictEqual(Core.isTreeId('person_abc123'), true);
    assert.strictEqual(Core.isTreeId(Core.personTreeId('abc123')), true);
    assert.strictEqual(Core.isTreeId('people'), false);
    assert.strictEqual(Core.isTreeId('person_../root'), false);
    assert.strictEqual(Core.isTreeId(''), false);
});

test('a folder is made at the top of the folder it is made in', () => {
    const t = sampleTree();
    const out = Core.applyTreeChange(t, { op: 'createFolder', parentId: 'A', folderId: 'N', name: 'New Folder' });
    assert.strictEqual(out.changed, true);
    assert.deepStrictEqual(Core.getFolderById(t, 'A').children[0], { type: 'folder', id: 'N', name: 'New Folder', children: [] });
    assert.strictEqual(Core.applyTreeChange(t, { op: 'createFolder', parentId: Core.ROOT, folderId: 'N', name: 'Again' }).changed, false,
        'the same folder is not made twice');
});

test('a folder made inside one that was deleted is refused', () => {
    const out = Core.applyTreeChange(sampleTree(), { op: 'createFolder', parentId: 'ghost', folderId: 'N', name: 'x' });
    assert.strictEqual(out.changed, false);
    assert.match(out.refused, /no longer exists/);
});

test('a rename touches one folder', () => {
    const t = sampleTree();
    assert.strictEqual(Core.applyTreeChange(t, { op: 'renameFolder', folderId: 'B', name: 'Visits' }).changed, true);
    assert.strictEqual(Core.getFolderById(t, 'B').name, 'Visits');
    assert.strictEqual(Core.getFolderById(t, 'A').name, 'Folder A');
});

test('a move whose target folder is gone refuses, and loses nothing', () => {
    const t = sampleTree();
    const out = Core.applyTreeChange(t, { op: 'move', item: { type: 'document', id: 'doc3' }, targetFolderId: 'ghost' });
    assert.strictEqual(out.changed, false);
    assert.ok(Core.containsDoc(t, 'doc3'), 'the document was dropped on the floor');
});

test('a folder cannot be moved into itself or below itself', () => {
    const t = sampleTree();
    assert.strictEqual(Core.applyTreeChange(t, { op: 'move', item: { type: 'folder', id: 'A' }, targetFolderId: 'B' }).changed, false);
    assert.strictEqual(Core.applyTreeChange(t, { op: 'move', item: { type: 'folder', id: 'A' }, targetFolderId: 'A' }).changed, false);
    assert.ok(Core.getFolderById(t, 'B'), 'the folder vanished');
});

test('a move carries a folder and what is in it', () => {
    const t = sampleTree();
    assert.strictEqual(Core.applyTreeChange(t, { op: 'move', item: { type: 'folder', id: 'B' }, targetFolderId: Core.ROOT }).changed, true);
    assert.strictEqual(Core.findParent(t, 'B'), t);
    assert.deepStrictEqual(Core.getAllDocIds(Core.getFolderById(t, 'B')), ['doc2']);
});

test('removing takes an item out, and removing what is already gone changes nothing', () => {
    const t = sampleTree();
    assert.strictEqual(Core.applyTreeChange(t, { op: 'remove', itemId: 'doc2' }).changed, true);
    assert.strictEqual(Core.containsDoc(t, 'doc2'), false);
    assert.strictEqual(Core.applyTreeChange(t, { op: 'remove', itemId: 'doc2' }).changed, false);
});

test('filing puts a document at the end of a folder, once', () => {
    const t = sampleTree();
    assert.strictEqual(Core.applyTreeChange(t, { op: 'file', docId: 'doc9', folderId: 'B' }).changed, true);
    assert.deepStrictEqual(Core.getAllDocIds(Core.getFolderById(t, 'B')), ['doc2', 'doc9']);
    assert.strictEqual(Core.applyTreeChange(t, { op: 'file', docId: 'doc9', folderId: Core.ROOT }).changed, false,
        'a document already in the tree is not filed twice');
    assert.strictEqual(Core.applyTreeChange(t, { op: 'file', docId: 'doc10' }).changed, true, 'no folder means the top');
    assert.strictEqual(t.children[t.children.length - 1].id, 'doc10');
});

test('pruning takes several documents out wherever they sit', () => {
    const t = sampleTree();
    assert.strictEqual(Core.applyTreeChange(t, { op: 'prune', docIds: ['doc1', 'doc2', 'nope'] }).changed, true);
    assert.deepStrictEqual(Core.treeDocIds(t).sort(), ['doc3']);
});

test('a change nobody knows is refused rather than guessed at', () => {
    assert.throws(() => Core.applyTreeChange(sampleTree(), { op: 'shuffle' }), /shuffle/);
});

test('removing from a profile destroys its documents and prunes them from the Library', () => {
    const plan = Core.removalPlan(['d1'], { d1: { ownerPersonId: 'p1' } }, true);
    assert.deepStrictEqual(plan, { destroy: ['d1'], optOut: [], pruneFromLibrary: ['d1'] });
});

test('removing from the Library destroys its own documents, and only opts a profile document out', () => {
    const plan = Core.removalPlan(['lib', 'owned'], { lib: {}, owned: { ownerPersonId: 'p1' } }, false);
    assert.deepStrictEqual(plan, { destroy: ['lib'], optOut: ['owned'], pruneFromLibrary: [] });
});
