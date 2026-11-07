const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// Live security-rule probes on the Roles system (Nov 2026 stress round).
// Every other rules test in test/ reads firestore.rules as TEXT; these ask the
// emulator's real rules engine.

const HOST = process.env.FIRESTORE_EMULATOR_HOST || '';
const suite = HOST ? describe : (name) => test(name, { skip: 'no emulator' }, () => {});

suite('Roles: what the rules actually let through', () => {
    let RT, env;
    const ctx = (uid) => env.authenticatedContext(uid, { firebase: { sign_in_provider: 'password' } }).firestore();

    before(async () => {
        RT = require('@firebase/rules-unit-testing');
        const [host, port] = HOST.split(':');
        env = await RT.initializeTestEnvironment({
            projectId: 'demo-roles-rules-stress',
            firestore: {
                host, port: Number(port),
                rules: fs.readFileSync(path.join(__dirname, '../../firestore.rules'), 'utf8'),
            },
        });
    });
    after(async () => { if (env) await env.cleanup(); });

    beforeEach(async () => {
        await env.clearFirestore();
        await env.withSecurityRulesDisabled(async (c) => {
            const db = c.firestore();
            await db.doc('users/uid-ann').set({ personId: 'p-ann', accountLevelId: 'level_member' });
            await db.doc('users/uid-bob').set({ personId: 'p-bob', accountLevelId: 'level_member' });
            await db.doc('users/uid-viewer').set({ accountLevelId: 'level_viewer' });
            // A custom account level that only edits hymns.
            await db.doc('users/uid-hymns').set({ personId: 'p-h', permissions: { 'core.sign_in': true, 'hymns.edit': true } });
            // A custom level that only manages Roles.
            await db.doc('users/uid-rolesmgr').set({ personId: 'p-r', permissions: { 'core.sign_in': true, 'roles.manager.edit': true } });
            await db.doc('people/p-ann').set({ name: 'Ann', tags: [] });
            await db.doc('people/p-bob').set({ name: 'Bob', tags: [] });
            await db.doc('people/p-ann/involvement/i1').set({ type: 'ushers', date: '2026-01-04' });
            await db.doc('roles/ushers').set({ slug: 'ushers', name: 'Ushers', family: 'servant',
                slots: [{ id: 's1', requirement: 'either' }],
                restrictions: [{ kind: 'allowlist', personIds: ['p-ann', 'p-bob'] }] });
            await db.doc('event_occurrences/o1').set({ date: '2026-03-14', visibility: 'member', participantIds: ['p-ann', 'p-bob'], rosterShared: false });
            await db.doc('event_occurrences/o1/roster/ushers__s1__p-ann').set({ roleSlug: 'ushers', slotId: 's1', personId: 'p-ann', state: 'pending' });
            await db.doc('event_occurrences/o1/roster/ushers__s2__p-bob').set({ roleSlug: 'ushers', slotId: 's2', personId: 'p-bob', state: 'pending' });
        });
    });

    test('a member cannot read somebody else\'s roster row', async () => {
        await RT.assertFails(ctx('uid-ann').doc('event_occurrences/o1/roster/ushers__s2__p-bob').get());
        await RT.assertSucceeds(ctx('uid-ann').doc('event_occurrences/o1/roster/ushers__s1__p-ann').get());
    });

    test('a member cannot confirm their own row or restamp the occurrence from a browser', async () => {
        await RT.assertFails(ctx('uid-ann').doc('event_occurrences/o1/roster/ushers__s1__p-ann').update({ state: 'confirmed' }));
        await RT.assertFails(ctx('uid-ann').doc('event_occurrences/o1').update({ visibility: 'public' }));
    });

    test('a member cannot write their own serving history', async () => {
        await RT.assertFails(ctx('uid-ann').doc('people/p-ann/involvement/i2').set({ type: 'ushers', date: '2026-02-01' }));
    });

    test('a member cannot write a Role, a Trade or a cover entry', async () => {
        await RT.assertFails(ctx('uid-ann').doc('roles/ushers').update({ name: 'x' }));
        await RT.assertFails(ctx('uid-ann').doc('trades/t1').set({ holderId: 'p-ann', counterpartyId: 'p-bob' }));
        await RT.assertFails(ctx('uid-ann').doc('cover/c1').set({ visibility: 'member' }));
    });

    // MS-811. A self sign-up named somebody else's Person and every Roles
    // callable believed it. The keys are an allowlist now.
    test('a fresh sign-up cannot claim somebody else\'s Person (MS-811)', async () => {
        await RT.assertFails(ctx('uid-stranger').doc('users/uid-stranger').set({
            accountLevelId: 'level_viewer', personId: 'p-ann', email: 'x@example.com',
        }));
        // Nor any key the sign-up page does not write.
        await RT.assertFails(ctx('uid-stranger').doc('users/uid-stranger').set({
            accountLevelId: 'level_viewer', email: 'x@example.com', elder: true,
        }));
    });

    test('the sign-up page\'s own write still goes through (MS-811)', async () => {
        await RT.assertSucceeds(ctx('uid-stranger').doc('users/uid-stranger').set({
            accountLevelId: 'level_viewer', email: 'x@example.com',
            createdAt: new Date(),
        }));
    });

    test('an account cannot point itself at another Person afterwards (MS-811)', async () => {
        await RT.assertFails(ctx('uid-viewer').doc('users/uid-viewer').update({ personId: 'p-ann' }));
        await RT.assertFails(ctx('uid-ann').doc('users/uid-ann').update({ personId: 'p-bob' }));
    });

    // ADR 0031 keeps `roles` world-readable for the printed guide, but a
    // Role's allowlist names people and its tag rules name Shepherding Tags.
    test('a Role\'s allowlist is not readable signed out', { todo: 'roles/ is allow read: if true' }, async () => {
        const anon = env.unauthenticatedContext().firestore();
        const snap = await anon.doc('roles/ushers').get();
        const rules = (snap.data() && snap.data().restrictions) || [];
        assert.equal(rules.some(r => r.personIds), false);
    });

    test('a Role write is held to the model (servant family, a slot, the description cap)', { todo: 'roles/ write has no shape check' }, async () => {
        const db = ctx('uid-rolesmgr');
        await RT.assertFails(db.doc('roles/preacher').set({
            slug: 'preacher', name: 'x', family: 'liturgical', slots: [],
            description: 'x'.repeat(900 * 1024),
        }));
    });

    // isEditor() is true for ANY one of directory.edit_identity, printables.edit,
    // services.builder.edit, roles.manager.edit or hymns.edit on a custom level,
    // and people/ update+delete and involvement writes ask isEditor().
    test('a hymns-only custom level cannot delete a Person or rewrite serving history', { todo: 'isEditor() is one key wide' }, async () => {
        const db = ctx('uid-hymns');
        await RT.assertFails(db.doc('people/p-ann/involvement/i1').update({ type: 'preacher' }));
        await RT.assertFails(db.doc('people/p-bob').update({ sex: 'male', tags: ['anything'] }));
        await RT.assertFails(db.doc('people/p-ann').delete());
    });

    test('a Roles-Manager-only custom level cannot delete a Person or invent serving history', { todo: 'isEditor() is one key wide' }, async () => {
        const db = ctx('uid-rolesmgr');
        await RT.assertFails(db.doc('people/p-bob/involvement/x').set({ type: 'ushers', date: '2025-01-01' }));
        await RT.assertFails(db.doc('people/p-bob').delete());
    });
});
