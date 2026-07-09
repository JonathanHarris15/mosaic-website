const { test } = require('node:test');
const assert = require('node:assert');

const Rel = require('../public/relationship-core.js');

const A = 'a', B = 'b', C = 'c';
const nameOf = id => ({ a: 'Alice', b: 'Bob', c: 'Cara' }[id] || id);

const mentors = { id: 't1', name: 'mentors', directional: true };
const dating = { id: 't2', name: 'dating', directional: false };

test('edgesForPerson returns edges where the Person is either end', () => {
    const rels = [
        { id: 'e1', fromId: A, toId: B, typeId: 't1' },
        { id: 'e2', fromId: C, toId: A, typeId: 't2' },
        { id: 'e3', fromId: B, toId: C, typeId: 't1' },
    ];
    assert.deepStrictEqual(Rel.edgesForPerson(rels, A).map(e => e.id).sort(), ['e1', 'e2']);
    assert.deepStrictEqual(Rel.edgesForPerson(rels, C).map(e => e.id).sort(), ['e2', 'e3']);
});

test('a directional type renders the SAME oriented sentence on both ends', () => {
    const edge = { fromId: A, toId: B, typeId: 't1' };
    const onAlice = Rel.describeRelationship(edge, mentors, A, nameOf);
    const onBob = Rel.describeRelationship(edge, mentors, B, nameOf);
    assert.strictEqual(onAlice.sentence, 'Alice mentors Bob');
    assert.strictEqual(onBob.sentence, 'Alice mentors Bob'); // oriented, identical
    assert.strictEqual(onAlice.otherId, B);
    assert.strictEqual(onBob.otherId, A);
    assert.strictEqual(onAlice.directional, true);
});

test('a symmetric type has no oriented sentence — the UI shows the other person', () => {
    const edge = { fromId: A, toId: B, typeId: 't2' };
    const onAlice = Rel.describeRelationship(edge, dating, A, nameOf);
    const onBob = Rel.describeRelationship(edge, dating, B, nameOf);
    assert.strictEqual(onAlice.sentence, null);
    assert.strictEqual(onAlice.typeName, 'dating');
    assert.strictEqual(onAlice.otherId, B);
    assert.strictEqual(onBob.otherId, A);
});

test('findTypeByName reuses an existing type case-insensitively, else null', () => {
    const types = [mentors, dating];
    assert.strictEqual(Rel.findTypeByName(types, 'Mentors'), mentors);
    assert.strictEqual(Rel.findTypeByName(types, 'DATING'), dating);
    assert.strictEqual(Rel.findTypeByName(types, 'roommate'), null); // genuinely new
    assert.strictEqual(Rel.findTypeByName(types, ''), null);
});
