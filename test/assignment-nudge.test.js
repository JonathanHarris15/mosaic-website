/**
 * The assignment reminder core (MS-248, reworked): who is nudged about
 * which places, and when, and who gets the day-before reminder. Plain data
 * in, a plan out — no Firestore, no send, no clock.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const nudge = require('../functions/assignment-nudge.js');

const TODAY = '2026-11-16'; // a Monday; the Sunday is 6 days out
const SUNDAY = '2026-11-22';

/**
 * @param {Object<string, *>} [over]
 * @return {*}
 */
function occ(over) {
    return Object.assign({
        id: 'sunday_service_' + SUNDAY,
        seriesId: 'sunday_service',
        date: SUNDAY,
        name: 'Sunday Service',
        assignments: [],
    }, over || {});
}

/**
 * @param {Object<string, *>} [over]
 * @return {*}
 */
function row(over) {
    return Object.assign({
        personId: 'p1',
        roleSlug: 'sound',
        slotId: 's1',
        oneOffId: null,
        label: null,
        state: 'pending',
        stateSetAt: '2026-11-01T15:00:00Z',
    }, over || {});
}

const ROLE_NAMES = {sound: 'Sound', coffee: 'Coffee'};
const NAMES = {p1: 'Jonathan Harris', p2: 'Ann Lee', p3: 'Bob Cole'};

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
        names: NAMES,
    });
}

/**
 * @param {*} o
 * @param {*} a
 * @param {Object<string, *>} [over]
 * @return {*}
 */
function record(o, a, over) {
    return Object.assign({id: nudge.nudgeRecordId(o, a), personId: a.personId},
        over || {});
}

/** @param {string} d @param {number} n @return {string} */
function shift(d, n) {
    const t = new Date(d + 'T00:00:00Z');
    t.setUTCDate(t.getUTCDate() + n);
    return t.toISOString().slice(0, 10);
}

test('an Unconfirmed place 6 days out gets a nudge naming the date and the days', () => {
    const out = plan([occ({assignments: [row()]})]);
    assert.equal(out.length, 1);
    assert.equal(out[0].kind, 'nudge');
    assert.equal(out[0].personId, 'p1');
    assert.deepEqual(out[0].values, {date: 'Sunday, November 22', days: '6 days'});
});

test('7 days out is too early, and the date itself is too late', () => {
    assert.equal(plan([occ({assignments: [row()]})], [], shift(SUNDAY, -7)).length, 0);
    assert.equal(plan([occ({assignments: [row()]})], [], SUNDAY).length, 0);
});

test('a Declined place nobody has taken is still nudged', () => {
    const out = plan([occ({assignments: [row({state: 'declined'})]})]);
    assert.equal(out.length, 1);
    assert.equal(out[0].kind, 'nudge');
});

test('a Confirmed place is never nudged', () => {
    assert.equal(plan([occ({assignments: [row({state: 'confirmed'})]})]).length, 0);
});

test('nudges come every other day: 6, 4, 2', () => {
    const o = occ({assignments: [row()]});
    const a = o.assignments[0];
    const sent = [];
    let last = null;
    for (let days = 6; days >= 1; days -= 1) {
        const today = shift(SUNDAY, -days);
        const recs = last ? [record(o, a, {lastNudgeDate: last})] : [];
        const out = plan([o], recs, today);
        if (out.length) {
            sent.push(days);
            last = today;
        }
    }
    assert.deepEqual(sent, [6, 4, 2]);
});

test('placed 4 days out: not that day, then 3 and 1, saying "1 day"', () => {
    const today = shift(SUNDAY, -4);
    const o = occ({assignments: [row({stateSetAt: today + 'T16:00:00Z'})]});
    assert.equal(plan([o], [], today).length, 0);
    const three = plan([o], [], shift(SUNDAY, -3));
    assert.equal(three[0].values.days, '3 days');
    const rec = record(o, o.assignments[0], {lastNudgeDate: shift(SUNDAY, -3)});
    assert.equal(plan([o], [rec], shift(SUNDAY, -2)).length, 0);
    assert.equal(plan([o], [rec], shift(SUNDAY, -1))[0].values.days, '1 day');
});

test('nobody is nudged the day they declined', () => {
    const o = occ({assignments: [row({state: 'declined', stateSetAt: TODAY + 'T16:00:00Z'})]});
    assert.equal(plan([o]).length, 0);
});

test('a record from the older two-nudge shape still counts as the last nudge', () => {
    const o = occ({assignments: [row()]});
    const rec = record(o, o.assignments[0], {firstDate: shift(TODAY, -1)});
    assert.equal(plan([o], [rec]).length, 0);
});

test('two places on one date are one nudge; two dates are two', () => {
    const o = occ({assignments: [row(), row({roleSlug: 'coffee', slotId: 'c1'})]});
    const out = plan([o]);
    assert.equal(out.length, 1);
    assert.equal(out[0].assignments.length, 2);
    const other = occ({id: 'x', seriesId: 'youth', date: shift(SUNDAY, -2), assignments: [row()]});
    assert.equal(plan([o, other]).length, 2);
});

test('a skipped date is not nudged', () => {
    assert.equal(plan([occ({cancelled: true, assignments: [row()]})]).length, 0);
});

test('a Liturgical Role is never nudged', () => {
    assert.equal(plan([occ({assignments: [row({roleSlug: 'preacher'})]})]).length, 0);
});

test('somebody who takes over a place starts their own clock', () => {
    const o = occ({assignments: [row({personId: 'p2'})]});
    const old = record(o, row(), {lastNudgeDate: shift(TODAY, -1)});
    assert.equal(plan([o], [old]).length, 1);
});

test('the morning before, a Confirmed place gets a reminder naming who else serves', () => {
    const o = occ({assignments: [
        row({state: 'confirmed'}),
        row({personId: 'p2', slotId: 's2', state: 'confirmed'}),
        row({personId: 'p3', slotId: 's3', state: 'pending'}),
        row({personId: 'p3', roleSlug: 'coffee', slotId: 'c1', state: 'declined'}),
    ]});
    const out = plan([o], [], shift(SUNDAY, -1)).filter((s) => s.kind === 'reminder' && s.personId === 'p1');
    assert.equal(out.length, 1);
    assert.deepEqual(out[0].values, {
        role: 'Sound',
        serving: ' You will be serving with Ann Lee and Bob Cole.',
    });
});

test('somebody who declined is not "serving with" anybody', () => {
    const o = occ({assignments: [
        row({state: 'confirmed'}),
        row({personId: 'p2', slotId: 's2', state: 'declined'}),
    ]});
    const out = /** @type {*} */ (plan([o], [], shift(SUNDAY, -1)).find((s) => s.kind === 'reminder'));
    assert.ok(out);
    assert.equal(out.values.serving, '');
});

test('the reminder is sent once', () => {
    const o = occ({assignments: [row({state: 'confirmed'})]});
    const rec = record(o, o.assignments[0], {reminderDate: shift(SUNDAY, -1)});
    assert.equal(plan([o], [rec], shift(SUNDAY, -1)).length, 0);
});

test('the reminder reads whole: with nobody else, the middle sentence goes', () => {
    const t = nudge.templatesForSendPath({});
    assert.equal(t.text.reminder,
        'This is a reminder for your upcoming service role tomorrow: {role}.{serving} Thank you for serving!');
    const filled = t.text.reminder.replace('{role}', 'Sound').replace('{serving}', '');
    assert.equal(filled,
        'This is a reminder for your upcoming service role tomorrow: Sound. Thank you for serving!');
});

test('the nudge wording is the church\'s sentence, and a saved one wins', () => {
    assert.equal(nudge.templatesForSendPath({}).text.nudge,
        'You still have not confirmed or traded your service role for {date} and it is {days} away. Please do so now: {link}');
    assert.equal(nudge.templatesForSendPath({reminderNudgeText: ' Mine {link} '}).text.nudge, 'Mine {link}');
    // The older {places} wording is not read.
    assert.equal(nudge.templatesForSendPath({nudgeText: 'Old {places}'}).text.nudge,
        nudge.templatesForSendPath({}).text.nudge);
});

test('stamping a nudge counts it; stamping a reminder marks it', () => {
    const base = {kind: 'nudge', assignment: {occurrenceId: 'o'}, personId: 'p1', today: TODAY, channel: 'text'};
    const one = nudge.stampedRecord(null, base);
    assert.equal(one.lastNudgeDate, TODAY);
    assert.equal(one.nudgeCount, 1);
    const two = nudge.stampedRecord(one, Object.assign({}, base, {today: shift(TODAY, 2)}));
    assert.equal(two.nudgeCount, 2);
    const rem = nudge.stampedRecord(two, Object.assign({}, base, {kind: 'reminder'}));
    assert.equal(rem.reminderDate, TODAY);
    assert.equal(rem.nudgeCount, 2);
});

test('the request names a Person, a purpose and a URL, never a channel', () => {
    const out = plan([occ({assignments: [row()]})]);
    const req = nudge.notifyRequest(out[0], 'https://x');
    assert.equal(req.purpose, 'assignment_nudge');
    assert.equal(req.url, 'https://x/commitments.html');
    assert.equal(req.channel, undefined);
});

test('the dates it reads run from tomorrow to 6 days out', () => {
    assert.deepEqual(nudge.lookAhead(TODAY), {from: shift(TODAY, 1), to: SUNDAY});
});

test('only sends when the admin switch is on, and it is off when unset', () => {
    assert.equal(nudge.nudgingOn({}), false);
    assert.equal(nudge.nudgingOn({nudgeEnabled: true}), true);
});

test('a date moved after a nudge keeps its record — the key is where it started', () => {
    const a = row();
    const before = occ({assignments: [a]});
    const moved = occ({id: 'sunday_service_2026-11-21', date: '2026-11-21', movedFrom: SUNDAY,
        originalDate: SUNDAY, assignments: [a]});
    assert.equal(nudge.nudgeRecordId(moved, a), nudge.nudgeRecordId(before, a));
});
