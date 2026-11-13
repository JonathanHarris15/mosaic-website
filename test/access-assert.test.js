const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
    assertCanDecide,
    assertWritesAsEditor,
    assertIsAdmin,
} = require('../functions/access-assert.js');
const Levels = require('../public/account-levels-core.js');

function account(preset, extra) {
    return Object.assign({}, Levels.userWriteFromLevel(Levels.BUILTIN_LEVEL_IDS[preset]), extra || {});
}

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
    await decide(account('pastoral_assistant'));
    await decide({accountLevelId: 'level_pastoral_assistant'});
    await decide('pastoral_assistant');
});

test('an elder and a super admin may send a prayer request', async () => {
    await decide(account('elder'));
    await decide(account('super_admin'));
    await decide('elder');
});

test('a plain member is refused', async () => {
    await denied(account('member'));
    await denied({permissionLevel: 'member'});
    await denied({permissionLevel: 'member', pastoralAssistant: false});
});

test('a ladder flag is not a Pastoral Assistant', async () => {
    await denied({permissionLevel: 'member', pastoralAssistant: true});
    await denied({permissionLevel: 'pastoral_assistant'});
    await denied({role: 'elder'});
});

test('an editor without the grant is refused', async () => {
    await denied(account('editor'));
    await denied({permissionLevel: 'editor'});
    await denied('editor');
});

test('a missing account is unauthenticated', async () => {
    await assert.rejects(
        () => assertCanDecide(fakeDb({}), null),
        (err) => err && err.code === 'unauthenticated'
    );
});

test('reachability is a directory-editor write, and a Pastoral Assistant has it', async () => {
    await assertWritesAsEditor(fakeDb({'uid-1': account('editor')}), {uid: 'uid-1'});
    await assertWritesAsEditor(fakeDb({'uid-1': 'editor'}), {uid: 'uid-1'});
    await assertWritesAsEditor(
        fakeDb({'uid-1': account('pastoral_assistant')}),
        {uid: 'uid-1'});
    await assertWritesAsEditor(
        fakeDb({'uid-1': {accountLevelId: 'level_pastoral_assistant'}}),
        {uid: 'uid-1'});
    await assert.rejects(
        () => assertWritesAsEditor(
            fakeDb({'uid-1': {permissionLevel: 'editor'}}),
            {uid: 'uid-1'}),
        (err) => err && err.code === 'permission-denied'
    );
    await assert.rejects(
        () => assertWritesAsEditor(
            fakeDb({'uid-1': {permissionLevel: 'member', pastoralAssistant: true}}),
            {uid: 'uid-1'}),
        (err) => err && err.code === 'permission-denied'
    );
    await assert.rejects(
        () => assertWritesAsEditor(
            fakeDb({'uid-1': account('member')}),
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

test('an admin and a super admin run the dashboard; a ladder field does not', async () => {
    await assertIsAdmin(fakeDb({'uid-1': account('admin')}), {uid: 'uid-1'});
    await assertIsAdmin(fakeDb({'uid-1': account('super_admin')}), {uid: 'uid-1'});
    await assertIsAdmin(fakeDb({'uid-1': 'admin'}), {uid: 'uid-1'});
    await assertIsAdmin(fakeDb({'uid-1': 'super_admin'}), {uid: 'uid-1'});
    await assert.rejects(
        () => assertIsAdmin(fakeDb({'uid-1': {permissionLevel: 'admin'}}), {uid: 'uid-1'}),
        (err) => err && err.code === 'permission-denied'
    );
    await assert.rejects(
        () => assertIsAdmin(fakeDb({'uid-1': {role: 'admin'}}), {uid: 'uid-1'}),
        (err) => err && err.code === 'permission-denied'
    );
});

test('an elder, an editor and a Pastoral Assistant are not admins', async () => {
    const refused = async (who) => {
        await assert.rejects(
            () => assertIsAdmin(fakeDb({'uid-1': who}), {uid: 'uid-1'}),
            (err) => err && err.code === 'permission-denied'
        );
    };
    await refused(account('elder'));
    await refused(account('editor'));
    await refused(account('pastoral_assistant'));
    await refused(account('viewer'));
    await refused({permissionLevel: 'elder'});
    await refused({permissionLevel: 'editor'});
    await refused({permissionLevel: 'member', pastoralAssistant: true});
    await refused({permissionLevel: 'admin'});
    await refused({role: 'super_admin'});
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

test('a builtin accountLevelId with no permissions field may edit a Sunday; a ladder field may not', async () => {
    await editsServices({accountLevelId: 'level_editor'});
    await editsServices(account('editor'));
    await editsServices('editor');
    await assert.rejects(() => editsServices({permissionLevel: 'editor'}),
        (err) => err && err.code === 'permission-denied');
    await assert.rejects(() => editsServices({permissionLevel: 'member'}),
        (err) => err && err.code === 'permission-denied');
    await assert.rejects(() => editsServices({role: 'elder'}),
        (err) => err && err.code === 'permission-denied');
    await assert.rejects(
        () => editsServices({accountLevelId: 'level_editor', permissions: null}),
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
