const { describe, test, before, beforeEach } = require('node:test');
const assert = require('node:assert');
const H = require('./harness.js');
const writes = require('../../functions/assignment-writes.js');

/** @typedef {import('firebase-admin/firestore').Firestore} Firestore */
/**
 * What a write hands back: done, or refused and why.
 * @typedef {{ok: boolean, code?: string, message?: string}} Outcome
 */
/**
 * One roster row as it is stored.
 * @typedef {{id?: string, roleSlug: string, slotId: ?string, oneOffId?: ?string,
 *     personId: string, state: string}} Row
 */

// MS-820. A missing Role definition was judged as a one-off (no rules), and a
// slot removed from its Role threw instead of refusing.

const suite = H.skipReason ? /** @type {(name: string, body: () => void) => void} */ ((n) => test(n, { skip: H.skipReason }, () => {})) : describe;
const OCC = 'occ-gone';
const ANN = 'person-ann';
const SAM = 'person-sam';
/**
 * One Assignment, as the roster holds it.
 * @param {string} roleSlug the Role
 * @param {string} slotId its slot
 * @param {string} personId who holds it
 * @param {string} state pending, confirmed or declined
 * @return {object} the row
 */
const row = (roleSlug, slotId, personId, state) => ({ roleSlug, slotId, personId, state, stateSetBy: null, stateSetAt: null });

suite('taking a place whose Role or slot has gone', () => {
    /** @type {Firestore} */
    let db;
    before(() => { db = /** @type {Firestore} */ (H.connect()); });
    beforeEach(async () => {
        await H.wipe();
        await Promise.all([ANN, SAM].map(id => H.seedPerson(db, id)));
        await db.collection('users').doc('uid-sam').set({ personId: SAM, accountLevelId: 'level_member' });
        await H.seedRole(db, { slug: 'ushers', name: 'Ushers', slots: [{ id: 's1', requirement: 'either' }], restrictions: [] });
        await H.seedOccurrence(db, { id: OCC, date: '2026-03-14', visibility: 'member', roster: [
            row('elders_only', 's1', ANN, 'declined'),
            row('ushers', 's9', ANN, 'declined'),
        ] });
    });

    /**
     * Sam takes a place.
     * @param {string} roleSlug the Role
     * @param {string} slotId its slot
     * @return {Promise<Outcome>} what the write handed back
     */
    const take = (roleSlug, slotId) => /** @type {Promise<Outcome>} */ (writes.take(db, {
        personId: SAM, rank: 'member', roleSlug, slotId,
        occurrenceId: OCC, today: '2026-03-01', now: H.now(),
    }));

    test('a place on a deleted Role is refused (MS-820)', async () => {
        const r = await take('elders_only', 's1');
        assert.equal(r.ok, false, JSON.stringify(r));
        const roster = /** @type {Array<Row>} */ (await H.rosterOf(db, OCC));
        assert.equal(/** @type {Row} */ (roster.find(x => x.roleSlug === 'elders_only')).personId, ANN);
    });

    test('a slot removed from its Role is refused cleanly (MS-820)', async () => {
        const r = await take('ushers', 's9');
        assert.equal(r.ok, false, JSON.stringify(r));
        assert.equal(typeof r.message, 'string');
    });
});
