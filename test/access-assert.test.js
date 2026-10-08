const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
    assertCanDecide,
    assertWritesAsEditor,
    assertIsAdmin,
} = require('../functions/access-assert.js');

// MS-594 — sendPrayerRequestNow (and any other canDecide callable) must
// admit a Pastoral Assistant the same way AccessCore does. Counted-as-elder
// stays false; a plain member is still refused.

function fakeDb(users) {
    return {
        collection(name) {
            return {
                doc(id) {
                    return {
                        get: async () => {
                            const data = name === 'users' ? users[id] : undefined;
                            return {exists: !!data, data: () => data};
                        },
                    };
                },
            };
        },
    };
}

async function decide(account) {
    const db = fakeDb({'uid-1': account});
    await assertCanDecide(db, {uid: 'uid-1'});
}

async function denied(account) {
    await assert.rejects(
        () => decide(account),
        (err) => err && err.code === 'permission-denied'
    );
}

test('a Pastoral Assistant may send a prayer request', async () => {
    await decide({permissionLevel: 'member', pastoralAssistant: true});
});

test('an elder and a super admin may send a prayer request', async () => {
    await decide({permissionLevel: 'elder'});
    await decide({permissionLevel: 'super_admin'});
});

test('a plain member is refused', async () => {
    await denied({permissionLevel: 'member'});
    await denied({permissionLevel: 'member', pastoralAssistant: false});
});

test('an editor without the grant is refused', async () => {
    await denied({permissionLevel: 'editor'});
});

test('a missing account is unauthenticated', async () => {
    await assert.rejects(
        () => assertCanDecide(fakeDb({}), null),
        (err) => err && err.code === 'unauthenticated'
    );
});

test('reachability is a directory-editor write, and a Pastoral Assistant has it', async () => {
    const editor = fakeDb({'uid-1': {permissionLevel: 'editor'}});
    await assertWritesAsEditor(editor, {uid: 'uid-1'});
    await assertWritesAsEditor(
        fakeDb({'uid-1': {permissionLevel: 'pastoral_assistant'}}),
        {uid: 'uid-1'});
    await assertWritesAsEditor(
        fakeDb({'uid-1': {permissionLevel: 'member', pastoralAssistant: true}}),
        {uid: 'uid-1'});
    await assert.rejects(
        () => assertWritesAsEditor(
            fakeDb({'uid-1': {permissionLevel: 'member'}}),
            {uid: 'uid-1'}),
        (err) => err && err.code === 'permission-denied'
    );
});

test('notificationReachability returns user ids and not tokens', () => {
    const src = fs.readFileSync(
        path.join(__dirname, '..', 'functions', 'index.js'),
        'utf8'
    );
    const start = src.indexOf('exports.notificationReachability');
    assert.ok(start !== -1);
    const body = src.slice(start, start + 450);
    assert.match(body, /assertWritesAsEditor/);
    assert.match(body, /return \{uids\}/);
    assert.doesNotMatch(body, /token/);
});

test('sendPrayerRequestNow asks assertCanDecide, not counted-as-elder', () => {
    const src = fs.readFileSync(
        path.join(__dirname, '..', 'functions', 'index.js'),
        'utf8'
    );
    const start = src.indexOf('exports.sendPrayerRequestNow');
    assert.ok(start !== -1, 'sendPrayerRequestNow is gone');
    const head = src.slice(start, start + 600);
    assert.match(head, /await assertCanDecide\(db, request\.auth\)/);
    assert.doesNotMatch(head, /assertElder/);
    assert.doesNotMatch(src, /async function assertElder/);
});

// MS-682 — the Push notifications tab reaches other people's Device tokens,
// which the rules keep from every client. The callables are the only door.

test('an admin and a super admin run the dashboard; nobody else does', async () => {
    await assertIsAdmin(fakeDb({'uid-1': {permissionLevel: 'admin'}}), {uid: 'uid-1'});
    await assertIsAdmin(fakeDb({'uid-1': {permissionLevel: 'super_admin'}}), {uid: 'uid-1'});
    // The legacy `role` field, still written beside permissionLevel (MS-119).
    await assertIsAdmin(fakeDb({'uid-1': {role: 'admin'}}), {uid: 'uid-1'});
});

test('an elder, an editor and a Pastoral Assistant are not admins', async () => {
    const refused = async (account) => {
        await assert.rejects(
            () => assertIsAdmin(fakeDb({'uid-1': account}), {uid: 'uid-1'}),
            (err) => err && err.code === 'permission-denied'
        );
    };
    await refused({permissionLevel: 'elder'});
    await refused({permissionLevel: 'editor'});
    await refused({permissionLevel: 'member', pastoralAssistant: true});
    await refused({permissionLevel: 'viewer'});
    await refused({});
});

test('an account that does not exist, and no sign-in at all, are both refused', async () => {
    await assert.rejects(
        () => assertIsAdmin(fakeDb({}), {uid: 'ghost'}),
        (err) => err && err.code === 'permission-denied'
    );
    await assert.rejects(
        () => assertIsAdmin(fakeDb({}), null),
        (err) => err && err.code === 'unauthenticated'
    );
});

test('every Push notifications callable asks assertAdmin before it reads anything', () => {
    const src = fs.readFileSync(
        path.join(__dirname, '..', 'functions', 'index.js'),
        'utf8'
    );
    const gated = [
        'notificationOverview',
        'notificationHistory',
        'notificationRevokeToken',
        'notificationTestPush',
    ];
    gated.forEach((name) => {
        const start = src.indexOf('exports.' + name + ' = onCall');
        assert.ok(start !== -1, name + ' is not exported');
        const head = src.slice(start, start + 400);
        assert.match(head, /await assertAdmin\(db, request\.auth/,
            name + ' does not gate on assertAdmin');
        const gateAt = head.indexOf('assertAdmin');
        const workAt = head.indexOf('notificationAdminDeps');
        assert.ok(workAt === -1 || gateAt < workAt,
            name + ' touches Firestore before it checks the caller');
    });
});

test('the test push addresses the caller and nothing the browser sent', () => {
    const src = fs.readFileSync(
        path.join(__dirname, '..', 'functions', 'index.js'),
        'utf8'
    );
    const start = src.indexOf('exports.notificationTestPush = onCall');
    const body = src.slice(start, src.indexOf(');', src.indexOf('log(', start)));
    assert.match(body, /callerUid: request\.auth\.uid/);

    // The payload carries exactly one thing, and it cannot aim anything: the
    // second press. Everything the browser could say about a RECIPIENT — a
    // uid, a person, a token, a number — must be unread here.
    const fields = (body.match(/request\.data(?:\s*\|\|\s*\{\})?\)?\.(\w+)/g) || [])
        .map((hit) => hit.split('.').pop());
    assert.deepEqual(fields, ['confirm'],
        'notificationTestPush reads ' + fields.join(', ') + ' off the payload; ' +
        'only confirm may be read there');
});

test('revoking and test-pushing both carry the confirmation to the server', () => {
    const index = fs.readFileSync(
        path.join(__dirname, '..', 'functions', 'index.js'), 'utf8');
    const admin = fs.readFileSync(
        path.join(__dirname, '..', 'functions', 'notification-admin.js'), 'utf8');
    const page = fs.readFileSync(
        path.join(__dirname, '..', 'public', 'admin-dashboard.js'), 'utf8');

    ['notificationRevokeToken', 'notificationTestPush'].forEach((name) => {
        const start = index.indexOf('exports.' + name + ' = onCall');
        const head = index.slice(start, start + 700);
        assert.match(head, /confirm:/,
            name + ' does not pass the confirmation through to the gate');
    });
    ['revokeToken', 'testPushToSelf'].forEach((fn) => {
        const start = admin.indexOf('async function ' + fn + '(');
        assert.ok(start !== -1, fn + ' is gone');
        assert.match(admin.slice(start, start + 400), /requireConfirm\(/,
            fn + ' no longer demands a confirmation');
    });
    assert.match(page, /PUSH_TAB_CALLABLES\.revoke\)\(\{\s*\n\s*confirm: true,/,
        'the page revokes without saying the user confirmed');
    assert.match(page, /PUSH_TAB_CALLABLES\.testPush\)\(\{\s*\n\s*confirm: true,/,
        'the page test-pushes without saying the user confirmed');
});

test('access-assert does not load firebase-functions (root npm test)', () => {
    const src = fs.readFileSync(
        path.join(__dirname, '..', 'functions', 'access-assert.js'),
        'utf8'
    );
    assert.doesNotMatch(src, /require\(["']firebase-functions/);
});

// MS-715 follow-up — the oosUpdateLiturgy callable read `permissionLevel` /
// `role` itself, with a hard-coded list, from before MS-695. Access now
// comes from the Account Level's permissions map (`services.builder.edit`),
// so the gate must ask AccessCore the same question the pages do.
const {assertEditsServices} = require('../functions/access-assert.js');

async function editsServices(account) {
    await assertEditsServices(fakeDb({'uid-1': account}), {uid: 'uid-1'});
}

test('a custom Account Level with services.builder.edit may write a Sunday, whatever its permissionLevel string says', async () => {
    await editsServices({
        accountLevelId: 'liturgy-team', permissionLevel: 'member',
        permissions: {'services.builder.view': true, 'services.builder.edit': true},
    });
});

test('a permissions map without services.builder.edit is refused even if a stale string says editor', async () => {
    await assert.rejects(
        () => editsServices({
            accountLevelId: 'readers', permissionLevel: 'editor',
            permissions: {'services.builder.view': true},
        }),
        (err) => err && err.code === 'permission-denied' && /editors only/i.test(err.message)
    );
});

test('a legacy editor with no permissions map still may; a member may not', async () => {
    await editsServices({permissionLevel: 'editor'});
    await assert.rejects(() => editsServices({permissionLevel: 'member'}),
        (err) => err && err.code === 'permission-denied');
});

test('no sign-in is unauthenticated', async () => {
    await assert.rejects(() => assertEditsServices(fakeDb({}), null),
        (err) => err && err.code === 'unauthenticated');
});

test('oosUpdateLiturgy asks assertEditsServices, not a permissionLevel list', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'functions', 'index.js'), 'utf8');
    const start = src.indexOf('exports.oosUpdateLiturgy');
    const body = src.slice(start, src.indexOf('exports.', start + 10));
    assert.match(body, /assertEditsServicesCore\(db, request\.auth\)/);
    assert.doesNotMatch(body, /permissionLevel/);
    assert.doesNotMatch(body, /\["editor", "elder", "admin", "super_admin"\]/);
});
