const { test } = require('node:test');
const assert = require('node:assert');

const {
    MEMBER_TAG,
    MEMBER_PERMISSION_LEVEL,
    isMemberOrHigher,
    hasMemberTag,
    shouldAdvanceToMember,
    memberAdvanceUpdate,
    buildMemberAdvanceRecord,
    shouldPromoteToMember,
} = require('../functions/member-sync.js');

const Core = require('../public/shepherding-core.js');

// The member-status sync (users <-> directory people) is ADD-ONLY: a permission
// level advances a Person along the Membership Track, and the Member tag
// promotes a login, but neither ever moves the other backwards, and a write is
// skipped once already in sync so the two Firestore triggers don't loop.
//
// ADR-0026 changed direction A from writing the "Member" TAG to moving the
// STAGE. Under ADR-0012 the tag is a projection of the stage, so writing it
// directly produced a Person whose stage said Visitor and whose tags said
// Member — and the Membership Directory reads the tag, so the directory and the
// Track disagreed about the same human. These pin the new behaviour.

test('isMemberOrHigher recognises member and every higher level', () => {
    for (const r of ['member', 'editor', 'elder', 'admin', 'super_admin']) {
        assert.strictEqual(isMemberOrHigher(r), true, r);
    }
    for (const r of ['viewer', 'guest', undefined, null, '']) {
        assert.strictEqual(isMemberOrHigher(r), false, String(r));
    }
});

test('the directory tag is capital "Member"; the account level is lowercase "member"', () => {
    // The two were once one constant — splitting them is what stopped the level
    // sync from writing a "Member"-cased level, and the tag from being lowercase.
    assert.strictEqual(MEMBER_TAG, 'Member');
    assert.strictEqual(MEMBER_PERMISSION_LEVEL, 'member');
    assert.notStrictEqual(MEMBER_TAG, MEMBER_PERMISSION_LEVEL);
});

test('hasMemberTag matches either casing, whole-tag only', () => {
    assert.strictEqual(hasMemberTag(['Member']), true);
    assert.strictEqual(hasMemberTag(['member']), true);  // legacy lowercase still counts
    assert.strictEqual(hasMemberTag(['MEMBER']), true);
    assert.strictEqual(hasMemberTag(['Former Member']), false);
    assert.strictEqual(hasMemberTag(['New Members']), false);
    assert.strictEqual(hasMemberTag([]), false);
    assert.strictEqual(hasMemberTag(undefined), false);
    assert.strictEqual(hasMemberTag([null, 42, 'Member']), true); // tolerates junk
});

// ── Direction A: the permission level moves the STAGE ─────────────────────────

test('a member+ login advances a Person from any earlier stage', () => {
    for (const stage of ['visitor', 'regular_attender', 'prospective_member']) {
        assert.strictEqual(
            shouldAdvanceToMember('member', { stage, inactive: false }), true, stage);
    }
});

test('a member+ login places a Person who has no stage at all', () => {
    assert.strictEqual(shouldAdvanceToMember('elder', { stage: null }), true);
    assert.strictEqual(shouldAdvanceToMember('elder', {}), true);
    assert.strictEqual(shouldAdvanceToMember('elder', undefined), true);
});

test('every level from member up advances; nothing below does', () => {
    for (const level of ['member', 'editor', 'elder', 'admin', 'super_admin']) {
        assert.strictEqual(
            shouldAdvanceToMember(level, { stage: 'visitor' }), true, level);
    }
    for (const level of ['viewer', 'guest', undefined, null, '']) {
        assert.strictEqual(
            shouldAdvanceToMember(level, { stage: 'visitor' }), false, String(level));
    }
});

test('an existing member is left alone — which is also the loop guard', () => {
    assert.strictEqual(shouldAdvanceToMember('admin', { stage: 'member' }), false);
});

test('Moving Membership is left alone: they already carry the Member tag', () => {
    // The case a naive "is their stage exactly member?" check would get wrong,
    // re-writing the stage of someone mid-transfer and losing that fact.
    assert.strictEqual(
        shouldAdvanceToMember('admin', { stage: 'moving_membership' }), false);
});

test('a Previous Member is never re-admitted by a login', () => {
    // They left. Note this stage sits LATER on the Track than `member`, so an
    // index comparison alone would not save us — the projection is asked.
    assert.strictEqual(
        shouldAdvanceToMember('admin', { stage: 'previous_member' }), false);
});

test('an Inactive Person is never reactivated by a login', () => {
    // Inactive is a deliberate editor decision and dominates any retained stage.
    assert.strictEqual(
        shouldAdvanceToMember('admin', { stage: 'visitor', inactive: true }), false);
    assert.strictEqual(
        shouldAdvanceToMember('admin', { stage: null, inactive: true }), false);
});

// ── What the advance actually writes ─────────────────────────────────────────

test('the advance moves the stage with dotted paths, so the rest of membership survives', () => {
    const update = memberAdvanceUpdate(['Visitor']);
    assert.strictEqual(update['membership.stage'], 'member');
    assert.strictEqual(update['membership.inactive'], false);
    // No whole-object `membership` write — joinedAt and the back-compat status
    // field on that object would be destroyed by one.
    assert.ok(!('membership' in update));
});

test('the tags are RE-PROJECTED from the new stage, not appended to', () => {
    // The heart of ADR-0026. The old code did arrayUnion('Member') and left
    // 'Visitor' sitting there, so the Person read as both.
    const update = memberAdvanceUpdate(['Visitor', 'Red Flag']);
    assert.deepStrictEqual(update.tags, ['Red Flag', 'Member']);
});

test('non-membership tags are preserved through the advance', () => {
    const update = memberAdvanceUpdate(['Red Flag', 'Elder', 'Prospective Member']);
    assert.deepStrictEqual(update.tags, ['Red Flag', 'Elder', 'Member']);
});

test('the projected tags agree with the canonical projection', () => {
    const update = memberAdvanceUpdate(['Visitor']);
    assert.deepStrictEqual(
        update.tags,
        Core.applyMembershipTags(['Visitor'], { stage: 'member', inactive: false })
    );
});

test('the advance is idempotent on tags — running it twice changes nothing', () => {
    const once = memberAdvanceUpdate(['Visitor', 'Red Flag']).tags;
    const twice = memberAdvanceUpdate(once).tags;
    assert.deepStrictEqual(twice, once);
});

test('a Person with no tags at all comes out carrying just Member', () => {
    assert.deepStrictEqual(memberAdvanceUpdate(undefined).tags, ['Member']);
    assert.deepStrictEqual(memberAdvanceUpdate([]).tags, ['Member']);
});

// ── The Pastoral Record entry ────────────────────────────────────────────────

test('the advance logs a Membership Change, so the record does not credit nobody', () => {
    const record = buildMemberAdvanceRecord({ stage: 'visitor' }, 'elder');
    assert.strictEqual(record.kind, 'membership_change');
    assert.strictEqual(record.previousStage, 'visitor');
    assert.strictEqual(record.newStage, 'member');
    assert.strictEqual(record.source, 'account_sync');
});

test('the record names no human author, because no human did it', () => {
    const record = buildMemberAdvanceRecord({ stage: 'visitor' }, 'elder');
    assert.strictEqual(record.authorUid, null);
    assert.match(record.authorName, /Account sync/);
    assert.match(record.explanation, /elder/);
});

test('the record has the same shape the slider writes, so the feed renders it', () => {
    const record = buildMemberAdvanceRecord({ stage: 'visitor', inactive: false }, 'admin');
    const fromSlider = Core.buildMembershipChange({
        previous: { stage: 'visitor', inactive: false },
        next: { stage: 'member', inactive: false },
        authorUid: null, authorName: '', source: 'people_list',
    });
    assert.deepStrictEqual(Object.keys(record).sort(), Object.keys(fromSlider).sort());
});

test('the record reads as a Track advance in the Pastoral Record feed', () => {
    const record = buildMemberAdvanceRecord({ stage: 'visitor' }, 'elder');
    assert.strictEqual(Core.describeMembershipChange(record), 'Advanced to Member');
});

test('a Person with no prior stage reads as a first placement', () => {
    const record = buildMemberAdvanceRecord({}, 'editor');
    assert.strictEqual(record.previousStage, null);
    assert.strictEqual(Core.describeMembershipChange(record), 'Set to Member');
});

// ── Direction B: the Member tag promotes the login ───────────────────────────

test('shouldPromoteToMember: below member → promote', () => {
    assert.strictEqual(shouldPromoteToMember('viewer'), true);
    assert.strictEqual(shouldPromoteToMember(undefined), true);
});

test('shouldPromoteToMember: already member+ → never demote, skip', () => {
    for (const r of ['member', 'editor', 'elder', 'admin', 'super_admin']) {
        assert.strictEqual(shouldPromoteToMember(r), false, r);
    }
});

// ── The two directions must not loop into each other ─────────────────────────

test('once in sync, neither direction wants to write again', () => {
    // A member+ login and a Person at the member stage: A refuses because they
    // already carry the Member tag, B refuses because the login is already
    // member-or-higher. Without both refusals the two triggers ping-pong.
    const membership = { stage: 'member', inactive: false };
    assert.strictEqual(shouldAdvanceToMember('elder', membership), false);
    assert.strictEqual(shouldPromoteToMember('elder'), false);
});
