/**
 * The four things the Push notifications tab asks the server for, and the two
 * things it asks the server to do (MS-682).
 *
 * The module takes every dependency, so this whole file runs with no
 * Firestore, no provider and no clock. What is being defended:
 *
 *   - the test push can only ever reach the person who pressed it;
 *   - a whole Device token never comes back;
 *   - a filtered page still terminates on a long log.
 */
const {test} = require('node:test');
const assert = require('node:assert/strict');

const na = require('../functions/notification-admin.js');
const core = require('../functions/shared/notification-admin-core.js');
const nc = require('../functions/notification-core.js');

const NOW = new Date('2026-09-25T19:14:00Z');
const DAY = 24 * 60 * 60 * 1000;

function daysAgo(days) {
    return new Date(NOW.getTime() - days * DAY);
}

function row(fields) {
    const at = fields.createdAt || NOW;
    return Object.assign({
        id: 'row-' + Math.random().toString(36).slice(2, 8),
        channel: 'push',
        purpose: 'prayer_request',
        wording: 'initial',
        accepted: true,
        direction: 'outbound',
    }, fields, {
        createdAt: at,
        cursor: {
            seconds: Math.floor(at.getTime() / 1000),
            nanoseconds: (at.getTime() % 1000) * 1e6,
        },
    });
}

function harness(overrides) {
    const calls = {push: [], deleted: [], logs: [], pages: [], owners: []};
    const deps = Object.assign({
        now: () => NOW,
        readLogSince: async () => [],
        readLogPage: async () => [],
        namesFor: async () => ({}),
        listTokens: async () => [],
        countDevices: async () => ({people: 0, devices: 0, stale: 0, failing: 0, byPlatform: {}}),
        loadOwners: async (uids) => {
            calls.owners.push(uids);
            return uids.map((uid) => ({uid, personId: 'person-' + uid, name: 'Person ' + uid}));
        },
        ownerOf: async (uid) => ({uid, personId: 'person-' + uid, name: 'Person ' + uid}),
        tokensFor: async () => [],
        getToken: async () => null,
        deleteToken: async (uid, id) => {
            calls.deleted.push({uid, id});
        },
        sendPush: async (message) => {
            calls.push.push(message);
            return {accepted: true};
        },
        writeLog: async (entry) => {
            calls.logs.push(entry);
        },
    }, overrides || {});
    return {deps, calls};
}

/* ── overview ──────────────────────────────────────────────────────────── */

test('the overview hands over the send path\u2019s own constants', async () => {
    const {deps} = harness({
        readLogSince: async () => [
            row({createdAt: daysAgo(1)}),
            row({createdAt: daysAgo(2), channel: 'text', accepted: false}),
            row({createdAt: daysAgo(20), channel: 'none', accepted: false, unreachable: true}),
        ],
        countDevices: async () => ({people: 3, devices: 4, stale: 1, failing: 0, byPlatform: {ios: 3, android: 1}}),
    });

    const view = await na.overview(deps);

    assert.equal(view.constants.openHour, nc.WINDOW_OPEN_HOUR);
    assert.equal(view.constants.closeHour, nc.WINDOW_CLOSE_HOUR);
    assert.equal(view.constants.timezone, nc.CHURCH_TIMEZONE);
    assert.deepEqual(view.constants.deadCodes, Array.from(nc.DEAD_TOKEN_CODES).sort());
    assert.equal(view.flow.window.openHour, nc.WINDOW_OPEN_HOUR);
    assert.equal(view.staleAfterDays, core.TOKEN_STALE_DAYS);
    assert.equal(view.devices.devices, 4);

    assert.equal(view.recent.week.total, 2);
    assert.equal(view.recent.week.push, 1);
    assert.equal(view.recent.week.text, 1);
    assert.equal(view.recent.week.problems, 1);
    assert.equal(view.recent.month.total, 3);
    assert.equal(view.recent.month.problems, 2);
});

test('every registry row comes back with a window in words and its counts', async () => {
    const {deps} = harness({
        readLogSince: async () => [row({createdAt: daysAgo(1)})],
    });
    const view = await na.overview(deps);
    assert.equal(view.types.length, core.NOTIFICATION_TYPES.length);
    view.types.forEach((type) => {
        assert.ok(type.windowLabel, type.id + ' has no window in words');
        assert.ok(type.stats, type.id + ' has no counts');
    });
    const ask = view.types.find((type) => type.id === 'prayer_ask_initial');
    assert.equal(ask.stats.sent7, 1);
    assert.match(ask.windowLabel, /8am–8pm America\/Chicago/);
});

test('a purpose the registry has never heard of is reported, not swallowed', async () => {
    const {deps} = harness({
        readLogSince: async () => [row({purpose: 'brand_new_sender', wording: null})],
    });
    const view = await na.overview(deps);
    assert.deepEqual(view.unmatched, [{purpose: 'brand_new_sender', count: 1}]);
});

/* ── the log ───────────────────────────────────────────────────────────── */

function pagedReader(rows) {
    const reads = [];
    return {
        reads,
        read: async ({limit, before}) => {
            reads.push({limit, before});
            let start = 0;
            if (before) {
                const at = before.seconds * 1000 + before.nanoseconds / 1e6;
                start = rows.findIndex((r) => r.createdAt.getTime() < at);
                if (start === -1) start = rows.length;
            }
            return rows.slice(start, start + limit);
        },
    };
}

test('a page comes back full, newest first, with a cursor for the next one', async () => {
    const rows = [];
    for (let i = 0; i < 60; i += 1) rows.push(row({createdAt: new Date(NOW.getTime() - i * 60000)}));
    const reader = pagedReader(rows);
    const {deps} = harness({
        readLogPage: reader.read,
        namesFor: async (ids) => {
            const out = {};
            ids.forEach((id) => {
                out[id] = 'Named ' + id;
            });
            return out;
        },
    });

    const first = await na.history(deps, {limit: 25});
    assert.equal(first.rows.length, 25);
    assert.equal(first.filtered, false);
    assert.ok(first.nextCursor, 'there are more rows and no cursor came back');
    assert.equal(first.timezone, nc.CHURCH_TIMEZONE);

    const second = await na.history(deps, {limit: 25, cursor: first.nextCursor});
    assert.equal(second.rows.length, 25);
    const firstIds = new Set(first.rows.map((r) => r.id));
    second.rows.forEach((r) => assert.ok(!firstIds.has(r.id), 'a row was served twice'));

    const third = await na.history(deps, {limit: 25, cursor: second.nextCursor});
    assert.equal(third.rows.length, 10);
    assert.equal(third.nextCursor, null, 'the end of the log still offers more');
});

test('a filter narrows the page without losing the rows behind it', async () => {
    const rows = [];
    for (let i = 0; i < 40; i += 1) {
        rows.push(row({
            createdAt: new Date(NOW.getTime() - i * 60000),
            channel: i % 4 === 0 ? 'text' : 'push',
            accepted: i % 10 !== 0,
        }));
    }
    const reader = pagedReader(rows);
    const {deps} = harness({readLogPage: reader.read});

    const texts = await na.history(deps, {limit: 50, channel: 'text'});
    assert.equal(texts.rows.length, 10);
    assert.equal(texts.filtered, true);
    texts.rows.forEach((r) => assert.equal(r.channel, 'text'));

    const problems = await na.history(deps, {limit: 50, status: 'problem'});
    assert.equal(problems.rows.length, 4);
    problems.rows.forEach((r) => assert.equal(r.problem, true));
});

test('a filter that matches almost nothing gives up rather than reading the church', async () => {
    const rows = [];
    for (let i = 0; i < 5000; i += 1) {
        rows.push(row({createdAt: new Date(NOW.getTime() - i * 60000), channel: 'push'}));
    }
    const reader = pagedReader(rows);
    const {deps} = harness({readLogPage: reader.read});

    const page = await na.history(deps, {limit: 25, channel: 'text'});
    assert.equal(page.rows.length, 0);
    assert.ok(page.scanned <= na.SCAN_BUDGET,
        'the scan budget did not hold: ' + page.scanned);
    assert.ok(page.nextCursor, 'giving up must still offer a way onwards');
});

test('an absurd page size is clamped, and a junk cursor starts at the top', async () => {
    const rows = [];
    for (let i = 0; i < 300; i += 1) rows.push(row({createdAt: new Date(NOW.getTime() - i * 60000)}));
    const reader = pagedReader(rows);
    const {deps} = harness({readLogPage: reader.read});

    const huge = await na.history(deps, {limit: 99999});
    assert.equal(huge.rows.length, na.MAX_PAGE);

    const junk = await na.history(deps, {limit: 5, cursor: 'not-a-cursor'});
    assert.equal(junk.rows[0].id, rows[0].id);
});

test('names are fetched once, for the rows that survived the filter', async () => {
    const rows = [
        row({personId: 'p1'}), row({personId: 'p1'}), row({personId: 'p2'}),
    ].map((r, i) => Object.assign(r, {createdAt: new Date(NOW.getTime() - i * 60000)}));
    rows.forEach((r) => {
        r.cursor = {seconds: Math.floor(r.createdAt.getTime() / 1000), nanoseconds: 0};
    });
    const asked = [];
    const reader = pagedReader(rows);
    const {deps} = harness({
        readLogPage: reader.read,
        namesFor: async (ids) => {
            asked.push(ids.slice());
            return {p1: 'Jane Doe', p2: 'Sam Reed'};
        },
    });

    const page = await na.history(deps, {limit: 10});
    assert.deepEqual(asked, [['p1', 'p2']]);
    assert.equal(page.rows[0].personName, 'Jane Doe');
    assert.equal(page.rows[2].personName, 'Sam Reed');
});

/* ── devices ───────────────────────────────────────────────────────────── */

const TOKEN_A = 'fMEp9xQ1TzS:APA91bHq0Kd7yvnRlZaaa111';
const TOKEN_B = 'cQr2mNb8LpX:APA91bHq0Kd7yvnRlZbbb222';

test('devices come back grouped by person, masked, and newest device first', async () => {
    const {deps} = harness({
        listTokens: async () => [
            {uid: 'u1', id: 'd1', token: TOKEN_A, platform: 'ios', updatedAt: daysAgo(40)},
            {uid: 'u1', id: 'd2', token: TOKEN_B, platform: 'android', updatedAt: daysAgo(1)},
            {uid: 'u2', id: 'd3', token: TOKEN_A, platform: 'web', updatedAt: daysAgo(90)},
        ],
        loadOwners: async (uids) => uids.map((uid) => ({
            uid,
            personId: uid === 'u1' ? 'p1' : 'p2',
            name: uid === 'u1' ? 'Zoe Adams' : 'Alan Boyd',
        })),
    });

    const view = await na.devices(deps);

    assert.equal(view.people.length, 2);
    assert.equal(view.people[0].name, 'Alan Boyd', 'people are not in name order');
    const zoe = view.people.find((person) => person.uid === 'u1');
    assert.equal(zoe.devices.length, 2);
    assert.equal(zoe.devices[0].id, 'd2', 'the most recently seen device is not first');
    assert.equal(zoe.devices[0].masked, '…bbb222');
    assert.equal(zoe.devices[1].state, 'aging');
    assert.equal(view.people.find((p) => p.uid === 'u2').devices[0].stale, true);

    assert.equal(view.summary.devices, 3);
    assert.equal(view.summary.stale, 1);
    assert.deepEqual(view.summary.byPlatform, {ios: 1, android: 1, web: 1});

    const wire = JSON.stringify(view);
    assert.ok(!wire.includes(TOKEN_A) && !wire.includes(TOKEN_B),
        'a whole Device token came back from notificationDevices');
    assert.ok(!wire.includes('APA91'), 'the provider prefix came back');
});

test('an account with no linked Person sorts after everybody who has one', async () => {
    const {deps} = harness({
        listTokens: async () => [
            {uid: 'u-kiosk', id: 'd1', token: TOKEN_A, updatedAt: daysAgo(1)},
            {uid: 'u-zoe', id: 'd2', token: TOKEN_B, updatedAt: daysAgo(1)},
        ],
        loadOwners: async (uids) => uids.map((uid) => (uid === 'u-kiosk' ?
            {uid, personId: null, name: '', email: 'foyer@example.org'} :
            {uid, personId: 'p-zoe', name: 'Zoe Adams', email: 'zoe@example.org'})),
    });
    const view = await na.devices(deps);
    assert.deepEqual(view.people.map((person) => person.uid), ['u-zoe', 'u-kiosk']);
});

test('a token with no uid or no token string is not a device', async () => {
    const {deps} = harness({
        listTokens: async () => [
            {uid: '', id: 'd1', token: TOKEN_A},
            {uid: 'u1', id: 'd2', token: ''},
            {uid: 'u1', id: 'd3', token: TOKEN_A, updatedAt: daysAgo(1)},
        ],
    });
    const view = await na.devices(deps);
    assert.equal(view.summary.devices, 1);
    assert.equal(view.people.length, 1);
});

test('failing is read off the log, never stamped on the token', async () => {
    const {deps} = harness({
        listTokens: async () => [
            {uid: 'u1', id: 'd1', token: TOKEN_A, platform: 'ios', updatedAt: daysAgo(1)},
            {uid: 'u2', id: 'd2', token: TOKEN_B, platform: 'ios', updatedAt: daysAgo(1)},
        ],
        loadOwners: async (uids) => uids.map((uid) => ({
            uid, personId: uid === 'u1' ? 'p1' : 'p2', name: uid,
        })),
        readLogSince: async () => [
            row({personId: 'p1', channel: 'push', accepted: false, createdAt: daysAgo(1)}),
            row({personId: 'p1', channel: 'push', accepted: true, createdAt: daysAgo(5)}),
            row({personId: 'p2', channel: 'push', accepted: true, createdAt: daysAgo(2)}),
            row({personId: 'p2', channel: 'text', accepted: false, createdAt: daysAgo(1)}),
        ],
    });

    const view = await na.devices(deps);
    const one = view.people.find((person) => person.uid === 'u1');
    const two = view.people.find((person) => person.uid === 'u2');
    assert.equal(one.failing, true, 'the latest push to u1 was refused and it does not show');
    assert.equal(one.lastPushAccepted, false);
    assert.equal(two.failing, false, 'a failed TEXT is not a failing device');
    assert.equal(view.summary.failing, 1);
});

/* ── revoke ────────────────────────────────────────────────────────────── */

test('revoking names the device, and says what it took away', async () => {
    const {deps, calls} = harness({
        getToken: async (uid, id) => (uid === 'u1' && id === 'd1' ?
            {id: 'd1', token: TOKEN_A} : null),
    });
    const result = await na.revokeToken(deps, {uid: 'u1', tokenId: 'd1'});
    assert.deepEqual(calls.deleted, [{uid: 'u1', id: 'd1'}]);
    assert.equal(result.revoked, true);
    assert.equal(result.masked, '…aaa111');
    assert.ok(!JSON.stringify(result).includes(TOKEN_A));
});

test('revoking nothing, or something already gone, refuses rather than pretends', async () => {
    const {deps, calls} = harness();
    await assert.rejects(() => na.revokeToken(deps, {}),
        (err) => err.code === 'invalid-argument');
    await assert.rejects(() => na.revokeToken(deps, {uid: 'u1'}),
        (err) => err.code === 'invalid-argument');
    await assert.rejects(() => na.revokeToken(deps, {uid: 'u1', tokenId: 'gone'}),
        (err) => err.code === 'not-found');
    assert.equal(calls.deleted.length, 0);
});

/* ── the self-test push ────────────────────────────────────────────────── */

test('the test push reads the caller\u2019s uid and ignores everything else on the payload', async () => {
    const asked = [];
    const {deps, calls} = harness({
        tokensFor: async (uid) => {
            asked.push(uid);
            return uid === 'me' ? [{id: 'd1', token: TOKEN_A}] : [{id: 'x', token: TOKEN_B}];
        },
    });

    const result = await na.testPushToSelf(deps, {
        callerUid: 'me',
        // Everything below is what a hostile browser would send. None of it
        // may be honoured.
        uid: 'somebody-else',
        personId: 'p9',
        tokenId: 'their-device',
        token: TOKEN_B,
        to: '+15555550123',
        title: 'Urgent from the elders',
        body: 'Please read this',
    });

    assert.deepEqual(asked, ['me'], 'the test push read a uid the browser named');
    assert.equal(calls.push.length, 1);
    assert.equal(calls.push[0].token, TOKEN_A);
    assert.equal(calls.push[0].title, na.TEST_PUSH_TITLE);
    assert.equal(calls.push[0].body, na.TEST_PUSH_BODY);
    assert.ok(!calls.push[0].title.includes('Urgent'),
        'the browser chose the wording of a push');
    assert.equal(result.accepted, 1);
    assert.equal(result.attempted, 1);
});

test('the test push writes one log row, under its own purpose', async () => {
    const {deps, calls} = harness({
        tokensFor: async () => [{id: 'd1', token: TOKEN_A}, {id: 'd2', token: TOKEN_B}],
        ownerOf: async () => ({uid: 'me', personId: 'p-me', name: 'Jonathan'}),
    });

    await na.testPushToSelf(deps, {callerUid: 'me'});

    assert.equal(calls.logs.length, 1, 'one send, one row');
    const entry = calls.logs[0];
    assert.equal(entry.purpose, core.TEST_PUSH_PURPOSE);
    assert.equal(entry.purpose, 'admin_test_push');
    assert.equal(entry.channel, 'push');
    assert.equal(entry.accepted, true);
    assert.equal(entry.personId, 'p-me');
    assert.equal(entry.devices, 2);
    assert.ok(!JSON.stringify(entry).includes(TOKEN_A), 'the log row carries a token');
});

test('a dead token is deleted by the test push, the same way a real send deletes one', async () => {
    const {deps, calls} = harness({
        tokensFor: async () => [{id: 'dead', token: TOKEN_A}, {id: 'live', token: TOKEN_B}],
        sendPush: async ({token}) => {
            calls.push.push({token});
            if (token === TOKEN_A) {
                return {accepted: false, error: {code: 'messaging/registration-token-not-registered'}};
            }
            return {accepted: true};
        },
    });

    const result = await na.testPushToSelf(deps, {callerUid: 'me'});
    assert.deepEqual(calls.deleted, [{uid: 'me', id: 'dead'}]);
    assert.deepEqual(result.removed, ['…aaa111']);
    assert.equal(result.accepted, 1);
    assert.equal(result.retryable, 0);
});

test('a provider wobble leaves the token alone and is still logged', async () => {
    const {deps, calls} = harness({
        tokensFor: async () => [{id: 'd1', token: TOKEN_A}],
        sendPush: async () => ({accepted: false, error: {code: 'messaging/server-unavailable'}}),
    });

    const result = await na.testPushToSelf(deps, {callerUid: 'me'});
    assert.equal(calls.deleted.length, 0, 'a retryable failure deleted a token');
    assert.equal(result.retryable, 1);
    assert.equal(result.accepted, 0);
    assert.equal(calls.logs[0].accepted, false);
});

test('an admin with no device of their own is told so, and nothing is sent', async () => {
    const {deps, calls} = harness({tokensFor: async () => []});
    await assert.rejects(
        () => na.testPushToSelf(deps, {callerUid: 'me'}),
        (err) => err.code === 'failed-precondition' && /device/i.test(err.message));
    assert.equal(calls.push.length, 0);
    assert.equal(calls.logs.length, 0);
});

test('an unsigned-in caller cannot test-push at all', async () => {
    const {deps} = harness();
    await assert.rejects(() => na.testPushToSelf(deps, {}),
        (err) => err.code === 'unauthenticated');
    await assert.rejects(() => na.testPushToSelf(deps, {callerUid: '   '}),
        (err) => err.code === 'unauthenticated');
});
