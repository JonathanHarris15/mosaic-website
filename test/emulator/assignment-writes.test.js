const { describe, test, before, beforeEach } = require('node:test');
const assert = require('node:assert');

const H = require('./harness.js');
const writes = require('../../functions/assignment-writes.js');

// The plumbing under answering and taking (MS-20, MS-217).
//
// ⚠ WHAT THESE PROVE THAT THE UNIT TESTS CANNOT.
//
// Both callables split the same way: every DECISION is in a pure module
// (assignment-answer.js, assignment-take.js) with heavy unit tests, and the
// FIRESTORE WORK is here. Until now the decisions were well guarded and the
// writes were not guarded at all — the wrong way round, because a rule that
// breaks throws and a transaction that half-lands is silent.
//
// Three claims are made in the comments of those files and were, until this
// suite, only claims:
//
//   1. The roster row, the occurrence's derived fields and the cover entry land
//      TOGETHER or not at all. Half-landed, the derived fields disagree with the
//      roster they describe — and those are the fields the security rules read,
//      so the drift is not cosmetic.
//
//   2. A place changing hands is a DELETE plus a CREATE, because the row's id
//      carries the personId. A missed delete leaves two people standing in one
//      slot, with participantIds honestly listing both.
//
//   3. A genuine race makes exactly one caller lose. planTake returning
//      `aborted` is unit-tested; that the transaction actually re-reads and
//      retries around it is not, and that was the whole point of extracting the
//      decision in the first place.
//
// None of the three can be checked against a fake. A hand-written Firestore
// double would only prove the double agrees with itself.

const TODAY = '2026-01-01';
const DATE = '2026-03-15';
const OCC = 'occ-morning-2026-03-15';

const ANN = 'person-ann';
const BEN = 'person-ben';
const CARA = 'person-cara';
const DAVE = 'person-dave';

const USHERS = 'ushers';
const S1 = 'slot-1';
const S2 = 'slot-2';

const COVER_S1 = [OCC, USHERS, S1].join('__');
const ROW = (personId, slotId) => [USHERS, slotId, personId].join('__');

const assignment = (personId, slotId, state) => ({
    personId, slotId, state,
    roleSlug: USHERS,
    stateSetBy: null,
    stateSetAt: null,
});

// Without an emulator this is ONE skipped test, not sixteen cancelled ones —
// node:test reports a skipped suite's children as failures, which would make a
// plain `npm test` red on any machine that has no Java.
const suite = H.skipReason
    ? (name) => test(name, { skip: H.skipReason }, () => {})
    : describe;

suite('the writes under answering and taking', () => {
    let db;

    before(() => {
        db = H.connect();
    });

    beforeEach(async () => {
        await H.wipe();
        await Promise.all([
            H.seedPerson(db, ANN),
            H.seedPerson(db, BEN),
            H.seedPerson(db, CARA),
            H.seedPerson(db, DAVE),
            H.seedRole(db, {
                slug: USHERS,
                name: 'Ushers',
                slots: [
                    { id: S1, requirement: 'either' },
                    { id: S2, requirement: 'either' },
                ],
                restrictions: [],
            }),
        ]);
        await H.seedOccurrence(db, {
            id: OCC,
            date: DATE,
            visibility: 'member',
            name: 'Morning Service',
            roster: [
                assignment(ANN, S1, 'pending'),
                assignment(BEN, S2, 'confirmed'),
            ],
        });
    });

    const decline = (personId, slotId) => writes.answer(db, {
        personId, roleSlug: USHERS, slotId,
        occurrenceId: OCC, state: 'declined', today: TODAY, now: H.now(),
    });

    const confirm = (personId, slotId) => writes.answer(db, {
        personId, roleSlug: USHERS, slotId,
        occurrenceId: OCC, state: 'confirmed', today: TODAY, now: H.now(),
    });

    const take = (personId, slotId, handle) =>
        writes.take(handle || db, {
            personId, rank: 'member', roleSlug: USHERS, slotId,
            occurrenceId: OCC, today: TODAY, now: H.now(),
        });

    // ── Declining ────────────────────────────────────────────────────────────

    test('declining writes the roster row, the derived fields and the ' +
        'cover entry', async () => {
        const result = await decline(ANN, S1);
        assert.equal(result.ok, true);

        const roster = await H.rosterOf(db, OCC);
        const ann = roster.find(r => r.personId === ANN);
        assert.equal(ann.state, 'declined');
        assert.equal(ann.stateSetBy, ANN);
        assert.ok(ann.stateSetAt, 'the answer was not stamped with a time');

        const occ = await H.occurrenceOf(db, OCC);
        assert.equal(occ.needsAttention, true);
        assert.equal(occ.outForCover, true,
            'a member-rung Event CAN be covered, so somebody is out looking');
        // ⚠ A DECLINER STAYS a participant. They keep sight of the Event until
        // somebody else takes the slot, so they can watch it get covered and
        // change their mind (ADR-0018 §5).
        assert.deepEqual(occ.participantIds.sort(), [ANN, BEN].sort());

        const cover = await H.coverOf(db, COVER_S1);
        assert.ok(cover, 'the place never reached the cover list');
        assert.equal(cover.occurrenceId, OCC);
        assert.equal(cover.date, DATE);
        assert.equal(cover.roleSlug, USHERS);
        assert.equal(cover.slotId, S1);
        assert.equal(cover.visibility, 'member',
            'unstamped, the security rule makes it readable by nobody');
        // The list says "this place needs somebody" and nothing about who let
        // it go — the callable that hands it over reads the roster server-side,
        // where it has no such limit.
        assert.ok(!Object.values(cover).includes(ANN),
            'the cover entry names the person who declined');
    });

    test('a failure part-way leaves none of the three written', async () => {
        await assert.rejects(
            writes.answer(H.failsAtCommit(db), {
                personId: ANN, roleSlug: USHERS, slotId: S1,
                occurrenceId: OCC, state: 'declined',
                today: TODAY, now: H.now(),
            }),
            /power went out/);

        // Every one of these would be a separate silent bug. The roster row
        // landing alone leaves a declined Assignment nobody is told about; the
        // derived fields landing alone leave an Event flagged for attention with
        // nothing wrong on it; the cover entry landing alone advertises a place
        // its own roster says is filled.
        const roster = await H.rosterOf(db, OCC);
        assert.equal(roster.find(r => r.personId === ANN).state, 'pending');

        const occ = await H.occurrenceOf(db, OCC);
        assert.equal(occ.needsAttention, false);
        assert.equal(occ.outForCover, false);

        assert.equal(await H.coverOf(db, COVER_S1), null);
    });

    test('confirming a declined Assignment takes it off the cover list in ' +
        'the same write', async () => {
        await decline(ANN, S1);
        assert.ok(await H.coverOf(db, COVER_S1));

        const result = await confirm(ANN, S1);
        assert.equal(result.ok, true);

        assert.equal(await H.coverOf(db, COVER_S1), null,
            'the place is filled but the church is still being asked to fill it');
        const occ = await H.occurrenceOf(db, OCC);
        assert.equal(occ.needsAttention, false);
        assert.equal(occ.outForCover, false);

        const roster = await H.rosterOf(db, OCC);
        assert.equal(roster.find(r => r.personId === ANN).state, 'confirmed');
    });

    test('answering somebody else’s Assignment is refused, and writes ' +
        'nothing', async () => {
        const result = await writes.answer(db, {
            personId: BEN, roleSlug: USHERS, slotId: S1,
            occurrenceId: OCC, state: 'declined', today: TODAY, now: H.now(),
        });

        assert.equal(result.ok, false);
        assert.equal(result.code, 'permission-denied');

        const roster = await H.rosterOf(db, OCC);
        assert.equal(roster.find(r => r.personId === ANN).state, 'pending');
        assert.equal(roster.length, 2, 'Ben was written into Ann’s slot');
        assert.equal(await H.coverOf(db, COVER_S1), null);
    });

    // ── Taking ───────────────────────────────────────────────────────────────

    test('taking a place deletes the previous holder’s row and creates the ' +
        'new one', async () => {
        await decline(ANN, S1);

        const result = await take(CARA, S1);
        assert.equal(result.ok, true);

        const roster = await H.rosterOf(db, OCC);
        const inSlot = roster.filter(r => r.roleSlug === USHERS && r.slotId === S1);

        // ⚠ THE ROW'S ID CARRIES THE personId, so this is a delete plus a
        // create. Treated as an update, both rows survive and two people are
        // standing in one slot.
        assert.equal(inSlot.length, 1,
            'two people are now down for the same place');
        assert.equal(inSlot[0].personId, CARA);
        assert.equal(inSlot[0].id, ROW(CARA, S1));
        assert.equal(inSlot[0].state, 'confirmed',
            'somebody who volunteered does not then need to confirm');
        assert.equal(roster.find(r => r.id === ROW(ANN, S1)), undefined);
    });

    test('taking a place swaps the participants in the same write', async () => {
        await decline(ANN, S1);
        await take(CARA, S1);

        const occ = await H.occurrenceOf(db, OCC);
        assert.deepEqual(occ.participantIds.sort(), [BEN, CARA].sort(),
            'Ann kept sight of an Event she is no longer on');
        assert.equal(occ.needsAttention, false);
        assert.equal(occ.outForCover, false);
        assert.equal(await H.coverOf(db, COVER_S1), null);
    });

    test('two people taking the same place at once — one wins, one is told ' +
        'plainly', async () => {
        await decline(ANN, S1);

        const [first, second] = await Promise.all([
            take(CARA, S1),
            take(DAVE, S1),
        ]);

        const won = [first, second].filter(r => r.ok);
        const lost = [first, second].filter(r => !r.ok);
        assert.equal(won.length, 1,
            'a race that ends with ' + won.length + ' winners is a race ' +
            'nobody re-read');
        assert.equal(lost.length, 1);
        assert.equal(lost[0].code, 'aborted');

        const inSlot = (await H.rosterOf(db, OCC))
            .filter(r => r.slotId === S1);
        assert.equal(inSlot.length, 1, 'both takers were written in');
        assert.equal(inSlot[0].personId, won[0].assignment.personId);

        const occ = await H.occurrenceOf(db, OCC);
        assert.equal(occ.participantIds.length, 2);
        assert.ok(occ.participantIds.includes(won[0].assignment.personId));
    });

    // ⚠ THIS ONE FOUND A BUG, which is the whole argument for the suite.
    //
    // Under real contention the loser of a race did not always come back with
    // `aborted`. Firestore's transaction takes locks, and the loser can be told
    // "Transaction is invalid or closed" — which the Node SDK does not treat as
    // transient, so it surfaced as a raw gRPC error and the member who was half
    // a second slower saw "Something went wrong."
    //
    // Every decision in planTake was already unit-tested. None of that helped:
    // the good answer was being thrown away one layer further out.
    test('losing the race is reported as losing the race, not as a fault',
        async () => {
            await decline(ANN, S1);

            const closed = Object.assign(new Error(
                '3 INVALID_ARGUMENT: Transaction is invalid or closed.'),
            {code: 3, details: 'Transaction is invalid or closed.'});

            const result = await take(CARA, S1, H.failsWith(db, closed));
            assert.equal(result.ok, false);
            assert.equal(result.code, 'aborted',
                'the loser is shown a crash instead of being told plainly');
            assert.match(result.message, /already sorted/);
        });

    test('a fault that is NOT contention still throws', async () => {
        await decline(ANN, S1);

        // The other half of the bargain. A refusal is the right answer to
        // losing a race and the wrong answer to a broken write — one quietly
        // rendered as "try again" is how a bug survives a month.
        const broken = Object.assign(
            new Error('7 PERMISSION_DENIED: the service account is wrong'),
            {code: 7});

        await assert.rejects(
            take(CARA, S1, H.failsWith(db, broken)),
            /PERMISSION_DENIED/);
    });

    test('an editor refilling the slot while somebody is taking it makes the ' +
        'take lose, not the editor', async () => {
        await decline(ANN, S1);

        // What an editor does from the Roles tab: they sort it out themselves.
        // This lands after `take` has read the occurrence, the Person and the
        // Role, and before its transaction opens — see `interruptedBy` for why
        // that is where the window really is.
        const editorRefills = () => db
            .collection('event_occurrences').doc(OCC)
            .collection('roster').doc(ROW(ANN, S1))
            .set(assignment(ANN, S1, 'confirmed'));

        const result = await take(CARA, S1, H.interruptedBy(db, editorRefills));

        // Not an error and not a silent overwrite. The place stopped going
        // spare, and the honest answer is to say so.
        assert.equal(result.ok, false);
        assert.equal(result.code, 'aborted');

        const inSlot = (await H.rosterOf(db, OCC)).filter(r => r.slotId === S1);
        assert.equal(inSlot.length, 1);
        assert.equal(inSlot[0].personId, ANN,
            'the editor’s decision was overwritten from under them');
        assert.equal(inSlot[0].state, 'confirmed');
    });

    test('taking a place nobody gave up is refused, and writes nothing',
        async () => {
            // Ben's place is confirmed, not declined. It is not going spare.
            const result = await take(CARA, S2);

            assert.equal(result.ok, false);
            assert.equal(result.code, 'aborted');

            const roster = await H.rosterOf(db, OCC);
            assert.equal(roster.length, 2);
            assert.equal(roster.find(r => r.slotId === S2).personId, BEN);
        });

    test('a take fails if the caller has no linked Person', async () => {
        await decline(ANN, S1);

        const result = await take(null, S1);
        assert.equal(result.ok, false);

        const inSlot = (await H.rosterOf(db, OCC)).filter(r => r.slotId === S1);
        assert.equal(inSlot.length, 1);
        assert.equal(inSlot[0].personId, ANN);
    });

    // ── The wall, fed for real ───────────────────────────────────────────────
    //
    // The eligibility rules are unit-tested to death in cover-core.test.js. What
    // was never tested is whether takeContext actually FEEDS them — and a rule
    // whose data is missing does not fail loudly, it finds nothing to object to
    // and waves the person through. Four such bugs have already shipped here.

    test('a Role that asks for a woman refuses a man, with the Role read from ' +
        'Firestore', async () => {
        await H.seedRole(db, {
            slug: USHERS,
            name: 'Ushers',
            slots: [
                { id: S1, requirement: 'female' },
                { id: S2, requirement: 'either' },
            ],
            restrictions: [],
        });
        await H.seedPerson(db, CARA, { sex: 'male' });
        await decline(ANN, S1);

        const result = await take(CARA, S1);
        assert.equal(result.ok, false, 'the eligibility wall let a man through');
        assert.equal(result.code, 'failed-precondition');
        assert.equal(result.reason, 'sexMismatch');

        assert.equal((await H.rosterOf(db, OCC))
            .find(r => r.slotId === S1).personId, ANN);
    });

    test('an allowlist read from Firestore refuses somebody not on it',
        async () => {
            await H.seedRole(db, {
                slug: USHERS,
                name: 'Ushers',
                slots: [{ id: S1, requirement: 'either' },
                    { id: S2, requirement: 'either' }],
                restrictions: [{ kind: 'allowlist', personIds: [DAVE] }],
            });
            await decline(ANN, S1);

            const refused = await take(CARA, S1);
            assert.equal(refused.ok, false);
            assert.equal(refused.reason, 'notOnAllowlist');

            const allowed = await take(DAVE, S1);
            assert.equal(allowed.ok, true,
                'the allowlist refused somebody who is on it');
        });

    test('their own Away warns them and lets them through', async () => {
        await db.collection('people').doc(CARA).collection('away')
            .doc('trip').set({ start: '2026-03-10', end: '2026-03-20' });
        await decline(ANN, S1);

        const result = await take(CARA, S1);
        assert.equal(result.ok, true,
            'overruling your own stated plans is changing your mind, not a lie');
        assert.equal(result.warning, 'away');
        assert.equal((await H.rosterOf(db, OCC))
            .find(r => r.slotId === S1).personId, CARA);
    });

    // ── The rung, which never bends ──────────────────────────────────────────

    test('a place on an Event above the caller’s rung cannot be taken',
        async () => {
            await H.seedOccurrence(db, {
                id: OCC,
                date: DATE,
                visibility: 'elder',
                roster: [assignment(ANN, S1, 'declined'),
                    assignment(BEN, S2, 'confirmed')],
            });

            const result = await take(CARA, S1);
            assert.equal(result.ok, false,
                'taking writes you into participantIds, which is what grants ' +
                'sight — so this would hand a member the elders’ diary');
            // Refused at the rung learns nothing about the Role. They should
            // not be told it wanted a woman; they should learn nothing at all.
            assert.equal(result.reason, 'notVisible');
        });

    test('a participant-rung Event never reaches the cover list', async () => {
        await H.seedOccurrence(db, {
            id: OCC,
            date: DATE,
            visibility: 'participant',
            roster: [assignment(ANN, S1, 'pending')],
        });

        const result = await decline(ANN, S1);
        assert.equal(result.ok, true, 'they may still decline');
        assert.equal(await H.coverOf(db, COVER_S1), null,
            'the list exists to reach people who are NOT in the Event, and ' +
            'there is nobody it could reach here without disclosing it');

        const occ = await H.occurrenceOf(db, OCC);
        assert.equal(occ.needsAttention, true, 'the editor still has to fill it');
        assert.equal(occ.outForCover, false, 'nobody is out looking for cover');
    });

    // ── The date ─────────────────────────────────────────────────────────────

    test('a date that has passed refuses both, and writes nothing', async () => {
        const answered = await writes.answer(db, {
            personId: ANN, roleSlug: USHERS, slotId: S1, occurrenceId: OCC,
            state: 'declined', today: '2026-06-01', now: H.now(),
        });
        assert.equal(answered.ok, false);
        assert.equal(answered.code, 'failed-precondition');

        const roster = await H.rosterOf(db, OCC);
        assert.equal(roster.find(r => r.personId === ANN).state, 'pending');
    });
});
