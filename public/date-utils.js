// Date utilities — the single home for service-date (YYYY-MM-DD) handling.
//
// A church Service is keyed by its local calendar date (YYYY-MM-DD). The same
// local-time formatter, the same string→Date parse, and the same week-arithmetic
// were re-typed inline across service-calendar.js and service-builder.js (and a
// couple more). Crucially they must stay LOCAL-time: building the key from
// Date#getFullYear/getMonth/getDate, never from toISOString() (which is UTC and
// shifts the date by a day for anyone west of GMT in the evening).
//
// Loaded as a classic <script> before the page scripts, so it is wrapped in an
// IIFE exposing only window.DateUtils — no globals leak to collide with a page
// script's own declarations. Also exported via module.exports for Node tests.
(function (global) {
    'use strict';

    // A Date → its local calendar date as 'YYYY-MM-DD'. Local, never UTC.
    function toDateStr(date) {
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    }

    // Today's local service-date key.
    function todayStr() {
        return toDateStr(new Date());
    }

    // 'YYYY-MM-DD' → a local Date at midnight. Inverse of toDateStr.
    function parseDateStr(str) {
        const [y, m, d] = String(str).split('-').map(Number);
        return new Date(y, m - 1, d);
    }

    // Add n days to a 'YYYY-MM-DD' string, returning the same format. Negative n
    // goes backwards. DST-safe because it works in local time.
    function addDays(dateStr, n) {
        const dt = parseDateStr(dateStr);
        dt.setDate(dt.getDate() + n);
        return toDateStr(dt);
    }

    // Add one week to a 'YYYY-MM-DD' string (the common Sunday-to-Sunday step).
    function addWeek(dateStr) {
        return addDays(dateStr, 7);
    }

    // 'YYYY-MM-DD' → a long human label, e.g. 'Sunday, June 14, 2026'.
    function formatDateLong(dateStr, locale) {
        if (!dateStr) return '';
        return parseDateStr(dateStr).toLocaleDateString(locale, {
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
        });
    }

    const DateUtils = { toDateStr, todayStr, parseDateStr, addDays, addWeek, formatDateLong };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = DateUtils;
    }
    if (global) {
        global.DateUtils = DateUtils;
    }
})(typeof window !== 'undefined' ? window : null);
