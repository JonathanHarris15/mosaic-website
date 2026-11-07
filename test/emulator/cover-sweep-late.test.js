const { describe, test, before, beforeEach } = require('node:test');
const assert = require('node:assert');
const H = require('./harness.js');
const writes = require('../../functions/assignment-writes.js');

// MS-819. The cover sweep decided from the trigger's copy of the row, so a
// confirm's trigger delivered after the decline that followed it deleted the
// advertisement that decline had just put up.

const suite = H.skipReason ? (n) => test(n, { skip: H.skipReason }, () => {}) : describe;
const OCC = 'occ-sweep';
const ANN = 'person-ann';
const row = (state) => ({ roleSlug: 'ushers', slotId: 's1', personId: ANN, state, stateSetBy: null, stateSetAt: null });
const place = { occurrenceId: OCC, roleSlug: 'ushers', slotId: 's1' };

suite('the cover sweep, when its trigger is late', () => {
    let db;
    before(() => { db = H.connect(); });
    beforeEach(async () => {
        await H.wipe();
        await H.seedPerson(db, ANN);
        await H.seedRole(db, { slug: 'ushers', name: 'Ushers', slots: [{ id: 's1', requirement: 'either' }], restrictions: [] });
        await H.seedOccurrence(db, { id: OCC, date: '2026-03-14', visibility: 'member', roster: [row('pending')] });
    });

    const say = (state) => writes.answer(db, { personId: ANN, occurrenceId: OCC, roleSlug: 'ushers', slotId: 's1', state, today: '2026-03-01', now: H.now() });
    const coverCount = async () => (await db.collection('cover').get()).size;

    test('a stale confirm leaves the live advertisement up (MS-819)', async () => {
        assert.equal((await say('confirmed')).ok, true);
        assert.equal((await say('declined')).ok, true);
        assert.equal(await coverCount(), 1);
        // The confirm's trigger, arriving now, still carrying the confirmed row.
        const cleared = await writes.sweepCover(db, Object.assign({ row: row('confirmed') }, place));
        assert.equal(cleared, false);
        assert.equal(await coverCount(), 1, 'the decline is no longer advertised');
    });

    test('a place really taken off the roster still loses its entry (MS-819)', async () => {
        assert.equal((await say('declined')).ok, true);
        assert.equal(await coverCount(), 1);
        await db.collection('event_occurrences').doc(OCC).collection('roster').doc(H.rosterIdFor(row('declined'))).delete();
        const cleared = await writes.sweepCover(db, Object.assign({ row: null }, place));
        assert.equal(cleared, true);
        assert.equal(await coverCount(), 0);
    });
});
