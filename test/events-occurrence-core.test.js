const { test } = require('node:test');
const assert = require('node:assert');

// MS-147 — the pure model MS-99 stands on (ADR-0018).
//
// Five things it has to know: resolving occurrences from a recurrence rule,
// the assignment state machine, one-assignment-per-slot, deriving the
// participant list, and the conversion rules once a date has passed.
//
// Everything here is a pure function of its inputs, so everything here is
// tested as one. No Firestore, no browser.

const Core = require('../public/events-occurrence-core.js');
const EventsCore = require('../public/events-core.js');

// ── The one constant this module restates ─────────────────────────────────────

test('the Sunday Service id agrees with the series layer', () => {
    // This module is deliberately dependency-free, like every other *-core here,
    // so it restates the id rather than importing it. A duplicated constant is a
    // constant that can drift, and if these two ever disagree the Sunday stops
    // being permanently public without anything else going red.
    assert.strictEqual(Core.SUNDAY_SERVICE_ID, EventsCore.SUNDAY_SERVICE_ID);
});

// ── Resolving occurrences from a recurrence rule ──────────────────────────────

test('a one-off Event yields exactly its own date', () => {
    const rule = { freq: Core.FREQ.ONCE, startDate: '2026-07-15' };
    assert.deepStrictEqual(Core.datesBetween(rule, '2026-07-01', '2026-07-31'), ['2026-07-15']);
});

test('a one-off Event outside the range yields nothing', () => {
    const rule = { freq: Core.FREQ.ONCE, startDate: '2026-09-02' };
    assert.deepStrictEqual(Core.datesBetween(rule, '2026-07-01', '2026-07-31'), []);
});

test('a weekly rule yields every matching weekday in the range', () => {
    // 2026-07-01 is a Wednesday.
    const rule = { freq: Core.FREQ.WEEKLY, startDate: '2026-07-01', weekday: 3 };
    assert.deepStrictEqual(
        Core.datesBetween(rule, '2026-07-01', '2026-07-31'),
        ['2026-07-01', '2026-07-08', '2026-07-15', '2026-07-22', '2026-07-29']
    );
});

test('a weekly rule never yields a date before it starts', () => {
    const rule = { freq: Core.FREQ.WEEKLY, startDate: '2026-07-15', weekday: 3 };
    assert.deepStrictEqual(
        Core.datesBetween(rule, '2026-07-01', '2026-07-31'),
        ['2026-07-15', '2026-07-22', '2026-07-29']
    );
});

test('a fortnightly rule skips the alternate weeks, counted from its start', () => {
    const rule = { freq: Core.FREQ.FORTNIGHTLY, startDate: '2026-07-01', weekday: 3 };
    assert.deepStrictEqual(
        Core.datesBetween(rule, '2026-07-01', '2026-08-31'),
        ['2026-07-01', '2026-07-15', '2026-07-29', '2026-08-12', '2026-08-26']
    );
});

test('a monthly rule repeats the same weekday-of-month, not the same date', () => {
    // 2026-07-01 is the FIRST Wednesday of July. Monthly means "the first
    // Wednesday", which is what a church means by a monthly gathering — the
    // same date each month would drift across the week.
    const rule = { freq: Core.FREQ.MONTHLY, startDate: '2026-07-01', weekday: 3 };
    assert.deepStrictEqual(
        Core.datesBetween(rule, '2026-07-01', '2026-10-31'),
        ['2026-07-01', '2026-08-05', '2026-09-02', '2026-10-07']
    );
});

test('a monthly rule skips a month that has no fifth such weekday', () => {
    // 2026-07-29 is the FIFTH Wednesday of July. Most months have only four,
    // so those months simply have no occurrence rather than falling back to
    // the fourth — a gathering that moves a week is a different gathering.
    const rule = { freq: Core.FREQ.MONTHLY, startDate: '2026-07-29', weekday: 3 };
    const dates = Core.datesBetween(rule, '2026-07-01', '2026-12-31');
    assert.deepStrictEqual(dates, ['2026-07-29', '2026-09-30', '2026-12-30']);
});

test('an "until a date" rule stops on that date', () => {
    const rule = {
        freq: Core.FREQ.WEEKLY, startDate: '2026-07-01', weekday: 3,
        ends: { kind: Core.ENDS.ON_DATE, date: '2026-07-15' },
    };
    assert.deepStrictEqual(
        Core.datesBetween(rule, '2026-07-01', '2026-08-31'),
        ['2026-07-01', '2026-07-08', '2026-07-15']
    );
});

test('a "for a set number of times" rule stops after that many, counted from its start', () => {
    const rule = {
        freq: Core.FREQ.WEEKLY, startDate: '2026-07-01', weekday: 3,
        ends: { kind: Core.ENDS.AFTER_COUNT, count: 3 },
    };
    // Even asked for a later window, only the first three ever exist.
    assert.deepStrictEqual(Core.datesBetween(rule, '2026-07-01', '2026-12-31'), [
        '2026-07-01', '2026-07-08', '2026-07-15',
    ]);
    assert.deepStrictEqual(Core.datesBetween(rule, '2026-07-20', '2026-12-31'), []);
});

test('the dates come from the rule alone — no stored occurrence records needed', () => {
    const rule = { freq: Core.FREQ.WEEKLY, startDate: '2026-07-01', weekday: 3 };
    // Nothing is passed but the rule and the range. This is the sparse promise:
    // an untouched date still appears in the Calendar.
    assert.strictEqual(Core.datesBetween(rule, '2026-07-01', '2026-07-31').length, 5);
});

// ── Occurrence identity ───────────────────────────────────────────────────────

test('an occurrence id is deterministic and stable', () => {
    assert.strictEqual(Core.occurrenceId('midweek', '2026-07-15'), 'midweek_2026-07-15');
    assert.strictEqual(
        Core.occurrenceId('midweek', '2026-07-15'),
        Core.occurrenceId('midweek', '2026-07-15')
    );
});

test('two editors clicking at once cannot make two occurrences of the same date', () => {
    // The whole point of a deterministic id: the second write lands on the same
    // document as the first rather than creating a twin.
    const a = Core.occurrenceId('midweek', '2026-07-15');
    const b = Core.occurrenceId('midweek', '2026-07-15');
    assert.strictEqual(a, b);
});

test('a one-off Event belongs to no series and takes its own id', () => {
    assert.strictEqual(Core.occurrenceId(null, '2026-07-15'), null);
    assert.strictEqual(Core.occurrenceId('', '2026-07-15'), null);
});

// ── Merging computed dates with sparse stored records ─────────────────────────

test('merging returns an occurrence per computed date, stored or not', () => {
    const rule = { freq: Core.FREQ.WEEKLY, startDate: '2026-07-01', weekday: 3 };
    const stored = [{ id: 'midweek_2026-07-08', seriesId: 'midweek', date: '2026-07-08', location: 'The hall' }];

    const merged = Core.mergeOccurrences('midweek', rule, stored, '2026-07-01', '2026-07-15');

    assert.deepStrictEqual(merged.map(o => o.date), ['2026-07-01', '2026-07-08', '2026-07-15']);
    assert.strictEqual(merged[0].stored, false);
    assert.strictEqual(merged[1].stored, true);
    assert.strictEqual(merged[1].location, 'The hall');
});

test('a cancelled occurrence is marked, not dropped, so the Calendar can say so', () => {
    const rule = { freq: Core.FREQ.WEEKLY, startDate: '2026-07-01', weekday: 3 };
    const stored = [{ id: 'midweek_2026-07-08', seriesId: 'midweek', date: '2026-07-08', cancelled: true }];

    const merged = Core.mergeOccurrences('midweek', rule, stored, '2026-07-01', '2026-07-15');
    assert.strictEqual(merged.find(o => o.date === '2026-07-08').cancelled, true);
});

// ── Changing a pattern: orphans are surfaced, never migrated ──────────────────

test('a stored occurrence that no longer fits the new pattern is an orphan', () => {
    const stored = [
        { id: 'midweek_2026-07-01', date: '2026-07-01', assignments: [{ personId: 'p1' }] },
        { id: 'midweek_2026-07-08', date: '2026-07-08', assignments: [{ personId: 'p2' }] },
    ];
    // Moved from Wednesdays (3) to Thursdays (4).
    const newRule = { freq: Core.FREQ.WEEKLY, startDate: '2026-07-02', weekday: 4 };

    const orphans = Core.orphanedOccurrences(newRule, stored, '2026-07-01', '2026-07-31');
    assert.deepStrictEqual(orphans.map(o => o.date), ['2026-07-01', '2026-07-08']);
});

test('an orphan with nobody on it is not worth asking about', () => {
    const stored = [
        { id: 'midweek_2026-07-01', date: '2026-07-01', assignments: [] },
        { id: 'midweek_2026-07-08', date: '2026-07-08', assignments: [{ personId: 'p2' }] },
    ];
    const newRule = { freq: Core.FREQ.WEEKLY, startDate: '2026-07-02', weekday: 4 };

    const orphans = Core.orphanedOccurrences(newRule, stored, '2026-07-01', '2026-07-31');
    assert.deepStrictEqual(orphans.map(o => o.date), ['2026-07-08']);
});

test('a stored occurrence that still fits the new pattern is not an orphan', () => {
    const stored = [{ id: 'midweek_2026-07-02', date: '2026-07-02', assignments: [{ personId: 'p1' }] }];
    const newRule = { freq: Core.FREQ.WEEKLY, startDate: '2026-07-02', weekday: 4 };
    assert.deepStrictEqual(Core.orphanedOccurrences(newRule, stored, '2026-07-01', '2026-07-31'), []);
});

// ── The assignment state machine ──────────────────────────────────────────────

test('a new assignment starts as Pending', () => {
    const a = Core.newAssignment({
        personId: 'p1', roleSlug: 'kids', slotId: 's1',
    }, { actorUid: 'u9', at: '2026-07-01T10:00:00Z' });

    assert.strictEqual(a.state, Core.STATES.PENDING);
});

test('a new assignment records who made it and when', () => {
    const a = Core.newAssignment({
        personId: 'p1', roleSlug: 'kids', slotId: 's1',
    }, { actorUid: 'u9', at: '2026-07-01T10:00:00Z' });

    assert.strictEqual(a.stateSetBy, 'u9');
    assert.strictEqual(a.stateSetAt, '2026-07-01T10:00:00Z');
});

test('every state change records the actor and a timestamp', () => {
    let a = Core.newAssignment({ personId: 'p1', roleSlug: 'kids', slotId: 's1' },
        { actorUid: 'u9', at: '2026-07-01T10:00:00Z' });

    a = Core.setState(a, Core.STATES.CONFIRMED, { actorUid: 'u4', at: '2026-07-02T09:00:00Z' });

    assert.strictEqual(a.state, Core.STATES.CONFIRMED);
    assert.strictEqual(a.stateSetBy, 'u4');
    assert.strictEqual(a.stateSetAt, '2026-07-02T09:00:00Z');
});

test('setting a state returns a new assignment and never mutates the old one', () => {
    const before = Core.newAssignment({ personId: 'p1', roleSlug: 'kids', slotId: 's1' },
        { actorUid: 'u9', at: '2026-07-01T10:00:00Z' });
    const after = Core.setState(before, Core.STATES.DECLINED, { actorUid: 'u4', at: '2026-07-02T09:00:00Z' });

    assert.strictEqual(before.state, Core.STATES.PENDING);
    assert.strictEqual(after.state, Core.STATES.DECLINED);
    assert.notStrictEqual(before, after);
});

test('an unknown state is refused rather than stored', () => {
    const a = Core.newAssignment({ personId: 'p1', roleSlug: 'kids', slotId: 's1' },
        { actorUid: 'u9', at: '2026-07-01T10:00:00Z' });
    assert.throws(() => Core.setState(a, 'maybe', { actorUid: 'u4', at: 'now' }), /maybe/);
});

// ── One assignment per slot ───────────────────────────────────────────────────

test('assigning into an empty slot adds an assignment', () => {
    const next = Core.assignToSlot([], { personId: 'p1', roleSlug: 'kids', slotId: 's1' },
        { actorUid: 'u9', at: 'T1' });

    assert.strictEqual(next.length, 1);
    assert.strictEqual(next[0].personId, 'p1');
    assert.strictEqual(next[0].state, Core.STATES.PENDING);
});

test('assigning into an occupied slot replaces what was there', () => {
    let list = Core.assignToSlot([], { personId: 'p1', roleSlug: 'kids', slotId: 's1' },
        { actorUid: 'u9', at: 'T1' });
    list = Core.assignToSlot(list, { personId: 'p2', roleSlug: 'kids', slotId: 's1' },
        { actorUid: 'u9', at: 'T2' });

    assert.strictEqual(list.length, 1, 'a slot holds exactly one current assignment');
    assert.strictEqual(list[0].personId, 'p2');
});

test('the same slot id in a different Role is a different slot', () => {
    let list = Core.assignToSlot([], { personId: 'p1', roleSlug: 'kids', slotId: 's1' },
        { actorUid: 'u9', at: 'T1' });
    list = Core.assignToSlot(list, { personId: 'p2', roleSlug: 'setup', slotId: 's1' },
        { actorUid: 'u9', at: 'T2' });

    assert.strictEqual(list.length, 2);
});

test('clearing a slot removes its assignment', () => {
    let list = Core.assignToSlot([], { personId: 'p1', roleSlug: 'kids', slotId: 's1' },
        { actorUid: 'u9', at: 'T1' });
    list = Core.clearSlot(list, 'kids', 's1');
    assert.deepStrictEqual(list, []);
});

// ── The participant list ──────────────────────────────────────────────────────

test('the participant list is everyone currently holding a Role', () => {
    let list = Core.assignToSlot([], { personId: 'p1', roleSlug: 'kids', slotId: 's1' }, { actorUid: 'u', at: 'T' });
    list = Core.assignToSlot(list, { personId: 'p2', roleSlug: 'kids', slotId: 's2' }, { actorUid: 'u', at: 'T' });

    assert.deepStrictEqual(Core.participantIds(list).sort(), ['p1', 'p2']);
});

test('someone who declined is still a participant — they keep their place until replaced', () => {
    let list = Core.assignToSlot([], { personId: 'p1', roleSlug: 'kids', slotId: 's1' }, { actorUid: 'u', at: 'T' });
    list = Core.setStateAt(list, 'kids', 's1', Core.STATES.DECLINED, { actorUid: 'u', at: 'T2' });

    assert.deepStrictEqual(Core.participantIds(list), ['p1']);
});

test('a replacement overwrites a decline: the flag clears and the decliner leaves in the same write', () => {
    let list = Core.assignToSlot([], { personId: 'p1', roleSlug: 'kids', slotId: 's1' }, { actorUid: 'u', at: 'T' });
    list = Core.setStateAt(list, 'kids', 's1', Core.STATES.DECLINED, { actorUid: 'u', at: 'T2' });
    assert.strictEqual(Core.needsAttention({ assignments: list }), true);

    list = Core.assignToSlot(list, { personId: 'p2', roleSlug: 'kids', slotId: 's1' }, { actorUid: 'u', at: 'T3' });

    assert.deepStrictEqual(Core.participantIds(list), ['p2'], 'the decliner is gone');
    assert.strictEqual(list[0].state, Core.STATES.PENDING, 'the replacement starts Pending');
    assert.strictEqual(Core.needsAttention({ assignments: list }), false, 'the flag cleared');
});

test('someone removed by an editor stops being a participant immediately', () => {
    let list = Core.assignToSlot([], { personId: 'p1', roleSlug: 'kids', slotId: 's1' }, { actorUid: 'u', at: 'T' });
    list = Core.clearSlot(list, 'kids', 's1');
    assert.deepStrictEqual(Core.participantIds(list), []);
});

test('the participant list has no duplicates when one person holds two Roles', () => {
    let list = Core.assignToSlot([], { personId: 'p1', roleSlug: 'kids', slotId: 's1' }, { actorUid: 'u', at: 'T' });
    list = Core.assignToSlot(list, { personId: 'p1', roleSlug: 'setup', slotId: 's1' }, { actorUid: 'u', at: 'T' });
    assert.deepStrictEqual(Core.participantIds(list), ['p1']);
});

// ── One-off Roles ─────────────────────────────────────────────────────────────

test('a one-off Role holds people without slots or eligibility', () => {
    const list = Core.assignToOneOff([], { oneOffId: 'o1', label: 'Unlock the hall', personId: 'p3' },
        { actorUid: 'u', at: 'T' });

    assert.strictEqual(list.length, 1);
    assert.strictEqual(list[0].roleSlug, Core.ONE_OFF_SLUG);
    assert.strictEqual(list[0].label, 'Unlock the hall');
    assert.strictEqual(list[0].state, Core.STATES.PENDING);
});

test('a one-off Role can hold several people at once — it has no slots to compete for', () => {
    let list = Core.assignToOneOff([], { oneOffId: 'o1', label: 'Unlock the hall', personId: 'p3' }, { actorUid: 'u', at: 'T' });
    list = Core.assignToOneOff(list, { oneOffId: 'o1', label: 'Unlock the hall', personId: 'p4' }, { actorUid: 'u', at: 'T' });

    assert.strictEqual(list.length, 2);
    assert.deepStrictEqual(Core.participantIds(list).sort(), ['p3', 'p4']);
});

// ── The conversion rules, once the date has passed ────────────────────────────

function occurrenceWith(assignments) {
    return { id: 'midweek_2026-07-01', seriesId: 'midweek', date: '2026-07-01', assignments };
}

test('a Confirmed assignment becomes a serve record', () => {
    let list = Core.assignToSlot([], { personId: 'p1', roleSlug: 'kids', slotId: 's1' }, { actorUid: 'u', at: 'T' });
    list = Core.setStateAt(list, 'kids', 's1', Core.STATES.CONFIRMED, { actorUid: 'u', at: 'T2' });

    const { serves, questions } = Core.conversion(occurrenceWith(list));

    assert.strictEqual(serves.length, 1);
    assert.strictEqual(serves[0].personId, 'p1');
    assert.strictEqual(serves[0].type, 'kids');
    assert.strictEqual(serves[0].serviceDate, '2026-07-01');
    assert.strictEqual(serves[0].seriesId, 'midweek');
    assert.deepStrictEqual(questions, []);
});

test('a Declined assignment never becomes a serve record, and is never a question', () => {
    let list = Core.assignToSlot([], { personId: 'p1', roleSlug: 'kids', slotId: 's1' }, { actorUid: 'u', at: 'T' });
    list = Core.setStateAt(list, 'kids', 's1', Core.STATES.DECLINED, { actorUid: 'u', at: 'T2' });

    const { serves, questions } = Core.conversion(occurrenceWith(list));

    assert.deepStrictEqual(serves, []);
    assert.deepStrictEqual(questions, []);
});

test('a Pending assignment becomes an open question, not a serve record', () => {
    const list = Core.assignToSlot([], { personId: 'p1', roleSlug: 'kids', slotId: 's1' }, { actorUid: 'u', at: 'T' });

    const { serves, questions } = Core.conversion(occurrenceWith(list));

    assert.deepStrictEqual(serves, []);
    assert.strictEqual(questions.length, 1);
    assert.strictEqual(questions[0].personId, 'p1');
});

test('an unresolved question never becomes a serve record, however much time passes', () => {
    const list = Core.assignToSlot([], { personId: 'p1', roleSlug: 'kids', slotId: 's1' }, { actorUid: 'u', at: 'T' });
    const occurrence = occurrenceWith(list);

    // Run the conversion again and again — a decade of scheduled runs.
    for (let i = 0; i < 10; i++) {
        const { serves, questions } = Core.conversion(occurrence);
        assert.deepStrictEqual(serves, [], 'silence is never counted as a yes');
        assert.strictEqual(questions.length, 1, 'and never silently dropped either');
    }
});

test('a one-off Role converts under the reserved slug with its label preserved', () => {
    let list = Core.assignToOneOff([], { oneOffId: 'o1', label: 'Unlock the hall', personId: 'p3' }, { actorUid: 'u', at: 'T' });
    list = Core.setOneOffState(list, 'o1', 'p3', Core.STATES.CONFIRMED, { actorUid: 'u', at: 'T2' });

    const { serves } = Core.conversion(occurrenceWith(list));

    assert.strictEqual(serves.length, 1);
    assert.strictEqual(serves[0].type, Core.ONE_OFF_SLUG,
        'never an invented slug — RolesCore.roleBySlug could not resolve one to a name');
    assert.strictEqual(serves[0].metadata.label, 'Unlock the hall');
});

test('resolving a question yields the same serve record the automatic path would have', () => {
    const list = Core.assignToSlot([], { personId: 'p1', roleSlug: 'kids', slotId: 's1' }, { actorUid: 'u', at: 'T' });
    const occurrence = occurrenceWith(list);

    const question = Core.conversion(occurrence).questions[0];
    const record = Core.serveRecordFor(occurrence, question.assignment);

    assert.strictEqual(record.personId, 'p1');
    assert.strictEqual(record.type, 'kids');
    assert.strictEqual(record.serviceDate, '2026-07-01');
    assert.strictEqual(record.seriesId, 'midweek');
});

test('a serve record carries a stable key, so answering twice writes one record', () => {
    let list = Core.assignToSlot([], { personId: 'p1', roleSlug: 'kids', slotId: 's1' }, { actorUid: 'u', at: 'T' });
    list = Core.setStateAt(list, 'kids', 's1', Core.STATES.CONFIRMED, { actorUid: 'u', at: 'T2' });
    const occurrence = occurrenceWith(list);

    const a = Core.conversion(occurrence).serves[0];
    const b = Core.conversion(occurrence).serves[0];
    assert.strictEqual(a.involvementId, b.involvementId);
    assert.ok(a.involvementId, 'a deterministic id is what makes a second run a no-op');
});

test('an occurrence with no assignments converts to nothing, without error', () => {
    const { serves, questions } = Core.conversion(occurrenceWith([]));
    assert.deepStrictEqual(serves, []);
    assert.deepStrictEqual(questions, []);
    assert.deepStrictEqual(Core.conversion({ date: '2026-07-01' }).serves, []);
});

test('an Involvement written from an Assignment carries its series, as fairness needs', () => {
    let list = Core.assignToSlot([], { personId: 'p1', roleSlug: 'kids', slotId: 's1' }, { actorUid: 'u', at: 'T' });
    list = Core.setStateAt(list, 'kids', 's1', Core.STATES.CONFIRMED, { actorUid: 'u', at: 'T2' });

    const record = Core.conversion(occurrenceWith(list)).serves[0];
    // The same field EventsCore.seriesIdOf reads back.
    assert.strictEqual(EventsCore.seriesIdOf(record), 'midweek');
});

// ── The three-way switch every surface keys off ───────────────────────────────

test('unconfirmedCount is how many were never heard from', () => {
    let list = Core.assignToSlot([], { personId: 'p1', roleSlug: 'kids', slotId: 's1' }, { actorUid: 'u', at: 'T' });
    list = Core.assignToSlot(list, { personId: 'p2', roleSlug: 'kids', slotId: 's2' }, { actorUid: 'u', at: 'T' });
    list = Core.assignToSlot(list, { personId: 'p3', roleSlug: 'kids', slotId: 's3' }, { actorUid: 'u', at: 'T' });
    list = Core.setStateAt(list, 'kids', 's2', Core.STATES.CONFIRMED, { actorUid: 'u', at: 'T2' });
    list = Core.setStateAt(list, 'kids', 's3', Core.STATES.DECLINED, { actorUid: 'u', at: 'T2' });

    assert.strictEqual(Core.unconfirmedCount({ assignments: list }), 1);
});

test('nothing unconfirmed means nothing to render', () => {
    assert.strictEqual(Core.unconfirmedCount({ assignments: [] }), 0);
    assert.strictEqual(Core.unconfirmedCount({}), 0);
});

test('needsAttention is true only when something was declined', () => {
    let list = Core.assignToSlot([], { personId: 'p1', roleSlug: 'kids', slotId: 's1' }, { actorUid: 'u', at: 'T' });
    assert.strictEqual(Core.needsAttention({ assignments: list }), false, 'Pending is the calm resting state');

    list = Core.setStateAt(list, 'kids', 's1', Core.STATES.CONFIRMED, { actorUid: 'u', at: 'T2' });
    assert.strictEqual(Core.needsAttention({ assignments: list }), false);

    list = Core.setStateAt(list, 'kids', 's1', Core.STATES.DECLINED, { actorUid: 'u', at: 'T3' });
    assert.strictEqual(Core.needsAttention({ assignments: list }), true);
});

test('the three states map to three tones, and nothing else does', () => {
    assert.strictEqual(Core.stateTone({ state: Core.STATES.PENDING }), 'calm');
    assert.strictEqual(Core.stateTone({ state: Core.STATES.CONFIRMED }), 'good');
    assert.strictEqual(Core.stateTone({ state: Core.STATES.DECLINED }), 'attention');
    assert.strictEqual(Core.stateTone({}), 'calm', 'an unstamped assignment reads as Pending');
});

test('the state labels are the three words the UI shows', () => {
    assert.strictEqual(Core.stateLabel({ state: Core.STATES.PENDING }), 'Pending');
    assert.strictEqual(Core.stateLabel({ state: Core.STATES.CONFIRMED }), 'Confirmed');
    assert.strictEqual(Core.stateLabel({ state: Core.STATES.DECLINED }), 'Declined');
});

// ── Visibility ────────────────────────────────────────────────────────────────

test('the ladder is five rungs, in order', () => {
    assert.deepStrictEqual(Core.VISIBILITY_ORDER, ['public', 'member', 'participant', 'editor', 'elder']);
});

test('a rank sees its own rung and everything below it', () => {
    assert.strictEqual(Core.canSee('member', { visibility: 'public' }), true);
    assert.strictEqual(Core.canSee('member', { visibility: 'member' }), true);
    assert.strictEqual(Core.canSee('member', { visibility: 'editor' }), false);
    assert.strictEqual(Core.canSee('editor', { visibility: 'member' }), true);
    assert.strictEqual(Core.canSee('elder', { visibility: 'editor' }), true);
});

test('a participant sees a participant-level Event only when they hold a Role on it', () => {
    const occurrence = { visibility: 'participant', participantIds: ['p1'] };
    assert.strictEqual(Core.canSee('member', occurrence, 'p1'), true);
    assert.strictEqual(Core.canSee('member', occurrence, 'p2'), false);
});

test('an editor sees a participant-level Event without holding a Role on it', () => {
    const occurrence = { visibility: 'participant', participantIds: [] };
    assert.strictEqual(Core.canSee('editor', occurrence, 'p2'), true);
});

test('a signed-out visitor sees public Events and nothing else', () => {
    assert.strictEqual(Core.canSee(null, { visibility: 'public' }), true);
    assert.strictEqual(Core.canSee(null, { visibility: 'member' }), false);
    assert.strictEqual(Core.canSee(null, { visibility: 'participant', participantIds: [] }), false);
});

test('an Event with no visibility set is readable by nobody — it fails closed', () => {
    assert.strictEqual(Core.canSee('member', {}), false);
    assert.strictEqual(Core.canSee('elder', {}), false);
    assert.strictEqual(Core.canSee('member', { visibility: 'whatever' }), false);
});

test('the Sunday Service is permanently public', () => {
    assert.strictEqual(Core.visibilityOf({ seriesId: EventsCore.SUNDAY_SERVICE_ID }), 'public');
    assert.strictEqual(
        Core.visibilityOf({ seriesId: EventsCore.SUNDAY_SERVICE_ID, visibility: 'elder' }),
        'public',
        'even a stored value cannot make a Sunday private'
    );
    assert.strictEqual(Core.isVisibilityEditable({ seriesId: EventsCore.SUNDAY_SERVICE_ID }), false);
    assert.strictEqual(Core.isVisibilityEditable({ seriesId: 'midweek' }), true);
});

test('restamping a series applies its visibility to every occurrence, past ones included', () => {
    const occurrences = [
        { id: 'a', date: '2020-01-01', visibility: 'public' },
        { id: 'b', date: '2030-01-01', visibility: 'public' },
    ];
    const restamped = Core.restampVisibility(occurrences, 'elder', true);

    assert.deepStrictEqual(restamped.map(o => o.visibility), ['elder', 'elder']);
    assert.deepStrictEqual(restamped.map(o => o.rosterShared), [true, true]);
    assert.deepStrictEqual(occurrences.map(o => o.visibility), ['public', 'public'], 'the input is untouched');
});

// ── The query constraint (the most likely serious bug in this ticket) ─────────

test('a calendar query is constrained by the viewer’s rank, never left open', () => {
    const q = Core.visibilityQueryFor('member');
    assert.ok(Array.isArray(q.rungs) && q.rungs.length > 0,
        'an unconstrained query does not return fewer rows — it errors outright');
    assert.deepStrictEqual(q.rungs, ['public', 'member']);
});

test('an elder’s query still names its rungs rather than asking for everything', () => {
    assert.deepStrictEqual(
        Core.visibilityQueryFor('elder').rungs,
        ['public', 'member', 'participant', 'editor', 'elder']
    );
});

test('a signed-out query asks for public only', () => {
    const q = Core.visibilityQueryFor(null);
    assert.deepStrictEqual(q.rungs, ['public']);
    assert.strictEqual(q.participantId, null, 'there is no participant query when nobody is signed in');
});

test('a member’s query also asks for the Events they participate in', () => {
    const q = Core.visibilityQueryFor('member', 'p1');
    assert.strictEqual(q.participantId, 'p1');
    assert.strictEqual(q.rungs.indexOf('participant'), -1,
        'participant is answered by the array-contains query, not by rank');
});

test('the participant query pins the rung as well as the person', () => {
    // Holding a Role grants sight only at the `participant` rung. Left unpinned,
    // this query returns elder-level Events the member is a participant of, those
    // rows fail the rule, and the WHOLE read errors — an empty calendar for
    // somebody who should have seen plenty.
    assert.strictEqual(Core.visibilityQueryFor('member', 'p1').participantRung, 'participant');
});

test('a rank that already reaches participant runs no second query', () => {
    // An editor sees participant Events by rank, so asking again by participation
    // would only be work.
    assert.strictEqual(Core.visibilityQueryFor('editor', 'p1').participantId, null);
    assert.strictEqual(Core.visibilityQueryFor('elder', 'p1').participantId, null);
    assert.ok(Core.visibilityQueryFor('editor', 'p1').rungs.indexOf('participant') !== -1);
});

test('merging the two queries de-duplicates the Events that satisfy both', () => {
    const byRank = [{ id: 'a' }, { id: 'b' }];
    const byParticipation = [{ id: 'b' }, { id: 'c' }];
    assert.deepStrictEqual(
        Core.mergeVisibleOccurrences(byRank, byParticipation).map(o => o.id),
        ['a', 'b', 'c']
    );
});

// ── Reading an occurrence id back ─────────────────────────────────────────────
//
// The id is deterministic (`{seriesId}_{date}`) precisely so it can be built
// without asking the database. Reading it back matters for the same reason: a
// date nobody has touched has NO DOCUMENT, so opening one means reconstructing
// it from its id and its series.

test('an occurrence id reads back into the series and date it was built from', () => {
    assert.deepStrictEqual(Core.parseOccurrenceId('midweek_2026-07-15'),
        { seriesId: 'midweek', date: '2026-07-15' });
    // The Sunday Service's id has an underscore in it, which is exactly what a
    // naive split would get wrong.
    assert.deepStrictEqual(Core.parseOccurrenceId('sunday_service_2026-08-02'),
        { seriesId: 'sunday_service', date: '2026-08-02' });
});

test('an id that is not a series-and-date reads back as nothing', () => {
    // A one-off Event has an auto-id and no series, so there is nothing to
    // reconstruct — it either has a document or it does not exist.
    assert.strictEqual(Core.parseOccurrenceId('aB3xY9kLm'), null);
    assert.strictEqual(Core.parseOccurrenceId('midweek_not-a-date'), null);
    assert.strictEqual(Core.parseOccurrenceId(''), null);
    assert.strictEqual(Core.parseOccurrenceId(null), null);
});

test('an id round-trips through the pair it was built from', () => {
    const back = Core.parseOccurrenceId(Core.occurrenceId('sunday_service', '2026-12-25'));
    assert.deepStrictEqual(back, { seriesId: 'sunday_service', date: '2026-12-25' });
});
