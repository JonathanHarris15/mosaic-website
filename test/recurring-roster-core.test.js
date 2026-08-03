const { test } = require('node:test');
const assert = require('node:assert');

// The Recurring Events grid — a series' rota laid out as Roles against dates.
//
// The two things this has to get right are the two the Event detail page and
// auto-assign each got wrong once already: an unfilled place has to be VISIBLE
// (a cell built from stored assignments alone hides it), and a selection of
// columns has to be honest about what the draft room will really open, because
// the draft room works in ranges and cannot take a scattered set.

const Core = require('../public/recurring-roster-core.js');

// ── A series to lay out ───────────────────────────────────────────────────────

const DATES = ['2026-08-09', '2026-08-16', '2026-08-23', '2026-08-30'];

const ROLES = [
    { slug: 'coffee', name: 'Coffee', slots: [{ id: 's1' }] },
    { slug: 'setup_teardown', name: 'Setup / teardown', slots: [{ id: 's1' }, { id: 's2' }] },
];

const NAMES = {
    p1: 'Bethany Croft', p2: 'Dave Okonkwo', p3: 'Ruth Bell', p4: 'Sam Idowu',
};

function build(overrides) {
    const o = Object.assign({
        dates: DATES,
        roles: ROLES,
        nameOf: id => NAMES[id] || 'Someone',
        cancelledAt: () => false,
        oneOffsAt: () => [],
        assignmentsAt: () => [],
    }, overrides || {});
    return Core.rosterGrid(o);
}

// ── An empty place has to exist ───────────────────────────────────────────────

test('a Role with two places draws two, even when only one is filled', () => {
    const grid = build({
        assignmentsAt: date => (date === '2026-08-09'
            ? [{ roleSlug: 'setup_teardown', slotId: 's1', personId: 'p1', state: 'pending' }]
            : []),
    });

    const row = grid.roleRows.find(r => r.slug === 'setup_teardown');
    const cell = row.cells[0];

    assert.strictEqual(cell.places.length, 2, 'the unfilled place vanished from the grid');
    assert.strictEqual(cell.places[0].filled, true);
    assert.strictEqual(cell.places[1].filled, false, 'the second place reads as filled');
    assert.strictEqual(cell.places[1].card, null);
});

test('a place carries the person, their initials and their state', () => {
    const grid = build({
        assignmentsAt: date => (date === '2026-08-09'
            ? [{ roleSlug: 'coffee', slotId: 's1', personId: 'p1', state: 'confirmed' }]
            : []),
    });

    const card = grid.roleRows.find(r => r.slug === 'coffee').cells[0].places[0].card;
    assert.strictEqual(card.name, 'Bethany Croft');
    assert.strictEqual(card.initials, 'BC');
    assert.strictEqual(card.state, 'confirmed');
    assert.strictEqual(card.declined, false);
});

test('a decline is marked, not drawn as an ordinary name', () => {
    // A hole that looks filled stays hidden until the morning it matters.
    const grid = build({
        assignmentsAt: () => [{ roleSlug: 'coffee', slotId: 's1', personId: 'p2', state: 'declined' }],
    });

    assert.strictEqual(grid.roleRows[0].cells[0].places[0].card.declined, true);
    assert.strictEqual(grid.columns[0].declined, 1, 'the column did not count the decline');
});

test("an assignment to a slot the Role no longer has does not appear", () => {
    // The Role's own slots build the cell, so a stale roster row cannot invent a
    // place that is not wanted any more.
    const grid = build({
        assignmentsAt: () => [{ roleSlug: 'coffee', slotId: 's9', personId: 'p1' }],
    });

    const cell = grid.roleRows.find(r => r.slug === 'coffee').cells[0];
    assert.strictEqual(cell.places.length, 1);
    assert.strictEqual(cell.places[0].filled, false);
});

// ── Cancelled dates ───────────────────────────────────────────────────────────

test('a cancelled date counts no holes', () => {
    // Otherwise it sends an editor chasing people for a Sunday that is not on.
    const grid = build({ cancelledAt: date => date === '2026-08-16' });

    assert.strictEqual(grid.columns[1].cancelled, true);
    assert.strictEqual(grid.columns[1].empty, 0, 'a cancelled date reported holes to fill');
    assert.strictEqual(grid.columns[0].empty, 3, 'a live date lost its holes');
});

// ── One-off jobs ──────────────────────────────────────────────────────────────

test('a one-off job is applicable on its own date and nowhere else', () => {
    const grid = build({
        oneOffsAt: date => (date === '2026-08-23' ? [{ id: 'o1', label: 'Unlock the hall' }] : []),
        assignmentsAt: date => (date === '2026-08-23'
            ? [{ oneOffId: 'o1', roleSlug: 'o1', personId: 'p3', state: 'pending' }]
            : []),
    });

    assert.strictEqual(grid.oneOffRows.length, 1);
    const row = grid.oneOffRows[0];
    assert.strictEqual(row.name, 'Unlock the hall');
    assert.strictEqual(row.cells[2].applicable, true);
    assert.strictEqual(row.cells[0].applicable, false, 'a one-off claimed a date it is not on');
    assert.strictEqual(row.cells[2].places[0].card.name, 'Ruth Bell');
});

test('a one-off adds to what is filled but never to the places wanted', () => {
    // Otherwise a date reads as more complete for having an extra job on it.
    const bare = build({});
    const withJob = build({
        oneOffsAt: date => (date === '2026-08-09' ? [{ id: 'o1', label: 'Unlock' }] : []),
        assignmentsAt: date => (date === '2026-08-09'
            ? [{ oneOffId: 'o1', roleSlug: 'o1', personId: 'p3' }] : []),
    });

    assert.strictEqual(bare.columns[0].places, 3);
    assert.strictEqual(withJob.columns[0].places, 3, 'a one-off invented a place to fill');
    assert.strictEqual(withJob.columns[0].filled, 1);
});

// ── The column counts ─────────────────────────────────────────────────────────

test('a column counts what is filled, what is wanted and what is left', () => {
    const grid = build({
        assignmentsAt: date => (date === '2026-08-09' ? [
            { roleSlug: 'coffee', slotId: 's1', personId: 'p1' },
            { roleSlug: 'setup_teardown', slotId: 's1', personId: 'p2' },
        ] : []),
    });

    assert.deepStrictEqual(
        { filled: grid.columns[0].filled, places: grid.columns[0].places, empty: grid.columns[0].empty },
        { filled: 2, places: 3, empty: 1 }
    );
    assert.strictEqual(grid.columns[0].untouched, false);
    assert.strictEqual(grid.columns[1].untouched, true, 'a date nobody has started reads as started');
});

// ── Ticked columns → the draft room ───────────────────────────────────────────

test('a contiguous run of columns becomes exactly that range', () => {
    const range = Core.rangeFor(['2026-08-09', '2026-08-16'], DATES);
    assert.deepStrictEqual(
        { from: range.from, to: range.to, contiguous: range.contiguous, spans: range.spans },
        { from: '2026-08-09', to: '2026-08-16', contiguous: true, spans: 2 }
    );
    assert.deepStrictEqual(range.swept, []);
});

test('a scattered selection reports the dates it will drag in with it', () => {
    // The draft room resolves its dates from the rule between a start and an
    // end, so the gaps come along. Saying so beats sending the range quietly.
    const range = Core.rangeFor(['2026-08-09', '2026-08-30'], DATES);

    assert.strictEqual(range.contiguous, false);
    assert.deepStrictEqual(range.swept, ['2026-08-16', '2026-08-23']);
    assert.strictEqual(range.count, 2, 'the editor ticked two');
    assert.strictEqual(range.spans, 4, 'and four will actually be opened');
});

test('ticking nothing is no range at all', () => {
    assert.strictEqual(Core.rangeFor([], DATES), null);
    assert.strictEqual(Core.rangeFor(null, DATES), null);
});

test('the selection is sorted, so ticking backwards still reads forwards', () => {
    const range = Core.rangeFor(['2026-08-30', '2026-08-09'], DATES);
    assert.strictEqual(range.from, '2026-08-09');
    assert.strictEqual(range.to, '2026-08-30');
});

test('the draft room address names the series and the range', () => {
    const range = Core.rangeFor(['2026-08-09', '2026-08-16'], DATES);
    assert.strictEqual(
        Core.draftRoomHref('sunday_service', range),
        'auto-assign.html?series=sunday_service&from=2026-08-09&to=2026-08-16'
    );
});

test('no ticked dates still opens the draft room, on the series alone', () => {
    // "Draft this event" is what an editor wants far more often than "draft
    // exactly these dates", and it is the whole of what the Calendar's
    // Auto-assign button used to mean. Refusing to build a link without a range
    // would make selecting columns a toll on the common case.
    assert.strictEqual(
        Core.draftRoomHref('sunday_service', null),
        'auto-assign.html?series=sunday_service'
    );
});

test('no series is no link at all, because there is nothing to draft', () => {
    const range = Core.rangeFor(['2026-08-09'], DATES);
    assert.strictEqual(Core.draftRoomHref('', range), null);
    assert.strictEqual(Core.draftRoomHref(null, null), null);
});

// ── Paging the window ─────────────────────────────────────────────────────────

const MANY = [
    '2026-08-02', '2026-08-09', '2026-08-16', '2026-08-23',
    '2026-08-30', '2026-09-06', '2026-09-13', '2026-09-20',
];

test('the window starts at the anchor and runs forward', () => {
    assert.deepStrictEqual(
        Core.windowOf(MANY, '2026-08-16', 3),
        ['2026-08-16', '2026-08-23', '2026-08-30']
    );
});

test('an anchor between dates lands on the next one', () => {
    // Today is rarely a Sunday, and "the next few" is what the editor means.
    assert.deepStrictEqual(
        Core.windowOf(MANY, '2026-08-12', 2),
        ['2026-08-16', '2026-08-23']
    );
});

test('an anchor past the end shows the last page rather than nothing', () => {
    assert.deepStrictEqual(
        Core.windowOf(MANY, '2027-01-01', 3),
        ['2026-09-06', '2026-09-13', '2026-09-20']
    );
});

test('paging back stops at the start instead of running off it', () => {
    assert.strictEqual(Core.previousAnchor(MANY, '2026-08-16', 4), '2026-08-02');
    assert.strictEqual(Core.previousAnchor(MANY, '2026-08-02', 4), null, 'offered a page before the first');
});

test('paging forward stops at the end instead of running off it', () => {
    assert.strictEqual(Core.nextAnchor(MANY, '2026-08-02', 4), '2026-08-30');
    assert.strictEqual(Core.nextAnchor(MANY, '2026-08-30', 4), null, 'offered a page past the last');
});

test('a series with no dates lays out as nothing, not as a crash', () => {
    assert.deepStrictEqual(Core.windowOf([], '2026-08-09', 4), []);
    const grid = build({ dates: [] });
    assert.deepStrictEqual(grid.columns, []);
    assert.strictEqual(grid.rows.length, 2, 'the Roles should still be listed');
});

test('laying out without dates is a programming error, and says so', () => {
    assert.throws(() => Core.rosterGrid({}), /options\.dates/);
});
