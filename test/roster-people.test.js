const { test } = require('node:test');
const assert = require('node:assert');

const aw = require('../functions/assignment-writes.js');

// The server's own check before a member takes a place or a Trade settles
// (takeContext). It loads only what the rules on this Role need — and since
// rules can be OR rules (ADR 0085), it has to look INSIDE their options:
//
//   • a line-up needs the people already on the team, so a caller that has the
//     roster hands it in and gets `knownPeople` back;
//   • a group rule needs the groups, wrapped in an OR rule or not;
//   • a rule across Roles names its Roles inside its options.

/**
 * @param {Record<string, Record<string, Record<string, *>>>} data collection → id → doc
 * @returns {*} just enough Firestore for takeContext
 */
function fakeDb(data) {
    /** @type {string[]} */
    const reads = [];
    const snap = (/** @type {string} */ col, /** @type {string} */ id) => ({
        id, exists: !!(data[col] || {})[id], data: () => (data[col] || {})[id],
    });
    /** @param {string} col */
    const query = col => ({
        where: () => query(col),
        get: async () => {
            reads.push(col);
            const docs = Object.keys(data[col] || {}).map(id => snap(col, id));
            return { docs };
        },
        doc: (/** @type {string} */ id) => ({
            id,
            get: async () => { reads.push(col + '/' + id); return snap(col, id); },
            collection: (/** @type {string} */ sub) => query(col + '/' + id + '/' + sub),
        }),
    });
    return {
        reads,
        collection: query,
        getAll: async (/** @type {Array<{ id: string, get: () => Promise<*> }>} */ ...refs) => Promise.all(refs.map(r => r.get())),
    };
}

const anyOf = (/** @type {Array<Record<string, *>>} */ ...conditions) => ({ kind: 'anyOf', options: [{ conditions }] });

/** @param {Record<string, *>} settings @param {Array<Record<string, *>>} [cross] */
const church = (settings, cross) => ({
    people: { ann: { name: 'Ann', sex: 'female' }, bob: { name: 'Bob', sex: 'male' } },
    roles: { r1: { slug: 'helper', name: 'Helper', family: 'servant' } },
    events: { sun: { name: 'Sunday', roleSlugs: ['helper', 'leader'], roleSettings: { helper: settings }, crossRoleRules: cross || [] } },
    relationship_groups: { g1: { typeId: 'family', memberIds: ['ann', 'bob'] } },
});
const seat = { slots: [{ id: 's1', requirement: 'either' }, { id: 's2', requirement: 'either' }] };

test('a line-up rule gets the team on the roster, once each', async () => {
    const db = fakeDb(church(Object.assign({ restrictions: [anyOf({ kind: 'lineup', sexes: ['male', 'female'] })] }, seat)));
    const roster = [{ personId: 'bob', roleSlug: 'helper' }, { personId: 'bob', roleSlug: 'helper' }, { personId: 'gone' }];
    const ctx = await aw.takeContext(db, 'ann', 'helper', '2026-11-22', 'sun', roster);
    assert.deepStrictEqual(ctx.knownPeople.map((/** @type {*} */ p) => p.id), ['bob'], 'somebody no longer stored is left out');
    assert.equal(ctx.knownPeople[0].sex, 'male');
});

test('with no line-up rule, nobody else is read', async () => {
    const db = fakeDb(church(Object.assign({ restrictions: [anyOf({ kind: 'requireTag', tagId: 'x' })] }, seat)));
    const ctx = await aw.takeContext(db, 'ann', 'helper', '2026-11-22', 'sun', [{ personId: 'bob' }]);
    assert.deepStrictEqual(ctx.knownPeople, []);
    assert.equal(db.reads.indexOf('people/bob'), -1);
});

test('a group rule inside an OR rule still loads the groups', async () => {
    const db = fakeDb(church(Object.assign({ restrictions: [anyOf({ kind: 'notSameGroup', typeId: 'family' })] }, seat)));
    const ctx = await aw.takeContext(db, 'ann', 'helper', '2026-11-22', 'sun');
    assert.ok(ctx.groups.length > 0, 'the groups were never loaded, so the rule would permit everybody');
});

test('an OR rule across Roles that names this Role is kept', async () => {
    const cross = [anyOf({ kind: 'lineup', roleSlug: 'helper', sexes: ['male', 'male'] }, { kind: 'lineup', roleSlug: 'leader', sexes: ['female'] })];
    const db = fakeDb(church(Object.assign({ restrictions: [] }, seat), cross));
    const ctx = await aw.takeContext(db, 'ann', 'helper', '2026-11-22', 'sun');
    assert.equal(ctx.crossRoleRules.length, 1);
});

test('a rule across Roles that does not name this Role is not its business', async () => {
    const cross = [anyOf({ kind: 'lineup', roleSlug: 'leader', sexes: ['female'] })];
    const db = fakeDb(church(Object.assign({ restrictions: [] }, seat), cross));
    const ctx = await aw.takeContext(db, 'ann', 'helper', '2026-11-22', 'sun');
    assert.equal(ctx.crossRoleRules.length, 0);
});
