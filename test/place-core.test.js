const { test } = require('node:test');
const assert = require('node:assert');

// PlaceCore — one place on an Event, said once. Every door that touches a
// place (answer, take, trade, cover, nudge) reads its identity from here.

const Place = require('../public/place-core.js');
const Trade = require('../public/trade-core.js');

const oneOff = (oneOffId, extra) => Object.assign({ roleSlug: 'one_off', slotId: null, oneOffId, personId: 'p1' }, extra || {});

test('two one-offs on one Event are two places, with two cover entries and two roster rows', () => {
    assert.equal(Place.samePlace(oneOff('setup'), { roleSlug: 'one_off', oneOffId: 'teardown' }), false);
    assert.notEqual(Place.coverIdFor('o1', oneOff('setup')), Place.coverIdFor('o1', oneOff('teardown')));
    assert.notEqual(Place.rosterIdFor(oneOff('setup')), Place.rosterIdFor(oneOff('teardown')));
    assert.notEqual(Place.placeKey(Object.assign({ occurrenceId: 'o1' }, oneOff('setup'))),
        Place.placeKey(Object.assign({ occurrenceId: 'o1' }, oneOff('teardown'))));
});

test('a caller that sends no one-off id still finds a one-off, as it always could', () => {
    assert.equal(Place.samePlace(oneOff('setup'), { roleSlug: 'one_off', slotId: null }), true);
});

test('a managed Role ignores a one-off id it should not have been sent', () => {
    const p = Place.placeOf({ occurrenceId: 'o1', roleSlug: 'coffee', slotId: 's1', oneOffId: 'junk' });
    assert.equal(p.oneOffId, null);
    assert.equal(Place.coverIdFor('o1', p), 'o1__coffee__s1', 'unchanged from the id every stored entry has');
});

test('a one-off without its own id keeps the old cover id, so a reconcile can find and replace it', () => {
    assert.equal(Place.coverIdFor('o1', { roleSlug: 'one_off', slotId: null }), 'o1__one_off__one_off');
});

test('the Trade key and the place key are one string', () => {
    const refs = [
        { occurrenceId: 'o1', roleSlug: 'coffee', slotId: 's1' },
        { occurrenceId: 'o1', roleSlug: 'coffee', slotId: null },
        { occurrenceId: 'o1', roleSlug: 'one_off', slotId: null, oneOffId: 'setup' },
        { occurrenceId: 'o1', roleSlug: 'one_off', slotId: null },
        { occurrenceId: 'o1', roleSlug: 'coffee', slotId: 's1', oneOffId: 'ignored' },
    ];
    refs.forEach(r => assert.equal(Trade.assignmentKey(r), Place.placeKey(r), JSON.stringify(r)));
});

test('a Trade written before one-offs had ids still means the one-off it was about', () => {
    assert.equal(Trade.sameAssignment(
        { occurrenceId: 'o1', roleSlug: 'one_off', slotId: null },
        { occurrenceId: 'o1', roleSlug: 'one_off', slotId: null, oneOffId: 'setup' }), true);
    assert.equal(Trade.sameAssignment(
        { occurrenceId: 'o1', roleSlug: 'one_off', oneOffId: 'teardown' },
        { occurrenceId: 'o1', roleSlug: 'one_off', oneOffId: 'setup' }), false);
});

// ── The cover list as a derived view ─────────────────────────────────────────

const OCC = { id: 'o1', date: '2026-08-16', seriesId: 'midweek', name: 'Midweek', visibility: 'member' };
const declined = (extra) => Object.assign({ roleSlug: 'coffee', slotId: 's1', personId: 'p1', state: 'declined' }, extra || {});

test('only a declined, open place on a happening, coverable Event is listed', () => {
    assert.equal(Place.isListed(OCC, declined()), true);
    assert.equal(Place.isListed(OCC, declined({ quiet: true })), false);
    assert.equal(Place.isListed(OCC, declined({ state: 'confirmed' })), false);
    assert.equal(Place.isListed(Object.assign({}, OCC, { visibility: 'participant' }), declined()), false);
    assert.equal(Place.isListed(Object.assign({}, OCC, { cancelled: true }), declined()), false);
    assert.equal(Place.isListed(Object.assign({}, OCC, { movedTo: '2026-08-23' }), declined()), false);
});

test('the desired list names the Role, never the person, and carries the rung', () => {
    const desired = Place.desiredCover(OCC, [declined()], slug => (slug === 'coffee' ? 'Coffee' : null));
    const entry = desired['o1__coffee__s1'];
    assert.equal(entry.roleName, 'Coffee');
    assert.equal(entry.visibility, 'member');
    assert.equal(entry.personId, undefined);
});

test('the changes are only what differs, so a list already right writes nothing', () => {
    const desired = Place.desiredCover(OCC, [declined()], () => 'Coffee');
    const stored = Object.keys(desired).map(id => ({ id, data: JSON.parse(JSON.stringify(desired[id])) }));
    assert.deepStrictEqual(Place.coverChanges(stored, desired), { set: [], remove: [] });
    const stale = stored.concat([{ id: 'o1__setup__s1', data: {} }]);
    assert.deepStrictEqual(Place.coverChanges(stale, desired).remove, ['o1__setup__s1']);
    const restamped = Place.desiredCover(Object.assign({}, OCC, { visibility: 'elder' }), [declined()], () => 'Coffee');
    assert.equal(Place.coverChanges(stored, restamped).set.length, 1);
});
