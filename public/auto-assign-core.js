// Auto-assign Core — staffing a stretch of dates (MS-18, ADR-0020 §1).
//
// The one-occurrence solve belongs to fairness-core. This is the loop around
// it, and the whole of its job is the thing that makes a RANGE come out even
// rather than ten copies of the same answer.
//
// ── Why a loop is not a detail ───────────────────────────────────────────────
//
// Fairness reads the serve log. By ADR-0018 and ADR-0019 no Involvement exists
// for a date that has not happened — an Assignment is the plan, an Involvement
// is the fact, and the fact is written the night the date passes. So for a
// range of FUTURE dates the log is identical at every step, and a loop that
// simply calls the solve ten times gets the same roster ten times and hands one
// person every Sunday.
//
// The fix is not a second "planned work" input threaded through the model and
// kept in sync. It is that each solved date's picks become part of the history
// the NEXT date reads. Week one's coffee is inside week two's window. History
// stays the only input fairness ever has.
//
// ⚠ THIS FAILS INVISIBLY. A range drafted without the carry-forward looks
// entirely reasonable — every single date is individually fair, correctly
// ranked, rule-valid. It is wrong only across the range, which is the one thing
// the feature exists to get right. `test/auto-assign-range.test.js` pins it.
//
// ── What else already occupies a date ────────────────────────────────────────
//
// Assignments an editor made by hand are in the same boat: not Involvement,
// therefore invisible to the solve. They join the same carried pile, or the
// draft cheerfully hands somebody a job on every Sunday they were already
// standing on. Confirmed and Pending count; Declined does not, because a
// decline never becomes serving.
//
// ── What this module refuses to know ─────────────────────────────────────────
//
// Everything. The solve, eligibility and intensity all arrive as injected
// functions, like every other *-core here. It owns the stepping and nothing
// else — it has no opinion about who may serve, and cannot develop one.
//
// Loaded as a classic <script> (window.AutoAssignCore) and exported for Node.

(function (global) {
    'use strict';

    // What to do with places on dates in the range that already have somebody
    // in them. Confirmed is never touched by any of the three, and Declined
    // always reads as an empty place — so all three are really about Pending.
    const CHOICES = Object.freeze({
        KEEP: 'keep',           // fill around what is there
        REPLACE: 'replace',     // draw those places again
        LEAVE_OUT: 'leaveOut',  // do not touch that date at all
    });

    const STATES = Object.freeze({
        PENDING: 'pending',
        CONFIRMED: 'confirmed',
        DECLINED: 'declined',
    });

    // ── Seats as history ──────────────────────────────────────────────────────

    // A solved occurrence, shaped like the Involvement records `loadOf` and
    // `recencyOf` already read. Deliberately the same shape rather than a
    // parallel one: the whole point of ADR-0020 §1 is that a drafted pick and a
    // real serve are indistinguishable to the next step, so there is no second
    // code path where one could be forgotten.
    //
    // `metadata` is carried because a one-off Role's intensity is resolved
    // through it — every one-off shares the reserved `one_off` slug, so the
    // record is the only thing that can tell two of them apart.
    function historyFrom(seats, date, seriesId) {
        return (seats || [])
            .filter(seat => seat && seat.personId && seat.roleSlug)
            .map(seat => ({
                personId: seat.personId,
                type: seat.roleSlug,
                serviceDate: date,
                seriesId: seriesId || null,
                metadata: seat.metadata || null,
            }));
    }

    // Assignments already on a date, as history. A Declined assignment is left
    // out: nobody served, and treating it as history would rest somebody for a
    // job they turned down.
    function carriedHistory(assignments, date, seriesId) {
        const counted = (assignments || []).filter(a => (
            a && a.personId && a.state !== STATES.DECLINED
        ));
        return historyFrom(counted, date, seriesId);
    }

    // ── Which places are already taken ────────────────────────────────────────

    // A Declined assignment holds nothing — its place goes back on offer, which
    // is what "flagged for reassignment" means (ADR-0018 §5). Confirmed always
    // holds. Pending holds only when the editor said to keep it.
    function heldSeats(assignments, choice) {
        return (assignments || []).filter(a => {
            if (!a || !a.personId || !a.roleSlug) return false;
            if (a.state === STATES.DECLINED) return false;
            if (a.state === STATES.CONFIRMED) return true;
            return choice !== CHOICES.REPLACE;
        });
    }

    const asSeat = a => ({
        roleSlug: a.roleSlug,
        slotId: a.slotId,
        personId: a.personId,
        metadata: a.metadata || null,
    });

    // ── The window for one step ───────────────────────────────────────────────

    // The series' own dates, most recent first, ending just before the date
    // being staffed. Earlier dates OF THE RANGE come first — they are the most
    // recent history by the time the loop reaches here — then the real past.
    //
    // Built from the recurrence rule, never from the serve log: three quiet
    // Sundays still happened, and a window that skipped them would quietly
    // stretch "the last twelve" over a longer run of calendar than it claims.
    function windowFor(dates, index, pastDates) {
        return dates.slice(0, index).reverse().concat(pastDates || []);
    }

    // ── One step ──────────────────────────────────────────────────────────────

    function staff(o, date, index, history) {
        const existing = (o.existing || {})[date] || [];
        const choice = o.choice || CHOICES.KEEP;

        // Left out: the date keeps exactly what it had and is not drafted. It
        // still counts as history, because those people are still serving.
        if (choice === CHOICES.LEAVE_OUT && existing.length) {
            const kept = heldSeats(existing, CHOICES.KEEP);
            return {
                date: date,
                skipped: true,
                seats: kept.map(a => Object.assign(asSeat(a), {
                    held: true, state: a.state, recency: null, allowsAnotherRole: null,
                })),
                gaps: [],
                widened: 0,
                allSpent: false,
                pool: [],
            };
        }

        const held = heldSeats(existing, choice);
        const heldByKey = {};
        held.forEach(a => { heldByKey[a.roleSlug + '|' + a.slotId] = a; });

        const result = o.solve({
            roles: o.roles,
            people: o.people,
            history: history,
            occurrenceDates: windowFor(o.dates, index, o.pastDates),
            windowSize: o.windowSize,
            seriesId: o.seriesId,
            date: date,
            seated: held.map(asSeat),
            candidatesFor: o.candidatesFor,
            intensityOf: o.intensityOf,
            liturgicalSlugs: o.liturgicalSlugs,
            liturgicalHolders: o.liturgicalHoldersFor
                ? o.liturgicalHoldersFor(date)
                : [],
            relationships: o.relationships,
            groups: o.groups,
        });

        return {
            date: date,
            skipped: false,
            // The solve gives back the held places along with the ones it
            // filled, so the roster is one list. Marking which is which is what
            // lets the screen show a hand-made pick differently — and what stops
            // a re-draft treating the two the same.
            seats: result.filled.map(seat => {
                const was = heldByKey[seat.roleSlug + '|' + seat.slotId];
                return Object.assign({}, seat, {
                    held: !!was,
                    state: was ? was.state : null,
                });
            }),
            gaps: result.unfilled,
            widened: result.widened,
            allSpent: result.allSpent,
            pool: result.pool,
        };
    }

    // ── The range ─────────────────────────────────────────────────────────────

    function assertReady(o) {
        if (typeof o.solve !== 'function') {
            throw new Error(
                'AutoAssignCore needs options.solve — pass FairnessCore.solve. ' +
                'The loop never staffs an occurrence itself.'
            );
        }
        if (typeof o.windowSize !== 'number') {
            throw new Error(
                'AutoAssignCore needs options.windowSize — use ' +
                'EventsCore.fairnessWindowOf(series), which owns the default.'
            );
        }
    }

    // Step the solve down the range, rolling the history forward as it goes.
    //
    // `from` and `keep` exist for re-drafting: everything before `from` is taken
    // as given rather than re-solved, and still read as history by the dates
    // after it. Re-drafting the whole range is just `from: 0`.
    function run(options, from, keep) {
        const o = options || {};
        assertReady(o);

        const dates = o.dates || [];
        const days = [];
        // Real Involvement first; drafted and hand-made picks pile on top as the
        // loop moves forward. Order does not matter to the readers — both index
        // by date — but the pile only ever grows, so no step can un-see one.
        let history = (o.history || []).slice();

        dates.forEach((date, index) => {
            if (index < from) {
                const kept = keep[index];
                days.push(kept);
                history = history.concat(historyFrom(kept.seats, date, o.seriesId));
                return;
            }

            const day = staff(o, date, index, history);
            days.push(day);
            history = history.concat(historyFrom(day.seats, date, o.seriesId));
        });

        return { dates: days };
    }

    function draft(options) {
        return run(options, 0, []);
    }

    // Keep the chosen date and everything before it exactly as the editor left
    // them; draw the rest again, reading the kept dates as history.
    //
    // Nothing re-solves on its own when a date is edited — a grid that
    // rearranges itself while it is being reviewed cannot be reviewed, the same
    // reasoning that kept the solve deterministic (ADR-0020 §6). This is the
    // button that does it on purpose.
    function redraftFrom(previous, index, options) {
        const kept = ((previous || {}).dates || []).slice(0, index + 1);
        return run(options, kept.length, kept);
    }

    const AutoAssignCore = {
        CHOICES,
        STATES,
        // seats as history — the carry-forward
        historyFrom,
        carriedHistory,
        // which places are already taken
        heldSeats,
        // the window for one step
        windowFor,
        // the range
        draft,
        redraftFrom,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = AutoAssignCore;
    }
    if (global) {
        global.AutoAssignCore = AutoAssignCore;
    }
})(typeof window !== 'undefined' ? window : null);
