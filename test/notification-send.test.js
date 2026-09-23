const {test} = require('node:test');
const assert = require('node:assert');

const {tellPerson} = require('../functions/notification-send.js');

// Faked providers. No network. The church-local hour of this instant is 10,
// inside the window: 2026-06-15 15:00 UTC is 10:00 in America/Chicago (CDT).
const INSIDE = new Date('2026-06-15T15:00:00Z');
// 2026-01-15 12:00 UTC is 06:00 CST, outside the window.
const OUTSIDE = new Date('2026-01-15T12:00:00Z');

const templates = {
    text: {
        initial: 'Hi {name}. {link}',
        reminder: 'Again {name}.',
    },
    textFallback: {initial: 'Default {name}.', reminder: 'Default again {name}.'},
    push: {
        initial: {title: 'Hello {name}', body: 'Body {name}'},
        reminder: {title: 'Reminder', body: 'Still {name}'},
    },
    pushFallback: {
        initial: {title: 'Fallback', body: 'Fallback {name}'},
        reminder: {title: 'Fallback', body: 'Fallback {name}'},
    },
};

function harness(overrides) {
    const calls = {push: [], text: [], deleted: [], logs: []};
    const deps = Object.assign({
        now: () => INSIDE,
        loadPerson: async () => ({
            uid: 'user-1', phone: '+15551212', firstName: 'Jane',
        }),
        loadTokens: async () => [{id: 'dev-1', token: 'tok-1'}],
        loadTemplates: async () => templates,
        sendPush: async (msg) => {
            calls.push.push(msg);
            return {accepted: true, id: 'push-1'};
        },
        sendText: async (msg) => {
            calls.text.push(msg);
            return {accepted: true, textId: 'tb-1', quotaRemaining: 9};
        },
        deleteToken: async (uid, id) => {
            calls.deleted.push({uid, id});
        },
        writeLog: async (row) => {
            calls.logs.push(row);
        },
    }, overrides || {});
    return {deps, calls};
}

const base = {
    personId: 'person-1',
    purpose: 'prayer_request',
    wording: 'initial',
    values: {name: 'Jane'},
    url: 'https://example.test/a/soon',
};

test('a live token is a push carrying the URL, and no text follows', async () => {
    const {deps, calls} = harness();
    const result = await tellPerson(deps, base);
    assert.strictEqual(result.channel, 'push');
    assert.strictEqual(result.accepted, true);
    assert.strictEqual(calls.text.length, 0);
    assert.strictEqual(calls.push.length, 1);
    assert.strictEqual(calls.push[0].url, base.url);
    assert.strictEqual(calls.push[0].title, 'Hello Jane');
    assert.strictEqual(calls.logs.length, 1);
    assert.strictEqual(calls.logs[0].channel, 'push');
    assert.strictEqual(calls.logs[0].accepted, true);
    assert.strictEqual(calls.logs[0].purpose, 'prayer_request');
    assert.strictEqual(calls.logs[0].personId, 'person-1');
});

test('no linked user is a text', async () => {
    const {deps, calls} = harness({
        loadPerson: async () => ({uid: null, phone: '+15551212', firstName: 'Jane'}),
    });
    const result = await tellPerson(deps, base);
    assert.strictEqual(result.channel, 'text');
    assert.strictEqual(calls.push.length, 0);
    assert.strictEqual(calls.text[0].body, 'Hi Jane. https://example.test/a/soon');
    assert.strictEqual(calls.logs.length, 1);
    assert.strictEqual(calls.logs[0].channel, 'text');
    assert.strictEqual(calls.logs[0].textId, 'tb-1');
    assert.strictEqual(calls.logs[0].accepted, true);
});

test('a linked user with no token is a text', async () => {
    const {deps, calls} = harness({loadTokens: async () => []});
    const result = await tellPerson(deps, base);
    assert.strictEqual(result.channel, 'text');
    assert.strictEqual(calls.push.length, 0);
    assert.strictEqual(calls.logs.length, 1);
});

test('a rejected token is deleted and the text goes out in the same run', async () => {
    const {deps, calls} = harness({
        sendPush: async (msg) => {
            calls.push.push(msg);
            return {accepted: false, error: 'UNREGISTERED'};
        },
    });
    const result = await tellPerson(deps, base);
    assert.strictEqual(result.channel, 'text');
    assert.strictEqual(result.accepted, true);
    assert.deepStrictEqual(calls.deleted, [{uid: 'user-1', id: 'dev-1'}]);
    assert.strictEqual(calls.text.length, 1);
    assert.strictEqual(calls.logs.length, 1);
    assert.strictEqual(calls.logs[0].channel, 'text');
});

test('an accepted token produces no text and no retry', async () => {
    const {deps, calls} = harness({
        loadTokens: async () => [
            {id: 'a', token: 'tok-a'},
            {id: 'b', token: 'tok-b'},
        ],
        sendPush: async (msg) => {
            calls.push.push(msg);
            if (msg.token === 'tok-a') {
                return {accepted: false, error: 'messaging/registration-token-not-registered'};
            }
            return {accepted: true};
        },
    });
    const result = await tellPerson(deps, base);
    assert.strictEqual(result.channel, 'push');
    assert.strictEqual(calls.text.length, 0);
    assert.deepStrictEqual(calls.deleted, [{uid: 'user-1', id: 'a'}]);
    assert.strictEqual(calls.logs.length, 1);
    assert.strictEqual(calls.logs[0].accepted, true);
});

test('escalate uses the other route, and falls back when that route is missing', async () => {
    const withPhone = harness();
    const escalated = await tellPerson(withPhone.deps, Object.assign({}, base, {
        escalate: true, wording: 'reminder',
    }));
    assert.strictEqual(escalated.channel, 'text');
    assert.strictEqual(withPhone.calls.push.length, 0);

    const noPhone = harness({
        loadPerson: async () => ({uid: 'user-1', phone: '', firstName: 'Jane'}),
    });
    const fellBack = await tellPerson(noPhone.deps, Object.assign({}, base, {escalate: true}));
    assert.strictEqual(fellBack.channel, 'push');
    assert.strictEqual(noPhone.calls.text.length, 0);
});

test('nobody reachable writes one row and sends nothing', async () => {
    const {deps, calls} = harness({
        loadPerson: async () => ({uid: null, phone: '', firstName: 'Jane'}),
    });
    const result = await tellPerson(deps, base);
    assert.strictEqual(result.sent, false);
    assert.strictEqual(result.unreachable, true);
    assert.strictEqual(calls.push.length, 0);
    assert.strictEqual(calls.text.length, 0);
    assert.strictEqual(calls.logs.length, 1);
    assert.strictEqual(calls.logs[0].channel, 'none');
    assert.strictEqual(calls.logs[0].accepted, false);
    assert.strictEqual(calls.logs[0].personId, 'person-1');
    assert.strictEqual(calls.logs[0].purpose, 'prayer_request');
});

test('the scheduler respects the window and a manual send does not', async () => {
    const quiet = harness({now: () => OUTSIDE});
    const skipped = await tellPerson(quiet.deps, base);
    assert.strictEqual(skipped.skipped, 'window');
    assert.strictEqual(quiet.calls.logs.length, 0);
    assert.strictEqual(quiet.calls.push.length, 0);

    const manual = harness({now: () => OUTSIDE});
    const sent = await tellPerson(manual.deps, Object.assign({}, base, {manual: true}));
    assert.strictEqual(sent.channel, 'push');
    assert.strictEqual(manual.calls.logs.length, 1);
});

test('a retryable push error does not delete the token or send a text', async () => {
    const {deps, calls} = harness({
        sendPush: async () => ({accepted: false, error: 'UNAVAILABLE'}),
    });
    const result = await tellPerson(deps, base);
    assert.strictEqual(result.channel, 'push');
    assert.strictEqual(result.accepted, false);
    assert.strictEqual(calls.deleted.length, 0);
    assert.strictEqual(calls.text.length, 0);
    assert.strictEqual(calls.logs.length, 1);
    assert.strictEqual(calls.logs[0].accepted, false);
});

test('a text with no link does not invent one', async () => {
    const {deps, calls} = harness({
        loadPerson: async () => ({uid: null, phone: '+15551212', firstName: 'Jane'}),
    });
    await tellPerson(deps, Object.assign({}, base, {url: null}));
    assert.strictEqual(calls.text[0].body, 'Hi Jane. ');
});
