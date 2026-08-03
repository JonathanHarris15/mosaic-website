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

test('swapping two people onto each other displaces the one who was there', () => {
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
