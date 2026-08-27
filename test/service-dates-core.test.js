// Which Sundays does the app recognise?
//
// Nothing owned that answer. The Services list built its own run of Sundays
// inside a page-load handler; the document importer kept its own copy of the
// date the church's records start on; and now the Order of Service page needs
// to answer "what is the Sunday after this one" so its arrows know where to go
// and when to grey out. Three surfaces, three chances to disagree about the
// same fact.
//
// So one module owns the range: where it starts, how far ahead it reaches, and
// how to step through it. Dates in, dates out — no database, no page, which is
// what makes it worth pinning properly.
//
// Two things these tests are careful about:
//
//   1. LOCAL TIME. A service date is a local calendar day (see date-utils.js).
//      Step it through a daylight-saving boundary with UTC arithmetic and a
//      Sunday quietly becomes a Saturday for everyone west of GMT. The step
//      must be exactly seven calendar days, every time.
//
//   2. THE CLOCK IS AN ARGUMENT. The far end of the range is two years out,
//      which means it moves. The module is told what today is rather than
//      reading it, so these tests are not time-bombs.

const { test } = require('node:test');
const assert = require('node:assert');

const ServiceDates = require('../public/service-dates-core.js');
const DateUtils = require('../public/date-utils.js');

// A Sunday comfortably inside the range, and the day the screenshots were taken.
const A_SUNDAY = '2026-08-30';

test('the range starts on the first Sunday the church has records for', () => {
    assert.strictEqual(ServiceDates.FIRST_SUNDAY, '2023-07-09');
});

test('next is the Sunday seven days later, previous the Sunday seven days earlier', () => {
    assert.strictEqual(ServiceDates.next(A_SUNDAY, A_SUNDAY), '2026-09-06');
    assert.strictEqual(ServiceDates.previous(A_SUNDAY, A_SUNDAY), '2026-08-23');
});

test('stepping forward and back again returns where it started', () => {
    const there = ServiceDates.next(A_SUNDAY, A_SUNDAY);
    assert.strictEqual(ServiceDates.previous(there, A_SUNDAY), A_SUNDAY);
});

test('there is nothing before the first Sunday', () => {
    assert.strictEqual(ServiceDates.previous(ServiceDates.FIRST_SUNDAY, A_SUNDAY), null);
});

test('the first Sunday still has a Sunday after it', () => {
    assert.strictEqual(ServiceDates.next(ServiceDates.FIRST_SUNDAY, A_SUNDAY), '2023-07-16');
});

test('there is nothing after the last Sunday in range', () => {
    const last = ServiceDates.horizon(A_SUNDAY);
    assert.strictEqual(ServiceDates.next(last, A_SUNDAY), null);
    assert.strictEqual(ServiceDates.previous(last, A_SUNDAY), DateUtils.addDays(last, -7));
});

test('the far end is the last Sunday on or before two years from today', () => {
    // 30 Aug 2026 is a Sunday; 30 Aug 2028 is a Wednesday, so the range stops
    // on the Sunday before it.
    assert.strictEqual(ServiceDates.horizon('2026-08-30'), '2028-08-27');
});

test('the far end is computed from the day it is given, not from the clock', () => {
    assert.notStrictEqual(ServiceDates.horizon('2026-08-30'), ServiceDates.horizon('2027-08-30'));
    assert.strictEqual(ServiceDates.horizon('2024-01-07'), ServiceDates.horizon('2024-01-07'));
});

test('a step across a daylight-saving boundary is still exactly seven days', () => {
    // US daylight saving began 8 Mar 2026 and ended 1 Nov 2026.
    assert.strictEqual(ServiceDates.next('2026-03-01', A_SUNDAY), '2026-03-08');
    assert.strictEqual(ServiceDates.next('2026-10-25', A_SUNDAY), '2026-11-01');
    assert.strictEqual(ServiceDates.previous('2026-03-08', A_SUNDAY), '2026-03-01');
    assert.strictEqual(ServiceDates.previous('2026-11-01', A_SUNDAY), '2026-10-25');
});

test('every Sunday it produces really is a Sunday', () => {
    const sundays = ServiceDates.all(A_SUNDAY);
    for (const date of sundays) {
        assert.strictEqual(DateUtils.parseDateStr(date).getDay(), 0, `${date} is not a Sunday`);
    }
});

test('the whole range runs from the first Sunday to the far end, seven days at a time', () => {
    const sundays = ServiceDates.all(A_SUNDAY);

    assert.strictEqual(sundays[0], ServiceDates.FIRST_SUNDAY);
    assert.strictEqual(sundays[sundays.length - 1], ServiceDates.horizon(A_SUNDAY));

    for (let i = 1; i < sundays.length; i++) {
        assert.strictEqual(sundays[i], DateUtils.addDays(sundays[i - 1], 7),
            `${sundays[i]} is not seven days after ${sundays[i - 1]}`);
    }
});

test('the range covers today, so the list always reaches the Sunday coming up', () => {
    const sundays = ServiceDates.all(A_SUNDAY);
    assert.ok(sundays.includes(A_SUNDAY));
});

test('a date inside the range is recognised; one outside it is not', () => {
    assert.ok(ServiceDates.contains(A_SUNDAY, A_SUNDAY));
    assert.ok(ServiceDates.contains(ServiceDates.FIRST_SUNDAY, A_SUNDAY));
    assert.ok(ServiceDates.contains(ServiceDates.horizon(A_SUNDAY), A_SUNDAY));

    assert.ok(!ServiceDates.contains('2023-07-02', A_SUNDAY));
    assert.ok(!ServiceDates.contains(DateUtils.addDays(ServiceDates.horizon(A_SUNDAY), 7), A_SUNDAY));
});

test('a missing or malformed date has no neighbours rather than throwing', () => {
    assert.strictEqual(ServiceDates.next(null, A_SUNDAY), null);
    assert.strictEqual(ServiceDates.previous(undefined, A_SUNDAY), null);
    assert.strictEqual(ServiceDates.next('', A_SUNDAY), null);
    assert.strictEqual(ServiceDates.previous('not-a-date', A_SUNDAY), null);
});

// The whole reason this module exists: the church's first Sunday used to be
// typed out by hand in the Services list and again in the document importer,
// with nothing keeping the two honest. If it reappears anywhere else, this
// fails — which is cheaper than finding out when the two disagree.
test('the first Sunday is written down in exactly one place', () => {
    const fs = require('node:fs');
    const path = require('node:path');

    const roots = ['public', 'public/mobile', 'functions', 'scripts'];
    const spellings = [
        /\b2023-07-09\b/,
        /new Date\(\s*2023\s*,\s*6\s*,\s*9\s*\)/,
    ];

    const offenders = [];
    for (const root of roots) {
        const dir = path.join(__dirname, '..', root);
        if (!fs.existsSync(dir)) continue;
        for (const name of fs.readdirSync(dir)) {
            if (!name.endsWith('.js')) continue;
            if (name === 'service-dates-core.js') continue; // the one home
            const src = fs.readFileSync(path.join(dir, name), 'utf8');
            if (spellings.some(re => re.test(src))) offenders.push(`${root}/${name}`);
        }
    }

    assert.deepStrictEqual(offenders, [],
        'the first Sunday belongs to ServiceDatesCore.FIRST_SUNDAY, not to:\n  ' + offenders.join('\n  '));
});
