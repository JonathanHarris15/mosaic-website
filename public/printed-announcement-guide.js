// Printed announcement guide — read the lines for one Sunday (MS-622, MS-641).
//
// The selector decides the window. This module only gathers what the
// calendar already knows: the series a person may see, the dates the
// recurrence produces, and the printed announcements on the events the
// handed-out guide is allowed to name. It does not write them onto the
// Sunday.
//
// The read looks ahead a bounded number of weeks so a query has an end.
// An announcement's own week count still decides whether a date in that
// read belongs on this Sunday. A week count longer than the bound widens
// the read to that count.
//
// Loaded as a classic <script> (window.PrintedAnnouncementGuide) and
// exported for Node tests.

(function (global) {
    'use strict';

    const READ_HORIZON_WEEKS = 104;

    function linesModule() {
        if (typeof require !== 'undefined') return require('./printed-announcement-lines.js');
        return global.PrintedAnnouncementLines;
    }

    function eventsStore() {
        if (typeof require !== 'undefined') return require('./events-store.js');
        return global.EventsStore;
    }

    function announcementStore() {
        if (typeof require !== 'undefined') return require('./event-announcement-store.js');
        return global.EventAnnouncementStore;
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

    async function eventsForSunday(db, sunday, viewer, deps) {
        const Lines = (deps && deps.lines) || linesModule();
        const Events = (deps && deps.events) || eventsStore();
        const Announcements = (deps && deps.announcements) || announcementStore();
        const who = viewer || {};
        const rank = who.level || who.rank || null;
        const personId = who.personId || null;
        const series = await Events.loadVisibleSeries(db, { rank: rank, personId: personId });
        const handed = (series || []).filter(item => Lines.mayBeHandedOut({
            id: item.id,
            seriesId: item.id,
            visibility: item.visibility,
        }));

        const announcementsBySeries = {};
        let horizon = READ_HORIZON_WEEKS;
        for (let i = 0; i < handed.length; i++) {
            const item = handed[i];
            const announcements = await Announcements.loadPrintedAnnouncements(db, {
                kind: 'repeating',
                seriesId: item.id,
            });
            announcementsBySeries[item.id] = announcements;
            announcements.forEach(announcement => {
                if (announcement.weeks > horizon) horizon = announcement.weeks;
            });
        }

        async function readCalendar(weeks) {
            return Events.loadCalendar(db, {
                rank: rank,
                personId: personId,
                from: sunday,
                to: addDays(sunday, weeks * 7),
            }) || [];
        }

        let rows = await readCalendar(horizon);
        const events = handed.map(item => {
            const rule = Events.recurrenceFor(item);
            return {
                id: item.id,
                seriesId: item.id,
                name: item.name || '',
                visibility: item.visibility,
                rule: rule,
                startTime: (rule && rule.time) || '',
                stored: rows.filter(occurrence => occurrence.seriesId === item.id),
                announcements: announcementsBySeries[item.id] || [],
            };
        });

        async function oneOffsIn(list) {
            const found = [];
            let furthest = horizon;
            const candidates = list.filter(occurrence =>
                occurrence && !occurrence.seriesId && Lines.mayBeHandedOut(occurrence));
            for (let i = 0; i < candidates.length; i++) {
                const occurrence = candidates[i];
                const announcements = await Announcements.loadPrintedAnnouncements(db, {
                    kind: 'one-off',
                    occurrenceId: occurrence.id,
                });
                announcements.forEach(announcement => {
                    if (announcement.weeks > furthest) furthest = announcement.weeks;
                });
                if (!announcements.length) continue;
                found.push({
                    id: occurrence.id,
                    name: occurrence.name || '',
                    visibility: occurrence.visibility,
                    startTime: occurrence.time || '',
                    occurrence: occurrence,
                    announcements: announcements,
                });
            }
            return { found: found, furthest: furthest };
        }

        let oneOffs = await oneOffsIn(rows);
        while (oneOffs.furthest > horizon) {
            horizon = oneOffs.furthest;
            rows = await readCalendar(horizon);
            events.forEach(event => {
                event.stored = rows.filter(occurrence => occurrence.seriesId === event.seriesId);
            });
            oneOffs = await oneOffsIn(rows);
        }
        oneOffs.found.forEach(event => events.push(event));
        return events;
    }

    async function loadLinesForSunday(db, sunday, viewer, deps) {
        const Lines = (deps && deps.lines) || linesModule();
        const events = await eventsForSunday(db, sunday, viewer, deps);
        return Lines.linesForHandedOutGuide(sunday, events);
    }

    const PrintedAnnouncementGuide = {
        READ_HORIZON_WEEKS,
        eventsForSunday,
        loadLinesForSunday,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = PrintedAnnouncementGuide;
    }
    if (global) {
        global.PrintedAnnouncementGuide = PrintedAnnouncementGuide;
    }
})(typeof window !== 'undefined' ? window : globalThis);
