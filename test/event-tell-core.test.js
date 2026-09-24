const { test } = require('node:test');
const assert = require('node:assert');

const Tell = require('../public/event-tell-core.js');
const Ann = require('../public/event-announcement-core.js');

function partsAt(date, hour, minute) {
    return { date, hour, minute };
}

test('a one-off with two future dates yields two moments', () => {
    const moments = Tell.upcomingTellMoments({
        eventKind: 'one-off',
        goingOut: {
            way: Ann.TOLD,
            dates: [
                { date: '2026-06-01', time: '09:00' },
                { date: '2026-06-02', time: '10:00' },
            ],
        },
        now: new Date('2026-05-01T15:00:00Z'),
    });
    assert.deepEqual(moments.map((m) => m.date + ' ' + m.time), [
        '2026-06-01 09:00',
        '2026-06-02 10:00',
    ]);
});

test('a past date and a same-day past time produce no moments', () => {
    const pastDay = Tell.upcomingTellMoments({
        eventKind: 'one-off',
        goingOut: {
            way: Ann.TOLD,
            dates: [{ date: '2026-04-01', time: '09:00' }],
        },
        now: new Date('2026-05-01T15:00:00Z'),
    });
    assert.equal(pastDay.length, 0);

    const pastTime = Tell.upcomingTellMoments({
        eventKind: 'one-off',
        goingOut: {
            way: Ann.TOLD,
            dates: [{ date: '2026-05-01', time: '08:00' }],
        },
        now: new Date('2026-05-01T20:00:00Z'),
    });
    assert.equal(pastTime.length, 0);
});

test('a repeating tell uses skip and move like printing', () => {
    const rule = { freq: 'weekly', weekday: 3, startDate: '2026-10-07', time: '19:00' };
    const moments = Tell.upcomingTellMoments({
        eventKind: 'repeating',
        seriesId: 'midweek',
        rule,
        stored: [
            { seriesId: 'midweek', date: '2026-10-21', cancelled: true },
            { seriesId: 'midweek', date: '2026-10-21', movedTo: '2026-10-22' },
            { seriesId: 'midweek', date: '2026-10-22', movedFrom: '2026-10-21' },
        ],
        goingOut: { way: Ann.TOLD, daysBefore: 14, time: '08:00' },
        now: new Date('2026-09-01T15:00:00Z'),
    });
    const dates = moments.map((m) => m.date);
    assert.ok(!dates.some((d) => d === '2026-10-07'));
    assert.ok(dates.includes('2026-10-08'));
});

test('audience at send time keeps the Inactive rule and ignores hidden', () => {
    const people = [
        { id: 'a', name: 'Ada', tags: ['choir'], membership: {}, userId: 'u1' },
        { id: 'b', name: 'Bob', tags: ['choir'], membership: { inactive: true } },
        { id: 'c', name: 'Cara', tags: ['choir'], membership: {}, hidden: true },
    ];
    const audience = Tell.audienceAtSendTime({
        tagIds: ['choir'],
        people,
    });
    assert.deepEqual(audience.map((p) => p.id), ['a', 'c']);

    const withInactive = Tell.audienceAtSendTime({
        tagIds: ['choir', Ann.INACTIVE_TAG_ID],
        people: people.map((p) => p.id === 'b' ?
            Object.assign({}, p, { tags: ['choir', Ann.INACTIVE_TAG_ID] }) : p),
    });
    assert.deepEqual(withInactive.map((p) => p.id), ['b']);
});

test('reachability is no phone and no linked user', () => {
    assert.equal(Tell.isReachable({ contact: { phone: '555' } }), true);
    assert.equal(Tell.isReachable({ userId: 'uid' }), true);
    assert.equal(Tell.isReachable({ contact: {}, userId: null }), false);
});

test('preview lists matching unreachable people separately from reachable', () => {
    const preview = Tell.previewTellAudience({
        tagIds: ['choir'],
        savedTagIds: ['choir'],
        visibleTagIds: ['choir'],
        people: [
            { id: 'a', name: 'Ada', tags: ['choir'], contact: { phone: '1' } },
            { id: 'b', name: 'Ben', tags: ['choir'], contact: {} },
        ],
        viewerMaySeeHidden: true,
    });
    assert.deepEqual(preview.reachable, ['Ada']);
    assert.deepEqual(preview.unreachable, ['Ben']);
});

test('moments due this tick catch the hour just ended', () => {
    const now = new Date('2026-05-01T14:05:00Z');
    const parts = Tell.churchNowParts(now);
    const moments = [{ date: parts.date, time: '09:00', occurrenceDate: null }];
    const due = Tell.momentsDueThisTick(moments, now, Tell.TICK_MS);
    assert.equal(due.length, 1);
});

test('ledger ids are stable for a moment and person', () => {
    const id = Tell.ledgerId('ann-1', '2026-05-03', '08:00', 'person-9');
    assert.match(id, /ann-1/);
    assert.match(id, /person-9/);
});
