const { test } = require('node:test');
const assert = require('node:assert');

const eventTell = require('../functions/event-tell.js');
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

// The hourly job used to hand the send path an empty object, so the first
// due person threw "deps.loadPerson is not a function" and nothing went out.
const fs = require('fs');
const path = require('path');

function sliceBetween(src, startMark, endMark) {
    const start = src.indexOf(startMark);
    assert.ok(start !== -1, startMark);
    const end = src.indexOf(endMark, start + startMark.length);
    assert.ok(end !== -1, endMark);
    return src.slice(start, end);
}

test('the hourly announcement job sends through the real send path deps', () => {
    const index = fs.readFileSync(
        path.join(__dirname, '../functions/index.js'), 'utf8');
    const job = sliceBetween(index,
        'exports.sendEventAnnouncementTells', 'exports.sendPrayerRequestTexts');
    assert.match(job, /notifierDeps\(db\)/);
    assert.doesNotMatch(job, /notifierDeps\s*=\s*\{\}/);
    assert.match(job, /notify\.tellPerson/);
});

test('the send path loads event announcement wording beside the prayer wording', () => {
    const index = fs.readFileSync(
        path.join(__dirname, '../functions/index.js'), 'utf8');
    const deps = sliceBetween(index,
        'function notifierDeps(db)', 'function tell(db, request)');
    assert.match(deps, /eventAnnWording\.templatesForSendPath/);
});

test('a due tell goes out through tellPerson with the deps it needs', async () => {
    const {tellPerson} = require('../functions/notification-send.js');
    const wording = require('../functions/event-announcement-notification.js');
    const pushes = [];
    const notifierDeps = {
        now: () => new Date('2026-06-15T15:00:00Z'),
        loadPerson: async () => ({uid: 'u1', phone: '+15551212', firstName: 'Ada'}),
        loadTokens: async () => [{id: 'd1', token: 't1'}],
        loadTemplates: async () => wording.templatesForSendPath({}),
        sendPush: async (msg) => { pushes.push(msg); return {accepted: true}; },
        sendText: async () => ({accepted: true, textId: 'x'}),
        deleteToken: async () => {},
        writeLog: async () => {},
    };
    const outcome = await eventTell.sendOne({
        hasSentMarker: async () => false,
        writeSentMarker: async () => {},
        tellPerson,
        notifierDeps,
    }, {
        announcementId: 'a1',
        moment: { date: '2026-06-15', time: '10:00' },
        personId: 'p1',
        person: { contact: { phone: '555' }, userId: 'u1' },
        firstName: 'Ada',
        title: 'Title',
        prose: 'Prose',
        url: 'https://example.test/e',
    });
    assert.equal(outcome.sent, true);
    assert.equal(pushes[0].title, 'Title');
    assert.equal(pushes[0].body, 'Prose');
});
