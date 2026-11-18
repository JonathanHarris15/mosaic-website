/**
 * The hourly nudge job (MS-248, MS-446), run with the real nudge core and the
 * real send path. Only the network is faked — push, text, and a Firestore
 * that is a map in memory.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const {runNudgeTick} = require('../functions/assignment-nudge-firestore.js');
const {tellPerson} = require('../functions/notification-send.js');
const nudge = require('../functions/assignment-nudge.js');
const {churchDateParts} = require('../functions/notification-core.js');

// 2026-09-15 15:00 UTC is 10:00 in Chicago, inside the 8am–8pm window.
const INSIDE = new Date('2026-09-15T15:00:00Z');
// 2026-09-15 11:00 UTC is 06:00 in Chicago.
const BEFORE_EIGHT = new Date('2026-09-15T11:00:00Z');

/** @param {Object<string, *>} [over] */
function world(over) {
    const o = over || {};
    const records = new Map();
    /** @type {{push: Array<*>, text: Array<*>, logs: Array<*>}} */
    const calls = {push: [], text: [], logs: []};
    /** @type {Object<string, *>} */
    const people = o.people || {
        p1: {uid: 'u1', phone: '+15550001', firstName: 'Ada'},
    };
    /** @type {Object<string, *>} */
    const tokens = o.tokens || {u1: [{id: 'd1', token: 't1'}]};
    let now = o.now || INSIDE;
    const occurrences = o.occurrences || [{
        id: 'sunday_service_2026-09-20',
        seriesId: 'sunday_service',
        date: '2026-09-20',
        name: 'Sunday Service',
        assignments: [{personId: 'p1', roleSlug: 'sound', slotId: 's1',
            state: 'pending', stateSetAt: '2026-09-01T12:00:00Z'}],
    }];
    /** @type {*} */
    const notifierDeps = {
        now: () => now,
        loadPerson: async (/** @type {string} */ id) => people[id] || {uid: null, phone: '', firstName: ''},
        loadTokens: async (/** @type {string} */ uid) => tokens[uid] || [],
        loadTemplates: async () => nudge.templatesForSendPath({}),
        sendPush: async (/** @type {*} */ m) => { calls.push.push(m); return {accepted: true}; },
        sendText: async (/** @type {*} */ m) => { calls.text.push(m); return {accepted: true, textId: 'x'}; },
        deleteToken: async () => {},
        writeLog: async (/** @type {*} */ row) => { calls.logs.push(row); },
    };
    /** @type {*} */
    const deps = {
        today: () => churchDateParts(now).date,
        origin: 'https://example.test',
        tellPerson,
        notifierDeps,
        loadConfig: async () => (o.config === undefined ? {nudgeEnabled: true} : o.config),
        loadOccurrences: async () => JSON.parse(JSON.stringify(occurrences)),
        loadRoleNames: async () => ({sound: 'Sound'}),
        loadRecords: async (/** @type {Array<string>} */ ids) => ids.filter((id) => records.has(id))
            .map((id) => Object.assign({id}, records.get(id))),
        writeRecord: async (/** @type {string} */ id, /** @type {*} */ row) => { records.set(id, row); },
    };
    return {deps, calls, records, setNow: (/** @type {Date} */ d) => { now = d; }};
}

test('switched on, a Pending Assignment 5 days out gets one push linking to Commitments', async () => {
    const w = world();
    const out = await runNudgeTick(w.deps);
    assert.deepEqual(out, {ran: true, sent: 1});
    assert.equal(w.calls.push.length, 1);
    assert.equal(w.calls.push[0].title, 'Can you make it?');
    assert.equal(w.calls.push[0].body,
        'You still have not confirmed or traded your service role for Sunday, September 20. Tap to answer.');
    assert.equal(w.calls.push[0].url, 'https://example.test/commitments.html');
    assert.equal(w.calls.logs.length, 1);
    assert.equal(w.calls.logs[0].purpose, 'assignment_nudge');
});

test('switched off, or never switched on, nothing is sent', async () => {
    for (const config of [{nudgeEnabled: false}, {}]) {
        const w = world({config});
        const out = await runNudgeTick(w.deps);
        assert.equal(out.ran, false);
        assert.equal(w.calls.push.length + w.calls.text.length, 0);
    }
});

test('running twice in the same hour sends once', async () => {
    const w = world();
    await runNudgeTick(w.deps);
    await runNudgeTick(w.deps);
    assert.equal(w.calls.push.length, 1);
});

test('an editor re-saving the roster does not cause a second nudge', async () => {
    // The roster row is rewritten whole, but the record lives apart from it.
    const w = world();
    await runNudgeTick(w.deps);
    w.deps.loadOccurrences = async () => [{
        id: 'sunday_service_2026-09-20', seriesId: 'sunday_service',
        date: '2026-09-20', name: 'Sunday Service',
        assignments: [{personId: 'p1', roleSlug: 'sound', slotId: 's1',
            state: 'pending', stateSetAt: '2026-09-01T12:00:00Z'}],
    }];
    await runNudgeTick(w.deps);
    assert.equal(w.calls.push.length, 1);
});

test('with push switched off, the nudge is the church\'s text, every other day', async () => {
    const w = world();
    w.deps.notifierDeps.pushAllowed = async () => false;
    await runNudgeTick(w.deps);
    assert.equal(w.calls.push.length, 0, 'no push while it is off');
    assert.equal(w.calls.text.length, 1);
    assert.equal(w.calls.text[0].body,
        'You still have not confirmed or traded your service role for Sunday, September 20 ' +
        'and it is 5 days away. Please do so now: https://example.test/commitments.html');
    assert.equal(w.calls.text[0].expectReply, false);
    w.setNow(new Date('2026-09-16T15:00:00Z')); // the next day: nothing
    await runNudgeTick(w.deps);
    assert.equal(w.calls.text.length, 1);
    w.setNow(new Date('2026-09-17T15:00:00Z')); // two days on: again
    await runNudgeTick(w.deps);
    assert.equal(w.calls.text.length, 2);
    assert.match(w.calls.text[1].body, /it is 3 days away/);
});

test('the morning before, somebody confirmed is reminded who they serve with', async () => {
    const w = world({
        now: new Date('2026-09-19T14:00:00Z'), // 9am Saturday
        people: {
            p1: {uid: null, phone: '+15550001', firstName: 'Ada'},
            p2: {uid: null, phone: '+15550002', firstName: 'Bo'},
        },
        occurrences: [{
            id: 'o1', seriesId: 'sunday_service', date: '2026-09-20', name: 'Sunday Service',
            assignments: [
                {personId: 'p1', roleSlug: 'sound', slotId: 's1', state: 'confirmed'},
                {personId: 'p2', roleSlug: 'sound', slotId: 's2', state: 'confirmed'},
            ],
        }],
    });
    w.deps.loadNames = async () => ({p1: 'Ada Lovelace', p2: 'Bo Diddley'});
    await runNudgeTick(w.deps);
    const toAda = w.calls.text.find((m) => m.to === '+15550001');
    assert.equal(toAda.body, 'This is a reminder for your upcoming service role tomorrow: Sound. ' +
        'You will be serving with Bo Diddley. Thank you for serving!');
    await runNudgeTick(w.deps);
    assert.equal(w.calls.text.length, 2, 'once each');
});

test('an Assignment answered between nudges gets nothing more', async () => {
    const w = world();
    await runNudgeTick(w.deps);
    w.deps.loadOccurrences = async () => [{
        id: 'sunday_service_2026-09-20', seriesId: 'sunday_service',
        date: '2026-09-20', name: 'Sunday Service',
        assignments: [{personId: 'p1', roleSlug: 'sound', slotId: 's1',
            state: 'confirmed', stateSetAt: '2026-09-16T12:00:00Z'}],
    }];
    w.setNow(new Date('2026-09-17T15:00:00Z'));
    await runNudgeTick(w.deps);
    assert.equal(w.calls.push.length + w.calls.text.length, 1);
});

test('before 8am nothing goes out and nothing is stamped', async () => {
    const w = world({now: BEFORE_EIGHT});
    await runNudgeTick(w.deps);
    assert.equal(w.calls.push.length + w.calls.text.length, 0);
    assert.equal(w.records.size, 0);
});

test('a send nobody can receive is still stamped, so it is not retried hourly', async () => {
    const w = world({people: {p1: {uid: null, phone: '', firstName: 'Ada'}}, tokens: {}});
    await runNudgeTick(w.deps);
    assert.equal(w.records.size, 1);
    const [row] = [...w.records.values()];
    assert.equal(row.lastNudgeDate, '2026-09-15');
    assert.equal(row.lastNudgeChannel, 'none');
    await runNudgeTick(w.deps);
    assert.equal(w.calls.logs.length, 1, 'one attempt, one log row');
});

test('a throw in one send does not stop the next Person', async () => {
    const w = world({
        people: {
            p1: {uid: null, phone: '+15550001', firstName: 'Ada'},
            p2: {uid: null, phone: '+15550002', firstName: 'Bo'},
        },
        occurrences: [{
            id: 'o1', seriesId: 'sunday_service', date: '2026-09-20', name: 'Sunday Service',
            assignments: [
                {personId: 'p1', roleSlug: 'sound', slotId: 's1', state: 'pending'},
                {personId: 'p2', roleSlug: 'sound', slotId: 's2', state: 'pending'},
            ],
        }],
    });
    let first = true;
    w.deps.notifierDeps.sendText = async (/** @type {*} */ m) => {
        if (first) { first = false; throw new Error('network'); }
        w.calls.text.push(m);
        return {accepted: true, textId: 'y'};
    };
    const out = await runNudgeTick(w.deps);
    assert.equal(out.sent, 1);
    assert.equal(w.records.size, 2);
});

// index.js wiring, read as source — the repo's pattern for Cloud Functions glue.
const fs = require('fs');
const path = require('path');
const index = fs.readFileSync(path.join(__dirname, '../functions/index.js'), 'utf8');

/**
 * @param {string} src
 * @param {string} startMark
 * @param {string} endMark
 * @return {string}
 */
function sliceBetween(src, startMark, endMark) {
    const start = src.indexOf(startMark);
    assert.ok(start !== -1, startMark);
    const end = src.indexOf(endMark, start + startMark.length);
    assert.ok(end !== -1, endMark);
    return src.slice(start, end);
}

test('an hourly job runs the nudge tick through the real send path deps', () => {
    const job = sliceBetween(index, 'exports.sendAssignmentNudges', '\n);\n');
    assert.match(job, /every 60 minutes/);
    assert.match(job, /runNudgeTick/);
    assert.match(job, /buildNudgeDeps/);
    assert.match(job, /notifierDeps\(db\)/);
    assert.match(job, /notify\.tellPerson/);
    assert.match(job, /secrets:\s*\[TEXTBELT_KEY\]/);
});

test('the send path loads the nudge wording beside the others', () => {
    const deps = sliceBetween(index, 'function notifierDeps(db)', 'function tell(db, request)');
    assert.match(deps, /nudgeTemplates\(loaded\.raw\)/);
});
