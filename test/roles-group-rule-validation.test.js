const { test } = require('node:test');
const assert = require('node:assert');

const Roles = require('../public/roles-core.js');

// A group rule may only name a Relationship Type an elder has shared (MS-128,
// ADR-0017). The security rules already stop a non-elder READING an unshared
// Type's rosters — but if the model let such a rule be built anyway, evaluation
// would receive an empty roster list and quietly conclude "nobody qualifies".
//
// A silent wrong answer is worse than a refusal: the user would see a Role that
// can never be filled and no indication why.

const sharedHouse = {
    id: 'type-house', name: 'House Group', kind: 'group', priority: true,
    leaderLabel: 'Host', memberLabel: 'Member', sharedWithEditors: true,
};
const privateStudy = {
    id: 'type-study', name: 'Tuesday Study', kind: 'group', priority: false,
    label: 'Participant',
};
const sharedMarriage = {
    id: 'type-marriage', name: 'Marriage', kind: 'pairwise', priority: false,
    label: 'Spouse', sharedWithEditors: true,
};

const groupRule = typeId => ({ kind: Roles.RESTRICTIONS.SAME_GROUP, typeId });

// ── Only shared Types ────────────────────────────────────────────────────────

test('a group rule against a shared Group Type is accepted', () => {
    const result = Roles.validateRestriction(groupRule('type-house'), [sharedHouse]);
    assert.equal(result.valid, true);
    assert.deepEqual(result.errors, []);
});

test('a group rule against an unshared Type is refused', () => {
    const result = Roles.validateRestriction(groupRule('type-study'), [privateStudy]);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => /shared|elder/i.test(e)),
        'the reason should point at an elder having to share it');
});

test('both group rule kinds are held to the same standard', () => {
    [Roles.RESTRICTIONS.SAME_GROUP, Roles.RESTRICTIONS.NOT_SAME_GROUP].forEach(kind => {
        assert.equal(
            Roles.validateRestriction({ kind, typeId: 'type-study' }, [privateStudy]).valid,
            false,
            kind
        );
    });
});

test('a Type that is not in the list at all is refused', () => {
    // Not "assume shared" — an unknown Type is one this user cannot see.
    assert.equal(Roles.validateRestriction(groupRule('type-gone'), [sharedHouse]).valid, false);
});

test('an empty Type list refuses every group rule', () => {
    assert.equal(Roles.validateRestriction(groupRule('type-house'), []).valid, false);
    assert.equal(Roles.validateRestriction(groupRule('type-house'), null).valid, false);
});

// ── Only Group-kind Types ────────────────────────────────────────────────────

test('a pairwise Type in a group rule is a mistake, not a no-op', () => {
    const result = Roles.validateRestriction(groupRule('type-marriage'), [sharedMarriage]);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => /group/i.test(e)));
});

test('conversely, a pairwise rule wants a pairwise Type', () => {
    const rule = { kind: Roles.RESTRICTIONS.NOT_TOGETHER, typeId: 'type-house' };
    assert.equal(Roles.validateRestriction(rule, [sharedHouse]).valid, false);
});

test('a pairwise rule against a shared pairwise Type is accepted', () => {
    const rule = { kind: Roles.RESTRICTIONS.NOT_TOGETHER, typeId: 'type-marriage' };
    assert.equal(Roles.validateRestriction(rule, [sharedMarriage]).valid, true);
});

// ── Tag rules are unaffected ─────────────────────────────────────────────────

test('tag rules need no Relationship Type and validate on their own', () => {
    [Roles.RESTRICTIONS.REQUIRE_TAG, Roles.RESTRICTIONS.EXCLUDE_TAG].forEach(kind => {
        assert.equal(Roles.validateRestriction({ kind, tagId: 'kids-cleared' }, []).valid, true, kind);
    });
});

test('a tag rule with no tag is refused', () => {
    assert.equal(
        Roles.validateRestriction({ kind: Roles.RESTRICTIONS.REQUIRE_TAG }, []).valid,
        false
    );
});

// ── A Type unshared after the fact ───────────────────────────────────────────

test('a rule whose Type has since been unshared reports as unavailable', () => {
    // Degrade loudly, not silently. The Role must still load, and the user must
    // be able to see that one of its rules has stopped working.
    const role = {
        id: 'r1', name: 'Kids', family: Roles.FAMILIES.SERVANT,
        slots: [{ id: 's1', requirement: Roles.REQUIREMENTS.EITHER }],
        restrictions: [groupRule('type-study')],
    };
    const report = Roles.unavailableRestrictions(role, [sharedHouse]);

    assert.equal(report.length, 1);
    assert.equal(report[0].typeId, 'type-study');
});

test('a Role whose rules are all fine reports nothing unavailable', () => {
    const role = {
        id: 'r1', name: 'Kids', family: Roles.FAMILIES.SERVANT,
        slots: [{ id: 's1', requirement: Roles.REQUIREMENTS.EITHER }],
        restrictions: [groupRule('type-house'), { kind: Roles.RESTRICTIONS.REQUIRE_TAG, tagId: 't' }],
    };
    assert.deepEqual(Roles.unavailableRestrictions(role, [sharedHouse]), []);
});

test('an unavailable rule does not stop the Role validating', () => {
    // The Role is still a legitimate Role; one of its rules just can't run.
    const role = {
        id: 'r1', name: 'Kids', family: Roles.FAMILIES.SERVANT, slug: 'kids',
        slots: [{ id: 's1', requirement: Roles.REQUIREMENTS.EITHER }],
        restrictions: [groupRule('type-study')],
    };
    assert.equal(Roles.validateDefinition(role).valid, true);
});
