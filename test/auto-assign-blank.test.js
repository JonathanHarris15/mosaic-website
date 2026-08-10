const { test } = require('node:test');
const assert = require('node:assert');

const AutoAssign = require('../public/auto-assign-core.js');
const Grid = require('../public/auto-assign-grid-core.js');
const Roles = require('../public/roles-core.js');

// A blank draft (MS-219): the same range with nobody in it, for an editor who
// already knows who they want and would rather place them than argue with a
// rota the machine drew.
//
// ⚠ WHAT THIS FILE IS REALLY GUARDING is that a blank grid is a DRAFT and not a
// second kind of thing. The screen, the drag, the warnings and accepting all
// read one shape, and the moment a blank one comes back subtly different — a
// missing gap, a reason invented for a place nobody tried, a held seat quietly
// dropped — every one of them has to grow a special case.

const SERIES = 'sunday_service';

const RANGE = ['2026-10-04', '2026-10-11', '2026-10-18'];

const person = (id) => ({ id: id, name: id, tags: [] });
const either = n => ({ id: 's' + n, requirement: Roles.REQUIREMENTS.EITHER });

const role = (slug, slotCount) => ({
    slug: slug,
    name: slug,
    family: Roles.FAMILIES.SERVANT,
    slots: Array.from({ length: slotCount }, (_, i) => either(i + 1)),
    restrictions: [],
    intensity: 1,
    allowsAnotherRole: false,
});

const FOUR = ['ann', 'ben', 'cara', 'dan'].map(person);

// ⚠ NO `solve`, NO `windowSize`, NO `candidatesFor`. A blank draft never asks
// anybody whether somebody may serve, and a fixture that handed it a judge would
// hide the day it quietly started asking one.
function options(over) {
    return Object.assign({
        dates: RANGE,
        pastDates: [],
        history: [],
        existing: {},
        choice: AutoAssign.CHOICES.KEEP,
        roles: [role('coffee', 1), role('setup', 2)],
        people: FOUR,
        seriesId: SERIES,
    }, over || {});
}

const assignment = (roleSlug, slotId, personId, state) => ({
    roleSlug: roleSlug, slotId: slotId, personId: personId, state: state || 'pending',
});

// ── The shape of it ──────────────────────────────────────────────────────────

test('a blank draft has one entry per date, in range order', () => {
    const result = AutoAssign.blank(options());

    assert.equal(result.dates.length, RANGE.length);
    result.dates.forEach((day, i) => {
        assert.equal(day.date, RANGE[i]);
        assert.ok(Array.isArray(day.seats));
        assert.ok(Array.isArray(day.gaps));
    });
});

test('a blank draft seats nobody', () => {
    const result = AutoAssign.blank(options());

    result.dates.forEach(day => {
        assert.equal(day.seats.length, 0, day.date + ' has nobody on it');
    });
});

test('every place comes back as a gap, so the grid can draw it', () => {
    const result = AutoAssign.blank(options());

    result.dates.forEach(day => {
        assert.equal(day.gaps.length, 3, 'one coffee place and two setup places');
        assert.deepEqual(
            day.gaps.map(g => g.roleSlug + '|' + g.slotId).sort(),
            ['coffee|s1', 'setup|s1', 'setup|s2']
        );
    });
});

// ⚠ THE POINT OF THE WHOLE THING. A reason means the solve tried this place and
// could not fill it. Nothing tried here, and "nobody was free" written against a
// place nobody asked about is a lie the editor would act on.
test('an empty place on a blank draft carries no reason', () => {
    const result = AutoAssign.blank(options());

    result.dates.forEach(day => {
        day.gaps.forEach(gap => {
            assert.equal(gap.reason, null);
            assert.equal(gap.detail, null);
        });
    });
});

test('it needs no solve, no window and no eligibility judge', () => {
    assert.doesNotThrow(() => AutoAssign.blank(options()));
});

test('a drafted range still refuses to run without a solve', () => {
    assert.throws(() => AutoAssign.draft(options()), /options\.solve/);
});

// ── What is already on the dates ─────────────────────────────────────────────

test('people already on a date stay put, and their places are not gaps', () => {
    const result = AutoAssign.blank(options({
        existing: { '2026-10-11': [assignment('coffee', 's1', 'ann', 'confirmed')] },
    }));

    const second = result.dates[1];
    assert.deepEqual(second.seats.map(s => s.personId), ['ann']);
    assert.equal(second.seats[0].held, true, 'a kept seat reads as hand-made, not drafted');
    assert.deepEqual(
        second.gaps.map(g => g.roleSlug + '|' + g.slotId).sort(),
        ['setup|s1', 'setup|s2'],
        'the place Ann is in is not also offered as empty'
    );

    assert.equal(result.dates[0].seats.length, 0, 'the other dates are untouched');
});

test('replace empties a pending place and offers it back as a gap', () => {
    const result = AutoAssign.blank(options({
        choice: AutoAssign.CHOICES.REPLACE,
        existing: { '2026-10-11': [assignment('coffee', 's1', 'ann')] },
    }));

    const second = result.dates[1];
    assert.equal(second.seats.length, 0, 'a pending seat is not kept');
    assert.equal(second.gaps.length, 3, 'and its place is back on offer');
});

test('somebody who said yes stays whatever the choice is', () => {
    const result = AutoAssign.blank(options({
        choice: AutoAssign.CHOICES.REPLACE,
        existing: { '2026-10-11': [assignment('coffee', 's1', 'ann', 'confirmed')] },
    }));

    assert.deepEqual(result.dates[1].seats.map(s => s.personId), ['ann']);
});

test('a declined place reads as empty, not as somebody sitting in it', () => {
    const result = AutoAssign.blank(options({
        existing: { '2026-10-11': [assignment('coffee', 's1', 'ann', 'declined')] },
    }));

    assert.equal(result.dates[1].seats.length, 0);
    assert.equal(result.dates[1].gaps.length, 3);
});

test('leave out still means the date is not touched at all', () => {
    const result = AutoAssign.blank(options({
        choice: AutoAssign.CHOICES.LEAVE_OUT,
        existing: { '2026-10-11': [assignment('coffee', 's1', 'ann')] },
    }));

    const second = result.dates[1];
    assert.equal(second.skipped, true);
    assert.deepEqual(second.seats.map(s => s.personId), ['ann']);
    assert.equal(second.gaps.length, 0, 'a skipped date reports no gaps to fill');
});

test('leaving somebody out empties the place they were sitting in', () => {
    const result = AutoAssign.blank(options({
        existing: { '2026-10-11': [assignment('coffee', 's1', 'ann', 'confirmed')] },
        outOn: date => (date === '2026-10-11' ? ['ann'] : []),
    }));

    const second = result.dates[1];
    assert.equal(second.seats.length, 0);
    assert.equal(second.gaps.length, 3, 'and the place goes back on offer');
});

test('a series carrying no roles gives an empty grid rather than an error', () => {
    const result = AutoAssign.blank(options({ roles: [] }));

    result.dates.forEach(day => {
        assert.equal(day.seats.length, 0);
        assert.equal(day.gaps.length, 0);
    });
});

// ── Through the grid, which is what the editor actually sees ─────────────────

test('the grid draws every place empty, with nothing to explain', () => {
    const roles = [role('coffee', 1), role('setup', 2)];
    const draft = AutoAssign.blank(options({ roles: roles }));

    const grid = Grid.gridFrom({
        dates: draft.dates,
        roles: roles,
        windowSize: 12,
        nameOf: id => id,
        roleNameOf: slug => slug,
        labelOf: date => date,
        loadAt: () => 0,
        recencyAt: () => null,
        warningAt: () => null,
        reasonText: () => 'a reason nothing should have asked for',
        liturgicalAt: () => [],
        oneOffsAt: () => [],
        oneOffPeopleAt: () => [],
    });

    grid.roleRows.forEach(row => {
        row.cells.forEach(cell => {
            cell.places.forEach(place => {
                assert.equal(place.filled, false);
                assert.equal(place.card, null);
                assert.equal(place.reason, null, 'an untried place explains nothing');
            });
        });
    });

    grid.columns.forEach(col => {
        assert.equal(col.empty, 3, 'the strip counts three empty places on every date');
        assert.equal(col.problems, 0);
    });
});
