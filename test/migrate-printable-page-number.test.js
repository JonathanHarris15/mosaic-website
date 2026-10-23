const { test } = require('node:test');
const assert = require('node:assert');

const Migrate = require('../public/migrate-printable-page-number-core.js');
const Core = require('../public/printable-core.js');

test('MS-801 — legacy wire and explicit pageNumber print the same number', () => {
    const legacySpec = {
        tag: 'p',
        text: '1',
        style: { left: '40px', top: '12px', position: 'absolute' },
        bind: {
            text: { source: 'insert_page_number', field: 'number', params: { startAt: 3 } },
            class: { source: 'insert_page_number', field: 'edgeClass' },
        },
    };
    const migrated = Migrate.migrateNode(legacySpec, Core.normalizePageNumber).node;
    const explicit = Core.buildNode({
        tag: 'p',
        text: '1',
        pageNumber: migrated.pageNumber,
    });
    assert.equal(Core.kindOf(explicit), 'page-number');
    assert.equal(Core.placePageNumber(explicit, { pageIndex: 0, numberOrigin: 0 }).text, '1');
    const fromLegacy = Core.buildNode(migrated);
    assert.equal(Core.placePageNumber(fromLegacy, { pageIndex: 0, numberOrigin: 0 }).text, '1');
});
