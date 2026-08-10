// Recurring Roster Core — a series' rota, laid out as a grid.
//
// The Event detail page answers "who is on THIS date". Auto-assign answers "who
// SHOULD go on this run of dates". Neither answers the question an editor asks
// most often, which is "what does the next couple of months actually look like"
// — and until now that could only be reached by opening eight dates one at a
// time and holding the answer in your head.
//
// So: Roles down the side, dates across the top, what is really stored in the
// cells. Filling any of it is the draft room's job, and the columns you tick
// here are how you get there. EMPTYING them is the one change that belongs
// here — see `wipeFor` — because it is the only one that reads across a run of
// dates rather than down a single one.
//
// ── What is deliberately NOT a row ───────────────────────────────────────────
//
// The LITURGICAL Roles. They are not in the roster at all — they are fields on
// the Service document, filled in the order of service, and the printed booklet
// reads them from there (ADR-0018 §2). Drawing them here would put an empty row
// where the preacher's name belongs and read as "nobody is preaching", which is
// worse than not drawing them. The page says where they live instead.
//
// ── An empty place has to EXIST ──────────────────────────────────────────────
//
// The same trap auto-assign-grid-core documents. A cell built from the
// assignments that happen to be stored draws a Role needing three people as one
// name and no hint that two more were wanted. Every cell is rebuilt from the
// Role's OWN slots and whoever is stored is hung onto them, so a hole is a
// thing you can see and count.
//
// ── What this module refuses to know ─────────────────────────────────────────
//
// Names and wording. `nameOf` is injected, the same way the rest of this
// feature does it. It arranges; it does not phrase.
//
// Loaded as a classic <script> (window.RecurringRosterCore) and exported for Node.

(function (global) {
    'use strict';

    const slotsOf = role => (role && Array.isArray(role.slots) ? role.slots : []);

    function initialsOf(name) {
        const words = String(name || '').trim().split(/\s+/).filter(Boolean);
        if (!words.length) return '?';
        const first = words[0][0];
        const last = words.length > 1 ? words[words.length - 1][0] : '';
        return (first + last).toUpperCase();
    }

    // ── One person, on one place ─────────────────────────────────────────────

    function cardFor(assignment, o) {
        const name = o.nameOf(assignment.personId);
        return {
            personId: assignment.personId,
            name: name,
            initials: initialsOf(name),
            // The three states of ADR-0018, carried straight through. A decline
            // showing as an ordinary name is how a hole stays hidden until the
            // morning it matters.
            state: assignment.state || null,
            declined: assignment.state === 'declined',
        };
    }

    // ── One Role's cell, on one date ─────────────────────────────────────────

    function cellFor(role, date, o) {
        const cancelled = o.cancelledAt(date);
        const stored = {};
        (o.assignmentsAt(date) || []).forEach(a => {
            if (a && a.roleSlug === role.slug && !a.oneOffId && a.personId) {
                stored[a.slotId] = a;
            }
        });

        const places = slotsOf(role).map(slot => {
            const assignment = stored[slot.id];
            return {
                roleSlug: role.slug,
                slotId: slot.id,
                requirement: slot.requirement || null,
                filled: !!assignment,
                card: assignment ? cardFor(assignment, o) : null,
            };
        });

        return {
            date: date,
            // A cancelled date is not an unfilled one. Counting its empty places
            // towards the holes would send an editor chasing people for a
            // Sunday that is not happening.
            cancelled: cancelled,
            applicable: !cancelled,
            places: places,
        };
    }

    function roleRows(o) {
        return (o.roles || []).map(role => ({
            kind: 'role',
            key: 'role:' + role.slug,
            slug: role.slug,
            name: role.name,
            placeCount: slotsOf(role).length,
            cells: (o.dates || []).map(date => cellFor(role, date, o)),
        }));
    }

    // A one-off job belongs to exactly ONE date, so its row is applicable in one
    // column and not in the rest. Left blank instead, it would read as a place
    // somebody forgot to fill on every other date.
    //
    // These ARE part of the roster — somebody down for "unlock the hall" is
    // really rostered — so leaving them out would make the grid quietly
    // understate how much a person is doing.
    function oneOffRows(o) {
        const rows = [];

        (o.dates || []).forEach(date => {
            (o.oneOffsAt(date) || []).forEach(job => {
                if (!job || !job.id) return;
                const people = (o.assignmentsAt(date) || [])
                    .filter(a => a && a.oneOffId === job.id && a.personId);

                rows.push({
                    kind: 'oneOff',
                    key: 'oneOff:' + date + ':' + job.id,
                    slug: job.id,
                    date: date,
                    name: job.label || 'One-off job',
                    // Open-ended: a one-off has no slots, so it has no count of
                    // places to be short of.
                    placeCount: null,
                    cells: (o.dates || []).map(other => ({
                        date: other,
                        cancelled: o.cancelledAt(other),
                        applicable: other === date && !o.cancelledAt(other),
                        places: other === date
                            ? people.map(a => ({
                                roleSlug: job.id,
                                slotId: null,
                                oneOffId: job.id,
                                requirement: null,
                                filled: true,
                                card: cardFor(a, o),
                            }))
                            : [],
                    })),
                });
            });
        });

        return rows;
    }

    // ── The columns ──────────────────────────────────────────────────────────
    //
    // One per date, carrying the counts that let an editor pick which dates to
    // take to the draft room without reading every cell.

    function columns(o, rows) {
        return (o.dates || []).map((date, index) => {
            let filled = 0;
            let places = 0;
            let declined = 0;

            rows.forEach(row => {
                const cell = row.cells[index];
                if (!cell || !cell.applicable) return;
                cell.places.forEach(place => {
                    // A one-off row has no fixed places, so it can add to the
                    // filled count but never to the count of places wanted —
                    // otherwise a date reads as complete for having a job on it.
                    if (row.kind !== 'oneOff') places++;
                    if (!place.filled) return;
                    filled++;
                    if (place.card && place.card.declined) declined++;
                });
            });

            return {
                date: date,
                index: index,
                cancelled: o.cancelledAt(date),
                filled: filled,
                places: places,
                empty: Math.max(0, places - filled),
                declined: declined,
                // Nothing stored at all. Different from "has holes": nobody has
                // started this date, rather than started it and stopped.
                untouched: filled === 0,
            };
        });
    }

    function rosterGrid(options) {
        const o = options || {};
        if (!Array.isArray(o.dates)) {
            throw new Error('RecurringRosterCore needs options.dates — the series\' dates.');
        }

        const managed = roleRows(o);
        const oneOffs = oneOffRows(o);
        const rows = managed.concat(oneOffs);

        return {
            rows: rows,
            roleRows: managed,
            oneOffRows: oneOffs,
            columns: columns(o, rows),
        };
    }

    // ── Ticked columns, turned into something the draft room can take ────────
    //
    // ⚠ THE DRAFT ROOM WORKS IN RANGES, NOT IN SETS. It resolves its dates from
    // the recurrence rule between a start and an end, so a scattered selection
    // cannot survive the trip — the dates in the gaps come along whether or not
    // they were ticked.
    //
    // That is not a thing to fix by silently sending the range anyway. It is a
    // thing to SAY: this returns the dates that would be swept in, so the page
    // can name them before the editor commits to redrawing a Sunday they did not
    // choose. Auto-assign's own "what to do with places already filled" then
    // decides whether those keep what they have.
    function rangeFor(selected, allDates) {
        const picked = (selected || []).slice().sort();
        if (!picked.length) return null;

        const from = picked[0];
        const to = picked[picked.length - 1];
        const swept = (allDates || []).filter(
            d => d >= from && d <= to && picked.indexOf(d) === -1
        );

        return {
            from: from,
            to: to,
            count: picked.length,
            // Every date the draft room will actually open, ticked or not.
            spans: picked.length + swept.length,
            swept: swept,
            contiguous: swept.length === 0,
        };
    }

    // ── Ticked columns, turned into what emptying them would cost ────────────
    //
    // The inverse of the door above, and it must not behave like it. The draft
    // room works in RANGES and sweeps the dates in between; this works in the
    // SET that was ticked and touches nothing else. An editor who ticks two
    // Sundays a month apart to empty them must not lose the three between.
    //
    // ⚠ THE PAST IS LEFT ALONE. What is stored against a date that has been is
    // the nearest thing there is to a record of who actually turned up, and a
    // sweep across eight columns is the wrong instrument for editing it. The
    // single-date screen still does that, one date at a time, deliberately.
    //
    // Counts rather than sentences: this arranges, the page phrases.
    function wipeFor(selected, options) {
        const o = options || {};
        const at = o.assignmentsAt || (() => []);
        const today = o.today || '';

        const picked = (selected || []).slice().sort();
        if (!picked.length) return null;

        const past = picked.filter(d => today && d < today);
        const reachable = picked.filter(d => !today || d >= today);

        const dates = [];
        const people = [];
        let assignments = 0;
        let confirmed = 0;

        reachable.forEach(date => {
            const on = (at(date) || []).filter(a => a && a.personId);
            if (!on.length) return;
            dates.push(date);
            assignments += on.length;
            on.forEach(a => {
                if (a.state === 'confirmed') confirmed++;
                if (people.indexOf(a.personId) === -1) people.push(a.personId);
            });
        });

        return {
            // Exactly the dates a write would touch.
            dates: dates,
            // Ticked, but behind today, and so going nowhere.
            past: past,
            // Ticked, reachable, and already empty. Nothing to do on them, and
            // worth naming — otherwise a button that correctly does nothing
            // reads as a broken one.
            alreadyEmpty: reachable.filter(d => dates.indexOf(d) === -1),
            assignments: assignments,
            people: people,
            // Somebody said yes to these. Emptying the date un-says it, and
            // that is the part an editor should be told before, not after.
            confirmed: confirmed,
            any: dates.length > 0,
        };
    }

    // The address of the draft room. One place, so the page and any later caller
    // cannot disagree about the parameter names.
    //
    // The range is OPTIONAL, and its absence is a real request rather than a
    // missing argument: "draft this event" is what an editor wants far more
    // often than "draft exactly these dates", and it is the whole of what the
    // Auto-assign button on the Calendar used to mean. Without a range the draft
    // room applies its own default — the next stretch from tomorrow — which is
    // the only sensible reading of a series with no dates named.
    //
    // `byHand` opens the SAME room on a blank grid rather than a solved one
    // (MS-219) — not a second screen, because everything an editor does to a
    // draft after it is drawn is the thing they came to do either way, and a
    // hand-only copy of the grid would be that whole screen written twice.
    function draftRoomHref(seriesId, range, options) {
        if (!seriesId) return null;
        let at = 'auto-assign.html?series=' + encodeURIComponent(seriesId);
        if (range) {
            at += '&from=' + encodeURIComponent(range.from)
                + '&to=' + encodeURIComponent(range.to);
        }
        if (options && options.byHand) at += '&by=hand';
        return at;
    }

    // ── The window of dates ──────────────────────────────────────────────────
    //
    // Paging is over OCCURRENCES, not weeks: a fortnightly Event's eight is four
    // months of calendar, and the number that means anything to the editor is
    // its own. The caller hands in every date the rule produces across a
    // generous reach; this takes the slice.
    function windowOf(dates, anchor, size) {
        const all = (dates || []).slice().sort();
        if (!all.length) return [];

        const at = all.findIndex(d => d >= anchor);
        const start = at === -1 ? Math.max(0, all.length - size) : at;
        return all.slice(start, start + size);
    }

    // The date to anchor the previous page on: `size` before this one, or the
    // earliest there is. Returns null when already at the start, so the control
    // can be absent rather than dead.
    function previousAnchor(dates, anchor, size) {
        const all = (dates || []).slice().sort();
        const at = all.findIndex(d => d >= anchor);
        if (at <= 0) return null;
        return all[Math.max(0, at - size)];
    }

    function nextAnchor(dates, anchor, size) {
        const all = (dates || []).slice().sort();
        const at = all.findIndex(d => d >= anchor);
        if (at === -1) return null;
        const next = at + size;
        return next < all.length ? all[next] : null;
    }

    // ── What a member sees when they open a recurring event ──────────────────
    //
    // Not the grid. A member is not staffing anything, and the grid answers a
    // question they cannot act on — so opening a series tells them the two things
    // they came for: WHEN it next falls, and whether THEY are on any of those
    // dates.
    //
    // `mine` is answered against the person id rather than "is there a roster
    // here", because the same occurrence read gives an editor the WHOLE roster
    // and a member only their own row (`attachRosters`). Counting rows would make
    // this say "you are on it" to an editor about everybody else's date.
    //
    // A cancelled date is KEPT and marked rather than dropped. Somebody who turns
    // up to a cancelled midweek has been failed by a list that quietly omitted it.
    function upcoming(options) {
        const o = options || {};
        const from = o.from || '';
        const occurrenceAt = typeof o.occurrenceAt === 'function' ? o.occurrenceAt : () => null;

        return (o.dates || []).slice().sort()
            .filter(date => date >= from)
            .slice(0, o.count == null ? Infinity : o.count)
            .map(date => {
                const stored = occurrenceAt(date) || {};
                const assignments = stored.assignments || [];
                return {
                    date: date,
                    cancelled: !!stored.cancelled,
                    mine: !!o.personId
                        && assignments.some(a => a && a.personId === o.personId),
                };
            });
    }

    const RecurringRosterCore = {
        rosterGrid,
        rangeFor,
        wipeFor,
        upcoming,
        draftRoomHref,
        windowOf,
        previousAnchor,
        nextAnchor,
        initialsOf,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = RecurringRosterCore;
    } else {
        global.RecurringRosterCore = RecurringRosterCore;
    }
})(typeof globalThis !== 'undefined' ? globalThis : this);
