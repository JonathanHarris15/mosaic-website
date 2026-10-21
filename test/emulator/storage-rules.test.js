// MS-769 — Storage rules exercised in the emulator for every prefix.
//
// Needs firestore + storage + auth emulators (`npm run test:emulator` with
// storage in the --only set). Skips when FIRESTORE_EMULATOR_HOST is unset.

'use strict';

const fs = require('fs');
const path = require('path');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const HOST = process.env.FIRESTORE_EMULATOR_HOST || '';
const skipReason = HOST ? false :
    'no FIRESTORE_EMULATOR_HOST — run `npm run test:emulator`';

const ROOT = path.join(__dirname, '..', '..');
const PROJECT_ID = 'demo-mosaic-ms20';
const BUCKET = `${PROJECT_ID}.appspot.com`;
const AccountLevelsCore = require(path.join(ROOT, 'public', 'account-levels-core.js'));
const CrossService = require(path.join(ROOT, 'scripts', 'storage-cross-service.js'));

let testEnv;
let assertFails;
let assertSucceeds;

const USERS = {
    member: 'uid-member',
    editor: 'uid-editor',
    elder: 'uid-elder',
    admin: 'uid-admin',
    anon: 'uid-anon',
    fillMap: 'uid-fill-map',
    superStoredMember: 'uid-super-stored-member',
    superRoleOnly: 'uid-super-role-only',
    superBothFields: 'uid-super-both-fields',
    freshEditor: 'uid-fresh-editor',
};

function tinyPng() {
    return Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64');
}

async function seedUsers(env) {
    await env.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        const base = {pastoralAssistant: false};
        await db.collection('users').doc(USERS.member).set({...base, permissionLevel: 'member'});
        await db.collection('users').doc(USERS.editor).set({...base, permissionLevel: 'editor'});
        await db.collection('users').doc(USERS.elder).set({...base, permissionLevel: 'elder'});
        await db.collection('users').doc(USERS.admin).set({...base, permissionLevel: 'admin'});
        await db.collection('users').doc(USERS.fillMap).set({
            ...base,
            permissionLevel: 'member',
            permissions: {
                'printables.edit': true,
                'services.builder.edit': true,
            },
        });
        await db.collection('users').doc(USERS.superStoredMember).set({
            ...base,
            permissionLevel: 'member',
            accountLevelId: 'level_super_admin',
            permissions: {'system.super_admin': true},
        });
        // The super-admin docs as they are in prod: `role` alone, or `role`
        // and `permissionLevel` — no accountLevelId, no permissions map, and
        // no pastoralAssistant field for a rule to trip over.
        await db.collection('users').doc(USERS.superRoleOnly).set({
            email: 'role-only@example.test',
            role: 'super_admin',
        });
        await db.collection('users').doc(USERS.superBothFields).set({
            email: 'both-fields@example.test',
            permissionLevel: 'super_admin',
            role: 'super_admin',
        });
        // A sign-up (login.html) that Admin → Accounts then made an editor.
        await db.collection('users').doc(USERS.freshEditor).set({
            email: 'fresh-editor@example.test',
            ...AccountLevelsCore.userWriteFromLevel('level_editor', {presetKey: 'editor'}),
        });
        await db.collection('event_occurrences').doc('occ-public').set({
            visibility: 'public',
            participantIds: [],
        });
        await db.collection('event_occurrences').doc('occ-member').set({
            visibility: 'member',
            participantIds: [],
        });
        await db.collection('event_occurrences').doc('occ-elder').set({
            visibility: 'elder',
            participantIds: [],
        });
    });
}

function signed(uid) {
    return testEnv.authenticatedContext(uid);
}

function anon() {
    return testEnv.authenticatedContext(USERS.anon, {
        auth: {
            uid: USERS.anon,
            token: {
                sub: USERS.anon,
                firebase: {sign_in_provider: 'anonymous'},
            },
        },
    });
}

function nobody() {
    return testEnv.unauthenticatedContext();
}

async function putBytes(storage, objectPath, bytes) {
    const ref = storage.ref(objectPath);
    await ref.put(bytes, {contentType: 'image/png'});
}

async function readOk(storage, objectPath) {
    await assertSucceeds(storage.ref(objectPath).getMetadata());
}

async function readDenied(storage, objectPath) {
    await assertFails(storage.ref(objectPath).getMetadata());
}

async function writeOk(storage, objectPath, bytes) {
    await assertSucceeds(putBytes(storage, objectPath, bytes));
}

async function writeDenied(storage, objectPath, bytes) {
    await assertFails(putBytes(storage, objectPath, bytes));
}

before(async () => {
    if (skipReason) return;
    const rules = require('@firebase/rules-unit-testing');
    assertFails = rules.assertFails;
    assertSucceeds = rules.assertSucceeds;
    testEnv = await rules.initializeTestEnvironment({
        projectId: PROJECT_ID,
        firestore: {
            rules: fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8'),
            host: HOST.split(':')[0],
            port: Number(HOST.split(':')[1]),
        },
        storage: {
            rules: fs.readFileSync(path.join(ROOT, 'storage.rules'), 'utf8'),
            host: process.env.FIREBASE_STORAGE_EMULATOR_HOST.split(':')[0],
            port: Number(process.env.FIREBASE_STORAGE_EMULATOR_HOST.split(':')[1]),
        },
    });
    await seedUsers(testEnv);
});

after(async () => {
    if (testEnv) await testEnv.cleanup();
});

test('no catch-all remains in storage.rules', {skip: skipReason}, () => {
    const rules = fs.readFileSync(path.join(ROOT, 'storage.rules'), 'utf8');
    assert.doesNotMatch(rules, /match \/\{allPaths=\*\*\}/);
});

test('people_photos: signed-in member reads; anonymous denied', {skip: skipReason}, async () => {
    const path = 'people_photos/p1/f1.png';
    await testEnv.withSecurityRulesDisabled(async (c) => {
        await putBytes(c.storage(), path, tinyPng());
    });
    await readOk(signed(USERS.member).storage(), path);
    await readDenied(nobody().storage(), path);
});

test('resources: member reads; anonymous denied; editor writes', {skip: skipReason}, async () => {
    const path = 'resources/r1/file.pdf';
    await writeDenied(signed(USERS.member).storage(), path, Buffer.from('%PDF'));
    await writeOk(signed(USERS.editor).storage(), path, Buffer.from('%PDF'));
    await readOk(signed(USERS.member).storage(), path);
    await readDenied(anon().storage(), path);
});

test('hymn-sheets: world read; editor with hymns.edit writes', {skip: skipReason}, async () => {
    const path = 'hymn-sheets/Grace/sheet.png';
    await testEnv.withSecurityRulesDisabled(async (c) => {
        await putBytes(c.storage(), path, tinyPng());
    });
    await readOk(anon().storage(), path);
    await readOk(nobody().storage(), path);
    await writeDenied(signed(USERS.member).storage(), path, tinyPng());
    await writeOk(signed(USERS.editor).storage(), path + '.new', tinyPng());
});

test('guide-assets: world read; editor writes image', {skip: skipReason}, async () => {
    const path = 'guide-assets/a1/logo.png';
    await testEnv.withSecurityRulesDisabled(async (c) => {
        await putBytes(c.storage(), path, tinyPng());
    });
    await readOk(anon().storage(), path);
    await writeDenied(signed(USERS.member).storage(), path, tinyPng());
    await writeOk(signed(USERS.editor).storage(), 'guide-assets/a1/logo2.png', tinyPng());
});

test('form_uploads: client write denied for everyone; editor reads', {skip: skipReason}, async () => {
    const path = 'form_uploads/f/r/file.pdf';
    await testEnv.withSecurityRulesDisabled(async (c) => {
        await putBytes(c.storage(), path, Buffer.from('x'));
    });
    await writeDenied(signed(USERS.editor).storage(), path, Buffer.from('y'));
    await readOk(signed(USERS.editor).storage(), path);
    await readDenied(signed(USERS.member).storage(), path);
});

test('form_uploads_elder: elder reads; editor denied', {skip: skipReason}, async () => {
    const path = 'form_uploads_elder/f/r/file.pdf';
    await testEnv.withSecurityRulesDisabled(async (c) => {
        await putBytes(c.storage(), path, Buffer.from('x'));
    });
    await readOk(signed(USERS.elder).storage(), path);
    await readDenied(signed(USERS.editor).storage(), path);
});

test('event_attachments: visibility from Firestore', {skip: skipReason}, async () => {
    const memberPath = 'event_attachments/occ-member/a1/f.pdf';
    const elderPath = 'event_attachments/occ-elder/a1/f.pdf';
    await testEnv.withSecurityRulesDisabled(async (c) => {
        const s = c.storage();
        await putBytes(s, memberPath, Buffer.from('m'));
        await putBytes(s, elderPath, Buffer.from('e'));
    });
    await readOk(signed(USERS.member).storage(), memberPath);
    await readDenied(signed(USERS.member).storage(), elderPath);
    await readOk(signed(USERS.elder).storage(), elderPath);
});

test('unknown prefix is denied', {skip: skipReason}, async () => {
    const path = 'mystery-blob.dat';
    await readDenied(signed(USERS.admin).storage(), path);
    await writeDenied(signed(USERS.admin).storage(), path, Buffer.from('nope'));
});

test('printable_assets: signed-in read; permission-map fill-in may write', {skip: skipReason}, async () => {
    const printable = 'printable_assets/p1/f1.png';
    await testEnv.withSecurityRulesDisabled(async (c) => {
        await putBytes(c.storage(), printable, tinyPng());
    });
    await readOk(signed(USERS.member).storage(), printable);
    await readDenied(nobody().storage(), printable);
    await writeOk(signed(USERS.editor).storage(), 'printable_assets/p1/f2.png', tinyPng());
    await writeOk(signed(USERS.fillMap).storage(), 'printable_assets/sEKK4xDbteFhCLNWlfMz/img.png', tinyPng());
    await writeOk(signed(USERS.superStoredMember).storage(),
        'printable_assets/sEKK4xDbteFhCLNWlfMz/imgmr851_sing.png', tinyPng());
    await writeDenied(signed(USERS.member).storage(), 'printable_assets/p1/f3.png', tinyPng());
});

test('printable_assets: prod super-admin doc shapes and a fresh editor may write a fill-in image', {skip: skipReason}, async () => {
    const dir = 'printable_assets/sEKK4xDbteFhCLNWlfMz/';
    await writeOk(signed(USERS.superRoleOnly).storage(), dir + 'img1yn81_sing-02.png', tinyPng());
    await writeOk(signed(USERS.superBothFields).storage(), dir + 'img1yn82_sing-02.png', tinyPng());
    await writeOk(signed(USERS.freshEditor).storage(), dir + 'img1yn83_sing-02.png', tinyPng());
    await writeDenied(nobody().storage(), dir + 'img1yn84_sing-02.png', tinyPng());
    await writeDenied(anon().storage(), dir + 'img1yn85_sing-02.png', tinyPng());
});

// The exact reads scripts/storage-cross-service.js sends to production, asked
// of the emulator, where the Storage → Firestore read always works. Signed
// out, for objects that do not exist: a public occurrence lets the read
// through (object-not-found), a missing one does not (unauthorized). In prod
// a public occurrence answering `unauthorized` means firestore.get failed.
test('cross-service probe: signed-out read under a public occurrence reaches the object', {skip: skipReason}, async () => {
    const storage = nobody().storage();
    const read = (objectPath) => storage.ref(objectPath).getMetadata().then(() => 'ok', (e) => e.code);
    const probe = CrossService.probePaths('occ-public');
    assert.equal(await read(probe.allowed), 'storage/object-not-found');
    assert.equal(await read(probe.denied), 'storage/unauthorized');
    assert.equal(await read(probe.crossService), 'storage/object-not-found');
    assert.equal(await read(CrossService.probePaths('occ-missing').crossService), 'storage/unauthorized');
});

test('sunday_typed country_map: services.builder.edit on permission map may write', {skip: skipReason}, async () => {
    const path = 'sunday_typed/2026-10-26/country_map/map1.png';
    await writeOk(signed(USERS.fillMap).storage(), path, tinyPng());
    await writeDenied(signed(USERS.member).storage(), 'sunday_typed/2026-10-26/country_map/denied.png', tinyPng());
});

test('role matrix spot-check: admin is not elder on form_uploads_elder', {skip: skipReason}, async () => {
    const path = 'form_uploads_elder/f/r/x.pdf';
    await testEnv.withSecurityRulesDisabled(async (c) => {
        await putBytes(c.storage(), path, Buffer.from('x'));
    });
    await readDenied(signed(USERS.admin).storage(), path);
    await readOk(signed(USERS.elder).storage(), path);
});
