// Moving people around a draft (MS-180).
//
// The move that matters is the one onto an OCCUPIED place, because that is the
// common case and because the person already there must not simply vanish.

const test = require('node:test');
const assert = require('node:assert');

const Edit = require('../public/auto-assign-edit-core.js');

const seat = (roleSlug, slotId, personId, extra) => Object.assign({
    roleSlug: roleSlug, slotId: slotId, personId: personId,
}, extra || {});

function draftOf(seatsByDate) {
    return {
        dates: Object.keys(seatsByDate).map(date => ({
            date: date, skipped: false, seats: seatsByDate[date], gaps: [],
        })),
    };
}

const seatsOn = (draft, date) => draft.dates.filter(d => d.date === date)[0].seats;
const at = (draft, date, roleSlug, slotId) =>
    seatsOn(draft, date).filter(s => s.roleSlug === roleSlug && s.slotId === slotId)[0] || null;

// ── Into an empty place ─────────────────────────────────────────────────────

test('somebody dropped on an empty place lands in it, displacing nobody', () => {
    const draft = draftOf({ '2026-10-04': [] });

    const out = Edit.place(draft, {
        personId: 'p1', to: { date: '2026-10-04', roleSlug: 'coffee', slotId: 's1' },
    });

    assert.equal(at(out.draft, '2026-10-04', 'coffee', 's1').personId, 'p1');
    assert.equal(out.displaced, null);
});

test('a hand-placed seat is not held, and carries no answer from the person in it', () => {
    const draft = draftOf({ '2026-10-04': [] });

    const out = Edit.place(draft, {
        personId: 'p1', to: { date: '2026-10-04', roleSlug: 'coffee', slotId: 's1' },
    });

    const made = at(out.draft, '2026-10-04', 'coffee', 's1');
    assert.equal(made.held, false, 'it was not on the calendar when we started');
    assert.equal(made.state, null, 'nobody has said yes to a job made ten seconds ago');
});

// ── Onto an occupied place ──────────────────────────────────────────────────

// ⚠ The person already there is the whole reason this module exists. Deleting
// them quietly is the failure: they were on the rota a second ago, and the
// editor would have to reconstruct from memory who they just lost.
test('the person already in the place is displaced, not deleted', () => {
    const draft = draftOf({ '2026-10-04': [seat('coffee', 's1', 'p2')] });

    const out = Edit.place(draft, {
        personId: 'p1', to: { date: '2026-10-04', roleSlug: 'coffee', slotId: 's1' },
    });

    assert.equal(at(out.draft, '2026-10-04', 'coffee', 's1').personId, 'p1');
    assert.deepEqual(out.displaced, { personId: 'p2', date: '2026-10-04' });
});

test('moving somebody out of one place and into another leaves no copy behind', () => {
    const draft = draftOf({
        '2026-10-04': [seat('coffee', 's1', 'p1')],
    });

    const out = Edit.place(draft, {
        personId: 'p1',
        from: { date: '2026-10-04', roleSlug: 'coffee', slotId: 's1' },
        to: { date: '2026-10-04', roleSlug: 'welcome', slotId: 's1' },
    });

    assert.equal(at(out.draft, '2026-10-04', 'coffee', 's1'), null);
    assert.equal(at(out.draft, '2026-10-04', 'welcome', 's1').personId, 'p1');
    assert.equal(seatsOn(out.draft, '2026-10-04').length, 1);
});

test('a move across dates takes them off the date they left', () => {
    const draft = draftOf({
        '2026-10-04': [seat('coffee', 's1', 'p1')],
        '2026-10-11': [],
    });

    const out = Edit.place(draft, {
        personId: 'p1',
        from: { date: '2026-10-04', roleSlug: 'coffee', slotId: 's1' },
        to: { date: '2026-10-11', roleSlug: 'coffee', slotId: 's1' },
    });

    assert.deepEqual(seatsOn(out.draft, '2026-10-04'), []);
    assert.equal(at(out.draft, '2026-10-11', 'coffee', 's1').personId, 'p1');
});

// ⚠ Without this, dragging somebody onto a second place in the SAME Role leaves
// them in both and the rota asks one person to be in two spots at once.
test('one person cannot hold two places in the same Role on one date', () => {
    const draft = draftOf({ '2026-10-04': [seat('coffee', 's1', 'p1')] });

    const out = Edit.place(draft, {
        personId: 'p1', to: { date: '2026-10-04', roleSlug: 'coffee', slotId: 's2' },
    });

    const mine = seatsOn(out.draft, '2026-10-04').filter(s => s.personId === 'p1');
    assert.equal(mine.length, 1);
    assert.equal(mine[0].slotId, 's2');
});

test('dropping somebody back where they already are changes nothing', () => {
    const draft = draftOf({
        '2026-10-04': [seat('coffee', 's1', 'p1', { held: true, state: 'confirmed' })],
    });

    const out = Edit.place(draft, {
        personId: 'p1',
        from: { date: '2026-10-04', roleSlug: 'coffee', slotId: 's1' },
        to: { date: '2026-10-04', roleSlug: 'coffee', slotId: 's1' },
    });

    assert.equal(out.draft, draft, 'the same object — nothing to redraw');
    assert.equal(at(out.draft, '2026-10-04', 'coffee', 's1').state, 'confirmed',
        'a yes must not be stripped off somebody who never moved');
    assert.equal(out.displaced, null);
});

// ⚠ NOT A SWAP, WHATEVER IT LOOKS LIKE. A trade is `swap`, and it puts the
// other person in the place this one is leaving. This is `place`: one person
// moves, the other goes to the rail, and the place left behind stays empty.
test('a plain move onto a taken place empties the old one and displaces the other', () => {
    const draft = draftOf({
        '2026-10-04': [seat('coffee', 's1', 'p1'), seat('welcome', 's1', 'p2')],
    });

    const out = Edit.place(draft, {
        personId: 'p1',
        from: { date: '2026-10-04', roleSlug: 'coffee', slotId: 's1' },
        to: { date: '2026-10-04', roleSlug: 'welcome', slotId: 's1' },
    });

    assert.equal(at(out.draft, '2026-10-04', 'welcome', 's1').personId, 'p1');
    assert.equal(at(out.draft, '2026-10-04', 'coffee', 's1'), null);
    assert.deepEqual(out.displaced, { personId: 'p2', date: '2026-10-04' });
});

test('moving somebody who confirmed does not carry their yes to the new job', () => {
    const draft = draftOf({
        '2026-10-04': [seat('coffee', 's1', 'p1', { held: true, state: 'confirmed' })],
    });

    const out = Edit.place(draft, {
        personId: 'p1',
        from: { date: '2026-10-04', roleSlug: 'coffee', slotId: 's1' },
        to: { date: '2026-10-04', roleSlug: 'welcome', slotId: 's1' },
    });

    assert.equal(at(out.draft, '2026-10-04', 'welcome', 's1').state, null,
        'they agreed to coffee, not to welcome');
});

test('a one-off place carries the job id, so it can be written back', () => {
    const draft = draftOf({ '2026-10-04': [] });

    const out = Edit.place(draft, {
        personId: 'p1',
        to: { date: '2026-10-04', roleSlug: 'j1', slotId: null, oneOffId: 'j1' },
    });

    const made = seatsOn(out.draft, '2026-10-04')[0];
    assert.equal(made.oneOffId, 'j1');
    // Intensity for a one-off is resolved through the record, since every
    // one-off shares the one reserved slug.
    assert.deepEqual(made.metadata, { oneOffId: 'j1' });
});

// ── Taking somebody out ─────────────────────────────────────────────────────

test('clearing a place hands back who was in it', () => {
    const draft = draftOf({ '2026-10-04': [seat('coffee', 's1', 'p1')] });

    const out = Edit.clear(draft, { date: '2026-10-04', roleSlug: 'coffee', slotId: 's1' });

    assert.deepEqual(seatsOn(out.draft, '2026-10-04'), []);
    assert.deepEqual(out.removed, { personId: 'p1', date: '2026-10-04' });
});

test('clearing an already-empty place is not an error', () => {
    const draft = draftOf({ '2026-10-04': [] });

    const out = Edit.clear(draft, { date: '2026-10-04', roleSlug: 'coffee', slotId: 's1' });

    assert.equal(out.draft, draft);
    assert.equal(out.removed, null);
});

test('the days nothing happened to are the same objects', () => {
    const draft = draftOf({ '2026-10-04': [], '2026-10-11': [] });
    const untouched = draft.dates[1];

    const out = Edit.place(draft, {
        personId: 'p1', to: { date: '2026-10-04', roleSlug: 'coffee', slotId: 's1' },
    });

    assert.equal(out.draft.dates[1], untouched, 'so only what moved is redrawn');
});

// ── The rail ────────────────────────────────────────────────────────────────

test('the same person displaced twice from one date waits once', () => {
    let rail = Edit.addDisplaced([], { personId: 'p1', date: '2026-10-04' });
    rail = Edit.addDisplaced(rail, { personId: 'p1', date: '2026-10-04' });

    assert.equal(rail.length, 1);
});

test('the same person displaced from two dates waits twice — they are two problems', () => {
    let rail = Edit.addDisplaced([], { personId: 'p1', date: '2026-10-04' });
    rail = Edit.addDisplaced(rail, { personId: 'p1', date: '2026-10-11' });

    assert.equal(rail.length, 2);
});

test('placing somebody from the rail takes them off it', () => {
    const rail = Edit.addDisplaced([], { personId: 'p1', date: '2026-10-04' });

    assert.deepEqual(Edit.removeDisplaced(rail, { personId: 'p1', date: '2026-10-04' }), []);
    assert.equal(Edit.removeDisplaced(rail, { personId: 'p1', date: '2026-10-11' }).length, 1,
        'a different date is a different waiting person');
});

// ── Trading two places ──────────────────────────────────────────────────────
//
// ⚠ THIS MODULE USED TO REFUSE TO SWAP, and it was right about the danger and
// wrong about the fix. "These two should trade" is the commonest edit on a
// rota, and doing it as two displaces passes through a state where both places
// are empty and both people are on the rail.
//
// Neither outcome is automatic. The screen offers the swap and the editor can
// turn it into a displace by holding the card still. The app proposes.

test('two people on the grid trade places', () => {
    const draft = draftOf({
        '2026-10-04': [seat('coffee', 's1', 'p1'), seat('setup', 's1', 'p2')],
    });

    const out = Edit.swap(draft, {
        personId: 'p1',
        from: { date: '2026-10-04', roleSlug: 'coffee', slotId: 's1' },
        to: { date: '2026-10-04', roleSlug: 'setup', slotId: 's1' },
    });

    assert.equal(at(out.draft, '2026-10-04', 'setup', 's1').personId, 'p1');
    assert.equal(at(out.draft, '2026-10-04', 'coffee', 's1').personId, 'p2');
    assert.deepEqual(out.swapped, { personId: 'p2', date: '2026-10-04' },
        'the caller is told who moved without asking to');
});

test('they trade across dates too', () => {
    const draft = draftOf({
        '2026-10-04': [seat('coffee', 's1', 'p1')],
        '2026-10-11': [seat('coffee', 's1', 'p2')],
    });

    const out = Edit.swap(draft, {
        personId: 'p1',
        from: { date: '2026-10-04', roleSlug: 'coffee', slotId: 's1' },
        to: { date: '2026-10-11', roleSlug: 'coffee', slotId: 's1' },
    });

    assert.equal(at(out.draft, '2026-10-11', 'coffee', 's1').personId, 'p1');
    assert.equal(at(out.draft, '2026-10-04', 'coffee', 's1').personId, 'p2');
});

// The person who did not choose to move still ends up somewhere they never
// agreed to (ADR-0018 §5).
test('a trade leaves both seats hand-placed, and carries neither yes across', () => {
    const draft = draftOf({
        '2026-10-04': [
            seat('coffee', 's1', 'p1', { held: true, state: 'confirmed' }),
            seat('setup', 's1', 'p2', { held: true, state: 'confirmed' }),
        ],
    });

    const out = Edit.swap(draft, {
        personId: 'p1',
        from: { date: '2026-10-04', roleSlug: 'coffee', slotId: 's1' },
        to: { date: '2026-10-04', roleSlug: 'setup', slotId: 's1' },
    });

    ['coffee', 'setup'].forEach(slug => {
        const made = at(out.draft, '2026-10-04', slug, 's1');
        assert.equal(made.held, false, slug + ' was not on the calendar as it now stands');
        assert.equal(made.state, null, slug + ' carries an answer nobody gave');
    });
});

// ── When a trade is refused ─────────────────────────────────────────────────

test('a card from the directory cannot trade — there is nowhere to send anybody', () => {
    const draft = draftOf({ '2026-10-04': [seat('coffee', 's1', 'p2')] });

    assert.equal(Edit.canSwap(draft, {
        personId: 'p1', to: { date: '2026-10-04', roleSlug: 'coffee', slotId: 's1' },
    }), false);
});

test('an empty place is not a trade, it is just a move', () => {
    const draft = draftOf({ '2026-10-04': [seat('coffee', 's1', 'p1')] });

    assert.equal(Edit.canSwap(draft, {
        personId: 'p1',
        from: { date: '2026-10-04', roleSlug: 'coffee', slotId: 's1' },
        to: { date: '2026-10-04', roleSlug: 'setup', slotId: 's1' },
    }), false);
});

test('the place they are already in is not a trade with themselves', () => {
    const draft = draftOf({ '2026-10-04': [seat('coffee', 's1', 'p1')] });

    assert.equal(Edit.canSwap(draft, {
        personId: 'p1',
        from: { date: '2026-10-04', roleSlug: 'coffee', slotId: 's1' },
        to: { date: '2026-10-04', roleSlug: 'coffee', slotId: 's1' },
    }), false);
});

// ⚠ ONE PERSON, ONE PLACE PER ROLE, PER DATE — and a trade can break it at
// EITHER end. Refused rather than corrected: the caller displaces instead, and
// the editor still gets a sensible outcome from the same drop.
test('a trade that would sit somebody twice in one Role is refused', () => {
    // p2 already does Coffee on the 4th, so sending them back there from the
    // 11th would have them pouring at two places on the same morning.
    const draft = draftOf({
        '2026-10-04': [seat('coffee', 's1', 'p1'), seat('coffee', 's2', 'p2')],
        '2026-10-11': [seat('coffee', 's1', 'p2')],
    });

    const move = {
        personId: 'p1',
        from: { date: '2026-10-04', roleSlug: 'coffee', slotId: 's1' },
        to: { date: '2026-10-11', roleSlug: 'coffee', slotId: 's1' },
    };

    assert.equal(Edit.canSwap(draft, move), false);
    assert.equal(Edit.swap(draft, move).swapped, null, 'and it changes nothing');
    assert.equal(at(Edit.swap(draft, move).draft, '2026-10-04', 'coffee', 's1').personId, 'p1');
});

test('the same refusal at the other end of the trade', () => {
    // p1 already does Coffee on the 11th, so that is where they cannot go.
    const draft = draftOf({
        '2026-10-04': [seat('setup', 's1', 'p1')],
        '2026-10-11': [seat('coffee', 's1', 'p2'), seat('coffee', 's2', 'p1')],
    });

    assert.equal(Edit.canSwap(draft, {
        personId: 'p1',
        from: { date: '2026-10-04', roleSlug: 'setup', slotId: 's1' },
        to: { date: '2026-10-11', roleSlug: 'coffee', slotId: 's1' },
    }), false);
});

// Two places in the SAME Role on one date is the one thing that is fine — each
// person still holds exactly one of them afterwards.
test('two places in one Role on one date can trade with each other', () => {
    const draft = draftOf({
        '2026-10-04': [seat('coffee', 's1', 'p1'), seat('coffee', 's2', 'p2')],
    });

    const out = Edit.swap(draft, {
        personId: 'p1',
        from: { date: '2026-10-04', roleSlug: 'coffee', slotId: 's1' },
        to: { date: '2026-10-04', roleSlug: 'coffee', slotId: 's2' },
    });

    assert.equal(at(out.draft, '2026-10-04', 'coffee', 's2').personId, 'p1');
    assert.equal(at(out.draft, '2026-10-04', 'coffee', 's1').personId, 'p2');
    assert.equal(seatsOn(out.draft, '2026-10-04').length, 2, 'nobody was duplicated');
});

test('a trade against a date that is not in the range does nothing', () => {
    const draft = draftOf({ '2026-10-04': [seat('coffee', 's1', 'p1')] });

    const out = Edit.swap(draft, {
        personId: 'p1',
        from: { date: '2026-10-04', roleSlug: 'coffee', slotId: 's1' },
        to: { date: '2026-12-25', roleSlug: 'coffee', slotId: 's1' },
    });

    assert.equal(out.swapped, null);
    assert.equal(at(out.draft, '2026-10-04', 'coffee', 's1').personId, 'p1');
});

test('a trade with nothing in hand does nothing, and does not throw', () => {
    const draft = draftOf({ '2026-10-04': [seat('coffee', 's1', 'p1')] });

    assert.equal(Edit.canSwap(draft, null), false);
    assert.equal(Edit.canSwap(draft, {}), false);
    assert.doesNotThrow(() => Edit.swap(draft, null));
});
