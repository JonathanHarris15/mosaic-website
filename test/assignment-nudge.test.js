/**
 * The nudge core (MS-248, MS-436): who is nudged about which places, and
 * when. Plain data in, a plan out — no Firestore, no send, no clock.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const nudge = require('../functions/assignment-nudge.js');

const TODAY = '2026-09-15'; // a Tuesday

/**
 * @param {Object<string, *>} [over]
 * @return {*}
 */
function occ(over) {
    return Object.assign({
        id: 'sunday_service_2026-09-20',
        seriesId: 'sunday_service',
        date: '2026-09-20',
        name: 'Sunday Service',
        assignments: [],
    }, over || {});
}

/**
 * @param {Object<string, *>} [over]
 * @return {*}
 */
function pending(over) {
    return Object.assign({
        personId: 'p1',
        roleSlug: 'sound',
        slotId: 's1',
        oneOffId: null,
        label: null,
        state: 'pending',
        stateSetAt: '2026-09-01T15:00:00Z',
    }, over || {});
}

const ROLE_NAMES = {sound: 'Sound', coffee: 'Coffee', setup: 'Setup'};

/**
 * @param {Array<*>} occurrences
 * @param {Array<*>} [records]
 * @param {string} [today]
 */
function plan(occurrences, records, today) {
    return nudge.nudgePlan({
        occurrences: occurrences,
        records: records || [],
        today: today || TODAY,
        roleNames: ROLE_NAMES,
    });
}

/**
 * @param {*} o
 * @param {*} a
 * @param {Object<string, *>} [over]
 * @return {*}
 */
function record(o, a, over) {
    return Object.assign({
        id: nudge.nudgeRecordId(o, a),
        personId: a.personId,
        firstDate: null,
        firstChannel: null,
        secondDate: null,
        secondChannel: null,
    }, over || {});
}

test('a Pending Assignment 5 days out is due a first nudge naming it', () => {
    const o = occ({assignments: [pending()]});
    const out = plan([o]);
    assert.equal(out.length, 1);
    assert.equal(out[0].personId, 'p1');
    assert.equal(out[0].escalate, false);
    assert.equal(out[0].assignments.length, 1);
    assert.equal(out[0].assignments[0].stage, 'first');
    assert.equal(out[0].values.places, 'Sound on Sun 20 Sep (Sunday Service)');
});

test('the day boundaries: only 1 to 5 days out are nudged', () => {
    const at = (/** @type {string} */ date) => plan([occ({date: date, assignments: [pending()]})]).length;
    assert.equal(at('2026-09-21'), 0, '6 days out');
    assert.equal(at('2026-09-20'), 1, '5 days out');
    assert.equal(at('2026-09-19'), 1, '4 days out');
    assert.equal(at('2026-09-18'), 1, '3 days out');
    assert.equal(at('2026-09-16'), 1, '1 day out');
    assert.equal(at('2026-09-15'), 0, 'today');
    assert.equal(at('2026-09-14'), 0, 'past');
});

test('Confirmed and Declined Assignments are answers and are never nudged', () => {
    const o = occ({assignments: [
        pending({state: 'confirmed'}),
        pending({personId: 'p2', slotId: 's2', state: 'declined'}),
    ]});
    assert.deepEqual(plan([o]), []);
});

test('a missing state reads as Pending, as everywhere else', () => {
    const a = pending();
    delete a.state;
    assert.equal(plan([occ({assignments: [a]})]).length, 1);
});

test('the second nudge comes at 3 days out, on a later day, and escalates', () => {
    const a = pending();
    const o4 = occ({date: '2026-09-19', assignments: [a]});
    const first = record(o4, a, {firstDate: '2026-09-14', firstChannel: 'push'});
    assert.deepEqual(plan([o4], [first]), [], '4 days out: not yet');

    const o3 = occ({date: '2026-09-18', assignments: [a]});
    const r3 = record(o3, a, {firstDate: '2026-09-13', firstChannel: 'push'});
    const out = plan([o3], [r3]);
    assert.equal(out.length, 1);
    assert.equal(out[0].assignments[0].stage, 'second');
    assert.equal(out[0].escalate, true);
    assert.equal(out[0].previousChannel, 'push');
});

test('the second is never on the same day as the first', () => {
    const a = pending();
    const o = occ({date: '2026-09-17', assignments: [a]});
    const r = record(o, a, {firstDate: TODAY, firstChannel: 'text'});
    assert.deepEqual(plan([o], [r]), []);
});

test('no Assignment ever gets more than two nudges', () => {
    const a = pending();
    const o = occ({date: '2026-09-16', assignments: [a]});
    const r = record(o, a, {
        firstDate: '2026-09-11', firstChannel: 'push',
        secondDate: '2026-09-13', secondChannel: 'text',
    });
    assert.deepEqual(plan([o], [r]), []);
});

test('an Assignment made 2 days out gets one first nudge, not two on one day', () => {
    const o = occ({date: '2026-09-17', assignments: [pending()]});
    const out = plan([o]);
    assert.equal(out.length, 1);
    assert.equal(out[0].assignments[0].stage, 'first');
    assert.equal(out[0].escalate, false);
});

test('an Assignment made today is not nudged today', () => {
    const o = occ({assignments: [pending({stateSetAt: '2026-09-15T14:00:00Z'})]});
    assert.deepEqual(plan([o]), []);
});

test('assigned late yesterday evening, church-local, still counts as yesterday', () => {
    // 03:30 UTC on the 15th is 22:30 on the 14th in Chicago.
    const o = occ({assignments: [pending({stateSetAt: '2026-09-15T03:30:00Z'})]});
    assert.equal(plan([o]).length, 1);
});

test('a missing stateSetAt counts as long ago', () => {
    const o = occ({assignments: [pending({stateSetAt: null})]});
    assert.equal(plan([o]).length, 1);
});

test('stateSetAt may arrive as a Firestore Timestamp or a Date', () => {
    const ts = {toDate: () => new Date('2026-09-15T14:00:00Z')};
    assert.deepEqual(plan([occ({assignments: [pending({stateSetAt: ts})]})]), []);
    const d = new Date('2026-09-15T14:00:00Z');
    assert.deepEqual(plan([occ({assignments: [pending({stateSetAt: d})]})]), []);
});

test('a skipped date, and the date a moved one left, are not nudged', () => {
    assert.deepEqual(plan([occ({cancelled: true, assignments: [pending()]})]), []);
    assert.deepEqual(plan([occ({movedTo: '2026-09-27', assignments: [pending()]})]), []);
});

test('a moved date is judged by its new date', () => {
    const moved = occ({
        id: 'sunday_service_2026-09-17', date: '2026-09-17',
        movedFrom: '2026-09-13', assignments: [pending()],
    });
    assert.equal(plan([moved]).length, 1);
});

test('a Liturgical Role is never nudged', () => {
    const o = occ({assignments: [pending({roleSlug: 'preacher', slotId: null})]});
    assert.deepEqual(plan([o]), []);
});

test('a One-off Role is nudged by its label', () => {
    const o = occ({assignments: [pending({
        roleSlug: 'one_off', slotId: null, oneOffId: 'j1', label: 'Unlock the hall',
    })]});
    const out = plan([o]);
    assert.equal(out[0].values.places, 'Unlock the hall on Sun 20 Sep (Sunday Service)');
});

test('two Assignments due in one run are one Notification naming both', () => {
    const o = occ({assignments: [
        pending(),
        pending({roleSlug: 'coffee', slotId: 'c1'}),
    ]});
    const out = plan([o]);
    assert.equal(out.length, 1);
    assert.equal(out[0].assignments.length, 2);
    assert.equal(out[0].values.places,
        'Sound on Sun 20 Sep (Sunday Service) and Coffee on Sun 20 Sep (Sunday Service)');
});

test('three Assignments read as a list with "and" before the last', () => {
    const o = occ({assignments: [
        pending(),
        pending({roleSlug: 'coffee', slotId: 'c1'}),
        pending({roleSlug: 'setup', slotId: 'u1'}),
    ]});
    assert.equal(plan([o])[0].values.places,
        'Sound on Sun 20 Sep (Sunday Service), Coffee on Sun 20 Sep (Sunday Service) ' +
        'and Setup on Sun 20 Sep (Sunday Service)');
});

test('a grouped message escalates when any Assignment in it is on its second', () => {
    const a = pending();
    const b = pending({roleSlug: 'coffee', slotId: 'c1'});
    const thu = occ({id: 'sunday_service_2026-09-18', date: '2026-09-18', assignments: [a]});
    const sun = occ({id: 'sunday_service_2026-09-20', date: '2026-09-20', assignments: [b]});
    const r = record(thu, a, {firstDate: '2026-09-13', firstChannel: 'text'});
    const out = plan([thu, sun], [r]);
    assert.equal(out.length, 1);
    assert.equal(out[0].escalate, true);
    assert.equal(out[0].previousChannel, 'text');
    assert.deepEqual(out[0].assignments.map((p) => p.stage).sort(), ['first', 'second']);
});

test('nobody is nudged twice on one church-local day', () => {
    const a = pending();
    const b = pending({roleSlug: 'coffee', slotId: 'c1'});
    const o1 = occ({id: 'x_2026-09-18', date: '2026-09-18', assignments: [a]});
    const o2 = occ({id: 'y_2026-09-20', date: '2026-09-20', assignments: [b]});
    // Assignment a was nudged this morning; b turned up later the same day.
    const r = record(o1, a, {firstDate: TODAY, firstChannel: 'push'});
    assert.deepEqual(plan([o1, o2], [r]), []);
});

test('somebody who takes over a declined Assignment starts their own clock', () => {
    const old = pending({personId: 'p1'});
    const o = occ({date: '2026-09-18', assignments: [pending({personId: 'p2'})]});
    const theirs = record(o, old, {
        firstDate: '2026-09-11', firstChannel: 'push',
        secondDate: '2026-09-13', secondChannel: 'text',
    });
    const out = plan([o], [theirs]);
    assert.equal(out.length, 1);
    assert.equal(out[0].personId, 'p2');
    assert.equal(out[0].assignments[0].stage, 'first');
});

test('a participant-rung Event names the Role and date, never the Event', () => {
    const o = occ({
        id: 'elders_2026-09-20', seriesId: 'elders', name: 'Elders retreat',
        visibility: 'participant', assignments: [pending()],
    });
    assert.equal(plan([o])[0].values.places, 'Sound on Sun 20 Sep');
});

test('an Event with no name of its own falls back to its series name', () => {
    const o = occ({name: undefined, seriesName: 'Youth night', assignments: [pending()]});
    assert.equal(plan([o])[0].values.places, 'Sound on Sun 20 Sep (Youth night)');
});

test('a Role the roles list does not know reads by its slug, not as nothing', () => {
    const o = occ({assignments: [pending({roleSlug: 'ushers', slotId: 'u1'})]});
    assert.equal(plan([o])[0].values.places, 'ushers on Sun 20 Sep (Sunday Service)');
});

test('each due Assignment carries the record it stamps', () => {
    const a = pending();
    const o = occ({assignments: [a]});
    const due = plan([o])[0].assignments[0];
    assert.equal(due.recordId, nudge.nudgeRecordId(o, a));
    assert.equal(due.occurrenceId, o.id);
    assert.equal(due.roleSlug, 'sound');
});

test('the record id is the key of the Assignment, so it names the slot and the Person', () => {
    const o = occ();
    assert.equal(
        nudge.nudgeRecordId(o, pending()),
        'sunday_service_2026-09-20__sound__s1__p1');
});

test('stamping a record writes the first or the second, never both', () => {
    const first = nudge.stampedRecord(null, {
        assignment: {recordId: 'r1', occurrenceId: 'o', roleSlug: 'sound', slotId: 's1',
            oneOffId: null, stage: 'first'},
        personId: 'p1', today: TODAY, channel: 'push',
    });
    assert.equal(first.firstDate, TODAY);
    assert.equal(first.firstChannel, 'push');
    assert.equal(first.secondDate, null);

    const second = nudge.stampedRecord(first, {
        assignment: {recordId: 'r1', stage: 'second'},
        personId: 'p1', today: '2026-09-17', channel: 'text',
    });
    assert.equal(second.firstDate, TODAY);
    assert.equal(second.secondDate, '2026-09-17');
    assert.equal(second.secondChannel, 'text');
});

test('the wording falls back to the defaults when blank', () => {
    const t = nudge.templatesForSendPath({});
    assert.match(t.text.nudge, /\{places\}/);
    assert.match(t.text.nudge, /\{link\}/);
    assert.equal(t.push.nudge.title, 'Can you make it?');
    assert.equal(t.push.nudge.body, "You're down for {places}. Tap to answer.");
});

test('saved wording replaces the defaults, field by field', () => {
    const t = nudge.templatesForSendPath({
        nudgeText: 'Hey {name}: {places}. {link}',
        pushNudgeTitle: '  ',
        pushNudgeBody: 'Still on for {places}?',
    });
    assert.equal(t.text.nudge, 'Hey {name}: {places}. {link}');
    assert.equal(t.push.nudge.title, 'Can you make it?');
    assert.equal(t.push.nudge.body, 'Still on for {places}?');
});

test('the request names a Person, a purpose and a URL, never a channel', () => {
    const o = occ({assignments: [pending()]});
    const send = plan([o])[0];
    const req = nudge.notifyRequest(send, 'https://example.test');
    assert.equal(req.personId, 'p1');
    assert.equal(req.purpose, 'assignment_nudge');
    assert.equal(req.wording, 'nudge');
    assert.equal(req.url, 'https://example.test/commitments.html');
    assert.equal(req.escalate, false);
    assert.equal(req.expectReply, false);
    assert.equal(req.values.places, 'Sound on Sun 20 Sep (Sunday Service)');
    assert.equal(req.channel, undefined);
});

test('only nudges when the admin switch is on, and it is off when unset', () => {
    assert.equal(nudge.nudgingOn({}), false);
    assert.equal(nudge.nudgingOn(null), false);
    assert.equal(nudge.nudgingOn({nudgeEnabled: true}), true);
});

test('the dates it reads run from tomorrow to 5 days out', () => {
    assert.deepEqual(nudge.lookAhead(TODAY), {from: '2026-09-16', to: '2026-09-20'});
});

test('a date moved after its nudges keeps its count, so it never gets a third', () => {
    const a = pending();
    const before = occ({id: 'sunday_service_2026-09-13', date: '2026-09-13'});
    const r = record(before, a, {
        firstDate: '2026-09-08', firstChannel: 'push',
        secondDate: '2026-09-10', secondChannel: 'text',
    });
    const moved = occ({
        id: 'sunday_service_2026-09-18', date: '2026-09-18',
        movedFrom: '2026-09-13', assignments: [a],
    });
    assert.deepEqual(plan([moved], [r]), []);
});

test('a date moved TWICE still keeps its count — the key is where it started, not the last hop', () => {
    const a = pending();
    const first = occ({id: 'sunday_service_2026-09-13', date: '2026-09-13'});
    const r = record(first, a, {
        firstDate: '2026-09-08', firstChannel: 'push',
        secondDate: '2026-09-10', secondChannel: 'text',
    });
    // 13th → 18th → 20th. movedFrom now says the 18th; originalDate the 13th.
    const twice = occ({
        id: 'sunday_service_2026-09-20', date: '2026-09-20',
        movedFrom: '2026-09-18', originalDate: '2026-09-13', assignments: [a],
    });
    assert.equal(nudge.nudgeRecordId(twice, a), nudge.nudgeRecordId(first, a));
    assert.deepEqual(plan([twice], [r]), []);
});

test('a moved date not yet nudged is nudged by its new date', () => {
    const moved = occ({
        id: 'sunday_service_2026-09-18', date: '2026-09-18',
        movedFrom: '2026-09-13', assignments: [pending()],
    });
    const out = plan([moved]);
    assert.equal(out[0].assignments[0].recordId,
        'sunday_service_2026-09-13__sound__s1__p1');
    assert.equal(out[0].values.places, 'Sound on Fri 18 Sep (Sunday Service)');
});
