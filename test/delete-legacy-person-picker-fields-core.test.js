const {test} = require('node:test');
const assert = require('node:assert');

const Plan = require('../public/delete-legacy-person-picker-fields-core.js');

test('the phantom fields are the three the directory does not store', () => {
    assert.deepEqual(Plan.PHANTOM_FIELDS, ['isMember', 'membershipStage', 'tagIds']);
});

test('a Person stored as membership and tags has nothing to delete', () => {
    const plan = Plan.planLegacyPersonFieldDeletion({
        name: 'Ada Lovelace',
        membership: {stage: 'member', inactive: false},
        tags: ['choir', 'Member'],
    });
    assert.equal(plan.blocked, false);
    assert.deepEqual(plan.deleteFields, []);
});

test('a redundant isMember is deleted and does not change who is a member', () => {
    const plan = Plan.planLegacyPersonFieldDeletion({
        membership: {stage: 'member', inactive: false},
        tags: ['Member'],
        isMember: false,
    });
    assert.equal(plan.blocked, false);
    assert.deepEqual(plan.deleteFields, ['isMember']);
});

test('membershipStage that already matches membership.stage is deleted', () => {
    const plan = Plan.planLegacyPersonFieldDeletion({
        membership: {stage: 'visitor'},
        tags: [],
        membershipStage: 'visitor',
    });
    assert.equal(plan.blocked, false);
    assert.deepEqual(plan.deleteFields, ['membershipStage']);
});

test('a membershipStage the document does not already store blocks the delete', () => {
    const plan = Plan.planLegacyPersonFieldDeletion({
        tags: [],
        membershipStage: 'member',
    });
    assert.equal(plan.blocked, true);
    assert.deepEqual(plan.deleteFields, []);
    assert.equal(plan.blockReasons[0].reason, 'differs-from-membership-stage');
});

test('tagIds already carried in tags are deleted', () => {
    const plan = Plan.planLegacyPersonFieldDeletion({
        membership: {stage: 'member'},
        tags: ['choir', 'Member'],
        tagIds: ['choir'],
    });
    assert.equal(plan.blocked, false);
    assert.deepEqual(plan.deleteFields, ['tagIds']);
});

test('a tag id that is only on tagIds blocks the delete', () => {
    const plan = Plan.planLegacyPersonFieldDeletion({
        membership: {stage: 'visitor'},
        tags: [],
        tagIds: ['choir'],
    });
    assert.equal(plan.blocked, true);
    assert.deepEqual(plan.deleteFields, []);
    assert.equal(plan.blockReasons[0].field, 'tagIds');
    assert.equal(plan.blockReasons[0].reason, 'not-in-tags');
});

test('tagIds that are not a list block the delete', () => {
    const plan = Plan.planLegacyPersonFieldDeletion({
        tags: ['choir'],
        tagIds: 'choir',
    });
    assert.equal(plan.blocked, true);
    assert.equal(plan.blockReasons[0].reason, 'not-an-array');
    assert.deepEqual(plan.deleteFields, []);
});

test('an empty tagIds and a blank membershipStage are safe to delete', () => {
    const plan = Plan.planLegacyPersonFieldDeletion({
        membership: {stage: 'member', inactive: false},
        tags: ['Member'],
        isMember: true,
        membershipStage: '',
        tagIds: [],
    });
    assert.equal(plan.blocked, false);
    assert.deepEqual(plan.deleteFields, ['isMember', 'membershipStage', 'tagIds']);
});
