const { test } = require('node:test');
const assert = require('node:assert');

const at = require('../functions/assignment-take.js');

// A member taking an Assignment off the cover list (MS-20, ADR-0030).
//
// ⚠ THE ELIGIBILITY VERDICT IS AN INPUT, NOT A DECISION MADE HERE. Whether this
// Person may take this place is `cover-core`'s question, and answering it needs
// the whole of RolesCore. This module decides what the WRITE looks like once
// that verdict is known — which is a separate question, and the one with the
// race in it.
//
// ⚠ A ROSTER ROW'S ID CONTAINS THE personId, so a place changing hands is a
// DELETE plus a CREATE, never an update. Getting that wrong leaves two people
// standing in one slot.

const OCCURRENCE = {
    id: 'midweek_2026-08-14',
    seriesId: 'midweek',
    date: '2026-08-14',
    name: 'Midweek',
    visibility: 'member',
};

const ROSTER = [
    { roleSlug: 'kids', slotId: 's1', personId: 'carl', state: 'declined' },
    { roleSlug: 'kids', slotId: 's2', personId: 'alice', state: 'confirmed' },
];

const PERMITTED = { permitted: true, reason: null, warning: null };

const plan = (over) => at.planTake(Object.assign({
    occurrence: OCCURRENCE,
    roster: ROSTER,
    personId: 'dan',
    roleSlug: 'kids',
    slotId: 's1',
    verdict: PERMITTED,
    today: '2026-08-07',
}, over || {}));

// ── What it refuses ──────────────────────────────────────────────────────────

test('an ineligible person is refused by the server, not only by the screen', () => {
    const result = plan({
        verdict: { permitted: false, reason: 'sexMismatch' },
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'failed-precondition');
    assert.equal(result.reason, 'sexMismatch');
});

test('a missing verdict is a refusal — it never defaults to yes', () => {
    assert.equal(plan({ verdict: null }).ok, false);
    assert.equal(plan({ verdict: undefined }).ok, false);
});

test('a caller with no Person record is refused', () => {
    assert.equal(plan({ personId: null }).code, 'permission-denied');
});

// One code covers this and the lost race below, because from a freshly read
// roster THE TWO ARE INDISTINGUISHABLE: "Alice was always confirmed in s2" and
// "Carl declined s1 and Erin has taken it" both read as a place that is not
// going spare. Inventing a second code would mean guessing which happened.
test('a place nobody has declined is not going spare', () => {
    const result = plan({ slotId: 's2' });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'aborted');
});

test('a slot nobody is standing in cannot be taken from the list', () => {
    assert.equal(plan({ slotId: 's9' }).code, 'not-found');
});

test('a date already past cannot be covered', () => {
    assert.equal(plan({ today: '2026-08-20' }).code, 'failed-precondition');
});

test('taking back your own declined place is refused — that is confirming', () => {
    const result = plan({ personId: 'carl' });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'failed-precondition');
});

// ── Losing the race ──────────────────────────────────────────────────────────
//
// Nothing is reserved while somebody is looking at the list, so two people can
// press Take at the same moment. The transaction re-reads and this decides.

test('somebody else having taken it first is a clean, explained refusal', () => {
    const taken = [
        { roleSlug: 'kids', slotId: 's1', personId: 'erin', state: 'confirmed' },
    ];
    const result = plan({ roster: taken });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'aborted');
    assert.ok(/already/i.test(result.message));
});

test('an editor having refilled it underneath is the same clean refusal', () => {
    const refilled = [
        { roleSlug: 'kids', slotId: 's1', personId: 'frank', state: 'pending' },
    ];
    assert.equal(plan({ roster: refilled }).code, 'aborted');
});

// ── Taking it ────────────────────────────────────────────────────────────────

test('the place becomes theirs, already Confirmed — they chose it', () => {
    const result = plan();
    assert.equal(result.ok, true);
    assert.equal(result.assignment.personId, 'dan');
    assert.equal(result.assignment.state, 'confirmed');
    assert.equal(result.assignment.roleSlug, 'kids');
    assert.equal(result.assignment.slotId, 's1');
});

test('the old row is DELETED and a new one created — the id carries the person', () => {
    const result = plan();
    assert.equal(result.removeRosterId, 'kids__s1__carl');
    assert.equal(result.rosterId, 'kids__s1__dan');
    assert.notEqual(result.removeRosterId, result.rosterId);
});

test('the previous holder loses sight of the Event the moment it is taken', () => {
    const result = plan();
    assert.ok(result.derived.participantIds.indexOf('carl') === -1,
        'ADR-0018 §5: the decliner keeps it only until somebody else takes it');
    assert.ok(result.derived.participantIds.indexOf('dan') !== -1);
});

test('taking the last declined place lowers the editor’s flag', () => {
    const result = plan();
    assert.equal(result.derived.needsAttention, false);
});

test('another declined place elsewhere keeps the flag up', () => {
    const two = [
        { roleSlug: 'kids', slotId: 's1', personId: 'carl', state: 'declined' },
        { roleSlug: 'coffee', slotId: 's1', personId: 'alice', state: 'declined' },
    ];
    const result = plan({ roster: two });
    assert.equal(result.derived.needsAttention, true);
});

test('the place leaves the cover list in the same write', () => {
    const result = plan();
    assert.equal(result.cover.action, 'delete');
    assert.equal(result.cover.id, 'midweek_2026-08-14__kids__s1');
});

test('taking it records who took it and when', () => {
    const result = plan({ now: 'STAMP' });
    assert.equal(result.assignment.stateSetBy, 'dan');
    assert.equal(result.assignment.stateSetAt, 'STAMP');
});

test('a warning on the verdict is carried back, not swallowed', () => {
    const result = plan({
        verdict: { permitted: true, reason: null, warning: 'away' },
    });
    assert.equal(result.ok, true);
    assert.equal(result.warning, 'away',
        'they marked themselves away and took it anyway — they should be told');
});

test('nothing of the previous holder’s survives onto the new row', () => {
    const withExtras = [{
        roleSlug: 'kids', slotId: 's1', personId: 'carl', state: 'declined',
        stateSetBy: 'carl', stateSetAt: 'EARLIER', label: 'Kids Ministry',
    }];
    const result = plan({ roster: withExtras, now: 'NOW' });
    assert.equal(result.assignment.personId, 'dan');
    assert.equal(result.assignment.stateSetBy, 'dan');
    assert.equal(result.assignment.stateSetAt, 'NOW');
    assert.equal(result.assignment.label, 'Kids Ministry',
        'the place keeps its own label; only the person changes');
});
