const { test } = require('node:test');
const assert = require('node:assert');
const door = require('../functions/app-check-door');

// MS-534 — the public form door's App Check allow/deny table.
//
// This tests the real decision function publicForm calls, not a mock of it.
// Platform `enforceAppCheck` is deliberately false so this code actually
// runs (monitor cannot log if Firebase 401s first).

const validApp = {appId: '1:1004095249066:web:0dcbf3cbbcd0be2ff4bbdd'};

test('enforce rejects a missing token and an invalid one', () => {
    const missing = door.verdict('enforce', undefined);
    assert.strictEqual(missing.reject, true);
    assert.strictEqual(missing.code, 'unauthenticated');
    assert.strictEqual(missing.tokenState, 'missing-or-invalid');
    assert.strictEqual(missing.log, true);

    const invalid = door.verdict('enforce', null);
    assert.strictEqual(invalid.reject, true);

    const notAnObject = door.verdict('enforce', 'nope');
    assert.strictEqual(notAnObject.reject, true);
});

test('enforce allows a valid App Check token', () => {
    const allowed = door.verdict('enforce', validApp);
    assert.strictEqual(allowed.reject, false);
    assert.strictEqual(allowed.tokenState, 'valid');
    assert.strictEqual(allowed.log, false);
});

test('monitor does not reject missing or invalid tokens', () => {
    const missing = door.verdict('monitor', undefined);
    assert.strictEqual(missing.reject, false);
    assert.strictEqual(missing.log, true,
        'monitor with no token must still log, or the rollout is flying blind');
    assert.strictEqual(missing.mode, 'monitor');

    const valid = door.verdict('monitor', validApp);
    assert.strictEqual(valid.reject, false);
    assert.strictEqual(valid.log, false);
});

test('off neither logs nor refuses', () => {
    const missing = door.verdict('off', undefined);
    assert.strictEqual(missing.reject, false);
    assert.strictEqual(missing.log, false);
    const valid = door.verdict('off', validApp);
    assert.strictEqual(valid.reject, false);
    assert.strictEqual(valid.log, false);
});

test('an unknown mode falls back to monitor, never enforce', () => {
    const typo = door.verdict('ENFORSE', undefined);
    assert.strictEqual(typo.mode, 'monitor');
    assert.strictEqual(typo.reject, false,
        'a typo in PUBLIC_FORM_APP_CHECK_MODE must not lock the forms');
    assert.strictEqual(door.normaliseMode(''), 'monitor');
    assert.strictEqual(door.normaliseMode(null), 'monitor');
});

test('the metric payload names the door and never carries answers', () => {
    const decision = door.verdict('monitor', undefined);
    const payload = door.metricPayload(decision, {
        op: 'submit',
        formId: '7bQm2xK9vRt4Lp8sYw3NcF',
        answers: {secret: 'must not ship'},
    });
    assert.strictEqual(payload.door, 'publicForm');
    assert.strictEqual(payload.appCheckMode, 'monitor');
    assert.strictEqual(payload.appCheckToken, 'missing-or-invalid');
    assert.strictEqual(payload.appCheckReject, false);
    assert.strictEqual(payload.op, 'submit');
    assert.strictEqual(payload.formId, '7bQm2xK9vRt4Lp8sYw3NcF');
    assert.ok(!('answers' in payload), 'an answer leaked into the App Check log');
});
