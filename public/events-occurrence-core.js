// Events Occurrence Core — the pure model for Event occurrences, Assignments,
// and Event visibility (ADR-0018, MS-99).
//
// `events-core.js` is the SERIES layer: the recurring thing that owns Roles.
// This is the layer below it — the dated instances, the people put into them,
// and who is allowed to see them.
//
// Five things it knows:
//
//   1. Resolving occurrences. A series carries a recurrence rule; the dates come
//      from the rule alone. Occurrences are SPARSE — a document exists only once
//      something lands on a date, so an untouched date still appears in the
//      Calendar, simply empty. Ids are deterministic (`{seriesId}_{date}`) so two
//      editors clicking at once cannot create the same occurrence twice.
//
//   2. The assignment state machine. Pending → Confirmed / Declined, every change
//      recording who set it and when. That record is first-class, not a display
//      flag, because MS-20 hands this state machine to the congregation.
//
//   3. One assignment per slot. Assigning a replacement OVERWRITES the previous
//      one. This is what makes a declined slot behave correctly with no extra
//      bookkeeping: the decliner still occupies the slot (so it reads as flagged,
//      not empty), and the moment somebody replaces them they are gone.
//
//   4. The participant list. Who currently holds a Role here — including people
//      who declined, because they keep their place until replaced. This is what
//      makes `participant` visibility checkable in a security rule.
//
//   5. The conversion rules. Once the date has passed: Confirmed becomes a serve
//      record, Declined never does, and Pending becomes an open question that an
//      editor answers. An unanswered question stays unanswered permanently and
//      never counts as serving.
//
// AN ASSIGNMENT IS THE PLAN; AN INVOLVEMENT IS THE FACT. Nothing in this module
// ever writes an Involvement for a date that has not happened.
//
// Deliberately self-contained — like every other *-core module here, it requires
// nothing and returns new objects rather than mutating its inputs.
//
// Loaded as a classic <script> (window.EventsOccurrenceCore) and exported for
// Node tests.

(function (global) {
    'use strict';

    // ── Vocabulary ────────────────────────────────────────────────────────────

    // The recurrence patterns a church actually uses. Deliberately NOT a general
    // RRULE editor — "every third Tuesday except in Lent" is a calendar app's
    // problem, not a church's.
    const FREQ = Object.freeze({
        ONCE: 'once',
        WEEKLY: 'weekly',
        FORTNIGHTLY: 'fortnightly',
        MONTHLY: 'monthly',
    });

    // How a pattern stops.
    const ENDS = Object.freeze({
        NEVER: 'never',
        ON_DATE: 'onDate',
        AFTER_COUNT: 'afterCount',
    });

    // The three states of an Assignment. Pending is the resting state and the
    // default — if every unconfirmed assignment shouts, nothing does.
    const STATES = Object.freeze({
        PENDING: 'pending',
        CONFIRMED: 'confirmed',
        DECLINED: 'declined',
    });

    const STATE_VALUES = Object.freeze([STATES.PENDING, STATES.CONFIRMED, STATES.DECLINED]);

    // The ONE reserved slug every one-off Role's Involvement is written under.
    // Never an invented slug per job: `RolesCore.roleBySlug` resolves names only
    // for liturgical Roles and stored Role Definitions, so an invented slug would
    // render as nothing on every surface showing serve history (ADR-0018 §4).
    const ONE_OFF_SLUG = 'one_off';

    // The visibility ladder, lowest rung first (ADR-0018 §5).
    const VISIBILITY_ORDER = Object.freeze([
        'public', 'member', 'participant', 'editor', 'elder',
    ]);

    // The Sunday Service is permanently public. Restated here rather than
    // imported, because the *-core modules are deliberately independent of one
    // another — and a test asserts this agrees with EventsCore.SUNDAY_SERVICE_ID,
    // precisely because a duplicated constant is a constant that can drift.
    const SUNDAY_SERVICE_ID = 'sunday_service';

    // Which rungs a Permission Level satisfies BY RANK. `participant` is not
    // answerable by rank for a member — that is the whole reason the Calendar
    // runs a second `array-contains` query — but everyone above participant sees
    // participant-level Events without holding a Role.
    const RUNGS_BY_RANK = Object.freeze({
        viewer: ['public'],
        member: ['public', 'member'],
        editor: ['public', 'member', 'participant', 'editor'],
        admin: ['public', 'member', 'participant', 'editor'],
        elder: ['public', 'member', 'participant', 'editor', 'elder'],
        super_admin: ['public', 'member', 'participant', 'editor', 'elder'],
    });

    // ── Dates ─────────────────────────────────────────────────────────────────
    //
    // Local time throughout, never UTC — building a date key from toISOString()
    // shifts it by a day for anyone west of GMT in the evening. Same rule as
    // date-utils.js, restated to keep this module dependency-free.

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

    function weekdayOf(dateStr) {
        return parseDate(dateStr).getDay();
    }

    const isDateStr = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));

    // ── Resolving occurrences from a recurrence rule ──────────────────────────

    // A runaway guard. A pattern with no end date, asked for a wide range, must
    // terminate on the range rather than on the model's patience — but a
    // malformed rule must not spin forever either.
    const MAX_OCCURRENCES = 2000;

    function endsOf(rule) {
        const e = (rule && rule.ends) || {};
        return { kind: e.kind || ENDS.NEVER, date: e.date, count: e.count };
    }

    // Which nth weekday-of-the-month a date is: 2026-07-01 (a Wednesday) is the
    // 1st Wednesday, so `nthWeekdayOf` returns 1.
    function nthWeekdayOf(dateStr) {
        return Math.floor((parseDate(dateStr).getDate() - 1) / 7) + 1;
    }

    // The date of the nth given weekday in a month, or null when the month has no
    // such day. A month with only four Wednesdays simply has no fifth one — the
    // gathering does not fall back to the fourth, because a gathering that moves
    // a week is a different gathering.
    function nthWeekdayInMonth(year, monthIndex, weekday, nth) {
        const first = new Date(year, monthIndex, 1);
        const offset = (weekday - first.getDay() + 7) % 7;
        const day = 1 + offset + (nth - 1) * 7;
        const candidate = new Date(year, monthIndex, day);
        if (candidate.getMonth() !== monthIndex) return null;
        return formatDate(candidate);
    }

    // Every date this rule produces between `from` and `to` inclusive (both
    // YYYY-MM-DD). Depends on NOTHING but the rule — no stored occurrence
    // records — which is what lets an untouched date still appear.
    function datesBetween(rule, from, to) {
        if (!rule || !isDateStr(rule.startDate) || !isDateStr(from) || !isDateStr(to)) return [];
        if (from > to) return [];

        const start = rule.startDate;
        const ends = endsOf(rule);

        // A one-off is its own single date. Nothing to iterate.
        if (!rule.freq || rule.freq === FREQ.ONCE) {
            return (start >= from && start <= to) ? [start] : [];
        }

        // The last date worth generating. `afterCount` is counted from the rule's
        // START, not from the window — asking for a later window must not restart
        // the count and conjure occurrences past the end of the series.
        let horizon = to;
        if (ends.kind === ENDS.ON_DATE && isDateStr(ends.date) && ends.date < horizon) {
            horizon = ends.date;
        }
        const limit = (ends.kind === ENDS.AFTER_COUNT && Number.isFinite(ends.count))
            ? Math.max(0, ends.count)
            : Infinity;

        // The weekday the pattern falls on. Given explicitly by the recurrence
        // editor; derived from the start date when it is not.
        const weekday = Number.isInteger(rule.weekday) ? rule.weekday : weekdayOf(start);

        const all = [];

        if (rule.freq === FREQ.WEEKLY || rule.freq === FREQ.FORTNIGHTLY) {
            const step = rule.freq === FREQ.FORTNIGHTLY ? 14 : 7;
            // Anchor on the first matching weekday on or after the start date, so
            // a rule whose start date is not itself that weekday still lines up.
            let cursor = addDays(start, (weekday - weekdayOf(start) + 7) % 7);
            let guard = 0;
            while (cursor <= horizon && all.length < limit && guard++ < MAX_OCCURRENCES) {
                all.push(cursor);
                cursor = addDays(cursor, step);
            }
        } else if (rule.freq === FREQ.MONTHLY) {
            // Monthly means "the first Wednesday", not "the 1st of the month" —
            // the same date each month drifts across the week, which is not what
            // a monthly gathering is.
            const anchor = parseDate(start);
            const nth = nthWeekdayOf(start);
            let year = anchor.getFullYear();
            let month = anchor.getMonth();
            let guard = 0;
            while (all.length < limit && guard++ < MAX_OCCURRENCES) {
                const date = nthWeekdayInMonth(year, month, weekday, nth);
                if (date && date > horizon) break;
                if (date && date >= start) all.push(date);
                month += 1;
                if (month > 11) { month = 0; year += 1; }
                // A month with no nth weekday is skipped, but the loop must still
                // be able to reach the horizon past it.
                if (new Date(year, month, 1) > parseDate(horizon)) break;
            }
        }

        return all.filter(d => d >= from && d <= to);
    }

    // ── Occurrence identity ───────────────────────────────────────────────────

    // Deterministic, so two editors cannot create the same occurrence twice. A
    // one-off Event belongs to no series and takes an auto-id, so it has no
    // deterministic id to compute — hence null rather than a fabricated one.
    function occurrenceId(seriesId, date) {
        if (!seriesId || !isDateStr(date)) return null;
        return seriesId + '_' + date;
    }

    // The same id read back. Needed because occurrences are SPARSE: a date
    // nobody has touched has no document at all, so opening one means rebuilding
    // it from its id and its series rather than reporting it missing.
    //
    // Split at the LAST underscore, not the first — `sunday_service_2026-08-02`
    // is the id this app uses most, and a naive split reads it as the series
    // "sunday".
    function parseOccurrenceId(id) {
        const str = String(id || '');
        const at = str.lastIndexOf('_');
        if (at <= 0) return null;

        const date = str.slice(at + 1);
        const seriesId = str.slice(0, at);
        if (!seriesId || !isDateStr(date)) return null;
        return { seriesId: seriesId, date: date };
    }

    // ── A date that is not happening ─────────────────────────────────────────
    //
    // Two ways one instance stops happening on its own date: it was SKIPPED, or
    // it was MOVED to another date. Both have to leave a document behind on the
    // original date — the pattern still produces that date, and something has to
    // say otherwise — so both are markers on an occurrence rather than an
    // absence of one.
    //
    // A moved instance is deliberately NOT a cancelled one plus a new event. It
    // is the same instance on a different day, and it carries its roster with it,
    // because "postponed a fortnight" is not "cancelled, and separately somebody
    // invented a new gathering".

    function notHappening(occurrence) {
        const o = occurrence || {};
        return o.cancelled === true || !!o.movedTo;
    }

    // ── What time a date happens at ──────────────────────────────────────────
    //
    // ⚠ A REPEATING EVENT'S TIME LIVES ON ITS RULE, AND NOWHERE ELSE.
    //
    // A copy stamped onto the occurrence is INDISTINGUISHABLE from somebody
    // deliberately giving one date its own time — so the moment one is written,
    // the series can never move that date again. Change the Event to 4:30 pm and
    // the pattern sentence says pm while the date itself still says am, which is
    // exactly what happened: the top of the screen and the bottom disagreed
    // about the same event, and both were reading real stored data.
    //
    // Same trap `seriesColour` was already pulled out of, one line away in
    // `occurrencePayload`. Time was not, so it froze.
    //
    // A ONE-OFF has no rule, and its occurrence IS the whole Event — so its own
    // `time` is the only home there is, and it wins.
    function timeOf(occurrence, rule) {
        const o = occurrence || {};
        if (o.seriesId) return (rule && rule.time) || null;
        return o.time || null;
    }

    // Says WHERE it went, not just that it went. "Not happening" on the first
    // Sunday, with nothing about the fifteenth, is how somebody turns up to an
    // empty hall.
    function movedNote(occurrence) {
        const o = occurrence || {};
        if (o.movedTo) return 'Moved to ' + dayMonth(o.movedTo);
        if (o.movedFrom) return 'Moved from ' + dayMonth(o.movedFrom);
        if (o.cancelled === true) return 'Not happening';
        return '';
    }

    const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'];

    function dayMonth(dateStr) {
        if (!isDateStr(dateStr)) return String(dateStr || '');
        const d = parseDate(dateStr);
        return d.getDate() + ' ' + MONTH_NAMES[d.getMonth()];
    }

    // ── Who is already busy on a Sunday ──────────────────────────────────────
    //
    // A Sunday's liturgical Roles are NOT Assignments. They are hardwired fields
    // on the Service document — the ones the printed booklet reads — and that is
    // deliberate (ADR-0018 §2). But somebody preaching cannot also be on the
    // welcome team, so the picker for a Sunday's Servant Roles has to be able to
    // see them, which means reading those fields.
    //
    // The field names are the Service's, restated here rather than imported:
    // service-builder.js owns that document and this module depends on nothing.
    // A test holds this list against `RolesCore.LITURGICAL_SLUGS`, because a
    // liturgical Role with no field here would leave whoever holds it silently
    // assignable — the exact hole this closes.
    const LITURGICAL_SERVICE_FIELDS = Object.freeze([
        { field: 'serviceLeaderId', roleSlug: 'service_leader' },
        { field: 'musicLeaderId', roleSlug: 'worship_leader' },
        { field: 'preacherId', roleSlug: 'preacher' },
        { field: 'sermonetteId', roleSlug: 'sermonette' },
        { field: 'prayerPraiseId', roleSlug: 'prayer' },
        { field: 'prayerConfessionId', roleSlug: 'prayer' },
        // Music helpers are a list of {name, id}, not a single field.
        { field: 'musicHelpers', roleSlug: 'worship_helper', list: true },
    ]);

    // Everyone holding a liturgical Role on this Service, once each. A NAME with
    // no id is not a person — a visiting speaker typed in by hand blocks nobody,
    // because there is nobody to block.
    function liturgicalHolders(service) {
        const doc = service || {};
        const seen = new Set();
        const held = [];

        LITURGICAL_SERVICE_FIELDS.forEach(f => {
            const ids = f.list
                ? (Array.isArray(doc[f.field]) ? doc[f.field] : []).map(h => h && h.id)
                : [doc[f.field]];

            ids.filter(Boolean).forEach(personId => {
                if (seen.has(personId)) return;
                seen.add(personId);
                held.push({ personId: personId, roleSlug: f.roleSlug });
            });
        });

        return held;
    }

    // ── Merging computed dates with sparse stored records ─────────────────────

    // Every date the rule produces, each carrying its stored record when one
    // exists. `stored: false` marks a date nothing has landed on yet — it is a
    // real occurrence the Calendar shows, it simply has no document.
    function mergeOccurrences(seriesId, rule, stored, from, to) {
        const byDate = new Map();
        (stored || []).forEach(doc => {
            if (doc && doc.date) byDate.set(doc.date, doc);
        });

        return datesBetween(rule, from, to).map(date => {
            const doc = byDate.get(date);
            const base = {
                id: occurrenceId(seriesId, date),
                seriesId: seriesId,
                date: date,
                stored: false,
                assignments: [],
            };
            return doc ? Object.assign(base, doc, { date: date, stored: true }) : base;
        });
    }

    // ── Changing a pattern: orphans are surfaced, never migrated ─────────────
    //
    // Occurrences that already carry assignments and no longer match the rule.
    // Rare enough to deserve the friction, and the alternative is the system
    // guessing about real rosters (ADR-0018 §3).
    //
    // An orphan with nobody on it is not worth asking about — there is nothing to
    // lose, so the editor is not made to answer for it.
    function orphanedOccurrences(newRule, stored, from, to) {
        const fits = new Set(datesBetween(newRule, from, to));
        return (stored || []).filter(doc => (
            doc && doc.date &&
            !fits.has(doc.date) &&
            ((doc.assignments || []).length > 0)
        ));
    }

    // ── Assignments ───────────────────────────────────────────────────────────

    function assertState(state) {
        if (STATE_VALUES.indexOf(state) === -1) {
            throw new Error('Unknown assignment state: ' + state);
        }
    }

    const actorOf = a => (a || {});

    // A fresh Assignment. Pending, always — nobody has been heard from yet.
    function newAssignment(spec, actor) {
        const s = spec || {};
        const who = actorOf(actor);
        return {
            personId: s.personId,
            roleSlug: s.roleSlug,
            slotId: s.slotId || null,
            // A one-off Role's job label, kept on the assignment so the
            // Involvement can preserve it under the reserved slug.
            oneOffId: s.oneOffId || null,
            label: s.label || null,
            state: STATES.PENDING,
            stateSetBy: who.actorUid || null,
            stateSetAt: who.at || null,
        };
    }

    // Move an Assignment to a state, recording who did it and when. Returns a new
    // Assignment; the input is untouched, so a UI can hold the previous value.
    function setState(assignment, state, actor) {
        assertState(state);
        const who = actorOf(actor);
        return Object.assign({}, assignment, {
            state: state,
            stateSetBy: who.actorUid || null,
            stateSetAt: who.at || null,
        });
    }

    const sameSlot = (a, roleSlug, slotId) => (
        a && a.roleSlug === roleSlug && a.slotId === slotId && !a.oneOffId
    );

    // Put somebody in a slot. A slot holds exactly ONE current Assignment, so
    // this replaces whatever was there — which is precisely what makes a
    // replacement clear a decline and drop the decliner from the participant
    // list in a single write (ADR-0018 §5).
    function assignToSlot(assignments, spec, actor) {
        const s = spec || {};
        const kept = (assignments || []).filter(a => !sameSlot(a, s.roleSlug, s.slotId));
        return kept.concat([newAssignment(s, actor)]);
    }

    // Take whoever is in a slot out of it. Removal is instant and total — their
    // sight of a restricted Event goes with it.
    function clearSlot(assignments, roleSlug, slotId) {
        return (assignments || []).filter(a => !sameSlot(a, roleSlug, slotId));
    }

    // Set the state of whoever currently holds a slot.
    function setStateAt(assignments, roleSlug, slotId, state, actor) {
        assertState(state);
        return (assignments || []).map(a => (
            sameSlot(a, roleSlug, slotId) ? setState(a, state, actor) : a
        ));
    }

    // ── One-off Roles ─────────────────────────────────────────────────────────
    //
    // A label and some people. No slots, no requirements, no restrictions, no
    // eligibility checking — deliberately cheap, because forcing every ad-hoc job
    // through the Roles Manager would make the Roles Manager a junk drawer.

    const sameOneOff = (a, oneOffId, personId) => (
        a && a.oneOffId === oneOffId && a.personId === personId
    );

    // No slot to compete for, so this adds rather than replaces — several people
    // can be on one one-off job at once.
    function assignToOneOff(assignments, spec, actor) {
        const s = spec || {};
        const list = assignments || [];
        if (list.some(a => sameOneOff(a, s.oneOffId, s.personId))) return list.slice();
        return list.concat([newAssignment({
            personId: s.personId,
            roleSlug: ONE_OFF_SLUG,
            slotId: null,
            oneOffId: s.oneOffId,
            label: s.label,
        }, actor)]);
    }

    function removeFromOneOff(assignments, oneOffId, personId) {
        return (assignments || []).filter(a => !sameOneOff(a, oneOffId, personId));
    }

    function setOneOffState(assignments, oneOffId, personId, state, actor) {
        assertState(state);
        return (assignments || []).map(a => (
            sameOneOff(a, oneOffId, personId) ? setState(a, state, actor) : a
        ));
    }

    // ── The participant list ──────────────────────────────────────────────────
    //
    // Everyone currently holding a Role here — INCLUDING people who declined,
    // because they keep their place until somebody replaces them. This list is
    // what a security rule checks `participant` visibility against, so it is
    // denormalised onto the occurrence.

    function participantIds(assignments) {
        const seen = [];
        (assignments || []).forEach(a => {
            if (a && a.personId && seen.indexOf(a.personId) === -1) seen.push(a.personId);
        });
        return seen;
    }

    // ── The three-way switch every surface keys off ──────────────────────────

    const stateOf = a => ((a && a.state) || STATES.PENDING);

    const STATE_LABELS = Object.freeze({
        [STATES.PENDING]: 'Pending',
        [STATES.CONFIRMED]: 'Confirmed',
        [STATES.DECLINED]: 'Declined',
    });

    // Pending is calm on purpose. Declined is the only loud state, and it
    // escalates across four surfaces — the slot row, the role card's border, the
    // event banner, and the calendar chip — all keyed off this one switch rather
    // than each branching on state itself.
    const STATE_TONES = Object.freeze({
        [STATES.PENDING]: 'calm',
        [STATES.CONFIRMED]: 'good',
        [STATES.DECLINED]: 'attention',
    });

    function stateLabel(assignment) {
        return STATE_LABELS[stateOf(assignment)];
    }

    function stateTone(assignment) {
        return STATE_TONES[stateOf(assignment)];
    }

    const assignmentsOf = o => ((o && o.assignments) || []);

    // Does anything here need sorting? One place, so the calendar cell glyph, the
    // chip flag, the card border, the banner and the *Needs sorting* rail cannot
    // disagree about it.
    function needsAttention(occurrence) {
        return assignmentsOf(occurrence).some(a => stateOf(a) === STATES.DECLINED);
    }

    // How many people were never heard from. Zero renders nothing — the past-event
    // prompt is scaffolding and must not nag when there is nothing to ask.
    function unconfirmedCount(occurrence) {
        return assignmentsOf(occurrence).filter(a => stateOf(a) === STATES.PENDING).length;
    }

    // ── Conversion: the plan becomes the fact ────────────────────────────────

    // A deterministic Involvement id, so running the job twice writes one record.
    // The slot (or the one-off job) is part of the key because the same person can
    // legitimately hold two Roles at one Event.
    function involvementIdFor(occurrence, assignment) {
        const o = occurrence || {};
        const a = assignment || {};
        const within = a.oneOffId || a.slotId || 'x';
        return [o.id || o.date, a.roleSlug, within, a.personId].join('__');
    }

    // The Involvement an Assignment becomes. Carries the Event series, since
    // fairness is counted per series (ADR-0016 §5) — and for a one-off Role, the
    // reserved slug with the job's label kept in metadata, so the person who
    // quietly unlocks the hall reads as someone who serves.
    function serveRecordFor(occurrence, assignment) {
        const o = occurrence || {};
        const a = assignment || {};
        const record = {
            involvementId: involvementIdFor(o, a),
            personId: a.personId,
            type: a.roleSlug,
            serviceDate: o.date,
            seriesId: o.seriesId || SUNDAY_SERVICE_ID,
        };
        if (a.roleSlug === ONE_OFF_SLUG) {
            record.metadata = { label: a.label || null, oneOffId: a.oneOffId || null };
        }
        return record;
    }

    // Applied once the date has passed:
    //
    //   Confirmed → a serve record. They said yes, the day came, it counts.
    //   Declined  → nothing, ever.
    //   Pending   → nothing, but NOT discarded: an open question for an editor.
    //
    // Silence is never counted as a yes, and never silently lost. A serve log with
    // silent gaps is worse than one with open questions — a fairness engine
    // reading a log full of gaps looks like it is working while concluding that
    // nobody has served in months.
    function conversion(occurrence) {
        const serves = [];
        const questions = [];

        assignmentsOf(occurrence).forEach(assignment => {
            const state = stateOf(assignment);
            if (state === STATES.CONFIRMED) {
                serves.push(serveRecordFor(occurrence, assignment));
            } else if (state === STATES.PENDING) {
                questions.push({
                    personId: assignment.personId,
                    roleSlug: assignment.roleSlug,
                    label: assignment.label || null,
                    assignment: assignment,
                });
            }
            // Declined falls through deliberately: it is neither a serve record
            // nor a question. They told us; there is nothing to ask.
        });

        return { serves: serves, questions: questions };
    }

    // ── Visibility ────────────────────────────────────────────────────────────

    // The Sunday Service is permanently public — its occurrences are the
    // `services/{date}` documents the congregant-facing Service Guide reads. Not
    // a disabled control in the UI: a settled statement (ADR-0018 §5).
    function visibilityOf(occurrence) {
        if (occurrence && occurrence.seriesId === SUNDAY_SERVICE_ID) return 'public';
        return occurrence && occurrence.visibility;
    }

    function isVisibilityEditable(occurrence) {
        return !(occurrence && occurrence.seriesId === SUNDAY_SERVICE_ID);
    }

    function rungsFor(rank) {
        return RUNGS_BY_RANK[rank] || ['public'];
    }

    // Can this viewer see this occurrence? Fails closed: an occurrence with no
    // visibility set, or an unrecognised one, is readable by nobody.
    function canSee(rank, occurrence, personId) {
        const visibility = visibilityOf(occurrence);
        if (VISIBILITY_ORDER.indexOf(visibility) === -1) return false;

        if (rungsFor(rank).indexOf(visibility) !== -1) return true;

        // The one rung rank cannot answer.
        if (visibility === 'participant' && personId) {
            return ((occurrence && occurrence.participantIds) || []).indexOf(personId) !== -1;
        }
        return false;
    }

    // Changing a series' visibility restamps ALL of its occurrences, past ones
    // included — otherwise making something private would leave every past date
    // of it public.
    function restampVisibility(occurrences, visibility, rosterShared) {
        return (occurrences || []).map(o => Object.assign({}, o, {
            visibility: visibility,
            rosterShared: rosterShared === true,
        }));
    }

    // ── The query constraint ─────────────────────────────────────────────────
    //
    // ⚠ Read this before debugging an "empty" calendar.
    //
    // Firestore evaluates security rules PER RETURNED DOCUMENT and fails the whole
    // query if any document would fail. So the Calendar MUST constrain its own
    // reads. An unconstrained query does not return fewer rows — it errors
    // outright, and the error looks exactly like "this church has no events".
    //
    // The same trap is already documented in firestore.rules for the relationship
    // collections. It is the most likely serious bug in MS-99 and the least
    // likely to be noticed by eye.
    //
    // Firestore cannot express "visible by my rank OR I am a participant" as a
    // single filter, so it is TWO queries merged client-side:
    //
    //   1. .where('visibility', 'in', q.rungs)
    //   2. .where('visibility', '==', q.participantRung)
    //      .where('participantIds', 'array-contains', q.participantId)   (if any)
    //
    // The SECOND query must pin the rung too. Holding a Role on an Event grants
    // sight of it only at the `participant` rung — being a participant of an
    // elder-level Event does not let a member read it. Left unpinned, query 2
    // returns those elder-level rows, they fail the rule, and the WHOLE query
    // errors: an empty calendar, for a viewer who should have seen plenty.
    function visibilityQueryFor(rank, personId) {
        const rungs = rungsFor(rank).slice();
        // Ranks that already reach `participant` need no second query — asking
        // twice would only be work. A member does need it, because rungsFor()
        // deliberately leaves the rung out of their rank list.
        const needsParticipantQuery = rungs.indexOf('participant') === -1;
        return {
            rungs: rungs,
            participantId: (rank && personId && needsParticipantQuery) ? personId : null,
            participantRung: 'participant',
        };
    }

    // The two result sets, de-duplicated by id. An Event that satisfies both
    // queries is one Event.
    function mergeVisibleOccurrences(byRank, byParticipation) {
        const seen = new Set();
        const out = [];
        [].concat(byRank || [], byParticipation || []).forEach(o => {
            const key = o && (o.id != null ? o.id : o.date);
            if (key == null || seen.has(key)) return;
            seen.add(key);
            out.push(o);
        });
        return out;
    }

    const EventsOccurrenceCore = {
        // vocabulary
        FREQ,
        ENDS,
        STATES,
        STATE_VALUES,
        ONE_OFF_SLUG,
        VISIBILITY_ORDER,
        SUNDAY_SERVICE_ID,
        // occurrences
        datesBetween,
        occurrenceId,
        parseOccurrenceId,
        LITURGICAL_SERVICE_FIELDS,
        liturgicalHolders,
        notHappening,
        timeOf,
        movedNote,
        dayMonth,
        mergeOccurrences,
        orphanedOccurrences,
        // assignments
        newAssignment,
        setState,
        assignToSlot,
        clearSlot,
        setStateAt,
        // one-off Roles
        assignToOneOff,
        removeFromOneOff,
        setOneOffState,
        // derived
        participantIds,
        stateLabel,
        stateTone,
        needsAttention,
        unconfirmedCount,
        // conversion
        conversion,
        serveRecordFor,
        involvementIdFor,
        // visibility
        visibilityOf,
        isVisibilityEditable,
        canSee,
        restampVisibility,
        visibilityQueryFor,
        mergeVisibleOccurrences,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = EventsOccurrenceCore;
    }
    if (global) {
        global.EventsOccurrenceCore = EventsOccurrenceCore;
    }
})(typeof window !== 'undefined' ? window : null);
