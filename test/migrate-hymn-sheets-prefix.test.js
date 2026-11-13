const { test } = require('node:test');
const assert = require('node:assert/strict');

const Migrate = require('../scripts/migrate-hymn-sheets-prefix.js');
const Core = require('../public/hymn-sheets-core.js');

test('planHymn rewrites legacy page URLs and lists copies', () => {
    const legacy = Core.downloadUrlFor('b', 'Old Hymn/sheet.png', 't1');
    const hymn = {
        id: 'h1',
        hymn_name: 'Old Hymn',
        versions: [{name: 'Default', pages: [legacy]}],
    };
    const plan = Migrate.planHymn(hymn, 'b');
    assert.equal(plan.copies.length, 1);
    assert.equal(plan.copies[0].from, 'Old Hymn/sheet.png');
    assert.equal(plan.copies[0].to, 'hymn-sheets/Old Hymn/sheet.png');
    assert.match(plan.versions[0].pages[0], /hymn-sheets%2FOld%20Hymn%2Fsheet\.png/);
});

test('already-migrated URLs are left alone', () => {
    const url = Core.downloadUrlFor('b', 'hymn-sheets/Grace/a.png', 't2');
    const plan = Migrate.planHymn({
        id: 'h2',
        versions: [{pages: [url]}],
    }, 'b');
    assert.equal(plan.copies.length, 0);
});
