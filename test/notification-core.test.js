const {test} = require('node:test');
const assert = require('node:assert');

const nc = require('../functions/notification-core.js');

// The decision core (MS-251). No Firebase, no network, no clock of its own —
// the caller hands it an hour or an instant. Route words live here because
// this is the only place that picks a channel.

test('the module loads under plain Node', () => {
    assert.strictEqual(typeof nc.chooseRoute, 'function');
    assert.strictEqual(typeof nc.isDeadToken, 'function');
    assert.strictEqual(typeof nc.renderLockScreen, 'function');
    assert.strictEqual(typeof nc.renderText, 'function');
    assert.strictEqual(typeof nc.isInsideSendWindow, 'function');
});

// ── Which route ────────────────────────────────────────────────────────────

const routes = [
    {hasLiveToken: false, hasPhone: false, escalate: false, expect: 'none'},
    {hasLiveToken: false, hasPhone: false, escalate: true, expect: 'none'},
    {hasLiveToken: false, hasPhone: true, escalate: false, expect: 'text'},
    {hasLiveToken: false, hasPhone: true, escalate: true, expect: 'text'},
    {hasLiveToken: true, hasPhone: false, escalate: false, expect: 'push'},
    {hasLiveToken: true, hasPhone: false, escalate: true, expect: 'push'},
    {hasLiveToken: true, hasPhone: true, escalate: false, expect: 'push'},
    {hasLiveToken: true, hasPhone: true, escalate: true, expect: 'text'},
];

for (const row of routes) {
    test(`route token=${row.hasLiveToken} phone=${row.hasPhone} escalate=${row.escalate} → ${row.expect}`, () => {
        assert.strictEqual(nc.chooseRoute(row), row.expect);
    });
}

test('a token the provider accepted ends the send', () => {
    assert.strictEqual(nc.afterPushAttempt({
        anyAccepted: true, anyRetryable: false, hasPhone: true,
    }), 'done');
});

test('every token dead, and a phone, falls through to a text in the same run', () => {
    assert.strictEqual(nc.afterPushAttempt({
        anyAccepted: false, anyRetryable: false, hasPhone: true,
    }), 'text');
});

test('a retryable provider error does not become a text', () => {
    assert.strictEqual(nc.afterPushAttempt({
        anyAccepted: false, anyRetryable: true, hasPhone: true,
    }), 'stop');
});

test('every token dead, and no phone, reaches nobody', () => {
    assert.strictEqual(nc.afterPushAttempt({
        anyAccepted: false, anyRetryable: false, hasPhone: false,
    }), 'unreachable');
});

// ── Dead tokens ────────────────────────────────────────────────────────────
// The provider's real codes. An unrecognised error is retryable, not dead.

const dead = [
    'UNREGISTERED',
    'INVALID_ARGUMENT',
    'messaging/registration-token-not-registered',
    'messaging/invalid-registration-token',
    'messaging/invalid-argument',
];

for (const code of dead) {
    test(`${code} is a dead token`, () => {
        assert.strictEqual(nc.isDeadToken(code), true);
        assert.strictEqual(nc.isDeadToken({code: code}), true);
    });
}

test('an unrecognised error is not a dead token', () => {
    assert.strictEqual(nc.isDeadToken('UNAVAILABLE'), false);
    assert.strictEqual(nc.isDeadToken('messaging/internal-error'), false);
    assert.strictEqual(nc.isDeadToken('messaging/server-unavailable'), false);
    assert.strictEqual(nc.isDeadToken('totally-unknown'), false);
    assert.strictEqual(nc.isDeadToken(null), false);
    assert.strictEqual(nc.isDeadToken({}), false);
});

test('a nested errorInfo code is read', () => {
    assert.strictEqual(nc.isDeadToken({
        errorInfo: {code: 'messaging/registration-token-not-registered'},
    }), true);
});

// ── Wording ────────────────────────────────────────────────────────────────

test('a lock screen substitutes the first name', () => {
    const msg = nc.renderLockScreen({
        title: 'Hello {name}',
        body: '{name}, Sunday',
        titleFallback: 'Fallback title',
        bodyFallback: 'Fallback body',
        firstName: 'Jane',
    });
    assert.deepStrictEqual(msg, {title: 'Hello Jane', body: 'Jane, Sunday'});
});

test('a text substitutes the first name and falls back to there', () => {
    assert.strictEqual(nc.renderText({
        template: 'Hi {name}.', fallback: 'Default {name}.', firstName: 'Sam',
    }), 'Hi Sam.');
    assert.strictEqual(nc.renderText({
        template: 'Hi {name}.', fallback: 'Default {name}.', firstName: '',
    }), 'Hi there.');
});

test('a blank template falls back per field', () => {
    const msg = nc.renderLockScreen({
        title: '   ',
        body: 'Body for {name}',
        titleFallback: 'Sunday prayer',
        bodyFallback: 'Default {name}',
        firstName: 'Ada',
    });
    assert.strictEqual(msg.title, 'Sunday prayer');
    assert.strictEqual(msg.body, 'Body for Ada');
    assert.strictEqual(nc.renderText({
        template: '', fallback: 'Default {name}.', firstName: 'Ada',
    }), 'Default Ada.');
});

test('a link is substituted and never invented', () => {
    assert.strictEqual(nc.renderText({
        template: 'Open {link}', fallback: '', firstName: 'Ada',
        link: 'https://example.test/a/abc',
    }), 'Open https://example.test/a/abc');
    assert.strictEqual(nc.renderText({
        template: 'Open {link} please', fallback: '', firstName: 'Ada',
    }), 'Open  please');
});

test('the lock-screen title limit is short enough to show an editor', () => {
    assert.ok(nc.PUSH_TITLE_LIMIT > 0);
    assert.ok(nc.PUSH_TITLE_LIMIT <= 50);
});

// ── Send window ────────────────────────────────────────────────────────────
// 8am inclusive, 8pm exclusive, church-local hour handed in by the caller.

test('8am is inside the send window and 8pm is not', () => {
    assert.strictEqual(nc.isInsideSendWindow(8), true);
    assert.strictEqual(nc.isInsideSendWindow(19), true);
    assert.strictEqual(nc.isInsideSendWindow(7), false);
    assert.strictEqual(nc.isInsideSendWindow(20), false);
    assert.strictEqual(nc.isInsideSendWindow(0), false);
});

test('church-local parts at the window edges', () => {
    // 2026-01-15 14:00 UTC is 08:00 in America/Chicago (CST).
    const open = nc.churchDateParts(new Date('2026-01-15T14:00:00Z'));
    assert.deepStrictEqual(open, {date: '2026-01-15', hour: 8});
    // 2026-01-15 02:00 UTC is 20:00 the previous evening.
    const close = nc.churchDateParts(new Date('2026-01-15T02:00:00Z'));
    assert.deepStrictEqual(close, {date: '2026-01-14', hour: 20});
});

test('a manual send is the caller bypassing the window, not a second clock', () => {
    assert.strictEqual(nc.shouldSendNow({
        localHour: 6, manual: false,
    }), false);
    assert.strictEqual(nc.shouldSendNow({
        localHour: 6, manual: true,
    }), true);
    assert.strictEqual(nc.shouldSendNow({
        localHour: 10, manual: false,
    }), true);
});
