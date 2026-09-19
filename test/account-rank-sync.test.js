const { test } = require('node:test');
const assert = require('node:assert');

const Sync = require('../functions/account-rank-sync.js');

// Pure decision logic for the Person account-rank projection (MS-554 /
// MS-539). The Firestore trigger reconciles `people.accountRank` from the
// Person's live Linked User; these are the rules it wraps.

test('the field name is accountRank', () => {
    assert.equal(Sync.ACCOUNT_RANK_FIELD, 'accountRank');
});

test('rankFromUser matches server rankOf: permissionLevel, then role', () => {
    assert.equal(Sync.rankFromUser({ permissionLevel: 'editor' }), 'editor');
    assert.equal(Sync.rankFromUser({ role: 'member' }), 'member');
    assert.equal(
        Sync.rankFromUser({ permissionLevel: 'elder', role: 'member' }),
        'elder');
    assert.equal(Sync.rankFromUser({}), null);
    assert.equal(Sync.rankFromUser(null), null);
    assert.equal(Sync.rankFromUser(undefined), null);
});

test('a Pastoral Assistant grant is not part of the projected rank', () => {
    // rankOf reads permissionLevel || role only. The grant lifts Event
    // rungs on the caller's own account, not on somebody else's Person.
    assert.equal(Sync.rankFromUser({
        permissionLevel: 'editor', pastoralAssistant: true,
    }), 'editor');
});

test('projectedAccountRank is null when there is no Linked User', () => {
    assert.equal(
        Sync.projectedAccountRank(null, { permissionLevel: 'elder' }),
        null);
    assert.equal(
        Sync.projectedAccountRank('', { permissionLevel: 'member' }),
        null);
    assert.equal(Sync.projectedAccountRank('uid-1', null), null);
    assert.equal(
        Sync.projectedAccountRank('uid-1', { permissionLevel: 'viewer' }),
        'viewer');
});

test('a viewer is projected — member sync would skip them', () => {
    // The member-stage trigger returns early for viewer. This projection
    // must still write: a Linked viewer is the false-positive MS-539
    // exists to catch.
    assert.equal(
        Sync.projectedAccountRank('uid-v', { permissionLevel: 'viewer' }),
        'viewer');
});

test('accountRankNeedsWrite is the skip-write that stops a loop', () => {
    assert.equal(Sync.accountRankNeedsWrite('member', 'member'), false);
    assert.equal(Sync.accountRankNeedsWrite(null, null), false);
    assert.equal(Sync.accountRankNeedsWrite(undefined, null), false);
    assert.equal(Sync.accountRankNeedsWrite('viewer', 'member'), true);
    assert.equal(Sync.accountRankNeedsWrite('elder', null), true);
    assert.equal(Sync.accountRankNeedsWrite(null, 'editor'), true);
});

test('planPersonProjection writes on link and permission change', () => {
    const linked = Sync.planPersonProjection(
        { userId: 'uid-1' },
        { permissionLevel: 'member' });
    assert.deepEqual(linked, { next: 'member', needsWrite: true });

    const already = Sync.planPersonProjection(
        { userId: 'uid-1', accountRank: 'member' },
        { permissionLevel: 'member' });
    assert.equal(already.needsWrite, false);
    assert.equal(already.next, 'member');

    const promoted = Sync.planPersonProjection(
        { userId: 'uid-1', accountRank: 'member' },
        { permissionLevel: 'elder' });
    assert.deepEqual(promoted, { next: 'elder', needsWrite: true });
});

test('planPersonProjection clears the field on unlink', () => {
    const cleared = Sync.planPersonProjection(
        { userId: null, accountRank: 'editor' },
        { permissionLevel: 'editor' });
    assert.deepEqual(cleared, { next: null, needsWrite: true });

    const alreadyClear = Sync.planPersonProjection(
        { userId: null },
        null);
    assert.equal(alreadyClear.needsWrite, false);
    assert.equal(alreadyClear.next, null);
});

test('personIdsToReconcile covers link, unlink, relink, and delete', () => {
    assert.deepEqual(
        Sync.personIdsToReconcile(null, { personId: 'p1' }),
        ['p1']);
    assert.deepEqual(
        Sync.personIdsToReconcile({ personId: 'p1' }, { personId: 'p1' }),
        ['p1']);
    assert.deepEqual(
        Sync.personIdsToReconcile({ personId: 'p1' }, null),
        ['p1']);
    assert.deepEqual(
        Sync.personIdsToReconcile({ personId: 'p1' }, { personId: 'p2' }),
        ['p2', 'p1']);
    assert.deepEqual(
        Sync.personIdsToReconcile(null, null),
        []);
    assert.deepEqual(
        Sync.personIdsToReconcile({}, { role: 'member' }),
        []);
});
