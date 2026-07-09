const { test } = require('node:test');
const assert = require('node:assert');

const Core = require('../public/shepherding-core.js');

// The Membership Track (ADR-0012) is the single church-relationship state
// machine: a Person sits at exactly one Membership Stage, and the code projects
// that stage onto an immutable set of Membership Tags so the Track plugs into
// the existing tag filter system. The stage is the source of truth; the tags
// are its synced projection. Inactive is orthogonal — off the Track entirely.
// These pin the pure heart of that model.

// ── Stage set and order ───────────────────────────────────────────────────────

test('the six Membership Stages are defined in Track order', () => {
    assert.deepStrictEqual(Core.MEMBERSHIP_STAGES, [
        'visitor',
        'regular_attender',
        'prospective_member',
        'member',
        'moving_membership',
        'previous_member',
    ]);
});

test('every stage has a human label', () => {
    for (const stage of Core.MEMBERSHIP_STAGES) {
        assert.strictEqual(typeof Core.MEMBERSHIP_STAGE_LABEL[stage], 'string');
        assert.ok(Core.MEMBERSHIP_STAGE_LABEL[stage].length > 0);
    }
    assert.strictEqual(Core.MEMBERSHIP_STAGE_LABEL.moving_membership, 'Moving Membership');
});

// ── membershipTagsFor: the stage → tag-set projection ─────────────────────────

test('each single-tag stage projects exactly its eponymous Membership Tag', () => {
    assert.deepStrictEqual(Core.membershipTagsFor({ stage: 'visitor' }), ['Visitor']);
    assert.deepStrictEqual(Core.membershipTagsFor({ stage: 'regular_attender' }), ['Regular Attender']);
    assert.deepStrictEqual(Core.membershipTagsFor({ stage: 'prospective_member' }), ['Prospective Member']);
    assert.deepStrictEqual(Core.membershipTagsFor({ stage: 'member' }), ['Member']);
    assert.deepStrictEqual(Core.membershipTagsFor({ stage: 'previous_member' }), ['Previous Member']);
});

test('Moving Membership projects BOTH its own tag and the Member tag', () => {
    // The deliberate overlap that keeps "Members = carries the Member tag" a
    // single trivial query while still distinguishing those mid-transfer.
    assert.deepStrictEqual(
        Core.membershipTagsFor({ stage: 'moving_membership' }),
        ['Moving Membership', 'Member']
    );
});

test('Inactive projects only the Inactive tag, overriding any retained stage', () => {
    // Inactive is off the Track: even though the stage value is retained for
    // restore, the projection is just the Inactive tag.
    assert.deepStrictEqual(Core.membershipTagsFor({ stage: 'member', inactive: true }), ['Inactive']);
    assert.deepStrictEqual(Core.membershipTagsFor({ inactive: true }), ['Inactive']);
});

test('a Person with no stage and not Inactive projects no Membership Tags', () => {
    assert.deepStrictEqual(Core.membershipTagsFor({}), []);
    assert.deepStrictEqual(Core.membershipTagsFor(null), []);
    assert.deepStrictEqual(Core.membershipTagsFor({ stage: null, inactive: false }), []);
});

// ── applyMembershipTags: the pure re-projection over a Person's tags ──────────

test('applyMembershipTags adds the stage tags while preserving non-membership tags', () => {
    const out = Core.applyMembershipTags(['Red Flag', 'Married'], { stage: 'member' });
    assert.deepStrictEqual(out, ['Red Flag', 'Married', 'Member']);
});

test('applyMembershipTags strips the old stage tags before adding the new ones', () => {
    // A Regular Attender advancing to Member loses the Regular Attender tag.
    const out = Core.applyMembershipTags(['Regular Attender', 'Red Flag'], { stage: 'member' });
    assert.deepStrictEqual(out, ['Red Flag', 'Member']);
});

test('applyMembershipTags swapping to Moving Membership yields both its tags', () => {
    const out = Core.applyMembershipTags(['Member'], { stage: 'moving_membership' });
    assert.deepStrictEqual(out, ['Moving Membership', 'Member']);
});

test('applyMembershipTags for Inactive replaces the stage tag with Inactive', () => {
    const out = Core.applyMembershipTags(['Member', 'Red Flag'], { stage: 'member', inactive: true });
    assert.deepStrictEqual(out, ['Red Flag', 'Inactive']);
});

test('applyMembershipTags is idempotent — re-projecting the same membership is a no-op', () => {
    const once = Core.applyMembershipTags(['Red Flag'], { stage: 'moving_membership' });
    const twice = Core.applyMembershipTags(once, { stage: 'moving_membership' });
    assert.deepStrictEqual(twice, once);
});

test('applyMembershipTags clearing Inactive restores the retained stage tags', () => {
    const inactive = Core.applyMembershipTags(['Member'], { stage: 'member', inactive: true });
    assert.deepStrictEqual(inactive, ['Inactive']);
    const restored = Core.applyMembershipTags(inactive, { stage: 'member', inactive: false });
    assert.deepStrictEqual(restored, ['Member']);
});

// ── carriesMemberTag: the Members-tab predicate ───────────────────────────────

test('carriesMemberTag is true for Member and Moving Membership, false otherwise', () => {
    assert.strictEqual(Core.carriesMemberTag({ stage: 'member' }), true);
    assert.strictEqual(Core.carriesMemberTag({ stage: 'moving_membership' }), true);
    assert.strictEqual(Core.carriesMemberTag({ stage: 'prospective_member' }), false);
    assert.strictEqual(Core.carriesMemberTag({ stage: 'visitor' }), false);
    assert.strictEqual(Core.carriesMemberTag({ stage: 'previous_member' }), false);
});

test('carriesMemberTag is false for an Inactive Person even if they were a Member', () => {
    assert.strictEqual(Core.carriesMemberTag({ stage: 'member', inactive: true }), false);
});

// ── isMembershipTagId / the immutable set ─────────────────────────────────────

test('the code-defined Membership Tag ids are the six stage tags plus Inactive', () => {
    assert.deepStrictEqual([...Core.MEMBERSHIP_TAG_IDS].sort(), [
        'Inactive', 'Member', 'Moving Membership', 'Prospective Member',
        'Regular Attender', 'Previous Member', 'Visitor',
    ].sort());
});

test('isMembershipTagId recognises Membership Tags and rejects ordinary tags', () => {
    assert.strictEqual(Core.isMembershipTagId('Member'), true);
    assert.strictEqual(Core.isMembershipTagId('Inactive'), true);
    assert.strictEqual(Core.isMembershipTagId('Moving Membership'), true);
    assert.strictEqual(Core.isMembershipTagId('Red Flag'), false);
    assert.strictEqual(Core.isMembershipTagId('Married'), false);
});

// ── membershipFromLegacyStatus: the migration mapping (ADR-0012) ──────────────

test('legacy membership.status values map to the new stage/inactive shape', () => {
    assert.deepStrictEqual(Core.membershipFromLegacyStatus('visitor'), { stage: 'visitor', inactive: false });
    assert.deepStrictEqual(Core.membershipFromLegacyStatus('regular_attender'), { stage: 'regular_attender', inactive: false });
    assert.deepStrictEqual(Core.membershipFromLegacyStatus('member'), { stage: 'member', inactive: false });
});

test('legacy inactive maps to the off-Track flag with no stage', () => {
    assert.deepStrictEqual(Core.membershipFromLegacyStatus('inactive'), { stage: null, inactive: true });
});

test('an absent or unrecognised legacy status yields an empty membership for hand-assignment', () => {
    assert.deepStrictEqual(Core.membershipFromLegacyStatus(undefined), { stage: null, inactive: false });
    assert.deepStrictEqual(Core.membershipFromLegacyStatus(''), { stage: null, inactive: false });
    assert.deepStrictEqual(Core.membershipFromLegacyStatus('prospective_member'), { stage: null, inactive: false });
});

// ── buildMembershipChange: the Pastoral Record entry (pure) ───────────────────

test('buildMembershipChange records the from/new stage and inactive transition', () => {
    const rec = Core.buildMembershipChange({
        previous: { stage: 'regular_attender', inactive: false },
        next: { stage: 'member', inactive: false },
        authorUid: 'u1',
        authorName: 'Elder Jane',
        source: 'profile',
    });
    assert.strictEqual(rec.kind, 'membership_change');
    assert.strictEqual(rec.previousStage, 'regular_attender');
    assert.strictEqual(rec.newStage, 'member');
    assert.strictEqual(rec.previousInactive, false);
    assert.strictEqual(rec.newInactive, false);
    assert.strictEqual(rec.authorName, 'Elder Jane');
    assert.strictEqual(rec.source, 'profile');
    assert.strictEqual(rec.explanation, '');
});

test('buildMembershipChange captures an Inactive toggle', () => {
    const rec = Core.buildMembershipChange({
        previous: { stage: 'member', inactive: false },
        next: { stage: 'member', inactive: true },
        source: 'people_list',
    });
    assert.strictEqual(rec.previousInactive, false);
    assert.strictEqual(rec.newInactive, true);
    assert.strictEqual(rec.newStage, 'member');
});

// ── describeMembershipChange: the human sentence shown in the Pastoral Record ──

test('describeMembershipChange reads forward moves as "Advanced to"', () => {
    const rec = Core.buildMembershipChange({
        previous: { stage: 'regular_attender' }, next: { stage: 'member' },
    });
    assert.strictEqual(Core.describeMembershipChange(rec), 'Advanced to Member');
});

test('describeMembershipChange reads backward moves as "Moved back to"', () => {
    const rec = Core.buildMembershipChange({
        previous: { stage: 'member' }, next: { stage: 'visitor' },
    });
    assert.strictEqual(Core.describeMembershipChange(rec), 'Moved back to Visitor');
});

test('describeMembershipChange reads going Inactive and coming back', () => {
    const off = Core.buildMembershipChange({
        previous: { stage: 'member', inactive: false }, next: { stage: 'member', inactive: true },
    });
    assert.strictEqual(Core.describeMembershipChange(off), 'Marked Inactive');

    const on = Core.buildMembershipChange({
        previous: { stage: 'member', inactive: true }, next: { stage: 'member', inactive: false },
    });
    assert.strictEqual(Core.describeMembershipChange(on), 'Reactivated as Member');
});

test('describeMembershipChange reads first placement on the Track as "Set to"', () => {
    const rec = Core.buildMembershipChange({
        previous: { stage: null }, next: { stage: 'visitor' },
    });
    assert.strictEqual(Core.describeMembershipChange(rec), 'Set to Visitor');
});

// ── A membership_change is its own Pastoral Record entry, not a status group ──

test('collapsePastoralRecord does not fold a membership_change into a status group', () => {
    // Track moves read as their own transition, never absorbed into a run of
    // status/tag changes.
    const record = [
        { _entryKind: 'status_change' },
        { _entryKind: 'membership_change' },
        { _entryKind: 'status_change' },
    ];
    const out = Core.collapsePastoralRecord(record);
    // status_change (group) → membership_change (passthrough) → status_change (group)
    assert.strictEqual(out.length, 3);
    assert.strictEqual(out[0]._entryKind, 'status_group');
    assert.strictEqual(out[1]._entryKind, 'membership_change');
    assert.strictEqual(out[2]._entryKind, 'status_group');
});
