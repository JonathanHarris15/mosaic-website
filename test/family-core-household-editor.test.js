const { test } = require('node:test');
const assert = require('node:assert');

const Family = require('../public/family-core.js');

// MS-709. A Household is husband + wife (either may be empty) + unmarried
// children; a married child has their own. Fixture, three generations:
//   famG: Amb(m) + Hat(f) → Tob
//   famO: Osw(m) + Mae(f) → Pet
//   famH: Tob + Pet → Lin, Iri, The      (Lin married Nel in famL)
//   famL: Lin + Nel → Pip
const people = [
    ['amb', 'male'], ['hat', 'female'], ['osw', 'male'], ['mae', 'female'],
    ['tob', 'male'], ['pet', 'female'], ['lin', 'male'], ['nel', 'female'],
    ['iri', 'female'], ['the', 'male'], ['pip', 'male'],
    ['jun', 'female'], ['kai', 'male'], ['ren', null],
].map(([id, sex]) => ({ id, name: id, sex }));
const byId = id => people.find(p => p.id === id) || null;

function fixture() {
    return [
        { id: 'famG', husbandId: 'amb', wifeId: 'hat', childIds: ['tob'] },
        { id: 'famO', husbandId: 'osw', wifeId: 'mae', childIds: ['pet'] },
        { id: 'famH', husbandId: 'tob', wifeId: 'pet', childIds: ['lin', 'iri', 'the'], anniversary: '1994-06-18' },
        { id: 'famL', husbandId: 'lin', wifeId: 'nel', childIds: ['pip'] },
    ];
}

test('householdOf is the marriage, else the Household grown up in', () => {
    const f = fixture();
    assert.strictEqual(Family.householdOf(f, 'lin').id, 'famL', 'married: their own');
    assert.strictEqual(Family.householdOf(f, 'iri').id, 'famH', 'unmarried child: their parents’');
    assert.strictEqual(Family.householdOf(f, 'jun'), null);
});

test('householdView splits children at home from children with their own Household', () => {
    const f = fixture();
    const v = Family.householdView(f, f[2]);
    assert.deepStrictEqual(v.atHome, ['iri', 'the']);
    assert.deepStrictEqual(v.ownHousehold, [{ personId: 'lin', familyId: 'famL' }]);
    assert.strictEqual(v.husbandId, 'tob');
    assert.strictEqual(v.anniversary, '1994-06-18');
});

test('a Household with no children is valid, and so is a single parent', () => {
    const f = [{ id: 'x', husbandId: null, wifeId: 'jun', childIds: [] }];
    const v = Family.householdView(f, f[0]);
    assert.deepStrictEqual([v.husbandId, v.wifeId, v.atHome, v.ownHousehold], [null, 'jun', [], []]);
});

test('householdCandidates: husbands are unmarried men, wives unmarried women, children have no other parents', () => {
    const f = fixture();
    const fresh = null;
    const ids = list => list.map(p => p.id).sort();
    assert.deepStrictEqual(ids(Family.householdCandidates(f, people, fresh, 'husbandId')), ['kai', 'pip', 'the']);
    assert.deepStrictEqual(ids(Family.householdCandidates(f, people, fresh, 'wifeId')), ['iri', 'jun']);
    assert.deepStrictEqual(ids(Family.householdCandidates(f, people, f[2], 'child')), ['amb', 'hat', 'jun', 'kai', 'mae', 'nel', 'osw', 'ren']);
});

test('planSetParent creates a Household from its first parent', () => {
    const plan = Family.planSetParent(fixture(), null, 'wifeId', 'jun', byId);
    assert.strictEqual(plan.action, 'create');
    assert.deepStrictEqual(plan.changes, { wifeId: 'jun', childIds: [] });
});

test('planSetParent seats a spouse, and refuses the wrong sex or a second marriage', () => {
    const f = [{ id: 'x', husbandId: null, wifeId: 'jun', childIds: [] }].concat(fixture());
    assert.deepStrictEqual(Family.planSetParent(f, 'x', 'husbandId', 'kai', byId).changes, { husbandId: 'kai' });
    assert.strictEqual(Family.planSetParent(f, 'x', 'husbandId', 'iri', byId).valid, false, 'a woman is not a husband');
    assert.strictEqual(Family.planSetParent(f, 'x', 'husbandId', 'ren', byId).valid, false, 'unset sex fails closed');
    assert.strictEqual(Family.planSetParent(f, 'x', 'husbandId', 'tob', byId).valid, false, 'already married');
});

test('emptying the last seat of a Household with nobody else deletes it', () => {
    const f = [{ id: 'x', husbandId: null, wifeId: 'jun', childIds: [] }];
    const plan = Family.planSetParent(f, 'x', 'wifeId', null, byId);
    assert.strictEqual(plan.action, 'delete');
    assert.strictEqual(plan.familyId, 'x');
    const kept = Family.planSetParent(fixture(), 'famH', 'husbandId', null, byId);
    assert.deepStrictEqual([kept.action, kept.changes], ['update', { husbandId: null }]);
});

test('planAddChild adds a child who has no other parents, and needs a Household to add to', () => {
    const f = fixture();
    assert.deepStrictEqual(Family.planAddChild(f, 'famH', 'kai').changes, { childIds: ['lin', 'iri', 'the', 'kai'] });
    assert.strictEqual(Family.planAddChild(f, 'famH', 'pip').valid, false, 'Pip already has parents');
    assert.strictEqual(Family.planAddChild(f, 'famH', 'tob').valid, false, 'a parent is not a child');
    assert.strictEqual(Family.planAddChild(f, null, 'kai').valid, false);
});

test('planRemoveChild takes one child out and leaves the rest', () => {
    const plan = Family.planRemoveChild(fixture(), 'famH', 'iri');
    assert.deepStrictEqual(plan.changes, { childIds: ['lin', 'the'] });
    assert.strictEqual(Family.planRemoveChild(fixture(), 'famH', 'pip').valid, false);
});

test('planSetAnniversary writes the date or clears it', () => {
    assert.deepStrictEqual(Family.planSetAnniversary(fixture(), 'famH', '').changes, { anniversary: null });
    assert.deepStrictEqual(Family.planSetAnniversary(fixture(), 'famH', '2001-02-03').changes, { anniversary: '2001-02-03' });
});

test('familyTree hangs a married child’s Household beneath them, and puts the parents’ origins above', () => {
    const t = Family.familyTree(fixture(), 'famH');
    assert.deepStrictEqual(t.root.children.map(c => c.personId), ['lin', 'iri', 'the']);
    const lin = t.root.children[0].household;
    assert.strictEqual(lin.familyId, 'famL');
    assert.deepStrictEqual(lin.children, [{ personId: 'pip', household: null }]);
    assert.strictEqual(t.root.children[1].household, null);
    assert.deepStrictEqual(t.origins.map(o => [o.forPersonId, o.familyId]), [['tob', 'famG'], ['pet', 'famO']]);
});

test('familyTree draws each Household once, even when records loop', () => {
    const f = [
        { id: 'a', husbandId: 'tob', wifeId: 'pet', childIds: ['lin'] },
        { id: 'b', husbandId: 'lin', wifeId: 'nel', childIds: ['tob'] },
    ];
    const t = Family.familyTree(f, 'a');
    const tob = t.root.children[0].household.children[0];
    assert.deepStrictEqual(tob, { personId: 'tob', household: null });
    assert.strictEqual(Family.familyTree(f, 'missing'), null);
});

// A mother left recorded twice: alone with one child, and with her husband and
// the rest. The first child is then joined to her only.
function splitFixture() {
    return [
        { id: 'famSolo', wifeId: 'jun', childIds: ['iri'] },
        { id: 'famBoth', husbandId: 'kai', wifeId: 'jun', childIds: ['the'], anniversary: '2001-05-05' },
        { id: 'famO', husbandId: 'osw', wifeId: 'mae', childIds: [] },
        { id: 'famOther', husbandId: 'osw', wifeId: 'nel', childIds: ['pip'] },
    ];
}

test('householdOf picks the record with both parents when someone is seated twice', () => {
    assert.strictEqual(Family.householdOf(splitFixture(), 'jun').id, 'famBoth');
    assert.strictEqual(Family.householdOf(splitFixture(), 'iri').id, 'famSolo', 'the stranded child still reads their record');
});

test('householdDuplicates finds the other record, and only offers a merge when the parents agree', () => {
    const f = splitFixture();
    assert.deepStrictEqual(Family.householdDuplicates(f, f[1]), [
        { familyId: 'famSolo', sharedIds: ['jun'], childIds: ['iri'], mergeable: true },
    ]);
    assert.deepStrictEqual(Family.householdDuplicates(f, f[2]), [
        { familyId: 'famOther', sharedIds: ['osw'], childIds: ['pip'], mergeable: false },
    ], 'a different wife is a second marriage, not a duplicate');
    assert.deepStrictEqual(Family.householdDuplicates(fixture(), fixture()[2]), []);
});

test('planMergeHouseholds joins both parents to every child and deletes the leftover', () => {
    const plan = Family.planMergeHouseholds(splitFixture(), 'famBoth', 'famSolo');
    assert.strictEqual(plan.valid, true);
    assert.strictEqual(plan.action, 'merge');
    assert.strictEqual(plan.familyId, 'famBoth');
    assert.strictEqual(plan.deleteId, 'famSolo');
    assert.deepStrictEqual(plan.changes, { husbandId: 'kai', wifeId: 'jun', childIds: ['the', 'iri'], anniversary: '2001-05-05' });

    const reverse = Family.planMergeHouseholds(splitFixture(), 'famSolo', 'famBoth');
    assert.deepStrictEqual(reverse.changes.husbandId, 'kai', 'an empty seat is filled from the other record');

    assert.strictEqual(Family.planMergeHouseholds(splitFixture(), 'famO', 'famOther').valid, false, 'different wives');
    assert.strictEqual(Family.planMergeHouseholds(splitFixture(), 'famBoth', 'famO').valid, false, 'no shared parent');
});
