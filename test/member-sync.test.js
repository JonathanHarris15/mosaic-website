const { test } = require('node:test');
const assert = require('node:assert');

const {
    isMemberOrHigher,
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
    assert.strictEqual(shouldAddMemberTag('elder', ['member']), false);
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
