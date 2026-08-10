const { test } = require('node:test');
const assert = require('node:assert');

const Trade = require('../public/trade-core.js');

// Does this settlement still stand? (MS-190, MS-209)
//
// ⚠ NOTHING IS RESERVED WHILE AN OFFER SITS. No locks, no holds, no greying
// out. An Assignment held hostage by an offer somebody forgot about is one
// nobody can fill, which is worse than the race a lock would prevent. So the
// settlement is the only arbiter: one transaction re-reads every Assignment
// involved and asks this.
//
// ⚠ AND THE ASKING IS A PURE FUNCTION OF WHAT WAS READ. That is the whole point
// of this sub-task. Two people accepting the same Assignment in the same second
// is the hardest case in the Feature, and extracting the judgement turns it into
// a table rather than an orchestrated race against an emulator.

const TODAY = '2026-03-01';

const BOB = 'person-bob';
const SARAH = 'person-sarah';
const RAY = 'person-ray';
const JEN = 'person-jen';

const KIDS = { occurrenceId: 'occ-14', roleSlug: 'kids', slotId: 's1', date: '2026-03-14' };
const COFFEE = { occurrenceId: 'occ-28', roleSlug: 'coffee', slotId: 's1', date: '2026-03-28' };
const SOUND = { occurrenceId: 'occ-21', roleSlug: 'sound', slotId: 's2', date: '2026-03-21' };
const WELCOME = { occurrenceId: 'occ-07', roleSlug: 'welcome', slotId: 's1', date: '2026-03-07' };

const key = Trade.assignmentKey;

// Sarah has offered Bob her Coffee for his Kids. Bob is about to accept.
const settling = extra => Object.assign({
    id: 't1',
    origin: Trade.ORIGINS.OFFER,
    state: Trade.STATES.OFFERED,
    assignment: KIDS,
    holderId: BOB,
    counterpartyId: SARAH,
    offered: [COFFEE],
    chosen: null,
}, extra || {});

// What the transaction found when it looked. The world as it actually is, not
// as the offer remembers it.
const asRead = over => Object.assign({
    [key(KIDS)]: { personId: BOB, state: 'declined' },
    [key(COFFEE)]: { personId: SARAH, state: 'confirmed' },
    [key(SOUND)]: { personId: SARAH, state: 'confirmed' },
    [key(WELCOME)]: { personId: RAY, state: 'declined' },
}, over || {});

const judge = spec => Trade.arbitrate(Object.assign({
    today: TODAY,
    trade: settling(),
    chosen: COFFEE,
    read: asRead(),
    siblings: [],
}, spec));

// ── It still stands ─────────────────────────────────────────────────────────

test('a settlement nothing has disturbed stands', () => {
    const result = judge({});

    assert.equal(result.ok, true);
    assert.equal(result.reason, null);
});

test('it says which way each Assignment travels', () => {
    const result = judge({});

    // Both arrive Confirmed. Nobody is asked to agree to something they just
    // negotiated for.
    assert.deepEqual(result.moves, [
        { assignment: KIDS, from: BOB, to: SARAH },
        { assignment: COFFEE, from: SARAH, to: BOB },
    ]);
});

test('a take — an invited person who asked nothing back — moves one way only',
    () => {
        const result = judge({
            trade: settling({
                origin: Trade.ORIGINS.INVITATION, offered: [],
            }),
            chosen: null,
        });

        assert.equal(result.ok, true);
        assert.deepEqual(result.moves, [{ assignment: KIDS, from: BOB, to: SARAH }]);
    });

// ── It does not ─────────────────────────────────────────────────────────────

test('an Assignment an editor has since reassigned kills the settlement', () => {
    const result = judge({
        read: asRead({ [key(KIDS)]: { personId: JEN, state: 'confirmed' } }),
    });

    assert.equal(result.ok, false);
    assert.equal(result.reason, Trade.REASONS.COVERED_MOVED);
});

test('an Assignment its holder has taken back is no longer going spare', () => {
    // Bob changed his mind and confirmed it again. It is still his, so nothing
    // moved — but it is not looking for cover either, and handing it over would
    // take a place off somebody who wants it.
    const result = judge({
        read: asRead({ [key(KIDS)]: { personId: BOB, state: 'confirmed' } }),
    });

    assert.equal(result.ok, false);
    assert.equal(result.reason, Trade.REASONS.COVERED_TAKEN);
});

test('an Assignment that has gone from the Event entirely kills it', () => {
    const result = judge({ read: asRead({ [key(KIDS)]: null }) });

    assert.equal(result.ok, false);
    assert.equal(result.reason, Trade.REASONS.COVERED_MOVED);
});

test('an offer whose Assignment the counterparty no longer holds is refused',
    () => {
        // Sarah offered Coffee here and elsewhere, and the other one settled
        // first. She cannot give away what she has already given away.
        const result = judge({
            read: asRead({ [key(COFFEE)]: { personId: JEN, state: 'confirmed' } }),
        });

        assert.equal(result.ok, false);
        assert.equal(result.reason, Trade.REASONS.OFFERED_MOVED);
    });

test('an offer whose Assignment has gone from the Event is refused', () => {
    const result = judge({ read: asRead({ [key(COFFEE)]: null }) });

    assert.equal(result.ok, false);
    assert.equal(result.reason, Trade.REASONS.OFFERED_MOVED);
});

test('a chosen Assignment that was never in the offer is refused', () => {
    const result = judge({ chosen: WELCOME });

    assert.equal(result.ok, false);
    assert.equal(result.reason, Trade.REASONS.NOT_OFFERED);
});

test('a Trade another acceptance already settled is refused', () => {
    const result = judge({ trade: settling({ state: Trade.STATES.SETTLED }) });

    assert.equal(result.ok, false);
    assert.equal(result.reason, Trade.REASONS.OVER);
});

test('a date that passed between the offer and the acceptance kills it', () => {
    const result = judge({ today: '2026-03-20' });

    assert.equal(result.ok, false);
    assert.equal(result.reason, Trade.REASONS.DATE_PASSED);
});

// ── Two people accepting at once ────────────────────────────────────────────

test('two acceptances against the same Assignment: exactly one stands', () => {
    // Sarah offered her Coffee to Bob AND to Ray. Both say yes. Whichever
    // transaction commits first wins; the second re-reads and finds Coffee is
    // not Sarah's any more.
    const first = judge({});
    assert.equal(first.ok, true);

    const rayWanted = settling({
        id: 't2', assignment: WELCOME, holderId: RAY, counterpartyId: SARAH,
        offered: [COFFEE],
    });
    const second = Trade.arbitrate({
        today: TODAY,
        trade: rayWanted,
        chosen: COFFEE,
        // The world AFTER the first settled.
        read: asRead({ [key(COFFEE)]: { personId: BOB, state: 'confirmed' } }),
        siblings: [],
    });

    assert.equal(second.ok, false);
    assert.equal(second.reason, Trade.REASONS.OFFERED_MOVED,
        'both takers were told they got the same Saturday');
});

// ── What dies with it ───────────────────────────────────────────────────────
//
// Settling cleans up LOUDLY. Silence is what makes people stop using a system
// like this: an offer that simply never gets answered teaches them not to make
// the next one.

test('every other live Trade touching either Assignment dies', () => {
    const others = [
        // Bob's other invitations on the same Assignment.
        { id: 'a', state: Trade.STATES.INVITED, origin: Trade.ORIGINS.INVITATION,
            assignment: KIDS, holderId: BOB, counterpartyId: RAY, offered: [] },
        // A competing offer somebody else made for the same Assignment.
        { id: 'b', state: Trade.STATES.OFFERED, origin: Trade.ORIGINS.OFFER,
            assignment: KIDS, holderId: BOB, counterpartyId: JEN, offered: [SOUND] },
        // Sarah's parallel offer of the very Coffee she has just handed over.
        { id: 'c', state: Trade.STATES.OFFERED, origin: Trade.ORIGINS.OFFER,
            assignment: WELCOME, holderId: RAY, counterpartyId: SARAH,
            offered: [COFFEE] },
    ];

    const result = judge({ siblings: others });

    assert.equal(result.ok, true);
    assert.deepEqual(result.dying.map(t => t.id).sort(), ['a', 'b', 'c']);
});

test('a Trade touching neither Assignment is left alone', () => {
    const elsewhere = {
        id: 'z', state: Trade.STATES.OFFERED, origin: Trade.ORIGINS.OFFER,
        assignment: WELCOME, holderId: RAY, counterpartyId: JEN,
        offered: [SOUND],
    };

    const result = judge({ siblings: [elsewhere] });

    assert.deepEqual(result.dying, [],
        'somebody else’s negotiation was ended for them');
});

test('the Trade being settled is not in its own list of the dead', () => {
    const self = settling();
    const result = judge({ trade: self, siblings: [self] });

    assert.deepEqual(result.dying.map(t => t.id), []);
});

test('one that has already ended is not killed twice', () => {
    const done = [
        { id: 'a', state: Trade.STATES.REFUSED, origin: Trade.ORIGINS.INVITATION,
            assignment: KIDS, holderId: BOB, counterpartyId: RAY, offered: [] },
        { id: 'b', state: Trade.STATES.WITHDRAWN, origin: Trade.ORIGINS.OFFER,
            assignment: KIDS, holderId: BOB, counterpartyId: JEN, offered: [] },
    ];

    assert.deepEqual(judge({ siblings: done }).dying, []);
});

test('everybody who loses something is told, and the two settling are not',
    () => {
        const others = [
            { id: 'a', state: Trade.STATES.INVITED, origin: Trade.ORIGINS.INVITATION,
                assignment: KIDS, holderId: BOB, counterpartyId: RAY, offered: [] },
            { id: 'c', state: Trade.STATES.OFFERED, origin: Trade.ORIGINS.OFFER,
                assignment: WELCOME, holderId: RAY, counterpartyId: SARAH,
                offered: [COFFEE] },
            { id: 'd', state: Trade.STATES.OFFERED, origin: Trade.ORIGINS.OFFER,
                assignment: KIDS, holderId: BOB, counterpartyId: JEN, offered: [SOUND] },
        ];

        const result = judge({ siblings: others });

        // Bob and Sarah get the settlement itself; a death notice on top would
        // be telling them their own news back.
        assert.deepEqual(result.telling.sort(), [JEN, RAY].sort());
    });

test('nothing dies and nobody is told when the settlement did not stand', () => {
    const others = [
        { id: 'a', state: Trade.STATES.INVITED, origin: Trade.ORIGINS.INVITATION,
            assignment: KIDS, holderId: BOB, counterpartyId: RAY, offered: [] },
    ];

    const result = judge({
        siblings: others,
        read: asRead({ [key(KIDS)]: { personId: JEN, state: 'confirmed' } }),
    });

    assert.equal(result.ok, false);
    assert.deepEqual(result.dying, []);
    assert.deepEqual(result.telling, []);
});

test('an offered Assignment its owner has since declined is refused', () => {
    // Sarah put her Coffee up and then declined it herself. It is still hers,
    // so nothing has moved — but handing Bob a place already looking for cover
    // gives him back the very thing he was trying to get rid of.
    const result = judge({
        read: asRead({ [key(COFFEE)]: { personId: SARAH, state: 'declined' } }),
    });

    assert.equal(result.ok, false);
    assert.equal(result.reason, Trade.REASONS.OFFERED_DECLINED);
});
