const { test } = require('node:test');
const assert = require('node:assert');

const { canUnlink, planUnlink } = require('../functions/linked-user.js');
const DirectoryRequest = require('../functions/directory-request.js');
const Levels = require('../public/account-levels-core.js');

function account(preset, extra) {
    return Object.assign({}, Levels.userWriteFromLevel(Levels.BUILTIN_LEVEL_IDS[preset]), extra || {});
}

// Breaking a Linked User: clearing users/{uid}.personId ↔ people/{id}.userId
// when the wrong account got connected to the wrong record (ADR-0028). An
// editor's job, done through a callable because `users` is admin-only.

test('editors, elders and admins may disconnect an account', () => {
    for (const level of ['editor', 'elder', 'admin', 'super_admin', 'pastoral_assistant']) {
        assert.ok(canUnlink(level), level);
        assert.ok(canUnlink(account(level)), level);
    }
});

test('members and viewers may not', () => {
    for (const level of ['member', 'viewer', 'guest', '', null, undefined]) {
        assert.ok(!canUnlink(level), String(level));
    }
    assert.ok(!canUnlink({permissionLevel: 'editor'}));
    assert.ok(!canUnlink({permissionLevel: 'member', pastoralAssistant: true}));
    assert.ok(!canUnlink({role: 'admin'}));
});

test('whoever may resolve a directory request may disconnect the account', () => {
    const samples = [
        'editor', 'elder', 'admin', 'super_admin', 'pastoral_assistant',
        'member', 'viewer',
        account('editor'),
        account('pastoral_assistant'),
        {accountLevelId: 'level_editor'},
        {permissionLevel: 'editor'},
        {permissionLevel: 'member', pastoralAssistant: true},
    ];
    for (const who of samples) {
        assert.strictEqual(canUnlink(who), DirectoryRequest.canResolve(who),
            JSON.stringify(who));
    }
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
