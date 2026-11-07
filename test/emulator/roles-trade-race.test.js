const { describe, test, before, beforeEach } = require('node:test');
const assert = require('node:assert');
const H = require('./harness.js');
const writes = require('../../functions/trade-writes.js');

/** @typedef {import('firebase-admin/firestore').Firestore} Firestore */
/**
 * What a Trade write hands back: done, or refused and why.
 * @typedef {{ok: boolean, code?: string, reason?: string, tradeId?: string}} Outcome
 */

// MS-813. accept() used to settle from a copy of the Trade read OUTSIDE its
// transaction.
// Here the other party withdraws in the gap between the read and the settle.

const TODAY = '2026-03-01';
const BOB = 'person-bob';
const SARAH = 'person-sarah';
const OCC_A = 'occ-a';
const OCC_B = 'occ-b';
const KIDS = { occurrenceId: OCC_A, roleSlug: 'kids', slotId: 's1', date: '2026-03-14' };
const COFFEE = { occurrenceId: OCC_B, roleSlug: 'coffee', slotId: 's1', date: '2026-03-28' };
/**
 * One Assignment in slot s1, as the roster holds it.
 * @param {string} roleSlug the Role
 * @param {string} personId who holds it
 * @param {string} state pending, confirmed or declined
 * @return {object} the row
 */
const row = (roleSlug, personId, state) => ({ roleSlug, slotId: 's1', personId, state, stateSetBy: null, stateSetAt: null });

const suite = H.skipReason ? /** @type {(name: string, body: () => void) => void} */ ((n) => test(n, { skip: H.skipReason }, () => {})) : describe;

/**
 * A db whose first read of one Trade lets `between` run before it returns.
 * @param {Firestore} db the real handle
 * @param {string} tradeId the Trade whose read is held open
 * @param {() => Promise<void>} between what the other party does
 * @return {Firestore} the wrapped handle
 */
function gapAfterFirstRead(db, tradeId, between) {
    let fired = false;
    return new Proxy(db, { get(target, prop) {
        if (prop !== 'collection') return Reflect.get(target, prop);
        return (/** @type {string} */ name) => {
            const col = target.collection(name);
            if (name !== 'trades') return col;
            return new Proxy(col, { get(c, p) {
                if (p !== 'doc') return Reflect.get(c, p).bind ? Reflect.get(c, p).bind(c) : Reflect.get(c, p);
                return (/** @type {string} */ id) => {
                    const ref = c.doc(id);
                    if (id !== tradeId) return ref;
                    return new Proxy(ref, { get(r, q) {
                        if (q !== 'get') { const v = Reflect.get(r, q); return typeof v === 'function' ? v.bind(r) : v; }
                        return async () => {
                            const snap = await r.get();
                            if (!fired) { fired = true; await between(); }
                            return snap;
                        };
                    } });
                };
            } });
        };
    } });
}

suite('a Trade withdrawn while it is being accepted', () => {
    /** @type {Firestore} */
    let db;
    before(() => { db = /** @type {Firestore} */ (H.connect()); });
    beforeEach(async () => {
        await H.wipe();
        await Promise.all([BOB, SARAH].map(id => Promise.all([H.seedPerson(db, id),
            db.collection('users').doc('uid-' + id).set({ personId: id, accountLevelId: 'level_member' })])));
        await H.seedRole(db, { slug: 'kids', name: 'Kids', slots: [{ id: 's1', requirement: 'either' }], restrictions: [] });
        await H.seedRole(db, { slug: 'coffee', name: 'Coffee', slots: [{ id: 's1', requirement: 'either' }], restrictions: [] });
        await H.seedOccurrence(db, { id: OCC_A, date: KIDS.date, visibility: 'member', roster: [row('kids', BOB, 'declined')] });
        await H.seedOccurrence(db, { id: OCC_B, date: COFFEE.date, visibility: 'member', roster: [row('coffee', SARAH, 'confirmed')] });
    });

    test('is not settled (MS-813)', async () => {
        // Sarah offers her Coffee for Bob's declined Kids place, uninvited.
        const inv = /** @type {Outcome & {tradeId: string}} */ (await writes.offer(db, { actorId: SARAH, assignment: KIDS, holderId: BOB,
            offered: [COFFEE], today: TODAY, now: H.now() }));
        assert.equal(inv.ok, true, JSON.stringify(inv));

        /** @type {?Outcome} */
        let withdrew = /** @type {?Outcome} */ (null);
        const racy = gapAfterFirstRead(db, inv.tradeId, async () => {
            withdrew = /** @type {Outcome} */ (await writes.withdraw(db, { actorId: SARAH, tradeId: inv.tradeId, today: TODAY, now: H.now() }));
        });
        const result = /** @type {Outcome} */ (await writes.accept(racy, { actorId: BOB, tradeId: inv.tradeId, chosen: COFFEE, today: TODAY, now: H.now() }));

        assert.equal(withdrew && withdrew.ok, true, 'the other party could not back out: ' + JSON.stringify(withdrew));
        assert.equal(result.ok, false, 'accepted a Trade the other party had already ended');
        const coffee = /** @type {Array<{personId: string}>} */ (await H.rosterOf(db, OCC_B));
        assert.deepEqual(coffee.map(r => r.personId), [SARAH], 'Sarah lost her Saturday after backing out');
    });
});
