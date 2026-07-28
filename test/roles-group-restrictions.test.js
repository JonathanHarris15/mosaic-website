const { test } = require('node:test');
const assert = require('node:assert');

const Roles = require('../public/roles-core.js');
const Groups = require('../public/relationship-group-core.js');

// Group-based serving restrictions (MS-141).
//
// Two rules, opposite in polarity:
//   • not-same-group — spread a Role across the congregation
//   • same-group     — staff a Role FROM one group, so they already know each other
//
// The second is the first COHESIVE rule in the model. Everything else is
// exclusionary and judged about a person alone; this one is judged about a
// combination, and the first person seated is unconstrained.

const person = (id, extra) => Object.assign({ id, name: id, tags: [], sex: 'female' }, extra);

const anna = person('anna');
const beth = person('beth');
const cara = person('cara');
const dina = person('dina');

const HOUSE = 'type-house-group';
const STUDY = 'type-study';

// North is led by Anna — note she is NOT in memberIds. That is the shape
// (ADR-0014 §5), and the whole reason this needs its own tests.
const north = { id: 'g1', typeId: HOUSE, name: 'North House Group', leaderId: 'anna', memberIds: ['beth'] };
const south = { id: 'g2', typeId: HOUSE, name: 'South House Group', leaderId: null, memberIds: ['cara', 'dina'] };
const study = { id: 'g3', typeId: STUDY, name: 'Tuesday Study', leaderId: null, memberIds: ['anna', 'cara'] };

const GROUPS = [north, south, study];

const slot = { id: 's1', requirement: Roles.REQUIREMENTS.EITHER };
const slot2 = { id: 's2', requirement: Roles.REQUIREMENTS.EITHER };

const roleWith = restrictions => ({
    id: 'r1', name: 'Kids Ministry', family: Roles.FAMILIES.SERVANT,
    slots: [slot, slot2], restrictions,
});

const eligibleIds = results => results.filter(r => r.eligible).map(r => r.personId);
const resultFor = (results, id) => results.find(r => r.personId === id);

// ── MS-142: membership, with the leader counted in ───────────────────────────

test('a group leader belongs to their group', () => {
    // The trap. Anna leads North and is absent from memberIds; a naive
    // memberIds check would say she is in no house group at all.
    assert.equal(Roles.inGroup(north, 'anna'), true);
});

test('this agrees with RelationshipGroupCore, which already folds the leader in', () => {
    // Two modules answer the same question because core modules here don't
    // depend on each other. If they ever disagree, that is the bug.
    [north, south, study].forEach(group => {
        ['anna', 'beth', 'cara', 'dina', 'nobody'].forEach(id => {
            assert.equal(
                Roles.inGroup(group, id),
                Groups.belongsTo(group, id),
                `${group.name} / ${id}`
            );
        });
    });
});

test('a plain member belongs to their group', () => {
    assert.equal(Roles.inGroup(north, 'beth'), true);
});

test('somebody outside the group does not belong to it', () => {
    assert.equal(Roles.inGroup(north, 'cara'), false);
});

test('a leaderless group still resolves its members', () => {
    assert.equal(Roles.inGroup(south, 'cara'), true);
    assert.equal(Roles.inGroup(south, 'anna'), false);
});

test('groups are resolved per Type, never across Types', () => {
    assert.deepEqual(Roles.groupsFor(GROUPS, HOUSE, 'anna').map(g => g.id), ['g1']);
    assert.deepEqual(Roles.groupsFor(GROUPS, STUDY, 'anna').map(g => g.id), ['g3']);
});

test('a Person in no group of that Type resolves to nothing', () => {
    assert.deepEqual(Roles.groupsFor(GROUPS, HOUSE, 'nobody'), []);
    assert.deepEqual(Roles.groupsFor(null, HOUSE, 'anna'), []);
});

test('two people sharing a group of a Type can be found directly', () => {
    assert.deepEqual(Roles.sharedGroups(GROUPS, HOUSE, 'anna', 'beth').map(g => g.id), ['g1']);
    assert.deepEqual(Roles.sharedGroups(GROUPS, HOUSE, 'anna', 'cara'), []);
    // Anna and Cara share the study, just not a house group.
    assert.deepEqual(Roles.sharedGroups(GROUPS, STUDY, 'anna', 'cara').map(g => g.id), ['g3']);
});

// ── MS-143: not the same group ───────────────────────────────────────────────

const notSameHouse = roleWith([{ kind: Roles.RESTRICTIONS.NOT_SAME_GROUP, typeId: HOUSE }]);

test('a leader and their own member may not fill the same Role', () => {
    const results = Roles.candidatesFor(notSameHouse, slot2, {
        people: [beth, cara],
        groups: GROUPS,
        assigned: [{ slotId: 's1', personId: 'anna' }],
    });

    assert.deepEqual(eligibleIds(results), ['cara']);
    assert.equal(resultFor(results, 'beth').reason, Roles.REASONS.SAME_GROUP_CONFLICT);
});

test('the conflict names the group and the person', () => {
    const results = Roles.candidatesFor(notSameHouse, slot2, {
        people: [beth], groups: GROUPS,
        assigned: [{ slotId: 's1', personId: 'anna' }],
    });
    const blocked = resultFor(results, 'beth');
    assert.equal(blocked.groupName, 'North House Group');
    assert.equal(blocked.conflictsWith, 'anna');
});

test('two plain members of one group clash', () => {
    const results = Roles.candidatesFor(notSameHouse, slot2, {
        people: [dina], groups: GROUPS,
        assigned: [{ slotId: 's1', personId: 'cara' }],
    });
    assert.equal(resultFor(results, 'dina').eligible, false);
});

test('sharing a group of a different Type is no obstacle', () => {
    // Anna and Cara share the Tuesday Study but not a house group.
    const results = Roles.candidatesFor(notSameHouse, slot2, {
        people: [cara], groups: GROUPS,
        assigned: [{ slotId: 's1', personId: 'anna' }],
    });
    assert.equal(resultFor(results, 'cara').eligible, true);
});

test('with nobody seated, not-same-group blocks nobody', () => {
    const results = Roles.candidatesFor(notSameHouse, slot, {
        people: [anna, beth, cara, dina], groups: GROUPS, assigned: [],
    });
    assert.equal(eligibleIds(results).length, 4);
});

test('a Person in no group of that Type is unaffected by not-same-group', () => {
    const results = Roles.candidatesFor(notSameHouse, slot2, {
        people: [person('erik', { sex: 'male' })], groups: GROUPS,
        assigned: [{ slotId: 's1', personId: 'anna' }],
    });
    assert.equal(resultFor(results, 'erik').eligible, true);
});

// ── MS-144: the same group ───────────────────────────────────────────────────

const sameHouse = roleWith([{ kind: Roles.RESTRICTIONS.SAME_GROUP, typeId: HOUSE }]);

test('with nobody seated, anyone in a group of that Type is eligible', () => {
    // The rule constrains combinations, not individuals — the first pick is free.
    const results = Roles.candidatesFor(sameHouse, slot, {
        people: [anna, beth, cara, dina], groups: GROUPS, assigned: [],
    });
    assert.deepEqual(eligibleIds(results), ['anna', 'beth', 'cara', 'dina']);
});

test('a Person in no group of that Type is ineligible under same-group', () => {
    // The opposite of not-same-group, where being groupless is harmless.
    const results = Roles.candidatesFor(sameHouse, slot, {
        people: [person('erik', { sex: 'male' })], groups: GROUPS, assigned: [],
    });
    const blocked = resultFor(results, 'erik');
    assert.equal(blocked.eligible, false);
    assert.equal(blocked.reason, Roles.REASONS.NOT_IN_REQUIRED_GROUP);
});

test('seating someone narrows the field to their group', () => {
    const results = Roles.candidatesFor(sameHouse, slot2, {
        people: [beth, cara, dina], groups: GROUPS,
        assigned: [{ slotId: 's1', personId: 'anna' }],  // Anna leads North
    });

    assert.deepEqual(eligibleIds(results), ['beth']);
    assert.equal(resultFor(results, 'cara').reason, Roles.REASONS.NOT_IN_REQUIRED_GROUP);
});

test('the leader satisfies same-group as fully as a member', () => {
    const results = Roles.candidatesFor(sameHouse, slot2, {
        people: [anna], groups: GROUPS,
        assigned: [{ slotId: 's1', personId: 'beth' }],
    });
    assert.equal(resultFor(results, 'anna').eligible, true);
});

test('a candidate must share a group with EVERYONE seated, not just someone', () => {
    const threeSlots = {
        id: 'r2', name: 'Setup', family: Roles.FAMILIES.SERVANT,
        slots: [slot, slot2, { id: 's3', requirement: Roles.REQUIREMENTS.EITHER }],
        restrictions: [{ kind: Roles.RESTRICTIONS.SAME_GROUP, typeId: STUDY }],
    };
    // Anna and Cara are both in the Tuesday Study. Beth is not.
    const results = Roles.candidatesFor(threeSlots, { id: 's3', requirement: Roles.REQUIREMENTS.EITHER }, {
        people: [beth], groups: GROUPS,
        assigned: [{ slotId: 's1', personId: 'anna' }, { slotId: 's2', personId: 'cara' }],
    });
    assert.equal(resultFor(results, 'beth').eligible, false);
});

test('no single group is committed to when several would satisfy the rule', () => {
    // Anna and Cara share the Study; Cara and Dina share South. With Cara
    // seated, both Anna and Dina are eligible under their respective shared
    // groups — the Role must not be pinned to whichever matched first.
    const eitherGroup = roleWith([{ kind: Roles.RESTRICTIONS.SAME_GROUP, typeId: HOUSE }]);
    const results = Roles.candidatesFor(eitherGroup, slot2, {
        people: [dina], groups: GROUPS,
        assigned: [{ slotId: 's1', personId: 'cara' }],
    });
    assert.equal(resultFor(results, 'dina').eligible, true, 'Cara and Dina share South');
});

test('the same-group reason names the requirement, not the internals', () => {
    const results = Roles.candidatesFor(sameHouse, slot2, {
        people: [cara], groups: GROUPS,
        assigned: [{ slotId: 's1', personId: 'anna' }],
    });
    assert.equal(resultFor(results, 'cara').reason, Roles.REASONS.NOT_IN_REQUIRED_GROUP);
});

// ── Both rules leave the rest of the model alone ─────────────────────────────

test('group rules combine with sex and tag rules', () => {
    const combined = {
        id: 'r3', name: 'Kids', family: Roles.FAMILIES.SERVANT,
        slots: [slot, { id: 's2', requirement: Roles.REQUIREMENTS.MALE }],
        restrictions: [{ kind: Roles.RESTRICTIONS.SAME_GROUP, typeId: HOUSE }],
    };
    const results = Roles.candidatesFor(combined, { id: 's2', requirement: Roles.REQUIREMENTS.MALE }, {
        people: [beth], groups: GROUPS,
        assigned: [{ slotId: 's1', personId: 'anna' }],
    });
    // Beth shares North with Anna but is female, so the sexed slot still wins.
    assert.equal(resultFor(results, 'beth').reason, Roles.REASONS.SEX_MISMATCH);
});

test('missing group data does not crash either rule', () => {
    [notSameHouse, sameHouse].forEach(role => {
        const results = Roles.candidatesFor(role, slot, { people: [anna] });
        assert.equal(results.length, 1);
    });
});

test('evaluating group rules never mutates the groups', () => {
    const before = JSON.parse(JSON.stringify(GROUPS));
    Roles.candidatesFor(sameHouse, slot2, {
        people: [beth], groups: GROUPS,
        assigned: [{ slotId: 's1', personId: 'anna' }],
    });
    assert.deepEqual(GROUPS, before);
});
