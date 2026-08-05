const { test } = require('node:test');
const assert = require('node:assert');

// An Event that runs over several days — a half-term, a conference, a week away.
//
// `date` is the first day and `endDate` the last, INCLUSIVE. Three things have
// to hold, and each of them has broken something real:
//
//   1. A span belongs to a one-off and to nothing else. On a date of a series it
//      is the trap `time` and `seriesColour` were pulled out of.
//   2. A database range query on `date` alone MISSES a run that started before
//      the window. That is why the read widens and the overlap is settled here.
//   3. A run moves as a whole. Shifting the first day and leaving the last is a
//      run that ends before it starts, which the model then reads as no run.

const Core = require('../public/events-occurrence-core.js');
const View = require('../public/calendar-view.js');

const oneOff = (extra) => Object.assign({
    id: 'abc', seriesId: null, date: '2026-11-23', name: 'Thanksgiving Break',
}, extra || {});

// ── What counts as a span ─────────────────────────────────────────────────────

test('an Event with no end date is a single day', () => {
    const o = oneOff();
    assert.strictEqual(Core.endDateOf(o), null);
    assert.strictEqual(Core.isMultiDay(o), false);
    assert.strictEqual(Core.spanLength(o), 1);
    assert.deepStrictEqual(Core.spanDates(o), ['2026-11-23']);
});

test('a span is inclusive of both ends', () => {
    // 23rd to 27th is five days. An exclusive end would make every event read a
    // day short to whoever typed it.
    const o = oneOff({ endDate: '2026-11-27' });
    assert.strictEqual(Core.spanLength(o), 5);
    assert.deepStrictEqual(Core.spanDates(o), [
        '2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27',
    ]);
});

test('an end date equal to the start is not a span', () => {
    // A one-day event is just an event. Reported as no span so no caller has to
    // decide whether "23rd to 23rd" means one day or two.
    const o = oneOff({ endDate: '2026-11-23' });
    assert.strictEqual(Core.endDateOf(o), null);
    assert.strictEqual(Core.spanLength(o), 1);
});

test('an end date before the start is refused, not stored backwards', () => {
    const o = oneOff({ endDate: '2026-11-20' });
    assert.strictEqual(Core.endDateOf(o), null);
    assert.match(Core.spanError(o), /before the first day/);
});

test('a span longer than the cap is refused', () => {
    // The usual cause is a typo in the year, which would otherwise paint a
    // calendar solid.
    const o = oneOff({ endDate: '2027-11-27' });
    assert.strictEqual(Core.endDateOf(o), null);
    assert.match(Core.spanError(o), /cannot run longer than/);
});

test('a span exactly at the cap is allowed', () => {
    const o = oneOff({ date: '2026-01-01', endDate: '2026-03-01' });  // 60 days
    assert.strictEqual(Core.spanLength(o), Core.MAX_SPAN_DAYS);
    assert.strictEqual(Core.spanError(o), null);
});

test('a span crossing a year boundary counts correctly', () => {
    const o = oneOff({ date: '2026-12-28', endDate: '2027-01-03' });
    assert.strictEqual(Core.spanLength(o), 7);
    assert.strictEqual(Core.spanDates(o).length, 7);
});

// ── A span belongs to a one-off ───────────────────────────────────────────────

test('one date of a series cannot run over several days', () => {
    // How long an Event runs is true of every date of it, so on a repeating
    // Event it belongs beside the pattern. Written on one date it would be
    // indistinguishable from a deliberate choice about that date, and the series
    // could never move it again.
    const o = { seriesId: 'midweek', date: '2026-11-23', endDate: '2026-11-27' };
    assert.strictEqual(Core.endDateOf(o), null);
    assert.match(Core.spanError(o), /true of every date/);
});

// ── Covering a day, and overlapping a window ──────────────────────────────────

test('a run is on for every day it covers, and none either side', () => {
    const o = oneOff({ endDate: '2026-11-27' });
    assert.strictEqual(Core.coversDate(o, '2026-11-22'), false);
    assert.strictEqual(Core.coversDate(o, '2026-11-23'), true);
    assert.strictEqual(Core.coversDate(o, '2026-11-25'), true);
    assert.strictEqual(Core.coversDate(o, '2026-11-27'), true);
    assert.strictEqual(Core.coversDate(o, '2026-11-28'), false);
});

test('a run that STARTS before a window still overlaps it', () => {
    // The whole reason `date >= from` is not enough. A break running 28 December
    // to 3 January is on for three days of January, and a plain range query on
    // the stored date would drop it from January entirely.
    const o = oneOff({ date: '2026-12-28', endDate: '2027-01-03' });
    assert.strictEqual(Core.overlapsRange(o, '2027-01-01', '2027-01-31'), true);
});

test('a single-day Event outside the window does not overlap it', () => {
    const o = oneOff({ date: '2026-12-28' });
    assert.strictEqual(Core.overlapsRange(o, '2027-01-01', '2027-01-31'), false);
});

test('a run that ends before the window does not overlap it', () => {
    const o = oneOff({ date: '2026-11-23', endDate: '2026-11-27' });
    assert.strictEqual(Core.overlapsRange(o, '2026-12-01', '2026-12-31'), false);
});

test('a run that starts after the window does not overlap it', () => {
    const o = oneOff({ date: '2027-02-01', endDate: '2027-02-05' });
    assert.strictEqual(Core.overlapsRange(o, '2027-01-01', '2027-01-31'), false);
});

// ── The month grid ────────────────────────────────────────────────────────────

test('a run appears in every cell it covers, once each', () => {
    const o = oneOff({ endDate: '2026-11-27' });
    const cells = View.monthGrid('2026-11', [o], '2026-11-01');
    const on = cells.filter(c => c.events.length);

    assert.deepStrictEqual(on.map(c => c.date), [
        '2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27',
    ]);
    on.forEach(c => assert.strictEqual(c.events.length, 1));
});

test('only the first cell of a run is not a continuation', () => {
    // Which is what stops five days of one break reading as five breaks.
    const o = oneOff({ endDate: '2026-11-27' });
    const on = View.monthGrid('2026-11', [o], '2026-11-01').filter(c => c.events.length);

    assert.strictEqual(on[0].events[0].spanContinues, false);
    assert.strictEqual(on[0].events[0].spanStart, true);
    assert.strictEqual(on[1].events[0].spanContinues, true);
    assert.strictEqual(on[4].events[0].spanEnd, true);
    assert.deepStrictEqual(on.map(c => c.events[0].spanDay), [1, 2, 3, 4, 5]);
});

test('a run reaching into a month draws in it, even though it started elsewhere', () => {
    const o = oneOff({ date: '2026-12-28', endDate: '2027-01-03' });
    const on = View.monthGrid('2027-01', [o], '2027-01-01')
        .filter(c => c.inMonth && c.events.length);
    assert.deepStrictEqual(on.map(c => c.date), ['2027-01-01', '2027-01-02', '2027-01-03']);
});

test('a single-day Event is untouched by any of this', () => {
    // No span keys added, so nothing downstream can start branching on them.
    const o = oneOff();
    const on = View.monthGrid('2026-11', [o], '2026-11-01').filter(c => c.events.length);
    assert.strictEqual(on.length, 1);
    assert.strictEqual(on[0].events[0], o);
});

// ── The sentences ─────────────────────────────────────────────────────────────

test('a span within one month says the month once', () => {
    assert.strictEqual(
        View.spanSentence(oneOff({ endDate: '2026-11-27' })),
        '23–27 November'
    );
});

test('a span across two months says both', () => {
    assert.strictEqual(
        View.spanSentence(oneOff({ date: '2026-12-28', endDate: '2027-01-03' })),
        '28 December – 3 January'
    );
});

test('a single-day Event has no span sentence at all', () => {
    // The date is already on the row; "15 July – 15 July" is noise.
    assert.strictEqual(View.spanSentence(oneOff()), '');
    assert.strictEqual(View.spanLengthSentence(oneOff()), '');
});

test('the length reads in days', () => {
    assert.strictEqual(View.spanLengthSentence(oneOff({ endDate: '2026-11-27' })), '5 days');
    assert.strictEqual(View.spanLengthSentence(oneOff({ endDate: '2026-11-24' })), '2 days');
});

test('a cell in the middle of a run says which day it is', () => {
    const o = oneOff({ endDate: '2026-11-27' });
    const on = View.monthGrid('2026-11', [o], '2026-11-01').filter(c => c.events.length);
    assert.strictEqual(View.spanDayLabel(on[2].events[0]), 'Day 3 of 5');
    assert.strictEqual(View.spanDayLabel(o), '');
});
