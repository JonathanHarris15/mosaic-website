const { test } = require('node:test');
const assert = require('node:assert');

const Household = require('../public/household-core.js');

const people = [
    { id: 'alice', name: 'Alice Harris' },
    { id: 'bob', name: 'Bob Harris' },
    { id: 'kid', name: 'Sam Harris' },
    { id: 'other', name: 'Maya Nguyen' },
    { id: 'solo', name: 'Jordan Blake' },
];
const families = [
    { id: 'harrises', husbandId: 'bob', wifeId: 'alice', childIds: ['kid'] },
    { id: 'nguyen', wifeId: 'other', childIds: [] },
];

test('a Family projects as a named Household of its members', () => {
    const households = Household.householdsFromDirectory(people, families);
    const harris = households.find(h => h.id === 'family:harrises');
    assert.ok(harris);
    assert.strictEqual(harris.name, 'The Harris Household');
    assert.deepStrictEqual(harris.members.map(m => m.personId), ['bob', 'alice', 'kid']);
    assert.strictEqual(harris.members.find(m => m.personId === 'kid').kid, true);
    assert.strictEqual(harris.members.find(m => m.personId === 'bob').kid, false);
});

// MS-704: a child who marries is still in their parents' Family — that is
// kinship — but the marriage carves them out a Household of their own. The
// parents' Family being read first must not seat them back home as a Kid.
test('a married child is housed with their spouse, not in the Household they grew up in', () => {
    const folk = [
        { id: 'pa', name: 'Tobias Quill' }, { id: 'ma', name: 'Petra Quill' },
        { id: 'son', name: 'Linus Quill' }, { id: 'sis', name: 'Iris Quill' },
        { id: 'bride', name: 'Nell Quill' },
    ];
    const fams = [
        { id: 'origin', husbandId: 'pa', wifeId: 'ma', childIds: ['son', 'sis'] },
        { id: 'newlyweds', husbandId: 'son', wifeId: 'bride', childIds: [] },
    ];
    for (const order of [fams, fams.slice().reverse()]) {
        const households = Household.householdsFromDirectory(folk, order);
        const home = households.find(h => h.id === 'family:origin');
        const theirs = households.find(h => h.id === 'family:newlyweds');
        assert.deepStrictEqual(home.members.map(m => m.personId), ['pa', 'ma', 'sis']);
        assert.deepStrictEqual(theirs.members.map(m => m.personId), ['son', 'bride']);
        assert.strictEqual(theirs.members.find(m => m.personId === 'son').kid, false);
    }
});

// MS-709 (ADR-0075): the kiosk groups by the Household records alone. A
// grouping left behind in the old `households` collection seats nobody.
test('a grouping in the old kiosk collection no longer puts anybody together', () => {
    const folk = [{ id: 'v1', name: 'Wren' }, { id: 'v2', name: 'Otto' }];
    const stored = [{ id: 'hh-old', name: 'The Pell Household', memberIds: ['v1', 'v2'] }];
    const households = Household.householdsFromDirectory(folk, [], stored);
    assert.deepStrictEqual(households.map(h => h.id), ['person:v1', 'person:v2']);
});

test('a Person left in two records by older edits is placed once, in the one with both parents', () => {
    const folk = [
        { id: 'ma', name: 'Petra Quill' }, { id: 'pa', name: 'Tobias Quill' },
        { id: 'a', name: 'Iris Quill' }, { id: 'b', name: 'Linus Quill' },
    ];
    const fams = [
        { id: 'alone', wifeId: 'ma', childIds: ['a'] },
        { id: 'both', husbandId: 'pa', wifeId: 'ma', childIds: ['b'] },
    ];
    const households = Household.householdsFromDirectory(folk, fams);
    assert.deepStrictEqual(households.find(h => h.id === 'family:both').members.map(m => m.personId), ['pa', 'ma', 'b']);
    assert.deepStrictEqual(households.find(h => h.id === 'family:alone').members.map(m => m.personId), ['a']);
    assert.strictEqual(households.filter(h => h.members.some(m => m.personId === 'ma')).length, 1);
});

test('a projection names its record or its Person, and carries sex for seating', () => {
    const households = Household.householdsFromDirectory(
        [{ id: 'bob', name: 'Bob Harris', sex: 'male' }, { id: 'solo', name: 'Jordan Blake' }],
        [{ id: 'f1', husbandId: 'bob', childIds: [] }]);
    const harris = households.find(h => h.id === 'family:f1');
    assert.strictEqual(harris.familyId, 'f1');
    assert.strictEqual(harris.members[0].sex, 'male');
    assert.strictEqual(households.find(h => h.id === 'person:solo').personId, 'solo');
});

test('a Person in no Family still appears as their own Household', () => {
    const households = Household.householdsFromDirectory(people, families);
    const solo = households.find(h => h.id === 'person:solo');
    assert.ok(solo);
    assert.strictEqual(solo.name, 'The Blake Household');
    assert.deepStrictEqual(solo.members.map(m => m.personId), ['solo']);
});

test('typing a surname returns every matching Household', () => {
    const households = Household.householdsFromDirectory(people, families);
    const hits = Household.searchHouseholds(households, 'Harris');
    assert.deepStrictEqual(hits.map(h => h.id).sort(), ['family:harrises']);
});

test('typing a full name returns the Household that person belongs to', () => {
    const households = Household.householdsFromDirectory(people, families);
    const hits = Household.searchHouseholds(households, 'Maya Nguyen');
    assert.strictEqual(hits.length, 1);
    assert.strictEqual(hits[0].id, 'family:nguyen');
});

test('typing a given name returns the Household that person belongs to', () => {
    const households = Household.householdsFromDirectory(people, families);
    const hits = Household.searchHouseholds(households, 'Alice');
    assert.deepStrictEqual(hits.map(h => h.id), ['family:harrises']);
});

test('a name nobody has returns no Households', () => {
    const households = Household.householdsFromDirectory(people, families);
    assert.deepStrictEqual(Household.searchHouseholds(households, 'Nobodyhere'), []);
});

test('an empty query does not dump the directory', () => {
    const households = Household.householdsFromDirectory(people, families);
    assert.deepStrictEqual(Household.searchHouseholds(households, '  '), []);
    assert.deepStrictEqual(Household.searchHouseholds(households, ''), []);
});

test('creating a Household needs a name and a sex on every person', () => {
    assert.strictEqual(Household.createFault([]), 'Add at least one person.');
    assert.strictEqual(Household.createFault([{ name: 'Ada', sex: '' }]),
        'Say whether each person is male or female.');
    assert.strictEqual(Household.createFault([{ name: 'Ada', sex: 'female', kid: false }]), '');
});

test('a new Person from the kiosk starts as a Visitor', () => {
    const doc = Household.personWrite({ name: 'Ada Cole', phone: '555', sex: 'female', kid: true }, 't');
    assert.strictEqual(doc.membership.stage, 'visitor');
    assert.deepStrictEqual(doc.tags, ['Visitor']);
    assert.strictEqual(doc.kid, true);
    assert.strictEqual(doc.contact.phone, '555');
    assert.strictEqual(doc.nameParts, undefined);
});

test('a new person entered in parts stores the full name and remembers the parts beside it', () => {
    const doc = Household.personWrite({
        firstName: 'Jonathan', lastName: 'Harris', suffix: 'Jr.',
        phone: '', sex: 'male', kid: false,
    }, 't');
    assert.strictEqual(doc.name, 'Jonathan Harris Jr.');
    assert.deepStrictEqual(doc.nameParts, {
        firstName: 'Jonathan', lastName: 'Harris', suffix: 'Jr.', noLastName: false,
    });
    assert.strictEqual(doc.firstName, undefined);
    assert.strictEqual(doc.lastName, undefined);
});

test('a spare person row is ignored, and a last name without a first name is refused', () => {
    assert.strictEqual(Household.createFault([
        { firstName: '', lastName: '', suffix: '', sex: '' },
    ]), 'Add at least one person.');
    assert.strictEqual(Household.createFault([
        { firstName: '', lastName: 'Harris', suffix: '', sex: 'male' },
    ]), 'A new person needs a first name.');
    assert.strictEqual(Household.createFault([
        { firstName: 'Ada', lastName: '', noLastName: false, sex: 'female' },
    ]), 'A new person needs a last name, or mark that they have none.');
    assert.strictEqual(Household.createFault([
        { firstName: '', lastName: '', suffix: '', sex: '' },
        { firstName: 'Ada', lastName: 'Cole', suffix: '', noLastName: false, sex: 'female' },
    ]), '');
});

test('a remembered last name names the projected Household, not the suffix', () => {
    const households = Household.householdsFromDirectory(
        [{
            id: 'jon',
            name: 'Jonathan Harris Jr.',
            nameParts: { firstName: 'Jonathan', lastName: 'Harris', suffix: 'Jr.', noLastName: false },
        }],
        []
    );
    const solo = households.find(h => h.id === 'person:jon');
    assert.strictEqual(solo.name, 'The Harris Household');
});

test('a Household already called that is found, whatever the spacing or case', () => {
    const households = Household.householdsFromDirectory(people, families);
    const twin = Household.duplicateOf(households, '  the   harris household ', null);
    assert.ok(twin);
    assert.strictEqual(twin.id, 'family:harrises');
    assert.strictEqual(Household.duplicateOf(households, 'The Okafor Household', null), null);
    assert.strictEqual(Household.duplicateOf(households, '', null), null);
});

test('a Household is not its own duplicate', () => {
    const list = [{ id: 'hh1', name: 'The Harris Household' }];
    assert.strictEqual(Household.duplicateOf(list, 'The Harris Household', 'hh1'), null);
});

// ── MS-685: the Kid toggle is the Person's, and it is the last word ─────────

test('unticking Kid on the Person outranks being a child on their Family', () => {
    const directory = [
        { id: 'bob', name: 'Bob Harris' },
        { id: 'sam', name: 'Sam Harris', kid: false },
    ];
    const harris = Household.householdsFromDirectory(
        directory, [{ id: 'f1', husbandId: 'bob', childIds: ['sam'] }], []
    ).find(h => h.id === 'family:f1');
    assert.strictEqual(harris.members.find(m => m.personId === 'sam').kid, false);
});

test('a Family child nobody has answered for is still a Kid on day one', () => {
    // The projection is the FALLBACK, not the override. A directory child whose
    // Kid box has never been touched still gets the child tag and the stub.
    const directory = [
        { id: 'bob', name: 'Bob Harris' },
        { id: 'sam', name: 'Sam Harris' },
    ];
    const harris = Household.householdsFromDirectory(
        directory, [{ id: 'f1', husbandId: 'bob', childIds: ['sam'] }], []
    ).find(h => h.id === 'family:f1');
    assert.strictEqual(harris.members.find(m => m.personId === 'sam').kid, true);
});

test('adding somebody already in the household is named, not silently allowed', () => {
    const household = { id: 'hh', name: 'The Harris Household', members: [{ personId: 'bob', name: 'Bob Harris' }] };
    assert.deepStrictEqual(Household.repeatedNames(household, [{ name: 'bob harris' }]), ['Bob Harris']);
    assert.deepStrictEqual(Household.repeatedNames(household, [{ name: 'Rory Harris' }]), []);
});

// ── What a kiosk draft writes to `families` (MS-709) ────────────────────────

const add = (personId, sex, role) => ({ personId, sex, role });

test('a new Household seats the parents by sex and the rest as children', () => {
    const plan = Household.householdRecordFor(null, [add('w', 'female', 'parent'), add('h', 'male', 'parent'), add('k', 'female', 'child')], []);
    assert.deepStrictEqual(plan, { action: 'create', changes: { husbandId: 'h', wifeId: 'w', childIds: ['k'] } });
});

test('a single parent and a child is a Household record with one seat empty', () => {
    const plan = Household.householdRecordFor(null, [add('w', 'female', 'parent'), add('k', 'male', 'child')], []);
    assert.deepStrictEqual(plan.changes, { husbandId: null, wifeId: 'w', childIds: ['k'] });
});

test('one new Person on their own needs no record', () => {
    assert.deepStrictEqual(Household.householdRecordFor(null, [add('a', 'male', 'parent')], []), { action: 'none' });
});

test('two men as parents, or children with no parent, are refused', () => {
    assert.match(Household.householdRecordFor(null, [add('a', 'male', 'parent'), add('b', 'male', 'parent')], []).fault, /already has a husband/);
    assert.match(Household.householdRecordFor(null, [add('a', 'male', 'child'), add('b', 'male', 'child')], []).fault, /at least one person as a parent/);
});

test('adding to a Household fills an empty seat or appends a child, and never takes a seat', () => {
    const fams = [{ id: 'f', wifeId: 'w', childIds: ['k1'] }];
    const target = { id: 'family:f', familyId: 'f', members: [] };
    assert.deepStrictEqual(Household.householdRecordFor(target, [add('h', 'male', 'parent'), add('k2', 'male', 'child')], fams),
        { action: 'update', familyId: 'f', changes: { husbandId: 'h', wifeId: 'w', childIds: ['k1', 'k2'] } });
    assert.match(Household.householdRecordFor(target, [add('w2', 'female', 'parent')], fams).fault, /already has a wife/);
});

test('adding to a Person on their own seats them with the newcomers; a Kid on their own is the child', () => {
    const mum = { id: 'person:m', personId: 'm', members: [{ personId: 'm', sex: 'female', kid: false }] };
    assert.deepStrictEqual(Household.householdRecordFor(mum, [add('k', 'male', 'child')], []).changes,
        { husbandId: null, wifeId: 'm', childIds: ['k'] });
    const kid = { id: 'person:k', personId: 'k', members: [{ personId: 'k', sex: 'male', kid: true }] };
    assert.deepStrictEqual(Household.householdRecordFor(kid, [add('m', 'female', 'parent')], []).changes,
        { husbandId: null, wifeId: 'm', childIds: ['k'] });
});

test('a record that changed under the draft is refused rather than guessed at', () => {
    assert.match(Household.householdRecordFor({ familyId: 'gone', members: [] }, [add('a', 'male', 'child')], []).fault, /has changed/);
});

test('the draft is checked before anybody is written', () => {
    const rows = [
        Object.assign(Household.emptyCreatePerson(), { firstName: 'Al', lastName: 'Ng', sex: 'male' }),
        Object.assign(Household.emptyCreatePerson(), { firstName: 'Bo', lastName: 'Ng', sex: 'male' }),
    ];
    assert.match(Household.draftRecordFault(null, rows, []), /already has a husband/);
    rows[1].role = 'child';
    assert.strictEqual(Household.draftRecordFault(null, rows, []), '');
});

test('a blank row is a parent until Kid says child', () => {
    assert.strictEqual(Household.emptyCreatePerson().role, 'parent');
    assert.strictEqual(Household.roleOf({ kid: true }), 'child');
    assert.strictEqual(Household.roleOf({ kid: true, role: 'parent' }), 'parent');
});

test('a name left as it was writes nothing; a changed one writes the name and its parts', () => {
    const bob = { id: 'bob', name: 'Bob Harris' };
    assert.deepStrictEqual(Household.renameWrite(bob, { firstName: 'Bob', lastName: 'Harris', suffix: '', noLastName: false }, 't'), { unchanged: true });
    assert.deepStrictEqual(Household.renameWrite(bob, { firstName: 'Rob', lastName: 'Harris', suffix: '', noLastName: false }, 't').patch,
        { name: 'Rob Harris', nameParts: { firstName: 'Rob', lastName: 'Harris', suffix: '', noLastName: false }, updatedAt: 't' });
    assert.ok(Household.renameWrite(bob, { firstName: '', lastName: 'Harris' }, 't').fault);
});
