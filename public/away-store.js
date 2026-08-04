// Away Store — reading and writing the days a Person said they will not be here
// (MS-188).
//
// WHERE IT LIVES, AND WHY IT IS NOT A FIELD ON THE PERSON.
//
// `people/{personId}` is world-readable — names, emails, phone numbers and home
// addresses, to anyone who can reach the endpoint. ADR-0018 met that posture and
// accepted it for `participantIds`, on the grounds that ids disclose very little
// that is not already out.
//
// That reasoning does not stretch to this. A name, a home address and "away
// 10-24 August" together are not directory data — they are a notice that a
// particular house is empty on particular dates. So an Away is a document in a
// SUBCOLLECTION with its own rule (rules are per-path, so a subcollection under
// a world-readable parent is closed unless it is opened), readable by the person
// themselves and by editors and above, and by nobody else.
//
// It carries no reason. "Away" is the whole of what a rota needs; a *why* is
// pastoral, and pastoral information has one home in Mosaic already.
//
// IT NEVER TOUCHES AN ASSIGNMENT. Saying you are away does not decline anything
// — the place stays yours until you hand it on. The clash this module reports is
// read-only, and the roster's own Warning is derived on read, so it appears and
// clears with nothing having to remember it.

(function (global) {
    'use strict';

    const Core = (typeof require === 'function' && typeof module !== 'undefined' && module.exports)
        ? require('./away-core.js')
        : global.AwayCore;

    const PEOPLE = 'people';
    const AWAY = 'away';

    const awayRef = (db, personId) => db.collection(PEOPLE).doc(personId).collection(AWAY);

    // ── Reading ──────────────────────────────────────────────────────────────

    async function loadStretches(db, personId) {
        if (!personId) return [];
        const snap = await awayRef(db, personId).orderBy('start').get();
        return snap.docs.map(d => Object.assign({ id: d.id }, d.data()));
    }

    // ── Writing ──────────────────────────────────────────────────────────────
    //
    // Adding a stretch may swallow the ones it joins (AwayCore merges anything
    // overlapping or merely touching), so the write is the merged document plus
    // the deletion of whatever it absorbed — in ONE batch. Split across two
    // writes, a failure between them would leave the old documents behind, and
    // they would go on making the person away on days they had just redrawn.

    async function addStretch(db, personId, range, author) {
        if (!personId) throw new Error('An Away needs a person it belongs to.');
        const existing = await loadStretches(db, personId);

        const who = author || {};
        const merged = Core.addStretch(existing, {
            start: range.start,
            end: range.end,
            authorPersonId: who.personId || personId,
            authorUid: who.uid || null,
            authorName: who.name || null,
        });

        // The one stretch this add produced — the only member of the merged list
        // with no id yet, or the one carrying what it absorbed.
        const written = merged.find(s => !s.id || (s.absorbed && s.absorbed.length));
        if (!written) return existing;

        const batch = db.batch();
        const ref = written.id ? awayRef(db, personId).doc(written.id) : awayRef(db, personId).doc();

        const payload = {
            start: written.start,
            end: written.end,
            authorPersonId: written.authorPersonId || null,
            authorUid: written.authorUid || null,
            authorName: written.authorName || null,
            updatedAt: new Date().toISOString(),
        };
        batch.set(ref, payload, { merge: true });

        (written.absorbed || []).forEach(id => {
            if (id !== ref.id) batch.delete(awayRef(db, personId).doc(id));
        });

        await batch.commit();
        return merged.map(s => (s === written ? Object.assign({ id: ref.id }, payload) : s));
    }

    async function removeStretch(db, personId, id) {
        if (!personId || !id) return;
        await awayRef(db, personId).doc(id).delete();
    }

    // ── Who is away, across everybody ────────────────────────────────────────
    //
    // What the person picker, the fairness solve and auto-assign ask before they
    // seat anyone. Editors and above only — the collection-group rule says so,
    // and a member running this does not get their own rows back, they get an
    // error that reads like "nobody is ever away".
    //
    // ⚠ ONE RANGE FILTER, NOT TWO. "Overlaps this window" is `end >= from AND
    // start <= to`, and Firestore refuses two range filters on different fields.
    // So the query asks the half it can index and the other half is applied
    // here. Trying to express both server-side does not return fewer rows — it
    // throws, and the screen reads as though nobody in the church is ever away.
    async function loadAwayStretches(db, from, to) {
        const snap = await db.collectionGroup(AWAY).where('end', '>=', from).get();

        const out = [];
        snap.docs.forEach(doc => {
            const s = doc.data();
            if (!s || !s.start || s.start > to) return;
            // The Person is the GRANDPARENT of the document — `away` hangs off
            // `people/{personId}`, and the id is not duplicated into the record.
            const personRef = doc.ref.parent.parent;
            if (!personRef) return;
            out.push(Object.assign({ id: doc.id, personId: personRef.id }, s));
        });
        return out;
    }

    // The same read, flattened to a date → personIds map, which is the shape the
    // solve wants: it asks per date, because being away on the 16th says nothing
    // about the 23rd.
    async function loadAwayBetween(db, from, to) {
        const stretches = await loadAwayStretches(db, from, to);
        const byDate = {};
        stretches.forEach(s => {
            const first = s.start < from ? from : s.start;
            const last = s.end > to ? to : s.end;
            for (let d = first; d <= last; d = Core.addDays(d, 1)) {
                if (!byDate[d]) byDate[d] = [];
                if (byDate[d].indexOf(s.personId) === -1) byDate[d].push(s.personId);
            }
        });
        return byDate;
    }

    // One date, with the stretches themselves — the picker needs the AUTHOR to
    // word the reason, not just the fact.
    async function loadStretchesOn(db, date) {
        return loadAwayStretches(db, date, date);
    }

    async function loadAwayOn(db, date) {
        return (await loadStretchesOn(db, date)).map(s => s.personId);
    }

    // ── The places a clash is measured against ───────────────────────────────
    //
    // Deliberately the CALENDAR'S read rather than a second one. `loadCalendar`
    // already constrains itself by visibility and pulls back only this person's
    // own roster rows — the rule that makes that legal is the same one that
    // makes it legal here, and a second read path would be a second place for
    // the query-constraint trap to be got wrong (ADR-0018 §5).
    //
    // ⚠ This is why the screen cannot simply reuse the Calendar's *Upcoming*
    // rows: Upcoming runs a fortnight or so from today, and an Away can be a
    // year out.
    async function loadPlaces(db, options) {
        const opts = options || {};
        if (!opts.personId || typeof global.EventsStore === 'undefined') return [];

        const occurrences = await global.EventsStore.loadCalendar(db, {
            from: opts.from,
            to: opts.to,
            rank: opts.rank,
            personId: opts.personId,
        });

        const places = [];
        (occurrences || []).forEach(o => {
            ((o && o.assignments) || []).forEach(a => {
                if (!a || a.personId !== opts.personId) return;
                places.push({
                    date: o.date,
                    // The date as a person says it, formatted once here so the
                    // desktop row and the phone tray cannot word it differently.
                    when: Core.longDate(o.date),
                    occurrenceId: o.id,
                    event: o.name || o.seriesName || 'Event',
                    roleSlug: a.roleSlug || null,
                    role: a.label || (opts.roleName ? opts.roleName(a.roleSlug) : a.roleSlug) || 'A role',
                });
            });
        });
        return places.sort((a, b) => (a.date < b.date ? -1 : 1));
    }

    const AwayStore = {
        loadStretches, addStretch, removeStretch, loadPlaces,
        loadAwayStretches, loadAwayBetween, loadStretchesOn, loadAwayOn,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = AwayStore;
    } else {
        global.AwayStore = AwayStore;
    }
}(typeof window !== 'undefined' ? window : globalThis));
