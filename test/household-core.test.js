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

test('a stored Household seats its people so they are not projected twice', () => {
    const stored = [{
        id: 'hh1',
        name: 'The Harris Household',
        members: [
            { personId: 'bob', kid: false },
            { personId: 'alice', kid: false },
            { personId: 'kid', kid: true },
        ],
    }];
    const households = Household.householdsFromDirectory(people, families, stored);
    assert.ok(households.find(h => h.id === 'hh1'));
    assert.ok(!households.find(h => h.id === 'family:harrises'));
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
});
