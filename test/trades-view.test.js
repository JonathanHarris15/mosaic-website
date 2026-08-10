const { test } = require('node:test');
const assert = require('node:assert');

const View = require('../public/trades-view.js');
const Core = require('../public/trade-core.js');

// One Trade, from each end (MS-190, MS-214, MS-216).
//
// ⚠ THE SAME DOCUMENT READS DIFFERENTLY DEPENDING ON WHERE YOU STAND, and that
// is the whole difficulty of the Commitments page. "You asked Sarah" and "Bob
// asked you" are one Trade in one state. Every row is therefore built FOR
// somebody, and the first thing it works out is whether the next move is theirs.

const TODAY = '2026-03-01';
const BOB = 'person-bob';
const SARAH = 'person-sarah';

const KIDS = { occurrenceId: 'occ-14', roleSlug: 'kids', slotId: 's1', date: '2026-03-14' };
const COFFEE = { occurrenceId: 'occ-28', roleSlug: 'coffee', slotId: 's1', date: '2026-03-28' };
const LAST_YEAR = { occurrenceId: 'occ-old', roleSlug: 'kids', slotId: 's1', date: '2025-12-07' };

const NAMES = { [BOB]: 'Bob', [SARAH]: 'Sarah' };
const nameOf = id => NAMES[id] || id;

const trade = over => Object.assign({
    id: 't1',
    origin: Core.ORIGINS.INVITATION,
    state: Core.STATES.INVITED,
    assignment: KIDS,
    roleName: 'Kids Ministry',
    eventName: 'Morning Service',
    holderId: BOB,
    counterpartyId: SARAH,
    offered: [],
    chosen: null,
}, over || {});

const rowFor = (t, personId) =>
    View.rowFor(t, { personId, today: TODAY, nameOf });

// ── Whose move is it ────────────────────────────────────────────────────────

test('an invitation waits on the person invited, from both sides', () => {
    const t = trade();

    assert.equal(rowFor(t, BOB).waitingOnThem, true);
    assert.equal(rowFor(t, BOB).waitingOnYou, false);
    assert.equal(rowFor(t, SARAH).waitingOnYou, true);
});

test('an offer waits on the holder, from both sides', () => {
    const t = trade({ state: Core.STATES.OFFERED, offered: [COFFEE] });

    assert.equal(rowFor(t, BOB).waitingOnYou, true);
    assert.equal(rowFor(t, SARAH).waitingOnThem, true);
});

test('one that has ended is waiting on nobody', () => {
    const t = trade({ state: Core.STATES.SETTLED });

    const row = rowFor(t, BOB);
    assert.equal(row.over, true);
    assert.equal(row.waitingOnYou, false);
    assert.equal(row.waitingOnThem, false);
});

// ── How it reads ────────────────────────────────────────────────────────────

test('the same invitation says two different things', () => {
    const t = trade();

    assert.equal(rowFor(t, BOB).headline, 'You asked Sarah');
    assert.equal(rowFor(t, SARAH).headline, 'Bob asked you');
});

test('an invitation tells the invited person both ways out', () => {
    // Offering something back and simply taking it are both normal answers.
    // Somebody who only wants to help should not have to work out that leaving
    // the picker empty is how you do it.
    const detail = rowFor(trade(), SARAH).detail;

    assert.match(detail, /offer one of your own/i);
    assert.match(detail, /simply take it/i);
});

test('an offer of one date and an offer of several read differently', () => {
    const one = trade({ state: Core.STATES.OFFERED, offered: [COFFEE] });
    const many = trade({
        state: Core.STATES.OFFERED, offered: [COFFEE, LAST_YEAR, KIDS],
    });

    assert.match(rowFor(one, BOB).detail, /if you take theirs/);
    assert.match(rowFor(many, BOB).detail, /one of these 3/);
});

test('a settled one says who ended up with the place', () => {
    const t = trade({ state: Core.STATES.SETTLED });

    assert.match(rowFor(t, BOB).detail, /Sarah has Kids Ministry now/);
    assert.match(rowFor(t, SARAH).detail, /You have Kids Ministry now/);
});

test('one killed by somebody else’s settlement says so, rather than vanishing',
    () => {
        // ⚠ Silence is what makes people stop using a system like this. An
        // offer that simply stops being answered teaches them not to make the
        // next one.
        const t = trade({
            state: Core.STATES.WITHDRAWN, closedBecause: 'settled',
        });

        const row = rowFor(t, SARAH);
        assert.equal(row.headline, 'Sorted another way');
        assert.match(row.detail, /found somebody else/);
    });

test('a refusal says plainly that nothing moved', () => {
    const t = trade({ state: Core.STATES.REFUSED });

    assert.match(rowFor(t, BOB).headline, /Sarah said no/);
    assert.match(rowFor(t, BOB).detail, /still yours/);
    assert.match(rowFor(t, SARAH).detail, /still theirs/);
});

// ── What you may do ─────────────────────────────────────────────────────────

test('the invited person may reply or refuse; the sender may only take it back',
    () => {
        const t = trade();

        assert.deepEqual(rowFor(t, SARAH).can,
            { offer: true, refuse: true, accept: false, withdraw: false });
        assert.deepEqual(rowFor(t, BOB).can,
            { offer: false, refuse: false, accept: false, withdraw: true });
    });

test('facing an offer, the holder accepts or refuses and the offerer waits',
    () => {
        const t = trade({ state: Core.STATES.OFFERED, offered: [COFFEE] });

        assert.deepEqual(rowFor(t, BOB).can,
            { offer: false, refuse: true, accept: true, withdraw: false });
        assert.deepEqual(rowFor(t, SARAH).can,
            { offer: false, refuse: false, accept: false, withdraw: false });
    });

test('an uninvited offer is the offerer’s to take back', () => {
    const t = trade({
        origin: Core.ORIGINS.OFFER, state: Core.STATES.OFFERED,
        offered: [COFFEE],
    });

    assert.equal(rowFor(t, SARAH).can.withdraw, true,
        'she opened it, so it is hers to take back');
    assert.equal(rowFor(t, BOB).can.withdraw, false);
});

test('nothing at all may be done to one that has ended', () => {
    [Core.STATES.SETTLED, Core.STATES.REFUSED, Core.STATES.WITHDRAWN]
        .forEach(state => {
            const can = rowFor(trade({ state }), BOB).can;
            assert.deepEqual(Object.values(can), [false, false, false, false],
                state);
        });
});

// ── The whole pile ──────────────────────────────────────────────────────────

test('the split is by whose move it is, not by who started it', () => {
    const pile = [
        trade({ id: 'asked-them' }),
        trade({ id: 'they-asked-me', holderId: SARAH, counterpartyId: BOB }),
        trade({
            id: 'they-offered', state: Core.STATES.OFFERED, offered: [COFFEE],
        }),
    ];

    const rows = View.rowsFor(pile, { personId: BOB, today: TODAY, nameOf });

    // Bob began one of these and not the other, and both need him today.
    assert.deepEqual(rows.yours.map(r => r.id).sort(),
        ['they-asked-me', 'they-offered']);
    assert.deepEqual(rows.theirs.map(r => r.id), ['asked-them']);
});

test('one whose date has passed is in no list at all', () => {
    const rows = View.rowsFor([trade({ assignment: LAST_YEAR })],
        { personId: BOB, today: TODAY, nameOf });

    assert.deepEqual(rows.all, []);
});

// ⚠ AN ENDED ONE COUNTS TOO (MS-212). This test used to assert 1 here, on the
// reading that a notification is for things wanting an answer. That was half of
// MS-215's criterion — "a waiting invitation OR AN ENDED OFFER" — and the half
// it dropped is the one that matters more: somebody who is never told their
// offer died concludes the app ate it.
test('the notification counts what needs you and what ended without you', () => {
    const pile = [
        trade({ id: 'a', holderId: SARAH, counterpartyId: BOB }),
        trade({ id: 'b' }),
        trade({ id: 'c', state: Core.STATES.SETTLED }),
    ];

    assert.equal(View.needingYou(pile, { personId: BOB, today: TODAY }), 2);

    // And what Bob himself ended does not count — that is his own news.
    const own = [trade({ id: 'c', state: Core.STATES.SETTLED, closedBy: BOB })];
    assert.equal(View.needingYou(own, { personId: BOB, today: TODAY }), 0);
});

// ── Who may be asked ────────────────────────────────────────────────────────

const PEOPLE = [
    // One `name` field — a Person has no firstName/lastName pair.
    { id: 'p1', name: 'Ann' },
    // ⚠ Inactive lives under `membership`, not on the Person. Getting that
    // wrong here would have made this test pass against code that filtered
    // nobody at all.
    { id: 'p2', name: 'Ben', membership: { inactive: true } },
    { id: 'p3', name: 'Cara', tags: ['tag-hidden'] },
    { id: 'p4', name: 'Dave', shepherdingHidden: true },
    { id: BOB, name: 'Bob' },
];

test('somebody Inactive is absent, not offered and refused', () => {
    const found = View.askableFrom(PEOPLE, {
        rank: 'member', hidingTags: [], personId: BOB,
    });

    assert.equal(found.find(p => p.id === 'p2'), undefined);
});

test('somebody a tag hides is absent — a greyed row still prints the name', () => {
    // ⚠ ADR-0021 §1. A blocked row saying why they cannot help still shows the
    // name the tag exists to hide, which is the tag failing at its one job.
    const found = View.askableFrom(PEOPLE, {
        rank: 'member', hidingTags: ['tag-hidden'], personId: BOB,
    });

    assert.equal(found.find(p => p.id === 'p3'), undefined);
    assert.equal(found.find(p => p.id === 'p4'), undefined);
});

test('you are never in your own picker', () => {
    const found = View.askableFrom(PEOPLE, {
        rank: 'member', hidingTags: [], personId: BOB,
    });

    assert.equal(found.find(p => p.id === BOB), undefined);
});

test('somebody already in a conversation about this place is not offered again',
    () => {
        const asked = View.alreadyAsked([trade({ counterpartyId: 'p1' })],
            KIDS, TODAY);
        const found = View.askableFrom(PEOPLE, {
            rank: 'member', hidingTags: [], personId: BOB, alreadyAsked: asked,
        });

        assert.equal(found.find(p => p.id === 'p1'), undefined,
            'asking twice is noise, and the picker should not offer it');
    });

test('somebody who refused can be offered again', () => {
    // A refusal answers one question. It is not a standing instruction.
    const asked = View.alreadyAsked(
        [trade({ counterpartyId: 'p1', state: Core.STATES.REFUSED })],
        KIDS, TODAY);

    assert.deepEqual(asked, []);
});

test('the picker knows how many more may be asked', () => {
    const live = [
        trade({ id: 'a', counterpartyId: 'p1' }),
        trade({ id: 'b', counterpartyId: 'p2' }),
    ];

    assert.equal(View.invitesLeft(live, KIDS, TODAY), 1);
    assert.equal(View.invitesLeft([], KIDS, TODAY), Core.MAX_INVITATIONS);
});

test('offers crowding in do not use up the three', () => {
    const live = [1, 2, 3, 4].map(n => trade({
        id: 'o' + n, origin: Core.ORIGINS.OFFER,
        state: Core.STATES.OFFERED, counterpartyId: 'p' + n, offered: [COFFEE],
    }));

    assert.equal(View.invitesLeft(live, KIDS, TODAY), Core.MAX_INVITATIONS);
});
