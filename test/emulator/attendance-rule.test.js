const { describe, test, before, beforeEach } = require('node:test');
const assert = require('node:assert');

const H = require('./harness.js');
const writes = require('../../functions/attendance-rule-writes.js');
const Core = require('../../public/shepherding-core.js');

// The attendance rule writer (MS-425 / MS-463 / MS-544) against a real
// Firestore.
//
// The decisions are already pinned in test/attendance-rule.test.js. These
// prove the I/O the unit suite cannot: the Person, tags, and one Membership
// Change land together; a Prospective Member is left alone; an elder reset
// holds; two concurrent runs produce one entry; an elder reset racing a
// Kiosk mark does not promote on the old boundary; a thrown rule does not
// escape to the Kiosk.

const TODAY = '2026-09-14';
const FOUR_DAYS = ['2026-07-20', '2026-08-03', '2026-08-31', '2026-09-14'];
const THREE_DAYS = ['2026-08-03', '2026-08-31', '2026-09-14'];
const OUTSIDE = ['2026-07-06', '2026-07-20', '2026-08-03', '2026-09-14'];

const VISITOR = 'person-visitor';
const PROSPECT = 'person-prospect';

const admin = () => require('firebase-admin');

const suite = H.skipReason
    ? (name) => test(name, { skip: H.skipReason }, () => {})
    : describe;

async function seedVisitor(db, id, extra) {
    await H.seedPerson(db, id, Object.assign({
        membership: {
            stage: 'visitor',
            inactive: false,
            joinedAt: '2026-01-15',
            status: 'visitor',
        },
        tags: ['Visitor', 'Red Flag'],
    }, extra || {}));
}

async function seedAttendance(db, personId, dates) {
    await Promise.all(dates.map((date, i) => {
        const occId = `occ-${date}-${i}`;
        return H.seedOccurrence(db, {
            id: occId, date, name: 'Gathering ' + date,
        }).then(() => db.collection('event_occurrences').doc(occId)
            .collection('attendance').doc(personId)
            .set({ markedAt: H.now() }));
    }));
}

async function activityOf(db, personId) {
    const snap = await db.collection('people').doc(personId)
        .collection('shepherding_activity').get();
    return snap.docs.map(d => Object.assign({ id: d.id }, d.data()));
}

async function personOf(db, personId) {
    const snap = await db.collection('people').doc(personId).get();
    return snap.exists ? snap.data() : null;
}

async function run(db, personId) {
    return writes.applyAttendanceRule(db, {
        personId, today: TODAY, now: H.now(),
    });
}

suite('the attendance rule writer against Firestore', () => {
    let db;

    before(() => {
        db = H.connect();
    });

    beforeEach(async () => {
        await H.wipe();
    });

    test('a Visitor with 4 Attendance days becomes Regular Attender', async () => {
        await seedVisitor(db, VISITOR);
        await seedAttendance(db, VISITOR, FOUR_DAYS);

        const result = await run(db, VISITOR);
        assert.equal(result.moved, true);
        assert.deepEqual(result.days, FOUR_DAYS);

        const person = await personOf(db, VISITOR);
        assert.equal(person.membership.stage, 'regular_attender');
        assert.equal(person.membership.inactive, false);
        assert.equal(person.membership.joinedAt, '2026-01-15',
            'dotted paths must leave joinedAt alone');
        assert.equal(person.membership.status, 'visitor',
            'the legacy status field survives the move');
        assert.deepEqual(person.tags, ['Red Flag', 'Regular Attender']);
        assert.ok(!person.tags.includes('Visitor'));

        const tag = await db.collection('people_tags')
            .doc('Regular Attender').get();
        assert.ok(tag.exists, 'the Regular Attender tag was not registered');
        assert.equal(tag.data().name, 'Regular Attender');

        const activity = await activityOf(db, VISITOR);
        const changes = activity.filter(e => e.kind === 'membership_change');
        const tags = activity.filter(e => e.kind === 'tag_change');
        assert.equal(changes.length, 1);
        assert.equal(tags.length, 0, 'the tag swap must be silent');

        const entry = changes[0];
        assert.equal(entry.previousStage, 'visitor');
        assert.equal(entry.newStage, 'regular_attender');
        assert.equal(entry.authorUid, null);
        assert.equal(entry.authorName, 'Attendance rule');
        assert.equal(entry.source, 'attendance_rule');
        assert.equal(entry.sourceDocumentId, null);
        assert.equal(
            entry.explanation,
            'Marked present on 4 days in two months: 20 Jul, 3 Aug, 31 Aug, 14 Sep.');
        assert.equal(
            Core.describeMembershipChange(entry),
            'Advanced to Regular Attender');
        assert.ok(entry.createdAt, 'the entry needs a server createdAt');
    });

    test('3 days in the window leave the Person untouched', async () => {
        await seedVisitor(db, VISITOR);
        await seedAttendance(db, VISITOR, THREE_DAYS);

        const result = await run(db, VISITOR);
        assert.equal(result.moved, false);
        assert.equal(result.reason, 'threshold');

        const person = await personOf(db, VISITOR);
        assert.equal(person.membership.stage, 'visitor');
        assert.deepEqual(person.tags, ['Visitor', 'Red Flag']);
        assert.equal((await activityOf(db, VISITOR)).length, 0);
    });

    test('a 4th day outside the window writes nothing', async () => {
        await seedVisitor(db, VISITOR);
        await seedAttendance(db, VISITOR, OUTSIDE);

        const result = await run(db, VISITOR);
        assert.equal(result.moved, false);
        assert.equal(result.reason, 'threshold');
        assert.equal((await personOf(db, VISITOR)).membership.stage, 'visitor');
        assert.equal((await activityOf(db, VISITOR)).length, 0);
    });

    test('an elder moving them back to Visitor resets the count', async () => {
        await seedVisitor(db, VISITOR);
        await seedAttendance(db, VISITOR, FOUR_DAYS);

        const changeAt = admin().firestore.Timestamp.fromDate(
            new Date('2026-08-03T17:00:00Z'));
        await db.collection('people').doc(VISITOR)
            .collection('shepherding_activity').doc()
            .set({
                kind: 'membership_change',
                previousStage: 'regular_attender',
                newStage: 'visitor',
                previousInactive: false,
                newInactive: false,
                authorUid: 'elder-1',
                authorName: 'Sam',
                source: 'profile',
                sourceDocumentId: null,
                explanation: 'Moved back',
                createdAt: changeAt,
            });

        const result = await run(db, VISITOR);
        assert.equal(result.moved, false, 'the 4th day was on or before the reset');
        assert.equal((await personOf(db, VISITOR)).membership.stage, 'visitor');

        const activity = await activityOf(db, VISITOR);
        const byRule = activity.filter(e => e.source === 'attendance_rule');
        assert.equal(byRule.length, 0);
    });

    test('a Prospective Member with 6 Attendance days is untouched', async () => {
        await H.seedPerson(db, PROSPECT, {
            membership: { stage: 'prospective_member', inactive: false },
            tags: ['Prospective Member'],
        });
        const six = [
            '2026-07-20', '2026-07-27', '2026-08-03',
            '2026-08-17', '2026-08-31', '2026-09-14',
        ];
        await seedAttendance(db, PROSPECT, six);

        const result = await run(db, PROSPECT);
        assert.equal(result.moved, false);
        assert.equal(result.reason, 'ineligible');

        const person = await personOf(db, PROSPECT);
        assert.equal(person.membership.stage, 'prospective_member');
        assert.deepEqual(person.tags, ['Prospective Member']);
        assert.equal((await activityOf(db, PROSPECT)).length, 0);
    });

    test('two writer runs at once produce one move and one Membership Change',
        async () => {
            await seedVisitor(db, VISITOR);
            await seedAttendance(db, VISITOR, FOUR_DAYS);

            const [first, second] = await Promise.all([
                run(db, VISITOR),
                run(db, VISITOR),
            ]);

            const moved = [first, second].filter(r => r.moved);
            assert.equal(moved.length, 1,
                'concurrent runs must not write two Membership Changes');

            const person = await personOf(db, VISITOR);
            assert.equal(person.membership.stage, 'regular_attender');

            const changes = (await activityOf(db, VISITOR))
                .filter(e => e.kind === 'membership_change');
            assert.equal(changes.length, 1);
        });

    test('an elder reset concurrent with a Kiosk mark does not promote on the old boundary',
        async () => {
            await seedVisitor(db, VISITOR);
            await seedAttendance(db, VISITOR, FOUR_DAYS);

            // Same reset as the sequential case: 3 Aug, so only two days
            // after it count. It lands after the un-transacted reads and
            // before the transaction opens — the window a Person-only
            // re-read used to miss (MS-569).
            const changeAt = admin().firestore.Timestamp.fromDate(
                new Date('2026-08-03T17:00:00Z'));
            const elderReset = () => db.collection('people').doc(VISITOR)
                .collection('shepherding_activity').doc()
                .set({
                    kind: 'membership_change',
                    previousStage: 'regular_attender',
                    newStage: 'visitor',
                    previousInactive: false,
                    newInactive: false,
                    authorUid: 'elder-1',
                    authorName: 'Sam',
                    source: 'profile',
                    sourceDocumentId: null,
                    explanation: 'Moved back',
                    createdAt: changeAt,
                });

            const result = await writes.applyAttendanceRule(
                H.interruptedBy(db, elderReset),
                {personId: VISITOR, today: TODAY, now: H.now()});

            assert.equal(result.moved, false,
                'the reset must be seen inside the transaction');
            assert.equal(result.reason, 'threshold');
            assert.equal(
                (await personOf(db, VISITOR)).membership.stage, 'visitor');

            const activity = await activityOf(db, VISITOR);
            const byRule = activity.filter(e => e.source === 'attendance_rule');
            assert.equal(byRule.length, 0);
            const changes = activity.filter(e => e.kind === 'membership_change');
            assert.equal(changes.length, 1, 'only the elder reset landed');
            assert.equal(changes[0].source, 'profile');
        });

    test('same-day Events count once, and a future occurrence does not count',
        async () => {
            await seedVisitor(db, VISITOR);
            await seedAttendance(db, VISITOR, THREE_DAYS);
            await H.seedOccurrence(db, {
                id: 'occ-same-day-extra', date: '2026-09-14',
                name: 'Evening',
            });
            await db.collection('event_occurrences').doc('occ-same-day-extra')
                .collection('attendance').doc(VISITOR)
                .set({ markedAt: H.now() });
            await H.seedOccurrence(db, {
                id: 'occ-future', date: '2026-09-21', name: 'Next week',
            });
            await db.collection('event_occurrences').doc('occ-future')
                .collection('attendance').doc(VISITOR)
                .set({ markedAt: H.now() });

            const result = await run(db, VISITOR);
            assert.equal(result.moved, false);
            assert.equal(result.reason, 'threshold');
            assert.equal((await personOf(db, VISITOR)).membership.stage, 'visitor');
        });

    test('a thrown rule is swallowed so the Kiosk write is not failed',
        async () => {
            const broken = {
                collection() {
                    throw new Error('the rule exploded');
                },
            };
            const logs = [];
            const result = await writes.applyAttendanceRuleSafe(
                broken, { personId: VISITOR, today: TODAY },
                (msg) => logs.push(msg));
            assert.equal(result.moved, false);
            assert.equal(result.reason, 'error');
            assert.match(logs.join('\n'), /Attendance rule failed/);
        });
});
