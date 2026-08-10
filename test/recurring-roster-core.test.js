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

test('by hand is the same room, asked for a blank grid (MS-219)', () => {
    const range = Core.rangeFor(['2026-08-09', '2026-08-16'], DATES);
    assert.strictEqual(
        Core.draftRoomHref('sunday_service', range, { byHand: true }),
        'auto-assign.html?series=sunday_service&from=2026-08-09&to=2026-08-16&by=hand'
    );
    assert.strictEqual(
        Core.draftRoomHref('sunday_service', null, { byHand: true }),
        'auto-assign.html?series=sunday_service&by=hand'
    );
});

test('no options, or an option that is not by hand, is the ordinary door', () => {
    const range = Core.rangeFor(['2026-08-09'], DATES);
    const plain = Core.draftRoomHref('sunday_service', range);
    assert.strictEqual(Core.draftRoomHref('sunday_service', range, {}), plain);
    assert.strictEqual(Core.draftRoomHref('sunday_service', range, { byHand: false }), plain);
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

// ── Emptying the ticked columns ───────────────────────────────────────────────
//
// The dangerous half of this module. The button sits an inch from the one that
// opens the draft room, and the two must not behave alike: the draft room works
// in a RANGE and sweeps the dates in between, this works in the SET that was
// ticked. An editor emptying two Sundays a month apart must not lose the three
// between them.

const ROSTERED = {
    '2026-08-09': [
        { roleSlug: 'coffee', slotId: 's1', personId: 'p1', state: 'confirmed' },
        { roleSlug: 'setup_teardown', slotId: 's1', personId: 'p2', state: 'pending' },
    ],
    '2026-08-16': [
        { roleSlug: 'coffee', slotId: 's1', personId: 'p1', state: 'pending' },
    ],
    // Nobody on the 23rd at all.
    '2026-08-30': [
        { roleSlug: 'coffee', slotId: 's1', personId: 'p3', state: 'declined' },
    ],
};

const wipe = (selected, today) => Core.wipeFor(selected, {
    today: today || '2026-08-01',
    assignmentsAt: date => ROSTERED[date] || [],
});

test('emptying takes the dates that were ticked and not one more', () => {
    // The draft room would sweep the 16th and 23rd along with these two. This
    // must not, and the assertion is the whole reason the two functions are
    // separate rather than one shared notion of "the range".
    const w = wipe(['2026-08-09', '2026-08-30']);
    assert.deepStrictEqual(w.dates, ['2026-08-09', '2026-08-30']);

    const range = Core.rangeFor(['2026-08-09', '2026-08-30'], DATES);
    assert.strictEqual(range.spans, 4, 'the draft room no longer sweeps, so this test proves nothing');
});

test('emptying counts the people and the places, not just the dates', () => {
    const w = wipe(['2026-08-09', '2026-08-16']);
    assert.strictEqual(w.assignments, 3);
    assert.deepStrictEqual(w.people, ['p1', 'p2'], 'one person on two dates was counted twice');
});

test('a yes about to be un-said is counted, so it can be said out loud first', () => {
    // The one thing an editor cannot see from the grid at a glance, and the one
    // that costs somebody else something.
    assert.strictEqual(wipe(['2026-08-09']).confirmed, 1);
    assert.strictEqual(wipe(['2026-08-16']).confirmed, 0);
    assert.strictEqual(wipe(['2026-08-30']).confirmed, 0, 'a decline was read as a yes');
});

test('a ticked date with nobody on it is not a date to write to', () => {
    const w = wipe(['2026-08-09', '2026-08-23']);
    assert.deepStrictEqual(w.dates, ['2026-08-09'], 'would have written to an empty date');
    assert.deepStrictEqual(w.alreadyEmpty, ['2026-08-23']);
    assert.strictEqual(w.any, true);
});

test('ticking only empty dates is nothing to do, and says which', () => {
    const w = wipe(['2026-08-23']);
    assert.strictEqual(w.any, false);
    assert.deepStrictEqual(w.dates, []);
    assert.deepStrictEqual(w.alreadyEmpty, ['2026-08-23']);
});

test('the past is left alone, however hard it is ticked', () => {
    // What is stored against a date that has been is the nearest thing there is
    // to a record of who actually turned up. A sweep across eight columns is the
    // wrong instrument for editing it.
    const w = wipe(['2026-08-09', '2026-08-16', '2026-08-30'], '2026-08-20');
    assert.deepStrictEqual(w.dates, ['2026-08-30']);
    assert.deepStrictEqual(w.past, ['2026-08-09', '2026-08-16']);
    assert.strictEqual(w.confirmed, 0, 'counted a yes on a date it is not going to touch');
    assert.deepStrictEqual(w.people, ['p3'], 'counted people it is not going to move');
});

test("today's own date is still ahead of the sweep", () => {
    // The service has not happened yet at breakfast. A rota you can still change
    // on the single-date screen has to be changeable here too.
    const w = wipe(['2026-08-09'], '2026-08-09');
    assert.deepStrictEqual(w.dates, ['2026-08-09']);
    assert.deepStrictEqual(w.past, []);
});

test('every ticked date being in the past is nothing to do, and not an error', () => {
    const w = wipe(['2026-08-09'], '2026-09-01');
    assert.strictEqual(w.any, false);
    assert.deepStrictEqual(w.past, ['2026-08-09']);
    assert.deepStrictEqual(w.alreadyEmpty, [], 'a past date was blamed on being empty');
});

test('nothing ticked is nothing at all, the same way the draft range is', () => {
    assert.strictEqual(wipe([]), null);
    assert.strictEqual(Core.wipeFor(null, {}), null);
});

test('the dates come back in order however they were ticked', () => {
    const w = wipe(['2026-08-30', '2026-08-09', '2026-08-16']);
    assert.deepStrictEqual(w.dates, ['2026-08-09', '2026-08-16', '2026-08-30']);
});

// ── What a member sees when they open one ─────────────────────────────────────
//
// Not the grid. A member is not staffing anything, so opening a series answers
// the two questions they came with: when does it next fall, and am I on it.

function upcoming(overrides) {
    return Core.upcoming(Object.assign({
        dates: DATES,
        from: '2026-08-09',
        personId: 'p1',
        occurrenceAt: () => null,
    }, overrides || {}));
}

test('opening a recurring event lists the dates it falls on from today forward', () => {
    const rows = upcoming({ from: '2026-08-16' });
    assert.deepStrictEqual(rows.map(r => r.date),
        ['2026-08-16', '2026-08-23', '2026-08-30'],
        'a date already gone was offered as something coming up');
});

test('the list is capped when asked, and uncapped when not', () => {
    assert.strictEqual(upcoming({ count: 2 }).length, 2);
    assert.strictEqual(upcoming().length, DATES.length);
});

// A member who turns up to a midweek that was called off has been failed by a
// list that quietly left it out. It is shown, and it says so.
test('a cancelled date is kept and marked rather than dropped', () => {
    const rows = upcoming({
        occurrenceAt: date => date === '2026-08-16' ? { cancelled: true } : null,
    });
    assert.deepStrictEqual(rows.map(r => r.date), DATES, 'a cancelled date vanished');
    assert.deepStrictEqual(rows.filter(r => r.cancelled).map(r => r.date), ['2026-08-16']);
});

// ⚠ Answered against the person id, never "does this date have a roster". The
// same occurrence read hands an EDITOR the whole roster and a member only their
// own row, so counting rows would tell an editor they were on every staffed
// date in the church.
test('“you are on this one” is answered against the person, not the roster’s size', () => {
    const roster = {
        '2026-08-09': { assignments: [{ personId: 'p2' }, { personId: 'p3' }] },
        '2026-08-23': { assignments: [{ personId: 'p3' }, { personId: 'p1' }] },
    };
    const rows = upcoming({ occurrenceAt: date => roster[date] || null });

    assert.deepStrictEqual(rows.filter(r => r.mine).map(r => r.date), ['2026-08-23']);
});

test('nobody signed in to a Person is on nothing, rather than on everything', () => {
    const rows = upcoming({
        personId: null,
        occurrenceAt: () => ({ assignments: [{ personId: 'p2' }] }),
    });
    assert.ok(rows.every(r => !r.mine), 'someone with no Person was told they were serving');
});

test('a date nobody has touched is a date, not a gap', () => {
    const rows = upcoming();
    assert.strictEqual(rows.length, DATES.length);
    assert.ok(rows.every(r => !r.cancelled && !r.mine));
});
