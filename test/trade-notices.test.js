const { test } = require('node:test');
const assert = require('node:assert');

const Core = require('../public/trade-core.js');
const View = require('../public/trades-view.js');

// Being told (MS-190, MS-212).
//
// ⚠ THE FAILURE THIS FILE EXISTS TO CATCH IS SILENCE. Sarah offers Bob two of
// her Saturdays. Somebody else takes Bob's place first, so her offer is killed
// in the same transaction — correctly. If nothing then says so, her offer simply
// VANISHES from her page, and the thing she learns is that the app loses what
// you put into it. She goes back to texting, and so does everybody she tells.
//
// So an ended Trade is not deleted and it is not hidden. It stays on the page,
// in the past tense, saying what happened and why, until the person it happened
// TO has seen it.
//
// ⚠ AND ONLY TO THEM. Telling somebody their own news back is the other half of
// the bug: a person who taps Refuse does not need a notice saying they refused.
// So every ending records WHO caused it (`closedBy`), and that person is not
// told. Where nothing caused it — an editor filling the place, which happens
// outside anybody's conversation — `closedBy` is null and both parties hear.

const TODAY = '2026-03-01';
const BOB = 'person-bob';
const SARAH = 'person-sarah';
const RAY = 'person-ray';

const KIDS = {
    occurrenceId: 'occ-14', roleSlug: 'kids', slotId: 's1', date: '2026-03-14',
};
const LAST_YEAR = {
    occurrenceId: 'occ-old', roleSlug: 'kids', slotId: 's1', date: '2025-12-07',
};

const ended = over => Object.assign({
    id: 't1',
    origin: Core.ORIGINS.OFFER,
    state: Core.STATES.WITHDRAWN,
    assignment: KIDS,
    eventName: 'Morning Service',
    roleName: 'Kids Ministry',
    holderId: BOB,
    counterpartyId: SARAH,
    partyIds: [BOB, SARAH],
    offered: [],
    chosen: null,
    closedBy: null,
    closedBecause: Core.CAUSES.SETTLED,
    seenBy: [],
}, over || {});

// ── Who hears about it ──────────────────────────────────────────────────────

test('a Trade killed by somebody else’s settlement is told to both parties',
    () => {
        // Nobody in this conversation ended it. Ray settled with somebody else
        // entirely, and both Bob and Sarah are finding out.
        const trade = ended();

        assert.equal(Core.needsTelling(trade, BOB, TODAY), true);
        assert.equal(Core.needsTelling(trade, SARAH, TODAY), true);
    });

test('whoever ended it is not told their own news back', () => {
    const trade = ended({
        state: Core.STATES.REFUSED, closedBy: SARAH, closedBecause: null,
    });

    assert.equal(Core.needsTelling(trade, SARAH, TODAY), false,
        'she tapped Refuse — she knows');
    assert.equal(Core.needsTelling(trade, BOB, TODAY), true);
});

test('somebody who was never in it is told nothing', () => {
    assert.equal(Core.needsTelling(ended(), RAY, TODAY), false);
    assert.equal(Core.needsTelling(ended(), null, TODAY), false);
});

test('a Trade still going is not a notice', () => {
    const live = ended({ state: Core.STATES.OFFERED, closedBecause: null });

    assert.equal(Core.needsTelling(live, BOB, TODAY), false,
        'it has not ended — it is a row wanting an answer, not a notice');
});

test('once seen it stops being a notice', () => {
    const trade = ended({ seenBy: [SARAH] });

    assert.equal(Core.needsTelling(trade, SARAH, TODAY), false);
    assert.equal(Core.needsTelling(trade, BOB, TODAY), true,
        'seen is per person — one reader clearing it must not clear the other');
});

// ⚠ THIS IS WHAT MAKES A NOTICE HARMLESS TO KEEP. The date is the only clock in
// this whole feature, and it sweeps notices up for free: nothing has to expire
// them, delete them, or run nightly to tidy them away.
test('a notice about a date that has passed has stopped mattering', () => {
    const trade = ended({ assignment: LAST_YEAR });

    assert.equal(Core.needsTelling(trade, BOB, TODAY), false);
    assert.equal(Core.needsTelling(trade, SARAH, TODAY), false);
});

test('the ones to tell somebody about come back together', () => {
    const trades = [
        ended({ id: 'a' }),
        ended({ id: 'b', state: Core.STATES.REFUSED, closedBy: SARAH }),
        ended({ id: 'c', seenBy: [SARAH] }),
        ended({ id: 'd', state: Core.STATES.INVITED, closedBecause: null }),
        ended({ id: 'e', assignment: LAST_YEAR }),
    ];

    assert.deepEqual(
        Core.noticesFor(trades, SARAH, TODAY).map(t => t.id), ['a']);
});

// ── What it says ────────────────────────────────────────────────────────────

test('a Trade that died because the place settled elsewhere says so', () => {
    const words = View.wordingFor(ended(), SARAH, () => 'Bob');

    assert.match(words.headline, /sorted another way/i);
    assert.match(words.detail, /Kids Ministry/);
});

test('a Trade that died because an editor filled the place says THAT', () => {
    // ⚠ NOT THE SAME SENTENCE. "Sorted another way" is true of a settlement
    // between two members; an editor putting somebody in is a different event
    // with a different lesson — there was nothing you could have done faster.
    const words = View.wordingFor(
        ended({ closedBecause: Core.CAUSES.FILLED }), SARAH, () => 'Bob');

    assert.match(words.headline, /somebody else/i);
    assert.doesNotMatch(words.headline, /sorted another way/i);
});

test('a Trade that died because the holder kept the place says that instead',
    () => {
        const words = View.wordingFor(
            ended({ closedBecause: Core.CAUSES.KEPT }), SARAH, id => id);

        assert.match(words.headline + ' ' + words.detail, /after all/i);
    });

test('a plain withdrawal still reads as a withdrawal', () => {
    const words = View.wordingFor(
        ended({ closedBy: BOB, closedBecause: null }), SARAH, () => 'Bob');

    assert.match(words.headline, /taken back/i);
});

// ── On the page ─────────────────────────────────────────────────────────────

test('an ended Trade is a row, not an absence', () => {
    // ⚠ THE BUG THIS PINS. `rowsFor` used to build from `liveOnes`, which drops
    // every ended Trade — so the past-tense wording above existed, was tested,
    // and could never appear on a screen. Sarah's offer just disappeared.
    const rows = View.rowsFor([ended()], { personId: SARAH, today: TODAY });

    assert.equal(rows.ended.length, 1);
    assert.equal(rows.ended[0].over, true);
    assert.equal(rows.ended[0].can.refuse, false,
        'nothing can be done to it — it is a thing to read and dismiss');
});

test('an ended Trade is not mixed in with the ones still going', () => {
    const live = ended({ id: 'live', state: Core.STATES.INVITED,
        origin: Core.ORIGINS.INVITATION, closedBecause: null });
    const rows = View.rowsFor([live, ended({ id: 'done' })],
        { personId: SARAH, today: TODAY });

    assert.deepEqual(rows.yours.map(r => r.id), ['live']);
    assert.deepEqual(rows.theirs.map(r => r.id), []);
    assert.deepEqual(rows.ended.map(r => r.id), ['done']);
});

test('the person who ended it sees no row for it at all', () => {
    const rows = View.rowsFor(
        [ended({ state: Core.STATES.REFUSED, closedBy: SARAH })],
        { personId: SARAH, today: TODAY });

    assert.deepEqual(rows.ended, []);
    assert.deepEqual(rows.all, []);
});

// ── The dashboard line ──────────────────────────────────────────────────────

test('an ended offer counts on the dashboard, not just a waiting invitation',
    () => {
        // MS-215's criterion, which the first cut missed: "a member with a
        // waiting invitation OR AN ENDED OFFER sees it on the dashboard."
        const count = View.needingYou([ended()], {
            personId: SARAH, today: TODAY,
        });

        assert.equal(count, 1);
    });

test('a notice already seen has stopped counting', () => {
    const count = View.needingYou([ended({ seenBy: [SARAH] })], {
        personId: SARAH, today: TODAY,
    });

    assert.equal(count, 0);
});
