// Families as serving groups (ADR-0012, MS-18).
//
// "No two people from the same Family" is a question about the MEMBERSHIP
// DIRECTORY, so it is answered from the household record an editor already
// keeps — never from a hand-rostered Relationship Group, which would be the
// same fact recorded twice with no way to tell which copy is stale.

const test = require('node:test');
const assert = require('node:assert');

const Family = require('../public/family-core.js');
const Roles = require('../public/roles-core.js');

const PEOPLE = [
    { id: 'h1', name: 'Peter Ward', sex: 'male' },
    { id: 'w1', name: 'Ruth Ward', sex: 'female' },
    { id: 'c1', name: 'Tom Ward' },
    { id: 'c2', name: 'Ivy Ward' },
    { id: 'x1', name: 'Nigel Stone', sex: 'male' },
];

const WARDS = { id: 'f1', husbandId: 'h1', wifeId: 'w1', childIds: ['c1', 'c2'] };

const groupOf = (groups, typeId) => groups.filter(g => g.typeId === typeId);

test('a household becomes one Family group holding everyone in it', () => {
    const groups = groupOf(Family.servingGroups([WARDS], PEOPLE), 'family');

    assert.equal(groups.length, 1);
    assert.deepEqual(groups[0].memberIds, ['h1', 'w1', 'c1', 'c2']);
});

// The narrower rule, for the Role where a couple serving together is the
// problem but their teenager helping is not.
test('a married couple becomes a Marriage group of exactly two', () => {
    const groups = groupOf(Family.servingGroups([WARDS], PEOPLE), 'marriage');

    assert.equal(groups.length, 1);
    assert.deepEqual(groups[0].memberIds, ['h1', 'w1']);
});

test('a household with no marriage in it produces no Marriage group', () => {
    const widow = { id: 'f2', wifeId: 'w1', childIds: ['c1'] };
    const groups = Family.servingGroups([widow], PEOPLE);

    assert.deepEqual(groupOf(groups, 'marriage'), []);
    assert.equal(groupOf(groups, 'family').length, 1, 'a widow and her son are still a family');
});

// A group of one can never put two people in a Role together, so drawing it
// would only pad the list an editor reads.
test('a household of one person is not a group at all', () => {
    const alone = { id: 'f3', husbandId: 'x1', childIds: [] };

    assert.deepEqual(Family.servingGroups([alone], PEOPLE), []);
});

test('a household reads by its people, never by its id', () => {
    const groups = Family.servingGroups([WARDS], PEOPLE);
    assert.equal(groups[0].name, 'Peter Ward and Ruth Ward');

    const widow = { id: 'f2', wifeId: 'w1', childIds: ['c1'] };
    assert.equal(Family.servingGroups([widow], PEOPLE)[0].name, 'Ruth Ward’s family');

    const orphans = { id: 'f4', childIds: ['c1', 'c2'] };
    assert.equal(Family.servingGroups([orphans], PEOPLE)[0].name, 'Tom Ward’s family');

    const nameless = { id: 'f5', childIds: ['ghost1', 'ghost2'] };
    assert.equal(Family.servingGroups([nameless], PEOPLE)[0].name, 'A family');
});

// ── The whole point: roles-core cannot tell these apart from a real group ────

test('a Role can refuse two people from the same Family', () => {
    const role = {
        slug: 'kids', name: 'Kids', slots: [{ id: 's1', requirement: 'either' }, { id: 's2', requirement: 'either' }],
        restrictions: [{ kind: Roles.RESTRICTIONS.NOT_SAME_GROUP, typeId: 'family' }],
    };
    const groups = Family.servingGroups([WARDS], PEOPLE);

    const judged = Roles.candidatesFor(role, role.slots[1], {
        people: PEOPLE,
        assigned: [{ roleSlug: 'kids', slotId: 's1', personId: 'h1' }],
        groups: groups,
    });

    const ruth = judged.filter(c => c.personId === 'w1')[0];
    const tom = judged.filter(c => c.personId === 'c1')[0];
    const nigel = judged.filter(c => c.personId === 'x1')[0];

    assert.equal(ruth.eligible, false, 'his wife is in the same household');
    assert.equal(tom.eligible, false, 'so is his son');
    assert.equal(nigel.eligible, true);
});

test('a Marriage rule stops the couple and leaves their children alone', () => {
    const role = {
        slug: 'welcome', name: 'Welcome', slots: [{ id: 's1', requirement: 'either' }, { id: 's2', requirement: 'either' }],
        restrictions: [{ kind: Roles.RESTRICTIONS.NOT_SAME_GROUP, typeId: 'marriage' }],
    };
    const groups = Family.servingGroups([WARDS], PEOPLE);

    const judged = Roles.candidatesFor(role, role.slots[1], {
        people: PEOPLE,
        assigned: [{ roleSlug: 'welcome', slotId: 's1', personId: 'h1' }],
        groups: groups,
    });

    assert.equal(judged.filter(c => c.personId === 'w1')[0].eligible, false);
    assert.equal(judged.filter(c => c.personId === 'c1')[0].eligible, true,
        'a couple serving together is the problem; their teenager helping is not');
});

// ⚠ THE PAIRED TEST. roles-core reserves the two ids and validates rules
// against them; family-core stamps the same two onto the groups it projects.
// Two modules, one pair of strings — if they drift, a rule naming Family
// validates fine and then matches nobody, silently. Same arrangement as
// `inGroup` and `belongsTo`.
test('the ids roles-core reserves are the ids family-core stamps', () => {
    const reserved = Roles.DIRECTORY_GROUP_TYPES.map(t => t.id).sort();
    assert.deepEqual(reserved, ['family', 'marriage']);
    assert.deepEqual(
        Object.values(Family.SERVING_GROUP_TYPES).sort(),
        reserved
    );

    const stamped = Family.servingGroups([WARDS], PEOPLE).map(g => g.typeId);
    stamped.forEach(id => assert.ok(reserved.indexOf(id) !== -1, id + ' is not reserved'));
});

// Always available, never needing an elder to share them — the household is a
// record an editor already keeps.
test('a rule naming Family validates with no shared types at all', () => {
    const rule = { kind: Roles.RESTRICTIONS.NOT_SAME_GROUP, typeId: 'family' };
    assert.equal(Roles.validateRestriction(rule, []).valid, true);

    const marriage = { kind: Roles.RESTRICTIONS.SAME_GROUP, typeId: 'marriage' };
    assert.equal(Roles.validateRestriction(marriage, []).valid, true);

    const invented = { kind: Roles.RESTRICTIONS.NOT_SAME_GROUP, typeId: 'book-club' };
    assert.equal(Roles.validateRestriction(invented, []).valid, false,
        'anything else still has to be shared');
});

test('no families at all is no groups, not a crash', () => {
    assert.deepEqual(Family.servingGroups(null, null), []);
    assert.deepEqual(Family.servingGroups([], PEOPLE), []);
});
