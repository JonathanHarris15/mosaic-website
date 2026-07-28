const { test } = require('node:test');
const assert = require('node:assert');

const Events = require('../public/events-core.js');

// Fairness is counted PER EVENT SERIES (ADR-0016 §5), so an Involvement record
// has to say which series it belonged to. Someone can be overdue for Sunday
// setup and fresh for a midweek Role at the same time — that only works if the
// serve history can be sliced by series.
//
// Every record written before this change is a Sunday Service, so a record with
// no series reads as one. The backfill makes that explicit; the fallback means
// the app is correct before the backfill has run, not after.

const SUNDAY = Events.SUNDAY_SERVICE_ID;

const record = (extra) => Object.assign(
    { serviceDate: '2026-08-02', type: 'preacher' }, extra
);

// ── Reading the series off a record ───────────────────────────────────────────

test('a record states its series', () => {
    assert.equal(Events.seriesIdOf(record({ seriesId: 'midweek' })), 'midweek');
});

test('a record written before the backfill reads as the Sunday Service', () => {
    assert.equal(Events.seriesIdOf(record()), SUNDAY);
});

test('an empty or missing series falls back rather than reading as blank', () => {
    assert.equal(Events.seriesIdOf(record({ seriesId: '' })), SUNDAY);
    assert.equal(Events.seriesIdOf(record({ seriesId: null })), SUNDAY);
    assert.equal(Events.seriesIdOf(null), SUNDAY);
});

// ── Slicing a serve history by series ─────────────────────────────────────────

const history = [
    record({ serviceDate: '2026-07-05', type: 'preacher', seriesId: SUNDAY }),
    record({ serviceDate: '2026-07-12', type: 'setup', seriesId: SUNDAY }),
    record({ serviceDate: '2026-07-15', type: 'setup', seriesId: 'midweek' }),
    record({ serviceDate: '2026-07-19', type: 'preacher' }), // pre-backfill
];

test('a serve history can be filtered to one series', () => {
    assert.deepEqual(
        Events.forSeries(history, SUNDAY).map(r => r.serviceDate),
        ['2026-07-05', '2026-07-12', '2026-07-19']
    );
    assert.deepEqual(
        Events.forSeries(history, 'midweek').map(r => r.serviceDate),
        ['2026-07-15']
    );
});

test('filtering to the Sunday Service sweeps in the un-backfilled records', () => {
    // Otherwise every historic serve would vanish from fairness the moment the
    // series field was introduced, and everyone would read as never-served.
    assert.equal(Events.forSeries(history, SUNDAY).length, 3);
});

test('filtering to a series nobody served yields nothing, not everything', () => {
    assert.deepEqual(Events.forSeries(history, 'workday'), []);
});

test('filtering an absent history is empty rather than a crash', () => {
    assert.deepEqual(Events.forSeries(null, SUNDAY), []);
    assert.deepEqual(Events.forSeries(undefined, SUNDAY), []);
});

test('filtering does not mutate or reorder the history', () => {
    const before = JSON.parse(JSON.stringify(history));
    Events.forSeries(history, SUNDAY);
    assert.deepEqual(history, before);
});

// ── Stamping a write ──────────────────────────────────────────────────────────

test('stamping adds the series without disturbing the rest of the record', () => {
    const stamped = Events.stampSeries({ serviceDate: '2026-08-02', type: 'coffee' }, 'midweek');
    assert.deepEqual(stamped, {
        serviceDate: '2026-08-02', type: 'coffee', seriesId: 'midweek',
    });
});

test('stamping defaults to the Sunday Service', () => {
    assert.equal(Events.stampSeries({ type: 'preacher' }).seriesId, SUNDAY);
});

test('stamping leaves the original untouched', () => {
    const data = { type: 'preacher' };
    Events.stampSeries(data, 'midweek');
    assert.equal(data.seriesId, undefined);
});

test('stamping an already-stamped record re-stamps it rather than duplicating', () => {
    const stamped = Events.stampSeries({ type: 'preacher', seriesId: SUNDAY }, 'midweek');
    assert.equal(stamped.seriesId, 'midweek');
});

// ── The role stays open ───────────────────────────────────────────────────────

test('any role slug is still accepted — the model stays role-open', () => {
    // ADR-0016 §2: Involvement was deliberately kept role-open so Servant Roles
    // need no schema change. Adding the series must not close that.
    const stamped = Events.stampSeries({ type: 'a_role_invented_next_year' }, SUNDAY);
    assert.equal(stamped.type, 'a_role_invented_next_year');
});
