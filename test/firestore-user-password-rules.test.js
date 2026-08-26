const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// MS-302 (MS-241, ADR-0040) — no user document may carry a password.
//
// Sign-up wrote the password into `users/{uid}` in plain text, and three other
// paths copied that line. The code no longer does. But code is deployed and
// browsers are cached: a stale tab running the old sign-up block would put the
// field straight back, and nothing in the app would notice.
//
// So the bar moves into the rules, where it holds regardless of which version of
// the page is running.
//
// Like the other rules tests here, this pins the SHAPE rather than exercising it:
// live enforcement needs a real project and stays a human verification step. The
// emulator harness in test/emulator/ cannot stand in — it drives Firestore
// through the Admin SDK, which bypasses rules entirely.
//
// ⚠ THE FAILURE THIS IS REALLY GUARDING AGAINST is somebody tidying the two
// admin lines back into one `allow read, write: if isAdmin()`. That reads like a
// harmless simplification and silently reopens the hole, because one allow
// statement granting a request is enough — the password bar on `create` would
// stop mattering. See the assertion at the bottom.
//
// Follows the pattern of firestore-people-directory-rules.test.js.

// Normalised to LF — the block patterns close on `\n    }`, which never matches
// a CRLF checkout, leaving the shape they pin unchecked.
const rules = fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8')
    .replace(/\r\n/g, '\n');

const usersBlock = () => {
    const m = rules.match(/match \/users\/\{userId\}\s*\{([\s\S]*?)\n    \}/);
    assert.ok(m, 'no rule block for /users/{userId}');
    return m[1];
};

test('there is a helper that refuses a password key', () => {
    assert.match(rules, /function noStoredPassword\(\)\s*\{\s*return !\('password' in request\.resource\.data\);\s*\}/,
        'noStoredPassword() is missing or no longer checks for a password key. Firebase Auth ' +
        'holds the hashed copy; a readable second one in Firestore is MS-241.');
});

test('a user creating their own document cannot include a password', () => {
    const block = usersBlock();
    const create = block.match(/allow create: if request\.auth != null[\s\S]*?;/);

    assert.ok(create, 'no self-create rule found on /users/{userId}');
    assert.match(create[0], /noStoredPassword\(\)/,
        'sign-up can still write a password field. This is the exact line the bug lived on, ' +
        'and a cached browser running the old page is how it would come back.');
});

test('an admin cannot write a password either', () => {
    const block = usersBlock();

    assert.match(block, /allow create, update: if isAdmin\(\) && noStoredPassword\(\);/,
        'the admin write path does not carry the password bar. Admins may SET a password ' +
        'through Firebase Auth (a Cloud Function, which bypasses rules); they may not file ' +
        'a readable one in Firestore.');
});

// ⚠ The one that matters most. `allow read, write: if isAdmin()` is what the
// block used to say, and restoring it would quietly undo every assertion above:
// rules OR together, so one statement granting the write is enough.
test('the admin grant is split, so no single statement re-permits a password', () => {
    const block = usersBlock();

    assert.ok(!/allow read, write: if isAdmin\(\);/.test(block),
        'the admin rule has been collapsed back to `allow read, write: if isAdmin()`. ' +
        'That grants a create carrying a password regardless of the rule above it, because ' +
        'one allow statement granting a request is enough. Keep read / create,update / delete ' +
        'separate.');

    assert.ok(!/allow write:/.test(block),
        'a bare `allow write` on /users covers create, update AND delete. Delete has no ' +
        'request.resource to inspect, so the password bar cannot be attached to it — which ' +
        'is why the three verbs are listed separately.');
});

test('a delete is still allowed, and does not ask about a field that is not there', () => {
    const block = usersBlock();

    assert.match(block, /allow delete: if isAdmin\(\);/,
        'admins can no longer delete a user document. A delete carries no request.resource, ' +
        'so it is granted on its own line rather than being caught by the password bar.');
});

// The self-update rule was already narrow. Worth pinning: it is the third way a
// password could arrive, and it is closed by a different mechanism.
test('a user updating their own document can still only touch their dashboard order', () => {
    const block = usersBlock();

    assert.match(block, /affectedKeys\(\)\.hasOnly\(\['dashboardCardOrder'\]\)/,
        'the self-update rule no longer restricts which keys it may touch. That is what stops ' +
        'somebody adding a password — or promoting themselves — through their own document.');
});
