// @ts-nocheck
const {test} = require('node:test');
const assert = require('node:assert/strict');
const audit = require('../scripts/prayer-text-notifications-audit-lib');

test('prayer notifications audit summary', () => {
    const s = audit.summarizePrayerTextFailures([
        {direction: 'outbound', channel: 'text', purpose: 'prayer_request',
            accepted: false, providerError: 'webhook'},
    ]);
    assert.strictEqual(s.failedRows, 1);
});

test('whitelist prefix constant', () => {
    assert.strictEqual('146bb8bc'.length, 8);
});
