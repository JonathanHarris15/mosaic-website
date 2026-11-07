const { describe, test, before, beforeEach } = require('node:test');
const assert = require('node:assert');

const H = require('./harness.js');
const writes = require('../../functions/assignment-writes.js');
const Store = require('../../public/events-store.js');
const Core = require('../../public/events-occurrence-core.js');

/** @typedef {import('firebase-admin/firestore').Firestore} Firestore */
/** @typedef {import('firebase-admin/firestore').DocumentData} DocumentData */
/** @typedef {Parameters<typeof writes.answer>[1]} AnswerSpec */
/**
 * What a write hands back: done, or refused and why.
 * @typedef {{ok: boolean, code?: string, message?: string}} Outcome
 */
/**
 * One roster row as it is stored.
 * @typedef {{id?: string, roleSlug: string, slotId: ?string, oneOffId?: ?string,
 *     personId: string, state: string}} Row
 */

// Stress round on the Roles system (Nov 2026).
//
// The Event page (calendar-event.js) loads a date's roster ONCE and every
// change after that is `persist()`: `saveOccurrence` with the WHOLE in-memory
// roster. A member's answer goes through a transaction on the server. Nothing
// makes the two agree, so an editor who opened the page before the member
// answered writes the member's old state straight back over their answer.

const TODAY = '2026-03-01';
const OCC = 'occ-stress';
const ANN = 'person-ann';
const RAY = 'person-ray';

/**
 * One Assignment, as the roster holds it.
 * @param {string} roleSlug the Role
 * @param {string} slotId its slot
 * @param {string} personId who holds it
 * @param {string} state pending, confirmed or declined
 * @return {object} the row
 */
const assignment = (roleSlug, slotId, personId, state) => ({
    roleSlug, slotId, personId, state, stateSetBy: null, stateSetAt: null,
});

const suite = H.skipReason
    ? /** @type {(name: string, body: () => void) => void} */ ((name) => test(name, { skip: H.skipReason }, () => {}))
    : describe;

suite('an editor page left open does not undo a member', () => {
    /** @type {Firestore} */
    let db;
    before(() => { db = /** @type {Firestore} */ (H.connect()); });

    beforeEach(async () => {
        await H.wipe();
        await Promise.all([ANN, RAY].map(id => H.seedPerson(db, id)));
        await H.seedRole(db, {
            slug: 'ushers', name: 'Ushers',
            slots: [{ id: 's1', requirement: 'either' }, { id: 's2', requirement: 'either' }],
            restrictions: [],
        });
        await H.seedOccurrence(db, {
            id: OCC, date: '2026-03-14', visibility: 'member',
            roster: [assignment('ushers', 's1', ANN, 'pending')],
        });
    });

    test('a decline made while the Event page was open survives the editor\'s next save (MS-812)', async () => {
        // 1. The editor opens the date.
        const page = await Store.loadOccurrence(db, OCC);
        assert.equal(page.assignments.find((/** @type {Row} */ a) => a.personId === ANN).state, 'pending');

        // 2. Ann declines from her phone.
        const answered = /** @type {Outcome} */ (await writes.answer(db, /** @type {AnswerSpec} */ ({
            personId: ANN, roleSlug: 'ushers', slotId: 's1',
            occurrenceId: OCC, state: 'declined', today: TODAY, now: H.now(),
        })));
        assert.equal(answered.ok, true);

        // 3. The editor, still on the page, fills the OTHER slot.
        const next = Core.assignToSlot(page.assignments,
            { roleSlug: 'ushers', slotId: 's2', personId: RAY },
            { actorUid: 'uid-editor', at: new Date().toISOString() });
        await Store.saveOccurrence(db, Object.assign({}, page, { assignments: next }),
            { loaded: page.assignments });

        // Ann's no must still be a no.
        const roster = /** @type {Array<Row>} */ (await H.rosterOf(db, OCC));
        assert.equal(/** @type {Row} */ (roster.find(r => r.personId === ANN)).state, 'declined',
            'the editor\'s save wrote Ann back to pending');
        const occ = /** @type {DocumentData} */ ((await db.collection('event_occurrences').doc(OCC).get()).data());
        assert.equal(occ.needsAttention, true, 'the declined flag was wiped');
    });

    test('somebody who took the place from the cover list keeps it after the editor saves (MS-812)', async () => {
        await H.seedPerson(db, 'person-sam');
        await db.collection('users').doc('uid-sam')
            .set({ personId: 'person-sam', accountLevelId: 'level_member' });

        const page = await Store.loadOccurrence(db, OCC);

        assert.equal(/** @type {Outcome} */ (await writes.answer(db, /** @type {AnswerSpec} */ ({
            personId: ANN, roleSlug: 'ushers', slotId: 's1',
            occurrenceId: OCC, state: 'declined', today: TODAY, now: H.now(),
        }))).ok, true);
        const took = /** @type {Outcome} */ (await writes.take(db, {
            personId: 'person-sam', rank: 'member', roleSlug: 'ushers', slotId: 's1',
            occurrenceId: OCC, today: TODAY, now: H.now(),
        }));
        assert.equal(took.ok, true, JSON.stringify(took));

        const next = Core.assignToSlot(page.assignments,
            { roleSlug: 'ushers', slotId: 's2', personId: RAY },
            { actorUid: 'uid-editor', at: new Date().toISOString() });
        await Store.saveOccurrence(db, Object.assign({}, page, { assignments: next }),
            { loaded: page.assignments });

        const roster = /** @type {Array<Row>} */ (await H.rosterOf(db, OCC));
        const s1 = roster.filter(r => r.slotId === 's1').map(r => r.personId);
        assert.deepEqual(s1, ['person-sam'], 'slot s1 now holds ' + JSON.stringify(s1));
    });

    test('an editor change to a row somebody answered since is refused, not applied (MS-812)', async () => {
        const page = await Store.loadOccurrence(db, OCC);
        assert.equal(/** @type {Outcome} */ (await writes.answer(db, /** @type {AnswerSpec} */ ({
            personId: ANN, roleSlug: 'ushers', slotId: 's1',
            occurrenceId: OCC, state: 'declined', today: TODAY, now: H.now(),
        }))).ok, true);

        // The editor, not having seen the decline, swaps Ray in for Ann.
        const next = Core.assignToSlot(Core.clearSlot(page.assignments, 'ushers', 's1'),
            { roleSlug: 'ushers', slotId: 's1', personId: RAY },
            { actorUid: 'uid-editor', at: new Date().toISOString() });
        await assert.rejects(
            Store.saveOccurrence(db, Object.assign({}, page, { assignments: next }),
                { loaded: page.assignments }),
            e => /** @type {{code?: string}} */ (e).code === 'roster-changed');

        const roster = /** @type {Array<Row>} */ (await H.rosterOf(db, OCC));
        assert.deepEqual(roster.map(r => [r.personId, r.state]), [[ANN, 'declined']]);
    });

    test('the derived fields describe the stored roster after a save (MS-812)', async () => {
        const page = await Store.loadOccurrence(db, OCC);
        assert.equal(/** @type {Outcome} */ (await writes.answer(db, /** @type {AnswerSpec} */ ({
            personId: ANN, roleSlug: 'ushers', slotId: 's1',
            occurrenceId: OCC, state: 'declined', today: TODAY, now: H.now(),
        }))).ok, true);
        const next = Core.assignToSlot(page.assignments,
            { roleSlug: 'ushers', slotId: 's2', personId: RAY },
            { actorUid: 'uid-editor', at: new Date().toISOString() });
        const saved = await Store.saveOccurrence(db, Object.assign({}, page, { assignments: next }),
            { loaded: page.assignments });

        const occ = /** @type {DocumentData} */ ((await db.collection('event_occurrences').doc(OCC).get()).data());
        assert.deepEqual(occ.participantIds.slice().sort(), [ANN, RAY].sort());
        assert.equal(saved.assignments.find((/** @type {Row} */ a) => a.personId === ANN).state, 'declined');
    });

    test('a quiet decline cannot be taken by somebody nobody asked (MS-817)', async () => {
        await H.seedPerson(db, 'person-sam');
        await db.collection('users').doc('uid-sam')
            .set({ personId: 'person-sam', accountLevelId: 'level_member' });

        assert.equal(/** @type {Outcome} */ (await writes.answer(db, /** @type {AnswerSpec & {quiet: boolean}} */ ({
            personId: ANN, roleSlug: 'ushers', slotId: 's1', quiet: true,
            occurrenceId: OCC, state: 'declined', today: TODAY, now: H.now(),
        }))).ok, true);
        const cover = await db.collection('cover').get();
        assert.equal(cover.size, 0, 'a quiet decline is not advertised');

        // Sam never saw it on the list; they call the callable with ids he can
        // guess (occurrence ids are {series}_{date}, slugs are world-readable).
        const took = /** @type {Outcome} */ (await writes.take(db, {
            personId: 'person-sam', rank: 'member', roleSlug: 'ushers', slotId: 's1',
            occurrenceId: OCC, today: TODAY, now: H.now(),
        }));
        assert.equal(took.ok, false, 'Sam took a place that was never offered to them');
    });
});
