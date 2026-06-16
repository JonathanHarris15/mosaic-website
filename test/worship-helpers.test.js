const { test } = require('node:test');
const assert = require('node:assert');

const { worshipHelperInvolvementChanges } = require('../public/service-builder.js');

// A Music Helper is a Person reference { name, id }. Across a save, the set of
// helpers can change: people are added, removed, reordered, or left untouched.
// worshipHelperInvolvementChanges compares the previously-saved helpers against
// the current helpers and reports which Persons gain a worship_helper involvement
// (added) and which lose one (removed). Helpers are a SET keyed by Person id;
// rows without a selected Person (no id) carry no involvement.

const helper = (id, name) => ({ id, name: name || id });

test('adding a helper records that person as added', () => {
    const { added, removed } = worshipHelperInvolvementChanges([], [helper('p1')]);
    assert.deepStrictEqual(added, ['p1']);
    assert.deepStrictEqual(removed, []);
});

test('removing a helper records that person as removed', () => {
    const { added, removed } = worshipHelperInvolvementChanges([helper('p1')], []);
    assert.deepStrictEqual(added, []);
    assert.deepStrictEqual(removed, ['p1']);
});

test('reordering the same helpers produces no changes', () => {
    const original = [helper('p1'), helper('p2')];
    const current = [helper('p2'), helper('p1')];
    const { added, removed } = worshipHelperInvolvementChanges(original, current);
    assert.deepStrictEqual(added, []);
    assert.deepStrictEqual(removed, []);
});

test('a helper present before and after is neither added nor removed', () => {
    const original = [helper('p1')];
    const current = [helper('p1'), helper('p2')];
    const { added, removed } = worshipHelperInvolvementChanges(original, current);
    assert.deepStrictEqual(added, ['p2']);
    assert.deepStrictEqual(removed, []);
});

test('helpers without a selected person (no id) carry no involvement', () => {
    const original = [];
    const current = [helper(null, 'Typed name only'), { name: '', id: null }];
    const { added, removed } = worshipHelperInvolvementChanges(original, current);
    assert.deepStrictEqual(added, []);
    assert.deepStrictEqual(removed, []);
});

test('the same person added twice is treated as one helper', () => {
    const { added, removed } = worshipHelperInvolvementChanges([], [helper('p1'), helper('p1')]);
    assert.deepStrictEqual(added, ['p1']);
    assert.deepStrictEqual(removed, []);
});

test('a mixed change reports adds and removes independently', () => {
    const original = [helper('p1'), helper('p2')];   // p1 stays, p2 leaves
    const current = [helper('p1'), helper('p3')];     // p3 joins
    const { added, removed } = worshipHelperInvolvementChanges(original, current);
    assert.deepStrictEqual(added, ['p3']);
    assert.deepStrictEqual(removed, ['p2']);
});

test('undefined helper lists are treated as empty', () => {
    const { added, removed } = worshipHelperInvolvementChanges(undefined, undefined);
    assert.deepStrictEqual(added, []);
    assert.deepStrictEqual(removed, []);
});
