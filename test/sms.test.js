const { test } = require('node:test');
const assert = require('node:assert');

const crypto = require('crypto');
const {
    toE164US,
    isAdminRole,
    interpretQuota,
    interpretSend,
    parseInboundReply,
    verifyTextbeltSignature,
} = require('../functions/sms.js');

// Helper mirroring how Textbelt signs: HMAC-SHA256(timestamp + rawBody) keyed by
// the API key, hex-encoded.
function sign(apiKey, timestamp, rawBody) {
    return crypto.createHmac('sha256', apiKey)
        .update(timestamp + rawBody).digest('hex');
}

// The SMS module is the pure shaping layer between the Admin Dashboard and
// Textbelt: it normalizes phone numbers, gates by role, and turns Textbelt's
// raw JSON into the {configured, quotaRemaining, error} / send-result shapes the
// dashboard renders. These pin those contracts so the callables stay thin.

test('toE164US normalizes 10- and 11-digit US numbers', () => {
    assert.strictEqual(toE164US('(580) 504-3816'), '+15805043816');
    assert.strictEqual(toE164US('580-504-3816'), '+15805043816');
    assert.strictEqual(toE164US('15805043816'), '+15805043816');
    assert.strictEqual(toE164US('+1 580 504 3816'), '+15805043816');
});

test('toE164US returns "" for empty/unparseable input', () => {
    assert.strictEqual(toE164US(''), '');
    assert.strictEqual(toE164US(null), '');
    assert.strictEqual(toE164US(undefined), '');
    assert.strictEqual(toE164US('abc'), '');
});

test('isAdminRole admits only admin and super_admin', () => {
    for (const r of ['admin', 'super_admin']) {
        assert.strictEqual(isAdminRole(r), true, r);
    }
    for (const r of ['elder', 'editor', 'member', 'viewer', undefined, null, '']) {
        assert.strictEqual(isAdminRole(r), false, String(r));
    }
});

test('interpretQuota: no key → not configured, no error (prompts setup)', () => {
    assert.deepStrictEqual(
        interpretQuota(null, false),
        { configured: false, quotaRemaining: null, error: null });
});

test('interpretQuota: success → configured with numeric remaining', () => {
    assert.deepStrictEqual(
        interpretQuota({ success: true, quotaRemaining: 42 }, true),
        { configured: true, quotaRemaining: 42, error: null });
});

test('interpretQuota: configured but Textbelt rejects → surfaces error', () => {
    const r = interpretQuota({ success: false, error: 'Invalid key' }, true);
    assert.strictEqual(r.configured, true);
    assert.strictEqual(r.quotaRemaining, null);
    assert.strictEqual(r.error, 'Invalid key');
});

test('interpretSend: success → textId + remaining, no error', () => {
    assert.deepStrictEqual(
        interpretSend({ success: true, textId: 'abc123', quotaRemaining: 9 }),
        { success: true, textId: 'abc123', quotaRemaining: 9, error: null });
});

test('interpretSend: failure → error message, no textId', () => {
    const r = interpretSend({ success: false, error: 'Out of quota' });
    assert.strictEqual(r.success, false);
    assert.strictEqual(r.textId, null);
    assert.strictEqual(r.error, 'Out of quota');
});

test('interpretSend: missing error string falls back to a default', () => {
    assert.strictEqual(interpretSend({ success: false }).error,
        'Textbelt did not accept the message.');
});

test('parseInboundReply: well-formed reply → trimmed record', () => {
    assert.deepStrictEqual(
        parseInboundReply({ textId: 't1', fromNumber: '+15805043816', text: '  yes  ' }),
        { textId: 't1', fromNumber: '+15805043816', text: 'yes' });
});

test('parseInboundReply: empty/whitespace text → null (ignored)', () => {
    assert.strictEqual(parseInboundReply({ text: '   ' }), null);
    assert.strictEqual(parseInboundReply({}), null);
    assert.strictEqual(parseInboundReply(null), null);
});

test('parseInboundReply: missing ids default to empty strings', () => {
    assert.deepStrictEqual(
        parseInboundReply({ text: 'hi' }),
        { textId: '', fromNumber: '', text: 'hi' });
});

test('verifyTextbeltSignature: valid signature within window → true', () => {
    const key = 'secret-key';
    const nowMs = 1_700_000_000_000;
    const ts = String(Math.floor(nowMs / 1000));
    const body = '{"textId":"t1","fromNumber":"+15551234567","text":"yes"}';
    assert.strictEqual(verifyTextbeltSignature({
        apiKey: key, timestamp: ts, signature: sign(key, ts, body),
        rawBody: body, nowMs,
    }), true);
});

test('verifyTextbeltSignature: tampered body → false', () => {
    const key = 'secret-key';
    const nowMs = 1_700_000_000_000;
    const ts = String(Math.floor(nowMs / 1000));
    const body = '{"text":"yes"}';
    const sig = sign(key, ts, body);
    assert.strictEqual(verifyTextbeltSignature({
        apiKey: key, timestamp: ts, signature: sig,
        rawBody: '{"text":"NO — forged"}', nowMs,
    }), false);
});

test('verifyTextbeltSignature: wrong key → false', () => {
    const nowMs = 1_700_000_000_000;
    const ts = String(Math.floor(nowMs / 1000));
    const body = '{"text":"yes"}';
    assert.strictEqual(verifyTextbeltSignature({
        apiKey: 'real-key', timestamp: ts, signature: sign('attacker-key', ts, body),
        rawBody: body, nowMs,
    }), false);
});

test('verifyTextbeltSignature: stale timestamp (>15 min) → false', () => {
    const key = 'secret-key';
    const nowMs = 1_700_000_000_000;
    const staleTs = String(Math.floor(nowMs / 1000) - 16 * 60);
    const body = '{"text":"yes"}';
    assert.strictEqual(verifyTextbeltSignature({
        apiKey: key, timestamp: staleTs, signature: sign(key, staleTs, body),
        rawBody: body, nowMs,
    }), false);
});

test('verifyTextbeltSignature: missing headers/key → false (no throw)', () => {
    const nowMs = 1_700_000_000_000;
    assert.strictEqual(verifyTextbeltSignature({
        apiKey: '', timestamp: '', signature: '', rawBody: '', nowMs,
    }), false);
    assert.strictEqual(verifyTextbeltSignature({
        apiKey: 'k', timestamp: String(Math.floor(nowMs / 1000)),
        signature: 'short', rawBody: '{}', nowMs,
    }), false);
});
