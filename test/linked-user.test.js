const { test } = require('node:test');
const assert = require('node:assert');

const { UNLINK_LEVELS, canUnlink, planUnlink } = require('../functions/linked-user.js');
const DirectoryRequest = require('../functions/directory-request.js');

// Breaking a Linked User: clearing users/{uid}.personId ↔ people/{id}.userId
// when the wrong account got connected to the wrong record (ADR-0028). An
// editor's job, done through a callable because `users` is admin-only.

test('editors, elders and admins may disconnect an account', () => {
    for (const level of ['editor', 'elder', 'admin', 'super_admin']) {
        assert.ok(canUnlink(level), level);
    }
});

test('members and viewers may not', () => {
    for (const level of ['member', 'viewer', 'guest', '', null, undefined]) {
        assert.ok(!canUnlink(level), String(level));
    }
});

test('whoever may connect an account may disconnect it', () => {
    // Leaving these sets out of step would let someone create a mistake they
    // could not then correct.
    assert.deepStrictEqual(UNLINK_LEVELS, DirectoryRequest.RESOLVER_LEVELS);
});

test('unlinking a connected record names the account to clear', () => {
    const plan = planUnlink({ name: 'Jane Doe', userId: 'u1' });
    assert.deepStrictEqual(plan, { action: 'unlink', uid: 'u1', reason: null });
});

test('a record with no account is refused, not silently no-opped', () => {
    const plan = planUnlink({ name: 'Jane Doe' });
    assert.strictEqual(plan.action, 'refuse');
    assert.match(plan.reason, /not connected to an account/);
});

test('a record that has been deleted is refused', () => {
    const plan = planUnlink(null);
    assert.strictEqual(plan.action, 'refuse');
    assert.match(plan.reason, /no longer exists/);
});

test('an empty userId counts as not connected', () => {
    assert.strictEqual(planUnlink({ userId: '' }).action, 'refuse');
    assert.strictEqual(planUnlink({ userId: null }).action, 'refuse');
});
