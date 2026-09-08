// ⚠ GENERATED FILE — DO NOT EDIT.
//
// Copied from public/tasks-core.js by scripts/sync-shared-to-functions.js, because
// functions/ deploys as its own bundle and cannot require across into
// public/. Edit the original; run the script; commit both.
//
// test/functions-shared-sync.test.js fails if this copy is stale.

// Tasks Core — the pure model for a Task (MS-79).
//
// A Task is a piece of work an elder has to do. It replaces the old Follow-up
// Reminder, which was a title, a date, and nothing else — and which vanished
// the moment its date passed.
//
// Four things this module knows, and they are the whole of the feature's
// judgment:
//
//   1. FINISHING IS THE CLOCK, NOT THE DATE (ADR-0058). An unfinished Task past
//      its due date does not disappear — it is overdue, and it stays. A missed
//      occurrence of a repeat does not roll forward or forgive itself; it sits
//      there beside the next one. Three red months is the news.
//
//   2. A REPEAT'S DATES ARE COMPUTED (ADR-0060). A Task series carries a
//      recurrence rule and the dates come from the rule alone. Occurrence
//      records are SPARSE — one exists only once something has been SAID about
//      a date (a tick, a skip, a reassignment, a nudge). So a missed occurrence
//      needs nothing stored to be overdue, and no nightly job has to mint one.
//
//   3. WHAT IS TRUE OF EVERY DATE LIVES ON THE SERIES. An occurrence may only
//      override in named ways. Anything it has not said for itself is read
//      through from the series, so changing the series changes every date that
//      has not spoken up — the same rule an Event occurrence obeys.
//
//   4. A TASK NAMES WHO MUST DO IT (ADR-0059). Its only Person link is its
//      Assignees, who are Elders. There is no "people it is about": a Person
//      named in the body is a cross-reference, which is prose. This module
//      builds its output objects field by field rather than spreading its
//      input, so a stray `mentions` on an old record cannot leak through and
//      quietly become a field again.
//
// The recurrence vocabulary is the Calendar's, taken from `EventsOccurrenceCore`
// rather than restated, so "fortnightly" cannot come to mean two things.
//
// Deliberately pure — it takes plain records and a clock, returns new objects,
// and mutates nothing. Loaded as a classic <script> (window.TasksCore) and
// exported for Node tests.

(function (global) {
    'use strict';

    const Core = (typeof require !== 'undefined')
        ? require('./events-occurrence-core.js')
        : global.EventsOccurrenceCore;

    // ── Vocabulary ────────────────────────────────────────────────────────────

    // Where a Task stands. Four states, and the difference between the last two
    // is load-bearing: a skip stands one down without claiming it was done, so
    // "done" keeps meaning done.
    const STATES = Object.freeze({
        OPEN: 'open',
        OVERDUE: 'overdue',
        DONE: 'done',
        SKIPPED: 'skipped',
    });

    // How the list reads. Overdue shouts first, then what is coming, then what
    // has been dealt with. Within a rank, soonest first.
    const RANK = Object.freeze({
        [STATES.OVERDUE]: 0,
        [STATES.OPEN]: 1,
        [STATES.DONE]: 2,
        [STATES.SKIPPED]: 3,
    });

    // The window the Tasks page opens on: live work, not an archive.
    const COMPLETED_WINDOW_DAYS = 30;

    const isDateStr = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
    const isTimeStr = v => /^\d{2}:\d{2}$/.test(String(v || ''));

    // ── Dates ─────────────────────────────────────────────────────────────────
    //
    // Everything here is LOCAL time on purpose. A Task is due on the day the
    // elder means, in the church's own day — an elder in a car park at 11pm does
    // not want yesterday's task to have already gone red because a server is on
    // UTC.

    function dayOf(ms) {
        const d = new Date(ms);
        const pad = n => String(n).padStart(2, '0');
        return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    }

    function parseDate(dateStr) {
        const [y, m, d] = String(dateStr).split('-').map(Number);
        return new Date(y, m - 1, d);
    }

    // The moment a Task stops being merely due and starts being late.
    //
    // With no time on it, that is the END of its day — "ring Dave on Thursday"
    // is not late at one minute past midnight on Thursday morning. With a time,
    // it is that time, because "before the 6pm meeting" means what it says.
    function lateAfter(dueDate, dueTime) {
        const day = parseDate(dueDate);
        if (isTimeStr(dueTime)) {
            const [h, min] = String(dueTime).split(':').map(Number);
            day.setHours(h, min, 0, 0);
            return day.getTime();
        }
        day.setDate(day.getDate() + 1);          // midnight at the end of the day
        return day.getTime();
    }

    // ── Ids ───────────────────────────────────────────────────────────────────

    // Deterministic, like an Event occurrence's: two elders clicking at the same
    // moment write the same document rather than two of it.
    function occurrenceIdFor(seriesId, date) {
        return String(seriesId) + '_' + String(date);
    }

    // ── Resolving one Task ────────────────────────────────────────────────────

    function stateOf(row, now) {
        if (row.skippedAt) return STATES.SKIPPED;
        if (row.completedAt) return STATES.DONE;
        return now >= lateAfter(row.dueDate, row.dueTime) ? STATES.OVERDUE : STATES.OPEN;
    }

    // Built field by field — never spread from the stored record. See note 4 at
    // the top: a Task's shape is decided here, not by whatever is in the
    // database from an older model.
    function present(row, now) {
        const assigneeIds = Array.isArray(row.assigneeIds) ? row.assigneeIds.slice() : [];
        return {
            id: row.id,
            seriesId: row.seriesId || null,
            occurrenceId: row.occurrenceId || null,
            title: row.title || '',
            body: row.body || '',
            dueDate: row.dueDate,
            dueTime: isTimeStr(row.dueTime) ? row.dueTime : null,
            assigneeIds: assigneeIds,
            isUnassigned: assigneeIds.length === 0,
            state: stateOf(row, now),
            completedAt: row.completedAt || null,
            completedOn: row.completedAt ? dayOf(row.completedAt) : null,
            completedBy: row.completedBy || null,
            skippedAt: row.skippedAt || null,
            createdBy: row.createdBy || null,
            createdByName: row.createdByName || '',
        };
    }

    // ── Resolving a series into its dates ─────────────────────────────────────

    // One field of an occurrence, read through to the series when the occurrence
    // has said nothing about it. This is what makes editing the series reach
    // every date that has not overridden it.
    function readThrough(rec, series, field, fallback) {
        if (!rec) return fallback;
        const own = rec[field];
        if (Array.isArray(own)) return own;
        if (typeof own === 'string' && own.trim()) return own;
        if (typeof own === 'number') return own;
        return fallback;
    }

    function expandSeries(series, occurrences, from, to) {
        const rule = series && series.recurrence;
        if (!rule || !isDateStr(rule.startDate)) return [];

        // A stopped series produces no more dates. What was already done still
        // stands — deleting a commitment is not denying you kept it.
        let horizon = to;
        if (isDateStr(series.stoppedOn) && series.stoppedOn < horizon) horizon = series.stoppedOn;

        const byId = new Map();
        (occurrences || []).forEach((o) => {
            if (o && o.seriesId === series.id) byId.set(o.id || occurrenceIdFor(o.seriesId, o.date), o);
        });

        const rows = Core.datesBetween(rule, from, horizon).map((date) => {
            const rec = byId.get(occurrenceIdFor(series.id, date)) || null;
            if (rec) byId.delete(occurrenceIdFor(series.id, date));
            return {
                id: occurrenceIdFor(series.id, date),
                seriesId: series.id,
                occurrenceId: rec ? rec.id || occurrenceIdFor(series.id, date) : null,
                title: readThrough(rec, series, 'title', series.title),
                body: readThrough(rec, series, 'body', series.body),
                // A nudge moves this date and only this date.
                dueDate: (rec && isDateStr(rec.movedTo)) ? rec.movedTo : date,
                dueTime: readThrough(rec, series, 'dueTime', series.dueTime),
                assigneeIds: (rec && Array.isArray(rec.assigneeIds)) ? rec.assigneeIds : series.assigneeIds,
                completedAt: rec ? rec.completedAt : null,
                completedBy: rec ? rec.completedBy : null,
                skippedAt: rec ? rec.skippedAt : null,
                createdBy: series.createdBy,
                createdByName: series.createdByName,
            };
        });

        // Records left over sit on dates the rule no longer produces — a pattern
        // was changed, or the series was stopped, after somebody had already
        // ticked one. A completed record survives that; it is the evidence the
        // work happened, and dropping it would make the page lie about what the
        // elders did.
        byId.forEach((rec) => {
            if (!rec.completedAt) return;
            rows.push({
                id: rec.id || occurrenceIdFor(series.id, rec.date),
                seriesId: series.id,
                occurrenceId: rec.id || occurrenceIdFor(series.id, rec.date),
                title: readThrough(rec, series, 'title', series.title),
                body: readThrough(rec, series, 'body', series.body),
                dueDate: isDateStr(rec.movedTo) ? rec.movedTo : rec.date,
                dueTime: readThrough(rec, series, 'dueTime', series.dueTime),
                assigneeIds: Array.isArray(rec.assigneeIds) ? rec.assigneeIds : series.assigneeIds,
                completedAt: rec.completedAt,
                completedBy: rec.completedBy,
                skippedAt: null,
                createdBy: series.createdBy,
                createdByName: series.createdByName,
            });
        });

        return rows;
    }

    // ── The one entry point ───────────────────────────────────────────────────

    // Every Task there is, one-offs and every date of every repeat, in the order
    // an elder needs to read them.
    //
    // `from`/`to` bound the COMPUTED dates only. A one-off is a stored row and is
    // already the answer — windowing it would hide an overdue Task from six
    // weeks ago, which is the one thing this feature exists to stop happening.
    function resolve({ tasks, series, occurrences, now, from, to }) {
        const clock = Number.isFinite(now) ? now : Date.now();

        const oneOffs = (tasks || [])
            // A Task with no date has no clock, and without a clock there is no
            // overdue. It is refused at the door rather than shown as undated.
            .filter(t => t && isDateStr(t.dueDate))
            .map(t => Object.assign({}, t, { seriesId: null, occurrenceId: null }));

        const repeated = (series || []).reduce(
            (all, s) => all.concat(expandSeries(s, occurrences, from, to)), []);

        return oneOffs.concat(repeated)
            .map(row => present(row, clock))
            .sort((a, b) => (RANK[a.state] - RANK[b.state])
                || (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0));
    }

    // ── The two slices the surfaces ask for ───────────────────────────────────

    // What belongs on the Shepherd Dashboard's panel: a glance, not a second
    // home. Yours, the ones nobody has picked up, and anything late — whoever it
    // belongs to, because a late Task is everybody's problem.
    //
    // A Task finished today stays, struck through, so the day's work is visible;
    // tomorrow it is gone from here and lives on the page. A skipped one never
    // appears: standing something down is not work to look at.
    function panelFor(list, uid, now) {
        const today = dayOf(Number.isFinite(now) ? now : Date.now());
        return (list || []).filter((t) => {
            if (t.state === STATES.SKIPPED) return false;
            if (t.state === STATES.DONE) {
                return t.completedOn === today && (t.isUnassigned || t.assigneeIds.indexOf(uid) >= 0);
            }
            if (t.state === STATES.OVERDUE) return true;
            return t.isUnassigned || t.assigneeIds.indexOf(uid) >= 0;
        });
    }

    // The finished work, newest first. `since` bounds how far back — the page
    // opens on thirty days and can reach further when somebody asks.
    function completed(list, opts) {
        const since = opts && Number.isFinite(opts.since) ? opts.since : null;
        return (list || [])
            .filter(t => t.state === STATES.DONE)
            .filter(t => since === null || t.completedAt >= since)
            .sort((a, b) => b.completedAt - a.completedAt);
    }

    // The start of the default completed window, from a clock.
    function completedWindowStart(now, days) {
        const d = new Date(Number.isFinite(now) ? now : Date.now());
        d.setDate(d.getDate() - (Number.isFinite(days) ? days : COMPLETED_WINDOW_DAYS));
        d.setHours(0, 0, 0, 0);
        return d.getTime();
    }

    const TasksCore = {
        // vocabulary — the recurrence half is the Calendar's own, not a copy
        STATES,
        FREQ: Core.FREQ,
        ENDS: Core.ENDS,
        COMPLETED_WINDOW_DAYS,
        // ids
        occurrenceIdFor,
        // the model
        resolve,
        stateOf,
        lateAfter,
        dayOf,
        // slices
        panelFor,
        completed,
        completedWindowStart,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = TasksCore;
    }
    if (global) {
        global.TasksCore = TasksCore;
    }
}(typeof window !== 'undefined' ? window : globalThis));
