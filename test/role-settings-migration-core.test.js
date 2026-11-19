const { test } = require('node:test');
const assert = require('node:assert');

const Plan = require('../scripts/role-settings-migration-core.js');
const Roles = require('../public/roles-core.js');

// Moving who a Role needs, its rules and its rest onto each Event (ADR 0085).

const setup = () => ({
    slug: 'setup', name: 'Setup',
    slots: [{ id: 's1', requirement: 'male' }, { id: 's2', requirement: 'male' }],
    nextSlotSeq: 3,
    restrictions: [{ kind: 'requireTag', tagId: 'checked' }, { kind: 'notSameGroup', typeId: 'family' }],
    intensity: 2, allowsAnotherRole: true,
});
const coffee = () => ({ slug: 'coffee', name: 'Coffee', slots: [{ id: 's1', requirement: 'either' }], nextSlotSeq: 2 });
const defs = () => ({ setup: setup(), coffee: coffee() });

test('a series with no settings of its own gets them from each Role, in the new shape', () => {
    const plan = Plan.planSeries({ id: 'sun', roleSlugs: ['preacher', 'setup', 'coffee'] }, defs());
    assert.equal(plan.changed, true);
    assert.deepEqual(plan.seeded, ['setup', 'coffee']);
    const s = plan.roleSettings.setup;
    assert.deepEqual(s.slots.map(x => x.id), ['s1', 's2'], 'slot ids are kept');
    assert.ok(s.slots.every(x => x.requirement === 'either'));
    assert.equal(s.nextSlotSeq, 3);
    assert.equal(s.intensity, 2);
    assert.equal(s.allowsAnotherRole, true);
    // Person rule → one OR rule; per-seat sexes → a line-up; team rule → its own.
    const kinds = s.restrictions.map(r => r.scope + ':' + r.options[0].conditions.map(c => c.kind).join('+'));
    assert.deepEqual(kinds, ['person:requireTag', 'team:lineup', 'team:notSameGroup']);
    assert.equal(plan.roleSettings.preacher, undefined, 'a liturgical Role gets nothing');
});

test('what it copies judges people exactly as the old Role did', () => {
    const plan = Plan.planSeries({ id: 'sun', roleSlugs: ['setup'] }, defs());
    const people = [
        { id: 'a', sex: 'male', tags: ['checked'] },
        { id: 'b', sex: 'female', tags: ['checked'] },
        { id: 'c', sex: 'male', tags: [] },
    ];
    const before = setup();
    const after = Object.assign({}, before, plan.roleSettings.setup);
    const judge = def => Roles.candidatesFor(def, def.slots[1], {
        people: people, assigned: [{ slotId: 's1', personId: 'a' }],
    }).map(r => r.eligible);
    assert.deepEqual(judge(after), judge(before));
});

test('a series that already has its own settings keeps them', () => {
    const own = { slots: [{ id: 's1', requirement: 'either' }], nextSlotSeq: 3, restrictions: [], intensity: 1, allowsAnotherRole: false };
    const plan = Plan.planSeries({ id: 'wed', roleSlugs: ['setup'], roleSettings: { setup: own } }, defs());
    assert.deepEqual(plan.roleSettings.setup.slots, own.slots);
    assert.equal(plan.roleSettings.setup.intensity, 1);
    assert.deepEqual(plan.seeded, []);
});

test('running it twice changes nothing the second time', () => {
    const first = Plan.planSeries({ id: 'sun', roleSlugs: ['setup', 'coffee'] }, defs());
    const again = Plan.planSeries({ id: 'sun', roleSlugs: ['setup', 'coffee'],
        roleSettings: first.roleSettings, crossRoleRules: first.crossRoleRules }, defs());
    assert.equal(again.changed, false);
});

test('old rules across Roles become OR rules', () => {
    const plan = Plan.planSeries({ id: 'sun', roleSlugs: ['setup', 'coffee'],
        crossRoleRules: [{ kind: 'notSameGroup', typeId: 'marriage', roleSlugs: ['setup', 'coffee'] }] }, defs());
    assert.equal(plan.crossRoleRules[0].kind, 'anyOf');
    assert.deepEqual(plan.crossRoleRules[0].options[0].conditions[0].roleSlugs, ['setup', 'coffee']);
});

test('a Role the series names but nobody defines is reported, not invented', () => {
    const plan = Plan.planSeries({ id: 'sun', roleSlugs: ['ghost'] }, defs());
    assert.deepEqual(plan.missing, ['ghost']);
    assert.equal(plan.roleSettings.ghost, undefined);
});

test('stripping names only the old fields a Role still carries', () => {
    assert.deepEqual(Plan.planRoleStrip(setup()), ['slots', 'nextSlotSeq', 'restrictions', 'intensity', 'allowsAnotherRole']);
    assert.deepEqual(Plan.planRoleStrip({ slug: 'x', name: 'X', description: 'y' }), []);
});

test('stripping is refused while a series still reads a Role it has no settings for', () => {
    const list = [{ id: 'sun', roleSlugs: ['setup', 'preacher'] }, { id: 'wed', roleSlugs: ['coffee'], roleSettings: { coffee: {} } }];
    assert.deepEqual(Plan.unmigrated(list, defs()), ['sun/setup']);
});
