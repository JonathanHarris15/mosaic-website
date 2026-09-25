const {test} = require('node:test');
const assert = require('node:assert');

const nc = require('../functions/notification-core.js');
const adminN = require('../functions/notification-admin.js');

// MS-682 — admin view of Notifications. Pure helpers and callable handlers
// take injected deps so this file never loads firebase-functions.

function refuseCode(fn) {
    return fn().then(
        () => {
            throw new Error('expected refusal');
        },
        (err) => err,
    );
}

test('the admin module loads under plain Node', () => {
    assert.strictEqual(typeof adminN.maskToken, 'function');
    assert.strictEqual(typeof adminN.isTokenStale, 'function');
    assert.strictEqual(typeof adminN.sendFlow, 'function');
    assert.strictEqual(typeof adminN.NOTIFICATION_TYPES.length, 'number');
    assert.ok(adminN.NOTIFICATION_TYPES.length >= 7);
});

// ── Masking ────────────────────────────────────────────────────────────────

test('maskToken keeps only the last six characters', () => {
    assert.strictEqual(adminN.maskToken('ABCDEFGHIJKLMNOP'), '…KLMNOP');
    assert.strictEqual(adminN.maskToken('short1'), '••••••');
});

test('maskToken never returns the full token once it is long enough to hide', () => {
    const raw = 'fcm-registration-token-abcdefghijklmnopqrstuvwxyz';
    const masked = adminN.maskToken(raw);
    assert.ok(!masked.includes(raw));
    assert.ok(!masked.startsWith('fcm-registration'));
    assert.ok(masked.endsWith('uvwxyz'));
});

test('maskToken treats blank and short values as fully hidden', () => {
    assert.strictEqual(adminN.maskToken(''), '');
    assert.strictEqual(adminN.maskToken(null), '');
    assert.strictEqual(adminN.maskToken('abc'), '•••');
    assert.strictEqual(adminN.maskToken('12345'), '•••••');
});

// ── Stale / failed ─────────────────────────────────────────────────────────

test('a token updated today is not stale', () => {
    const now = new Date('2026-09-25T17:00:00Z');
    assert.strictEqual(adminN.isTokenStale(now, now), false);
    assert.strictEqual(adminN.isTokenStale({toMillis: () => now.getTime()}, now), false);
});

test('a token not updated in 30 days is stale', () => {
    const now = new Date('2026-09-25T17:00:00Z');
    const old = new Date('2026-08-20T17:00:00Z');
    assert.strictEqual(adminN.isTokenStale(old, now), true);
    assert.strictEqual(adminN.isTokenStale(null, now), true);
});

test('decorateDevice flags stale and recent push failure', () => {
    const now = new Date('2026-09-25T17:00:00Z');
    const live = adminN.decorateDevice({
        id: 'dev-1',
        token: 'ABCDEFGHIJKLMNOP',
        platform: 'ios',
        updatedAt: now,
    }, {now, recentPushFailed: false});
    assert.strictEqual(live.stale, false);
    assert.strictEqual(live.failed, false);
    assert.strictEqual(live.maskedToken, '…KLMNOP');
    assert.ok(!Object.prototype.hasOwnProperty.call(live, 'token'));

    const deadish = adminN.decorateDevice({
        id: 'dev-2',
        token: 'ZZZZZZZZZZZZZZZZ',
        platform: 'android',
        updatedAt: new Date('2026-07-01T00:00:00Z'),
    }, {now, recentPushFailed: true});
    assert.strictEqual(deadish.stale, true);
    assert.strictEqual(deadish.failed, true);
    assert.strictEqual(deadish.platform, 'android');
});

// ── Status + paging ────────────────────────────────────────────────────────

test('classifyStatus names accepted, failed, and unreachable', () => {
    assert.strictEqual(adminN.classifyStatus({accepted: true}), 'accepted');
    assert.strictEqual(adminN.classifyStatus({accepted: false, unreachable: true}),
        'unreachable');
    assert.strictEqual(adminN.classifyStatus({accepted: false}), 'failed');
});

test('pageNotifications filters, sorts newest first, and cursors', () => {
    const rows = [
        {id: 'a', channel: 'push', purpose: 'prayer_request', accepted: true,
            createdAt: new Date('2026-09-24T15:00:00Z')},
        {id: 'b', channel: 'text', purpose: 'test', accepted: true,
            createdAt: new Date('2026-09-25T15:00:00Z')},
        {id: 'c', channel: 'none', purpose: 'prayer_request', accepted: false,
            unreachable: true, createdAt: new Date('2026-09-23T15:00:00Z')},
        {id: 'd', channel: 'push', purpose: 'prayer_request', accepted: false,
            createdAt: new Date('2026-09-22T15:00:00Z')},
    ];
    const first = adminN.pageNotifications(rows, {pageSize: 2});
    assert.deepStrictEqual(first.rows.map((r) => r.id), ['b', 'a']);
    assert.ok(first.nextCursor);

    const second = adminN.pageNotifications(rows, {
        pageSize: 2, cursor: first.nextCursor,
    });
    assert.deepStrictEqual(second.rows.map((r) => r.id), ['c', 'd']);
    assert.strictEqual(second.nextCursor, null);

    const failed = adminN.pageNotifications(rows, {status: 'failed', pageSize: 10});
    assert.deepStrictEqual(failed.rows.map((r) => r.id), ['d']);

    const push = adminN.pageNotifications(rows, {channel: 'push', pageSize: 10});
    assert.deepStrictEqual(push.rows.map((r) => r.id), ['a', 'd']);
});

test('decorateLogRow uses church-local time and never invents a full token', () => {
    const row = adminN.decorateLogRow({
        id: 'n1',
        personId: 'p1',
        channel: 'push',
        purpose: 'prayer_request',
        wording: 'initial',
        accepted: true,
        title: 'Sunday\'s prayer',
        body: 'Jane, you\'re in this Sunday\'s pastoral prayer.',
        createdAt: new Date('2026-06-15T15:00:00Z'),
        token: 'SHOULD-NOT-LEAK',
    }, 'Jane Doe');
    assert.strictEqual(row.personName, 'Jane Doe');
    assert.strictEqual(row.status, 'accepted');
    assert.match(row.churchLocalTime, /2026/);
    assert.ok(!Object.prototype.hasOwnProperty.call(row, 'token'));
    assert.ok(!JSON.stringify(row).includes('SHOULD-NOT-LEAK'));
});

// ── Flow derived from notification-core ────────────────────────────────────

test('sendFlow window and dead-token codes come from notification-core', () => {
    const flow = adminN.sendFlow();
    assert.strictEqual(flow.windowOpenHour, nc.WINDOW_OPEN_HOUR);
    assert.strictEqual(flow.windowCloseHour, nc.WINDOW_CLOSE_HOUR);
    assert.strictEqual(flow.timezone, nc.CHURCH_TIMEZONE);
    assert.ok(flow.deadTokenCodes.includes('UNREGISTERED'));
    assert.ok(flow.deadTokenCodes.includes('INVALID_ARGUMENT'));
    assert.ok(nc.isDeadToken('UNREGISTERED'));
    for (const code of flow.deadTokenCodes) {
        assert.ok(nc.isDeadToken(code), code + ' drifted off isDeadToken');
    }
    assert.strictEqual(flow.afterPush.accepted, 'done');
    assert.strictEqual(flow.afterPush.retryable, 'stop');
    assert.strictEqual(flow.afterPush.allDeadHasPhone, 'text');
    assert.strictEqual(flow.afterPush.allDeadNoPhone, 'unreachable');
    assert.deepStrictEqual(flow.afterPush.accepted,
        nc.afterPushAttempt({anyAccepted: true, anyRetryable: false, hasPhone: true}));
    assert.deepStrictEqual(flow.afterPush.allDeadHasPhone,
        nc.afterPushAttempt({anyAccepted: false, anyRetryable: false, hasPhone: true}));
    const ids = flow.steps.map((s) => s.id);
    for (const need of ['trigger', 'window', 'token', 'push', 'accepted',
        'dead', 'fallback', 'log']) {
        assert.ok(ids.includes(need), 'flow is missing ' + need);
    }
});

// ── Registry ───────────────────────────────────────────────────────────────

test('the registry names every trigger on main', () => {
    const ids = adminN.NOTIFICATION_TYPES.map((t) => t.id);
    for (const need of [
        'prayer_request_initial',
        'prayer_request_reminder',
        'prayer_request_thankyou',
        'elder_digest',
        'event_announcement',
        'sms_test',
        'admin_test_push',
    ]) {
        assert.ok(ids.includes(need), 'registry is missing ' + need);
    }
    const event = adminN.NOTIFICATION_TYPES.find((t) => t.id === 'event_announcement');
    assert.strictEqual(event.wiredToNotifier, false);
    const thankyou = adminN.NOTIFICATION_TYPES.find((t) => t.id === 'prayer_request_thankyou');
    assert.deepStrictEqual(thankyou.channels, ['text']);
    const initial = adminN.NOTIFICATION_TYPES.find((t) => t.id === 'prayer_request_initial');
    assert.ok(initial.triggers.some((t) => t.kind === 'schedule'));
    assert.ok(initial.triggers.some((t) => t.kind === 'manual'));
    assert.ok(initial.channels.includes('push'));
    assert.ok(initial.channels.includes('text'));
});

test('summarizeTypes counts recent rows and last-sent per type', () => {
    const now = new Date('2026-09-25T18:00:00Z');
    const rows = [
        {purpose: 'prayer_request', wording: 'initial', accepted: true,
            createdAt: new Date('2026-09-20T15:00:00Z')},
        {purpose: 'prayer_request', wording: 'reminder', accepted: true,
            createdAt: new Date('2026-09-24T15:00:00Z')},
        {purpose: 'test', accepted: true,
            createdAt: new Date('2026-09-01T15:00:00Z')},
        {purpose: 'elder_digest', accepted: true,
            createdAt: new Date('2026-08-01T15:00:00Z')},
    ];
    const summary = adminN.summarizeTypes(rows, now);
    const initial = summary.find((t) => t.id === 'prayer_request_initial');
    assert.strictEqual(initial.counts.d7, 1);
    assert.strictEqual(initial.counts.d30, 1);
    assert.ok(initial.lastSentMs > 0);
    const digest = summary.find((t) => t.id === 'elder_digest');
    assert.strictEqual(digest.counts.d30, 0);
    assert.ok(digest.lastSentMs > 0);
    const event = summary.find((t) => t.id === 'event_announcement');
    assert.strictEqual(event.counts.d30, 0);
    assert.strictEqual(event.lastSentMs, null);
});

// ── Admin guard ────────────────────────────────────────────────────────────

test('assertAdminCaller refuses a missing auth and a non-admin', async () => {
    const missing = await refuseCode(() => adminN.assertAdminCaller(null, async () => 'admin'));
    assert.strictEqual(missing.code, 'unauthenticated');

    const viewer = await refuseCode(() => adminN.assertAdminCaller(
        {uid: 'u1'}, async () => 'viewer'));
    assert.strictEqual(viewer.code, 'permission-denied');

    const editor = await refuseCode(() => adminN.assertAdminCaller(
        {uid: 'u1'}, async () => 'editor'));
    assert.strictEqual(editor.code, 'permission-denied');

    await adminN.assertAdminCaller({uid: 'u1'}, async () => 'admin');
    await adminN.assertAdminCaller({uid: 'u1'}, async () => 'super_admin');
});

// ── Revoke ─────────────────────────────────────────────────────────────────

test('revoke requires admin, confirmation, and deletes only that token', async () => {
    const calls = {deleted: []};
    const deps = {
        loadPermission: async () => 'admin',
        deleteToken: async (uid, tokenId) => {
            calls.deleted.push({uid, tokenId});
        },
        tokenExists: async () => true,
    };

    const noConfirm = await refuseCode(() => adminN.handleRevokeToken(deps, {
        auth: {uid: 'admin-1'},
        data: {uid: 'other', tokenId: 'dev-1'},
    }));
    assert.strictEqual(noConfirm.code, 'failed-precondition');

    const viewer = await refuseCode(() => adminN.handleRevokeToken({
        ...deps, loadPermission: async () => 'viewer',
    }, {
        auth: {uid: 'v1'},
        data: {uid: 'other', tokenId: 'dev-1', confirm: true},
    }));
    assert.strictEqual(viewer.code, 'permission-denied');

    const result = await adminN.handleRevokeToken(deps, {
        auth: {uid: 'admin-1'},
        data: {uid: 'other', tokenId: 'dev-1', confirm: true},
    });
    assert.strictEqual(result.revoked, true);
    assert.deepStrictEqual(calls.deleted, [{uid: 'other', tokenId: 'dev-1'}]);
});

test('revoke of a missing token is not-found and deletes nothing', async () => {
    const calls = {deleted: []};
    const err = await refuseCode(() => adminN.handleRevokeToken({
        loadPermission: async () => 'admin',
        tokenExists: async () => false,
        deleteToken: async (uid, tokenId) => calls.deleted.push({uid, tokenId}),
    }, {
        auth: {uid: 'admin-1'},
        data: {uid: 'other', tokenId: 'gone', confirm: true},
    }));
    assert.strictEqual(err.code, 'not-found');
    assert.deepStrictEqual(calls.deleted, []);
});

// ── Own-devices-only test send ─────────────────────────────────────────────

test('test push ignores a client uid/token and only loads the signed-in admin', async () => {
    const calls = {loaded: [], pushed: [], deleted: [], logs: []};
    const deps = {
        loadPermission: async () => 'admin',
        loadTokens: async (uid) => {
            calls.loaded.push(uid);
            return [{id: 'mine', token: 'tok-admin'}];
        },
        sendPush: async (msg) => {
            calls.pushed.push(msg);
            return {accepted: true};
        },
        deleteToken: async (uid, id) => calls.deleted.push({uid, id}),
        writeLog: async (row) => calls.logs.push(row),
        loadPersonIdForUid: async () => 'person-admin',
        now: () => new Date('2026-09-25T17:00:00Z'),
    };

    const result = await adminN.handleSendTestPush(deps, {
        auth: {uid: 'admin-uid'},
        data: {
            confirm: true,
            uid: 'victim-uid',
            token: 'stolen-token',
            personId: 'victim-person',
        },
    });
    assert.strictEqual(result.sent, true);
    assert.deepStrictEqual(calls.loaded, ['admin-uid']);
    assert.strictEqual(calls.pushed.length, 1);
    assert.strictEqual(calls.pushed[0].token, 'tok-admin');
    assert.ok(!calls.pushed.some((m) => m.token === 'stolen-token'));
    assert.strictEqual(calls.logs.length, 1);
    assert.strictEqual(calls.logs[0].purpose, adminN.TEST_PUSH_PURPOSE);
    assert.strictEqual(calls.logs[0].personId, 'person-admin');
    assert.strictEqual(calls.logs[0].channel, 'push');
    assert.strictEqual(calls.logs[0].accepted, true);
    assert.deepStrictEqual(calls.deleted, []);
});

test('test push refuses a missing confirmation and a non-admin', async () => {
    const deps = {
        loadPermission: async () => 'admin',
        loadTokens: async () => [{id: 'd', token: 't'}],
        sendPush: async () => ({accepted: true}),
        deleteToken: async () => {},
        writeLog: async () => {},
        loadPersonIdForUid: async () => null,
        now: () => new Date(),
    };
    const noConfirm = await refuseCode(() => adminN.handleSendTestPush(deps, {
        auth: {uid: 'admin-uid'}, data: {},
    }));
    assert.strictEqual(noConfirm.code, 'failed-precondition');

    const viewer = await refuseCode(() => adminN.handleSendTestPush({
        ...deps, loadPermission: async () => 'viewer',
    }, {
        auth: {uid: 'v1'}, data: {confirm: true},
    }));
    assert.strictEqual(viewer.code, 'permission-denied');
});

test('test push does not fall back to a text when tokens fail', async () => {
    const calls = {text: [], logs: [], deleted: []};
    const result = await adminN.handleSendTestPush({
        loadPermission: async () => 'admin',
        loadTokens: async () => [{id: 'dead', token: 'tok-dead'}],
        sendPush: async () => ({accepted: false, error: 'UNREGISTERED'}),
        sendText: async (msg) => {
            calls.text.push(msg);
            return {accepted: true};
        },
        deleteToken: async (uid, id) => calls.deleted.push({uid, id}),
        writeLog: async (row) => calls.logs.push(row),
        loadPersonIdForUid: async () => 'p-admin',
        now: () => new Date(),
    }, {
        auth: {uid: 'admin-uid'},
        data: {confirm: true},
    });
    assert.strictEqual(result.sent, false);
    assert.deepStrictEqual(calls.text, []);
    assert.deepStrictEqual(calls.deleted, [{uid: 'admin-uid', id: 'dead'}]);
    assert.strictEqual(calls.logs[0].purpose, adminN.TEST_PUSH_PURPOSE);
    assert.strictEqual(calls.logs[0].channel, 'none');
    assert.strictEqual(calls.logs[0].unreachable, true);
});

test('test push with no tokens logs unreachable and sends nothing', async () => {
    const calls = {pushed: [], logs: []};
    const result = await adminN.handleSendTestPush({
        loadPermission: async () => 'admin',
        loadTokens: async () => [],
        sendPush: async (msg) => {
            calls.pushed.push(msg);
            return {accepted: true};
        },
        deleteToken: async () => {},
        writeLog: async (row) => calls.logs.push(row),
        loadPersonIdForUid: async () => null,
        now: () => new Date(),
    }, {
        auth: {uid: 'admin-uid'},
        data: {confirm: true},
    });
    assert.strictEqual(result.sent, false);
    assert.strictEqual(result.reason, 'no_tokens');
    assert.deepStrictEqual(calls.pushed, []);
    assert.strictEqual(calls.logs[0].unreachable, true);
    assert.strictEqual(calls.logs[0].purpose, adminN.TEST_PUSH_PURPOSE);
});

test('list handlers refuse non-admins before they load anything', async () => {
    let loaded = false;
    const err = await refuseCode(() => adminN.handleListNotifications({
        loadPermission: async () => 'editor',
        loadNotificationRows: async () => {
            loaded = true;
            return [];
        },
        loadPeopleNames: async () => ({}),
    }, {auth: {uid: 'e1'}, data: {}}));
    assert.strictEqual(err.code, 'permission-denied');
    assert.strictEqual(loaded, false);

    const devices = await refuseCode(() => adminN.handleListDevices({
        loadPermission: async () => 'viewer',
        loadAllTokens: async () => {
            loaded = true;
            return [];
        },
        loadRecentPushFailures: async () => new Set(),
        now: () => new Date(),
    }, {auth: {uid: 'v1'}, data: {}}));
    assert.strictEqual(devices.code, 'permission-denied');
});

test('handleListNotifications shapes rows and keeps the sms_messages note', async () => {
    const result = await adminN.handleListNotifications({
        loadPermission: async () => 'admin',
        loadNotificationRows: async () => [{
            id: 'n1',
            personId: 'p1',
            channel: 'push',
            purpose: 'prayer_request',
            accepted: true,
            createdAt: new Date('2026-06-15T15:00:00Z'),
            token: 'LEAK',
        }],
        loadPeopleNames: async () => ({p1: 'Jane Doe'}),
    }, {auth: {uid: 'a1'}, data: {pageSize: 25}});
    assert.strictEqual(result.rows[0].personName, 'Jane Doe');
    assert.ok(result.olderHistoryNote);
    assert.ok(!JSON.stringify(result).includes('LEAK'));
});

test('TEST_PUSH_PURPOSE is distinct from the SMS test purpose', () => {
    assert.strictEqual(adminN.TEST_PUSH_PURPOSE, 'admin_test_push');
    assert.notStrictEqual(adminN.TEST_PUSH_PURPOSE, 'test');
});
