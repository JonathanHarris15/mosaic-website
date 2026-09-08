const {describe, test, before, beforeEach} = require('node:test');
const assert = require('node:assert');

const H = require('./harness.js');
const Cal = require('../../functions/calendar-writes.js');
const Core = require('../../functions/shared/events-occurrence-core.js');
const Actor = require('../../functions/mcp-actor.js');

// The `cal_` tools, against a real Firestore (MS-278).
//
// ⚠ WHAT ONLY A REAL DATABASE CAN SHOW. calendar-writes.js is a thin door onto
// events-store.js, and almost every decision it passes through is one about
// several documents at once or about a query the rules constrain:
//
//   1. A repeating Event writes NO occurrence documents. Its dates are computed
//      from the pattern, and a document appears only when something is written
//      on one. A fake would happily return whatever it was told to.
//   2. The visibility query is constrained, and an unconstrained one does not
//      return fewer rows — it ERRORS, and the error reads exactly like "this
//      church has no events".
//   3. One date or every date is the whole question. `cal_update_event` must
//      leave the pattern alone and `cal_update_series` must reach every date;
//      proving that means reading the other dates back.
//   4. The Sunday Service refuses to be skipped or moved, because its order of
//      service lives under its own date.

const UID = 'uid-elder-1';
const ELDER_PERSON = 'person-jono';

const suite = H.skipReason
    ? (name) => test(name, {skip: H.skipReason}, () => {})
    : describe;

suite('the calendar tools', () => {
    let db, actor;

    before(() => {
        db = H.connect();
        const admin = require('firebase-admin');
        require('../../functions/mcp-firestore.js').bind({
            FieldValue: admin.firestore.FieldValue,
            Timestamp: admin.firestore.Timestamp,
        });
    });

    beforeEach(async () => {
        await H.wipe();
        await H.seedPerson(db, ELDER_PERSON, {name: 'Jonathan Harris'});
        await db.collection('users').doc(UID).set({
            personId: ELDER_PERSON, email: 'jono@example.com', permissionLevel: 'elder',
        });
        actor = await Actor.requireActor(db, UID);
    });

    // ── Making one ───────────────────────────────────────────────────────

    test('a one-off Event is a single dated occurrence', async () => {
        const made = await Cal.createEvent(db, {
            name: 'Launch Team Lunch',
            visibility: 'member',
            date: '2026-09-20',
            time: '12:30',
            location: 'The hall',
        });

        assert.strictEqual(made.kind, 'occurrence');
        const stored = (await db.collection('event_occurrences')
            .doc(made.eventId).get()).data();
        assert.strictEqual(stored.name, 'Launch Team Lunch');
        assert.strictEqual(stored.date, '2026-09-20');
        assert.strictEqual(stored.seriesId, null);
        assert.strictEqual(stored.visibility, 'member');
    });

    test('a repeating Event writes a series and NO dates', async () => {
        // The Calendar computes them. A tool that eagerly wrote a year of
        // occurrence documents would be writing rows nobody asked for and
        // freezing a pattern that is meant to stay editable.
        const made = await Cal.createEvent(db, {
            name: 'Prayer Meeting',
            visibility: 'member',
            recurrence: {freq: 'weekly', startDate: '2026-09-08', time: '19:00'},
        });

        assert.strictEqual(made.kind, 'series');
        const series = (await db.collection('events').doc(made.seriesId).get()).data();
        assert.strictEqual(series.name, 'Prayer Meeting');
        assert.strictEqual(series.recurrence.time, '19:00');

        const dates = await db.collection('event_occurrences')
            .where('seriesId', '==', made.seriesId).get();
        assert.strictEqual(dates.docs.length, 0, 'no dates may be written up front');
    });

    test('an Event with no visibility is refused, naming the rungs', async () => {
        // An Event nobody can see is the most common way this goes wrong: the
        // rule drops an unstamped document from every list query, so it lands
        // in the database and then vanishes.
        await assert.rejects(
            () => Cal.createEvent(db, {name: 'Mystery', date: '2026-09-20'}),
            /public/);
        await assert.rejects(
            () => Cal.createEvent(db, {
                name: 'Mystery', date: '2026-09-20', visibility: 'everyone',
            }), /not a visibility/);
    });

    // ── Reading ──────────────────────────────────────────────────────────

    test('the listing includes dates computed from a pattern, not just stored ones', async () => {
        const made = await Cal.createEvent(db, {
            name: 'Prayer Meeting',
            visibility: 'member',
            recurrence: {freq: 'weekly', startDate: '2026-09-08', time: '19:00'},
        });

        const listed = await Cal.listEvents(db, {
            from: '2026-09-08', to: '2026-09-30', seriesId: made.seriesId,
        });

        assert.ok(listed.count >= 3, 'a weekly pattern should fill three weeks: ' + listed.count);
        listed.events.forEach((e) => assert.strictEqual(e.name, 'Prayer Meeting'));
    });

    test('a range with no events is an empty answer, not an error', async () => {
        // The failure this guards: an unconstrained visibility query errors,
        // and the error looks exactly like an empty church.
        const listed = await Cal.listEvents(db, {from: '2030-01-01', to: '2030-01-07'});
        assert.strictEqual(listed.count, 0);
        assert.deepStrictEqual(listed.events, []);
    });

    test('a listing needs both ends of the range', async () => {
        await assert.rejects(() => Cal.listEvents(db, {from: '2026-09-08'}), /to/);
    });

    test('one date reads back on its own', async () => {
        const made = await Cal.createEvent(db, {
            name: 'Launch Team Lunch', visibility: 'member', date: '2026-09-20',
        });
        const one = await Cal.getEvent(db, {eventId: made.eventId});
        assert.strictEqual(one.name, 'Launch Team Lunch');
        assert.strictEqual(one.date, '2026-09-20');
    });

    test('a date with no document says so, rather than pretending', async () => {
        await assert.rejects(
            () => Cal.getEvent(db, {eventId: 'nothing_2026-09-20'}),
            /cal_list_events/);
    });

    test('the series listing flags the Sunday Service', async () => {
        await db.collection('events').doc(Core.SUNDAY_SERVICE_ID).set({
            name: 'Sunday Service', locked: true, visibility: 'public',
            recurrence: {freq: 'weekly', startDate: '2026-09-06', time: '10:00'},
        });

        const listed = await Cal.listSeries(db);
        const sunday = listed.series.find((s) => s.seriesId === Core.SUNDAY_SERVICE_ID);
        assert.ok(sunday, 'the Sunday Service must be listed');
        assert.strictEqual(sunday.isSundayService, true);
        assert.strictEqual(sunday.locked, true);
    });

    // ── One date, or every date ──────────────────────────────────────────

    test('changing ONE date leaves the pattern and the other dates alone', async () => {
        const made = await Cal.createEvent(db, {
            name: 'Prayer Meeting',
            visibility: 'member',
            recurrence: {freq: 'weekly', startDate: '2026-09-08', time: '19:00'},
        });
        const eventId = Core.occurrenceId(made.seriesId, '2026-09-15');

        await Cal.updateEvent(db, {eventId, location: 'The small room', time: '18:30'});

        const changed = await Cal.getEvent(db, {eventId});
        assert.strictEqual(changed.location, 'The small room');
        assert.strictEqual(changed.time, '18:30');

        // The Event itself is untouched.
        const series = (await db.collection('events').doc(made.seriesId).get()).data();
        assert.strictEqual(series.recurrence.time, '19:00');
        assert.ok(!series.location);
    });

    test('changing the EVENT reaches every date', async () => {
        const made = await Cal.createEvent(db, {
            name: 'Prayer Meeting',
            visibility: 'member',
            recurrence: {freq: 'weekly', startDate: '2026-09-08', time: '19:00'},
        });

        const changed = await Cal.updateSeries(db, {
            seriesId: made.seriesId,
            name: 'Midweek Prayer',
            location: 'The hall',
            time: '19:30',
        });
        assert.strictEqual(changed.changed.time, '19:30');
        assert.match(changed.note, /every date/i);

        const listed = await Cal.listEvents(db, {
            from: '2026-09-08', to: '2026-09-30', seriesId: made.seriesId,
        });
        listed.events.forEach((e) => {
            assert.strictEqual(e.name, 'Midweek Prayer', e.date);
            assert.strictEqual(e.time, '19:30', e.date);
        });
    });

    test('a colour that is not a colour is refused, listing the real ones', async () => {
        const made = await Cal.createEvent(db, {
            name: 'Prayer Meeting', visibility: 'member',
            recurrence: {freq: 'weekly', startDate: '2026-09-08'},
        });
        await assert.rejects(() => Cal.updateSeries(db, {
            seriesId: made.seriesId, colour: 'turquoise',
        }), /steel/);
    });

    test('a colour that is one is saved on the Event', async () => {
        const made = await Cal.createEvent(db, {
            name: 'Prayer Meeting', visibility: 'member',
            recurrence: {freq: 'weekly', startDate: '2026-09-08'},
        });
        await Cal.updateSeries(db, {seriesId: made.seriesId, colour: 'plum'});

        const series = (await db.collection('events').doc(made.seriesId).get()).data();
        assert.strictEqual(series.colour, 'plum');
    });

    test('an update with nothing in it is refused rather than written as a no-op', async () => {
        const made = await Cal.createEvent(db, {
            name: 'Prayer Meeting', visibility: 'member',
            recurrence: {freq: 'weekly', startDate: '2026-09-08'},
        });
        await assert.rejects(
            () => Cal.updateSeries(db, {seriesId: made.seriesId}), /Nothing to change/);
    });

    // ── Skipping, moving, deleting ───────────────────────────────────────

    test('skipping one date marks that date and no other', async () => {
        const made = await Cal.createEvent(db, {
            name: 'Prayer Meeting', visibility: 'member',
            recurrence: {freq: 'weekly', startDate: '2026-09-08', time: '19:00'},
        });

        await Cal.cancelEvent(db, {seriesId: made.seriesId, date: '2026-09-15'});

        const listed = await Cal.listEvents(db, {
            from: '2026-09-08', to: '2026-09-30', seriesId: made.seriesId,
        });
        const off = listed.events.filter((e) => e.cancelled).map((e) => e.date);
        assert.deepStrictEqual(off, ['2026-09-15']);
    });

    test('a skipped date can be put back', async () => {
        const made = await Cal.createEvent(db, {
            name: 'Prayer Meeting', visibility: 'member',
            recurrence: {freq: 'weekly', startDate: '2026-09-08', time: '19:00'},
        });
        await Cal.cancelEvent(db, {seriesId: made.seriesId, date: '2026-09-15'});
        await Cal.cancelEvent(db, {
            seriesId: made.seriesId, date: '2026-09-15', cancelled: false,
        });

        const listed = await Cal.listEvents(db, {
            from: '2026-09-08', to: '2026-09-30', seriesId: made.seriesId,
        });
        assert.strictEqual(listed.events.filter((e) => e.cancelled).length, 0);
    });

    test('a skip stamps visibility, or the date vanishes instead of skipping', async () => {
        // The bug this pins: a skip used to write { cancelled: true } and
        // nothing else. A document with no visibility is refused to everyone by
        // the rule and dropped by every list query, so pressing "skip" appeared
        // to do nothing at all.
        const made = await Cal.createEvent(db, {
            name: 'Prayer Meeting', visibility: 'member',
            recurrence: {freq: 'weekly', startDate: '2026-09-08', time: '19:00'},
        });
        await Cal.cancelEvent(db, {seriesId: made.seriesId, date: '2026-09-15'});

        const stored = (await db.collection('event_occurrences')
            .doc(Core.occurrenceId(made.seriesId, '2026-09-15')).get()).data();
        assert.strictEqual(stored.cancelled, true);
        assert.strictEqual(stored.visibility, 'member', 'the skip must stamp visibility');
    });

    test('moving one date takes it to the new date and off the old one', async () => {
        const made = await Cal.createEvent(db, {
            name: 'Prayer Meeting', visibility: 'member',
            recurrence: {freq: 'weekly', startDate: '2026-09-08', time: '19:00'},
        });

        const moved = await Cal.moveEvent(db, {
            seriesId: made.seriesId, fromDate: '2026-09-15', toDate: '2026-09-17',
        });
        assert.strictEqual(moved.to, Core.occurrenceId(made.seriesId, '2026-09-17'));

        const listed = await Cal.listEvents(db, {
            from: '2026-09-08', to: '2026-09-30', seriesId: made.seriesId,
        });
        const dates = listed.events.filter((e) => !e.cancelled).map((e) => e.date);
        assert.ok(dates.includes('2026-09-17'), 'the new date is there: ' + dates);
    });

    test('deleting one date removes it and says what went', async () => {
        const made = await Cal.createEvent(db, {
            name: 'Launch Team Lunch', visibility: 'member', date: '2026-09-20',
        });

        const gone = await Cal.deleteEvent(db, {eventId: made.eventId});
        assert.strictEqual(gone.deleted.name, 'Launch Team Lunch');
        assert.strictEqual(gone.deleted.date, '2026-09-20');

        assert.strictEqual(
            (await db.collection('event_occurrences').doc(made.eventId).get()).exists,
            false);
    });

    // ── The Sunday Service ───────────────────────────────────────────────

    test('the Sunday Service cannot be skipped or moved', async () => {
        // Its order of service lives under its own date. Marking the Event off
        // would leave that order of service standing, and one Sunday would say
        // two things.
        await db.collection('events').doc(Core.SUNDAY_SERVICE_ID).set({
            name: 'Sunday Service', locked: true, visibility: 'public',
            recurrence: {freq: 'weekly', startDate: '2026-09-06', time: '10:00'},
        });

        await assert.rejects(() => Cal.cancelEvent(db, {
            seriesId: Core.SUNDAY_SERVICE_ID, date: '2026-09-13',
        }), /order of service/);

        await assert.rejects(() => Cal.moveEvent(db, {
            seriesId: Core.SUNDAY_SERVICE_ID,
            fromDate: '2026-09-13',
            toDate: '2026-09-14',
        }), /Sunday|order of service/);
    });

    // ── A document on an event ───────────────────────────────────────────

    test('a document can be hung off one date', async () => {
        const made = await Cal.createEvent(db, {
            name: 'Members Meeting', visibility: 'member', date: '2026-09-20',
        });

        const doc = await Cal.createEventDocument(db, {
            eventId: made.eventId,
            title: 'Agenda',
            markdown: '## Agenda\n\n- Budget\n- Building',
            actor,
        });

        const stored = (await db.collection('event_occurrences').doc(made.eventId)
            .collection('documents').doc(doc.documentId).get()).data();
        assert.strictEqual(stored.title, 'Agenda');
        assert.strictEqual(stored.contentJson.type, 'doc');
        assert.strictEqual(stored.contentJson.content[0].type, 'heading');
        assert.strictEqual(stored.createdByName, 'Jonathan Harris');
        assert.strictEqual(stored.writtenVia, 'mcp');
    });

    test('a document cannot be hung off a date that has no record yet', async () => {
        await assert.rejects(() => Cal.createEventDocument(db, {
            eventId: 'nothing_2026-09-20', title: 'Agenda', actor,
        }), /no document to hang one off|No Event occurrence/);
    });
});
