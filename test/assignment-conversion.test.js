const { test } = require('node:test');
const assert = require('node:assert');

// MS-151 — the rules that turn plans into history.
//
// An Assignment is the plan; an Involvement is the fact. Before this, assigning
// somebody wrote a serve record immediately — including for a Sunday six weeks
// away — so the serve log already counted serving that had not happened.

const ac = require('../functions/assignment-conversion.js');
const Core = require('../public/events-occurrence-core.js');

const occurrenceWith = assignments => ({
    id: 'midweek_2026-07-01', seriesId: 'midweek', date: '2026-07-01', assignments,
});

const assignment = (personId, state, extra) => Object.assign({
    personId, roleSlug: 'kids', slotId: 's1', state,
}, extra || {});

// ── The three rules ───────────────────────────────────────────────────────────

test('a Confirmed assignment becomes an Involvement record', () => {
    const { serves } = ac.conversion(occurrenceWith([assignment('p1', ac.STATES.CONFIRMED)]));

    assert.strictEqual(serves.length, 1);
    assert.strictEqual(serves[0].personId, 'p1');
    assert.strictEqual(serves[0].type, 'kids');
    assert.strictEqual(serves[0].serviceDate, '2026-07-01');
});

test('a Declined assignment never produces one, and is never a question either', () => {
    const { serves, questions } = ac.conversion(occurrenceWith([assignment('p1', ac.STATES.DECLINED)]));
    assert.deepStrictEqual(serves, []);
    assert.deepStrictEqual(questions, [], 'they told us — there is nothing to ask');
});

test('a Pending assignment produces none either, but stays available as a question', () => {
    const { serves, questions } = ac.conversion(occurrenceWith([assignment('p1', ac.STATES.PENDING)]));
    assert.deepStrictEqual(serves, []);
    assert.strictEqual(questions.length, 1);
    assert.strictEqual(questions[0].personId, 'p1');
});

test('an assignment with no state at all reads as Pending, not as a serve', () => {
    const { serves, questions } = ac.conversion(occurrenceWith([{ personId: 'p1', roleSlug: 'kids', slotId: 's1' }]));
    assert.deepStrictEqual(serves, []);
    assert.strictEqual(questions.length, 1);
});

test('an unresolved question never becomes a serve record, however many runs pass', () => {
    const occurrence = occurrenceWith([assignment('p1', ac.STATES.PENDING)]);
    for (let i = 0; i < 365; i++) {
        assert.deepStrictEqual(ac.conversion(occurrence).serves, [],
            'silence is never counted as a yes');
    }
});

test('an Event with no assignments converts to nothing, without error', () => {
    assert.deepStrictEqual(ac.conversion(occurrenceWith([])).serves, []);
    assert.deepStrictEqual(ac.conversion({ date: '2026-07-01' }).serves, []);
    assert.deepStrictEqual(ac.conversion(undefined).questions, []);
});

// ── The record itself ─────────────────────────────────────────────────────────

test('an Involvement record carries the Event series it belonged to', () => {
    // Fairness is counted per series, so somebody can be overdue for Sunday
    // setup and fresh for a midweek Role at the same time.
    const { serves } = ac.conversion(occurrenceWith([assignment('p1', ac.STATES.CONFIRMED)]));
    assert.strictEqual(serves[0].seriesId, 'midweek');
});

test('an Involvement with no series on the occurrence reads as the Sunday Service', () => {
    const { serves } = ac.conversion({
        id: 'x', date: '2026-07-01',
        assignments: [assignment('p1', ac.STATES.CONFIRMED)],
    });
    assert.strictEqual(serves[0].seriesId, ac.SUNDAY_SERVICE_ID);
});

test('a one-off Role writes under the reserved slug with its label preserved', () => {
    const { serves } = ac.conversion(occurrenceWith([
        assignment('p3', ac.STATES.CONFIRMED, {
            roleSlug: ac.ONE_OFF_SLUG, slotId: null, oneOffId: 'o1', label: 'Unlock the hall',
        }),
    ]));

    assert.strictEqual(serves[0].type, 'one_off',
        'an invented slug would resolve to nothing on every serve-history surface');
    assert.strictEqual(serves[0].metadata.label, 'Unlock the hall');
});

test('a managed Role carries no one-off metadata', () => {
    const { serves } = ac.conversion(occurrenceWith([assignment('p1', ac.STATES.CONFIRMED)]));
    assert.strictEqual(serves[0].metadata, undefined);
});

// ── Running twice ─────────────────────────────────────────────────────────────

test('running the job twice does not create duplicate records', () => {
    const occurrence = occurrenceWith([assignment('p1', ac.STATES.CONFIRMED)]);
    const first = ac.conversion(occurrence).serves[0];
    const second = ac.conversion(occurrence).serves[0];

    assert.strictEqual(first.involvementId, second.involvementId,
        'the id is derived, so the second write lands on the same document');
    assert.ok(first.involvementId);
});

test('one person holding two Roles at one Event gets two records, not one', () => {
    const { serves } = ac.conversion(occurrenceWith([
        assignment('p1', ac.STATES.CONFIRMED, { roleSlug: 'kids', slotId: 's1' }),
        assignment('p1', ac.STATES.CONFIRMED, { roleSlug: 'setup', slotId: 's1' }),
    ]));

    assert.strictEqual(serves.length, 2);
    assert.notStrictEqual(serves[0].involvementId, serves[1].involvementId);
});

test('two people in different slots of one Role get separate records', () => {
    const { serves } = ac.conversion(occurrenceWith([
        assignment('p1', ac.STATES.CONFIRMED, { slotId: 's1' }),
        assignment('p2', ac.STATES.CONFIRMED, { slotId: 's2' }),
    ]));
    assert.notStrictEqual(serves[0].involvementId, serves[1].involvementId);
});

// ── "The date has passed" means passed in the church's timezone ──────────────

test('the church timezone decides the date, not the server', () => {
    // Late evening church-local is already tomorrow in UTC. A job running then
    // must not think the day has turned and convert an Event that is still
    // happening. Checked on both sides of daylight saving, because the offset
    // that makes this right in July is not the one that makes it right in
    // January — hardcoding either would be the bug.

    // Summer, CDT (UTC-5): midnight church-local is 05:00 UTC.
    assert.strictEqual(ac.churchToday(new Date('2026-07-02T04:30:00Z')), '2026-07-01');
    assert.strictEqual(ac.churchToday(new Date('2026-07-02T05:30:00Z')), '2026-07-02');

    // Winter, CST (UTC-6): midnight church-local is 06:00 UTC.
    assert.strictEqual(ac.churchToday(new Date('2026-01-02T05:30:00Z')), '2026-01-01');
    assert.strictEqual(ac.churchToday(new Date('2026-01-02T06:30:00Z')), '2026-01-02');
});

test('an Event happening today has not passed', () => {
    assert.strictEqual(ac.hasPassed('2026-07-01', '2026-07-01'), false,
        'converting an Event mid-flight is the very bug this job exists to fix');
    assert.strictEqual(ac.hasPassed('2026-07-02', '2026-07-01'), false, 'nor a future one');
    assert.strictEqual(ac.hasPassed('2026-06-30', '2026-07-01'), true);
    assert.strictEqual(ac.hasPassed(null, '2026-07-01'), false);
});

test('the conversion window ends strictly before today', () => {
    const w = ac.conversionWindow(new Date('2026-07-10T12:00:00Z'));
    assert.strictEqual(w.today, '2026-07-10');
    assert.strictEqual(w.to, '2026-07-09');
    assert.ok(w.to < w.today);
});

test('the conversion window looks back far enough to survive a missed run', () => {
    const w = ac.conversionWindow(new Date('2026-07-10T12:00:00Z'));
    assert.strictEqual(w.from, '2026-05-26');
    assert.ok(ac.LOOKBACK_DAYS >= 30, 'a week-long outage must not lose a month of serving');
});

test('date arithmetic crosses a month and a year boundary correctly', () => {
    assert.strictEqual(ac.shiftDate('2026-03-01', -1), '2026-02-28');
    assert.strictEqual(ac.shiftDate('2024-03-01', -1), '2024-02-29');
    assert.strictEqual(ac.shiftDate('2026-01-01', -1), '2025-12-31');
});

// ── Kept honest against the browser's copy ────────────────────────────────────

test('the server and the browser agree on what converts', () => {
    // Cloud Functions deploy only the functions/ directory, so the browser module
    // cannot be required from there and the rules are stated twice. A duplicated
    // domain rule is a rule that can drift — and drift here means the serve log
    // lies about who served.
    const cases = [
        [assignment('p1', 'confirmed')],
        [assignment('p1', 'declined')],
        [assignment('p1', 'pending')],
        [{ personId: 'p1', roleSlug: 'kids', slotId: 's1' }],
        [
            assignment('p1', 'confirmed'),
            assignment('p2', 'declined', { slotId: 's2' }),
            assignment('p3', 'pending', { slotId: 's3' }),
        ],
        [assignment('p3', 'confirmed', {
            roleSlug: 'one_off', slotId: null, oneOffId: 'o1', label: 'Unlock the hall',
        })],
        [],
    ];

    cases.forEach((assignments, i) => {
        const occurrence = occurrenceWith(assignments);
        assert.deepStrictEqual(
            ac.conversion(occurrence).serves,
            Core.conversion(occurrence).serves,
            'serve records disagree for case ' + i
        );
        assert.deepStrictEqual(
            ac.conversion(occurrence).questions.map(q => q.personId),
            Core.conversion(occurrence).questions.map(q => q.personId),
            'open questions disagree for case ' + i
        );
    });
});

test('the server and the browser agree on the vocabulary', () => {
    assert.deepStrictEqual(ac.STATES, Core.STATES);
    assert.strictEqual(ac.ONE_OFF_SLUG, Core.ONE_OFF_SLUG);
    assert.strictEqual(ac.SUNDAY_SERVICE_ID, Core.SUNDAY_SERVICE_ID);
});

test('the server and the browser derive the same Involvement id', () => {
    // If these ever diverged, the "did they serve?" surface and the scheduled job
    // would write the same serving twice under two different ids.
    const occurrence = occurrenceWith([]);
    const a = assignment('p1', 'confirmed');
    assert.strictEqual(ac.involvementIdFor(occurrence, a), Core.involvementIdFor(occurrence, a));
});
