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

        // ⚠ THE QUERY REACHES BACK FURTHER THAN THE WINDOW ASKED FOR.
        //
        // An Event that runs over several days is stored under its FIRST day, so
        // a plain `date >= from` drops any run that started before the window and
        // is still going inside it — a break from 28 December to 3 January simply
        // would not appear in January. Firestore cannot express "starts before
        // `from` but ends after it" (that is two ranges on two fields), so the
        // read widens by the longest span the model allows and the overlap is
        // settled in `Core.overlapsRange` on the way back.
        //
        // The cap is what makes this affordable: the widening is bounded at 60
        // days, not "since records began".
        const windowFrom = shiftDays(opts.from, -Core.MAX_SPAN_DAYS);

        const inRange = query => query
            .where('date', '>=', windowFrom)
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

        // The widened read is trimmed back to what the caller actually asked for.
        // A single-day Event outside the window fails this exactly as the query
        // used to; a run that reaches into it survives.
        return Core.mergeVisibleOccurrences(sets[0], sets[1] || [])
            .filter(o => Core.overlapsRange(o, opts.from, opts.to))
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

    // ── One series, across a window of its own dates ─────────────────────────
    //
    // What the Recurring Events grid stands on: every date the RULE produces in
    // the window, each carrying whatever is actually rostered on it. Dates with
    // no document are present and empty — the sparse promise (ADR-0018 §3) —
    // because a blank column is the answer to "who is on that Sunday", not a
    // missing row.
    //
    // ⚠ CONSTRAINED BY VISIBILITY, like every other read here. The composite
    // index (visibility ASC, seriesId ASC, date ASC) exists for exactly this.
    // Unconstrained it does not return fewer rows, it errors — and the error
    // reads as "this series has never been rostered".
    //
    // The rosters come back through `attachRosters` with `staffingFrom` set to
    // the start of the window, which is what makes an editor's read the WHOLE
    // roster of every staffed date rather than only their own row.
    async function loadSeriesWindow(db, seriesId, options) {
        const opts = options || {};
        const q = Core.visibilityQueryFor(opts.rank, opts.personId);

        const snap = await db.collection(OCCURRENCES)
            .where('visibility', 'in', q.rungs)
            .where('seriesId', '==', seriesId)
            .where('date', '>=', opts.from)
            .where('date', '<=', opts.to)
            .get();

        const stored = snap.docs.map(d => Object.assign({ id: d.id }, d.data()));
        await attachRosters(db, stored, {
            rank: opts.rank,
            personId: opts.personId,
            staffingFrom: opts.from,
        });

        const byDate = {};
        stored.forEach(o => { byDate[o.date] = o; });
        return byDate;
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
    //   outForCover    — whether that flag means "somebody is looking for cover"
    //                    or "this one is going nowhere" (MS-20). The editor wants
    //                    opposite things from those two, and needsAttention alone
    //                    cannot tell them apart.
    //
    // All three are DERIVED from the assignments in the same write. Never
    // maintained by hand, or they drift from the truth security depends on.
    function occurrencePayload(occurrence) {
        const assignments = occurrence.assignments || [];
        const payload = Object.assign({}, occurrence, {
            participantIds: Core.participantIds(assignments),
            needsAttention: Core.needsAttention({ assignments: assignments }),
            // Reads the rung as well as the states, so it is given the whole
            // occurrence rather than just its assignments.
            outForCover: Core.outForCover(
                Object.assign({}, occurrence, { assignments: assignments })),
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
        // A span is a one-off's alone (see `endDateOf`). On a date of a series it
        // is meaningless, and stored it would draw that one date across a week
        // the series knows nothing about.
        if (payload.seriesId) {
            delete payload.time;
            delete payload.endDate;
        }
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

        // Occurrences are SPARSE. A date nobody has touched has NO DOCUMENT, so
        // "no document" is not the same as "no such event" — and answering
        // "could not be found" is wrong in the worst way, because the date is
        // real, it is on the Calendar, and somebody just clicked it.
        //
        // The id is deterministic for exactly this reason: it carries the series
        // and the date, so the occurrence can be rebuilt without a document.
        //
        // ⚠ THE ROSTER SURVIVES THE REBUILD. These two reads are independent,
        // and an editor is allowed the roster (`isEditor()`) even when the
        // DOCUMENT read is refused. Returning the bare rebuild threw away
        // assignments already in hand, so every place on the date read as empty
        // — a roster that was really there, showing as "needs people".
        if (!doc || !doc.exists) {
            const rebuilt = await rebuildOccurrence(db, id);
            if (rebuilt && roster.docs.length) {
                rebuilt.assignments = roster.docs.map(d => d.data());
                rebuilt.participantIds = Core.participantIds(rebuilt.assignments);
                rebuilt.needsAttention = Core.needsAttention(rebuilt);
                rebuilt.outForCover = Core.outForCover(rebuilt);
            }
            return rebuilt;
        }

        return Object.assign({ id: doc.id, stored: true }, doc.data(), {
            assignments: roster.docs.map(d => d.data()),
        });
    }

    // The visibility an occurrence of this series has to CARRY.
    //
    // ⚠ EVERY WRITE THAT CREATES AN OCCURRENCE MUST STAMP THIS. The rule reads
    // `resource.data.visibility` off the document itself and cannot go and look
    // at the series (ADR-0018 §5) — and `stampedVisibility()` answers 'none' for
    // a document that has no such field, which `rankCanSee` refuses for
    // EVERYONE, editors included. A document written without it is one nobody
    // can read back, including the person who just wrote it. The list queries
    // filter on `visibility` too, so it also drops off the Calendar.
    function stampFor(series, seriesId) {
        return {
            // The Sunday Service is permanently public and the series rule names
            // it explicitly rather than reading a field, so the series document
            // may carry no stamp of its own.
            visibility: (series && series.visibility)
                || (seriesId === Core.SUNDAY_SERVICE_ID ? 'public' : 'member'),
            rosterShared: !!(series && series.rosterShared === true),
        };
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

        return Object.assign({
            id: id,
            seriesId: parsed.seriesId,
            date: parsed.date,
            stored: false,
            name: series.name,
            seriesName: series.name,
            seriesColour: series.colour,
            time: rule.time || null,
            participantIds: [],
            assignments: [],
        }, stampFor(series, parsed.seriesId));
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
            const date = rule.startDate || s.date;
            // Refused rather than quietly dropped: somebody who typed a last day
            // and got a one-day event back would have no idea why.
            const spanFault = Core.spanError({ date: date, endDate: s.endDate });
            if (spanFault) throw new Error(spanFault);

            const payload = occurrencePayload(Object.assign({
                id: ref.id,
                seriesId: null,
                date: date,
                endDate: s.endDate || null,
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

    // Cancel ONE date of a series without touching the rest. This is usually the
    // first thing that lands on that date, so it is also usually the first time a
    // document exists for it — exactly the sparse rule working.
    //
    // ⚠ AND THAT IS WHY IT HAS TO STAMP. A skip is the one write most likely to
    // CREATE an occurrence, and for a long time it wrote `{ cancelled: true }`
    // and nothing else. A document with no `visibility` is refused to everyone by
    // the rule and is dropped by every list query, so the skip landed in the
    // database and then vanished: the Calendar rebuilt the date from the pattern
    // and drew the event as though nothing had happened, and reopening the date
    // was denied the document and rebuilt it too, with the flag gone. Pressing
    // "Skip this one" appeared to do nothing at all.
    //
    // `options.series` lets a caller that already holds the series hand it over
    // rather than making this read it again — and an editor may be refused an
    // elder-level series, which would otherwise turn a skip into an error.
    async function cancelOccurrence(db, seriesId, date, cancelled, options) {
        const id = Core.occurrenceId(seriesId, date);
        if (!id) throw new Error('Only a date of a series can be cancelled.');

        // A MISSING DOCUMENT IS DENIED, NOT ABSENT — the rule reads
        // `resource.data` and `resource` is null for a document that is not
        // there. Sparse dates are the ordinary case, so a refusal here means
        // "nothing has landed on this date yet", not "you may not".
        const doc = await occurrenceRef(db, id).get().catch(e => {
            if (e && e.code === 'permission-denied') return null;
            throw e;
        });

        const patch = { cancelled: cancelled !== false };

        // Only when creating. On a date that already has a document, re-stamping
        // from the series would overwrite whatever that date carries, and
        // `participantIds: []` would wipe the very list the rule uses to let the
        // people on the roster see they have been stood down.
        if (!doc || !doc.exists) {
            const series = (options && options.series)
                || await loadSeries(db, seriesId);
            Object.assign(patch, {
                seriesId: seriesId,
                date: date,
                participantIds: [],
                needsAttention: false,
                outForCover: false,
            }, stampFor(series, seriesId));
        }

        await occurrenceRef(db, id).set(patch, { merge: true });
        return id;
    }

    // ── Deleting a ONE-OFF outright ──────────────────────────────────────────
    //
    // A one-off Event IS its occurrence document, so deleting the document
    // deletes the Event. There is no pattern above it to argue with.
    //
    // ⚠ A DATE OF A SERIES IS NEVER DELETED. The pattern still produces that
    // date, so removing the document does not remove the date — it only removes
    // the note saying otherwise, and the Calendar draws the event straight back.
    // That is what "Skip this one" and "Move this one" are for, and both leave a
    // marker behind for exactly this reason.
    //
    // Serving already recorded on people is NOT touched. An Involvement is the
    // fact that somebody served (ADR-0018 §1); deleting the plan afterwards does
    // not un-happen it, and a past Event's serve records belong to the people,
    // not to this document.
    async function deleteOccurrence(db, id) {
        if (!id) throw new Error('There is no event to delete.');

        const doc = await occurrenceRef(db, id).get().catch(e => {
            if (e && e.code === 'permission-denied') return null;
            throw e;
        });
        if (!doc || !doc.exists) throw new Error('That event is not there to delete.');

        if ((doc.data() || {}).seriesId) {
            throw new Error(
                'This is one date of a repeating event. Skip it or move it — deleting ' +
                'the date only makes the pattern draw it again.'
            );
        }

        const roster = await occurrenceRef(db, id).collection(ROSTER).get()
            .catch(() => ({ docs: [] }));

        // The roster FIRST, the document last. The other way round leaves a
        // subcollection under a document that is gone — rows nothing can reach
        // and nothing will ever clean up.
        const writes = roster.docs.map(d => ({ kind: 'delete', ref: d.ref }));
        writes.push({ kind: 'delete', ref: occurrenceRef(db, id) });

        await commitInBatches(db, writes);
        return { assignments: roster.docs.length };
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
                outForCover: false,
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
    //
    // ⚠ THE READ IS CONSTRAINED BY VISIBILITY, like every other occurrence query
    // here. It was not, and that was a bug that hit SUPER ADMINS: this is the one
    // read in the app that asks for a series' dates without naming a rung, and an
    // occurrence carrying NO stamp (written before the stamping fixes above) is
    // refused to everyone — `stampedVisibility()` answers 'none', which matches no
    // clause in the rule. Firestore fails the WHOLE query when one row is refused,
    // so a single legacy document made "change the visibility" read
    // `Missing or insufficient permissions` for a person allowed to see all five
    // rungs. Naming the rungs leaves the unreadable row out of the result instead.
    //
    // An unstamped occurrence is therefore NOT restamped by this — it cannot be
    // read, so it cannot be found. It is already invisible on every surface;
    // repairing one is a data job, not something this can do from the client.
    async function restampSeriesVisibility(db, seriesId, visibility, rosterShared, options) {
        if (seriesId === Core.SUNDAY_SERVICE_ID) {
            throw new Error('The Sunday Service is permanently public and its visibility cannot be changed.');
        }
        if (Core.VISIBILITY_ORDER.indexOf(visibility) === -1) {
            throw new Error('Unknown visibility: ' + visibility);
        }

        // The caller's OWN rungs, not all five — the same constraint `openPattern`
        // and `seriesRoleUsage` use. Anyone editing this series can already see it,
        // so their rungs cover every date of it.
        //
        // The rank is REQUIRED, and a missing one is refused rather than defaulted.
        // `rungsFor` falls back to `['public']` for a rank it does not know, which
        // here would restamp the public dates of the series and quietly leave the
        // rest at their old visibility — a half-private Event, and no error to say
        // so. `shiftOccurrences` refuses a partial write for the same reason.
        const rank = (options || {}).rank;
        if (!rank) throw new Error('Changing an event’s visibility needs to know who is asking.');
        const rungs = Core.visibilityQueryFor(rank).rungs;

        // No date filter. "Every occurrence, past ones included" is the whole
        // point — a range here would be the bug.
        const snap = await db.collection(OCCURRENCES)
            .where('visibility', 'in', rungs)
            .where('seriesId', '==', seriesId)
            .get();

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
    const OCCURRENCE_DETAIL_FIELDS = ['name', 'location', 'description', 'time', 'date', 'endDate'];

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

        // A span is checked against the first day, and a patch may carry only one
        // of the two — "make it end on the 27th" says nothing about when it
        // starts. So the stored date is fetched when the patch does not supply
        // one, rather than the span being waved through unchecked.
        if ('endDate' in d && d.endDate) {
            const seriesOccurrence = Core.parseOccurrenceId(id);
            let date = d.date;
            if (!date && !seriesOccurrence) {
                const doc = await occurrenceRef(db, id).get();
                date = doc.exists ? doc.data().date : null;
            }
            const spanFault = Core.spanError({
                date: date || (seriesOccurrence && seriesOccurrence.date),
                endDate: d.endDate,
                seriesId: seriesOccurrence ? seriesOccurrence.seriesId : null,
            });
            if (spanFault) throw new Error(spanFault);
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

        // ⚠ A Cross-Role Rule naming a Role this Event no longer runs can never
        // fire, and one left lying about is worse than absent: add the Role back
        // a year later and a rule nobody remembers writing starts refusing
        // people. So the two are written together rather than leaving the
        // second to a later save that might not come.
        const kept = Events.crossRoleRulesOf(stored).filter(rule => (
            ((rule && rule.roleSlugs) || []).every(slug => (roleSlugs || []).indexOf(slug) !== -1)
        ));

        await db.collection(SERIES).doc(seriesId).set(
            { roleSlugs: roleSlugs, crossRoleRules: kept }, { merge: true }
        );
        return roleSlugs;
    }

    // The Cross-Role Rules of a series (MS-220): "the Kids Leader and the Kids
    // Helper must not be married to each other". Written whole rather than
    // appended to, because the page holds the list and has already checked each
    // rule against the Relationship Types it can see.
    //
    // The one check repeated here is the PAIR, because it is the one this layer
    // can make on its own: a rule may only name Roles the Event actually runs.
    // The page is a convenience; this is the boundary.
    async function setSeriesCrossRoleRules(db, seriesId, rules) {
        const stored = await loadSeries(db, seriesId);
        if (!stored) throw new Error('No such event series: ' + seriesId);

        const slugs = stored.roleSlugs || [];
        const list = (rules || []).map(rule => ({
            kind: rule.kind,
            typeId: rule.typeId,
            roleSlugs: ((rule && rule.roleSlugs) || []).slice(),
        }));

        list.forEach(rule => {
            const pair = rule.roleSlugs;
            if (pair.length !== 2 || pair[0] === pair[1]) {
                throw new Error('A cross-Role rule names two different Roles.');
            }
            const missing = pair.filter(slug => slugs.indexOf(slug) === -1);
            if (missing.length) {
                throw new Error(
                    'These Roles are not on "' + (stored.name || seriesId) + '", so a rule ' +
                    'about them could never apply: ' + missing.join(', ')
                );
            }
        });

        await db.collection(SERIES).doc(seriesId).set({ crossRoleRules: list }, { merge: true });
        return list;
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

    // ── Accepting a draft ────────────────────────────────────────────────────
    //
    // Auto-assign holds a whole range in a browser as a PROPOSAL. Nothing in it
    // is an Assignment (ADR-0018 fixed that state machine at three states and it
    // gains no fourth), nobody is assigned, and no serve history has moved.
    // This is the write that changes that, all at once.
    //
    // Three things it has to get right:
    //
    //   OCCURRENCES ARE SPARSE. A document exists only once something has been
    //   said about a date, so most future dates in a range have none at all.
    //   They are created here, on the deterministic id, so two editors
    //   accepting at once land on one document rather than a twin.
    //
    //   PENDING, NOT CONFIRMED. Nobody has been asked. But a seat the editor
    //   KEPT arrives carrying the state it already had, and that state survives
    //   — accepting a draft must never quietly un-say somebody's yes.
    //
    //   THE DRAFT OWNS ONLY WHAT IT DRAFTED. Every place of every Role in
    //   `roleSlugs` on that date is replaced by what the draft says, including
    //   being emptied. Anything else on the date — a one-off job, a Role the
    //   series does not carry any more — is left exactly where it is.
    //
    // Not atomic across the range: a long one exceeds a batch, so it is written
    // date by date and reports which ones landed. A caller that stops half way
    // has really written half.
    async function acceptDraft(db, draft, options) {
        const o = options || {};
        const owned = o.roleSlugs || [];
        const written = [];
        let assignments = 0;

        // Skipped dates were never drafted. "Leave out" means leave out.
        const days = ((draft || {}).dates || []).filter(day => day && !day.skipped);

        // Read once, for the whole range. Most of these dates have no document
        // yet, so this write CREATES them — and a created occurrence has to
        // carry its own visibility stamp or nobody can read it back. Accepting a
        // roster used to write the seats and nothing else, so every date it
        // touched became unreadable and showed as needing people.
        const series = days.length ? await loadSeries(db, o.seriesId) : null;
        const stamp = stampFor(series, o.seriesId);

        for (const day of days) {
            const id = Core.occurrenceId(o.seriesId, day.date);
            const existing = await occurrenceRef(db, id).collection(ROSTER).get();

            const kept = existing.docs
                .map(doc => doc.data())
                .filter(a => a && owned.indexOf(a.roleSlug) === -1);

            const drafted = (day.seats || [])
                .filter(seat => seat && seat.personId && seat.roleSlug)
                .map(seat => {
                    const fresh = Core.newAssignment(seat, o.actor);
                    // A kept seat keeps its own state and who set it; only a
                    // newly drafted one starts Pending.
                    return seat.held && seat.state
                        ? Object.assign(fresh, { state: seat.state })
                        : fresh;
                });

            const roster = kept.concat(drafted);

            // Sparseness holds: a date nobody is on, that nobody WAS on, gets no
            // document. A date whose places the editor emptied does get written
            // — clearing a roster is a real change and has to land.
            if (!roster.length && !existing.docs.length) continue;

            await saveOccurrence(db, Object.assign({
                id: id,
                seriesId: o.seriesId,
                date: day.date,
                assignments: roster,
            }, stamp));

            assignments += drafted.length;
            written.push(day.date);
        }

        return {
            dates: written,
            occurrences: written.length,
            assignments: assignments,
        };
    }

    // ── Taking everybody off a run of dates ──────────────────────────────────
    //
    // The inverse of accepting a draft. Auto-assign can already empty a place by
    // drafting nobody into it, but only one Role at a time and only through a
    // proposal — and an editor who wants a whole stretch back to blank should
    // not have to draft a rota in order to throw it away.
    //
    // The roster rows go. The OCCURRENCE stays, because a date carries things
    // that are not its roster — a cancellation, an order of service, a one-off
    // job somebody still means to fill — and deleting the document to empty the
    // rota would take those with it.
    //
    // ⚠ THE TWO DERIVED FIELDS MOVE IN THE SAME WRITE. `participantIds` is what
    // the security rule reads to decide who may see the date at all, so a stale
    // one leaves people able to read an Event they are no longer on.
    // `needsAttention` is a declined flag with no declines left behind it. They
    // are never maintained by hand — both are recomputed from the empty roster
    // by the same core the ordinary save uses.
    //
    // A SERVE IS NOT UNDONE. The fact that somebody served is theirs and lives
    // on the Person (ADR-0018 §1); this deletes the plan, and for a past date it
    // would delete the plan while leaving the history — which is why the caller
    // is expected to keep its dates in the future.
    //
    // Not atomic across the range, for the same reason accepting is not: a long
    // one exceeds a batch. It reports which dates landed, and a caller that
    // stops half way has really cleared half.
    async function clearRosters(db, seriesId, dates) {
        if (!seriesId) throw new Error('A rota belongs to an event.');

        const cleared = [];
        let assignments = 0;

        for (const date of (dates || [])) {
            const id = Core.occurrenceId(seriesId, date);
            if (!id) continue;

            const ref = occurrenceRef(db, id);
            const roster = await ref.collection(ROSTER).get();

            // Sparseness holds in reverse: a date with nothing on it needs no
            // write at all, and stamping an empty participant list onto a
            // document that has none would create one for nothing.
            if (!roster.docs.length) continue;

            const writes = roster.docs.map(d => ({ kind: 'delete', ref: d.ref }));
            writes.push({
                kind: 'set',
                ref: ref,
                options: { merge: true },
                data: {
                    participantIds: Core.participantIds([]),
                    needsAttention: Core.needsAttention({ assignments: [] }),
                    outForCover: false,
                },
            });

            await commitInBatches(db, writes);
            cleared.push(date);
            assignments += roster.docs.length;
        }

        return { dates: cleared, assignments: assignments };
    }

    // ── Seeding a serve (MS-182) ─────────────────────────────────────────────
    //
    // ⚠ THIS IS THE ONE THING ON THE AUTO-ASSIGN SCREEN THAT WRITES AT ONCE.
    // Everything else there is a proposal held in the browser until Accept. A
    // serve record is not part of the draft — it is a claim about the PAST, and
    // a past that only exists if you later accept a rota would be a strange
    // thing indeed.
    //
    // It records a SERVE, never a load figure. Fairness has two dials: a figure
    // would drop somebody down the pool while leaving the solver believing they
    // have never held the Role, so the burnout gate reads fixed and the
    // rotation is still blind. A serve moves both, and the number then explains
    // itself — it is six because of these six things.
    //
    // `seeded` marks it as typed in rather than lived through, so the panel
    // knows which records it may offer to take back.
    async function seedServe(db, serve) {
        const s = serve || {};
        if (!s.personId || !s.roleSlug || !s.date) {
            throw new Error('A serve needs a person, a Role and a date.');
        }

        const personRef = db.collection('people').doc(s.personId);
        const data = Events.stampSeries({
            serviceDate: s.date,
            type: s.roleSlug,
            seeded: true,
            createdAt: new Date().toISOString(),
        }, s.seriesId);
        if (s.oneOffId) data.metadata = { oneOffId: s.oneOffId };

        const ref = await personRef.collection('involvement').add(data);
        return Object.assign({ id: ref.id, personId: s.personId }, data);
    }

    async function removeServe(db, personId, involvementId) {
        if (!personId || !involvementId) {
            throw new Error('Removing a serve needs the person and the record.');
        }
        await db.collection('people').doc(personId)
            .collection('involvement').doc(involvementId).delete();
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
            // An Event running over several days moves as a WHOLE. Shifting the
            // first day and leaving the last where it was would slide a five-day
            // break into a run that ends before it starts — and the model would
            // then read the span as absent, so the event would quietly shrink to
            // one day rather than announce itself.
            const shifted = { id: newId, date: newDate };
            if (item.data.endDate) shifted.endDate = shiftDays(item.data.endDate, step);

            setsAndUpdates.push({
                kind: 'set',
                ref: occurrenceRef(db, newId),
                data: Object.assign({}, item.data, shifted),
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
        loadSeriesWindow,
        attachRosters,
        // writing
        createEvent,
        cancelOccurrence,
        deleteOccurrence,
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
        setSeriesCrossRoleRules,
        setSeriesTime,
        saveSeriesDetails,
        saveOccurrenceDetails,
        COLOUR_SLUGS,
        saveRoster,
        acceptDraft,
        clearRosters,
        // seeding a serve (MS-182) — the one write that does not wait for accept
        seedServe,
        removeServe,
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
