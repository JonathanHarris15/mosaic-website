const { describe, test, before, beforeEach } = require('node:test');
const assert = require('node:assert');

const H = require('./harness.js');
const writes = require('../../functions/trade-writes.js');
const Core = require('../../public/trade-core.js');

// Cleanup, and being told (MS-190, MS-212), against a real Firestore.
//
// Two triggers, one act. A Trade settles and every other conversation about
// either place is suddenly about something that has moved. An editor fills a
// place and the same is true. Both end those conversations — and both TELL the
// people in them, because an offer that silently stops existing is how somebody
// concludes the app loses what you put into it.
//
// ⚠ THE HALF THAT IS EASY TO GET WRONG IS WHO IS SWEPT. The settlement's own
// two parties are obvious. The one that was missed is a Trade about the place
// coming BACK the other way, between the counterparty and a third person the
// settler has never heard of.

const TODAY = '2026-03-01';

const BOB = 'person-bob';
const SARAH = 'person-sarah';
const RAY = 'person-ray';

const OCC_A = 'occ-2026-03-14';
const OCC_B = 'occ-2026-03-28';
const OCC_C = 'occ-2026-03-21';

const KIDS = {
    occurrenceId: OCC_A, roleSlug: 'kids', slotId: 's1', date: '2026-03-14',
};
const COFFEE = {
    occurrenceId: OCC_B, roleSlug: 'coffee', slotId: 's1', date: '2026-03-28',
};
const SETUP = {
    occurrenceId: OCC_C, roleSlug: 'setup', slotId: 's1', date: '2026-03-21',
};

const rowIdOf = (ref, personId) =>
    [ref.roleSlug, ref.slotId || 'x', personId].join('__');
const coverIdOf = ref =>
    [ref.occurrenceId, ref.roleSlug, ref.slotId || 'one_off'].join('__');

const assignment = (roleSlug, slotId, personId, state) => ({
    roleSlug, slotId, personId, state, stateSetBy: null, stateSetAt: null,
});

const suite = H.skipReason
    ? (name) => test(name, { skip: H.skipReason }, () => {})
    : describe;

suite('what a settlement kills, and who hears about it', () => {
    let db;

    before(() => {
        db = H.connect();
    });

    beforeEach(async () => {
        await H.wipe();

        await Promise.all([BOB, SARAH, RAY].map(id => Promise.all([
            H.seedPerson(db, id),
            db.collection('users').doc('uid-' + id)
                .set({ personId: id, permissionLevel: 'member' }),
        ])));

        await Promise.all(['kids', 'coffee', 'setup'].map(slug =>
            H.seedRole(db, {
                slug: slug, name: slug,
                slots: [{ id: 's1', requirement: 'either' }], restrictions: [],
            })));

        // Bob has declined Kids on the 14th and is asking around.
        // Sarah is confirmed on Coffee on the 28th — the one she would swap.
        // Ray has declined Setup on the 21st and is asking around too.
        await Promise.all([
            H.seedOccurrence(db, {
                id: OCC_A, date: KIDS.date, visibility: 'member',
                name: 'Morning Service',
                roster: [assignment('kids', 's1', BOB, 'declined')],
            }),
            H.seedOccurrence(db, {
                id: OCC_B, date: COFFEE.date, visibility: 'member',
                name: 'Morning Service',
                roster: [assignment('coffee', 's1', SARAH, 'confirmed')],
            }),
            H.seedOccurrence(db, {
                id: OCC_C, date: SETUP.date, visibility: 'member',
                name: 'Morning Service',
                roster: [assignment('setup', 's1', RAY, 'declined')],
            }),
        ]);

        await db.collection('cover').doc(coverIdOf(KIDS)).set({
            occurrenceId: OCC_A, date: KIDS.date, roleSlug: 'kids',
            slotId: 's1', visibility: 'member', eventName: 'Morning Service',
        });
    });

    const invite = (holderId, counterpartyId, ref) => writes.invite(db, {
        actorId: holderId, assignment: ref, counterpartyId: counterpartyId,
        today: TODAY, now: H.now(),
    });

    const tradeById = async id => {
        const snap = await db.collection('trades').doc(id).get();
        return Object.assign({ id: snap.id }, snap.data());
    };

    // Bob invites Sarah, she offers her Coffee, he takes it.
    const settleKidsForCoffee = async () => {
        const one = await invite(BOB, SARAH, KIDS);
        await writes.offer(db, {
            actorId: SARAH, tradeId: one.tradeId, offered: [COFFEE],
            today: TODAY, now: H.now(),
        });
        const done = await writes.accept(db, {
            actorId: BOB, tradeId: one.tradeId, chosen: COFFEE,
            today: TODAY, now: H.now(),
        });
        assert.equal(done.ok, true, done.message);
        return one.tradeId;
    };

    // ── Who caused the ending ────────────────────────────────────────────────

    test('every ending records who caused it, so nobody is told their own news',
        async () => {
            const tradeId = await settleKidsForCoffee();
            const settled = await tradeById(tradeId);

            assert.equal(settled.closedBy, BOB, 'Bob is the one who accepted');
            assert.equal(Core.needsTelling(settled, BOB, TODAY), false);
            assert.equal(Core.needsTelling(settled, SARAH, TODAY), true,
                'Sarah offered and then heard nothing back');
        });

    test('refusing records the refuser, and tells the other one', async () => {
        const one = await invite(BOB, SARAH, KIDS);
        await writes.refuse(db, {
            actorId: SARAH, tradeId: one.tradeId, today: TODAY, now: H.now(),
        });

        const trade = await tradeById(one.tradeId);
        assert.equal(trade.state, Core.STATES.REFUSED);
        assert.equal(trade.closedBy, SARAH);
        assert.equal(Core.needsTelling(trade, SARAH, TODAY), false);
        assert.equal(Core.needsTelling(trade, BOB, TODAY), true);
    });

    // ── What a settlement sweeps ─────────────────────────────────────────────

    test('a competing invitation ends, and the person asked is told why',
        async () => {
            const rays = await invite(BOB, RAY, KIDS);
            await settleKidsForCoffee();

            const dead = await tradeById(rays.tradeId);
            assert.equal(dead.state, Core.STATES.WITHDRAWN);
            assert.equal(dead.closedBecause, Core.CAUSES.SETTLED);
            assert.equal(dead.closedBy, BOB);
            assert.equal(Core.needsTelling(dead, RAY, TODAY), true,
                'Ray was asked, then never told the question had gone');
        });

    // ⚠ THE ONE THAT WAS MISSED. Sarah is giving up her Coffee to Bob — and she
    // had also offered that same Coffee to Ray, in a conversation Bob is not in
    // and cannot see. `partyIds` on it is [Ray, Sarah]; asking only about the
    // HOLDER of the settling Trade never finds it, so it stayed live, pointing
    // at a Saturday that had just changed hands. Ray found out by having his
    // acceptance refused.
    test('a Trade about the place coming back the other way ends too',
        async () => {
            const rays = await writes.offer(db, {
                actorId: SARAH, holderId: RAY, assignment: SETUP,
                offered: [COFFEE], today: TODAY, now: H.now(),
            });
            assert.equal(rays.ok, true, rays.message);

            await settleKidsForCoffee();

            const dead = await tradeById(rays.tradeId);
            assert.equal(dead.state, Core.STATES.WITHDRAWN,
                'Sarah is still offering Ray a Saturday that is now Bob’s');
            assert.equal(dead.closedBecause, Core.CAUSES.SETTLED);
            assert.equal(Core.needsTelling(dead, RAY, TODAY), true);
            assert.equal(Core.needsTelling(dead, SARAH, TODAY), true);
        });

    test('a conversation about something else is left completely alone',
        async () => {
            const elsewhere = await invite(RAY, BOB, SETUP);
            await settleKidsForCoffee();

            const still = await tradeById(elsewhere.tradeId);
            assert.equal(still.state, Core.STATES.INVITED,
                'the sweep took a Trade that named neither place');
        });

    test('the sweep lands in the settlement’s own transaction, not after it',
        async () => {
            // ⚠ NOT A TIMING PREFERENCE. A settled Trade that coexists, even
            // briefly, with a live competitor is a window in which two people
            // can both be told the same place is theirs.
            const rays = await invite(BOB, RAY, KIDS);

            await assert.rejects(writes.accept(H.failsAtCommit(db), {
                actorId: BOB, tradeId: await offerAndReturnId(),
                chosen: COFFEE, today: TODAY, now: H.now(),
            }));

            const untouched = await tradeById(rays.tradeId);
            assert.equal(untouched.state, Core.STATES.INVITED,
                'the cleanup landed even though the settlement did not');
        });

    const offerAndReturnId = async () => {
        const one = await invite(BOB, SARAH, KIDS);
        await writes.offer(db, {
            actorId: SARAH, tradeId: one.tradeId, offered: [COFFEE],
            today: TODAY, now: H.now(),
        });
        return one.tradeId;
    };
});

// ── The editor's backstop ───────────────────────────────────────────────────

suite('an editor filling a place ends every Trade about it', () => {
    let db;

    before(() => {
        db = H.connect();
    });

    beforeEach(async () => {
        await H.wipe();

        await Promise.all([BOB, SARAH, RAY].map(id => Promise.all([
            H.seedPerson(db, id),
            db.collection('users').doc('uid-' + id)
                .set({ personId: id, permissionLevel: 'member' }),
        ])));
        await H.seedRole(db, {
            slug: 'kids', name: 'Kids Ministry',
            slots: [
                { id: 's1', requirement: 'either' },
                { id: 's2', requirement: 'either' },
            ],
            restrictions: [],
        });
        await H.seedOccurrence(db, {
            id: OCC_A, date: KIDS.date, visibility: 'member',
            name: 'Morning Service',
            roster: [
                assignment('kids', 's1', BOB, 'declined'),
                assignment('kids', 's2', RAY, 'declined'),
            ],
        });
    });

    const invite = (counterpartyId, ref) => writes.invite(db, {
        actorId: (ref || KIDS).slotId === 's2' ? RAY : BOB,
        assignment: ref || KIDS, counterpartyId: counterpartyId,
        today: TODAY, now: H.now(),
    });

    const sweep = (over) => writes.sweepAssignment(db, Object.assign({
        occurrenceId: OCC_A, roleSlug: 'kids', slotId: 's1',
        today: TODAY, now: H.now(),
    }, over || {}));

    const tradeById = async id => {
        const snap = await db.collection('trades').doc(id).get();
        return Object.assign({ id: snap.id }, snap.data());
    };

    const rosterDoc = personId => db.collection('event_occurrences')
        .doc(OCC_A).collection('roster').doc(rowIdOf(KIDS, personId));

    test('a replacement ends it, and both people are told', async () => {
        const one = await invite(SARAH);

        // The editor swaps Bob out for Ray from the Roles tab — a delete and a
        // create, exactly as saveRoster writes it.
        await rosterDoc(BOB).delete();
        await rosterDoc(SARAH).set(assignment('kids', 's1', SARAH, 'confirmed'));

        const result = await sweep();
        assert.deepEqual(result.closed.map(c => c.because), [Core.CAUSES.FILLED]);

        const dead = await tradeById(one.tradeId);
        assert.equal(dead.state, Core.STATES.WITHDRAWN);
        assert.equal(dead.closedBecause, Core.CAUSES.FILLED);

        // ⚠ `closedBy` IS NULL, AND BOTH HEAR. Nobody in this conversation
        // ended it — it was ended over their heads — so there is no "you did
        // this" to suppress at either end.
        assert.equal(dead.closedBy, null);
        assert.equal(Core.needsTelling(dead, BOB, TODAY), true);
        assert.equal(Core.needsTelling(dead, SARAH, TODAY), true);
    });

    test('the holder changing their mind ends it, worded as that', async () => {
        const one = await invite(SARAH);
        await rosterDoc(BOB).set(assignment('kids', 's1', BOB, 'confirmed'));

        const result = await sweep();

        assert.deepEqual(result.closed.map(c => c.because), [Core.CAUSES.KEPT]);
        assert.equal((await tradeById(one.tradeId)).closedBecause,
            Core.CAUSES.KEPT);
    });

    test('the place being taken off the Event ends it, worded as that',
        async () => {
            const one = await invite(SARAH);
            await rosterDoc(BOB).delete();

            const result = await sweep();

            assert.deepEqual(result.closed.map(c => c.because),
                [Core.CAUSES.GONE]);
            assert.equal((await tradeById(one.tradeId)).closedBecause,
                Core.CAUSES.GONE);
        });

    test('a place still declined and still theirs ends nothing at all',
        async () => {
            const one = await invite(SARAH);

            const result = await sweep();

            assert.deepEqual(result.closed, [],
                'a `quiet` toggle would have ended every conversation going');
            assert.equal((await tradeById(one.tradeId)).state,
                Core.STATES.INVITED);
        });

    test('the slot next door is not swept with it', async () => {
        const mine = await invite(SARAH);
        const rays = await invite(SARAH, {
            occurrenceId: OCC_A, roleSlug: 'kids', slotId: 's2',
            date: KIDS.date,
        });

        await rosterDoc(BOB).delete();
        await sweep();

        assert.equal((await tradeById(mine.tradeId)).state,
            Core.STATES.WITHDRAWN);
        assert.equal((await tradeById(rays.tradeId)).state,
            Core.STATES.INVITED,
            'the same Role on the same date, and a different place entirely');
    });

    // ⚠ NO SCHEDULED JOB, EVER. The date is the only clock in this feature: a
    // Trade whose Saturday has gone is already dead, so there is nothing here to
    // sweep and nothing to run nightly to find out.
    test('a Trade whose date has passed needs no cleanup', async () => {
        const one = await invite(SARAH);
        await rosterDoc(BOB).delete();

        const result = await sweep({ today: '2026-06-01' });

        assert.deepEqual(result.closed, []);
        assert.equal((await tradeById(one.tradeId)).state, Core.STATES.INVITED,
            'it was rewritten, which means something was scanning the past');
    });

    // ── Clearing a notice ────────────────────────────────────────────────────

    test('clearing is per person — one reader does not clear the other',
        async () => {
            const one = await invite(SARAH);
            await rosterDoc(BOB).delete();
            await sweep();

            const done = await writes.markSeen(db, {
                tradeId: one.tradeId, actorId: SARAH, today: TODAY,
            });
            assert.equal(done.ok, true);

            const trade = await tradeById(one.tradeId);
            assert.deepEqual(trade.seenBy, [SARAH]);
            assert.equal(Core.needsTelling(trade, SARAH, TODAY), false);
            assert.equal(Core.needsTelling(trade, BOB, TODAY), true);
        });

    test('clearing twice is not an error and does not double up', async () => {
        const one = await invite(SARAH);
        await rosterDoc(BOB).delete();
        await sweep();

        await writes.markSeen(db,
            { tradeId: one.tradeId, actorId: SARAH, today: TODAY });
        await writes.markSeen(db,
            { tradeId: one.tradeId, actorId: SARAH, today: TODAY });

        assert.deepEqual((await tradeById(one.tradeId)).seenBy, [SARAH]);
    });

    test('a conversation still going cannot be cleared away', async () => {
        // ⚠ THE HOLE THIS CLOSES. Clearing a LIVE Trade would silence a notice
        // before the thing it is about has happened — and once it ends, the
        // person is already down as having seen it and is never told at all.
        const one = await invite(SARAH);

        const result = await writes.markSeen(db,
            { tradeId: one.tradeId, actorId: SARAH, today: TODAY });

        assert.equal(result.ok, false);
        assert.equal(result.code, 'failed-precondition');
    });

    test('somebody who was never in it cannot clear it', async () => {
        const one = await invite(SARAH);
        await rosterDoc(BOB).delete();
        await sweep();

        const result = await writes.markSeen(db,
            { tradeId: one.tradeId, actorId: RAY, today: TODAY });

        assert.equal(result.ok, false);
        assert.equal(result.code, 'permission-denied');
    });
});
