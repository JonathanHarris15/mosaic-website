const { test } = require('node:test');
const assert = require('node:assert');

const Tasks = require('../public/tasks-core.js');
const Events = require('../public/events-occurrence-core.js');

// The Task model (MS-79, sub-task MS-417) — the one place every rule about a
// Task lives. Pure over plain records and an injected clock, so the awkward
// parts can be pinned without a browser or a database.
//
// The three decisions it enforces:
//
//   ADR-0058  Finishing is the clock, not the date. An unfinished Task past its
//             date is overdue and STAYS. Missed occurrences pile up.
//   ADR-0059  A Task names its Assignees — Elders — and nobody else.
//   ADR-0060  A repeating Task is a series whose dates are COMPUTED. A missed
//             occurrence is a date the rule produced with no record against it.

const NOW = '2026-09-08T09:00:00';          // a Tuesday morning
const at = (iso) => new Date(iso).getTime();

// A one-off Task. Date required; time optional.
const task = (over) => Object.assign({
    id: 't1',
    title: 'Ring Dave',
    body: '',
    dueDate: '2026-09-10',
    dueTime: null,
    assigneeIds: [],
}, over || {});

// A Task series — the standing commitment behind a repeat.
const series = (over) => Object.assign({
    id: 's1',
    title: 'Check on the widows',
    body: '',
    assigneeIds: [],
    recurrence: {
        freq: Events.FREQ.MONTHLY,
        startDate: '2026-06-02',            // the 1st Tuesday of June
        ends: { kind: Events.ENDS.NEVER },
    },
}, over || {});

// A sparse occurrence record — only ever written when something is SAID about
// a date.
const record = (seriesId, date, over) => Object.assign({
    id: Tasks.occurrenceIdFor(seriesId, date),
    seriesId: seriesId,
    date: date,
}, over || {});

const resolve = (over) => Tasks.resolve(Object.assign({
    tasks: [],
    series: [],
    occurrences: [],
    now: at(NOW),
    from: '2026-06-01',
    to: '2026-12-31',
}, over || {}));

const titles = (list) => list.map(t => t.title);
const states = (list) => list.map(t => t.state);
const dates = (list) => list.map(t => t.dueDate);


// ── The vocabulary is the Calendar's, not a second copy ───────────────────────

test('the recurrence vocabulary is the Events core own', () => {
    assert.strictEqual(Tasks.FREQ, Events.FREQ);
    assert.strictEqual(Tasks.ENDS, Events.ENDS);
});


// ── A one-off Task ────────────────────────────────────────────────────────────

test('a Task due later today is open, not overdue', () => {
    const out = resolve({ tasks: [task({ dueDate: '2026-09-08' })] });
    assert.deepStrictEqual(states(out), [Tasks.STATES.OPEN]);
});

test('a Task with a date but no time is not overdue until the end of that day', () => {
    const justBeforeMidnight = at('2026-09-08T23:59:00');
    const out = Tasks.resolve({
        tasks: [task({ dueDate: '2026-09-08', dueTime: null })],
        series: [], occurrences: [],
        now: justBeforeMidnight, from: '2026-09-01', to: '2026-09-30',
    });
    assert.deepStrictEqual(states(out), [Tasks.STATES.OPEN]);
});

test('a Task with a time is overdue once that time has passed', () => {
    const out = resolve({ tasks: [task({ dueDate: '2026-09-08', dueTime: '08:00' })] });
    assert.deepStrictEqual(states(out), [Tasks.STATES.OVERDUE]);
});

test('a Task whose date has gone stays on the list, overdue', () => {
    const out = resolve({ tasks: [task({ dueDate: '2026-08-01' })] });
    assert.strictEqual(out.length, 1, 'it must not vanish with its date');
    assert.strictEqual(out[0].state, Tasks.STATES.OVERDUE);
});

test('a completed Task reads as done and carries the day it was completed', () => {
    const out = resolve({
        tasks: [task({ completedAt: at('2026-09-07T14:00:00'), completedBy: 'rob' })],
    });
    assert.strictEqual(out[0].state, Tasks.STATES.DONE);
    assert.strictEqual(out[0].completedOn, '2026-09-07');
});

test('a completed Task is done even when its date has long gone', () => {
    const out = resolve({
        tasks: [task({ dueDate: '2026-07-01', completedAt: at('2026-07-02T09:00:00') })],
    });
    assert.strictEqual(out[0].state, Tasks.STATES.DONE);
});

test('a Task with no due date is refused rather than shown undated', () => {
    const out = resolve({ tasks: [task({ dueDate: null })] });
    assert.deepStrictEqual(out, [], 'an undated Task has no clock, so it is not a Task');
});


// ── Repeats: the dates are computed ───────────────────────────────────────────

test('a monthly repeat produces one Task per month without any stored record', () => {
    const out = resolve({ series: [series()], occurrences: [] });
    assert.deepStrictEqual(dates(out), [
        '2026-06-02', '2026-07-07', '2026-08-04',
        '2026-09-01', '2026-10-06', '2026-11-03', '2026-12-01',
    ]);
});

test('a weekly repeat produces a Task every week', () => {
    const out = resolve({
        series: [series({ recurrence: { freq: Events.FREQ.WEEKLY, startDate: '2026-09-01', ends: { kind: Events.ENDS.NEVER } } })],
        from: '2026-09-01', to: '2026-09-30',
    });
    assert.deepStrictEqual(dates(out), ['2026-09-01', '2026-09-08', '2026-09-15', '2026-09-22', '2026-09-29']);
});

test('a fortnightly repeat skips a week', () => {
    const out = resolve({
        series: [series({ recurrence: { freq: Events.FREQ.FORTNIGHTLY, startDate: '2026-09-01', ends: { kind: Events.ENDS.NEVER } } })],
        from: '2026-09-01', to: '2026-09-30',
    });
    assert.deepStrictEqual(dates(out), ['2026-09-01', '2026-09-15', '2026-09-29']);
});

test('a repeat ending on a date stops there', () => {
    const out = resolve({
        series: [series({ recurrence: { freq: Events.FREQ.MONTHLY, startDate: '2026-06-02', ends: { kind: Events.ENDS.ON_DATE, date: '2026-08-31' } } })],
    });
    assert.deepStrictEqual(dates(out), ['2026-06-02', '2026-07-07', '2026-08-04']);
});

test('a repeat ending after a count stops there, counted from its start', () => {
    const out = resolve({
        series: [series({ recurrence: { freq: Events.FREQ.MONTHLY, startDate: '2026-06-02', ends: { kind: Events.ENDS.AFTER_COUNT, count: 2 } } })],
    });
    assert.deepStrictEqual(dates(out), ['2026-06-02', '2026-07-07']);
});

test('a repeat asked for a later window does not restart its count', () => {
    const out = resolve({
        series: [series({ recurrence: { freq: Events.FREQ.MONTHLY, startDate: '2026-06-02', ends: { kind: Events.ENDS.AFTER_COUNT, count: 2 } } })],
        from: '2026-08-01', to: '2026-12-31',
    });
    assert.deepStrictEqual(dates(out), []);
});


// ── Missed occurrences pile up (ADR-0058) ─────────────────────────────────────

test('three missed monthly occurrences all appear, each overdue', () => {
    const out = resolve({ series: [series()], to: '2026-09-08' })
        .filter(t => t.state === Tasks.STATES.OVERDUE);
    assert.deepStrictEqual(dates(out), ['2026-06-02', '2026-07-07', '2026-08-04', '2026-09-01']);
    assert.strictEqual(out.length, 4, 'a missed repeat must not forgive itself');
});

test('a missed occurrence needs no stored record to be overdue', () => {
    const out = resolve({ series: [series()], occurrences: [], to: '2026-09-08' });
    assert.ok(out.some(t => t.dueDate === '2026-07-07' && t.state === Tasks.STATES.OVERDUE));
});

test('completing one occurrence leaves the others alone', () => {
    const out = resolve({
        series: [series()],
        occurrences: [record('s1', '2026-07-07', { completedAt: at('2026-07-08T10:00:00') })],
        to: '2026-09-08',
    });
    const july = out.find(t => t.dueDate === '2026-07-07');
    const august = out.find(t => t.dueDate === '2026-08-04');
    assert.strictEqual(july.state, Tasks.STATES.DONE);
    assert.strictEqual(august.state, Tasks.STATES.OVERDUE);
});


// ── A skip is not a tick ──────────────────────────────────────────────────────

test('a skipped occurrence reads as skipped, not done', () => {
    const out = resolve({
        series: [series()],
        occurrences: [record('s1', '2026-08-04', { skippedAt: at('2026-08-01T10:00:00') })],
        to: '2026-09-08',
    });
    const august = out.find(t => t.dueDate === '2026-08-04');
    assert.strictEqual(august.state, Tasks.STATES.SKIPPED);
});

test('a skipped occurrence is not counted as completed work', () => {
    const out = resolve({
        series: [series()],
        occurrences: [record('s1', '2026-08-04', { skippedAt: at('2026-08-01T10:00:00') })],
        to: '2026-09-08',
    });
    assert.deepStrictEqual(Tasks.completed(out).map(t => t.dueDate), []);
});


// ── One occurrence may override the series, and only in named ways ────────────

test('a series change reaches an occurrence that has not overridden it', () => {
    const out = resolve({
        series: [series({ title: 'Check on the widows monthly', assigneeIds: ['rob'] })],
        occurrences: [record('s1', '2026-07-07', {})],
        to: '2026-09-08',
    });
    const july = out.find(t => t.dueDate === '2026-07-07');
    assert.strictEqual(july.title, 'Check on the widows monthly');
    assert.deepStrictEqual(july.assigneeIds, ['rob']);
});

test('an occurrence that was reassigned keeps its own assignees', () => {
    const out = resolve({
        series: [series({ assigneeIds: ['rob'] })],
        occurrences: [record('s1', '2026-07-07', { assigneeIds: ['carl'] })],
        to: '2026-09-08',
    });
    const july = out.find(t => t.dueDate === '2026-07-07');
    const august = out.find(t => t.dueDate === '2026-08-04');
    assert.deepStrictEqual(july.assigneeIds, ['carl'], 'Rob takes this month');
    assert.deepStrictEqual(august.assigneeIds, ['rob'], 'and only this month');
});

test('an occurrence nudged to another day moves, and only that one moves', () => {
    const out = resolve({
        series: [series()],
        occurrences: [record('s1', '2026-08-04', { movedTo: '2026-08-11' })],
        to: '2026-09-08',
    });
    assert.ok(!dates(out).includes('2026-08-04'), 'it left its original day');
    assert.ok(dates(out).includes('2026-08-11'), 'and arrived at the new one');
    assert.ok(dates(out).includes('2026-07-07'), 'July is untouched');
});

test('a series never overrides a title an occurrence set for itself', () => {
    const out = resolve({
        series: [series({ title: 'Check on the widows' })],
        occurrences: [record('s1', '2026-07-07', { title: 'Check on the widows, and the Hall boiler' })],
        to: '2026-09-08',
    });
    const july = out.find(t => t.dueDate === '2026-07-07');
    assert.strictEqual(july.title, 'Check on the widows, and the Hall boiler');
});


// ── A stopped series keeps what was already done ──────────────────────────────

test('a stopped series still shows the occurrences that were completed', () => {
    const out = resolve({
        series: [series({ stoppedOn: '2026-08-01' })],
        occurrences: [record('s1', '2026-07-07', { completedAt: at('2026-07-08T10:00:00') })],
        to: '2026-12-31',
    });
    assert.deepStrictEqual(dates(out), ['2026-06-02', '2026-07-07'], 'the future stops, the past stays');
    assert.strictEqual(out.find(t => t.dueDate === '2026-07-07').state, Tasks.STATES.DONE);
});


// ── The Assignee is an Elder and nothing else (ADR-0059) ──────────────────────

test('a Task carries assignees and nothing about who it is about', () => {
    const out = resolve({ tasks: [task({ assigneeIds: ['rob', 'carl'] })] });
    assert.deepStrictEqual(out[0].assigneeIds, ['rob', 'carl']);
    assert.ok(!('personIds' in out[0]), 'a Task has no people it is about');
    assert.ok(!('mentions' in out[0]), 'a Task has no people it is about');
});

test('a Task with no assignees is unassigned, which is a real state', () => {
    const out = resolve({ tasks: [task({ assigneeIds: [] })] });
    assert.strictEqual(out[0].isUnassigned, true);
});


// ── The dashboard panel slice ─────────────────────────────────────────────────

test('the panel shows yours, the unassigned, and anything overdue', () => {
    const out = resolve({
        tasks: [
            task({ id: 'mine', title: 'Mine', assigneeIds: ['rob'] }),
            task({ id: 'theirs', title: 'Theirs', assigneeIds: ['carl'] }),
            task({ id: 'nobody', title: 'Nobody picked up', assigneeIds: [] }),
            task({ id: 'late', title: 'Late and theirs', assigneeIds: ['carl'], dueDate: '2026-08-01' }),
        ],
    });
    const panel = Tasks.panelFor(out, 'rob', at(NOW));
    assert.deepStrictEqual(titles(panel).sort(), ['Late and theirs', 'Mine', 'Nobody picked up']);
});

test('the panel keeps a Task completed today, struck through', () => {
    const out = resolve({
        tasks: [task({ assigneeIds: ['rob'], completedAt: at('2026-09-08T08:00:00') })],
    });
    const panel = Tasks.panelFor(out, 'rob', at(NOW));
    assert.strictEqual(panel.length, 1);
    assert.strictEqual(panel[0].state, Tasks.STATES.DONE);
});

test('the panel drops a Task completed yesterday', () => {
    const out = resolve({
        tasks: [task({ assigneeIds: ['rob'], completedAt: at('2026-09-07T08:00:00') })],
    });
    assert.deepStrictEqual(Tasks.panelFor(out, 'rob', at(NOW)), []);
});

test('the panel never shows a skipped occurrence', () => {
    const out = resolve({
        series: [series({ assigneeIds: ['rob'] })],
        occurrences: [record('s1', '2026-09-01', { skippedAt: at('2026-08-30T10:00:00') })],
        to: '2026-09-08',
    });
    const panel = Tasks.panelFor(out, 'rob', at(NOW));
    assert.ok(!panel.some(t => t.dueDate === '2026-09-01'));
});


// ── The completed window the page opens on ────────────────────────────────────

test('completed work is listed newest first', () => {
    const out = resolve({
        tasks: [
            task({ id: 'a', title: 'Older', completedAt: at('2026-09-01T10:00:00') }),
            task({ id: 'b', title: 'Newer', completedAt: at('2026-09-06T10:00:00') }),
        ],
    });
    assert.deepStrictEqual(titles(Tasks.completed(out)), ['Newer', 'Older']);
});

test('completed work can be limited to a window of days', () => {
    const out = resolve({
        tasks: [
            task({ id: 'a', title: 'Within', completedAt: at('2026-09-01T10:00:00') }),
            task({ id: 'b', title: 'Long ago', completedAt: at('2026-06-01T10:00:00') }),
        ],
    });
    assert.deepStrictEqual(titles(Tasks.completed(out, { since: at('2026-08-09T09:00:00') })), ['Within']);
});


// ── Ordering, so the list reads the way an elder needs it ─────────────────────

test('overdue comes first, then soonest', () => {
    const out = resolve({
        tasks: [
            task({ id: 'c', title: 'Next week', dueDate: '2026-09-15' }),
            task({ id: 'b', title: 'Thursday', dueDate: '2026-09-10' }),
            task({ id: 'a', title: 'Late', dueDate: '2026-08-01' }),
        ],
    });
    assert.deepStrictEqual(titles(out), ['Late', 'Thursday', 'Next week']);
});


// ── Ids are deterministic, so two elders cannot make the same occurrence ──────

test('an occurrence id is derived from its series and date', () => {
    assert.strictEqual(Tasks.occurrenceIdFor('s1', '2026-08-04'), Tasks.occurrenceIdFor('s1', '2026-08-04'));
    assert.notStrictEqual(Tasks.occurrenceIdFor('s1', '2026-08-04'), Tasks.occurrenceIdFor('s1', '2026-09-01'));
});
