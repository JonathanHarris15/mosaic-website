const { test } = require('node:test');
const assert = require('node:assert');

const eventTell = require('../functions/event-tell.js');
const Tell = require('../public/event-tell-core.js');
const Ann = require('../public/event-announcement-core.js');

test('jobMayRun is false outside 8am–8pm church-local', () => {
    assert.equal(eventTell.jobMayRun(7), false);
    assert.equal(eventTell.jobMayRun(20), false);
    assert.equal(eventTell.jobMayRun(8), true);
    assert.equal(eventTell.jobMayRun(19), true);
});

test('sendOne writes a marker after a successful tellPerson call', async () => {
    const markers = new Set();
    const tellPerson = async () => ({ accepted: true, channel: 'push' });
    const outcome = await eventTell.sendOne({
        hasSentMarker: async (id) => markers.has(id),
        writeSentMarker: async (id) => { markers.add(id); },
        tellPerson,
        notifierDeps: {},
    }, {
        announcementId: 'a1',
        moment: { date: '2026-06-01', time: '09:00' },
        personId: 'p1',
        person: { contact: { phone: '555' }, userId: null },
        firstName: 'Ada',
        title: 'Title',
        prose: 'Prose',
        url: 'https://example.test/e',
    });
    assert.equal(outcome.sent, true);
    assert.equal(markers.size, 1);
});

test('sendOne skips when notification path is absent', async () => {
    const outcome = await eventTell.sendOne({
        hasSentMarker: async () => false,
        writeSentMarker: async () => {},
        tellPerson: null,
        notifierDeps: null,
    }, {
        announcementId: 'a1',
        moment: { date: '2026-06-01', time: '09:00' },
        personId: 'p1',
        person: { contact: { phone: '555' } },
        firstName: 'Ada',
        title: 'T',
        prose: 'P',
        url: 'https://example.test/e',
    });
    assert.equal(outcome.skipped, 'notification_path_absent');
});

test('runEventTellTick does nothing outside the send window', async () => {
    const result = await eventTell.runEventTellTick({
        now: () => new Date('2026-05-01T06:00:00Z'),
        loadTellParents: async () => [],
    });
    assert.equal(result.ran, false);
});

test('joinedAnnouncement refuses without told going-out', () => {
    assert.equal(eventTell.joinedAnnouncement('id', { title: 'T', prose: 'P' }, null), null);
    assert.equal(eventTell.joinedAnnouncement('id', { title: 'T', prose: 'P' }, { way: Ann.PRINTED }), null);
});
