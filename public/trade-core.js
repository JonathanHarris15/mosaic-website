// Trade Core — what a Trade is, and what may happen to it (MS-190, MS-208).
//
// A **Trade** is an offer against an Assignment looking for cover, naming the
// offerer's own Assignments in return. It is how Bob, who cannot do Kids on the
// 14th, asks Sarah — who does it most months — rather than declining into an
// open list and hoping.
//
// ⚠ ONE RECORD, TWO DOORS. An invitation Bob sends and an offer Sarah makes
// uninvited off the cover list are the same document at different points in one
// machine. An invitation begins BEFORE the offer exists; an unsolicited one
// begins AT the offer. Past that they are identical — which is what lets one
// screen render both, and stops the cover list and the request list drifting
// into two half-features that disagree.
//
// ⚠ AN EMPTY OFFER IS NOT AN OFFER. Asking nothing in return is a TAKE, and a
// take needs no answer: MS-20's cover list already settles one in a single tap.
// So two rules fall out, and they are not the same rule:
//
//   · An UNINVITED offer must name at least one Assignment. Wanting to simply
//     take it is the Take button, which is faster and involves nobody else.
//   · An INVITED person replying with nothing SETTLES IT THERE AND THEN. The
//     holder already asked, so the answer IS the agreement. Treating it as an
//     offer-of-nothing awaiting acceptance would invent a state the holder has
//     to clear by hand for a conversation that is already over.
//
// That second one still has to exist, and it is not redundant with Take: a
// QUIET Assignment never reaches the cover list, so an invitation is the only
// way the invited person learns it exists at all.
//
// ⚠ NOTHING IS RESERVED, AND THIS MODULE PROVES NOTHING ABOUT THE WORLD. It
// says what is legal given what it is shown. Whether those Assignments still
// stand — whether an editor has refilled one, whether the counterparty traded
// theirs away elsewhere — is arbitration, and it is MS-209's, decided inside a
// transaction against a fresh read.
//
// PURE. No Firestore, no clock: `today` comes in. Loaded as a classic <script>
// (window.TradeCore) and exported for Node tests.

(function (global) {
    'use strict';

    const STATES = Object.freeze({
        // Bob has asked; nothing has come back yet. Only an invitation is ever
        // here — an unsolicited offer opens one step further along.
        INVITED: 'invited',
        // A set of Assignments is on the table, waiting on the holder.
        OFFERED: 'offered',
        // Both Assignments moved. Terminal.
        SETTLED: 'settled',
        // Somebody said no, at either end. Terminal.
        REFUSED: 'refused',
        // Whoever opened it took their words back. Terminal.
        WITHDRAWN: 'withdrawn',
    });

    const ORIGINS = Object.freeze({
        INVITATION: 'invitation',
        OFFER: 'offer',
    });

    const ACTIONS = Object.freeze({
        INVITE: 'invite',
        OFFER: 'offer',
        ACCEPT: 'accept',
        REFUSE: 'refuse',
        WITHDRAW: 'withdraw',
    });

    const REASONS = Object.freeze({
        NOT_YOURS: 'notYours',
        YOURSELF: 'yourself',
        OVER: 'over',
        DATE_PASSED: 'datePassed',
        CAP_REACHED: 'capReached',
        ALREADY_ASKED: 'alreadyAsked',
        NOTHING_OFFERED: 'nothingOffered',
        NOT_OFFERED: 'notOffered',
        UNKNOWN_ACTION: 'unknownAction',
        // Arbitration only — what the transaction found when it looked again.
        COVERED_MOVED: 'coveredMoved',
        COVERED_TAKEN: 'coveredTaken',
        OFFERED_MOVED: 'offeredMoved',
    });

    // The Assignment state that means "this one is looking for somebody".
    // Restated rather than imported: events-occurrence-core owns the states, and
    // this module is pure of everything, including that.
    const DECLINED = 'declined';

    // Three at a time. Not so few that Bob is waiting on one person, not so
    // many that declining a Saturday texts the whole church.
    const MAX_INVITATIONS = 3;

    const ENDED = Object.freeze([
        STATES.SETTLED, STATES.REFUSED, STATES.WITHDRAWN,
    ]);

    const refuse = reason => ({ ok: false, reason: reason });

    // ── Reading one ──────────────────────────────────────────────────────────

    // One Assignment's identity. The slot is part of it because the same person
    // can legitimately hold two Roles at one Event.
    function assignmentKey(ref) {
        const a = ref || {};
        return [a.occurrenceId, a.roleSlug, a.slotId || 'x'].join('__');
    }

    const sameAssignment = (a, b) => assignmentKey(a) === assignmentKey(b);

    // Strictly past. The day itself has not happened yet, and killing a Trade on
    // the morning somebody is still trying to sort it out would be the wrong
    // way round — the same line the answer callable draws.
    const datePassed = (ref, today) => {
        const date = ref && ref.date;
        return !date || !today || date < today;
    };

    // Nothing more can happen here. Two quite different ways to get there: the
    // conversation ended, or the date did. Both matter to a reader, neither
    // needs a scheduled job — THE DATE IS THE ONLY CLOCK, so a Trade nobody
    // touched simply stops being live when its Event goes past.
    function isDead(trade, today) {
        if (!trade) return true;
        if (ENDED.indexOf(trade.state) !== -1) return true;
        return datePassed(trade.assignment, today);
    }

    const isLive = (trade, today) => !isDead(trade, today);

    const liveOnes = (trades, today) =>
        (trades || []).filter(t => isLive(t, today));

    // Whose move is it? An invitation waits on the person invited; an offer
    // waits on the holder. Nothing that has ended waits on anybody.
    function waitingOn(trade) {
        if (!trade || ENDED.indexOf(trade.state) !== -1) return null;
        if (trade.state === STATES.INVITED) return trade.counterpartyId || null;
        if (trade.state === STATES.OFFERED) return trade.holderId || null;
        return null;
    }

    // How many of the holder's three are spoken for. Counts INVITATIONS only —
    // an offer that turned up uninvited is somebody volunteering, and capping
    // volunteers would be daft. An invitation that has become an offer still
    // counts: Bob is still in that conversation, waiting on an answer he asked
    // for.
    function liveInvitationCount(siblings, assignment, today) {
        return (siblings || []).filter(t =>
            t &&
            t.origin === ORIGINS.INVITATION &&
            sameAssignment(t.assignment, assignment) &&
            isLive(t, today)).length;
    }

    // ── Deciding one step ────────────────────────────────────────────────────
    //
    //   trade          — the Trade being moved, or absent when opening a new one
    //   action         — one of ACTIONS
    //   actorId        — the Person doing it
    //   assignment     — what is being covered (opening only)
    //   holderId       — whose Assignment it is (opening only)
    //   counterpartyId — the other party (opening only)
    //   offered        — the Assignments put up, for OFFER
    //   chosen         — the one taken, for ACCEPT
    //   siblings       — every other Trade on the same Assignment (opening only)
    //   today          — YYYY-MM-DD in the church's timezone
    //
    // Returns { ok, from, to, settles, origin, offered, chosen } or
    // { ok: false, reason }.
    function planTransition(spec) {
        const s = spec || {};
        return s.trade ? move(s) : open(s);
    }

    function open(s) {
        const holderId = s.holderId;
        const counterpartyId = s.counterpartyId;

        if (s.action !== ACTIONS.INVITE && s.action !== ACTIONS.OFFER) {
            return refuse(REASONS.UNKNOWN_ACTION);
        }

        // Inviting is the holder's to do; offering is everybody else's.
        const opener = s.action === ACTIONS.INVITE ? holderId : counterpartyId;
        if (!s.actorId || s.actorId !== opener) return refuse(REASONS.NOT_YOURS);
        if (holderId === counterpartyId) return refuse(REASONS.YOURSELF);

        if (datePassed(s.assignment, s.today)) return refuse(REASONS.DATE_PASSED);

        if (s.action === ACTIONS.OFFER) {
            const offered = s.offered || [];
            // Asking nothing back is a take, and Take is one tap on the cover
            // list. A second, slower way to do the same thing would leave the
            // holder something to clear by hand for no gain.
            if (!offered.length) return refuse(REASONS.NOTHING_OFFERED);
            const stale = offered.some(a => datePassed(a, s.today));
            if (stale) return refuse(REASONS.DATE_PASSED);

            return {
                ok: true, from: null, to: STATES.OFFERED,
                origin: ORIGINS.OFFER, settles: false,
                offered: offered, chosen: null,
            };
        }

        // Asking the same person twice on one Assignment is noise, whichever
        // door the first conversation came through. Asking again after they
        // have refused is not — a refusal answers one question, it is not a
        // standing instruction.
        const asked = (s.siblings || []).some(t =>
            t && isLive(t, s.today) &&
            sameAssignment(t.assignment, s.assignment) &&
            t.counterpartyId === counterpartyId);
        if (asked) return refuse(REASONS.ALREADY_ASKED);

        const live = liveInvitationCount(s.siblings, s.assignment, s.today);
        if (live >= MAX_INVITATIONS) return refuse(REASONS.CAP_REACHED);

        return {
            ok: true, from: null, to: STATES.INVITED,
            origin: ORIGINS.INVITATION, settles: false,
            offered: [], chosen: null,
        };
    }

    function move(s) {
        const trade = s.trade;
        const from = trade.state;

        // Ended and dead are told apart deliberately. "That conversation is
        // over" and "that date has gone" are different things to be told, and a
        // surface that said one for both would be lying half the time.
        if (ENDED.indexOf(from) !== -1) return refuse(REASONS.OVER);
        if (datePassed(trade.assignment, s.today)) {
            return refuse(REASONS.DATE_PASSED);
        }

        if (s.action === ACTIONS.WITHDRAW) {
            // You take back your OWN words: the holder pulls an invitation they
            // sent, the offerer pulls an offer they made. Never each other's.
            const opener = trade.origin === ORIGINS.INVITATION
                ? trade.holderId : trade.counterpartyId;
            if (s.actorId !== opener) return refuse(REASONS.NOT_YOURS);
            return settledTo(from, STATES.WITHDRAWN);
        }

        if (s.action === ACTIONS.OFFER) {
            if (from !== STATES.INVITED) return refuse(REASONS.OVER);
            if (s.actorId !== trade.counterpartyId) {
                return refuse(REASONS.NOT_YOURS);
            }

            const offered = s.offered || [];
            if (offered.some(a => datePassed(a, s.today))) {
                return refuse(REASONS.DATE_PASSED);
            }

            // ⚠ THE EMPTY REPLY SETTLES. They were asked; saying "yes, I'll just
            // take it" is the agreement, not a proposal awaiting one.
            if (!offered.length) {
                return {
                    ok: true, from: from, to: STATES.SETTLED,
                    origin: trade.origin, settles: true,
                    offered: [], chosen: null,
                };
            }

            return {
                ok: true, from: from, to: STATES.OFFERED,
                origin: trade.origin, settles: false,
                offered: offered, chosen: null,
            };
        }

        if (s.action === ACTIONS.ACCEPT) {
            if (from !== STATES.OFFERED) return refuse(REASONS.NOT_OFFERED);
            if (s.actorId !== trade.holderId) return refuse(REASONS.NOT_YOURS);

            const chosen = (trade.offered || [])
                .find(a => sameAssignment(a, s.chosen));
            if (!chosen) return refuse(REASONS.NOT_OFFERED);
            if (datePassed(chosen, s.today)) return refuse(REASONS.DATE_PASSED);

            return {
                ok: true, from: from, to: STATES.SETTLED,
                origin: trade.origin, settles: true,
                offered: trade.offered || [], chosen: chosen,
            };
        }

        if (s.action === ACTIONS.REFUSE) {
            // Refusing is answering, so it belongs to whoever is being asked:
            // the invited person before an offer exists, the holder after one.
            const answerer = from === STATES.INVITED
                ? trade.counterpartyId : trade.holderId;
            if (s.actorId !== answerer) return refuse(REASONS.NOT_YOURS);
            return settledTo(from, STATES.REFUSED);
        }

        return refuse(REASONS.UNKNOWN_ACTION);
    }

    // ── Arbitration ──────────────────────────────────────────────────────────
    //
    // ⚠ THE SETTLEMENT IS THE ONLY ARBITER. Nothing was reserved while the offer
    // sat there, so between Sarah offering and Bob accepting an editor may have
    // refilled the place, Bob may have changed his mind, or Sarah may have
    // handed the same Saturday to somebody else. One transaction re-reads all of
    // it and asks this.
    //
    // ⚠ AND THIS IS A PURE FUNCTION OF WHAT IT WAS SHOWN. That is the whole
    // reason it is here rather than inline in the callable: two people accepting
    // in the same second is the hardest case in the Feature, and as a function
    // of a snapshot it is a table of unit tests rather than an orchestrated race.
    //
    //   trade    — the Trade being settled
    //   chosen   — the offered Assignment being taken, or null for a take
    //   read     — what the transaction found: assignmentKey → {personId, state},
    //              or null where the Assignment is no longer on the Event
    //   siblings — every other Trade that might touch either Assignment
    //   today    — YYYY-MM-DD in the church's timezone
    //
    // Returns { ok, reason, moves, dying, telling }.
    function arbitrate(spec) {
        const s = spec || {};
        const trade = s.trade || {};
        const read = s.read || {};
        const nothing = { moves: [], dying: [], telling: [] };
        const no = reason => Object.assign({ ok: false, reason: reason }, nothing);

        if (ENDED.indexOf(trade.state) !== -1) return no(REASONS.OVER);
        if (datePassed(trade.assignment, s.today)) {
            return no(REASONS.DATE_PASSED);
        }

        // The Assignment being covered must still be the holder's, and must
        // still be going spare. Those are two different failures and a reader
        // deserves to be told which — "Bob took it back" and "an editor filled
        // it" want different things from you next.
        const covered = read[assignmentKey(trade.assignment)];
        if (!covered || covered.personId !== trade.holderId) {
            return no(REASONS.COVERED_MOVED);
        }
        if (covered.state !== DECLINED) return no(REASONS.COVERED_TAKEN);

        const moves = [{
            assignment: trade.assignment,
            from: trade.holderId,
            to: trade.counterpartyId,
        }];

        // A take — somebody invited who asked nothing back. Only one Assignment
        // travels, so there is no second side to check.
        if (s.chosen) {
            const offered = (trade.offered || [])
                .find(a => sameAssignment(a, s.chosen));
            if (!offered) return no(REASONS.NOT_OFFERED);
            if (datePassed(offered, s.today)) return no(REASONS.DATE_PASSED);

            const back = read[assignmentKey(offered)];
            if (!back || back.personId !== trade.counterpartyId) {
                return no(REASONS.OFFERED_MOVED);
            }

            moves.push({
                assignment: offered,
                from: trade.counterpartyId,
                to: trade.holderId,
            });
        }

        // Everything else still live that names either Assignment — on its own
        // account or in what it has put up — ends here. Settling cleans up
        // LOUDLY: an offer that simply stops being answered teaches somebody not
        // to make the next one.
        const touched = moves.map(m => assignmentKey(m.assignment));
        const dying = (s.siblings || []).filter(other =>
            other && other.id !== trade.id &&
            isLive(other, s.today) &&
            namesOneOf(other, touched));

        // The two settling get the settlement itself; a death notice on top
        // would be telling them their own news back.
        const parties = [trade.holderId, trade.counterpartyId];
        const telling = [];
        dying.forEach(other => {
            [other.holderId, other.counterpartyId].forEach(personId => {
                if (!personId) return;
                if (parties.indexOf(personId) !== -1) return;
                if (telling.indexOf(personId) === -1) telling.push(personId);
            });
        });

        return { ok: true, reason: null, moves, dying, telling };
    }

    function namesOneOf(trade, keys) {
        const mine = [trade.assignment]
            .concat(trade.offered || [])
            .map(assignmentKey);
        return mine.some(k => keys.indexOf(k) !== -1);
    }

    const settledTo = (from, to) => ({
        ok: true, from: from, to: to, settles: false,
        offered: [], chosen: null,
    });

    const TradeCore = {
        STATES,
        ORIGINS,
        ACTIONS,
        REASONS,
        MAX_INVITATIONS,
        assignmentKey,
        sameAssignment,
        isDead,
        isLive,
        liveOnes,
        waitingOn,
        liveInvitationCount,
        arbitrate,
        planTransition,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = TradeCore;
    } else {
        global.TradeCore = TradeCore;
    }
}(typeof window !== 'undefined' ? window : globalThis));
