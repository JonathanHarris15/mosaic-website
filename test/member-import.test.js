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
    // Non-aliased fixture names, so this tests plain exact matching.
    const rows = Import.parseCsv('Person ID,Name,Status,Primary Phone Number,Anniversary,Birthday (without year),Birthdate\n1,Jane Roe,,,,,\n2,John Doe,,,,,');
    const existing = [{ id: 'p1', name: 'Jane Roe', tags: [] }];
    const plan = Import.classifyRows(rows, existing);
    const byName = Object.fromEntries(plan.map(p => [p.row.Name, p]));
    assert.strictEqual(byName['Jane Roe'].action, 'update');
    assert.strictEqual(byName['Jane Roe'].matchId, 'p1');
    assert.strictEqual(byName['John Doe'].action, 'create');
});

test('a confirmed alias matches a CSV nickname to the canonical DB name', () => {
    // "Max Maret" in the CSV is "Maxwell Maret" in the DB (the DB spelling wins).
    const rows = Import.parseCsv('Person ID,Name,Status,Primary Phone Number,Anniversary,Birthday (without year),Birthdate\n1,Max Maret,,(111) 111-1111,,,');
    const existing = [{ id: 'pm', name: 'Maxwell Maret', tags: [] }];
    const plan = Import.classifyRows(rows, existing);
    assert.strictEqual(plan[0].action, 'update');
    assert.strictEqual(plan[0].matchId, 'pm');
});

test('classifyRows flags an ambiguous name (multiple matches) instead of merging', () => {
    const rows = Import.parseCsv('Person ID,Name,Status,Primary Phone Number,Anniversary,Birthday (without year),Birthdate\n1,Jane Roe,,,,,');
    const existing = [
        { id: 'p1', name: 'Jane Roe', tags: [] },
        { id: 'p2', name: 'jane  roe', tags: [] }, // duplicate, differently cased/spaced
    ];
    const plan = Import.classifyRows(rows, existing);
    const jane = plan.find(p => p.row.Name === 'Jane Roe');
    assert.strictEqual(jane.action, 'ambiguous');
    assert.strictEqual(jane.matchId, null);
});

test('buildPersonFromRow fills only contact/birthday/anniversary — never stage or tags', () => {
    const rows = Import.parseCsv(CSV);
    const fields = Import.buildPersonFromRow(rows[0]);
    assert.strictEqual(fields['contact.phone'], '(816) 520-0262');
    assert.strictEqual(fields.birthday, '1995-01-27');
    assert.strictEqual(fields.importedAnniversary, '04/18/2021');
    // Membership stage and tags are owned by the Track migration, not the import.
    for (const key of Object.keys(fields)) {
        assert.ok(!/membership|tags|stage/i.test(key), `import must not touch ${key}`);
    }
});

test('buildPersonFromRow omits any field the CSV leaves blank (never blanks existing data)', () => {
    const rows = Import.parseCsv(CSV);
    const visitor = Import.buildPersonFromRow(rows[2]); // New Visitor row, blanks
    assert.ok(!('birthday' in visitor));
    assert.ok(!('importedAnniversary' in visitor));
    assert.ok(!('contact.phone' in visitor));
});
