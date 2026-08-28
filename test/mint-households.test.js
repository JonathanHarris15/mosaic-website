const { test } = require('node:test');
const assert = require('node:assert');

const { planHouseholdMints } = require('../scripts/mint-households.js');

// ADR-0044. The kiosk used to invent a Household on every page load and throw it
// away again. This script writes them down, and the property that matters is
// that running it twice does not double the collection.

const people = [
    { id: 'bob', name: 'Bob Harris' },
    { id: 'alice', name: 'Alice Harris' },
    { id: 'kid', name: 'Sam Harris' },
    { id: 'solo', name: 'Jordan Blake' },
];
const families = [{ id: 'harrises', husbandId: 'bob', wifeId: 'alice', childIds: ['kid'] }];

test('every projected Household is written down, under its projection id', () => {
    const mints = planHouseholdMints(people, families, [], 't');
    assert.deepStrictEqual(mints.map(m => m.id).sort(), ['family:harrises', 'person:solo']);
    const harris = mints.find(m => m.id === 'family:harrises');
    assert.deepStrictEqual(harris.doc.memberIds, ['bob', 'alice', 'kid']);
    assert.strictEqual(harris.doc.members.find(m => m.personId === 'kid').kid, true);
});

test('running it a second time mints nothing, because the first run is stored', () => {
    const first = planHouseholdMints(people, families, [], 't');
    const stored = first.map(m => Object.assign({ id: m.id }, m.doc));
    assert.deepStrictEqual(planHouseholdMints(people, families, stored, 't'), []);
});

test('a Household somebody has already stored is left alone', () => {
    const stored = [{ id: 'hh1', name: 'The Harris Family Of Four', members: [
        { personId: 'bob' }, { personId: 'alice' }, { personId: 'kid' },
    ] }];
    const mints = planHouseholdMints(people, families, stored, 't');
    assert.deepStrictEqual(mints.map(m => m.id), ['person:solo']);
});

test('--families-only skips the household of one', () => {
    const mints = planHouseholdMints(people, families, [], 't', { familiesOnly: true });
    assert.deepStrictEqual(mints.map(m => m.id), ['family:harrises']);
});
