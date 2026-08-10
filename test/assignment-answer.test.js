const { test } = require('node:test');
const assert = require('node:assert');

const aa = require('../functions/assignment-answer.js');
const CoverStore = require('../public/cover-store.js');

// A member answering their own Assignment (MS-20).
//
// ⚠ WHY THIS CANNOT BE A BROWSER WRITE. Answering changes two documents at
// once: the person's row in the occurrence's `roster` subcollection, and the
// occurrence's own derived fields. The occurrence is editor-only to write for
// good reason — opening it to members would let one restamp `visibility` or
// `participantIds`, which is what the whole five-rung ladder rests on. And the
// two writes must be atomic, or the derived fields drift from the roster they
// describe.
//
// So this module decides, a callable writes, and the decision is pure so it can
// be tested without Firestore.

const OCCURRENCE = {
    id: 'midweek_2026-08-14',
    seriesId: 'midweek',
    date: '2026-08-14',
    name: 'Midweek',
    visibility: 'member',
};

const ROSTER = [
    { roleSlug: 'kids', slotId: 's1', personId: 'carl', state: 'pending' },
    { roleSlug: 'kids', slotId: 's2', personId: 'alice', state: 'confirmed' },
];

const plan = (over) => aa.planAnswer(Object.assign({
    occurrence: OCCURRENCE,
    roster: ROSTER,
    personId: 'carl',
    roleSlug: 'kids',
    slotId: 's1',
    state: 'confirmed',
    today: '2026-08-07',
}, over || {}));

// ── What it refuses ──────────────────────────────────────────────────────────

test('answering somebody else’s Assignment is refused', () => {
    const result = plan({ personId: 'dan' });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'permission-denied');
});

test('claiming a slot nobody is standing in is refused', () => {
    const result = plan({ slotId: 's9' });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'not-found');
});

test('answering a slot somebody else holds is refused, not silently applied', () => {
    const result = plan({ slotId: 's2' });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'permission-denied');
});

test('a date already past can no longer be answered', () => {
    const result = plan({ today: '2026-08-20' });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'failed-precondition');
});

test('the day itself can still be answered — it has not happened yet', () => {
    assert.equal(plan({ today: '2026-08-14' }).ok, true);
});

test('only confirmed and declined are answers a person can give', () => {
    assert.equal(plan({ state: 'pending' }).code, 'invalid-argument');
    assert.equal(plan({ state: 'maybe' }).code, 'invalid-argument');
    assert.equal(plan({ state: null }).code, 'invalid-argument');
});

test('a caller with no Person record is refused', () => {
    assert.equal(plan({ personId: null }).code, 'permission-denied');
});

// ── Confirming ───────────────────────────────────────────────────────────────

test('confirming sets the state and nothing else about the roster moves', () => {
    const result = plan({ state: 'confirmed' });
    assert.equal(result.ok, true);
    assert.equal(result.assignment.state, 'confirmed');
    assert.equal(result.assignment.personId, 'carl');
    assert.equal(result.assignment.roleSlug, 'kids');
    assert.equal(result.assignment.slotId, 's1');
});

test('confirming records who answered and when, not just what', () => {
    const result = plan({ state: 'confirmed' });
    assert.equal(result.assignment.stateSetBy, 'carl');
    assert.ok('stateSetAt' in result.assignment);
});

test('confirming clears any cover entry the place had', () => {
    const declined = [
        { roleSlug: 'kids', slotId: 's1', personId: 'carl', state: 'declined' },
    ];
    const result = plan({ roster: declined, state: 'confirmed' });
    assert.equal(result.cover.action, 'delete');
});

// ── Declining ────────────────────────────────────────────────────────────────

test('declining puts the place on the cover list', () => {
    const result = plan({ state: 'declined' });
    assert.equal(result.ok, true);
    assert.equal(result.cover.action, 'set');
    assert.equal(result.cover.entry.date, '2026-08-14');
    assert.equal(result.cover.entry.eventName, 'Midweek');
});

test('declining does NOT drop you from participantIds — you keep sight of it', () => {
    const result = plan({ state: 'declined' });
    assert.ok(result.derived.participantIds.indexOf('carl') !== -1,
        'ADR-0018 §5: a decliner keeps the Event until somebody else takes the slot');
});

test('declining raises the flag an editor already reads', () => {
    const result = plan({ state: 'declined' });
    assert.equal(result.derived.needsAttention, true);
});

test('the last decline going away lowers the flag again', () => {
    const declined = [
        { roleSlug: 'kids', slotId: 's1', personId: 'carl', state: 'declined' },
        { roleSlug: 'kids', slotId: 's2', personId: 'alice', state: 'confirmed' },
    ];
    const result = plan({ roster: declined, state: 'confirmed' });
    assert.equal(result.derived.needsAttention, false);
});

test('somebody else’s decline keeps the flag up', () => {
    const declined = [
        { roleSlug: 'kids', slotId: 's1', personId: 'carl', state: 'pending' },
        { roleSlug: 'kids', slotId: 's2', personId: 'alice', state: 'declined' },
    ];
    const result = plan({ roster: declined, state: 'confirmed' });
    assert.equal(result.derived.needsAttention, true);
});

// ── Which places reach the list ──────────────────────────────────────────────

test('a participant-rung Event’s place never reaches the cover list', () => {
    const result = plan({
        occurrence: Object.assign({}, OCCURRENCE, { visibility: 'participant' }),
        state: 'declined',
    });
    assert.equal(result.ok, true, 'the decline itself still stands');
    assert.equal(result.cover.action, 'none');
});

test('a Sunday’s place is stamped public, whatever the document holds', () => {
    const result = plan({
        occurrence: {
            id: 'sunday_service_2026-08-16',
            seriesId: 'sunday_service',
            date: '2026-08-16',
            name: 'Sunday Service',
        },
        state: 'declined',
    });
    assert.equal(result.cover.entry.visibility, 'public');
});

test('an occurrence with no visibility puts nothing on the list — fails closed', () => {
    const result = plan({
        occurrence: Object.assign({}, OCCURRENCE, { visibility: null }),
        state: 'declined',
    });
    assert.equal(result.cover.action, 'none');
});

// ── The two sides must not drift ─────────────────────────────────────────────
//
// `functions/` deploys as its own bundle and cannot require from `public/`, so
// the cover entry's id scheme and shape are RESTATED there. That is the same
// trade assignment-conversion.js already makes with the assignment states, and
// this is the test that holds the two together.

test('the server builds the same cover id the client reads', () => {
    assert.equal(
        aa.coverId('midweek_2026-08-14', 'kids', 's1'),
        CoverStore.coverId('midweek_2026-08-14', 'kids', 's1')
    );
    assert.equal(
        aa.coverId('o1', 'kids', null),
        CoverStore.coverId('o1', 'kids', null)
    );
});

test('the server writes the same cover entry shape the client reads', () => {
    const server = plan({ state: 'declined' }).cover.entry;
    const client = CoverStore.entryFor(
        OCCURRENCE,
        { roleSlug: 'kids', slotId: 's1', personId: 'carl' },
        server.roleName
    );
    assert.deepEqual(Object.keys(server).sort(), Object.keys(client).sort());
    assert.deepEqual(server, client);
});

test('the server agrees with the client about which places belong on the list', () => {
    ['public', 'member', 'participant', 'editor', 'elder', null].forEach(rung => {
        const occurrence = Object.assign({}, OCCURRENCE, { visibility: rung });
        assert.equal(
            aa.belongsOnList(occurrence),
            CoverStore.belongsOnList(occurrence),
            'disagreed about ' + rung
        );
    });
});
