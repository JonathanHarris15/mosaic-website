const { test } = require('node:test');
const assert = require('node:assert');

const Plan = require('../scripts/role-settings-migration-core.js');

// Who a Role needs, its rules and its rest moved onto each Event (ADR 0085).
// The copy ran on 2026-11-21; what is left is taking the old fields off.

const setup = () => ({
    slug: 'setup', name: 'Setup',
    slots: [{ id: 's1', requirement: 'male' }, { id: 's2', requirement: 'male' }],
    nextSlotSeq: 3,
    restrictions: [{ kind: 'requireTag', tagId: 'checked' }],
    intensity: 2, allowsAnotherRole: true,
});
const coffee = () => ({ slug: 'coffee', name: 'Coffee', slots: [{ id: 's1' }], nextSlotSeq: 2 });
const defs = () => ({ setup: setup(), coffee: coffee() });

test('stripping names only the old fields a Role still carries', () => {
    assert.deepEqual(Plan.planRoleStrip(setup()), ['slots', 'nextSlotSeq', 'restrictions', 'intensity', 'allowsAnotherRole']);
    assert.deepEqual(Plan.planRoleStrip({ slug: 'x', name: 'X', description: 'y' }), []);
});

test('stripping is refused while a series still reads a Role it has no settings for', () => {
    const list = [{ id: 'sun', roleSlugs: ['setup', 'preacher'] }, { id: 'wed', roleSlugs: ['coffee'], roleSettings: { coffee: {} } }];
    assert.deepEqual(Plan.unmigrated(list, defs()), ['sun/setup']);
});
