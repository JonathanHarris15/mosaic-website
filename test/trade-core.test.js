const { test } = require('node:test');
const assert = require('node:assert');

const Trade = require('../public/trade-core.js');

// What a Trade is, and what may happen to it (MS-190, MS-208).
//
// A Trade is an offer against an Assignment looking for cover, naming the
// offerer's own Assignments in return. One record, two ways in: an INVITATION
// the holder sends, and an OFFER somebody makes uninvited off the cover list.
// An invitation begins before the offer exists; an unsolicited one begins at the
// offer. Past that they are identical, which is what lets one screen render both.
//
// ⚠ AN EMPTY OFFER IS NOT AN OFFER. Asking nothing in return is a TAKE, and a
// take needs no answer — MS-20's cover list already settles that in one tap. So
// an unsolicited offer must name at least one Assignment, and an invited person
// replying with nothing SETTLES THERE AND THEN rather than creating an
// offer-of-nothing for the holder to accept. That reply still has to exist,
// because a quiet Assignment is not on the cover list and the invitation is the
// only way the invited person can reach it at all.
//
// ⚠ NOTHING IS RESERVED. This module says what is legal from what it is shown.
// Whether the Assignments still stand is arbitration, which is MS-209.

const TODAY = '2026-03-01';

const BOB = 'person-bob';
const SARAH = 'person-sarah';
const RAY = 'person-ray';

const KIDS = { occurrenceId: 'occ-14', roleSlug: 'kids', slotId: 's1', date: '2026-03-14' };
const COFFEE = { occurrenceId: 'occ-28', roleSlug: 'coffee', slotId: 's1', date: '2026-03-28' };
const SOUND = { occurrenceId: 'occ-21', roleSlug: 'sound', slotId: 's2', date: '2026-03-21' };
const LAST_YEAR = { occurrenceId: 'occ-old', roleSlug: 'kids', slotId: 's1', date: '2025-12-07' };

// An invitation Bob has sent Sarah, at whatever point in its life.
const invitation = (over, extra) => Object.assign({
    id: 't1',
    origin: Trade.ORIGINS.INVITATION,
    state: Trade.STATES.INVITED,
    assignment: over || KIDS,
    holderId: BOB,
    counterpartyId: SARAH,
    offered: [],
    chosen: null,
}, extra || {});

// An offer Sarah has made off the cover list, uninvited.
const offer = (over, extra) => Object.assign({
    id: 't2',
    origin: Trade.ORIGINS.OFFER,
    state: Trade.STATES.OFFERED,
    assignment: over || KIDS,
    holderId: BOB,
    counterpartyId: SARAH,
    offered: [COFFEE],
    chosen: null,
}, extra || {});

const plan = spec => Trade.planTransition(Object.assign({ today: TODAY }, spec));

// ── Opening one ─────────────────────────────────────────────────────────────

test('the holder can invite somebody to an Assignment they hold', () => {
    const result = plan({
        action: Trade.ACTIONS.INVITE,
        actorId: BOB,
        assignment: KIDS,
        holderId: BOB,
        counterpartyId: SARAH,
        siblings: [],
    });

    assert.equal(result.ok, true);
    assert.equal(result.to, Trade.STATES.INVITED);
    assert.equal(result.origin, Trade.ORIGINS.INVITATION);
    assert.equal(result.settles, false);
});

test('somebody who is not the holder cannot invite people to it', () => {
    const result = plan({
        action: Trade.ACTIONS.INVITE,
        actorId: RAY,
        assignment: KIDS,
        holderId: BOB,
        counterpartyId: SARAH,
        siblings: [],
    });

    assert.equal(result.ok, false);
    assert.equal(result.reason, Trade.REASONS.NOT_YOURS);
});

test('the holder cannot invite themselves', () => {
    const result = plan({
        action: Trade.ACTIONS.INVITE,
        actorId: BOB, assignment: KIDS, holderId: BOB, counterpartyId: BOB,
        siblings: [],
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, Trade.REASONS.YOURSELF);
});

test('an uninvited offer must name at least one Assignment', () => {
    // The whole reason: asking nothing back IS taking it, and MS-20's cover
    // list settles a take in one tap. An empty offer here would be a second,
    // slower way to do the same thing, and it would leave the holder something
    // to clear by hand.
    const result = plan({
        action: Trade.ACTIONS.OFFER,
        actorId: SARAH,
        assignment: KIDS, holderId: BOB, counterpartyId: SARAH,
        offered: [],
        siblings: [],
    });

    assert.equal(result.ok, false);
    assert.equal(result.reason, Trade.REASONS.NOTHING_OFFERED);
});

test('an uninvited offer naming Assignments opens straight at offered', () => {
    const result = plan({
        action: Trade.ACTIONS.OFFER,
        actorId: SARAH,
        assignment: KIDS, holderId: BOB, counterpartyId: SARAH,
        offered: [COFFEE, SOUND],
        siblings: [],
    });

    assert.equal(result.ok, true);
    assert.equal(result.to, Trade.STATES.OFFERED);
    assert.equal(result.origin, Trade.ORIGINS.OFFER);
    assert.equal(result.settles, false);
});

test('you cannot offer against your own Assignment', () => {
    const result = plan({
        action: Trade.ACTIONS.OFFER,
        actorId: BOB, assignment: KIDS, holderId: BOB, counterpartyId: BOB,
        offered: [COFFEE], siblings: [],
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, Trade.REASONS.YOURSELF);
});

// ── The cap of three ────────────────────────────────────────────────────────

test('a fourth live invitation on one Assignment is refused', () => {
    const live = [
        invitation(KIDS, { id: 'a', counterpartyId: 'p1' }),
        invitation(KIDS, { id: 'b', counterpartyId: 'p2' }),
        // Still occupying a slot: the sender is in that conversation, waiting.
        invitation(KIDS, { id: 'c', counterpartyId: 'p3', state: Trade.STATES.OFFERED }),
    ];

    const result = plan({
        action: Trade.ACTIONS.INVITE,
        actorId: BOB, assignment: KIDS, holderId: BOB, counterpartyId: RAY,
        siblings: live,
    });

    assert.equal(result.ok, false);
    assert.equal(result.reason, Trade.REASONS.CAP_REACHED);
});

test('a refusal or a withdrawal frees a slot at once', () => {
    [Trade.STATES.REFUSED, Trade.STATES.WITHDRAWN].forEach(ended => {
        const siblings = [
            invitation(KIDS, { id: 'a', counterpartyId: 'p1' }),
            invitation(KIDS, { id: 'b', counterpartyId: 'p2' }),
            invitation(KIDS, { id: 'c', counterpartyId: 'p3', state: ended }),
        ];

        const result = plan({
            action: Trade.ACTIONS.INVITE,
            actorId: BOB, assignment: KIDS, holderId: BOB, counterpartyId: RAY,
            siblings: siblings,
        });

        assert.equal(result.ok, true, ended + ' did not free a slot');
    });
});

test('offers arriving uninvited are never capped, however many turn up', () => {
    const crowd = [1, 2, 3, 4, 5, 6].map(n =>
        offer(KIDS, { id: 'o' + n, counterpartyId: 'p' + n }));

    const result = plan({
        action: Trade.ACTIONS.OFFER,
        actorId: RAY, assignment: KIDS, holderId: BOB, counterpartyId: RAY,
        offered: [SOUND],
        siblings: crowd,
    });

    assert.equal(result.ok, true, 'capping volunteers would be daft');
});

test('the cap counts invitations only, not the offers crowding in beside them',
    () => {
        const siblings = [
            invitation(KIDS, { id: 'a', counterpartyId: 'p1' }),
            offer(KIDS, { id: 'o1', counterpartyId: 'p2' }),
            offer(KIDS, { id: 'o2', counterpartyId: 'p3' }),
            offer(KIDS, { id: 'o3', counterpartyId: 'p4' }),
        ];

        const result = plan({
            action: Trade.ACTIONS.INVITE,
            actorId: BOB, assignment: KIDS, holderId: BOB, counterpartyId: RAY,
            siblings: siblings,
        });

        assert.equal(result.ok, true);
    });

test('the same person is not invited to the same Assignment twice', () => {
    const result = plan({
        action: Trade.ACTIONS.INVITE,
        actorId: BOB, assignment: KIDS, holderId: BOB, counterpartyId: SARAH,
        siblings: [invitation(KIDS)],
    });

    assert.equal(result.ok, false);
    assert.equal(result.reason, Trade.REASONS.ALREADY_ASKED);
});

test('somebody who already refused can be asked again', () => {
    // They may have refused in January and be free in March. Refusing is an
    // answer to one question, not a standing instruction.
    const result = plan({
        action: Trade.ACTIONS.INVITE,
        actorId: BOB, assignment: KIDS, holderId: BOB, counterpartyId: SARAH,
        siblings: [invitation(KIDS, { state: Trade.STATES.REFUSED })],
    });

    assert.equal(result.ok, true);
});

// ── Answering an invitation ─────────────────────────────────────────────────

test('the invited person replies with their own Assignments', () => {
    const result = plan({
        trade: invitation(),
        action: Trade.ACTIONS.OFFER,
        actorId: SARAH,
        offered: [COFFEE, SOUND],
    });

    assert.equal(result.ok, true);
    assert.equal(result.from, Trade.STATES.INVITED);
    assert.equal(result.to, Trade.STATES.OFFERED);
    assert.equal(result.settles, false);
    assert.deepEqual(result.offered, [COFFEE, SOUND]);
});

test('an invited person replying with nothing settles it there and then', () => {
    // ⚠ THE CORRECTION. They are not offering nothing and waiting to be
    // accepted — the holder already asked, so the answer IS the agreement. Any
    // other reading invents a state the holder has to clear by hand, for a
    // conversation that is already over.
    const result = plan({
        trade: invitation(),
        action: Trade.ACTIONS.OFFER,
        actorId: SARAH,
        offered: [],
    });

    assert.equal(result.ok, true);
    assert.equal(result.to, Trade.STATES.SETTLED);
    assert.equal(result.settles, true);
    assert.equal(result.chosen, null,
        'nothing comes back the other way — this is a take, not a swap');
});

test('the invited person can refuse outright', () => {
    const result = plan({
        trade: invitation(),
        action: Trade.ACTIONS.REFUSE,
        actorId: SARAH,
    });

    assert.equal(result.ok, true);
    assert.equal(result.to, Trade.STATES.REFUSED);
    assert.equal(result.settles, false);
});

test('nobody else can answer an invitation that was not sent to them', () => {
    [Trade.ACTIONS.OFFER, Trade.ACTIONS.REFUSE].forEach(action => {
        const result = plan({
            trade: invitation(), action: action, actorId: RAY, offered: [COFFEE],
        });
        assert.equal(result.ok, false, action);
        assert.equal(result.reason, Trade.REASONS.NOT_YOURS);
    });
});

test('the holder cannot answer their own invitation on the other’s behalf',
    () => {
        const result = plan({
            trade: invitation(),
            action: Trade.ACTIONS.OFFER, actorId: BOB, offered: [COFFEE],
        });
        assert.equal(result.ok, false);
        assert.equal(result.reason, Trade.REASONS.NOT_YOURS);
    });

// ── Withdrawing ─────────────────────────────────────────────────────────────

test('whoever opened it can withdraw it while it is still live', () => {
    // The holder pulls an invitation they sent; the offerer pulls an offer they
    // made. Each takes back their own words and nobody else's.
    const cases = [
        [invitation(), BOB],
        [invitation(null, { state: Trade.STATES.OFFERED, offered: [COFFEE] }), BOB],
        [offer(), SARAH],
    ];

    cases.forEach(([trade, opener]) => {
        const result = plan({
            trade: trade, action: Trade.ACTIONS.WITHDRAW, actorId: opener,
        });
        assert.equal(result.ok, true, trade.origin + '/' + trade.state);
        assert.equal(result.to, Trade.STATES.WITHDRAWN);
    });
});

test('the other party cannot withdraw somebody else’s words', () => {
    [[invitation(), SARAH], [offer(), BOB]].forEach(([trade, other]) => {
        const result = plan({
            trade: trade, action: Trade.ACTIONS.WITHDRAW, actorId: other,
        });
        assert.equal(result.ok, false, trade.origin);
        assert.equal(result.reason, Trade.REASONS.NOT_YOURS);
    });
});

// ── Answering an offer ──────────────────────────────────────────────────────

test('the holder accepts exactly one of the Assignments offered', () => {
    const result = plan({
        trade: offer(null, { offered: [COFFEE, SOUND] }),
        action: Trade.ACTIONS.ACCEPT,
        actorId: BOB,
        chosen: SOUND,
    });

    assert.equal(result.ok, true);
    assert.equal(result.to, Trade.STATES.SETTLED);
    assert.equal(result.settles, true);
    assert.deepEqual(result.chosen, SOUND);
});

test('the holder cannot accept something that was never offered', () => {
    const result = plan({
        trade: offer(null, { offered: [COFFEE] }),
        action: Trade.ACTIONS.ACCEPT, actorId: BOB, chosen: SOUND,
    });

    assert.equal(result.ok, false);
    assert.equal(result.reason, Trade.REASONS.NOT_OFFERED);
});

test('the holder can refuse the whole offer', () => {
    const result = plan({
        trade: offer(), action: Trade.ACTIONS.REFUSE, actorId: BOB,
    });

    assert.equal(result.ok, true);
    assert.equal(result.to, Trade.STATES.REFUSED);
});

test('the person who made the offer cannot accept their own', () => {
    const result = plan({
        trade: offer(), action: Trade.ACTIONS.ACCEPT, actorId: SARAH,
        chosen: COFFEE,
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, Trade.REASONS.NOT_YOURS);
});

test('there is nothing to accept before an offer has been made', () => {
    const result = plan({
        trade: invitation(), action: Trade.ACTIONS.ACCEPT, actorId: BOB,
        chosen: COFFEE,
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, Trade.REASONS.NOT_OFFERED);
});

// ── Terminal is terminal ────────────────────────────────────────────────────

test('nothing at all may happen to one that has ended', () => {
    const ended = [
        Trade.STATES.SETTLED, Trade.STATES.REFUSED, Trade.STATES.WITHDRAWN,
    ];
    const actions = [
        [Trade.ACTIONS.OFFER, SARAH], [Trade.ACTIONS.REFUSE, SARAH],
        [Trade.ACTIONS.ACCEPT, BOB], [Trade.ACTIONS.WITHDRAW, BOB],
    ];

    ended.forEach(state => {
        actions.forEach(([action, actorId]) => {
            const result = plan({
                trade: invitation(null, { state: state, offered: [COFFEE] }),
                action: action, actorId: actorId,
                offered: [COFFEE], chosen: COFFEE,
            });
            assert.equal(result.ok, false, state + ' + ' + action);
            assert.equal(result.reason, Trade.REASONS.OVER, state + ' + ' + action);
        });
    });
});

test('an unrecognised action is refused rather than ignored', () => {
    const result = plan({
        trade: invitation(), action: 'haggle', actorId: SARAH,
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, Trade.REASONS.UNKNOWN_ACTION);
});

// ── The date is the only clock ──────────────────────────────────────────────

test('a Trade on a date that has passed is dead, with nothing having run', () => {
    const old = invitation(LAST_YEAR);

    assert.equal(Trade.isDead(old, TODAY), true);
    assert.equal(Trade.isLive(old, TODAY), false);
});

test('today is not past — the day itself has not happened yet', () => {
    const todayTrade = invitation(
        Object.assign({}, KIDS, { date: TODAY }));

    assert.equal(Trade.isDead(todayTrade, TODAY), false);
    assert.equal(Trade.isLive(todayTrade, TODAY), true);
});

test('a dead Trade refuses every action', () => {
    const result = plan({
        trade: invitation(LAST_YEAR), action: Trade.ACTIONS.OFFER,
        actorId: SARAH, offered: [COFFEE],
    });

    assert.equal(result.ok, false);
    assert.equal(result.reason, Trade.REASONS.DATE_PASSED);
});

test('nobody may open one on a date that has passed', () => {
    const result = plan({
        action: Trade.ACTIONS.INVITE,
        actorId: BOB, assignment: LAST_YEAR, holderId: BOB,
        counterpartyId: SARAH, siblings: [],
    });

    assert.equal(result.ok, false);
    assert.equal(result.reason, Trade.REASONS.DATE_PASSED);
});

test('an Assignment offered on a date that has passed cannot be offered', () => {
    const result = plan({
        trade: invitation(),
        action: Trade.ACTIONS.OFFER, actorId: SARAH, offered: [LAST_YEAR],
    });

    assert.equal(result.ok, false);
    assert.equal(result.reason, Trade.REASONS.DATE_PASSED);
});

test('a settled Trade is dead too, whatever its date says', () => {
    // Deadness is "nothing more can happen here", which the state can say on
    // its own. The cleanup in MS-212 reads this to know what it may skip.
    assert.equal(
        Trade.isDead(invitation(KIDS, { state: Trade.STATES.SETTLED }), TODAY),
        true);
});

// ── What it takes to render a list ──────────────────────────────────────────

test('a live Trade knows whose move it is', () => {
    assert.equal(Trade.waitingOn(invitation()), SARAH,
        'an invitation waits on the person invited');
    assert.equal(Trade.waitingOn(offer()), BOB,
        'an offer waits on the holder to answer it');
    assert.equal(Trade.waitingOn(invitation(KIDS, { state: Trade.STATES.SETTLED })),
        null, 'nothing that has ended is waiting on anybody');
});

test('the live ones can be picked out of a person’s whole pile', () => {
    const pile = [
        invitation(KIDS, { id: 'a' }),
        invitation(KIDS, { id: 'b', state: Trade.STATES.REFUSED }),
        invitation(LAST_YEAR, { id: 'c' }),
        offer(KIDS, { id: 'd' }),
    ];

    assert.deepEqual(Trade.liveOnes(pile, TODAY).map(t => t.id), ['a', 'd']);
});
