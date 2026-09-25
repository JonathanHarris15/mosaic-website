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

test('reachability is a directory-editor write', async () => {
    const editor = fakeDb({'uid-1': {permissionLevel: 'editor'}});
    await assertWritesAsEditor(editor, {uid: 'uid-1'});
    await assert.rejects(
        () => assertWritesAsEditor(
            fakeDb({'uid-1': {permissionLevel: 'member', pastoralAssistant: true}}),
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
        'notificationDevices',
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
    assert.doesNotMatch(body, /request\.data/,
        'notificationTestPush reads the payload; it must only read auth.uid');
});

test('access-assert does not load firebase-functions (root npm test)', () => {
    const src = fs.readFileSync(
        path.join(__dirname, '..', 'functions', 'access-assert.js'),
        'utf8'
    );
    assert.doesNotMatch(src, /require\(["']firebase-functions/);
});
