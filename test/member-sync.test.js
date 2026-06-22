const { test } = require('node:test');
const assert = require('node:assert');

const {
    MEMBER_TAG,
    MEMBER_ROLE,
    isMemberOrHigher,
    hasMemberTag,
    shouldAddMemberTag,
    shouldPromoteToMember,
} = require('../functions/member-sync.js');

// The member-status sync (users <-> directory people) is ADD-ONLY: a role grants
// the member tag and the tag promotes to member, but neither ever strips the
// other, and a write is skipped once already in sync so the two Firestore
// triggers don't loop. These pin that invariant.

test('isMemberOrHigher recognises member and every higher role', () => {
    for (const r of ['member', 'editor', 'elder', 'admin', 'super_admin']) {
        assert.strictEqual(isMemberOrHigher(r), true, r);
    }
    for (const r of ['viewer', 'guest', undefined, null, '']) {
        assert.strictEqual(isMemberOrHigher(r), false, String(r));
    }
});

test('shouldAddMemberTag: member+ without the tag → add', () => {
    assert.strictEqual(shouldAddMemberTag('elder', []), true);
    assert.strictEqual(shouldAddMemberTag('member', ['other']), true);
});

test('shouldAddMemberTag: already tagged → skip (no loop)', () => {
    assert.strictEqual(shouldAddMemberTag('elder', ['Member']), false);
});

test('the directory tag is capital "Member"; the account role is lowercase "member"', () => {
    // The two were once one constant — splitting them is what stopped the role
    // sync from writing a "Member"-cased role, and the tag from being lowercase.
    assert.strictEqual(MEMBER_TAG, 'Member');
    assert.strictEqual(MEMBER_ROLE, 'member');
    assert.notStrictEqual(MEMBER_TAG, MEMBER_ROLE);
});

test('hasMemberTag matches either casing — no duplicate is ever added', () => {
    assert.strictEqual(hasMemberTag(['Member']), true);
    assert.strictEqual(hasMemberTag(['member']), true);  // legacy lowercase still counts
    assert.strictEqual(hasMemberTag(['MEMBER']), true);
    // So a person already carrying any casing is never re-tagged, in either direction.
    assert.strictEqual(shouldAddMemberTag('elder', ['member']), false);
    assert.strictEqual(shouldAddMemberTag('admin', ['Member', 'Deacon']), false);
});

test('hasMemberTag is whole-tag, not substring — "Former Member" is a different tag', () => {
    assert.strictEqual(hasMemberTag(['Former Member']), false);
    assert.strictEqual(hasMemberTag(['New Members']), false);
    assert.strictEqual(hasMemberTag([]), false);
    assert.strictEqual(hasMemberTag(undefined), false);
    assert.strictEqual(hasMemberTag([null, 42, 'Member']), true); // tolerates junk entries
});

test('shouldAddMemberTag: below member → never tag (add-only)', () => {
    assert.strictEqual(shouldAddMemberTag('viewer', []), false);
    assert.strictEqual(shouldAddMemberTag('viewer', ['member']), false);
});

test('shouldAddMemberTag tolerates missing tags array', () => {
    assert.strictEqual(shouldAddMemberTag('admin', undefined), true);
});

test('shouldPromoteToMember: below member → promote', () => {
    assert.strictEqual(shouldPromoteToMember('viewer'), true);
    assert.strictEqual(shouldPromoteToMember(undefined), true);
});

test('shouldPromoteToMember: already member+ → never demote, skip', () => {
    for (const r of ['member', 'editor', 'elder', 'admin', 'super_admin']) {
        assert.strictEqual(shouldPromoteToMember(r), false, r);
    }
});
