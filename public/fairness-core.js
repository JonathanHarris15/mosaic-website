// Fairness Core — who should serve, and why (MS-17, ADR-0020).
//
// The purpose is a rota where nobody has to remember who did it last time and
// the same three people do not carry everything.
//
// ── It solves ONE OCCURRENCE AT A TIME ───────────────────────────────────────
//
// A ten-week roster is this run ten times, each reading a window that has rolled
// forward to include the weeks already drafted. That is not an optimisation, it
// is the only shape that works: by ADR-0018 and ADR-0019 no Involvement exists
// for a date that has not happened, so anything that ranks against history alone
// returns the SAME answer for every date in a range and the same person tops all
// ten. Stepping is also what removes any need for a separate "planned but not
// served" input — last week's pick is simply part of this week's history.
//
// ── Two measures, doing different jobs ───────────────────────────────────────
//
//   LOAD    — how much a person is carrying this season: Σ intensity over the
//             window. Because intensity is measured in weeks of rest owed
//             (see [[Role intensity]]), load lands in the same unit as the
//             window, so `load ≥ window` is a real burnout line with no tuning
//             constant to guess at. LOAD DECIDES WHO IS CONSIDERED.
//
//   RECENCY — occurrences since they last held THIS Role, capped at the window.
//             RECENCY DECIDES WHO GETS WHICH ROLE among those considered.
//
// They are deliberately NOT combined into one weighted score. That was tried:
// the weight is unguessable, has no feedback loop, and produces a number nobody
// can explain to the person it passed over.
//
// ── What this module is not ──────────────────────────────────────────────────
//
// ELIGIBILITY LIVES IN roles-core AND IS NEVER RESTATED HERE. This module asks
// that one questions and accepts its answers. A private copy of the restriction
// rules is a copy that drifts from the picker's, and the first anyone would know
// is a married couple on the Kids rota that the manual screen would have
// refused.
//
// Loaded as a classic <script> (window.FairnessCore) and exported for Node tests.

(function (global) {
    'use strict';

    // ── The window ────────────────────────────────────────────────────────────
    //
    // ⚠ THE WINDOW COMES FROM THE RECURRENCE RULE, NOT FROM THE SERVE LOG.
    //
    // Three quiet weeks where nobody served still happened. A window built by
    // looking at which dates appear in the log would silently skip them, quietly
    // stretching "the last 12 Sundays" back over a longer stretch of calendar
    // than it claims — and every load and recency computed from it would be
    // wrong in a way that still looks perfectly reasonable.
    //
    // `occurrenceDates` is therefore the series' own dates, most recent first,
    // ending just before the occurrence being staffed.
    function windowDates(occurrenceDates, windowSize) {
        return (occurrenceDates || []).slice(0, windowSize);
    }

    // Where a date sits in the window: 0 is the most recent occurrence. A date
    // outside the window has no position.
    function positionsOf(dates) {
        const at = {};
        (dates || []).forEach((date, i) => {
            if (at[date] === undefined) at[date] = i;
        });
        return at;
    }

    const withinWindow = (record, at) => (
        record && at[record.serviceDate] !== undefined
    );

    // ── Load ──────────────────────────────────────────────────────────────────
    //
    // `intensityOf(record)` is supplied by the caller, which wires
    // `EventsCore.roleIntensity`. It is a function rather than a slug→number map
    // on purpose: intensity has three storage homes, and every one-off Role
    // shares the single reserved `one_off` slug while carrying its own value on
    // its own Event, so no map keyed by slug could tell two of them apart.
    //
    // Counts EVERYTHING inside the window — the Role being filled included,
    // liturgical Roles included, one-off Roles included. Excluding the Role
    // being filled was tried and is wrong: somebody who has done nothing but
    // Coffee, heavily, would read as unloaded for Coffee.
    function loadOf(involvements, dates, intensityOf) {
        const at = positionsOf(dates);
        const cost = intensityOf || (() => 1);
        const load = {};

        (involvements || []).forEach(record => {
            if (!record || !record.personId || !withinWindow(record, at)) return;
            load[record.personId] = (load[record.personId] || 0) + cost(record);
        });

        return load;
    }

    // Over their rest budget. Load is denominated in weeks and the window is a
    // number of occurrences, so the two are directly comparable — which is the
    // whole reason intensity is expressed as rest owed rather than as a weight.
    function isSpent(load, windowSize) {
        return (load || 0) >= windowSize;
    }

    // ── Recency ───────────────────────────────────────────────────────────────

    // Occurrences since each person last held this Role. Absent from the result
    // means they have not held it inside the window at all.
    function recencyOf(involvements, dates, roleSlug) {
        const at = positionsOf(dates);
        const recency = {};

        (involvements || []).forEach(record => {
            if (!record || !record.personId || record.type !== roleSlug) return;
            if (!withinWindow(record, at)) return;

            const position = at[record.serviceDate];
            const best = recency[record.personId];
            if (best === undefined || position < best) recency[record.personId] = position;
        });

        return recency;
    }

    // Read a recency, capped at the window. Never having held the Role reads the
    // SAME as not having held it all season — deliberately, so that a Role
    // recruits from people who have not done it lately without letting ancient
    // history overwhelm the load gate that does the real work.
    function recencyFor(recency, personId, windowSize) {
        const found = (recency || {})[personId];
        return found === undefined ? windowSize : Math.min(found, windowSize);
    }

    // ── The pool ──────────────────────────────────────────────────────────────
    //
    // Who is even considered, least-loaded first.
    //
    // `people` must already have been through `RolesCore.assignablePeople` —
    // whether someone has left, or is hidden from this viewer, is a judgment
    // this module does not make and must not duplicate. `RolesCore.candidatesFor`
    // is the backstop when the solver seats somebody, so an Inactive Person who
    // slipped in here still could not be given a slot.
    //
    // Membership is likewise NOT a fairness concept. A church that wants a Role
    // kept to Members says so with a `requireTag` rule on that Role, because
    // Kids and coffee should not have to share one answer.
    //
    // Two liturgical exclusions, both hard:
    //
    //   1. Holding a liturgical Role AT THIS OCCURRENCE. You cannot preach and
    //      run the sound desk.
    //   2. Having held one in at least HALF the window. This looks redundant
    //      once liturgy carries intensity — the man who preaches every week
    //      sinks on load alone — and it is kept because load ranking is a
    //      TENDENCY and this is a GUARANTEE. In a thin season everyone's load is
    //      high, and "lowest of a bad lot" could still float the preacher up.
    //      "We never roster the regular preacher for setup" is a sentence you
    //      can say to a congregation; a tendency is not.
    const LITURGICAL_SHARE = 0.5;

    function pool(options) {
        const o = options || {};
        const windowSize = o.windowSize;
        const dates = windowDates(o.occurrenceDates, windowSize);
        const at = positionsOf(dates);
        const history = o.history || [];

        const load = loadOf(history, dates, o.intensityOf);

        // How many occurrences in the window each person held any liturgical
        // Role on. Counted by DATE, not by record: leading music and praying on
        // one Sunday is one Sunday of liturgy, not two.
        const liturgicalSlugs = o.liturgicalSlugs || [];
        const liturgicalDates = {};
        history.forEach(record => {
            if (!record || !record.personId || !withinWindow(record, at)) return;
            if (liturgicalSlugs.indexOf(record.type) === -1) return;
            const seen = liturgicalDates[record.personId] || (liturgicalDates[record.personId] = {});
            seen[record.serviceDate] = true;
        });

        const holdingNow = o.liturgicalHolders || [];
        const cliff = dates.length * LITURGICAL_SHARE;

        const candidates = (o.people || [])
            .filter(person => {
                if (!person || !person.id) return false;
                if (holdingNow.indexOf(person.id) !== -1) return false;
                return Object.keys(liturgicalDates[person.id] || {}).length < cliff;
            })
            .map(person => ({
                personId: person.id,
                load: load[person.id] || 0,
                spent: isSpent(load[person.id] || 0, windowSize),
            }))
            .sort((a, b) => a.load - b.load);

        return {
            candidates: candidates,
            windowDates: dates,
            // A signal about the church rather than about the algorithm: being
            // short of volunteers should be said out loud, not quietly absorbed
            // into a rota that looks fine.
            allSpent: candidates.length > 0 && candidates.every(c => c.spent),
        };
    }

    const FairnessCore = {
        LITURGICAL_SHARE,
        // the window
        windowDates,
        // load
        loadOf,
        isSpent,
        // recency
        recencyOf,
        recencyFor,
        // who is considered
        pool,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = FairnessCore;
    }
    if (global) {
        global.FairnessCore = FairnessCore;
    }
})(typeof window !== 'undefined' ? window : null);
