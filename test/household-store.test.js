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
                return { id: docId, path: name + '/' + docId };
            },
        };
    }
    return {
        collection,
        batch() {
            const ops = [];
            return {
                set(ref, data) { ops.push({ path: ref.path, data }); },
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
