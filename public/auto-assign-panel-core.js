// Auto-assign Panel Core — the directory, and why this person is here (MS-182).
//
// The panel beside the grid does two jobs, one at a time: search the church and
// drag anyone in, or explain a placement that is already there.
//
// ── The load section is a LIST, not a category split ─────────────────────────
//
// The design divides load into Sunday / midweek / one-off bars. The model does
// not produce that. Load is a single number — the sum of the intensity of
// everything a person did inside the window (ADR-0020 §2) — and there is no
// category axis to split it on. Three plausible-looking bars that mean nothing
// is worse than no bars.
//
// So what goes there is the real breakdown: every serve inside the window, with
// its Role, its date and its intensity. The number then explains itself. It is
// six because of these six things, rather than because somebody typed six.
//
// ⚠ AND THAT LIST IS THE SEEDING CONTROL. These Roles launch cold: nobody has
// any history, everybody reads as equally fresh, and the first draft is settled
// almost entirely by the tie-break shuffle. An editor has to be able to say
// "Ann has been doing coffee since June" — and they say it by RECORDING A
// SERVE, never by typing a load figure. Fairness has two dials. A figure moves
// load and leaves recency blind, so the burnout gate is fixed while the
// rotation still believes Ann has never held the Role.
//
// Loaded as a classic <script> (window.AutoAssignPanelCore) and exported for Node.

(function (global) {
    'use strict';

    const initialsOf = name => {
        const words = String(name || '').trim().split(/\s+/).filter(Boolean);
        if (!words.length) return '?';
        const last = words.length > 1 ? words[words.length - 1][0] : '';
        return (words[0][0] + last).toUpperCase();
    };

    const matches = (name, query) => {
        const q = String(query || '').trim().toLowerCase();
        if (!q) return true;
        return String(name || '').toLowerCase().indexOf(q) !== -1;
    };

    // ── The directory ────────────────────────────────────────────────────────

    // Everyone who may be offered at all, least-loaded first.
    //
    // The list arrives already filtered — an Inactive or tag-hidden Person never
    // reaches it — so there is no unavailable state to draw. What it does carry
    // is the same load reading the grid cards use, because a directory that
    // ranked people differently from the grid would be quietly arguing with it.
    function directory(options) {
        const o = options || {};
        const budget = o.windowSize || 0;

        const rows = (o.people || [])
            .filter(p => p && p.id && matches(p.name, o.query))
            .map(person => {
                const load = o.loadAt(person.id);
                return {
                    personId: person.id,
                    name: person.name || 'Someone',
                    initials: initialsOf(person.name),
                    load: load,
                    budget: budget,
                    spent: budget > 0 && load >= budget,
                    // How many places in the range they already hold. Not a bar
                    // to stop a drag — the editor decides — but the thing they
                    // would want to know before making it a third.
                    serving: o.servingCount ? o.servingCount(person.id) : 0,
                };
            })
            .sort((a, b) => a.load - b.load || a.name.localeCompare(b.name));

        return { rows: rows, count: rows.length };
    }

    // ── Why this placement ───────────────────────────────────────────────────

    // Every serve inside the window, newest first. This is what the load number
    // is made of, and the thing an editor edits to seed a cold Role.
    function servesInWindow(options) {
        const o = options || {};
        const inWindow = {};
        (o.windowDates || []).forEach(date => { inWindow[date] = true; });

        return (o.history || [])
            .filter(r => r && r.personId === o.personId && inWindow[r.serviceDate])
            .map(record => ({
                id: record.id || null,
                roleSlug: record.type,
                roleName: o.roleNameOf(record.type),
                date: record.serviceDate,
                dateLabel: o.labelOf(record.serviceDate),
                intensity: o.intensityOf(record),
                // Only a record the editor added here can be taken back. One
                // written by a Sunday that actually happened is a fact, and the
                // place to argue with it is the People's Directory.
                removable: !!record.id && record.seeded === true,
            }))
            .sort((a, b) => (a.date < b.date ? 1 : (a.date > b.date ? -1 : 0)));
    }

    // Everything this person is down for across the whole range, with the one
    // being looked at marked. Without it the editor has to scan every column to
    // find out whether moving somebody here overloads them somewhere else.
    function acrossRange(options) {
        const o = options || {};
        const here = o.selected || {};
        const out = [];

        (o.dates || []).forEach(day => {
            (day.seats || []).forEach(seat => {
                if (!seat || seat.personId !== o.personId) return;
                out.push({
                    date: day.date,
                    dateLabel: o.labelOf(day.date),
                    roleSlug: seat.roleSlug,
                    roleName: o.roleNameOf(seat.roleSlug),
                    slotId: seat.slotId,
                    selected: day.date === here.date
                        && seat.roleSlug === here.roleSlug
                        && String(seat.slotId) === String(here.slotId),
                });
            });
        });

        return out;
    }

    // Who else was in the running for this place, and why each lost.
    //
    // Not a stored decision — nothing records the runners-up — so it is the
    // eligibility check asked again for this place against the roster as it
    // stands now. Which means it stays true after the editor moves things
    // about, rather than describing a solve that has since been overwritten.
    function considered(options) {
        const o = options || {};
        const seated = o.seatedPersonId;

        return (o.candidates || [])
            .filter(c => c && c.personId && c.personId !== seated)
            .map(candidate => ({
                personId: candidate.personId,
                name: o.nameOf(candidate.personId),
                initials: initialsOf(o.nameOf(candidate.personId)),
                eligible: candidate.eligible === true,
                load: o.loadAt ? o.loadAt(candidate.personId) : 0,
                reason: candidate.eligible ? null : o.reasonText(candidate),
            }))
            .sort((a, b) => (
                (a.eligible === b.eligible) ? (a.load - b.load) : (a.eligible ? -1 : 1)
            ));
    }

    const AutoAssignPanelCore = {
        initialsOf,
        directory,
        servesInWindow,
        acrossRange,
        considered,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = AutoAssignPanelCore;
    }
    if (global) {
        global.AutoAssignPanelCore = AutoAssignPanelCore;
    }
})(typeof window !== 'undefined' ? window : null);
