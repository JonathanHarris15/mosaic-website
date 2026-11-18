// Cover Store — the Firestore adapter for the cover list (MS-20).
//
// The cover list is every Assignment currently needing somebody: one document
// per open place, soonest first, readable by anyone the Event's own visibility
// rung already admits.
//
// ⚠ WHY THIS IS A COLLECTION AND NOT A QUERY.
//
// The obvious build is "query every declined roster row". It cannot be done. A
// person's Assignment lives in a `roster` subcollection under the occurrence,
// and that subcollection exists for exactly one reason: so a member cannot read
// anybody else's (ADR-0018 §5). The collection-group rule is clamped to your own
// `personId`. A cover list built that way would ask every member to read every
// other member's roster row across every Event — removing the gate rather than
// bending it.
//
// So a small document is written ALONGSIDE the decline, in the same transaction,
// carrying only what the list needs to render and act on. That is the same
// discipline `participantIds` and `needsAttention` already follow: denormalise
// onto a document the rule can afford to read.
//
// It deliberately does NOT name who declined. The list's job is "this place
// needs somebody", and the callable that hands the place over reads the roster
// server-side, where it has no such limit. Naming the decliner would disclose
// something the list does not need.
//
// ⚠ CONSTRAIN THE QUERY. Firestore evaluates rules PER RETURNED DOCUMENT and
// fails the WHOLE query if any row would fail. An unconstrained read does not
// return fewer rows — it errors outright, and the error reads exactly like "no
// places need covering". Same trap as the Calendar's, documented in
// events-store.js and firestore.rules.
//
// Loaded as a classic <script> (window.CoverStore) and exported for Node tests.

(function (global) {
    'use strict';

    const Core = (typeof require !== 'undefined')
        ? require('./events-occurrence-core.js')
        : global.EventsOccurrenceCore;

    const COVER = 'cover';

    // The entry and its id are written by the server only (the cover rule
    // refuses every client write) and are PlaceCore's (place-core.js). This
    // module only reads the list.

    // Does this Assignment's Event belong on the list at all? One definition,
    // in the occurrence model, because the cover store and both server callables
    // all have to agree about the same Event.
    const belongsOnList = Core.canBeCovered;

    // ── Reading it ───────────────────────────────────────────────────────────
    //
    //   rank — the viewer's Permission Level.
    //   from — YYYY-MM-DD; anything before it is behind us and is not a place
    //          anybody can still cover.
    //
    // Sorted client-side rather than with `orderBy`. Combining an `in` filter
    // with a range on another field would need a composite index, and this list
    // is short by its nature — it is the places currently going unfilled, not a
    // log. One less index to keep in step.
    async function loadCoverList(db, options) {
        const opts = options || {};
        const rungs = Core.rungsFor(opts.rank);

        // ⚠ `.where('visibility', 'in', rungs)` is what makes this read legal.
        // Without it the query returns rows above the viewer's rung, they fail
        // the rule, and the whole read errors.
        let query = db.collection(COVER).where('visibility', 'in', rungs);
        if (opts.from) query = query.where('date', '>=', opts.from);

        const snap = await query.get();
        return snap.docs
            .map(d => Object.assign({ id: d.id }, d.data()))
            .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    }

    const CoverStore = {
        COVER,
        belongsOnList,
        loadCoverList,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = CoverStore;
    } else {
        global.CoverStore = CoverStore;
    }
}(typeof window !== 'undefined' ? window : globalThis));
