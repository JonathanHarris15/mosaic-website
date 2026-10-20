/**
 * Regression: pastoral-prayer SMS must not contain https when
 * includeAnswerLinkInSms is off (Textbelt URL whitelist stopgap).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const pr = require('../functions/prayer-request.js');
const { tellPerson } = require('../functions/notification-send.js');

const INSIDE = new Date('2026-06-15T15:00:00Z');
const ANSWER_URL = 'https://mosaic-hymn-database.web.app/a/tok';

function prayerTextBody(includeLinkInSms) {
    const templates = {
        text: pr.preparePrayerSmsTextTemplates(pr.DEFAULT_PRAYER_MESSAGES, includeLinkInSms),
        textFallback: pr.preparePrayerSmsTextTemplates(pr.DEFAULT_PRAYER_MESSAGES, includeLinkInSms),
        push: pr.DEFAULT_PUSH_WORDING,
        pushFallback: pr.DEFAULT_PUSH_WORDING,
    };
    const calls = { text: [], logs: [] };
    const deps = {
        now: () => INSIDE,
        loadPerson: async () => ({ uid: null, phone: '+15551212', firstName: 'Jane' }),
        loadTokens: async () => [],
        loadTemplates: async () => templates,
        sendText: async (msg) => {
            calls.text.push(msg);
            return { accepted: true, textId: 'tb-1' };
        },
        sendPush: async () => ({ accepted: false }),
        deleteToken: async () => {},
        writeLog: async (row) => { calls.logs.push(row); },
    };
    return tellPerson(deps, {
        personId: 'person-1',
        purpose: 'prayer_request',
        wording: 'initial',
        values: { name: 'Jane' },
        url: includeLinkInSms ? ANSWER_URL : null,
        expectReply: true,
        message: pr.messageWithLink(
            'Hi {name}, custom prose or answer here: {link}',
            includeLinkInSms,
        ),
    }).then(() => calls.text[0].body);
}

test('scheduler/send path: default switch yields no http in SMS body', async () => {
    const body = await prayerTextBody(false);
    assert.ok(body);
    assert.ok(!body.includes('http'));
    assert.ok(!body.includes('{link}'));
    assert.ok(!/answer here/i.test(body));
});

test('scheduler/send path: links on when church setting is true', async () => {
    const body = await prayerTextBody(true);
    assert.ok(body.includes(ANSWER_URL));
});

test('default prayer config does not ask Textbelt for a reply webhook', async () => {
    const pr = require('../functions/prayer-request.js');
    assert.strictEqual(pr.prayerSmsIncludeReplyWebhook({}), false);
    const calls = [];
    const deps = {
        now: () => INSIDE,
        loadPerson: async () => ({ uid: null, phone: '+15551212', firstName: 'Jane' }),
        loadTokens: async () => [],
        loadTemplates: async () => ({
            text: pr.DEFAULT_PRAYER_MESSAGES,
            textFallback: pr.DEFAULT_PRAYER_MESSAGES,
            push: pr.DEFAULT_PUSH_WORDING,
            pushFallback: pr.DEFAULT_PUSH_WORDING,
        }),
        sendText: async (msg) => {
            calls.push(msg);
            return { accepted: true, textId: 'tb-1' };
        },
        sendPush: async () => ({ accepted: false }),
        deleteToken: async () => {},
        writeLog: async () => {},
    };
    await tellPerson(deps, {
        personId: 'person-1',
        purpose: 'prayer_request',
        wording: 'initial',
        values: { name: 'Jane' },
        url: null,
        expectReply: pr.prayerSmsIncludeReplyWebhook({}),
        message: pr.messageWithLink(pr.DEFAULT_PRAYER_MESSAGES.initial, false),
    });
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].expectReply, false);
});
