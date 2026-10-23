const { test } = require('node:test');
const assert = require('node:assert');

const Plan = require('../public/delete-occurrence-role-slugs-core.js');
const View = require('../public/calendar-view.js');

const DEFS = [
    { slug: 'sound_desk', name: 'Sound', slots: [{ id: 's1' }, { id: 's2' }] },
    { slug: 'kids', name: 'Kids', slots: [{ id: 'k1' }] },
];

test('MS-794 — a legacy occurrenceRoleSlugs field is planned for deletion', () => {
    assert.deepEqual(Plan.planOccurrenceRoleSlugDeletion({ date: '2026-01-01' }), { deleteField: false });
    assert.deepEqual(
        Plan.planOccurrenceRoleSlugDeletion({ occurrenceRoleSlugs: ['coffee'] }),
        { deleteField: true },
    );
});

test('MS-794 — a leftover occurrenceRoleSlugs value adds no open place', () => {
    const date = {
        id: 'x', date: '2026-08-09',
        seriesRoleSlugs: ['sound_desk'],
        occurrenceRoleSlugs: ['kids'],
    };
    assert.strictEqual(View.openPlaces(date, DEFS), 2, 'sound desk has two slots; kids is not added');
});
