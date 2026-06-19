const { test } = require('node:test');
const assert = require('node:assert');

const D = require('../public/date-utils.js');

// Service dates are local YYYY-MM-DD keys. These pin the format, the local-time
// round-trip, and week arithmetic across month/year boundaries — the behaviour
// that was copied inline across service-calendar.js and service-builder.js.

test('toDateStr zero-pads month and day from a local Date', () => {
    assert.strictEqual(D.toDateStr(new Date(2026, 0, 5)), '2026-01-05');   // Jan 5
    assert.strictEqual(D.toDateStr(new Date(2026, 11, 25)), '2026-12-25'); // Dec 25
});

test('parseDateStr is the local-time inverse of toDateStr', () => {
    const key = '2026-06-14';
    const dt = D.parseDateStr(key);
    assert.strictEqual(dt.getFullYear(), 2026);
    assert.strictEqual(dt.getMonth(), 5); // June (0-based)
    assert.strictEqual(dt.getDate(), 14);
    assert.strictEqual(D.toDateStr(dt), key); // round-trips
});

test('parseDateStr stays local — no UTC/midnight day-shift', () => {
    // toISOString() would render the day before for west-of-GMT zones; the local
    // round-trip must not. Whatever the runner's TZ, the key is preserved.
    for (const key of ['2026-01-01', '2026-03-08', '2026-11-01', '2026-12-31']) {
        assert.strictEqual(D.toDateStr(D.parseDateStr(key)), key);
    }
});

test('addDays moves forward and backward', () => {
    assert.strictEqual(D.addDays('2026-06-14', 7), '2026-06-21');
    assert.strictEqual(D.addDays('2026-06-14', -1), '2026-06-13');
});

test('addDays crosses month and year boundaries', () => {
    assert.strictEqual(D.addDays('2026-01-31', 1), '2026-02-01');
    assert.strictEqual(D.addDays('2026-12-31', 1), '2027-01-01');
    assert.strictEqual(D.addDays('2026-03-01', -1), '2026-02-28');
});

test('addWeek steps exactly seven days (Sunday to Sunday)', () => {
    assert.strictEqual(D.addWeek('2026-06-14'), '2026-06-21');
    assert.strictEqual(D.addWeek('2026-12-27'), '2027-01-03');
});

test('todayStr matches toDateStr(now) and is well-formed', () => {
    assert.match(D.todayStr(), /^\d{4}-\d{2}-\d{2}$/);
});

test('formatDateLong renders a long label and tolerates empty input', () => {
    assert.strictEqual(D.formatDateLong(''), '');
    const label = D.formatDateLong('2026-06-14', 'en-US');
    assert.match(label, /June/);
    assert.match(label, /2026/);
    assert.match(label, /14/);
});

test('upcomingSundays keeps today-or-later, drops past, preserves order', () => {
    const sundays = [
        new Date(2026, 5, 7),   // past
        new Date(2026, 5, 14),  // == fromDate day
        new Date(2026, 5, 21),  // future
    ];
    const from = new Date(2026, 5, 14, 9, 30); // time-of-day ignored
    const out = D.upcomingSundays(sundays, from);
    assert.deepStrictEqual(out.map(s => s.value), ['2026-06-14', '2026-06-21']);
    assert.ok(out.every(s => typeof s.label === 'string' && s.label.length > 0));
});

test('upcomingSundays tolerates an empty list', () => {
    assert.deepStrictEqual(D.upcomingSundays([], new Date(2026, 0, 1)), []);
    assert.deepStrictEqual(D.upcomingSundays(null, new Date(2026, 0, 1)), []);
});
