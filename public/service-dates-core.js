// Service Dates Core — which Sundays the app recognises, and how to walk them.
//
// A Service is stored under its own date (`services/{YYYY-MM-DD}`), and a
// Sunday exists whether or not anybody has written one yet: the Services list
// draws a row for every Sunday and fills in whatever documents happen to be
// there. So "which Sundays are there" is not a question for the database. It is
// arithmetic over a range, and this module owns that range.
//
// It owns it because three places need the same answer and used to keep their
// own. The Services list generated its own run of Sundays inside a page-load
// handler. The document importer kept its own copy of the date the church's
// records begin. And the Order of Service page now needs to know what comes
// after the Sunday on screen, so its arrows know where to go and when to stop.
// Three copies of one fact is three chances to disagree about it.
//
// ── The clock is an argument, never a reading ────────────────────────────────
//
// The far end of the range is two years ahead, which means it moves every day.
// Every function here is told what today is rather than looking it up. That is
// what keeps the tests honest — a module that reads the clock can only be
// tested against the clock — and it is why callers pass `DateUtils.todayStr()`.
//
// ── Local time, or a Sunday becomes a Saturday ───────────────────────────────
//
// All arithmetic goes through DateUtils, which works in local calendar days.
// Stepping a week with UTC maths shifts the date by one for anyone west of GMT
// in the evening, and a Sunday that quietly becomes a Saturday is the kind of
// bug that only shows up in somebody else's timezone.
//
// ── Stepping is ±7 days, not a lookup ────────────────────────────────────────
//
// The event system can in principle mark an occurrence cancelled or moved, but
// the app offers no way to do either to a Sunday, and neither Services list
// reads those flags. Consulting them here would make the arrows disagree with
// the lists they came from, for no gain. Seven days, every time.
//
// Loaded as a classic <script> (window.ServiceDatesCore) and exported for Node.

(function (global) {
    'use strict';

    const Dates = (typeof require !== 'undefined')
        ? require('./date-utils.js')
        : global.DateUtils;

    // The first Sunday the church has records for. The one date in here that is
    // a fact about the church rather than a consequence of arithmetic, and the
    // reason this module exists: it used to be typed out in two unrelated files.
    const FIRST_SUNDAY = '2023-07-09';

    // How far ahead the range reaches. Two years is well past anything anybody
    // plans, and far enough that reaching the end is a surprise rather than an
    // obstacle.
    const YEARS_AHEAD = 2;

    // Is this a date we can do anything with? Anything else — null, empty, a
    // typo in the address bar — has no neighbours rather than throwing, because
    // a bad URL should leave the arrows inert, not break the page.
    function isDateStr(value) {
        return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
    }

    // The last Sunday in the range, given today. Two years from today lands on
    // whatever weekday it lands on, so the range stops at the Sunday on or
    // before it.
    function horizon(today) {
        if (!isDateStr(today)) return null;

        const from = Dates.parseDateStr(today);
        const limit = new Date(from.getFullYear() + YEARS_AHEAD, from.getMonth(), from.getDate());
        // Back up to Sunday. getDay() is 0 on a Sunday, so this is a no-op when
        // the limit already falls on one.
        limit.setDate(limit.getDate() - limit.getDay());
        return Dates.toDateStr(limit);
    }

    // Does the range hold this date? Dates are YYYY-MM-DD, so they compare as
    // strings — no parsing needed to order them.
    function contains(date, today) {
        if (!isDateStr(date)) return false;
        const end = horizon(today);
        if (!end) return false;
        return date >= FIRST_SUNDAY && date <= end;
    }

    // The Sunday after this one, or null at the far end of the range.
    function next(date, today) {
        if (!isDateStr(date)) return null;
        const after = Dates.addDays(date, 7);
        return contains(after, today) ? after : null;
    }

    // The Sunday before this one, or null at the near end of the range.
    function previous(date, today) {
        if (!isDateStr(date)) return null;
        const before = Dates.addDays(date, -7);
        return contains(before, today) ? before : null;
    }

    // Every Sunday in the range, oldest first. This is what the Services list
    // draws its rows from.
    function all(today) {
        const end = horizon(today);
        if (!end) return [];

        const sundays = [];
        let current = FIRST_SUNDAY;
        while (current <= end) {
            sundays.push(current);
            current = Dates.addDays(current, 7);
        }
        return sundays;
    }

    const ServiceDatesCore = { FIRST_SUNDAY, YEARS_AHEAD, horizon, contains, next, previous, all };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = ServiceDatesCore;
    } else {
        global.ServiceDatesCore = ServiceDatesCore;
    }
})(typeof globalThis !== 'undefined' ? globalThis : this);
