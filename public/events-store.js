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
    // MS-13's series model — locked series, locked Roles, and the reconcile that
    // repairs a damaged Sunday Service.
    const Events = (typeof require !== 'undefined')
        ? require('./events-core.js')
        : global.EventsCore;

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

    // ── Putting the rosters back on ──────────────────────────────────────────
    //
    // The roster is a SUBCOLLECTION, so a list query over occurrences returns
    // none of it. Left there, the Calendar's "Only mine" filter, the *Upcoming*
    // card and the *Needs sorting* list all come back silently empty — the page
    // renders, and simply never mentions anything you are down for.
    //
    // So the rows that need a roster fetch one, and only those:
    //
    //   • Anyone: their OWN row on Events they are a participant of. A query
    //     for your own personId passes the rule even when the roster is hidden,
    //     because you are always allowed to know what you were asked to do.
    //   • An editor: the WHOLE roster of Events that need sorting, which is what
    //     turns a declined flag into "Bethany Croft declined Kids Ministry".
    //   • An editor, with `staffingFrom` set: the whole roster of every date
    //     from then on that somebody is already standing in. That is what turns
    //     "this date has people" into "this date still has two places to fill",
    //     and it cannot be answered from the document — the count depends on the
    //     Roles the series carries TODAY, which no stamp on a date can know.
    //     Dates nobody is on need no read at all: with an empty roster, every
    //     place on them is open by definition.
    //
    // All of them are bounded by how much is actually going on, not by the month.
    async function attachRosters(db, occurrences, options) {
        const opts = options || {};
        const isEditor = ['editor', 'admin', 'elder', 'super_admin'].indexOf(opts.rank) !== -1;

        await Promise.all(occurrences.map(async o => {
            const rosterRef = occurrenceRef(db, o.id).collection(ROSTER);
            const staffed = ((o.participantIds || []).length > 0);
            const mine = opts.personId && (o.participantIds || []).indexOf(opts.personId) !== -1;

            // An editor reading a whole roster is allowed; a member reading only
            // their own row is too. Anything refused degrades to no roster rather
            // than failing the page.
            const forStaffing = !!opts.staffingFrom && staffed && o.date >= opts.staffingFrom;
            const wantsAll = isEditor && (o.needsAttention || forStaffing);
            if (!mine && !wantsAll) return;

            try {
                const snap = wantsAll
                    ? await rosterRef.get()
                    : await rosterRef.where('personId', '==', opts.personId).get();
                o.assignments = snap.docs.map(d => d.data());
            } catch (e) {
                o.assignments = o.assignments || [];
            }
        }));

        return occurrences;
    }

    // The Sunday Service carries no stored recurrence rule: MS-13 built the
    // series layer before recurrence existed. Rather than migrate a document to
    // state something the name already guarantees, the rule is implied here —
    // the Sunday Service is every Sunday, by definition.
    //
    // Without this the Calendar shows no Sundays at all, which is most of what
    // is on at a church.
    const SUNDAY_RULE = Object.freeze({
        freq: 'weekly',
        weekday: 0,
        // Early enough to cover every Service the app has ever held; the weekly
        // anchor snaps forward to the first Sunday on or after it.
        startDate: '2023-01-01',
    });

    function recurrenceFor(series) {
        if (series && series.recurrence) return series.recurrence;
        if (series && series.id === Core.SUNDAY_SERVICE_ID) return SUNDAY_RULE;
        return null;
    }

    // The whole Calendar for a month: every series' computed dates merged with
    // whatever occurrence documents exist. An untouched date still appears — it
    // is simply empty. That is the sparse promise (ADR-0018 §3).
    async function loadCalendar(db, options) {
        const opts = options || {};
        const [series, stored] = await Promise.all([
            loadVisibleSeries(db, opts),
            loadVisibleOccurrences(db, opts).then(rows => attachRosters(db, rows, opts)),
        ]);

        const storedBySeries = new Map();
        const loose = [];
        stored.forEach(o => {
            if (!o.seriesId) { loose.push(o); return; }
            if (!storedBySeries.has(o.seriesId)) storedBySeries.set(o.seriesId, []);
            storedBySeries.get(o.seriesId).push(o);
        });

        const computed = series.flatMap(s => {
            const rule = recurrenceFor(s);
            return rule
                ? Core.mergeOccurrences(s.id, rule, storedBySeries.get(s.id) || [], opts.from, opts.to)
                    // `seriesColour`, not `colour`, and deliberately so. If the
                    // series colour were stamped as `colour`, then the next time
                    // anything saved this occurrence the stamp would ride into
                    // the document — and from then on that one date would keep
                    // the OLD colour when the series changed. Silently. Half a
                    // series moving colour and half not is the kind of bug
                    // nobody ever reports, they just stop trusting the feature.
                    // `occurrencePayload` strips this key on the way back out.
                    //
                    // `time` comes LAST, after `o`, so the rule wins over any
                    // copy stamped onto the document. It used to be the other
                    // way round — "a date that carries its own time still
                    // wins" — which sounds like a feature and is not one:
                    // nothing can set a per-date time, so every stamp is a
                    // stale copy of the rule, and letting it win froze that
                    // date at whatever the series said when it was written.
                    .map(o => Object.assign(
                        {
                            name: s.name,
                            seriesName: s.name,
                            seriesColour: s.colour,
                            // Which Roles every date of this series carries, so
                            // the Calendar can count the places still to fill
                            // without opening each Event. Stamped for display
                            // only, and stripped on the way back out for the
                            // same reason `seriesColour` is: written down, it
                            // would freeze this one date at the roster the
                            // series had the last time anybody touched it.
                            seriesRoleSlugs: s.roleSlugs || [],
                        },
                        o,
                        { time: rule.time || null }
                    ))
                : [];
        });

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
        // Read-time stamps, not stored fields. `seriesColour` is the series'
        // colour copied on for display; letting it land here would freeze this
        // one date at whatever the colour was the last time somebody touched it.
        // `seriesRoleSlugs` is the same stamp for the series' Roles, and freezes
        // the same way — a Role added to the series would then never reach the
        // dates somebody had already put people on.
        delete payload.seriesColour;
        delete payload.seriesRoleSlugs;
        // And `time`, for exactly the same reason — which this missed, so it
        // froze. `rebuildOccurrence` stamps the rule's time on for display, and
        // the first save of the date (a role, a visibility change) wrote it back
        // as if the date had chosen it. From then on the series could not move
        // that date's time: the pattern sentence said 4:30 pm while the date
        // itself still said 4:30 am, both reading real stored data.
        //
        // A ONE-OFF keeps its own time — its occurrence IS the whole Event, so
        // there is no rule for the time to live on.
        if (payload.seriesId) delete payload.time;
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
        // ⚠ A MISSING DOCUMENT IS DENIED, NOT ABSENT.
        //
        // The rule reads `resource.data.visibility`, and for a document that is
        // not there `resource` is null — so the read fails closed and throws
        // permission-denied. `doc.exists` is never reached. Since occurrences are
        // SPARSE, that is the ordinary case for a date nobody has touched: it is
        // not an error, it is the design.
        //
        // So a refusal here is not an answer, it is a question — and the answer
        // comes from the series, whose own rule then decides whether this viewer
        // may see the date at all. A viewer who cannot read the series gets the
        // denial they should, from `rebuildOccurrence`.
        const [doc, roster] = await Promise.all([
            occurrenceRef(db, id).get().catch(e => {
                if (e && e.code === 'permission-denied') return null;
                throw e;
            }),
            occurrenceRef(db, id).collection(ROSTER).get().catch(() => ({ docs: [] })),
        ]);

        if (!doc) return rebuildOccurrence(db, id);
        // Occurrences are SPARSE. A date nobody has touched has NO DOCUMENT, so
        // "no document" is not the same as "no such event" — and answering
        // "could not be found" is wrong in the worst way, because the date is
        // real, it is on the Calendar, and somebody just clicked it.
        //
        // The id is deterministic for exactly this reason: it carries the series
        // and the date, so the occurrence can be rebuilt without a document.
        if (!doc.exists) return rebuildOccurrence(db, id);

        return Object.assign({ id: doc.id, stored: true }, doc.data(), {
            assignments: roster.docs.map(d => d.data()),
        });
    }

    // An occurrence reconstructed from its id and its series. Returns null unless
    // the series' rule ACTUALLY PRODUCES that date — otherwise any id typed into
    // the address bar would render a page for an event that does not happen.
    async function rebuildOccurrence(db, id) {
        const parsed = Core.parseOccurrenceId(id);
        if (!parsed) return null;

        // Deliberately NOT caught. If the viewer may not read the series, they
        // may not see this date either, and they should be told that rather than
        // "no such event" — which would be a lie shaped like an answer.
        const series = await loadSeries(db, parsed.seriesId);
        if (!series) return null;

        const rule = recurrenceFor(series);
        if (!rule) return null;
        if (Core.datesBetween(rule, parsed.date, parsed.date).indexOf(parsed.date) === -1) return null;

        return {
            id: id,
            seriesId: parsed.seriesId,
            date: parsed.date,
            stored: false,
            name: series.name,
            seriesName: series.name,
            seriesColour: series.colour,
            // The Sunday Service is permanently public and carries no stamp of
            // its own; the rule names it explicitly rather than reading a field.
            visibility: series.visibility
                || (parsed.seriesId === Core.SUNDAY_SERVICE_ID ? 'public' : 'member'),
            rosterShared: series.rosterShared === true,
            time: rule.time || null,
            participantIds: [],
            assignments: [],
        };
    }

    // ── Creating an Event ────────────────────────────────────────────────────
    //
    // Two shapes, and the difference matters:
    //
    //   A ONE-OFF Event belongs to no series. It is a single occurrence document
    //   with an auto-id, because there is no rule to compute a date from — the
    //   date IS the Event.
    //
    //   A RECURRING Event is a SERIES carrying a recurrence rule, and NO
    //   occurrence documents at all. Its dates are computed from the rule, and a
    //   document is written the first time something lands on one. Writing them
    //   up front would mean choosing a horizon, writing hundreds of empty
    //   documents, and owning a job to extend it (ADR-0018 §3).
    async function createEvent(db, spec) {
        const s = spec || {};
        if (!s.name || !String(s.name).trim()) throw new Error('An event needs a name.');
        if (Core.VISIBILITY_ORDER.indexOf(s.visibility) === -1) {
            throw new Error('An event needs to say who can see it.');
        }

        const shared = { rosterShared: s.rosterShared === true, visibility: s.visibility };
        const rule = s.recurrence || {};
        const oneOff = !rule.freq || rule.freq === Core.FREQ.ONCE;

        if (oneOff) {
            const ref = db.collection(OCCURRENCES).doc();
            const payload = occurrencePayload(Object.assign({
                id: ref.id,
                seriesId: null,
                date: rule.startDate || s.date,
                name: String(s.name).trim(),
                time: s.time || null,
                location: s.location || null,
                description: s.description || null,
                assignments: [],
            }, shared));
            await ref.set(payload);
            return { kind: 'occurrence', id: ref.id };
        }

        const ref = db.collection(SERIES).doc();
        await ref.set(Object.assign({
            name: String(s.name).trim(),
            locked: false,
            roleSlugs: [],
            lockedRoleSlugs: [],
            // The time lives on the RULE and nowhere else. It used to be written
            // here too, and only the rule was ever read — two homes for one fact
            // is a fact that can disagree with itself.
            recurrence: Object.assign({}, rule, { time: rule.time || s.time || null }),
            location: s.location || null,
            description: s.description || null,
        }, shared));
        // Deliberately no occurrence documents. The Calendar computes the dates.
        return { kind: 'series', id: ref.id };
    }

    // Cancel ONE date of a series without touching the rest. This is the first
    // thing that lands on that date, so it is also the first time a document
    // exists for it — exactly the sparse rule working.
    async function cancelOccurrence(db, seriesId, date, cancelled) {
        const id = Core.occurrenceId(seriesId, date);
        if (!id) throw new Error('Only a date of a series can be cancelled.');
        await occurrenceRef(db, id).set({ cancelled: cancelled !== false }, { merge: true });
        return id;
    }

    // ── Moving ONE instance, without touching the pattern ────────────────────
    //
    // "First Sunday of the month, except in August when it is the fifteenth."
    // The pattern is right; this one month is not. Editing the pattern for it
    // would be wrong twice over — it would move every other month too, and it
    // would raise the orphan confrontation over a change nobody meant to make.
    //
    // A moved instance is NOT a cancellation plus a new event. It is the same
    // instance on a different day, and it takes its roster with it, because
    // "postponed a fortnight" is not "cancelled, and separately somebody
    // invented a gathering".
    //
    // Two documents come out of this, and both are needed: the new date, and a
    // marker on the ORIGINAL saying where it went. The original cannot simply be
    // deleted — the pattern still produces that date, so with nothing there the
    // Calendar would draw the event back again as though nothing had happened.
    async function moveOccurrence(db, seriesId, fromDate, toDate, options) {
        const opts = options || {};

        if (seriesId === Core.SUNDAY_SERVICE_ID) {
            throw new Error(
                'The Sunday Service cannot be moved this way: its order of service lives ' +
                'under its own date, and moving the Event would split one Sunday across two.'
            );
        }
        if (!Core.occurrenceId(seriesId, fromDate)) {
            throw new Error('Only a real date of a series can be moved.');
        }
        if (!Core.occurrenceId(seriesId, toDate)) {
            throw new Error('A new date reads as YYYY-MM-DD.');
        }
        if (fromDate === toDate) {
            throw new Error('That is the same date it is already on.');
        }

        const series = opts.series || await loadSeries(db, seriesId);
        const rule = recurrenceFor(Object.assign({ id: seriesId }, series || {}));

        // Moving onto a date the pattern already produces would put two instances
        // of the same series on one day, and the write would silently land on top
        // of whatever roster was there.
        if (rule && Core.datesBetween(rule, toDate, toDate).indexOf(toDate) !== -1) {
            throw new Error(
                'This event already happens on ' + toDate + '. Pick a date it does not.'
            );
        }

        const fromId = Core.occurrenceId(seriesId, fromDate);
        const toId = Core.occurrenceId(seriesId, toDate);

        // Read the documents directly rather than through `loadOccurrence`: this
        // is a question about DOCUMENTS, not about dates, and the rebuild path
        // would answer a different one. A refusal reads as "no document" for the
        // same reason it does everywhere else — a missing document is denied, not
        // absent — and an editor who may write here may read here.
        const notThere = e => {
            if (e && e.code === 'permission-denied') return null;
            throw e;
        };

        const target = await occurrenceRef(db, toId).get().catch(notThere);
        if (target && target.exists) {
            throw new Error('There is already something on ' + toDate + ' for this event.');
        }

        const sourceDoc = await occurrenceRef(db, fromId).get().catch(notThere);
        const source = (sourceDoc && sourceDoc.exists)
            ? Object.assign({ id: fromId, stored: true }, sourceDoc.data())
            : null;

        const roster = source
            ? await occurrenceRef(db, fromId).collection(ROSTER).get().catch(() => ({ docs: [] }))
            : { docs: [] };
        const assignments = roster.docs.map(d => d.data());
        const visibility = (source && source.visibility)
            || (series && series.visibility) || 'member';

        // The instance, on its new day. `movedFrom` is kept so the date can say
        // where it came from — somebody looking at the fifteenth needs to know it
        // is the first Sunday's gathering, not an extra one.
        const moved = occurrencePayload(Object.assign({}, source || {}, {
            id: toId,
            seriesId: seriesId,
            date: toDate,
            visibility: visibility,
            movedFrom: fromDate,
            assignments: assignments,
        }));
        delete moved.movedTo;
        delete moved.stored;

        const writes = [
            { kind: 'set', ref: occurrenceRef(db, toId), data: moved, options: { merge: true } },
        ];
        assignments.forEach(a => {
            writes.push({
                kind: 'set',
                ref: occurrenceRef(db, toId).collection(ROSTER).doc(rosterId(a)),
                data: a,
            });
        });

        // The original date, saying where it went and holding nobody. Written
        // BEFORE anything is deleted: if a delete landed and the write failed,
        // the roster would be gone and the instance nowhere.
        writes.push({
            kind: 'set',
            ref: occurrenceRef(db, fromId),
            data: {
                seriesId: seriesId,
                date: fromDate,
                visibility: visibility,
                movedTo: toDate,
                participantIds: [],
                needsAttention: false,
            },
            options: { merge: true },
        });

        // Deletes LAST, after everything above has been written.
        roster.docs.forEach(doc => writes.push({ kind: 'delete', ref: doc.ref }));

        await commitInBatches(db, writes);
        return { from: fromId, to: toId, assignments: assignments.length };
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

    // What the Event IS: its name, where it happens, what it is for. These live
    // on the series because they are true of every date of it.
    //
    // A PATCH, never a blanket write. A screen that does not know about a field
    // must not be able to clear it by omission — but a field passed as empty is
    // cleared, because deleting the location is a thing somebody means to do.
    const DETAIL_FIELDS = ['name', 'location', 'description'];

    async function saveSeriesDetails(db, seriesId, details) {
        if (!seriesId) throw new Error('Details need an event to belong to.');
        const d = details || {};

        if ('name' in d && !String(d.name || '').trim()) {
            throw new Error('An event needs a name.');
        }

        const payload = {};
        DETAIL_FIELDS.forEach(field => {
            if (!(field in d)) return;
            const value = String(d[field] == null ? '' : d[field]).trim();
            payload[field] = value || null;
        });
        if (!Object.keys(payload).length) return payload;

        await db.collection(SERIES).doc(seriesId).set(payload, { merge: true });
        return payload;
    }

    // ── Editing a one-off Event ──────────────────────────────────────────────
    //
    // A one-off has no series, so everything true of it is true of its single
    // occurrence — and nothing could edit any of it. It was creatable and then
    // frozen: wrong time, wrong hall, wrong name, no way back.
    //
    // A PATCH, for the same reason the series one is. The roster and the derived
    // participant list are not in `OCCURRENCE_DETAIL_FIELDS`, so a screen that
    // does not know about them cannot clear them by omission.
    const OCCURRENCE_DETAIL_FIELDS = ['name', 'location', 'description', 'time', 'date'];

    async function saveOccurrenceDetails(db, id, details) {
        if (!id) throw new Error('Details need an event to belong to.');
        const d = details || {};

        if ('name' in d && !String(d.name || '').trim()) {
            throw new Error('An event needs a name.');
        }
        if ('visibility' in d && Core.VISIBILITY_ORDER.indexOf(d.visibility) === -1) {
            // An unrecognised stamp is readable by NOBODY once the rule reads it,
            // so a typo here makes the Event vanish for everyone including the
            // editor who caused it.
            throw new Error('Unknown visibility: ' + d.visibility);
        }

        // Changing the date of a date OF A SERIES would leave a document called
        // midweek_2026-08-05 claiming to be the twelfth, because the id is
        // derived from the date. `moveOccurrence` is the operation for that, and
        // it rewrites the id.
        if ('date' in d) {
            const parsed = Core.parseOccurrenceId(id);
            if (parsed) {
                throw new Error(
                    'One date of a repeating event cannot be re-dated here — use "Move this one", ' +
                    'which moves it properly and leaves a note on the original date.'
                );
            }
        }

        const payload = {};
        OCCURRENCE_DETAIL_FIELDS.forEach(field => {
            if (!(field in d)) return;
            const value = String(d[field] == null ? '' : d[field]).trim();
            payload[field] = value || null;
        });
        if ('visibility' in d) payload.visibility = d.visibility;
        if ('rosterShared' in d) payload.rosterShared = d.rosterShared === true;

        if (!Object.keys(payload).length) return payload;

        await occurrenceRef(db, id).set(payload, { merge: true });
        return payload;
    }

    // ── The colour a series shows up as ──────────────────────────────────────
    //
    // One write, to the series. The contrast with visibility above is the point:
    // visibility has to be copied onto every occurrence because a SECURITY RULE
    // reads it off the document, and a rule cannot go and look at the series.
    // A colour is only ever read at display time, where the series is already in
    // hand — so copying it down would be hundreds of writes bought nothing, and
    // every copy another chance to go stale.
    //
    // The palette lives in calendar-view.js, which is a display module this one
    // must not depend on. So the slugs are restated here and a test holds the
    // two lists together — the same trade the Sunday Service id already makes.
    const COLOUR_SLUGS = ['steel', 'ocean', 'navy', 'green', 'gold', 'amber', 'plum', 'rose'];

    // Who already holds a liturgical Role on this Sunday. Read from the SERVICE
    // document, because that is where a Sunday's liturgy lives — the fields the
    // printed booklet reads, not Assignments.
    //
    // A refusal degrades to nobody rather than failing the page. That direction
    // is deliberate but worth naming: the cost is that somebody preaching stays
    // assignable for a reader who cannot see the Service, which is a worse
    // suggestion, not a wrong write. Failing the page instead would stop the
    // whole Sunday being staffed.
    async function loadLiturgicalHolders(db, date) {
        try {
            const snap = await db.collection('services').doc(String(date || '')).get();
            return snap.exists ? Core.liturgicalHolders(snap.data()) : [];
        } catch (e) {
            return [];
        }
    }

    // ── Managing a series ────────────────────────────────────────────────────
    //
    // MS-13 built this model — a locked series carrying locked Roles, and a
    // reconcile that repairs one — and no screen ever reached it. So the Sunday
    // Service has been a real document with real Roles on it that nobody could
    // see, let alone change.

    async function loadSeries(db, seriesId) {
        const snap = await db.collection(SERIES).doc(seriesId).get();
        return snap.exists ? Object.assign({ id: snap.id }, snap.data()) : null;
    }

    // Create the Sunday Service if it has never existed, repair it if it has
    // drifted, and write nothing at all if it is already right — so this is safe
    // to call every time the screen opens.
    async function ensureSundayService(db, liturgicalSlugs) {
        const stored = await loadSeries(db, Core.SUNDAY_SERVICE_ID);
        const result = Events.reconcileSundayService(stored, liturgicalSlugs);

        if (result.changed) {
            const payload = Object.assign({}, result.series);
            delete payload.id;
            await db.collection(SERIES).doc(Core.SUNDAY_SERVICE_ID).set(payload, { merge: true });
        }

        return {
            series: Object.assign({ id: Core.SUNDAY_SERVICE_ID }, result.series),
            created: !stored,
            repaired: !!stored && result.changed,
            reason: result.reason,
        };
    }

    // Which Roles the series carries. A LOCKED Role cannot be dropped: the
    // liturgical ones are assigned through the Service entity and print in the
    // booklet, so a series that stopped listing one would leave the Guide
    // reaching for a Role the Event says it does not have.
    async function setSeriesRoles(db, seriesId, roleSlugs) {
        const stored = await loadSeries(db, seriesId);
        if (!stored) throw new Error('No such event series: ' + seriesId);

        const locked = stored.lockedRoleSlugs || [];
        const dropped = locked.filter(slug => (roleSlugs || []).indexOf(slug) === -1);
        if (dropped.length) {
            throw new Error(
                'These Roles are locked to "' + (stored.name || seriesId) + '" and cannot be ' +
                'removed: ' + dropped.join(', ')
            );
        }

        await db.collection(SERIES).doc(seriesId).set({ roleSlugs: roleSlugs }, { merge: true });
        return roleSlugs;
    }

    // The time it starts. Written onto the RECURRENCE RULE rather than beside it,
    // because that is where every other date-shaped fact about a series lives and
    // where `recurrenceSentence` reads it from.
    //
    // For the Sunday Service this quietly ends its reliance on the implied rule:
    // once a rule is stored, `recurrenceFor` prefers it. So the rule written here
    // has to keep saying "every Sunday" — anything else moves the Sundays.
    async function setSeriesTime(db, seriesId, time) {
        if (time && !/^\d{1,2}:\d{2}$/.test(String(time))) {
            throw new Error('A time reads as HH:MM, not "' + time + '".');
        }
        const stored = await loadSeries(db, seriesId);
        const base = recurrenceFor(stored ? Object.assign({ id: seriesId }, stored) : { id: seriesId })
            || { freq: 'once', startDate: null };

        const rule = Object.assign({}, base, { time: time || null });
        await db.collection(SERIES).doc(seriesId).set({ recurrence: rule }, { merge: true });
        return rule;
    }

    async function setSeriesColour(db, seriesId, colour) {
        if (!seriesId) throw new Error('A colour needs an event to belong to.');
        if (COLOUR_SLUGS.indexOf(colour) === -1) {
            throw new Error('Unknown colour: ' + colour);
        }
        await db.collection(SERIES).doc(seriesId).set({ colour: colour }, { merge: true });
        return colour;
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
        attachRosters,
        // writing
        createEvent,
        cancelOccurrence,
        moveOccurrence,
        recurrenceFor,
        SUNDAY_RULE,
        saveOccurrence,
        loadOccurrence,
        occurrencePayload,
        restampSeriesVisibility,
        setSeriesColour,
        loadSeries,
        loadLiturgicalHolders,
        ensureSundayService,
        setSeriesRoles,
        setSeriesTime,
        saveSeriesDetails,
        saveOccurrenceDetails,
        COLOUR_SLUGS,
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
