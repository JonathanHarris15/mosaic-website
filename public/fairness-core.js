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

    // ── Nudging a load by hand ────────────────────────────────────────────────
    //
    // A claim on somebody's week that the church has no record of: a new baby, a
    // parent in hospital, a fortnight abroad. The system cannot know it and
    // cannot infer it, so the editor says it, in the one unit that already
    // means something here — weeks of rest owed.
    //
    // ⚠ A NUDGE IS NOT A SERVE, and the two must never be confused. A seeded
    // serve says "they held this Role on this date": it moves load AND recency,
    // and the solve can see which Role. A nudge says only "they are carrying
    // more than the record shows". Recording a nudge as a serve would invent a
    // Sunday that did not happen; recording a serve as a nudge would leave the
    // solve believing they had never held the Role.
    //
    // Never below zero. A negative load is not a person with room to spare, it
    // is a number that would sort above people who genuinely have none.
    function withNudges(load, nudges) {
        if (!nudges) return load || {};
        const out = Object.assign({}, load || {});

        Object.keys(nudges).forEach(personId => {
            const by = Number(nudges[personId]);
            if (!isFinite(by) || by === 0) return;
            out[personId] = Math.max(0, (out[personId] || 0) + by);
        });

        return out;
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

        const load = withNudges(loadOf(history, dates, o.intensityOf), o.nudges);

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

    // ── The tie-break ─────────────────────────────────────────────────────────
    //
    // Genuine ties are common — two people who have never done a Role and carry
    // nothing score identically — so something has to break them, and the choice
    // matters more than it looks.
    //
    // Alphabetical is a NEW UNFAIRNESS wearing fairness's clothes: Aaron gets
    // everything, for ever. Random is fair but makes a roster irreproducible,
    // and a draft that redraws differently on Wednesday than it did on Tuesday
    // cannot be reviewed — nobody can tell whether the data changed or the dice
    // did.
    //
    // So: a hash of the person and the occurrence. Stable for a given week, so a
    // re-run is identical; different from week to week, so the same names are
    // not favoured. Small and deterministic on purpose — this is a shuffle, not
    // a security primitive.
    function tieBreak(personId, seriesId, date) {
        const key = String(personId) + '|' + String(seriesId) + '|' + String(date);
        let hash = 2166136261;
        for (let i = 0; i < key.length; i++) {
            hash ^= key.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
        }
        return (hash >>> 0) / 4294967296;
    }

    // ── The solve ─────────────────────────────────────────────────────────────
    //
    // Staff a whole occurrence, maximising total recency across the roster.
    //
    // ⚠ WHY THIS IS A SEARCH AND NOT A SORT.
    //
    // Three of the five restriction kinds — notTogether, notSameGroup and
    // sameGroup — constrain COMBINATIONS, not individuals: whether a person may
    // be seated depends on who else was seated. No ordering of people can
    // express that, and neither can max-weight bipartite matching, which is why
    // matching was rejected as WRONG rather than merely weaker. It would return
    // rosters putting a married couple in Kids, which the manual picker refuses.
    //
    // Backtracking fits the existing model exactly: `RolesCore.ineligibilityFor`
    // already takes who is seated and judges the next candidate against them,
    // which IS the signature a search needs. Calling it — rather than
    // reimplementing it — is also what guarantees the solver and the picker can
    // never disagree.
    //
    // The problem stays small because the coupling splits: relationship rules
    // are scoped to one Role, so each Role's slots are an independent
    // sub-problem, and exclusivity is the only thread tying the Roles together.

    // How much slack the pool starts with. Cutting it to exactly the number of
    // spots manufactures failures the congregation does not actually have — six
    // spots, one DBS-checked person among the six, two Kids slots, and no legal
    // roster exists while the seventh-least-loaded person is DBS-checked and
    // sitting right there.
    const POOL_SLACK = 4;

    const slotsOf = role => (role && Array.isArray(role.slots) ? role.slots : []);

    function spotCount(roles) {
        return (roles || []).reduce((n, role) => n + slotsOf(role).length, 0);
    }

    // Seat one Role's slots, filling as many as possible and, among rosters that
    // fill the same number, taking the one with the best total recency.
    //
    // FILLING MORE ALWAYS BEATS FILLING BETTER. A Role that can seat one of its
    // two slots must seat that one and report the other, not come back empty:
    // a half-staffed Coffee rota is a real rota, and an editor can see the gap.
    // Leaving a slot empty is therefore a branch of the search like any other,
    // which is also what lets a cohesive `sameGroup` Role stop early rather than
    // fail outright.
    //
    // SOME PLACES MAY ALREADY BE TAKEN. `o.held` is the seats an editor has
    // already filled by hand in this Role, and the search fills what is left
    // around them. They are seeded into the walk rather than merely subtracted
    // from the slot list, because `notTogether` and its siblings judge a
    // candidate against WHO IS ALREADY SEATED — and a rule that cannot see the
    // hand-made half of a roster would cheerfully seat somebody's husband
    // beside them. The bound is unaffected: held seats appear in every branch.
    function solveRole(role, options) {
        const o = options;
        const heldSeats = o.held || [];
        const taken = {};
        heldSeats.forEach(seat => { taken[seat.slotId] = true; });
        const slots = slotsOf(role).filter(slot => !taken[slot.id]);
        const best = { seats: heldSeats.slice(), score: -1 };
        let lastReason = null;

        // The order candidates are tried in NEVER CHANGES within a Role: both
        // keys — this Role's recency, and the tie-break — depend only on the
        // person, not on who else is already seated. So it is computed once here
        // rather than rebuilt (and re-hashed) at every node of the search.
        const order = o.people
            .map(person => ({ personId: person.id, recency: o.recencyFor(person.id) }))
            .sort((a, b) => (
                b.recency - a.recency ||
                o.tieBreak(a.personId) - o.tieBreak(b.personId)
            ));

        // The best score the next `n` slots could possibly reach: the n highest
        // recencies on offer. Bounding with `n × windowSize` instead would be
        // correct but far looser, and it goes slack in exactly the case the
        // bound exists for — a Role with several slots and a varied history,
        // where recencies differ and nothing saturates at the window.
        const bestRemaining = [0];
        order.forEach(candidate => {
            bestRemaining.push(bestRemaining[bestRemaining.length - 1] + candidate.recency);
        });
        const ceilingFor = n => bestRemaining[Math.min(n, order.length)];

        const better = (seats, score) => (
            seats.length > best.seats.length ||
            (seats.length === best.seats.length && score > best.score)
        );

        const walk = (index, seats, score) => {
            if (index === slots.length) {
                if (better(seats, score)) {
                    best.seats = seats.slice();
                    best.score = score;
                }
                return;
            }

            // Branch and bound. Filling more slots is the first thing compared,
            // so a branch that cannot reach the best count is dead however good
            // its recency would be; only on an equal count does the score bound
            // decide.
            const left = slots.length - index;
            if (seats.length + left < best.seats.length) return;
            if (seats.length + left === best.seats.length &&
                score + ceilingFor(left) <= best.score) return;

            const slot = slots[index];
            // `seats` is passed straight through as `assigned`: roles-core reads
            // only slotId and personId off it, and it is what makes anyone
            // already seated in this Role come back ALREADY_ASSIGNED — so there
            // is no second list of taken people to keep in step with it.
            const judged = o.candidatesFor(role, slot, {
                people: o.people,
                relationships: o.relationships,
                groups: o.groups,
                assigned: seats,
                assignedElsewhere: o.assignedElsewhere,
                // The Event's rules about a PAIR of Roles (MS-221). The SECOND
                // thread tying the Roles together — exclusivity was the first —
                // and it reads the same `assignedElsewhere` that one does.
                crossRoleRules: o.crossRoleRules,
                // Who said they would not be here on this date (MS-188). Passed
                // through rather than filtered out of `people` up front, so an
                // unfilled place can still name the reason — "everybody left is
                // away" is an answer, and a silently short lineup is not.
                //
                // This is where the solve's half of the Away asymmetry lives: a
                // solve seats only `eligible` people, so it can never place
                // somebody who is away, while an editor doing it by hand still
                // can and is warned.
                awayPersonIds: o.awayPersonIds,
            });

            const allowed = {};
            let blocked = null;
            judged.forEach(c => {
                if (c.eligible) allowed[c.personId] = true;
                else if (!blocked) blocked = c;
            });

            // Remember why, so an unfilled slot can name the rule rather than
            // shrugging.
            if (!Object.keys(allowed).length && blocked) lastReason = blocked;

            order.forEach(candidate => {
                if (!allowed[candidate.personId]) return;
                walk(
                    index + 1,
                    seats.concat([{
                        roleSlug: role.slug,
                        slotId: slot.id,
                        personId: candidate.personId,
                        recency: candidate.recency,
                    }]),
                    score + candidate.recency
                );
            });

            // …and the branch where this slot stays empty.
            walk(index + 1, seats, score);
        };

        walk(0, heldSeats.slice(), 0);

        const filledIds = best.seats.map(s => s.slotId);
        return {
            seats: best.seats,
            gaps: slots.filter(slot => filledIds.indexOf(slot.id) === -1),
            reason: lastReason,
        };
    }

    function solve(options) {
        const o = options || {};
        const roles = o.roles || [];
        // Not defaulted. The window is the unit load is measured against, so a
        // second copy of the number here would let "spent" quietly mean two
        // different things depending on which module you read.
        const windowSize = o.windowSize;
        if (typeof windowSize !== 'number') {
            throw new Error(
                'FairnessCore.solve needs options.windowSize — use ' +
                'EventsCore.fairnessWindowOf(series), which owns the default.'
            );
        }

        // The tie-break hashes a string, and the search asks for the same few
        // people over and over. Memoised per solve, since seriesId and date are
        // fixed for the whole run.
        const seeds = {};
        const memoTieBreak = personId => {
            if (seeds[personId] === undefined) {
                seeds[personId] = tieBreak(personId, o.seriesId, o.date);
            }
            return seeds[personId];
        };

        // Injected, not imported. Like every other *-core module here this one
        // requires nothing — and passing the judge in makes the relationship
        // visible at each call site: fairness ASKS roles-core and accepts its
        // answers. It never gets to hold its own opinion about eligibility.
        const candidatesFor = o.candidatesFor;
        if (typeof candidatesFor !== 'function') {
            throw new Error(
                'FairnessCore.solve needs RolesCore.candidatesFor passed as ' +
                'options.candidatesFor — eligibility is never decided here.'
            );
        }

        const ranked = pool({
            people: o.people,
            history: o.history,
            occurrenceDates: o.occurrenceDates,
            windowSize: windowSize,
            intensityOf: o.intensityOf,
            nudges: o.nudges,
            liturgicalSlugs: o.liturgicalSlugs,
            liturgicalHolders: o.liturgicalHolders,
        });

        // Recency is per Role, so it is computed once per Role rather than once
        // per candidate — the same numbers are asked for over and over inside
        // the search.
        const recency = {};
        roles.forEach(role => {
            recency[role.slug] = recencyOf(o.history, ranked.windowDates, role.slug);
        });

        const byId = {};
        (o.people || []).forEach(p => { if (p && p.id) byId[p.id] = p; });

        const start = Math.min(
            spotCount(roles) + POOL_SLACK,
            ranked.candidates.length
        );

        // Places an editor has already filled by hand. The solve fills what is
        // left around them and never moves one. Stamped with their own Role's
        // exclusivity here rather than trusted from the caller, so a held seat
        // and a solved one are judged by exactly the same rule.
        const flagOf = {};
        roles.forEach(role => { flagOf[role.slug] = role.allowsAnotherRole === true; });
        const preset = (o.seated || []).map(seat => Object.assign({}, seat, {
            allowsAnotherRole: flagOf[seat.roleSlug] === true,
        }));

        let filled = [];
        let unfilled = [];
        let used = 0;

        // Widen rather than fail: pull in the next-least-loaded person and solve
        // again, until it is fillable or the pool is exhausted. A spot that is
        // still unfillable is returned EMPTY WITH A REASON — never quietly
        // dropped, because a hole discovered on a Sunday morning is the failure
        // this whole feature exists to prevent.
        for (let size = start; size <= ranked.candidates.length; size++) {
            const people = ranked.candidates.slice(0, size)
                .map(c => byId[c.personId])
                .filter(Boolean);

            // Starts holding every hand-made seat, in every Role, so exclusivity
            // reads the same whatever order the Roles are solved in — a held
            // Setup seat blocks the same person from Coffee even when Coffee
            // goes first. Solved seats join it as they are taken.
            const seated = preset.slice();
            const gaps = [];

            roles.forEach(role => {
                const held = preset.filter(seat => seat.roleSlug === role.slug);
                const attempt = solveRole(role, {
                    people: people,
                    relationships: o.relationships,
                    groups: o.groups,
                    recencyFor: personId => recencyFor(recency[role.slug], personId, windowSize),
                    candidatesFor: candidatesFor,
                    tieBreak: memoTieBreak,
                    held: held,
                    awayPersonIds: o.awayPersonIds,
                    // Exclusivity was the one thread tying the Roles together;
                    // MS-221's Cross-Role Rules are the second, and both read
                    // this same list. Each seat carries its own Role's flag,
                    // stamped when it was taken — nothing has to look a Role
                    // back up by slug.
                    //
                    // ⚠ Roles are solved in order, so a Cross-Role Rule bites
                    // the LATER Role of the pair: the first is seated with
                    // nobody to conflict with yet. That is the same answer a
                    // person filling the rota by hand would reach, and the
                    // roster judge checks the finished lineup either way round.
                    assignedElsewhere: seated,
                    crossRoleRules: o.crossRoleRules,
                });

                // `attempt.seats` gives back the held ones too, since the search
                // filled in around them. Only the newly-taken places are added,
                // or a held seat would be counted twice and its holder would
                // read as already carrying two Roles.
                const wasHeld = {};
                held.forEach(seat => { wasHeld[seat.slotId] = true; });
                attempt.seats.forEach(seat => {
                    if (wasHeld[seat.slotId]) return;
                    seated.push(Object.assign({
                        allowsAnotherRole: role.allowsAnotherRole === true,
                    }, seat));
                });
                attempt.gaps.forEach(slot => gaps.push({
                    roleSlug: role.slug,
                    slotId: slot.id,
                    reason: (attempt.reason && attempt.reason.reason) || null,
                    detail: attempt.reason || null,
                }));
            });

            filled = seated;
            unfilled = gaps;
            used = size;
            if (!gaps.length) break;
        }

        return {
            filled: filled,
            unfilled: unfilled,
            // Both of these are signals about the CHURCH rather than about the
            // algorithm — being short of volunteers, or having restrictions
            // tighter than anyone realised — and both should reach the user
            // rather than being absorbed into a rota that looks fine.
            widened: Math.max(0, used - start),
            allSpent: ranked.allSpent,
            pool: ranked.candidates,
        };
    }

    const FairnessCore = {
        LITURGICAL_SHARE,
        POOL_SLACK,
        // the window
        windowDates,
        // load
        loadOf,
        withNudges,
        isSpent,
        // recency
        recencyOf,
        recencyFor,
        // who is considered
        pool,
        // the solve
        tieBreak,
        solve,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = FairnessCore;
    }
    if (global) {
        global.FairnessCore = FairnessCore;
    }
})(typeof window !== 'undefined' ? window : null);
