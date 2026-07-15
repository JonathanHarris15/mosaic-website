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
