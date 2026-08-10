// Where a Trade lives, and the two queries that drive every screen (MS-190,
// MS-210).
//
// `trade-core.js` decides what may happen to a Trade; this puts one in Firestore
// and gets it back out. It decides nothing.
//
// ⚠ NO CLIENT EVER WRITES ONE. Every transition goes through a callable, and
// the rule is a flat `if false` — editors included. A member with a browser
// console must not be able to move a Trade to `settled` and skip the machine
// entirely, and "the screen only offers the legal buttons" is not a wall.
//
// ⚠ A TRADE IS READ BY ITS TWO PARTIES AND NOBODY ELSE. It names two people and
// what each is giving up, which is not the congregation's business — not even
// an editor's. That is a different rule from the cover list next door, which is
// stamped with a rung and read by anybody at it: the cover list is an
// advertisement, and a Trade is a conversation.
//
// ⚠ AND THAT IS WHY THE TWO QUERIES ARE SEPARATE. Firestore cannot express
// "holderId == me OR counterpartyId == me" in one query, and a rule that reads
// the document cannot narrow a query that does not filter on the same field —
// an unfiltered read does not return fewer rows, it FAILS, and the failure
// reads exactly like "you have no Trades". So: two queries, each filtered on
// the field the rule checks, merged here.

(function (global) {
    'use strict';

    const Core = (typeof require !== 'undefined')
        ? require('./trade-core.js')
        : global.TradeCore;

    const TRADES = 'trades';

    // ── What one looks like on disk ──────────────────────────────────────────
    //
    // Everything the interface needs to render a row is denormalised onto it, on
    // purpose. A reader may not be allowed to open the Event — an invitation can
    // name a QUIET Assignment which is on no list they could look up — so the
    // row has to stand on its own.
    //
    // What is deliberately NOT here: anything about who declined first, or how
    // many people have been asked. ADR-0018 §5 already settles that a refilled
    // slot keeps no history, and "who keeps saying no" stays unanswerable.
    function tradeFor(spec) {
        const s = spec || {};
        return {
            origin: s.origin,
            state: s.state,
            assignment: s.assignment,
            // Denormalised so a row renders without opening the Event.
            eventName: s.eventName || 'Event',
            roleName: s.roleName || null,
            holderId: s.holderId,
            counterpartyId: s.counterpartyId,
            // The two parties, as one array. The `dying` sweep on settlement
            // asks "every Trade either of these people is in", and one
            // array-contains beats two more queries.
            partyIds: [s.holderId, s.counterpartyId],
            offered: s.offered || [],
            chosen: s.chosen || null,
            openedAt: s.now || null,
            settledAt: null,
        };
    }

    const isMine = (trade, personId) =>
        !!personId && !!trade &&
        (trade.holderId === personId || trade.counterpartyId === personId);

    // ── Reading ──────────────────────────────────────────────────────────────

    // Everything this person has going, both directions.
    //
    // ⚠ THE DATE IS FILTERED HERE, NOT IN THE QUERY. `assignment.date` is a
    // nested field and a range on it beside the equality would want a composite
    // index per direction — for a list that is a handful of rows by its nature.
    // `trade-core` already owns what dead means, so this asks it.
    async function loadMine(db, options) {
        const opts = options || {};
        const personId = opts.personId;
        if (!personId) return { outbound: [], inbound: [], all: [] };

        // ⚠ EACH QUERY FILTERS ON THE FIELD ITS RULE CHECKS. Drop either
        // `where` and the read does not narrow — it fails outright.
        const [asHolder, asCounterparty] = await Promise.all([
            db.collection(TRADES).where('holderId', '==', personId).get(),
            db.collection(TRADES).where('counterpartyId', '==', personId).get(),
        ]);

        const rows = snap =>
            snap.docs.map(d => Object.assign({ id: d.id }, d.data()));

        // ⚠ THE ENDED ONES COME BACK TOO (MS-212). A Trade that died — because
        // somebody else settled first, or an editor filled the place — is still
        // the only record of what happened, and the person it happened to has
        // not been told yet. Filtering to live here is what made those offers
        // vanish silently off the page.
        const mine = rows(asHolder).concat(rows(asCounterparty));
        const live = Core.liveOnes(mine, opts.today).sort(byDate);
        const ended = Core.noticesFor(mine, personId, opts.today).sort(byDate);

        // Outbound is what you are waiting on somebody else for; inbound is what
        // somebody is waiting on you for. That is the split the screen wants —
        // NOT who opened it, which is a fact about the past and tells a reader
        // nothing about what to do next.
        return {
            all: live.concat(ended),
            live: live,
            ended: ended,
            outbound: live.filter(t => Core.waitingOn(t) !== personId),
            inbound: live.filter(t => Core.waitingOn(t) === personId),
        };
    }

    // Every live Trade touching one Assignment — what the cap counts, and what
    // the settlement sweep kills.
    async function loadForAssignment(db, options) {
        const opts = options || {};
        const snap = await db.collection(TRADES)
            .where('assignment.occurrenceId', '==', opts.occurrenceId).get();

        const all = snap.docs.map(d => Object.assign({ id: d.id }, d.data()));
        return Core.liveOnes(all, opts.today)
            .filter(t => !opts.roleSlug ||
                Core.sameAssignment(t.assignment, opts))
            .sort(byDate);
    }

    function byDate(a, b) {
        const x = (a.assignment && a.assignment.date) || '';
        const y = (b.assignment && b.assignment.date) || '';
        return x < y ? -1 : x > y ? 1 : 0;
    }

    const TradesStore = {
        TRADES,
        tradeFor,
        isMine,
        loadMine,
        loadForAssignment,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = TradesStore;
    } else {
        global.TradesStore = TradesStore;
    }
}(typeof window !== 'undefined' ? window : globalThis));
