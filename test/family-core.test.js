const { test } = require('node:test');
const assert = require('node:assert');

const Family = require('../public/family-core.js');

// Families (ADR-0012, MS-88) are first-class household entities; multiple
// generations are emergent from the graph, not a stored tree. A three-generation
// fixture: grandparents G1(m)+G2(f) with child P; P(m) marries S(f), their kids
// are K1, K2.
const G1 = 'g1', G2 = 'g2', P = 'p', S = 's', K1 = 'k1', K2 = 'k2';
const families = [
    { id: 'famA', husbandId: G1, wifeId: G2, childIds: [P] },              // grandparents + P
    { id: 'famB', husbandId: P, wifeId: S, childIds: [K1, K2], anniversary: '2015-06-20' }, // P & S + kids
];

test('familyOfSpouse finds the Family a Person is married into', () => {
    assert.strictEqual(Family.familyOfSpouse(families, P).id, 'famB');
    assert.strictEqual(Family.familyOfSpouse(families, S).id, 'famB');
    assert.strictEqual(Family.familyOfSpouse(families, K1), null); // a child, not yet a spouse
});

test('familyOfChild finds a Person\'s family of origin', () => {
    assert.strictEqual(Family.familyOfChild(families, P).id, 'famA');
    assert.strictEqual(Family.familyOfChild(families, K1).id, 'famB');
    assert.strictEqual(Family.familyOfChild(families, G1), null); // grandparent has no origin here
});

test('spouseOf returns the other partner', () => {
    assert.strictEqual(Family.spouseOf(families[1], P), S);
    assert.strictEqual(Family.spouseOf(families[1], S), P);
});

test('resolveRelations spans generations for a Person who is both child and spouse', () => {
    // P is a child in famA AND a spouse in famB — the multigeneration link.
    const rel = Family.resolveRelations(families, P);
    assert.strictEqual(rel.spouseId, S);
    assert.deepStrictEqual(rel.childIds, [K1, K2]);
    assert.deepStrictEqual(rel.parentIds.sort(), [G1, G2].sort());
    assert.strictEqual(rel.familyId, 'famB');
    assert.strictEqual(rel.originFamilyId, 'famA');
});

test('resolveRelations for a youngest-generation child gives parents, no kids', () => {
    const rel = Family.resolveRelations(families, K1);
    assert.deepStrictEqual(rel.parentIds.sort(), [P, S].sort());
    assert.deepStrictEqual(rel.childIds, []);
    assert.strictEqual(rel.spouseId, null);
});

test('resolveRelations for an oldest-generation spouse gives kids, no parents', () => {
    const rel = Family.resolveRelations(families, G1);
    assert.strictEqual(rel.spouseId, G2);
    assert.deepStrictEqual(rel.childIds, [P]);
    assert.deepStrictEqual(rel.parentIds, []);
});

test('partial families are allowed — a widow with children, no husband', () => {
    const partial = [{ id: 'famW', wifeId: 'w', childIds: ['c1'] }];
    const rel = Family.resolveRelations(partial, 'w');
    assert.strictEqual(rel.spouseId, null);
    assert.deepStrictEqual(rel.childIds, ['c1']);
    const child = Family.resolveRelations(partial, 'c1');
    assert.deepStrictEqual(child.parentIds, ['w']);
});

test('spouseSexOk enforces husband=male, wife=female, and fails closed on unset sex', () => {
    assert.strictEqual(Family.spouseSexOk({ sex: 'male' }, 'husband'), true);
    assert.strictEqual(Family.spouseSexOk({ sex: 'female' }, 'wife'), true);
    assert.strictEqual(Family.spouseSexOk({ sex: 'female' }, 'husband'), false);
    assert.strictEqual(Family.spouseSexOk({ sex: 'male' }, 'wife'), false);
    assert.strictEqual(Family.spouseSexOk({}, 'husband'), false);
});
