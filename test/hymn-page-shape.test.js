const { test } = require('node:test');
const assert = require('node:assert');

const HymnVersions = require('../public/hymn-versions.js');
const Shape = require('../public/hymn-page-shape-core.js');

test('MS-802 — pageUrl reads string pages only', () => {
    assert.equal(HymnVersions.pageUrl('https://example/hymn-sheets/a.pdf'), 'https://example/hymn-sheets/a.pdf');
    assert.equal(HymnVersions.pageUrl({ url: 'https://legacy/x.pdf' }), '');
});

test('MS-802 — migration plan normalises object pages to strings', () => {
    const plan = Shape.planHymnPageShapes({
        versions: [{ pages: [{ url: 'https://example/a.pdf' }, ''] }],
    });
    assert.equal(plan.changed, true);
    assert.deepEqual(plan.versions[0].pages, ['https://example/a.pdf']);
});
