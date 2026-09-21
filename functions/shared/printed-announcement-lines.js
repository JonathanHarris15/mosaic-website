// ⚠ GENERATED FILE — DO NOT EDIT.
//
// Copied from public/printed-announcement-lines.js by scripts/sync-shared-to-functions.js, because
// functions/ deploys as its own bundle and cannot require across into
// public/. Edit the original; run the script; commit both.
//
// test/functions-shared-sync.test.js fails if this copy is stale.

// Printed announcement lines — which printed event announcements belong on
// one Sunday, and in what order (MS-622, MS-639).
//
// The selector does not read the database and does not grow a second way to
// expand a recurrence. Dates arrive already paired, or they are asked of the
// occurrence model the calendar already uses: a skipped date and a date
// moved away are not happening, a moved date counts from the day it was
// moved to, and a one-off's inclusive last day is the span that model
// already expands.
//
// Loaded as a classic <script> (window.PrintedAnnouncementLines) and
// exported for Node tests.

(function (global) {
    'use strict';

    const Occ = (typeof require !== 'undefined')
        ? require('./events-occurrence-core.js')
        : global.EventsOccurrenceCore;

    const PRINTED = 'printed';

    function isDate(value) {
        return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
    }

    function parseDate(str) {
        const parts = String(str || '').split('-').map(Number);
        return new Date(parts[0], (parts[1] || 1) - 1, parts[2] || 1);
    }

    function formatDate(date) {
        return date.getFullYear() + '-' +
            String(date.getMonth() + 1).padStart(2, '0') + '-' +
            String(date.getDate()).padStart(2, '0');
    }

    function addDays(dateStr, n) {
        const d = parseDate(dateStr);
        d.setDate(d.getDate() + n);
        return formatDate(d);
    }

    function wholeWeeks(value) {
        if (typeof value === 'boolean' || value == null) return null;
        if (typeof value === 'string' && value.trim() === '') return null;
        const n = typeof value === 'number' ? value : Number(String(value).trim());
        if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) return null;
        return n;
    }

    // Sunday S includes D when S <= D <= the day N weeks after S. Both ends
    // count. N weeks is N * 7 days, not a calendar-month walk.
    function inWindow(sunday, date, weeks) {
        if (!isDate(sunday) || !isDate(date)) return false;
        const end = addDays(sunday, weeks * 7);
        return date >= sunday && date <= end;
    }

    function clock(time) {
        const match = /^(\d{1,2}):(\d{2})$/.exec(String(time || '').trim());
        if (!match) return '';
        const hour = Number(match[1]);
        const minute = Number(match[2]);
        if (hour > 23 || minute > 59) return '';
        return String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0');
    }

    function datesOf(item) {
        const seen = {};
        const out = [];
        (item && item.dates || []).forEach(date => {
            if (!isDate(date) || seen[date]) return;
            seen[date] = true;
            out.push(date);
        });
        out.sort();
        return out;
    }

    // The dates an event happens, for the selector to pair with an
    // announcement. A one-off is its span, first day through last day. A
    // repeating event is each date the rule produces in the window, minus a
    // skipped date and a date moved away, plus the day a date was moved to.
    function datesTheEventHappens(spec, from, to) {
        const input = spec || {};
        if (!input.rule) {
            const dates = Occ.spanDates(input.occurrence || {});
            return { dates: dates, run: true };
        }
        if (!isDate(from) || !isDate(to) || from > to) return { dates: [], run: false };
        const stored = input.stored || [];
        const merged = Occ.mergeOccurrences(input.seriesId, input.rule, stored, from, to);
        const dates = [];
        merged.forEach(occurrence => {
            if (!Occ.notHappening(occurrence)) dates.push(occurrence.date);
        });
        stored.forEach(occurrence => {
            if (!occurrence || !occurrence.movedFrom || !isDate(occurrence.date)) return;
            if (occurrence.date < from || occurrence.date > to) return;
            if (Occ.notHappening(occurrence)) return;
            if (dates.indexOf(occurrence.date) === -1) dates.push(occurrence.date);
        });
        dates.sort();
        return { dates: dates, run: false };
    }

    function linesOnSunday(sunday, paired) {
        if (!isDate(sunday)) return [];
        const rows = [];
        const seen = {};
        (paired || []).forEach(item => {
            if (!item || item.way !== PRINTED) return;
            const weeks = wholeWeeks(item.weeks);
            if (weeks == null) return;
            const id = item.id != null ? String(item.id) : '';
            if (id && seen[id]) return;
            const dates = datesOf(item);
            const qualifying = dates.filter(date => inWindow(sunday, date, weeks));
            if (!qualifying.length) return;
            if (id) seen[id] = true;
            rows.push({
                id: id,
                title: item.title || '',
                prose: item.prose || '',
                sortDate: item.run ? dates[0] : qualifying[0],
                startTime: clock(item.startTime),
                eventName: item.eventName || '',
                order: Number.isFinite(item.order) ? item.order : 0,
            });
        });
        rows.sort((a, b) => {
            if (a.sortDate !== b.sortDate) return a.sortDate < b.sortDate ? -1 : 1;
            const ta = a.startTime || '99:99';
            const tb = b.startTime || '99:99';
            if (ta !== tb) return ta < tb ? -1 : 1;
            if (a.eventName !== b.eventName) return a.eventName < b.eventName ? -1 : 1;
            if (a.order !== b.order) return a.order - b.order;
            return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
        });
        return rows.map(row => ({ id: row.id, title: row.title, prose: row.prose }));
    }

    // The handed-out guide. A public event contributes. So does the Sunday
    // Service, which is public by name even when a stamp says otherwise. A
    // member, participant, editor, or elder event does not, whoever is
    // looking. A told announcement is not passed to the selector.
    function mayBeHandedOut(event) {
        if (!event) return false;
        const id = event.seriesId || event.id;
        if (id === Occ.SUNDAY_SERVICE_ID) return true;
        return event.visibility === 'public';
    }

    function linesForHandedOutGuide(sunday, events) {
        const paired = [];
        (events || []).forEach(event => {
            if (!mayBeHandedOut(event)) return;
            (event.announcements || []).forEach(announcement => {
                if (!announcement || announcement.way !== PRINTED) return;
                const weeks = wholeWeeks(announcement.weeks);
                if (weeks == null || !isDate(sunday)) return;
                const happened = event.rule
                    ? datesTheEventHappens(event, sunday, addDays(sunday, weeks * 7))
                    : datesTheEventHappens({ occurrence: event.occurrence || {} });
                paired.push({
                    id: announcement.id,
                    title: announcement.title,
                    prose: announcement.prose,
                    way: announcement.way,
                    weeks: announcement.weeks,
                    order: announcement.order,
                    eventName: event.name || '',
                    startTime: event.startTime || '',
                    dates: happened.dates,
                    run: happened.run,
                });
            });
        });
        return linesOnSunday(sunday, paired);
    }

    function filledTyped(items) {
        return (items || []).filter(item => {
            if (!item || typeof item !== 'object') return false;
            return String(item.title || '').trim() || String(item.content || '').trim();
        }).map(item => ({ title: item.title || '', content: item.content || '' }));
    }

    // Typed announcements first, then the printed lines. A new array — the
    // Sunday's typed list is not modified.
    function bookletAnnouncements(typedItems, lines) {
        return filledTyped(typedItems).concat((lines || []).map(line => ({
            title: line && line.title || '',
            content: line && line.prose || '',
        })));
    }

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    // What the template guide draws. Prose is plain text: markup is escaped
    // and line breaks are kept. The values object the editor saves is not
    // this copy.
    function renderedGuideValues(values, lines) {
        const source = values && typeof values === 'object' ? values : {};
        const copy = Object.assign({}, source);
        const typed = filledTyped(source.announcements);
        const extra = (lines || []).map(line => ({
            title: line && line.title || '',
            content: escapeHtml(line && line.prose).replace(/\n/g, '<br>'),
        }));
        copy.announcements = typed.concat(extra);
        return copy;
    }

    // The classic guide's preview. Typed lines stay rich text. Printed lines
    // are plain, so the page can draw them without treating prose as markup.
    function pageItems(typedItems, lines) {
        return filledTyped(typedItems).map(item => ({
            title: item.title,
            content: item.content,
            plain: false,
        })).concat((lines || []).map(line => ({
            title: line && line.title || '',
            prose: line && line.prose || '',
            plain: true,
        })));
    }

    const PrintedAnnouncementLines = {
        linesOnSunday,
        datesTheEventHappens,
        mayBeHandedOut,
        linesForHandedOutGuide,
        bookletAnnouncements,
        renderedGuideValues,
        pageItems,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = PrintedAnnouncementLines;
    }
    if (global) {
        global.PrintedAnnouncementLines = PrintedAnnouncementLines;
    }
})(typeof window !== 'undefined' ? window : globalThis);
