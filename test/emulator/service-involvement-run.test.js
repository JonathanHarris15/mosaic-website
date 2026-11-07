const { describe, test, before, beforeEach } = require('node:test');
const assert = require('node:assert');
const H = require('./harness.js');
const run = require('../../functions/service-involvement-run.js');

/** @typedef {import('firebase-admin/firestore').Firestore} Firestore */
/** @typedef {import('firebase-admin/firestore').DocumentData} DocumentData */

// MS-815. One Person deleted after going on the booklet stopped the nightly
// conversion for every Sunday after it, every night.

const suite = H.skipReason ? /** @type {(name: string, body: () => void) => void} */ ((n) => test(n, { skip: H.skipReason }, () => {})) : describe;
const TODAY = '2026-03-10';

suite('the nightly Sunday conversion', () => {
    /** @type {Firestore} */
    let db;
    /** @type {typeof import('firebase-admin/firestore').FieldValue} */
    let FieldValue;
    before(() => { db = /** @type {Firestore} */ (H.connect()); FieldValue = require('firebase-admin').firestore.FieldValue; });
    beforeEach(async () => {
        await H.wipe();
        await H.seedPerson(db, 'p-preacher', { totalInvolvements: 2 });
        await H.seedPerson(db, 'p-leader', { totalInvolvements: 0 });
        // p-gone was on the booklet and has since been deleted.
        await db.collection('services').doc('2026-03-01').set({
            involvementDeferred: true, preacherId: 'p-preacher', serviceLeaderId: 'p-gone',
        });
        await db.collection('services').doc('2026-03-08').set({
            involvementDeferred: true, serviceLeaderId: 'p-leader',
        });
    });

    const flagged = async () => (await db.collection('services').where('involvementDeferred', '==', true).get()).docs;

    test('a deleted Person does not stop the run (MS-815)', async () => {
        /** @type {string[]} */
        const logs = [];
        const r = await run.payAll(db, await flagged(), TODAY, FieldValue, (/** @type {string} */ m) => logs.push(m));
        assert.deepEqual(r.failed, []);
        assert.equal(r.converted, 2);
        assert.equal(r.written, 2);

        const preacher = /** @type {DocumentData} */ ((await db.collection('people').doc('p-preacher').get()).data());
        const leader = /** @type {DocumentData} */ ((await db.collection('people').doc('p-leader').get()).data());
        assert.equal(preacher.totalInvolvements, 3);
        assert.equal(leader.totalInvolvements, 1);
        assert.equal((await flagged()).length, 0, 'both Sundays are settled');
        assert.ok(logs.some(m => m.includes('no longer exist')), logs.join('\n'));
    });

    test('nothing is written for the deleted Person (MS-815)', async () => {
        await run.payAll(db, await flagged(), TODAY, FieldValue, () => {});
        assert.equal((await db.collection('people').doc('p-gone').get()).exists, false);
        const orphans = await db.collection('people').doc('p-gone').collection('involvement').get();
        assert.equal(orphans.size, 0);
    });

    test('one Sunday that throws is logged and the rest still convert (MS-815)', async () => {
        const docs = await flagged();
        const broken = Object.create(docs[0]);
        broken.data = () => { throw new Error('unreadable'); };
        Object.defineProperty(broken, 'id', { value: docs[0].id });
        /** @type {string[]} */
        const logs = [];
        const r = await run.payAll(db, [broken, docs[1]], TODAY, FieldValue, (/** @type {string} */ m) => logs.push(m));
        assert.deepEqual(r.failed, [docs[0].id]);
        assert.equal(r.converted, 1);
        assert.equal(/** @type {DocumentData} */ ((await db.collection('people').doc('p-leader').get()).data()).totalInvolvements, 1);
    });
});
