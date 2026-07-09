const { test } = require('node:test');
const assert = require('node:assert');

const Import = require('../scripts/import-members.js');

// MS-90: the member CSV seed. These pin the pure classification and Person-build
// logic (the Firestore side only runs when the script is executed directly).

const CSV = [
    'Person ID,Name,Status,Primary Phone Number,Anniversary,Birthday (without year),Birthdate',
    '111,Max Maret,Complete (Clear),(816) 520-0262,04/18/2021,Jan 27,01/27/1995',
    '222,Elizabeth Maret,Complete (Clear),(940) 867-6038,04/18/2021,Nov 07,11/07/1998',
    '333,New Visitor,Expired invitation,,,,',
].join('\n');

test('parseCsv reads rows keyed by header', () => {
    const rows = Import.parseCsv(CSV);
    assert.strictEqual(rows.length, 3);
    assert.strictEqual(rows[0].Name, 'Max Maret');
    assert.strictEqual(rows[0]['Primary Phone Number'], '(816) 520-0262');
});

test('toIsoDate converts MM/DD/YYYY to YYYY-MM-DD, else null', () => {
    assert.strictEqual(Import.toIsoDate('01/27/1995'), '1995-01-27');
    assert.strictEqual(Import.toIsoDate('11/7/1998'), '1998-11-07');
    assert.strictEqual(Import.toIsoDate(''), null);
    assert.strictEqual(Import.toIsoDate('Jan 27'), null);
});

test('classifyRows updates on a single name match, creates when none', () => {
    const rows = Import.parseCsv(CSV);
    const existing = [{ id: 'p1', name: 'Max Maret', tags: [] }];
    const plan = Import.classifyRows(rows, existing);
    const byName = Object.fromEntries(plan.map(p => [p.row.Name, p]));
    assert.strictEqual(byName['Max Maret'].action, 'update');
    assert.strictEqual(byName['Max Maret'].matchId, 'p1');
    assert.strictEqual(byName['Elizabeth Maret'].action, 'create');
    assert.strictEqual(byName['New Visitor'].action, 'create');
});

test('classifyRows flags an ambiguous name (multiple matches) instead of merging', () => {
    const rows = Import.parseCsv(CSV);
    const existing = [
        { id: 'p1', name: 'Max Maret', tags: [] },
        { id: 'p2', name: 'max  maret', tags: [] }, // duplicate, differently cased/spaced
    ];
    const plan = Import.classifyRows(rows, existing);
    const max = plan.find(p => p.row.Name === 'Max Maret');
    assert.strictEqual(max.action, 'ambiguous');
    assert.strictEqual(max.matchId, null);
});

test('buildPersonFromRow defaults to Member stage with the Member tag and stashes anniversary', () => {
    const rows = Import.parseCsv(CSV);
    const fields = Import.buildPersonFromRow(rows[0], ['Red Flag']);
    assert.strictEqual(fields.name, 'Max Maret');
    assert.strictEqual(fields['membership.stage'], 'member');
    assert.strictEqual(fields['contact.phone'], '(816) 520-0262');
    assert.strictEqual(fields.birthday, '1995-01-27');
    assert.strictEqual(fields.importedAnniversary, '04/18/2021');
    assert.ok(fields.tags.includes('Member'), 'Member tag projected');
    assert.ok(fields.tags.includes('Red Flag'), 'existing non-membership tag preserved');
});

test('buildPersonFromRow omits birthday and anniversary when the CSV has none', () => {
    const rows = Import.parseCsv(CSV);
    const visitor = Import.buildPersonFromRow(rows[2], []); // New Visitor row, blanks
    assert.ok(!('birthday' in visitor));
    assert.ok(!('importedAnniversary' in visitor));
    assert.strictEqual(visitor['membership.stage'], 'member');
});
