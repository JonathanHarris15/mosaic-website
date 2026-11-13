const { test } = require('node:test');
const assert = require('node:assert/strict');

const Core = require('../public/hymn-sheets-core.js');

test('new hymn bytes live under hymn-sheets/', () => {
    assert.equal(Core.storagePathFor('Amazing Grace', 'page1.png'),
        'hymn-sheets/Amazing Grace/page1.png');
});

test('legacy root paths are recognised and mapped', () => {
    assert.equal(Core.isLegacyRootHymnPath('Amazing Grace/page1.png'), true);
    assert.equal(Core.destinationPathForLegacy('Amazing Grace/page1.png'),
        'hymn-sheets/Amazing Grace/page1.png');
    assert.equal(Core.isLegacyRootHymnPath('people_photos/p1/f.jpg'), false);
    assert.equal(Core.isLegacyRootHymnPath('hymn-sheets/Grace/page1.png'), false);
});

test('download URLs decode back to object paths', () => {
    const path = 'hymn-sheets/Test Hymn/scan.png';
    const url = Core.downloadUrlFor('demo.appspot.com', path, 'tok');
    assert.equal(Core.pathFromDownloadUrl(url), path);
});
