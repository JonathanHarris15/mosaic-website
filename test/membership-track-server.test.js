const { test } = require('node:test');
const assert = require('node:assert');

const Server = require('../functions/membership-track.js');
const Core = require('../public/shepherding-core.js');

// The Membership Track (ADR-0012) has to exist twice: once in
// public/shepherding-core.js for the browser, and once in
// functions/membership-track.js for the triggers, because Cloud Functions
// deploy only the functions/ directory and cannot import the canonical copy.
//
// Two copies of a state machine is exactly the kind of thing that drifts
// silently and then disagrees about whether somebody is a member. These pin the
// server copy to the canonical one — every table, and both projection
// functions across every combination of stage and Inactive.

test('the stage list matches, in Track order', () => {
    assert.deepStrictEqual(Server.MEMBERSHIP_STAGES, Core.MEMBERSHIP_STAGES);
});

test('the stage → tags projection table matches', () => {
    assert.deepStrictEqual(Server.MEMBERSHIP_STAGE_TAGS, Core.MEMBERSHIP_STAGE_TAGS);
});

test('the immutable Membership Tag id set matches', () => {
    assert.deepStrictEqual(Server.MEMBERSHIP_TAG_IDS, Core.MEMBERSHIP_TAG_IDS);
});

test('the Member and Inactive tag ids match', () => {
    assert.strictEqual(Server.MEMBER_TAG_ID, Core.MEMBER_TAG_ID);
    assert.strictEqual(Server.INACTIVE_TAG_ID, Core.INACTIVE_TAG_ID);
});

test('the member stage is a real stage, and previous_member is a different one', () => {
    assert.ok(Core.MEMBERSHIP_STAGES.includes(Server.MEMBER_STAGE));
    assert.ok(Core.MEMBERSHIP_STAGES.includes(Server.PREVIOUS_MEMBER_STAGE));
    assert.notStrictEqual(Server.MEMBER_STAGE, Server.PREVIOUS_MEMBER_STAGE);
});

// Every membership shape the projection can be asked about: each stage, no
// stage at all, and each of those marked Inactive.
const MEMBERSHIPS = [];
for (const stage of Core.MEMBERSHIP_STAGES.concat([null])) {
    MEMBERSHIPS.push({ stage, inactive: false });
    MEMBERSHIPS.push({ stage, inactive: true });
}

test('membershipTagsFor agrees for every stage, with and without Inactive', () => {
    for (const m of MEMBERSHIPS) {
        assert.deepStrictEqual(
            Server.membershipTagsFor(m), Core.membershipTagsFor(m),
            `disagreed for ${JSON.stringify(m)}`
        );
    }
});

test('applyMembershipTags agrees, preserving non-membership tags', () => {
    const existing = ['Red Flag', 'Visitor', 'Member', 'Elder', 'Deacon'];
    for (const m of MEMBERSHIPS) {
        assert.deepStrictEqual(
            Server.applyMembershipTags(existing, m), Core.applyMembershipTags(existing, m),
            `disagreed for ${JSON.stringify(m)}`
        );
    }
});

test('carriesMemberTag agrees — including Moving Membership, which is a member', () => {
    for (const m of MEMBERSHIPS) {
        assert.strictEqual(
            Server.carriesMemberTag(m), Core.carriesMemberTag(m),
            `disagreed for ${JSON.stringify(m)}`
        );
    }
    assert.ok(Server.carriesMemberTag({ stage: 'moving_membership' }));
    assert.ok(!Server.carriesMemberTag({ stage: 'previous_member' }));
});

test('stageIndex places previous_member LATER than member, though it is not one', () => {
    // The trap that makes "is this person a member?" an unsafe index comparison,
    // and the reason shouldAdvanceToMember asks the projection instead.
    assert.ok(Server.stageIndex('previous_member') > Server.stageIndex('member'));
    assert.ok(!Server.carriesMemberTag({ stage: 'previous_member' }));
});

test('stageIndex reports -1 for anything that is not a stage', () => {
    assert.strictEqual(Server.stageIndex('bishop'), -1);
    assert.strictEqual(Server.stageIndex(null), -1);
});
