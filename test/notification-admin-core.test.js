/**
 * The Admin Dashboard's Push notifications tab, at the level a browser and a
 * callable both read it from (MS-682).
 *
 * Two things matter more than the rest here and are tested first:
 *
 *   1. A whole Device token must never come out of this module. It is the
 *      handle for messaging somebody's phone, and the rules deliberately
 *      keep it from every client including an admin (ADR-0036).
 *   2. The picture of the send path must be the send path. It is drawn from
 *      notification-core.js's own constants, and these tests fail if the
 *      diagram grows a number of its own.
 */
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const core = require('../public/notification-admin-core.js');
const nc = require('../functions/notification-core.js');

const ROOT = path.join(__dirname, '..');
// 2026-09-25 19:14 UTC is 2:14pm in America/Chicago (CDT).
const NOW = new Date('2026-09-25T19:14:00Z');
const FULL_TOKEN = 'fMEp9xQ1TzS:APA91bHq0Kd7yvnRlZcabc123';

function daysAgo(days) {
    return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);
}

/* ── the token never leaves whole ──────────────────────────────────────── */

test('a masked token shows its last six characters and nothing else', () => {
    const masked = core.maskToken(FULL_TOKEN);
    assert.equal(masked, '…abc123');
    assert.equal(masked.length, 7);
    assert.ok(!FULL_TOKEN.includes(masked), 'the mask is not a substring join');
    assert.ok(!masked.includes('APA91'), 'the provider prefix leaked');
});

test('a short token is never more than half revealed, and junk masks to nothing', () => {
    assert.equal(core.maskToken('abcdefgh'), '…efgh');
    assert.equal(core.maskToken('ab'), '…b');
    assert.equal(core.maskToken('a'), '…');
    assert.equal(core.maskToken(''), '');
    assert.equal(core.maskToken(null), '');
    assert.equal(core.maskToken(undefined), '');
    assert.equal(core.maskToken({token: 'x'}), '');
});

test('a described device carries the mask and not the token', () => {
    const described = core.describeDevice({
        id: 'device-1',
        platform: 'ios',
        token: FULL_TOKEN,
        updatedAt: daysAgo(2),
    }, NOW);
    assert.equal(described.masked, '…abc123');
    assert.equal(described.platformLabel, 'iPhone / iPad');
    assert.equal(described.state, 'fresh');
    assert.equal(described.stale, false);
    assert.ok(!('token' in described), 'the whole token came back');
    assert.ok(!JSON.stringify(described).includes('APA91'),
        'the whole token is reachable somewhere on the row');
});

/* ── staleness ─────────────────────────────────────────────────────────── */

test('a device goes fresh, aging, then stale on its own last-seen', () => {
    const state = (days) => core.tokenState({updatedAt: daysAgo(days), now: NOW});
    assert.equal(state(0), 'fresh');
    assert.equal(state(core.TOKEN_AGING_DAYS - 0.1), 'fresh');
    assert.equal(state(core.TOKEN_AGING_DAYS), 'aging');
    assert.equal(state(core.TOKEN_STALE_DAYS - 0.1), 'aging');
    assert.equal(state(core.TOKEN_STALE_DAYS), 'stale');
    assert.equal(state(365), 'stale');
});

test('a device with no last-seen is unknown, not fresh and not stale', () => {
    assert.equal(core.tokenState({updatedAt: null, now: NOW}), 'unknown');
    assert.equal(core.describeDevice({token: 'x'}, NOW).stale, false);
    assert.equal(core.describeDevice({token: 'x'}, NOW).lastSeenAgo, 'never');
});

test('a Firestore Timestamp, an ISO string and epoch millis all read the same', () => {
    const when = daysAgo(3);
    const asStamp = {
        seconds: Math.floor(when.getTime() / 1000),
        nanoseconds: 0,
        toDate: () => when,
    };
    assert.equal(core.tokenState({updatedAt: asStamp, now: NOW}), 'fresh');
    assert.equal(core.tokenState({updatedAt: when.toISOString(), now: NOW}), 'fresh');
    assert.equal(core.tokenState({updatedAt: when.getTime(), now: NOW}), 'fresh');
});

test('the device summary counts people, devices, platforms and trouble', () => {
    const summary = core.summariseDevices([
        {
            failing: false,
            devices: [
                core.describeDevice({platform: 'ios', token: FULL_TOKEN, updatedAt: daysAgo(1)}, NOW),
                core.describeDevice({platform: 'android', token: FULL_TOKEN, updatedAt: daysAgo(90)}, NOW),
            ],
        },
        {
            failing: true,
            devices: [
                core.describeDevice({platform: 'ios', token: FULL_TOKEN, updatedAt: daysAgo(100)}, NOW),
            ],
        },
    ]);
    assert.equal(summary.people, 2);
    assert.equal(summary.devices, 3);
    assert.equal(summary.stale, 2);
    assert.equal(summary.failing, 1);
    assert.deepEqual(summary.byPlatform, {ios: 2, android: 1});
});

/* ── the log ───────────────────────────────────────────────────────────── */

test('a row reads as accepted, not accepted, unreachable, or merely recorded', () => {
    assert.equal(core.rowStatus({accepted: true}), 'delivered');
    assert.equal(core.rowStatus({accepted: false}), 'failed');
    assert.equal(core.rowStatus({accepted: false, unreachable: true}), 'unreachable');
    assert.equal(core.rowStatus({channel: 'text', purpose: 'elder_digest'}), 'recorded');
    assert.equal(core.isProblem({accepted: true}), false);
    assert.equal(core.isProblem({accepted: false}), true);
    assert.equal(core.isProblem({unreachable: true}), true);
});

test('a row is stamped in the church\u2019s clock, not the reader\u2019s', () => {
    const described = core.describeLogRow({
        id: 'row-1',
        personId: 'person-1',
        channel: 'push',
        purpose: 'prayer_request',
        wording: 'initial',
        accepted: true,
        title: 'Sunday\u2019s prayer',
        body: 'Jane, you\u2019re in this Sunday\u2019s pastoral prayer.',
        createdAt: NOW,
    }, {now: NOW, timezone: nc.CHURCH_TIMEZONE, names: {'person-1': 'Jane Doe'}});

    assert.equal(described.status, 'delivered');
    assert.equal(described.statusLabel, 'Accepted');
    assert.equal(described.channelLabel, 'Push');
    assert.equal(described.personName, 'Jane Doe');
    assert.equal(described.typeId, 'prayer_ask_initial');
    assert.equal(described.typeName, 'Pastoral prayer ask');
    assert.match(described.when, /2:14\u202fPM|2:14 PM/,
        'the stamp is not in America/Chicago: ' + described.when);
    assert.match(described.when, /Sep 25/);
});

test('the filter bar answers channel, type, trouble and free text', () => {
    const rows = [
        core.describeLogRow({personId: 'a', channel: 'push', purpose: 'prayer_request', wording: 'initial', accepted: true, createdAt: NOW}, {now: NOW, names: {a: 'Jane Doe'}}),
        core.describeLogRow({personId: 'b', channel: 'text', purpose: 'prayer_request', wording: 'reminder', accepted: false, createdAt: NOW}, {now: NOW, names: {b: 'Sam Reed'}}),
        core.describeLogRow({personId: 'c', channel: 'none', purpose: 'prayer_request', wording: 'initial', accepted: false, unreachable: true, createdAt: NOW}, {now: NOW, names: {c: 'Pat Vane'}}),
    ];
    const keep = (filters) => rows.filter((row) => core.matchesFilter(row, filters)).length;

    assert.equal(keep({}), 3);
    assert.equal(keep({channel: 'push'}), 1);
    assert.equal(keep({status: 'problem'}), 2);
    assert.equal(keep({status: 'unreachable'}), 1);
    assert.equal(keep({status: 'delivered'}), 1);
    assert.equal(keep({typeId: 'prayer_ask_reminder'}), 1);
    assert.equal(keep({search: 'sam'}), 1);
    assert.equal(keep({search: 'nobody at all'}), 0);
    assert.equal(keep({channel: 'push', status: 'problem'}), 0);
});

test('a page cursor survives the round trip, and junk reads as no cursor', () => {
    const cursor = core.formatCursor({seconds: 1790000000, nanoseconds: 123456000});
    assert.equal(cursor, '1790000000.123456000');
    assert.deepEqual(core.parseCursor(cursor),
        {seconds: 1790000000, nanoseconds: 123456000});
    assert.equal(core.parseCursor(''), null);
    assert.equal(core.parseCursor('nonsense'), null);
    assert.equal(core.parseCursor(null), null);
    assert.equal(core.parseCursor('1790000000'), null);
    assert.equal(core.formatCursor(null), '');
    assert.equal(core.formatCursor({}), '');
});

/* ── what Mosaic sends ─────────────────────────────────────────────────── */

test('every purpose the functions write has a row in the registry', () => {
    const written = new Set();
    fs.readdirSync(path.join(ROOT, 'functions'))
        .filter((name) => name.endsWith('.js'))
        .forEach((name) => {
            const src = fs.readFileSync(path.join(ROOT, 'functions', name), 'utf8');
            const re = /purpose:\s*["'`]([a-z_]+)["'`]/g;
            let match;
            while ((match = re.exec(src)) !== null) written.add(match[1]);
        });
    // event-tell-core.js names its purpose through a constant, so the scan
    // above cannot see it. Ask the module.
    written.add(require('../public/event-tell-core.js').PURPOSE);

    const known = new Set(core.NOTIFICATION_TYPES.map((type) => type.purpose));
    for (const purpose of written) {
        assert.ok(known.has(purpose),
            `functions/ writes purpose "${purpose}" and the Push notifications ` +
            'tab has never heard of it — add it to NOTIFICATION_TYPES');
    }
});

test('every trigger the registry names is a function that exists', () => {
    const index = fs.readFileSync(path.join(ROOT, 'functions/index.js'), 'utf8');
    core.NOTIFICATION_TYPES.forEach((type) => {
        assert.ok(type.firedBy.length, type.id + ' says nothing fires it');
        type.firedBy.forEach((trigger) => {
            assert.match(index, new RegExp('exports\\.' + trigger.name + '\\s*='),
                `${type.id} says ${trigger.name} fires it, and nothing exports that`);
            assert.ok(trigger.how, trigger.name + ' does not say how it fires');
            assert.ok(['schedule', 'trigger', 'manual', 'webhook'].includes(trigger.kind),
                trigger.name + ' has an unknown trigger kind: ' + trigger.kind);
        });
    });
});

test('every registry row says who it reaches, on what channel, under what switch', () => {
    const ids = new Set();
    core.NOTIFICATION_TYPES.forEach((type) => {
        assert.ok(!ids.has(type.id), 'duplicate registry id ' + type.id);
        ids.add(type.id);
        assert.ok(type.name, type.id + ' has no name');
        assert.ok(type.audience, type.id + ' does not say who receives it');
        assert.ok(type.killSwitch, type.id + ' does not say what stops it');
        assert.ok(type.wordingSource, type.id + ' does not say where its words come from');
        assert.ok(type.channels.length, type.id + ' names no channel');
        type.channels.forEach((channel) => {
            assert.ok(['push', 'text'].includes(channel),
                type.id + ' claims channel ' + channel);
        });
        assert.ok(['church', 'church-unless-manual', 'bypassed', 'none'].includes(type.window),
            type.id + ' has an unknown window: ' + type.window);
    });
});

test('the ask and the re-ask share a purpose and are told apart by wording', () => {
    assert.equal(core.typeIdFor({purpose: 'prayer_request', wording: 'initial'}),
        'prayer_ask_initial');
    assert.equal(core.typeIdFor({purpose: 'prayer_request', wording: 'reminder'}),
        'prayer_ask_reminder');
    assert.equal(core.typeIdFor({purpose: 'elder_digest'}), 'elder_digest');
    assert.equal(core.typeIdFor({purpose: 'elder_digest', wording: 'anything'}),
        'elder_digest');
    assert.equal(core.typeIdFor({purpose: 'not_a_purpose'}), null);
});

test('last-sent and recent counts come out per type, and strangers are reported', () => {
    const rows = [
        {purpose: 'prayer_request', wording: 'initial', accepted: true, createdAt: daysAgo(1)},
        {purpose: 'prayer_request', wording: 'initial', accepted: false, createdAt: daysAgo(3)},
        {purpose: 'prayer_request', wording: 'initial', accepted: true, createdAt: daysAgo(20)},
        {purpose: 'prayer_request', wording: 'initial', accepted: true, createdAt: daysAgo(400)},
        {purpose: 'something_new', accepted: true, createdAt: daysAgo(1)},
    ];
    const summary = core.summariseTypes(rows, NOW);
    const initial = summary.byType.prayer_ask_initial;
    assert.equal(initial.sent7, 2);
    assert.equal(initial.sent30, 3);
    assert.equal(initial.problems30, 1);
    assert.equal(initial.lastSentAt, daysAgo(1).toISOString());
    assert.equal(initial.lastStatus, 'delivered');
    assert.equal(summary.byType.elder_digest.sent30, 0);
    assert.equal(summary.byType.elder_digest.lastSentAt, null);
    assert.deepEqual(summary.unmatched, [{purpose: 'something_new', count: 1}]);
});

/* ── the picture is the send path ──────────────────────────────────────── */

test('the flow diagram is drawn from notification-core, not from a second copy', () => {
    const flow = core.buildPushFlow({
        openHour: nc.WINDOW_OPEN_HOUR,
        closeHour: nc.WINDOW_CLOSE_HOUR,
        timezone: nc.CHURCH_TIMEZONE,
        deadCodes: Array.from(nc.DEAD_TOKEN_CODES).sort(),
    });

    assert.equal(flow.window.openHour, nc.WINDOW_OPEN_HOUR);
    assert.equal(flow.window.closeHour, nc.WINDOW_CLOSE_HOUR);
    assert.equal(flow.window.label, '8am–8pm America/Chicago');
    assert.deepEqual(flow.deadCodes.slice().sort(),
        Array.from(nc.DEAD_TOKEN_CODES).sort());

    const ids = flow.steps.map((step) => step.id);
    assert.deepEqual(ids, ['trigger', 'window', 'route', 'provider', 'log']);

    const source = fs.readFileSync(path.join(ROOT, 'public/notification-admin-core.js'), 'utf8');
    assert.ok(!/America\/Chicago/.test(source),
        'the diagram hard-codes the church timezone instead of being handed it');
    assert.ok(!/\b8am\b|\b8pm\b/.test(source),
        'the diagram hard-codes the send window instead of being handed it');
    assert.ok(!/UNREGISTERED/.test(source),
        'the diagram hard-codes a dead-token code instead of being handed it');
});

test('every branch the diagram draws is a branch the send path takes', () => {
    const flow = core.buildPushFlow({
        openHour: nc.WINDOW_OPEN_HOUR,
        closeHour: nc.WINDOW_CLOSE_HOUR,
        timezone: nc.CHURCH_TIMEZONE,
        deadCodes: Array.from(nc.DEAD_TOKEN_CODES),
    });
    const branches = (id) => flow.steps.find((step) => step.id === id).branches;

    // Outside the window nothing goes; a manual send goes regardless.
    assert.equal(nc.shouldSendNow({localHour: 6}), false);
    assert.equal(nc.shouldSendNow({localHour: 6, manual: true}), true);
    assert.equal(nc.shouldSendNow({localHour: nc.WINDOW_OPEN_HOUR}), true);
    assert.equal(nc.shouldSendNow({localHour: nc.WINDOW_CLOSE_HOUR}), false);
    assert.equal(branches('window').length, 2);

    // Route: a token, a phone, or neither — the three the diagram draws.
    assert.equal(nc.chooseRoute({hasLiveToken: true, hasPhone: true}), 'push');
    assert.equal(nc.chooseRoute({hasLiveToken: false, hasPhone: true}), 'text');
    assert.equal(nc.chooseRoute({hasLiveToken: false, hasPhone: false}), 'none');
    assert.equal(branches('route').length, 3);

    // After the provider: accepted, dead, or retryable — again three.
    assert.equal(nc.afterPushAttempt({anyAccepted: true}), 'done');
    assert.equal(nc.afterPushAttempt({anyRetryable: true, hasPhone: true}), 'stop');
    assert.equal(nc.afterPushAttempt({hasPhone: true}), 'text');
    assert.equal(nc.afterPushAttempt({hasPhone: false}), 'unreachable');
    assert.equal(branches('provider').length, 3);

    // The dead-token codes named on the diagram are the ones acted on.
    flow.steps.find((step) => step.id === 'provider').codes.forEach((code) => {
        assert.equal(nc.isDeadToken(code), true, code + ' is drawn as fatal and is not');
    });
    assert.equal(nc.isDeadToken('messaging/server-unavailable'), false);
});

test('the window a type obeys is spelled out from the same constants', () => {
    const constants = {
        openHour: nc.WINDOW_OPEN_HOUR,
        closeHour: nc.WINDOW_CLOSE_HOUR,
        timezone: nc.CHURCH_TIMEZONE,
    };
    assert.equal(core.windowLabel('church', constants), '8am–8pm America/Chicago');
    assert.match(core.windowLabel('church-unless-manual', constants), /^8am–8pm America\/Chicago, unless/);
    assert.match(core.windowLabel('bypassed', constants), /the moment/);
    assert.match(core.windowLabel('none', constants), /No window/);
});
