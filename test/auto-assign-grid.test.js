// The draft, transposed for the screen (MS-179).
//
// The solve returns dates each holding a flat list of seats and a flat list of
// gaps. The grid needs Roles down the side and every PLACE present whether or
// not somebody is in it — and the failure this file mostly exists to catch is
// an unfilled place that simply is not drawn, because a Role needing three
// people then shows two cards and no hint a third was ever wanted.

const test = require('node:test');
const assert = require('node:assert');

const Grid = require('../public/auto-assign-grid-core.js');

const COFFEE = {
    slug: 'coffee', name: 'Coffee', allowsAnotherRole: false,
    slots: [{ id: 's1', requirement: 'either' }, { id: 's2', requirement: 'female' }],
};
const WELCOME = {
    slug: 'welcome', name: 'Welcome', allowsAnotherRole: true,
    slots: [{ id: 's1', requirement: 'male' }],
};

const PEOPLE = {
    p1: 'Alice Brown',
    p2: 'Bob Carter',
    p3: 'Chris Doyle',
};

// The injected lookups, all defaulted to "nothing to report" so a test only has
// to say the one thing it is about.
function options(overrides) {
    return Object.assign({
        dates: [],
        roles: [COFFEE],
        windowSize: 12,
        nameOf: id => PEOPLE[id] || 'Someone',
        roleNameOf: slug => ({ coffee: 'Coffee', welcome: 'Welcome', preacher: 'Preacher' })[slug] || slug,
        labelOf: date => date,
        loadAt: () => 0,
        recencyAt: () => null,
        warningAt: () => null,
        liturgicalAt: () => [],
        oneOffsAt: () => [],
        oneOffPeopleAt: () => [],
        reasonText: reason => 'because: ' + (reason && reason.reason),
    }, overrides || {});
}

const day = (date, seats, gaps) => ({
    date: date, skipped: false, seats: seats || [], gaps: gaps || [],
});

// ── Every place is drawn, filled or not ─────────────────────────────────────

test('a Role with three places shows three, however few the solve filled', () => {
    const role = {
        slug: 'setup', name: 'Setup', slots: [{ id: 's1' }, { id: 's2' }, { id: 's3' }],
    };
    const grid = Grid.gridFrom(options({
        roles: [role],
        dates: [day('2026-10-04', [{ roleSlug: 'setup', slotId: 's1', personId: 'p1' }])],
    }));

    const places = grid.roleRows[0].cells[0].places;
    assert.equal(places.length, 3, 'the two nobody filled are the whole reason to draft ahead');
    assert.deepEqual(places.map(p => p.filled), [true, false, false]);
    assert.deepEqual(places.map(p => p.slotId), ['s1', 's2', 's3']);
});

test('a place says whether it wants a man, a woman, or anyone', () => {
    const grid = Grid.gridFrom(options({
        roles: [COFFEE, WELCOME],
        dates: [day('2026-10-04')],
    }));

    assert.deepEqual(grid.roleRows[0].cells[0].places.map(p => p.wants), ['Anyone', 'A woman']);
    assert.deepEqual(grid.roleRows[1].cells[0].places.map(p => p.wants), ['A man']);
});

test('an empty place the solve tried and failed says why', () => {
    const grid = Grid.gridFrom(options({
        dates: [day('2026-10-04', [], [
            { roleSlug: 'coffee', slotId: 's2', reason: 'sexMismatch', detail: { reason: 'sexMismatch' } },
        ])],
    }));

    const places = grid.roleRows[0].cells[0].places;
    assert.equal(places[0].reason, null, 'no gap was reported for this one');
    assert.equal(places[1].reason, 'because: sexMismatch');
});

test('a date the editor left alone reports no reasons — nothing was attempted', () => {
    const left = Object.assign(day('2026-10-04'), { skipped: true });
    const grid = Grid.gridFrom(options({ dates: [left] }));

    const cell = grid.roleRows[0].cells[0];
    assert.equal(cell.skipped, true);
    assert.deepEqual(cell.places.map(p => p.reason), [null, null],
        'inventing a reason for a place nobody tried to fill would be a lie');
});

// ── The card ────────────────────────────────────────────────────────────────

test('a card carries initials, load against budget, and time since that Role', () => {
    const grid = Grid.gridFrom(options({
        windowSize: 12,
        loadAt: () => 5,
        dates: [day('2026-10-04', [
            { roleSlug: 'coffee', slotId: 's1', personId: 'p1', recency: 3 },
        ])],
    }));

    const card = grid.roleRows[0].cells[0].places[0].card;
    assert.equal(card.name, 'Alice Brown');
    assert.equal(card.initials, 'AB');
    assert.equal(card.load, 5);
    assert.equal(card.budget, 12);
    assert.equal(card.spent, false);
    assert.equal(card.recencyLabel, '3 ago');
});

test('somebody at or past their budget is marked over budget', () => {
    const grid = Grid.gridFrom(options({
        windowSize: 12,
        loadAt: (date, personId) => (personId === 'p1' ? 12 : 11),
        dates: [day('2026-10-04', [
            { roleSlug: 'coffee', slotId: 's1', personId: 'p1', recency: 4 },
            { roleSlug: 'coffee', slotId: 's2', personId: 'p2', recency: 4 },
        ])],
    }));

    const places = grid.roleRows[0].cells[0].places;
    assert.equal(places[0].card.spent, true, 'load equal to the window is spent, not almost');
    assert.equal(places[1].card.spent, false);
});

// ⚠ A held seat is the one card the solve never scores — the search fills in
// AROUND those and leaves their recency unset. Without the lookup a hand-made
// pick would be the only card on the grid with no history on it.
test('a held place gets its recency looked up rather than left blank', () => {
    const grid = Grid.gridFrom(options({
        recencyAt: (date, roleSlug, personId) => (personId === 'p1' ? 2 : null),
        dates: [day('2026-10-04', [
            { roleSlug: 'coffee', slotId: 's1', personId: 'p1', held: true, state: 'confirmed' },
        ])],
    }));

    const card = grid.roleRows[0].cells[0].places[0].card;
    assert.equal(card.recency, 2);
    assert.equal(card.recencyLabel, '2 ago');
    assert.equal(card.held, true);
    assert.equal(card.state, 'confirmed');
});

test('a card that breaks a rule carries the reason', () => {
    const grid = Grid.gridFrom(options({
        warningAt: (date, roleSlug, slotId) => (
            slotId === 's2' ? { reason: 'relationshipConflict' } : null
        ),
        dates: [day('2026-10-04', [
            { roleSlug: 'coffee', slotId: 's1', personId: 'p1', recency: 1 },
            { roleSlug: 'coffee', slotId: 's2', personId: 'p2', recency: 1 },
        ])],
    }));

    const places = grid.roleRows[0].cells[0].places;
    assert.equal(places[0].card.warning, null);
    assert.equal(places[1].card.warning, 'because: relationshipConflict');
});

test('how long since the Role reads honestly at both ends', () => {
    assert.equal(Grid.recencyLabel(0, 12), 'Last time');
    assert.equal(Grid.recencyLabel(1, 12), '1 ago');
    // Fairness caps recency at the window, so this is "never" and "before the
    // window opened" wearing the same face — and the wording must not claim a
    // precision it does not have.
    assert.equal(Grid.recencyLabel(12, 12), 'Not this season');
    assert.equal(Grid.recencyLabel(null, 12), '');
});

test('initials fall back rather than throwing on an odd name', () => {
    assert.equal(Grid.initialsOf('Alice Brown'), 'AB');
    assert.equal(Grid.initialsOf('Prince'), 'P');
    assert.equal(Grid.initialsOf('  '), '?');
    assert.equal(Grid.initialsOf(null), '?');
});

// ── The rows ────────────────────────────────────────────────────────────────

test('a Role that may be held alongside another is marked on its row header', () => {
    const grid = Grid.gridFrom(options({ roles: [COFFEE, WELCOME], dates: [day('2026-10-04')] }));

    assert.equal(grid.roleRows[0].allowsAnotherRole, false);
    assert.equal(grid.roleRows[1].allowsAnotherRole, true,
        'without it the same face twice in one column reads as a bug');
});

test('the liturgy row shows who is preaching, and cannot be edited', () => {
    const grid = Grid.gridFrom(options({
        liturgicalAt: date => (date === '2026-10-04'
            ? [{ personId: 'p3', roleSlug: 'preacher' }]
            : []),
        dates: [day('2026-10-04'), day('2026-10-11')],
    }));

    assert.equal(grid.rows[0].kind, 'liturgy');
    assert.equal(grid.rows[0].readOnly, true);
    assert.deepEqual(grid.liturgy.cells[0].holders, [{
        personId: 'p3', name: 'Chris Doyle', initials: 'CD',
        roleSlug: 'preacher', roleName: 'Preacher',
    }]);
    assert.deepEqual(grid.liturgy.cells[1].holders, []);
});

test('an Event with no liturgy at all draws no liturgy row', () => {
    const grid = Grid.gridFrom(options({ dates: [day('2026-10-04')] }));

    assert.equal(grid.liturgy.occupied, false);
    assert.equal(grid.rows[0].kind, 'role', 'an empty read-only row is furniture');
});

// ── One-off Roles ───────────────────────────────────────────────────────────

test('a one-off Role is fillable on its own date and not-applicable elsewhere', () => {
    const grid = Grid.gridFrom(options({
        dates: [day('2026-10-04'), day('2026-10-11')],
        oneOffsAt: date => (date === '2026-10-11'
            ? [{ id: 'j1', label: 'Move the piano' }]
            : []),
        oneOffPeopleAt: date => (date === '2026-10-11'
            ? [{ oneOffId: 'j1', personId: 'p2', state: 'pending' }]
            : []),
    }));

    assert.equal(grid.oneOffRows.length, 1);
    const row = grid.oneOffRows[0];
    assert.equal(row.name, 'Move the piano');
    assert.equal(row.date, '2026-10-11');
    assert.equal(row.placeCount, null, 'an open-ended list, not a fixed number of places');

    assert.equal(row.cells[0].applicable, false, 'this job does not exist on the 4th');
    assert.deepEqual(row.cells[0].places, []);
    assert.equal(row.cells[1].applicable, true);
    assert.equal(row.cells[1].places[0].card.name, 'Bob Carter');
});

test('one-off rows sit below the managed Roles', () => {
    const grid = Grid.gridFrom(options({
        roles: [COFFEE, WELCOME],
        dates: [day('2026-10-04')],
        oneOffsAt: () => [{ id: 'j1', label: 'Move the piano' }],
    }));

    assert.deepEqual(grid.rows.map(r => r.kind), ['role', 'role', 'oneOff']);
});

// ── The range strip ─────────────────────────────────────────────────────────

test('each date gets a tick counting empty places, tired people and problems', () => {
    const grid = Grid.gridFrom(options({
        roles: [COFFEE, WELCOME],
        windowSize: 12,
        loadAt: (date, personId) => (personId === 'p1' ? 12 : 0),
        warningAt: (date, roleSlug) => (roleSlug === 'welcome' ? { reason: 'sexMismatch' } : null),
        labelOf: date => 'the ' + date,
        dates: [
            day('2026-10-04', [
                { roleSlug: 'coffee', slotId: 's1', personId: 'p1', recency: 1 },
                { roleSlug: 'welcome', slotId: 's1', personId: 'p2', recency: 1 },
            ], [{ roleSlug: 'coffee', slotId: 's2', detail: { reason: 'sexUnknown' } }]),
            day('2026-10-11'),
        ],
    }));

    assert.deepEqual(grid.columns[0], {
        date: '2026-10-04', index: 0, label: 'the 2026-10-04', skipped: false,
        empty: 1, spent: 1, problems: 1,
    });
    assert.equal(grid.columns[1].empty, 3, 'nothing filled on the 11th');
});

test('one tired person doing two jobs is one tired person', () => {
    const grid = Grid.gridFrom(options({
        roles: [COFFEE, WELCOME],
        windowSize: 12,
        loadAt: () => 12,
        dates: [day('2026-10-04', [
            { roleSlug: 'coffee', slotId: 's1', personId: 'p1', recency: 1 },
            { roleSlug: 'welcome', slotId: 's1', personId: 'p1', recency: 1 },
        ])],
    }));

    assert.equal(grid.columns[0].spent, 1);
});

test('the liturgy row is not counted against a date — it is not fillable here', () => {
    const grid = Grid.gridFrom(options({
        roles: [],
        liturgicalAt: () => [{ personId: 'p3', roleSlug: 'preacher' }],
        dates: [day('2026-10-04')],
    }));

    assert.deepEqual(grid.columns[0].empty, 0);
    assert.deepEqual(grid.columns[0].spent, 0);
});

test('a grid built without days refuses rather than drawing an empty screen', () => {
    assert.throws(() => Grid.gridFrom({}), /needs options\.dates/);
});

// ── Dragging to the edge scrolls the grid ───────────────────────────────────
//
// A drag holds the pointer captive, so the scrollbar and the range strip are
// both out of reach of the hand that is carrying somebody.

const BOX = { left: 100, right: 900, top: 200, bottom: 700 };

test('the middle of the grid pulls in no direction at all', () => {
    assert.deepEqual(Grid.edgeScroll(BOX, { x: 500, y: 450 }), { x: 0, y: 0 });
});

test('the left edge pulls left, the right edge right', () => {
    assert.ok(Grid.edgeScroll(BOX, { x: 110, y: 450 }).x < 0);
    assert.ok(Grid.edgeScroll(BOX, { x: 890, y: 450 }).x > 0);
});

test('the top edge pulls up, the bottom edge down', () => {
    assert.ok(Grid.edgeScroll(BOX, { x: 500, y: 210 }).y < 0);
    assert.ok(Grid.edgeScroll(BOX, { x: 500, y: 690 }).y > 0);
});

// A corner is both edges at once — reaching the last date of a long range on a
// Role near the bottom is one diagonal drag, not two.
test('a corner pulls on both axes together', () => {
    const by = Grid.edgeScroll(BOX, { x: 895, y: 695 });
    assert.ok(by.x > 0 && by.y > 0);
});

// ⚠ ONE SPEED IS EITHER TOO SLOW TO CROSS A LONG RANGE OR TOO FAST TO STOP ON
// A COLUMN. The pull ramps with how close to the edge you are, so the editor
// steers by moving their hand rather than by timing a release.
test('the pull gets stronger the closer to the edge you get', () => {
    const near = Grid.edgeScroll(BOX, { x: 150, y: 450 }).x;
    const nearer = Grid.edgeScroll(BOX, { x: 120, y: 450 }).x;
    const at = Grid.edgeScroll(BOX, { x: 100, y: 450 }).x;

    assert.ok(Math.abs(nearer) > Math.abs(near));
    assert.ok(Math.abs(at) > Math.abs(nearer));
    assert.equal(Math.abs(at), Grid.EDGE_MAX, 'and it is capped at the edge itself');
});

// The panel and the displaced rail are both a drop's-width from the grid, and
// neither of them should drive it.
test('a pointer outside the grid pulls nothing', () => {
    assert.deepEqual(Grid.edgeScroll(BOX, { x: 950, y: 450 }), { x: 0, y: 0 },
        'over the directory');
    assert.deepEqual(Grid.edgeScroll(BOX, { x: 500, y: 760 }), { x: 0, y: 0 },
        'over the displaced rail');
    assert.deepEqual(Grid.edgeScroll(BOX, { x: 500, y: 150 }), { x: 0, y: 0 },
        'over the range strip');
});

// Otherwise the two zones overlap and the middle of the box pulls both ways.
test('a box too small to have edges pulls nothing', () => {
    const slot = { left: 0, right: 60, top: 0, bottom: 60 };
    assert.deepEqual(Grid.edgeScroll(slot, { x: 30, y: 30 }), { x: 0, y: 0 });
});

test('no box and no pointer is no pull, not a crash', () => {
    assert.deepEqual(Grid.edgeScroll(null, { x: 1, y: 1 }), { x: 0, y: 0 });
    assert.deepEqual(Grid.edgeScroll(BOX, null), { x: 0, y: 0 });
});
