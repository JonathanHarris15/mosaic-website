const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {assertCanDecide} = require('../functions/access-assert.js');

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
