const { test } = require('node:test');
const assert = require('node:assert');

const Core = require('../public/account-recovery-core.js');

// ── What this pins ───────────────────────────────────────────────────────────
//
// Getting back into your account is the replacement for an admin reading your
// password off a screen (MS-241). The decisions worth testing are not the
// Firebase calls — those are one line each — but what we TELL somebody, because
// one of those messages is a security property rather than a nicety.

test('an address needs an @ and a dot to be worth sending to', () => {
    assert.equal(Core.validateEmail('someone@example.com'), true);
    assert.equal(Core.validateEmail('someone@example.co.uk'), true);

    assert.equal(Core.validateEmail('someone'), false);
    assert.equal(Core.validateEmail('someone@example'), false);
    assert.equal(Core.validateEmail('someone.example.com'), false);
    assert.equal(Core.validateEmail(''), false);
    assert.equal(Core.validateEmail(null), false);
    assert.equal(Core.validateEmail(undefined), false);
});

test('a reset with no error reports that it was sent', () => {
    const outcome = Core.resetOutcome(null);
    assert.equal(outcome.ok, true);
    assert.match(outcome.message, /check|sent|email/i);
});

// ⚠ THE ONE THAT IS A SECURITY PROPERTY, NOT A WORDING PREFERENCE.
//
// The login page is open to the whole internet. If "no account with that
// address" reads differently from "sent", then anybody can type addresses at it
// and learn which ones belong to this congregation — turning the door into a
// way to find out who attends this church. So the two are the SAME answer, and
// this test is what keeps them the same when somebody later decides the
// not-found case deserves a more helpful message.
test('an unregistered address is answered exactly as a registered one', () => {
    const sent = Core.resetOutcome(null);
    const missing = Core.resetOutcome('auth/user-not-found');

    assert.deepStrictEqual(missing, sent);
});

test('a malformed address is told so — that is about the input, not the account', () => {
    const outcome = Core.resetOutcome('auth/invalid-email');
    assert.equal(outcome.ok, false);
    assert.notEqual(outcome.message, Core.resetOutcome(null).message);
});

test('being rate-limited says so rather than claiming it was sent', () => {
    const outcome = Core.resetOutcome('auth/too-many-requests');
    assert.equal(outcome.ok, false);
    assert.notEqual(outcome.message, Core.resetOutcome(null).message);
});

test('an unrecognised failure is reported as a failure, not as success', () => {
    const outcome = Core.resetOutcome('auth/network-request-failed');
    assert.equal(outcome.ok, false);
    assert.ok(outcome.message.length > 0);
});

// ── Changing your own password ───────────────────────────────────────────────
//
// This used to be checked by comparing what you typed against a plaintext copy
// in Firestore. It is now checked by Firebase Auth, which is the only party
// that should ever have held it. These are the answers that check gives back.

test('a successful change says so', () => {
    const outcome = Core.passwordChangeOutcome(null);
    assert.equal(outcome.ok, true);
});

test('both ways Firebase reports a wrong current password read the same', () => {
    const wrong = Core.passwordChangeOutcome('auth/wrong-password');
    const invalid = Core.passwordChangeOutcome('auth/invalid-credential');

    assert.equal(wrong.ok, false);
    assert.deepStrictEqual(invalid, wrong);
    assert.match(wrong.message, /not correct|incorrect/i);
});

test('a weak new password is distinguished from a wrong current one', () => {
    const weak = Core.passwordChangeOutcome('auth/weak-password');
    assert.equal(weak.ok, false);
    assert.notEqual(weak.message, Core.passwordChangeOutcome('auth/wrong-password').message);
});

test('a stale session is told to sign in again rather than blamed on the password', () => {
    const stale = Core.passwordChangeOutcome('auth/requires-recent-login');
    assert.equal(stale.ok, false);
    assert.notEqual(stale.message, Core.passwordChangeOutcome('auth/wrong-password').message);
});

// Every message is a fixed sentence, never one built out of what came in. This
// is what stops a raw Firebase error — which can carry the request that caused
// it — from being pasted onto the screen, and it is the habit the old code had:
// `'Update failed: ' + error.message`.
test('an outcome never echoes its input back to the screen', () => {
    const marker = 'auth/SHOULD-NOT-BE-QUOTED-BACK';

    for (const outcome of [Core.resetOutcome(marker), Core.passwordChangeOutcome(marker)]) {
        assert.equal(typeof outcome.message, 'string');
        assert.ok(outcome.message.length > 0);
        assert.ok(!outcome.message.includes(marker),
            `the message quotes its input back: ${outcome.message}`);
        assert.ok(!outcome.message.includes('SHOULD-NOT'),
            `the message quotes its input back: ${outcome.message}`);
    }
});

// Every branch answers with both fields, so no caller has to guess whether a
// missing `ok` meant success.
test('every outcome carries both an ok flag and a message', () => {
    const codes = [null, undefined, '', 'auth/wrong-password', 'auth/invalid-credential',
        'auth/weak-password', 'auth/requires-recent-login', 'auth/user-not-found',
        'auth/invalid-email', 'auth/too-many-requests', 'auth/network-request-failed',
        'something-unexpected'];

    for (const code of codes) {
        for (const outcome of [Core.resetOutcome(code), Core.passwordChangeOutcome(code)]) {
            assert.equal(typeof outcome.ok, 'boolean', `ok missing for ${code}`);
            assert.equal(typeof outcome.message, 'string', `message missing for ${code}`);
            assert.ok(outcome.message.length > 0, `empty message for ${code}`);
        }
    }
});
