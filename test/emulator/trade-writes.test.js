const { describe, test, before, beforeEach } = require('node:test');
const assert = require('node:assert');

const H = require('./harness.js');
const writes = require('../../functions/trade-writes.js');
const Core = require('../../public/trade-core.js');

// The five moves, against a real Firestore (MS-190, MS-211).
//
// `trade-core` decides; these prove the plumbing under it. Which matters most
// for ACCEPT: it moves two people's roster rows, two occurrences' derived
// fields and a cover entry, and kills every competing Trade — and all of that
// has to land together or not at all. Half of it landing leaves two people
// believing they hold the same Saturday, and the derived fields are what the
// security rules read.
//
// The same bargain as test/emulator/assignment-writes.test.js: a hand-written
// Firestore double would only prove the double agrees with itself.

const TODAY = '2026-03-01';

const BOB = 'person-bob';
const SARAH = 'person-sarah';
const RAY = 'person-ray';
const JEN = 'person-jen';
const KIM = 'person-kim';

const OCC_A = 'occ-2026-03-14';
const OCC_B = 'occ-2026-03-28';

const KIDS = { occurrenceId: OCC_A, roleSlug: 'kids', slotId: 's1', date: '2026-03-14' };
const COFFEE = { occurrenceId: OCC_B, roleSlug: 'coffee', slotId: 's1', date: '2026-03-28' };

const coverIdOf = ref =>
    [ref.occurrenceId, ref.roleSlug, ref.slotId || 'one_off'].join('__');
const rowIdOf = (ref, personId) =>
    [ref.roleSlug, ref.slotId || 'x', personId].join('__');

const assignment = (roleSlug, slotId, personId, state) => ({
    roleSlug, slotId, personId, state, stateSetBy: null, stateSetAt: null,
});

const suite = H.skipReason
    ? (name) => test(name, { skip: H.skipReason }, () => {})
    : describe;

suite('the five ways a Trade moves', () => {
    let db;

    before(() => {
        db = H.connect();
    });

    beforeEach(async () => {
        await H.wipe();

        // JEN and KIM exist only to fill the cap. They still need `users` rows:
        // the rung is asked BEFORE the cap, so an unseeded invitee is refused
        // for being unable to see the Event and the cap is never reached.
        await Promise.all([BOB, SARAH, RAY, JEN, KIM].map(id => Promise.all([
            H.seedPerson(db, id),
            // rankOf reads `users`, because visibility is judged for BOTH
            // parties and only one of them is on the phone.
            db.collection('users').doc('uid-' + id)
                .set({ personId: id, permissionLevel: 'member' }),
        ])));

        await Promise.all([
            H.seedRole(db, {
                slug: 'kids', name: 'Kids Ministry',
                slots: [{ id: 's1', requirement: 'either' }], restrictions: [],
            }),
            H.seedRole(db, {
                slug: 'coffee', name: 'Coffee',
                slots: [{ id: 's1', requirement: 'either' }], restrictions: [],
            }),
        ]);

        // Bob has declined Kids on the 14th. Sarah is confirmed on Coffee on
        // the 28th — the date she would rather give up.
        await H.seedOccurrence(db, {
            id: OCC_A, date: KIDS.date, visibility: 'member',
            name: 'Morning Service',
            roster: [assignment('kids', 's1', BOB, 'declined')],
        });
        await H.seedOccurrence(db, {
            id: OCC_B, date: COFFEE.date, visibility: 'member',
            name: 'Morning Service',
            roster: [assignment('coffee', 's1', SARAH, 'confirmed')],
        });
        await db.collection('cover').doc(coverIdOf(KIDS)).set({
            occurrenceId: OCC_A, date: KIDS.date, roleSlug: 'kids',
            slotId: 's1', visibility: 'member', eventName: 'Morning Service',
        });
    });

    const invite = (counterpartyId, ref) => writes.invite(db, {
        actorId: BOB, assignment: ref || KIDS, counterpartyId,
        eventName: 'Morning Service', roleName: 'Kids Ministry',
        today: TODAY, now: H.now(),
    });

    const tradesNow = async () => {
        const snap = await db.collection('trades').get();
        return snap.docs.map(d => Object.assign({ id: d.id }, d.data()));
    };
    const rosterOf = occId => H.rosterOf(db, occId);

    // ── Inviting ─────────────────────────────────────────────────────────────

    test('inviting somebody writes one Trade, waiting on them', async () => {
        const result = await invite(SARAH);
        assert.equal(result.ok, true);

        const all = await tradesNow();
        assert.equal(all.length, 1);
        assert.equal(all[0].state, Core.STATES.INVITED);
        assert.equal(all[0].origin, Core.ORIGINS.INVITATION);
        assert.equal(all[0].holderId, BOB);
        assert.equal(all[0].counterpartyId, SARAH);
        assert.equal(Core.waitingOn(all[0]), SARAH);
    });

    test('you cannot invite anybody to a place you have not declined', async () => {
        await db.collection('event_occurrences').doc(OCC_A)
            .collection('roster').doc(rowIdOf(KIDS, BOB))
            .set(assignment('kids', 's1', BOB, 'confirmed'));

        const result = await invite(SARAH);

        assert.equal(result.ok, false);
        assert.deepEqual(await tradesNow(), []);
    });

    test('a fourth live invitation is refused, and withdrawing frees a slot',
        async () => {
            const one = await invite(SARAH);
            await invite(RAY);
            await invite(JEN);

            const fourth = await invite(KIM);
            assert.equal(fourth.ok, false);
            assert.equal(fourth.reason, Core.REASONS.CAP_REACHED);

            await writes.withdraw(db, {
                actorId: BOB, tradeId: one.tradeId, today: TODAY, now: H.now(),
            });

            const after = await invite(KIM);
            assert.equal(after.ok, true, 'withdrawing did not free a slot');
        });

    test('nobody else can withdraw an invitation Bob sent', async () => {
        const one = await invite(SARAH);

        const result = await writes.withdraw(db, {
            actorId: SARAH, tradeId: one.tradeId, today: TODAY, now: H.now(),
        });

        assert.equal(result.ok, false);
        const all = await tradesNow();
        assert.equal(all[0].state, Core.STATES.INVITED, 'it was withdrawn anyway');
    });

    // ── Offering ─────────────────────────────────────────────────────────────

    test('the invited person replies with their own Assignment', async () => {
        const one = await invite(SARAH);

        const result = await writes.offer(db, {
            actorId: SARAH, tradeId: one.tradeId, offered: [COFFEE],
            today: TODAY, now: H.now(),
        });

        assert.equal(result.ok, true);
        const all = await tradesNow();
        assert.equal(all[0].state, Core.STATES.OFFERED);
        assert.equal(all[0].offered.length, 1);
        assert.equal(Core.waitingOn(all[0]), BOB, 'it is Bob’s move now');
    });

    test('an uninvited offer must name something — Take already exists',
        async () => {
            const result = await writes.offer(db, {
                actorId: SARAH, assignment: KIDS, holderId: BOB, offered: [],
                today: TODAY, now: H.now(),
            });

            assert.equal(result.ok, false);
            assert.equal(result.reason, Core.REASONS.NOTHING_OFFERED);
            assert.deepEqual(await tradesNow(), []);
        });

    test('an offer naming a date the holder cannot see is refused', async () => {
        // ⚠ THE LEAK THIS CLOSES. Accepting writes you into `participantIds`,
        // which is what grants sight of the Event. So offering Bob a place in
        // an elders-only Event would hand him the elders' diary.
        await H.seedOccurrence(db, {
            id: 'occ-elders', date: '2026-03-21', visibility: 'elder',
            name: 'Elders',
            roster: [assignment('coffee', 's1', SARAH, 'confirmed')],
        });
        const secret = {
            occurrenceId: 'occ-elders', roleSlug: 'coffee', slotId: 's1',
            date: '2026-03-21',
        };

        const result = await writes.offer(db, {
            actorId: SARAH, assignment: KIDS, holderId: BOB, offered: [secret],
            today: TODAY, now: H.now(),
        });

        assert.equal(result.ok, false);
        assert.equal(result.reason, 'notVisible');
        assert.deepEqual(await tradesNow(), []);
    });

    test('somebody cannot be invited to a place they cannot see', async () => {
        await H.seedOccurrence(db, {
            id: 'occ-elders', date: '2026-03-21', visibility: 'elder',
            name: 'Elders',
            roster: [assignment('kids', 's1', BOB, 'declined')],
        });

        const result = await writes.invite(db, {
            actorId: BOB, counterpartyId: SARAH,
            assignment: {
                occurrenceId: 'occ-elders', roleSlug: 'kids', slotId: 's1',
                date: '2026-03-21',
            },
            today: TODAY, now: H.now(),
        });

        assert.equal(result.ok, false);
        assert.deepEqual(await tradesNow(), []);
    });

// ── Quiet or open (MS-213) ───────────────────────────────────────────────
    //
    // ⚠ THE ESCALATION IS WHAT MAKES QUIET SAFE TO OFFER. Somebody who declines
    // quietly, asks the three people they know, and is refused by all three has
    // somewhere to go. Without a way out, choosing quiet would be choosing a
    // dead end, and nobody should be able to pick that by accident.

    test('a quiet place is on nobody’s cover list, and can still be asked about',
        async () => {
            await writes.setReach(db, {
                actorId: BOB, assignment: KIDS, quiet: true,
                today: TODAY, now: H.now(),
            });

            assert.equal(await H.coverOf(db, coverIdOf(KIDS)), null);

            // And the invitation still reaches Sarah, which is the whole point
            // — a quiet place is not a hidden one, it is an unadvertised one.
            const asked = await invite(SARAH);
            assert.equal(asked.ok, true);
        });

    test('a quiet one can be pushed open later, and appears from that moment',
        async () => {
            await writes.setReach(db, {
                actorId: BOB, assignment: KIDS, quiet: true,
                today: TODAY, now: H.now(),
            });
            assert.equal(await H.coverOf(db, coverIdOf(KIDS)), null);

            const result = await writes.setReach(db, {
                actorId: BOB, assignment: KIDS, quiet: false,
                today: TODAY, now: H.now(),
            });

            assert.equal(result.ok, true);
            const entry = await H.coverOf(db, coverIdOf(KIDS));
            assert.ok(entry, 'nobody I asked could help, and I have nowhere to go');
            assert.equal(entry.visibility, 'member',
                'unstamped, the rule makes it readable by nobody');
            assert.equal(entry.roleName, 'Kids Ministry');
        });

    test('only its holder can change who can see it', async () => {
        const result = await writes.setReach(db, {
            actorId: SARAH, assignment: KIDS, quiet: true,
            today: TODAY, now: H.now(),
        });

        assert.equal(result.ok, false);
        assert.ok(await H.coverOf(db, coverIdOf(KIDS)), 'it went quiet anyway');
    });

    test('an open one cannot go quiet under somebody who has already offered',
        async () => {
            // Sarah answered an advertisement in good faith. Withdrawing it out
            // from under her would leave her offer pointing at something she can
            // no longer see.
            await writes.offer(db, {
                actorId: SARAH, assignment: KIDS, holderId: BOB,
                offered: [COFFEE], today: TODAY, now: H.now(),
            });

            const result = await writes.setReach(db, {
                actorId: BOB, assignment: KIDS, quiet: true,
                today: TODAY, now: H.now(),
            });

            assert.equal(result.ok, false);
            assert.ok(await H.coverOf(db, coverIdOf(KIDS)));
        });

    test('an invitation of his own does not stop him going quiet', async () => {
        // He asked THEM. Nobody has answered an advertisement, so there is
        // nothing to pull out from under anybody.
        await invite(SARAH);

        const result = await writes.setReach(db, {
            actorId: BOB, assignment: KIDS, quiet: true,
            today: TODAY, now: H.now(),
        });

        assert.equal(result.ok, true);
        assert.equal(await H.coverOf(db, coverIdOf(KIDS)), null);
    });

    test('a participant-rung place cannot be pushed open at all', async () => {
        // The rung is the church's rule and the member gets no vote on it.
        // "Open" here would advertise to an empty room.
        await H.seedOccurrence(db, {
            id: 'occ-inner', date: '2026-03-21', visibility: 'participant',
            name: 'Small Group',
            roster: [assignment('kids', 's1', BOB, 'declined')],
        });

        const result = await writes.setReach(db, {
            actorId: BOB, quiet: false,
            assignment: { occurrenceId: 'occ-inner', roleSlug: 'kids', slotId: 's1' },
            today: TODAY, now: H.now(),
        });

        assert.equal(result.ok, false);
        assert.equal(
            await H.coverOf(db, 'occ-inner__kids__s1'), null);
    });

    test('a place you have not declined has nothing to open', async () => {
        const result = await writes.setReach(db, {
            actorId: SARAH, assignment: COFFEE, quiet: false,
            today: TODAY, now: H.now(),
        });

        assert.equal(result.ok, false);
        assert.equal(await H.coverOf(db, coverIdOf(COFFEE)), null);
    });

    // ── Settling ─────────────────────────────────────────────────────────────

    test('accepting moves both Assignments, both Confirmed, in one write',
        async () => {
            const one = await invite(SARAH);
            await writes.offer(db, {
                actorId: SARAH, tradeId: one.tradeId, offered: [COFFEE],
                today: TODAY, now: H.now(),
            });

            const result = await writes.accept(db, {
                actorId: BOB, tradeId: one.tradeId, chosen: COFFEE,
                today: TODAY, now: H.now(),
            });

            assert.equal(result.ok, true);

            const kids = await rosterOf(OCC_A);
            assert.equal(kids.length, 1, 'two people are in one slot');
            assert.equal(kids[0].personId, SARAH);
            assert.equal(kids[0].state, 'confirmed',
                'nobody agrees twice to what they just negotiated for');

            const coffee = await rosterOf(OCC_B);
            assert.equal(coffee.length, 1);
            assert.equal(coffee[0].personId, BOB);
            assert.equal(coffee[0].state, 'confirmed');
        });

    test('both occurrences’ derived fields move with it, and the cover entry goes',
        async () => {
            const one = await invite(SARAH);
            await writes.offer(db, {
                actorId: SARAH, tradeId: one.tradeId, offered: [COFFEE],
                today: TODAY, now: H.now(),
            });
            await writes.accept(db, {
                actorId: BOB, tradeId: one.tradeId, chosen: COFFEE,
                today: TODAY, now: H.now(),
            });

            const a = await H.occurrenceOf(db, OCC_A);
            assert.deepEqual(a.participantIds, [SARAH],
                'Bob kept sight of an Event he is no longer on');
            assert.equal(a.needsAttention, false);
            assert.equal(a.outForCover, false);

            const b = await H.occurrenceOf(db, OCC_B);
            assert.deepEqual(b.participantIds, [BOB]);

            assert.equal(await H.coverOf(db, coverIdOf(KIDS)), null,
                'the place is filled and the church is still being asked');
        });

    test('a reply of nothing settles there and then — a take, one way only',
        async () => {
            const one = await invite(SARAH);

            const result = await writes.offer(db, {
                actorId: SARAH, tradeId: one.tradeId, offered: [],
                today: TODAY, now: H.now(),
            });

            assert.equal(result.ok, true);
            assert.equal(result.state, Core.STATES.SETTLED,
                'an empty reply left something for Bob to accept');

            const kids = await rosterOf(OCC_A);
            assert.equal(kids[0].personId, SARAH);
            assert.equal(kids[0].state, 'confirmed');

            // Nothing came back the other way.
            const coffee = await rosterOf(OCC_B);
            assert.equal(coffee[0].personId, SARAH);
        });

    test('settling kills every competing Trade on the same Assignment',
        async () => {
            const mine = await invite(SARAH);
            const theirs = await invite(RAY);

            await writes.offer(db, {
                actorId: SARAH, tradeId: mine.tradeId, offered: [COFFEE],
                today: TODAY, now: H.now(),
            });
            await writes.accept(db, {
                actorId: BOB, tradeId: mine.tradeId, chosen: COFFEE,
                today: TODAY, now: H.now(),
            });

            const all = await tradesNow();
            const rays = all.find(t => t.id === theirs.tradeId);
            assert.equal(rays.state, Core.STATES.WITHDRAWN,
                'Ray is still being asked about a place that has gone');
            assert.equal(rays.closedBecause, 'settled');
        });

    test('accepting something already gone fails plainly and writes nothing',
        async () => {
            const one = await invite(SARAH);
            await writes.offer(db, {
                actorId: SARAH, tradeId: one.tradeId, offered: [COFFEE],
                today: TODAY, now: H.now(),
            });

            // An editor fills the place from the Roles tab in the meantime.
            await db.collection('event_occurrences').doc(OCC_A)
                .collection('roster').doc(rowIdOf(KIDS, BOB)).delete();
            await db.collection('event_occurrences').doc(OCC_A)
                .collection('roster').doc(rowIdOf(KIDS, RAY))
                .set(assignment('kids', 's1', RAY, 'confirmed'));

            const result = await writes.accept(db, {
                actorId: BOB, tradeId: one.tradeId, chosen: COFFEE,
                today: TODAY, now: H.now(),
            });

            assert.equal(result.ok, false);
            assert.equal(result.code, 'aborted');
            assert.equal(result.reason, Core.REASONS.COVERED_MOVED);

            // Sarah's Coffee never moved.
            const coffee = await rosterOf(OCC_B);
            assert.equal(coffee[0].personId, SARAH);
            const all = await tradesNow();
            assert.equal(all[0].state, Core.STATES.OFFERED,
                'the Trade was settled against a place that had gone');
        });

    test('a settlement the Role refuses is refused server-side, and writes nothing',
        async () => {
            // Kids now asks for a woman, and Sarah's record does not say.
            await H.seedRole(db, {
                slug: 'kids', name: 'Kids Ministry',
                slots: [{ id: 's1', requirement: 'female' }], restrictions: [],
            });

            const one = await invite(SARAH);
            await writes.offer(db, {
                actorId: SARAH, tradeId: one.tradeId, offered: [COFFEE],
                today: TODAY, now: H.now(),
            });

            const result = await writes.accept(db, {
                actorId: BOB, tradeId: one.tradeId, chosen: COFFEE,
                today: TODAY, now: H.now(),
            });

            assert.equal(result.ok, false,
                'the congregation just arranged a roster the editor refused');

            const kids = await rosterOf(OCC_A);
            assert.equal(kids[0].personId, BOB, 'it moved anyway');
            const coffee = await rosterOf(OCC_B);
            assert.equal(coffee[0].personId, SARAH);
        });

    test('a failure part-way leaves none of the settlement written', async () => {
        const one = await invite(SARAH);
        await writes.offer(db, {
            actorId: SARAH, tradeId: one.tradeId, offered: [COFFEE],
            today: TODAY, now: H.now(),
        });

        await assert.rejects(
            writes.accept(H.failsAtCommit(db), {
                actorId: BOB, tradeId: one.tradeId, chosen: COFFEE,
                today: TODAY, now: H.now(),
            }),
            /power went out/);

        // Every one of these would be a separate silent bug: a roster row moved
        // without its pair, derived fields describing a roster that never
        // changed, a Trade claiming to have settled nothing.
        const kids = await rosterOf(OCC_A);
        assert.equal(kids[0].personId, BOB);
        const coffee = await rosterOf(OCC_B);
        assert.equal(coffee[0].personId, SARAH);
        assert.ok(await H.coverOf(db, coverIdOf(KIDS)));
        const all = await tradesNow();
        assert.equal(all[0].state, Core.STATES.OFFERED);
    });

    test('two acceptances of the same offered Assignment: one wins', async () => {
        // Sarah offers her Coffee to Bob and to Ray. Both say yes.
        const toBob = await invite(SARAH);
        await writes.offer(db, {
            actorId: SARAH, tradeId: toBob.tradeId, offered: [COFFEE],
            today: TODAY, now: H.now(),
        });

        await H.seedOccurrence(db, {
            id: 'occ-third', date: '2026-03-21', visibility: 'member',
            name: 'Midweek',
            roster: [assignment('kids', 's1', RAY, 'declined')],
        });
        const rays = { occurrenceId: 'occ-third', roleSlug: 'kids', slotId: 's1', date: '2026-03-21' };
        const toRay = await writes.offer(db, {
            actorId: SARAH, assignment: rays, holderId: RAY, offered: [COFFEE],
            today: TODAY, now: H.now(),
        });

        const [first, second] = await Promise.all([
            writes.accept(db, {
                actorId: BOB, tradeId: toBob.tradeId, chosen: COFFEE,
                today: TODAY, now: H.now(),
            }),
            writes.accept(db, {
                actorId: RAY, tradeId: toRay.tradeId, chosen: COFFEE,
                today: TODAY, now: H.now(),
            }),
        ]);

        const won = [first, second].filter(r => r.ok);
        assert.equal(won.length, 1,
            'Sarah gave the same Saturday away twice');

        const coffee = await rosterOf(OCC_B);
        assert.equal(coffee.length, 1);
    });
});
