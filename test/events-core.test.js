const { test } = require('node:test');
const assert = require('node:assert');

const Events = require('../public/events-core.js');
const Roles = require('../public/roles-core.js');

// An Event series is a named, recurring thing that carries Roles (ADR-0016 §4).
// The Sunday Service is one LOCKED series: always present, its liturgical Roles
// undeletable.
//
// Scope (MS-13): this is the SERIES layer. Individual Sundays stay where they
// already live — the date-keyed `services` documents. A general per-occurrence
// Event store arrives with the Calendar (MS-99).

const sunday = () => Events.sundayServiceSeries(Roles.LITURGICAL_SLUGS);

// ── The Sunday Service series ─────────────────────────────────────────────────

test('the Sunday Service series is locked and carries every liturgical Role', () => {
    const series = sunday();
    assert.equal(series.id, Events.SUNDAY_SERVICE_ID);
    assert.equal(series.locked, true);
    assert.deepEqual(series.roleSlugs, Roles.LITURGICAL_SLUGS.slice());
});

test('the Sunday Service series is named for what it is', () => {
    assert.equal(sunday().name, 'Sunday Service');
});

test('the Sunday Service series cannot be deleted', () => {
    assert.throws(() => Events.assertSeriesDeletable(sunday()), /locked/i);
});

test('an ordinary series can be deleted', () => {
    const midweek = Events.newSeries({ id: 'midweek', name: 'Midweek Gathering' });
    assert.doesNotThrow(() => Events.assertSeriesDeletable(midweek));
});

// ── Locked Roles cannot be taken off a locked series ──────────────────────────

test('a liturgical Role cannot be removed from the Sunday Service', () => {
    assert.throws(() => Events.removeRole(sunday(), 'preacher'), /cannot be removed/i);
});

test('every liturgical Role is protected, not just the first', () => {
    Roles.LITURGICAL_SLUGS.forEach(slug => {
        assert.throws(() => Events.removeRole(sunday(), slug), /cannot be removed/i, slug);
    });
});

test('a Servant Role added to the Sunday Service CAN be removed again', () => {
    // Locked protects the liturgical Roles, not the series' whole roster —
    // otherwise adding Coffee to Sunday would be a one-way door.
    let series = Events.addRole(sunday(), 'coffee');
    assert.ok(series.roleSlugs.includes('coffee'));

    series = Events.removeRole(series, 'coffee');
    assert.ok(!series.roleSlugs.includes('coffee'));
    assert.deepEqual(series.roleSlugs, Roles.LITURGICAL_SLUGS.slice());
});

// ── A series carries Roles ────────────────────────────────────────────────────

test('a series can carry Servant Roles alongside its liturgical ones', () => {
    const series = Events.addRole(sunday(), 'kids_ministry');
    assert.equal(series.roleSlugs.length, Roles.LITURGICAL_SLUGS.length + 1);
    assert.equal(series.roleSlugs[series.roleSlugs.length - 1], 'kids_ministry');
});

test('adding a Role leaves the original series untouched', () => {
    const before = sunday();
    const count = before.roleSlugs.length;
    Events.addRole(before, 'coffee');
    assert.equal(before.roleSlugs.length, count);
});

test('adding a Role that is already there changes nothing', () => {
    const series = Events.addRole(sunday(), 'preacher');
    assert.deepEqual(series.roleSlugs, Roles.LITURGICAL_SLUGS.slice());
});

test('removing a Role that is not there changes nothing', () => {
    const series = Events.removeRole(Events.newSeries({ id: 'x', name: 'X' }), 'nope');
    assert.deepEqual(series.roleSlugs, []);
});

test('a plain series starts with no Roles and none of them locked', () => {
    const series = Events.newSeries({ id: 'midweek', name: 'Midweek Gathering' });
    assert.deepEqual(series.roleSlugs, []);
    assert.deepEqual(series.lockedRoleSlugs, []);
    assert.equal(series.locked, false);
});

test('a series can be created already carrying Roles', () => {
    const series = Events.newSeries({
        id: 'workday', name: 'Work Day', roleSlugs: ['setup', 'coffee'],
    });
    assert.deepEqual(series.roleSlugs, ['setup', 'coffee']);
});

// ── Validation ────────────────────────────────────────────────────────────────

test('a series needs an id and a name', () => {
    assert.equal(Events.validateSeries(sunday()).valid, true);
    assert.equal(Events.validateSeries({ id: '', name: 'X', roleSlugs: [] }).valid, false);
    assert.equal(Events.validateSeries({ id: 'x', name: '  ', roleSlugs: [] }).valid, false);
});

test('a series may not list the same Role twice', () => {
    const result = Events.validateSeries({
        id: 'x', name: 'X', roleSlugs: ['coffee', 'coffee'], lockedRoleSlugs: [],
    });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => /twice|duplicate/i.test(e)));
});

test('a series may not lock a Role it does not carry', () => {
    const result = Events.validateSeries({
        id: 'x', name: 'X', roleSlugs: ['coffee'], lockedRoleSlugs: ['preacher'],
    });
    assert.equal(result.valid, false);
});

// ── Resolving an occurrence ───────────────────────────────────────────────────

test('a Sunday Service occurrence resolves to the existing services document', () => {
    // The whole point of the scope call: no shadow record, no migration. The
    // Sunday of 2026-08-02 is `services/2026-08-02`, exactly as it is today.
    assert.deepEqual(
        Events.occurrenceRef(sunday(), '2026-08-02'),
        { collection: 'services', id: '2026-08-02' }
    );
});

test('resolving an occurrence never invents an id of its own', () => {
    const ref = Events.occurrenceRef(sunday(), '2026-08-02');
    assert.equal(ref.id, '2026-08-02', 'the date IS the document id');
});

test('a non-Sunday series has no occurrence store yet', () => {
    // Per-occurrence storage for arbitrary Events arrives with the Calendar
    // (MS-99). Returning null says so honestly rather than inventing a path.
    const midweek = Events.newSeries({ id: 'midweek', name: 'Midweek Gathering' });
    assert.equal(Events.occurrenceRef(midweek, '2026-08-05'), null);
});

test('resolving without a date resolves to nothing', () => {
    assert.equal(Events.occurrenceRef(sunday(), null), null);
    assert.equal(Events.occurrenceRef(sunday(), ''), null);
});

// ── No parallel data universe ─────────────────────────────────────────────────

test('the module names no scheduler_ collection', () => {
    const source = require('fs').readFileSync(
        require.resolve('../public/events-core.js'), 'utf8'
    );
    assert.equal(/scheduler_/.test(source), false);
});
