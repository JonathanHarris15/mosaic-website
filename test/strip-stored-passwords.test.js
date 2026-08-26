const { test } = require('node:test');
const assert = require('node:assert');

const { patchForUser } = require('../scripts/strip-stored-passwords.js');

// Stands in for admin.firestore.FieldValue.delete(), exactly as
// backfill-relationship-types.test.js does — so the decision is testable
// without Firestore anywhere near it.
const DELETE = Symbol('FieldValue.delete()');

// ── What this decides (MS-241 / MS-300) ──────────────────────────────────────
//
// The code no longer writes a plaintext password. Every copy written before
// that change is still sitting in Firestore, and this is the pass that removes
// them. It is the step that actually retires the liability; everything before
// it only stopped the pile growing.
//
// One-way, no undo. So the decision of what to touch is pinned here, and a
// person runs it (MS-301) after reading what a dry run reports.

test('a user carrying a stored password yields a patch deleting that field', () => {
    const patch = patchForUser({
        email: 'someone@example.com',
        permissionLevel: 'member',
        password: 'hunter2',
    }, DELETE);

    assert.deepStrictEqual(patch, { password: DELETE });
});

test('a user with no stored password yields no patch — a second run is a no-op', () => {
    assert.strictEqual(patchForUser({
        email: 'someone@example.com',
        permissionLevel: 'member',
    }, DELETE), null);
});

// ⚠ The field being empty is not the field being absent. An account created
// through some path that wrote `password: ''` still carries the key, and a run
// that skipped it would report zero remaining while the key was still there.
test('an empty or null stored password is still removed', () => {
    for (const value of ['', null, 0, false]) {
        assert.deepStrictEqual(
            patchForUser({ email: 'a@b.com', password: value }, DELETE),
            { password: DELETE },
            `a password field holding ${JSON.stringify(value)} should still be deleted`);
    }
});

// ⚠ THE ONE THAT MATTERS MOST ON A ONE-WAY PASS.
//
// This runs over `users`, which is where permission levels live. A patch that
// carried anything else could demote the whole church, and there is no undo.
test('the patch names one field and only one field', () => {
    const patch = patchForUser({
        email: 'someone@example.com',
        permissionLevel: 'super_admin',
        role: 'super_admin',
        personId: 'person_123',
        dashboardCardOrder: ['a', 'b'],
        createdAt: 'a timestamp',
        password: 'hunter2',
    }, DELETE);

    assert.deepStrictEqual(Object.keys(patch), ['password'],
        'the cleanup patch touches a field other than password — this runs over the ' +
        'collection that holds permission levels, and it has no undo');
});

test('a malformed or empty document is skipped rather than guessed at', () => {
    assert.strictEqual(patchForUser({}, DELETE), null);
    assert.strictEqual(patchForUser(null, DELETE), null);
    assert.strictEqual(patchForUser(undefined, DELETE), null);
});

// The dry run's count is the number a person reads before committing (MS-301),
// so it has to mean exactly "documents this would change".
test('the documents needing work are exactly those that yield a patch', () => {
    const docs = [
        { email: 'a@b.com', password: 'x' },
        { email: 'c@d.com' },
        { email: 'e@f.com', password: '' },
        {},
    ];

    const needing = docs.filter(d => patchForUser(d, DELETE) !== null);
    assert.strictEqual(needing.length, 2);
});
