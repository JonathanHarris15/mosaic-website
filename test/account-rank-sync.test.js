const { test } = require('node:test');
const assert = require('node:assert');

const Sync = require('../functions/account-rank-sync.js');
const Levels = require('../public/account-levels-core.js');

function account(preset, extra) {
    return Object.assign({}, Levels.userWriteFromLevel(Levels.BUILTIN_LEVEL_IDS[preset]), extra || {});
}

// Pure decision logic for the Person account-rank projection (MS-554 /
// MS-539 / MS-557). The Firestore trigger reconciles `people.accountRank`
// from the Person's live Linked User; these are the rules it wraps.

test('the field name is accountRank', () => {
    assert.equal(Sync.ACCOUNT_RANK_FIELD, 'accountRank');
});

test('rankFromUser is accessRank: a ladder field is viewer, not the string and not null', () => {
    assert.equal(Sync.rankFromUser({ permissionLevel: 'editor' }), 'viewer');
    assert.equal(Sync.rankFromUser({ role: 'member' }), 'viewer');
    assert.equal(
        Sync.rankFromUser({ permissionLevel: 'elder', role: 'member' }),
        'viewer');
    assert.equal(Sync.rankFromUser({}), 'viewer');
    assert.equal(Sync.rankFromUser(null), null);
    assert.equal(Sync.rankFromUser(undefined), null);
    assert.equal(Sync.rankFromUser('editor'), null);
});

test('a builtin account or a rank string projects that rank', () => {
    assert.equal(Sync.rankFromUser(account('editor')), 'editor');
    assert.equal(Sync.rankFromUser({ accountLevelId: 'level_member' }), 'member');
    assert.equal(Sync.rankFromUser({ accountLevelId: 'level_elder' }), 'elder');
    assert.equal(Sync.projectedAccountRank('uid-1', account('admin')), 'admin');
    assert.equal(Levels.accessRank('editor'), 'editor');
    assert.equal(Levels.accessRank('level_elder'), 'elder');
    assert.equal(Levels.accessRank('super_admin'), 'super_admin');
    assert.equal(Levels.accessRank('level_kiosk'), 'kiosk');
});

test('a Pastoral Assistant flag is not part of the projected rank', () => {
    assert.equal(Sync.rankFromUser({
        permissionLevel: 'editor', pastoralAssistant: true,
    }), 'viewer');
    assert.equal(Sync.rankFromUser(Object.assign(account('editor'), {
        pastoralAssistant: true,
    })), 'editor');
    assert.equal(Sync.rankFromUser(account('pastoral_assistant')), 'pastoral_assistant');
    assert.equal(Sync.rankFromUser({
        accountLevelId: 'level_pastoral_assistant',
    }), 'pastoral_assistant');
    assert.equal(Sync.rankFromUser({
        permissions: Levels.buildPresetPermissions('pastoral_assistant'),
    }), 'pastoral_assistant');
});

test('projectedAccountRank is null when there is no Linked User', () => {
    assert.equal(Sync.projectedAccountRank(null, account('elder')), null);
    assert.equal(Sync.projectedAccountRank('', account('member')), null);
    assert.equal(Sync.projectedAccountRank('uid-1', null), null);
    assert.equal(
        Sync.projectedAccountRank('uid-1', { permissionLevel: 'elder' }),
        'viewer');
    assert.equal(Sync.projectedAccountRank('uid-1', account('viewer')), 'viewer');
    assert.equal(Sync.projectedAccountRank('uid-1', account('elder')), 'elder');
});

test('a viewer is projected — member sync would skip them', () => {
    // The member-stage trigger returns early for viewer. This projection
    // must still write: a Linked viewer is the false-positive MS-539
    // exists to catch. A ladder field with no map is that same viewer.
    assert.equal(
        Sync.projectedAccountRank('uid-v', { permissionLevel: 'viewer' }),
        'viewer');
    assert.equal(Sync.projectedAccountRank('uid-v', {}), 'viewer');
    assert.equal(Sync.projectedAccountRank('uid-v', account('viewer')), 'viewer');
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
        account('member'));
    assert.deepEqual(linked, { next: 'member', needsWrite: true });

    const already = Sync.planPersonProjection(
        { userId: 'uid-1', accountRank: 'member' },
        account('member'));
    assert.equal(already.needsWrite, false);
    assert.equal(already.next, 'member');

    const promoted = Sync.planPersonProjection(
        { userId: 'uid-1', accountRank: 'member' },
        account('elder'));
    assert.deepEqual(promoted, { next: 'elder', needsWrite: true });

    const ladder = Sync.planPersonProjection(
        { userId: 'uid-1', accountRank: 'member' },
        { permissionLevel: 'elder' });
    assert.deepEqual(ladder, { next: 'viewer', needsWrite: true });
});

test('planPersonProjection clears the field on unlink', () => {
    const cleared = Sync.planPersonProjection(
        { userId: null, accountRank: 'editor' },
        account('editor'));
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
