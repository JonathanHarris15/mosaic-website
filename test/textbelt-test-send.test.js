const {test} = require('node:test');
const assert = require('node:assert/strict');
const {
    phoneFromPerson,
    isJonathanHarris,
    textbeltPayload,
    prayerUrlSmokeMessage,
    DEFAULT_URL_SMOKE_LINK,
    JONATHAN_HARRIS_NAME,
} = require('../scripts/textbelt-test-send-lib');

test('isJonathanHarris is an exact full-name match', () => {
    assert.strictEqual(isJonathanHarris(JONATHAN_HARRIS_NAME), true);
    assert.strictEqual(isJonathanHarris('Jonathan Harris Jr.'), false);
    assert.strictEqual(isJonathanHarris(''), false);
});

test('phoneFromPerson normalizes contact.phone', () => {
    assert.strictEqual(
        phoneFromPerson({contact: {phone: '5551234567'}}),
        '+15551234567');
    assert.throws(() => phoneFromPerson({contact: {}}), /no usable US phone/);
});

test('textbeltPayload omits replyWebhookUrl', () => {
    const payload = textbeltPayload('+15551234567', 'hi', 'key-1');
    assert.deepStrictEqual(payload, {
        phone: '+15551234567',
        message: 'hi',
        key: 'key-1',
    });
    assert.ok(!('replyWebhookUrl' in payload));
});

test('prayerUrlSmokeMessage includes the Answer URL and no webhook fields', () => {
    const body = prayerUrlSmokeMessage();
    assert.ok(body.includes(DEFAULT_URL_SMOKE_LINK));
    assert.ok(body.includes('Jonathan'));
    assert.ok(!body.includes('replyWebhookUrl'));
});
