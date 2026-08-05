const { test } = require('node:test');
const assert = require('node:assert');

const Server = require('../functions/family-plan.js');
const Core = require('../public/family-core.js');

// The Family write-through planners exist twice: once in public/family-core.js
// for the Membership Directory, and once in functions/family-plan.js so
// approving a Family request (ADR-0027) can replay them, because Cloud
// Functions deploy only the functions/ directory.
//
// Two copies of the household rules silently disagreeing about who is married
// to whom is exactly the failure worth spending a test on. So rather than
// checking a handful of cases by hand, this runs BOTH implementations over the
// same matrix of households, relations and people, and asserts they agree write
// for write on every one.

const PEOPLE = {
    male1: { id: 'male1', sex: 'male' },
    male2: { id: 'male2', sex: 'male' },
    female1: { id: 'female1', sex: 'female' },
    female2: { id: 'female2', sex: 'female' },
    unsexed: { id: 'unsexed', sex: null },
    kid: { id: 'kid', sex: 'male' },
};
const byId = id => PEOPLE[id] || null;
const IDS = Object.keys(PEOPLE);

// Households worth planning against: none at all, a couple, a couple with kids,
// a half-seated family, and someone with a family of origin.
const HOUSEHOLDS = [
    [],
    [{ id: 'f1', husbandId: 'male1', wifeId: 'female1', childIds: [] }],
    [{ id: 'f1', husbandId: 'male1', wifeId: 'female1', childIds: ['kid'] }],
    [{ id: 'f1', husbandId: 'male1', childIds: [] }],
    [{ id: 'f1', wifeId: 'female1', childIds: ['kid', 'male2'] }],
    [
        { id: 'f1', husbandId: 'male1', wifeId: 'female1', childIds: ['kid'] },
        { id: 'f2', husbandId: 'male2', wifeId: 'female2', childIds: [] },
    ],
];

const RELATIONS = ['spouse', 'parent', 'child', 'cousin', ''];

test('the two copies plan every ADD identically', () => {
    let compared = 0;
    for (const families of HOUSEHOLDS) {
        for (const personId of IDS) {
            for (const otherId of IDS) {
                for (const relation of RELATIONS) {
                    const a = Core.planAddFamilyRelation(families, personId, relation, otherId, byId);
                    const b = Server.planAddFamilyRelation(families, personId, relation, otherId, byId);
                    assert.deepStrictEqual(b, a,
                        `add ${relation} ${personId}→${otherId} with ${JSON.stringify(families)}`);
                    compared++;
                }
            }
        }
    }
    // A guard on the guard: if the matrix ever collapses to nothing, this test
    // would pass while checking zero cases.
    assert.ok(compared > 500, `only compared ${compared} cases`);
});

test('the two copies plan every REMOVE identically', () => {
    let compared = 0;
    for (const families of HOUSEHOLDS) {
        for (const personId of IDS) {
            for (const otherId of IDS) {
                for (const relation of RELATIONS) {
                    const a = Core.planRemoveFamilyRelation(families, personId, relation, otherId);
                    const b = Server.planRemoveFamilyRelation(families, personId, relation, otherId);
                    assert.deepStrictEqual(b, a,
                        `remove ${relation} ${personId}→${otherId} with ${JSON.stringify(families)}`);
                    compared++;
                }
            }
        }
    }
    assert.ok(compared > 500, `only compared ${compared} cases`);
});

test('the two copies agree on missing and malformed input', () => {
    const cases = [
        [null, null, 'spouse', null],
        [undefined, 'male1', 'spouse', undefined],
        [[], 'male1', 'spouse', 'male1'],
        [[], '', 'child', 'kid'],
    ];
    for (const [families, personId, relation, otherId] of cases) {
        assert.deepStrictEqual(
            Server.planAddFamilyRelation(families, personId, relation, otherId, byId),
            Core.planAddFamilyRelation(families, personId, relation, otherId, byId));
        assert.deepStrictEqual(
            Server.planRemoveFamilyRelation(families, personId, relation, otherId),
            Core.planRemoveFamilyRelation(families, personId, relation, otherId));
    }
});

test('the relation kinds match', () => {
    // FamilyCore does not export its KINDS, so this pins the server copy against
    // the behaviour instead: exactly these three plan, and nothing else does.
    assert.deepStrictEqual(Server.KINDS, ['spouse', 'parent', 'child']);
    for (const relation of Server.KINDS) {
        const plan = Core.planAddFamilyRelation([], 'male1', relation, 'female1', byId);
        assert.ok(plan.valid || plan.errors.every(e => !/is not a Family relation/.test(e)), relation);
    }
    assert.match(
        Core.planAddFamilyRelation([], 'male1', 'cousin', 'female1', byId).errors[0],
        /is not a Family relation/);
});

test('an unset sex fails closed in both copies rather than guessing a seat', () => {
    const a = Core.planAddFamilyRelation([], 'unsexed', 'spouse', 'female1', byId);
    const b = Server.planAddFamilyRelation([], 'unsexed', 'spouse', 'female1', byId);
    assert.strictEqual(a.valid, false);
    assert.deepStrictEqual(b, a);
});
