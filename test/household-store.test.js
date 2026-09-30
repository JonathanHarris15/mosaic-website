const { test } = require('node:test');
const assert = require('node:assert');

const Store = require('../public/household-store.js');

function fakeDb() {
    let n = 0;
    const writes = [];
    function collection(name) {
        return {
            doc(id) {
                const docId = id || ('auto' + (++n));
                return { id: docId, path: name + '/' + docId };
            },
        };
    }
    return {
        collection,
        batch() {
            const ops = [];
            return {
                set(ref, data, opts) { ops.push({ op: 'set', path: ref.path, data, opts }); },
                update(ref, data) { ops.push({ op: 'update', path: ref.path, data }); },
                async commit() { writes.push(...ops); },
            };
        },
        _writes: writes,
    };
}

const harris = () => ({
    id: 'family:harrises',
    familyId: 'harrises',
    name: 'The Harris Household',
    members: [
        { personId: 'bob', name: 'Bob Harris', sex: 'male', kid: false },
        { personId: 'alice', name: 'Alice Harris', sex: 'female', kid: false },
    ],
});
const families = () => [{ id: 'harrises', husbandId: 'bob', wifeId: 'alice', childIds: [] }];

test('a new couple with a kid is two People, one child, and one Household record, in one batch', async () => {
    const db = fakeDb();
    const saved = await Store.saveDraft(db, null, {
        now: 't',
        people: [
            { name: 'Ada Cole', phone: '555', sex: 'female', kid: false, role: 'parent' },
            { name: 'Rex Cole', phone: '', sex: 'male', kid: false, role: 'parent' },
            { name: 'Pip Cole', phone: '', sex: 'male', kid: true, role: 'child' },
        ],
    }, []);
    const people = db._writes.filter(w => w.path.startsWith('people/'));
    const record = db._writes.find(w => w.path.startsWith('families/'));
    assert.strictEqual(people.length, 3);
    assert.strictEqual(db._writes.some(w => w.path.startsWith('households/')), false);
    const idOf = name => people.find(w => w.data.name === name).path.split('/')[1];
    assert.deepStrictEqual(record.data, {
        husbandId: idOf('Rex Cole'), wifeId: idOf('Ada Cole'), childIds: [idOf('Pip Cole')],
    });
    assert.strictEqual(saved.id, 'family:' + record.path.split('/')[1]);
    assert.strictEqual(people.find(w => w.data.kid).data.membership.stage, 'visitor');
});

test('one new Person on their own writes no Household record', async () => {
    const db = fakeDb();
    const saved = await Store.saveDraft(db, null, {
        now: 't',
        people: [{ firstName: 'Jonas', lastName: 'Vale', suffix: 'Jr.', phone: '', sex: 'male', kid: false, role: 'parent' }],
    }, []);
    assert.strictEqual(db._writes.length, 1);
    const person = db._writes[0];
    assert.strictEqual(person.data.name, 'Jonas Vale Jr.');
    assert.strictEqual(person.data.nameParts.lastName, 'Vale');
    assert.strictEqual(person.data.firstName, undefined);
    assert.strictEqual(saved.id, 'person:' + person.path.split('/')[1]);
});

test('adding a child to a Household appends them to its record', async () => {
    const db = fakeDb();
    const saved = await Store.saveDraft(db, harris(), {
        now: 't',
        people: [{ name: 'Sam Harris', phone: '', sex: 'male', kid: true, role: 'child' }],
    }, families());
    const update = db._writes.find(w => w.path === 'families/harrises');
    assert.strictEqual(update.op, 'update');
    const sam = db._writes.find(w => w.path.startsWith('people/')).path.split('/')[1];
    assert.deepStrictEqual(update.data, { husbandId: 'bob', wifeId: 'alice', childIds: [sam] });
    assert.strictEqual(saved.id, 'family:harrises');
});

test('a second husband is refused, and nobody is written', async () => {
    const db = fakeDb();
    await assert.rejects(() => Store.saveDraft(db, harris(), {
        people: [{ name: 'Rory Harris', phone: '', sex: 'male', kid: false, role: 'parent' }],
    }, families()), /already has a husband/);
    assert.strictEqual(db._writes.length, 0);
});

test('a spouse added to a Person on their own starts a record for the two of them', async () => {
    const db = fakeDb();
    const alone = { id: 'person:bea', personId: 'bea', name: 'The Lund Household', members: [{ personId: 'bea', name: 'Bea Lund', sex: 'female', kid: false }] };
    const saved = await Store.saveDraft(db, alone, {
        people: [{ name: 'Kai Lund', phone: '', sex: 'male', kid: false, role: 'parent' }],
    }, []);
    const record = db._writes.find(w => w.path.startsWith('families/'));
    const kai = db._writes.find(w => w.path.startsWith('people/')).path.split('/')[1];
    assert.deepStrictEqual(record.data, { husbandId: kai, wifeId: 'bea', childIds: [] });
    assert.strictEqual(saved.id, 'family:' + record.path.split('/')[1]);
});

test('the kiosk refuses a draft with nobody in it', async () => {
    const db = fakeDb();
    await assert.rejects(() => Store.saveDraft(db, null, { people: [] }, []), /at least one person/);
});

test('renaming writes only the names that changed, and only the name fields', async () => {
    const db = fakeDb();
    const bob = { id: 'bob', name: 'Bob Harris', sex: 'male', contact: { phone: '1' } };
    const alice = { id: 'alice', name: 'Alice Harris' };
    const n = await Store.renamePeople(db, [
        { person: bob, entry: { firstName: 'Robert', lastName: 'Harris', suffix: '', noLastName: false } },
        { person: alice, entry: { firstName: 'Alice', lastName: 'Harris', suffix: '', noLastName: false } },
    ], 't');
    assert.strictEqual(n, 1);
    assert.deepStrictEqual(db._writes, [{
        op: 'update', path: 'people/bob',
        data: { name: 'Robert Harris', nameParts: { firstName: 'Robert', lastName: 'Harris', suffix: '', noLastName: false }, updatedAt: 't' },
    }]);
});

test('a name with no first name stops every rename in the list', async () => {
    const db = fakeDb();
    await assert.rejects(() => Store.renamePeople(db, [
        { person: { id: 'bob', name: 'Bob Harris' }, entry: { firstName: 'Robert', lastName: 'Harris' } },
        { person: { id: 'alice', name: 'Alice Harris' }, entry: { firstName: '', lastName: 'Harris' } },
    ], 't'));
    assert.strictEqual(db._writes.length, 0);
});
