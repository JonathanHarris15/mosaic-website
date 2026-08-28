const { test } = require('node:test');
const assert = require('node:assert');

const Store = require('../public/household-store.js');

function fakeDb() {
    let n = 0;
    const writes = [];
    function collection(name) {
        return {
            async get() {
                return { docs: [] };
            },
            doc(id) {
                const docId = id || ('auto' + (++n));
                return {
                    id: docId,
                    path: name + '/' + docId,
                    async set(data, opts) { writes.push({ path: name + '/' + docId, data, opts }); },
                };
            },
        };
    }
    return {
        collection,
        batch() {
            const ops = [];
            return {
                set(ref, data, opts) { ops.push({ path: ref.path, data, opts }); },
                async commit() { writes.push(...ops); },
            };
        },
        _writes: writes,
    };
}

test('creating a Household writes the people and the household in one batch', async () => {
    const db = fakeDb();
    const created = await Store.createHousehold(db, {
        name: 'The Cole Household',
        now: 't',
        people: [
            { name: 'Ada Cole', phone: '555', sex: 'female', kid: false },
            { name: 'Pip Cole', phone: '', sex: 'male', kid: true },
        ],
    });
    assert.strictEqual(created.name, 'The Cole Household');
    assert.strictEqual(created.members.length, 2);
    assert.strictEqual(db._writes.length, 3);
    assert.ok(db._writes.some(w => w.path.startsWith('households/')));
    const pip = db._writes.find(w => w.data && w.data.kid === true);
    assert.strictEqual(pip.data.membership.stage, 'visitor');
});

test('the kiosk refuses to create a Household with nobody in it', async () => {
    const db = fakeDb();
    await assert.rejects(() => Store.createHousehold(db, { people: [] }), /at least one person/);
});

// ── Minting and growing a Household (MS-321, ADR-0044) ──────────────────────

const projection = () => ({
    id: 'family:harrises',
    name: 'The Harris Household',
    stored: false,
    members: [
        { personId: 'bob', name: 'Bob Harris', kid: false },
        { personId: 'alice', name: 'Alice Harris', kid: false },
    ],
});

test('minting a projection writes it under the projection id', async () => {
    const db = fakeDb();
    const minted = await Store.mintHousehold(db, projection(), 't');
    assert.strictEqual(minted.id, 'family:harrises');
    assert.strictEqual(minted.stored, true);
    assert.strictEqual(db._writes.length, 1);
    assert.strictEqual(db._writes[0].path, 'households/family:harrises');
    assert.deepStrictEqual(db._writes[0].data.memberIds, ['bob', 'alice']);
    assert.strictEqual(db._writes[0].data.mintedFrom, 'family:harrises');
});

test('minting a Household that is already stored writes nothing', async () => {
    const db = fakeDb();
    const stored = Object.assign(projection(), { id: 'hh1', stored: true });
    await Store.mintHousehold(db, stored, 't');
    assert.strictEqual(db._writes.length, 0);
});

test('adding a brother to a projected Household mints it instead of making a second', async () => {
    const db = fakeDb();
    const saved = await Store.addPeopleToHousehold(db, projection(), {
        now: 't',
        people: [{ name: 'Rory Harris', phone: '', sex: 'male', kid: false }],
    });
    assert.strictEqual(saved.id, 'family:harrises');
    assert.strictEqual(saved.members.length, 3);
    const house = db._writes.find(w => w.path === 'households/family:harrises');
    assert.ok(house, 'the household was written under its own id');
    assert.deepStrictEqual(house.data.memberIds.slice(0, 2), ['bob', 'alice']);
    assert.strictEqual(house.data.name, 'The Harris Household');
    const person = db._writes.find(w => w.path.startsWith('people/'));
    assert.strictEqual(person.data.membership.stage, 'visitor');
});

test('adding to a stored Household keeps its createdAt and only merges', async () => {
    const db = fakeDb();
    const stored = Object.assign(projection(), { id: 'hh1', stored: true });
    await Store.addPeopleToHousehold(db, stored, {
        now: 't2',
        people: [{ name: 'Rory Harris', phone: '', sex: 'male', kid: false }],
    });
    const house = db._writes.find(w => w.path === 'households/hh1');
    assert.strictEqual(house.data.createdAt, undefined);
    assert.strictEqual(house.data.updatedAt, 't2');
    assert.deepStrictEqual(house.opts, { merge: true });
});

test('adding nobody to a Household is refused', async () => {
    const db = fakeDb();
    await assert.rejects(() => Store.addPeopleToHousehold(db, projection(), { people: [] }),
        /at least one person/);
});
