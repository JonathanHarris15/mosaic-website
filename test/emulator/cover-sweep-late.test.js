const { describe, test, before, beforeEach } = require('node:test');
const assert = require('node:assert');
const H = require('./harness.js');
const writes = require('../../functions/assignment-writes.js');

/** @typedef {import('firebase-admin/firestore').Firestore} Firestore */
/** @typedef {Parameters<typeof writes.answer>[1]} AnswerSpec */
/**
 * What a write hands back: done, or refused and why.
 * @typedef {{ok: boolean, code?: string, message?: string}} Outcome
 */

// MS-819. The cover sweep decided from the trigger's copy of the row, so a
// confirm's trigger delivered after the decline that followed it deleted the
// advertisement that decline had just put up. reconcileCover, which replaced
// the sweep, takes no copy at all: it reads the occurrence and its roster
// again in a transaction, so a late trigger can only ever make the list true.

const suite = H.skipReason ? /** @type {(name: string, body: () => void) => void} */ ((n) => test(n, { skip: H.skipReason }, () => {})) : describe;
const OCC = 'occ-sweep';
const ANN = 'person-ann';
/**
 * Ann's Assignment in Ushers slot s1.
 * @param {string} state pending, confirmed or declined
 * @return {{roleSlug: string, slotId: string, personId: string, state: string,
 *     stateSetBy: null, stateSetAt: null}} the row
 */
const row = (state) => ({ roleSlug: 'ushers', slotId: 's1', personId: ANN, state, stateSetBy: null, stateSetAt: null });

suite('the cover sweep, when its trigger is late', () => {
    /** @type {Firestore} */
    let db;
    before(() => { db = /** @type {Firestore} */ (H.connect()); });
    beforeEach(async () => {
        await H.wipe();
        await H.seedPerson(db, ANN);
        await H.seedRole(db, { slug: 'ushers', name: 'Ushers', slots: [{ id: 's1', requirement: 'either' }], restrictions: [] });
        await H.seedOccurrence(db, { id: OCC, date: '2026-03-14', visibility: 'member', roster: [row('pending')] });
    });

    /**
     * Ann answers her place.
     * @param {string} state confirmed or declined
     * @return {Promise<Outcome>} what the write handed back
     */
    const say = (state) => /** @type {Promise<Outcome>} */ (writes.answer(db, /** @type {AnswerSpec} */ ({ personId: ANN, occurrenceId: OCC, roleSlug: 'ushers', slotId: 's1', state, today: '2026-03-01', now: H.now() })));
    const coverCount = async () => (await db.collection('cover').get()).size;

    test('a stale confirm leaves the live advertisement up (MS-819)', async () => {
        assert.equal((await say('confirmed')).ok, true);
        assert.equal((await say('declined')).ok, true);
        assert.equal(await coverCount(), 1);
        // The confirm's trigger, arriving now, still carrying the confirmed row.
        const changes = await writes.reconcileCover(db, OCC);
        assert.deepStrictEqual(changes.remove, []);
        assert.equal(await coverCount(), 1, 'the decline is no longer advertised');
    });

    test('a place really taken off the roster still loses its entry (MS-819)', async () => {
        assert.equal((await say('declined')).ok, true);
        assert.equal(await coverCount(), 1);
        await db.collection('event_occurrences').doc(OCC).collection('roster').doc(H.rosterIdFor(row('declined'))).delete();
        const changes = await writes.reconcileCover(db, OCC);
        assert.equal(changes.remove.length, 1);
        assert.equal(await coverCount(), 0);
    });

    test('cancelling the date takes the advertisement down; making it elder-only re-stamps it', async () => {
        assert.equal((await say('declined')).ok, true);
        const occ = db.collection('event_occurrences').doc(OCC);
        await occ.update({ visibility: 'elder' });
        await writes.reconcileCover(db, OCC);
        const [entry] = (await db.collection('cover').get()).docs;
        assert.equal(entry.data().visibility, 'elder');
        await occ.update({ cancelled: true });
        await writes.reconcileCover(db, OCC);
        assert.equal(await coverCount(), 0);
    });
});
