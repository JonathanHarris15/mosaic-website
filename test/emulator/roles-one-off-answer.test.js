const { describe, test, before, beforeEach } = require('node:test');
const assert = require('node:assert');
const H = require('./harness.js');
const writes = require('../../functions/assignment-writes.js');

// MS-818. Every one-off job is `one_off` with no slot, so answering matched
// the first one-off on the Event and wrote it back under an id that ignored the
// one-off's own id.

const suite = H.skipReason ? (n) => test(n, { skip: H.skipReason }, () => {}) : describe;
const OCC = 'occ-one-off';
const ANN = 'person-ann';
const RAY = 'person-ray';
const oneOff = (oneOffId, personId, label) => ({
    roleSlug: 'one_off', slotId: null, oneOffId, label, personId,
    state: 'pending', stateSetBy: null, stateSetAt: null,
});

suite('answering a one-off job', () => {
    let db;
    before(() => { db = H.connect(); });
    beforeEach(async () => {
        await H.wipe();
        await Promise.all([ANN, RAY].map(id => H.seedPerson(db, id)));
        await H.seedOccurrence(db, {
            id: OCC, date: '2026-03-14', visibility: 'member',
            roster: [oneOff('oo1', ANN, 'Chairs'), oneOff('oo2', ANN, 'Sound'), oneOff('oo3', RAY, 'Doors')],
        });
    });

    const say = (personId, oneOffId, state) => writes.answer(db, {
        personId, occurrenceId: OCC, roleSlug: 'one_off', slotId: null, oneOffId,
        state, today: '2026-03-01', now: H.now(),
    });

    test('updates its own row and adds none (MS-818)', async () => {
        assert.equal((await say(ANN, 'oo1', 'confirmed')).ok, true);
        const roster = await H.rosterOf(db, OCC);
        assert.equal(roster.length, 3, 'a second copy was written');
        const byId = Object.fromEntries(roster.map(r => [r.oneOffId, r.state]));
        assert.deepEqual(byId, { oo1: 'confirmed', oo2: 'pending', oo3: 'pending' });
    });

    test('two one-offs for one person are answered separately (MS-818)', async () => {
        assert.equal((await say(ANN, 'oo1', 'confirmed')).ok, true);
        assert.equal((await say(ANN, 'oo2', 'declined')).ok, true);
        const roster = await H.rosterOf(db, OCC);
        const byId = Object.fromEntries(roster.map(r => [r.oneOffId, r.state]));
        assert.deepEqual(byId, { oo1: 'confirmed', oo2: 'declined', oo3: 'pending' });
    });

    test('somebody else\'s one-off is still not yours to answer (MS-818)', async () => {
        const r = await say(ANN, 'oo3', 'confirmed');
        assert.equal(r.ok, false);
        assert.equal(r.code, 'permission-denied');
    });

    test('an older page that sends no one-off id still answers its own (MS-818)', async () => {
        const r = await writes.answer(db, {
            personId: RAY, occurrenceId: OCC, roleSlug: 'one_off', slotId: null,
            state: 'confirmed', today: '2026-03-01', now: H.now(),
        });
        assert.equal(r.ok, true, JSON.stringify(r));
        const roster = await H.rosterOf(db, OCC);
        assert.equal(roster.length, 3);
        assert.equal(roster.find(x => x.oneOffId === 'oo3').state, 'confirmed');
    });
});
