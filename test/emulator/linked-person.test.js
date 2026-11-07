const { describe, test, before, beforeEach } = require('node:test');
const assert = require('node:assert');

const H = require('./harness.js');
const { callerOf } = require('../../functions/linked-person.js');

// MS-811. The Roles callables act for "the caller's own Person". A caller only
// counts as a Person when the link agrees both ways: users/{uid}.personId AND
// people/{personId}.userId.

const suite = H.skipReason
    ? (name) => test(name, { skip: H.skipReason }, () => {})
    : describe;

suite('who the caller is, as a Person (MS-811)', () => {
    let db;
    before(() => { db = H.connect(); });
    beforeEach(async () => {
        await H.wipe();
        await db.doc('people/p-ann').set({ name: 'Ann', userId: 'uid-ann' });
        await db.doc('users/uid-ann').set({ personId: 'p-ann', accountLevelId: 'level_member' });
    });

    test('a link that agrees both ways is the caller\'s Person', async () => {
        const c = await callerOf(db, 'uid-ann');
        assert.equal(c.personId, 'p-ann');
        assert.equal(c.user.accountLevelId, 'level_member');
    });

    test('an account claiming a Person who does not point back is nobody', async () => {
        await db.doc('users/uid-stranger').set({ personId: 'p-ann', accountLevelId: 'level_member' });
        const c = await callerOf(db, 'uid-stranger');
        assert.equal(c.personId, null);
    });

    test('a claimed Person who no longer exists is nobody', async () => {
        await db.doc('users/uid-ghost').set({ personId: 'p-gone' });
        assert.equal((await callerOf(db, 'uid-ghost')).personId, null);
    });

    test('no account at all is nobody, with an empty account', async () => {
        const c = await callerOf(db, 'uid-none');
        assert.equal(c.personId, null);
        assert.deepEqual(c.user, {});
    });
});
