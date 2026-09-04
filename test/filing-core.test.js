const { test } = require('node:test');
const assert = require('node:assert');

// MS-392 — the filing engine, shared by the Forms library and the Printables
// library.
//
// `form-folders-core.js` is now a wrapper over this module keeping its
// Forms-flavoured names, and test/form-folders-core.test.js still runs against
// it unchanged — that file is the deeper test of the walks. What is pinned
// here is the seam: the generic names do the same work, the wrapper really
// delegates, and the one thing that differs per library — what the top row of
// the "Move to…" dialog is called — is a parameter rather than a copy.

const Filing = require('../public/filing-core.js');
const FormFolders = require('../public/form-folders-core.js');

const LIBRARY = () => ({
    folders: [
        { id: 'meetings', name: 'Members\' meetings', parentId: null },
        { id: 'y2026', name: '2026', parentId: 'meetings' },
        { id: 'sundays', name: 'Sundays', parentId: null },
    ],
    items: [
        { id: 'dir', name: 'Directory', folderId: 'y2026' },
        { id: 'guide', name: 'Service guide', folderId: 'sundays' },
        { id: 'flyer', name: 'Flyer', folderId: null },
        { id: 'lost', name: 'Lost one', folderId: 'gone' },
    ],
});

test('the generic walks answer the same questions the Forms names did', () => {
    const { folders, items } = LIBRARY();
    assert.deepEqual(Filing.itemsIn(items, 'y2026').map(i => i.id), ['dir']);
    assert.deepEqual(Filing.itemsUnder(folders, items, 'meetings').map(i => i.id), ['dir']);
    assert.deepEqual(Filing.breadcrumbFor(folders, 'y2026').map(c => c.name), ['Members\' meetings', '2026']);
});

test('an item whose folder has gone comes back to the top level', () => {
    const { folders, items } = LIBRARY();
    const top = Filing.itemsIn(items, null, folders).map(i => i.id);
    assert.ok(top.includes('flyer'), 'the unfiled item belongs at the top');
    assert.ok(top.includes('lost'), 'an item pointing at a missing folder must not vanish');
    assert.ok(!top.includes('dir'));
});

test('the top row of the move dialog is named by the library, not the engine', () => {
    const { folders } = LIBRARY();
    assert.equal(Filing.moveTargets(folders, null, 'Printables')[0].name, 'Printables');
    assert.equal(Filing.moveTargets(folders, null)[0].name, 'Top level');
    assert.equal(FormFolders.moveTargets(folders, null)[0].name, 'Forms',
        'the Forms wrapper must keep calling its root "Forms"');
});

test('the Forms wrapper really delegates rather than carrying a second copy', () => {
    assert.equal(FormFolders.formsIn, Filing.itemsIn);
    assert.equal(FormFolders.formsUnder, Filing.itemsUnder);
    assert.equal(FormFolders.canMoveFolder, Filing.canMoveFolder);
    assert.equal(FormFolders.breadcrumbFor, Filing.breadcrumbFor);
    assert.equal(FormFolders.TOP_LEVEL, Filing.TOP_LEVEL);
});
