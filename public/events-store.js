// Events Store — the Firestore adapter for Event series, occurrences, and
// assignments (MS-99, ADR-0018).
//
// `events-occurrence-core.js` is the pure model and knows nothing about a
// database. This is the one place that talks to Firestore about Events, so the
// query constraint below lives in exactly one place rather than being re-typed
// on the Calendar, the Event detail page, and every surface added later.
//
// ⚠ THE QUERY CONSTRAINT — read this before debugging an "empty" calendar.
//
// Firestore evaluates security rules PER RETURNED DOCUMENT and fails the WHOLE
// query if any document would fail. So every read here constrains itself by the
// viewer's visibility. AN UNCONSTRAINED QUERY DOES NOT RETURN FEWER ROWS — IT
// ERRORS OUTRIGHT, and the error looks exactly like "this church has no events".
// That is the most likely serious bug in MS-99 and the least likely to be
// noticed by eye. The same trap is documented in firestore.rules for the
// relationship collections.
//
// Loaded as a classic <script> (window.EventsStore) and exported for Node tests.

(function (global) {
    'use strict';

    const Core = (typeof require !== 'undefined')
        ? require('./events-occurrence-core.js')
        : global.EventsOccurrenceCore;

    const SERIES = 'events';
    const OCCURRENCES = 'event_occurrences';
    const ROSTER = 'roster';

    // Firestore caps a batch at 500 operations. The rest of this codebase commits
    // in 450s (see the week-shift tool), leaving room rather than riding the edge.
    const BATCH_SIZE = 450;

    // ── Reading the Calendar ─────────────────────────────────────────────────

    // Every occurrence between `from` and `to` that this viewer is allowed to
    // see. TWO queries, merged client-side, because Firestore cannot express
    // "visible by my rank OR I am a participant" as a single filter.
    //
    //   rank     — the viewer's Permission Level, or null when signed out
    //   personId — their linked Person id, or null
    //
    // Both queries name their visibility explicitly. Neither is ever open.
    async function loadVisibleOccurrences(db, options) {
        const opts = options || {};
        const q = Core.visibilityQueryFor(opts.rank, opts.personId);

        const inRange = query => query
            .where('date', '>=', opts.from)
            .where('date', '<=', opts.to);

        // 1. By rank. `rungs` is never empty — a signed-out visitor still asks
        //    for ['public'] rather than asking for everything.
        const reads = [
            inRange(db.collection(OCCURRENCES).where('visibility', 'in', q.rungs)).get(),
        ];

        // 2. By participation, PINNED TO THE PARTICIPANT RUNG. Holding a Role
        //    grants sight only at that rung; without the equality clause this
        //    returns elder-level Events the viewer participates in, those rows
        //    fail the rule, and the whole read errors.
        if (q.participantId) {
            reads.push(inRange(
                db.collection(OCCURRENCES)
                    .where('visibility', '==', q.participantRung)
                    .where('participantIds', 'array-contains', q.participantId)
            ).get());
        }

        const snaps = await Promise.all(reads);
        const sets = snaps.map(snap => snap.docs.map(d => Object.assign({ id: d.id }, d.data())));

        return Core.mergeVisibleOccurrences(sets[0], sets[1] || [])
            .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    }

    // The series a viewer can see. Same constraint, same reason — the series
    // collection stopped being world-readable, so an open query errors here too.
    //
    // The Sunday Service is permanently public and is always included: the rule
    // names it explicitly, so it needs no visibility stamp and no migration.
    async function loadVisibleSeries(db, options) {
        const opts = options || {};
        const q = Core.visibilityQueryFor(opts.rank, opts.personId);

        const [byRung, sunday] = await Promise.all([
            db.collection(SERIES).where('visibility', 'in', q.rungs).get(),
            db.collection(SERIES).doc(Core.SUNDAY_SERVICE_ID).get(),
        ]);

        const list = byRung.docs.map(d => Object.assign({ id: d.id }, d.data()));
        if (sunday.exists && !list.some(s => s.id === Core.SUNDAY_SERVICE_ID)) {
            list.push(Object.assign({ id: sunday.id }, sunday.data()));
        }
        return list;
    }

    // The whole Calendar for a month: every series' computed dates merged with
    // whatever occurrence documents exist. An untouched date still appears — it
    // is simply empty. That is the sparse promise (ADR-0018 §3).
    async function loadCalendar(db, options) {
        const opts = options || {};
        const [series, stored] = await Promise.all([
            loadVisibleSeries(db, opts),
            loadVisibleOccurrences(db, opts),
        ]);

        const storedBySeries = new Map();
        const loose = [];
        stored.forEach(o => {
            if (!o.seriesId) { loose.push(o); return; }
            if (!storedBySeries.has(o.seriesId)) storedBySeries.set(o.seriesId, []);
            storedBySeries.get(o.seriesId).push(o);
        });

        const computed = series.flatMap(s => (
            s.recurrence
                ? Core.mergeOccurrences(s.id, s.recurrence, storedBySeries.get(s.id) || [], opts.from, opts.to)
                    .map(o => Object.assign({ name: s.name, seriesName: s.name }, o))
                : []
        ));

        // A stored occurrence whose series has no rule (or whose date the rule no
        // longer produces) is still a real dated thing somebody put people on. It
        // must not vanish from the Calendar just because the pattern moved.
        const seen = new Set(computed.map(o => o.id));
        const orphaned = stored.filter(o => o.seriesId && !seen.has(o.id));

        return computed
            .concat(orphaned, loose)
            .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    }

    // ── Writing ──────────────────────────────────────────────────────────────

    async function commitInBatches(db, writes) {
        for (let i = 0; i < writes.length; i += BATCH_SIZE) {
            const batch = db.batch();
            writes.slice(i, i + BATCH_SIZE).forEach(w => {
                if (w.kind === 'set') batch.set(w.ref, w.data, w.options || {});
                else if (w.kind === 'update') batch.update(w.ref, w.data);
                else if (w.kind === 'delete') batch.delete(w.ref);
            });
            await batch.commit();
        }
        return writes.length;
    }

    const occurrenceRef = (db, id) => db.collection(OCCURRENCES).doc(id);

    // What the occurrence DOCUMENT carries. The assignments themselves are
    // deliberately NOT on it — they live in the roster subcollection, because
    // Firestore cannot hide a field from someone allowed to read a document, and
    // putting them here would defeat the whole point of the subcollection
    // (ADR-0018 §5).
    //
    // What does stay is what a security rule and a calendar chip need:
    //
    //   participantIds — the rule's only way to answer `participant` visibility.
    //                    ADR-0018 accepts that this discloses the roster as ids;
    //                    the person NAMES stay in the subcollection.
    //   needsAttention — so a calendar cell can show the declined flag without
    //                    reading a roster it may not be allowed to read.
    //
    // Both are DERIVED from the assignments in the same write. Never maintained
    // by hand, or they drift from the truth security depends on.
    function occurrencePayload(occurrence) {
        const assignments = occurrence.assignments || [];
        const payload = Object.assign({}, occurrence, {
            participantIds: Core.participantIds(assignments),
            needsAttention: Core.needsAttention({ assignments: assignments }),
        });
        delete payload.assignments;
        return payload;
    }

    // Write an occurrence, creating it the first time something lands on the
    // date. The id is deterministic (`{seriesId}_{date}`), so two editors saving
    // at once land on one document rather than making a twin.
    //
    // The document and its roster are written together, so the derived
    // participant list can never describe a roster that is not there.
    async function saveOccurrence(db, occurrence) {
        const id = occurrence.id || Core.occurrenceId(occurrence.seriesId, occurrence.date);
        if (!id) throw new Error('An occurrence needs either an id or a series and a date.');

        const payload = occurrencePayload(Object.assign({}, occurrence, { id: id }));
        await occurrenceRef(db, id).set(payload, { merge: true });
        if (occurrence.assignments) await saveRoster(db, id, occurrence.assignments);
        return payload;
    }

    // An occurrence with its roster read back in. The roster read may be refused
    // for a participant who is not allowed to see who else is coming — that is
    // the rule working, not an error, so it degrades to just your own row rather
    // than failing the page.
    async function loadOccurrence(db, id) {
        const [doc, roster] = await Promise.all([
            occurrenceRef(db, id).get(),
            occurrenceRef(db, id).collection(ROSTER).get().catch(() => ({ docs: [] })),
        ]);
        if (!doc.exists) return null;
        return Object.assign({ id: doc.id }, doc.data(), {
            assignments: roster.docs.map(d => d.data()),
        });
    }

    // ── Restamping a series' visibility ──────────────────────────────────────
    //
    // Visibility is copied DOWN onto every occurrence, so changing it on the
    // series has to rewrite every one of them — PAST ONES INCLUDED. Otherwise
    // making something private would leave all of its history public, which is
    // the opposite of what the editor asked for.
    async function restampSeriesVisibility(db, seriesId, visibility, rosterShared) {
        if (seriesId === Core.SUNDAY_SERVICE_ID) {
            throw new Error('The Sunday Service is permanently public and its visibility cannot be changed.');
        }
        if (Core.VISIBILITY_ORDER.indexOf(visibility) === -1) {
            throw new Error('Unknown visibility: ' + visibility);
        }

        // No date filter. "Every occurrence, past ones included" is the whole
        // point — a range here would be the bug.
        const snap = await db.collection(OCCURRENCES).where('seriesId', '==', seriesId).get();

        const writes = snap.docs.map(doc => ({
            kind: 'update',
            ref: doc.ref,
            data: { visibility: visibility, rosterShared: rosterShared === true },
        }));
        writes.push({
            kind: 'update',
            ref: db.collection(SERIES).doc(seriesId),
            data: { visibility: visibility, rosterShared: rosterShared === true },
        });

        await commitInBatches(db, writes);
        return { occurrences: snap.docs.length };
    }

    // ── The roster subcollection ─────────────────────────────────────────────
    //
    // Firestore cannot hide a field from someone allowed to read a document, so
    // "participants can't see who else is coming" only works if the roster is
    // stored separately (ADR-0018 §5). One document per assignment, so a rule can
    // let you read your own and gate everyone else's.

    const rosterId = assignment => [
        assignment.roleSlug,
        assignment.oneOffId || assignment.slotId || 'x',
        assignment.personId,
    ].join('__');

    async function saveRoster(db, occurrenceId, assignments) {
        const col = occurrenceRef(db, occurrenceId).collection(ROSTER);
        const existing = await col.get();

        const wanted = new Map((assignments || []).map(a => [rosterId(a), a]));
        const writes = [];

        existing.docs.forEach(doc => {
            if (!wanted.has(doc.id)) writes.push({ kind: 'delete', ref: doc.ref });
        });
        wanted.forEach((assignment, id) => {
            writes.push({ kind: 'set', ref: col.doc(id), data: assignment });
        });

        await commitInBatches(db, writes);
        return writes.length;
    }

    // ── Changing a recurrence pattern ────────────────────────────────────────
    //
    // NOTHING IS MIGRATED SILENTLY. The caller computes the orphans, shows them
    // to the editor with who is on each one, and passes back a per-date choice.
    // A date with no choice is left exactly as it was.
    async function applyOrphanChoices(db, seriesId, orphans, choices, newDates) {
        const decisions = choices || {};
        const available = (newDates || []).slice();
        const writes = [];
        const moved = [];
        const deleted = [];

        (orphans || []).forEach(orphan => {
            const choice = decisions[orphan.date];
            if (choice === 'delete') {
                writes.push({ kind: 'delete', ref: occurrenceRef(db, orphan.id) });
                deleted.push(orphan.date);
                return;
            }
            if (choice !== 'move') return; // no choice made — leave it alone

            // Move onto the next date the new pattern produces that nothing is
            // already sitting on, so two orphans never collide onto one date.
            const target = available.shift();
            if (!target) return;

            const id = Core.occurrenceId(seriesId, target);
            writes.push({
                kind: 'set',
                ref: occurrenceRef(db, id),
                data: occurrencePayload(Object.assign({}, orphan, { id: id, date: target })),
            });
            // Write before delete, so an interrupted run leaves a stale duplicate
            // rather than losing a roster — the same ordering the week-shift tool
            // uses.
            writes.push({ kind: 'delete', ref: occurrenceRef(db, orphan.id) });
            moved.push({ from: orphan.date, to: target });
        });

        await commitInBatches(db, writes);
        return { moved: moved, deleted: deleted };
    }

    // ── The week-shift tool ──────────────────────────────────────────────────
    //
    // "Shift everything from here forward a week" already moves Services,
    // Involvement records, and pastoral prayer history. Occurrences and their
    // rosters have to move with them — WITHOUT this, shifting a week silently
    // loses that week's roster: the Event moves and the people assigned to it
    // do not, or the assignments end up pointing at a date with no Event.
    //
    // An occurrence's id encodes its date, so moving it means writing a new
    // document and deleting the old one — and the roster subcollection has to be
    // carried across with it, since a subcollection does not follow its parent.
    //
    // A one-off Event has an auto-id that says nothing about its date, so it is
    // simply re-dated in place. Nothing to copy, nothing to lose.

    function shiftDays(dateStr, n) {
        const parts = String(dateStr).split('-').map(Number);
        const d = new Date(parts[0], parts[1] - 1, parts[2]);
        d.setDate(d.getDate() + n);
        return d.getFullYear() + '-' +
            String(d.getMonth() + 1).padStart(2, '0') + '-' +
            String(d.getDate()).padStart(2, '0');
    }

    // Can this rank see every rung? A shift is schedule-wide, so anyone running
    // it has to be able to see everything on the schedule.
    function seesEveryRung(rank) {
        const rungs = Core.visibilityQueryFor(rank).rungs;
        return Core.VISIBILITY_ORDER.every(rung => rungs.indexOf(rung) !== -1);
    }

    async function shiftOccurrences(db, fromDate, days, options) {
        const step = days == null ? 7 : days;
        const rank = (options || {}).rank;

        // Refuse BEFORE writing anything. An editor cannot read elder-level
        // Events, so their query would either error outright or — worse — move
        // only the Events they can see, leaving the restricted ones sitting on
        // the old week while everything around them slid forward. A partly
        // shifted schedule is harder to notice, and harder to undo, than a
        // refusal.
        if (!seesEveryRung(rank)) {
            const err = new Error(
                'Shifting the schedule has to be done by an elder or an admin. ' +
                'There may be Events you are not able to see, and moving only some ' +
                'of them would leave the schedule inconsistent.'
            );
            err.code = 'insufficient-visibility';
            throw err;
        }

        const snap = await db.collection(OCCURRENCES)
            .where('visibility', 'in', Core.VISIBILITY_ORDER.slice())
            .where('date', '>=', fromDate)
            .get();

        // Read every roster BEFORE planning any write. A roster that is not read
        // is a roster that is lost when its parent document is deleted.
        const moving = await Promise.all(snap.docs.map(async doc => {
            const roster = await doc.ref.collection(ROSTER).get();
            return {
                id: doc.id,
                data: Object.assign({}, doc.data()),
                roster: roster.docs.map(r => ({ id: r.id, data: r.data() })),
            };
        }));

        // Latest date first, so every document is copied forward before the copy
        // of its predecessor lands on it — the same copy-before-overwrite
        // ordering the Services shift uses, which keeps a partial failure across
        // batch boundaries non-destructive.
        moving.sort((a, b) => (a.data.date < b.data.date ? 1 : a.data.date > b.data.date ? -1 : 0));

        const setsAndUpdates = [];
        const deletes = [];
        const newIds = new Set();
        let rehomed = 0;

        moving.forEach(item => {
            const newDate = shiftDays(item.data.date, step);
            const newId = item.data.seriesId ? Core.occurrenceId(item.data.seriesId, newDate) : item.id;
            newIds.add(newId);

            // The state, who set it and when, and therefore the participant list
            // all travel untouched — a shift moves a roster, it does not rewrite
            // one.
            setsAndUpdates.push({
                kind: 'set',
                ref: occurrenceRef(db, newId),
                data: Object.assign({}, item.data, { id: newId, date: newDate }),
            });
            item.roster.forEach(r => {
                setsAndUpdates.push({
                    kind: 'set',
                    ref: occurrenceRef(db, newId).collection(ROSTER).doc(r.id),
                    data: r.data,
                });
            });
            if (newId !== item.id) rehomed++;
        });

        // Free only the slots nothing moved INTO. Deletes come last, so an
        // interrupted run leaves a stale duplicate rather than a lost roster.
        moving.forEach(item => {
            if (newIds.has(item.id)) return;
            item.roster.forEach(r => {
                deletes.push({ kind: 'delete', ref: occurrenceRef(db, item.id).collection(ROSTER).doc(r.id) });
            });
            deletes.push({ kind: 'delete', ref: occurrenceRef(db, item.id) });
        });

        await commitInBatches(db, setsAndUpdates.concat(deletes));

        return {
            occurrences: moving.length,
            assignments: moving.reduce((n, m) => n + m.roster.length, 0),
            rehomed: rehomed,
        };
    }

    const EventsStore = {
        SERIES,
        OCCURRENCES,
        ROSTER,
        shiftOccurrences,
        shiftDays,
        seesEveryRung,
        // reading
        loadVisibleOccurrences,
        loadVisibleSeries,
        loadCalendar,
        // writing
        saveOccurrence,
        loadOccurrence,
        occurrencePayload,
        restampSeriesVisibility,
        saveRoster,
        applyOrphanChoices,
        // internals worth testing
        rosterId,
        commitInBatches,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = EventsStore;
    }
    if (global) {
        global.EventsStore = EventsStore;
    }
})(typeof window !== 'undefined' ? window : null);
