const { test } = require('node:test');
const assert = require('node:assert');

const { updateForType } = require('../scripts/backfill-relationship-types.js');

// Stands in for admin.firestore.FieldValue.delete().
const DELETE = Symbol('FieldValue.delete()');

test('a directional type is migrated to Prioritized Pairwise, seeding both role labels from the name', () => {
    const patch = updateForType({ name: 'mentors', directional: true }, DELETE);
    assert.strictEqual(patch.kind, 'pairwise');
    assert.strictEqual(patch.priority, true);
    assert.strictEqual(patch.holderLabel, 'mentors');
    assert.strictEqual(patch.counterpartLabel, 'mentors');
    assert.strictEqual(patch.directional, DELETE); // the retired flag is deleted, not left false
    assert.strictEqual('label' in patch, false);
});

test('a non-directional type is migrated to Non-Prioritized Pairwise with a single Label', () => {
    const patch = updateForType({ name: 'dating', directional: false }, DELETE);
    assert.strictEqual(patch.kind, 'pairwise');
    assert.strictEqual(patch.priority, false);
    assert.strictEqual(patch.label, 'dating');
    assert.strictEqual(patch.directional, DELETE);
    assert.strictEqual('holderLabel' in patch, false);
    assert.strictEqual('counterpartLabel' in patch, false);
});

test('an already-migrated type yields no patch — a second run is a no-op', () => {
    const migrated = {
        name: 'Discipleship', kind: 'pairwise', priority: true,
        holderLabel: 'Discipler', counterpartLabel: 'Disciplee',
    };
    assert.strictEqual(updateForType(migrated, DELETE), null);

    // And a Group type an elder created after the migration is likewise left alone.
    const group = { name: 'Bible Study', kind: 'group', priority: true, leaderLabel: 'Leader', memberLabel: 'Member' };
    assert.strictEqual(updateForType(group, DELETE), null);
});

test('the patch a legacy type produces is itself a valid Relationship Type', () => {
    const Rel = require('../public/relationship-core.js');
    for (const legacy of [{ name: 'mentors', directional: true }, { name: 'dating', directional: false }]) {
        const patch = updateForType(legacy, DELETE);
        const stored = { ...legacy, ...patch };
        delete stored.directional; // Firestore would have deleted the field
        assert.strictEqual(Rel.validateType(stored).valid, true, `${legacy.name} should migrate to a valid type`);
    }
});
