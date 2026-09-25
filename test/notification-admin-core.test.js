const {test} = require('node:test');
const assert = require('node:assert');

const nac = require('../public/notification-admin-core.js');
const nc = require('../functions/notification-core.js');

test('maskPushToken never returns the full token', () => {
    const full = 'a'.repeat(140);
    const masked = nac.maskPushToken(full);
    assert.notStrictEqual(masked, full);
    assert.ok(masked.endsWith(full.slice(-6)));
    assert.match(masked, /^…/);
});

test('isStaleToken respects the day threshold', () => {
    const now = Date.UTC(2026, 8, 25, 12, 0, 0);
    const fresh = now - 10 * 24 * 60 * 60 * 1000;
    const old = now - 90 * 24 * 60 * 60 * 1000;
    assert.strictEqual(nac.isStaleToken(fresh, now, 60), false);
    assert.strictEqual(nac.isStaleToken(old, now, 60), true);
    assert.strictEqual(nac.isStaleToken(null, now, 60), true);
});

test('buildSendFlow matches notification-core window constants', () => {
    const flow = nac.buildSendFlow(nc);
    const windowStep = flow.find((s) => s.id === 'window');
    assert.ok(windowStep);
    assert.match(windowStep.detail, new RegExp(nc.WINDOW_OPEN_HOUR + ''));
    assert.match(windowStep.detail, new RegExp(nc.WINDOW_CLOSE_HOUR + ''));
    assert.match(windowStep.detail, new RegExp(nc.CHURCH_TIMEZONE));
});

test('aggregatePurposeStats counts last 30 days and last sent', () => {
    const now = Date.UTC(2026, 8, 25, 12, 0, 0);
    const rows = [
        {purpose: 'test', createdAt: now - 5 * 86400000},
        {purpose: 'test', createdAt: now - 40 * 86400000},
        {purpose: 'prayer_request', createdAt: now - 1 * 86400000},
    ];
    const stats = nac.aggregatePurposeStats(rows, now);
    assert.strictEqual(stats.test.count30d, 1);
    assert.strictEqual(stats.test.lastSentMs, now - 5 * 86400000);
    assert.strictEqual(stats.prayer_request.count30d, 1);
});

test('isFailedNotification marks unreachable and rejected rows', () => {
    assert.strictEqual(nac.isFailedNotification({accepted: true}), false);
    assert.strictEqual(nac.isFailedNotification({accepted: false}), true);
    assert.strictEqual(nac.isFailedNotification({unreachable: true}), true);
    assert.strictEqual(nac.isFailedNotification({channel: 'none'}), true);
});
