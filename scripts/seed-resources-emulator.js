#!/usr/bin/env node
// Seeds Auth + Firestore emulators with a fictional congregation's shelf, so
// the Resources page (MS-693) can be looked at — and smoke-tested — as an
// editor and as a member. Never targets production: refuses to run without
// the emulator env vars set.
//
// The accounts are the shared localhost ones `public/emulator-connect.js`
// signs in with, so `?emulator=1&emulatorUser=member` is the whole of what a
// smoke test has to do to arrive as a member. The names and documents are
// invented; this repo is public.

'use strict';

process.env.FIRESTORE_EMULATOR_HOST =
    process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST =
    process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';

const fs = require('fs');
const path = require('path');

const admin = require('firebase-admin');
const Core = require('../public/resources-core.js');
const Levels = require('../public/account-levels-core.js');

// ⚠ The project id is READ OFF THE PAGE, not chosen here.
//
// The browser gets its id from public/firebase-config.js, and the Firestore
// emulator keyspaces by project — so a seed written under any other id is
// invisible to the page it was written for. That is also why this cannot take
// a `demo-` id: it is not picking a project, it is agreeing with one.
//
// Naming it as a literal would trip the guard in firebase-project.test.js,
// and rightly: a script with the church id baked in is one typo away from
// writing the church. Nothing here can, because the two emulator host
// variables are required above and admin then never leaves localhost.
function projectFromWebConfig() {
    const file = path.join(__dirname, '..', 'public', 'firebase-config.js');
    const src = fs.readFileSync(file, 'utf8');
    const json = src.slice(src.indexOf('{'), src.lastIndexOf('}') + 1);
    return JSON.parse(json).projectId;
}

const ACCOUNTS = [
    {
        uid: 'seed-resources-editor',
        email: 'editor@mosaic.emulator.test',
        password: 'mosaic-emulator-pass',
        name: 'Ada Thatcher',
        level: 'editor',
    },
    {
        uid: 'seed-resources-member',
        email: 'member@mosaic.emulator.test',
        password: 'mosaic-emulator-pass',
        name: 'Mo Lindqvist',
        level: 'member',
    },
];

const FOLDERS = [
    {id: 'f-studies', name: 'Bible studies', parentId: null, pinRank: null},
    {id: 'f-romans', name: 'Romans', parentId: 'f-studies', pinRank: null},
    {id: 'f-bulletins', name: 'Bulletins', parentId: null, pinRank: 2000},
    {id: 'f-policies', name: 'Policies', parentId: null, pinRank: null},
];

const RESOURCES = [
    {
        id: 'r-bulletin',
        kind: 'file',
        name: 'Bulletin — 12 October.pdf',
        folderId: 'f-bulletins',
        storagePath: 'resources/r-bulletin/Bulletin-12-October.pdf',
        contentType: 'application/pdf',
        size: 418000,
        pinRank: 1000,
    },
    {
        id: 'r-handbook',
        kind: 'link',
        name: 'Elders handbook (working draft)',
        folderId: null,
        url: 'https://docs.google.com/document/d/riverside-handbook/edit',
        pinRank: 3000,
    },
    {
        id: 'r-romans-1',
        kind: 'file',
        name: 'Romans 1–4 — leader notes.docx',
        folderId: 'f-romans',
        storagePath: 'resources/r-romans-1/Romans-1-4-leader-notes.docx',
        contentType: 'application/vnd.openxmlformats-officedocument' +
            '.wordprocessingml.document',
        size: 96500,
        pinRank: null,
    },
    {
        id: 'r-romans-2',
        kind: 'file',
        name: 'Romans 5–8 — leader notes.docx',
        folderId: 'f-romans',
        storagePath: 'resources/r-romans-2/Romans-5-8-leader-notes.docx',
        contentType: 'application/vnd.openxmlformats-officedocument' +
            '.wordprocessingml.document',
        size: 101200,
        pinRank: null,
    },
    {
        id: 'r-safeguarding',
        kind: 'file',
        name: 'Safeguarding policy.pdf',
        folderId: 'f-policies',
        storagePath: 'resources/r-safeguarding/Safeguarding-policy.pdf',
        contentType: 'application/pdf',
        size: 262000,
        pinRank: null,
    },
    {
        id: 'r-building',
        kind: 'file',
        name: 'Building plan.png',
        folderId: 'f-policies',
        storagePath: 'resources/r-building/Building-plan.png',
        contentType: 'image/png',
        size: 1480000,
        pinRank: null,
    },
    {
        id: 'r-rota',
        kind: 'link',
        name: 'Welcome team rota',
        folderId: null,
        url: 'https://docs.google.com/spreadsheets/d/riverside-rota/edit',
        pinRank: null,
    },
    {
        id: 'r-membership',
        kind: 'file',
        name: 'Membership class — session one.pdf',
        folderId: null,
        storagePath: 'resources/r-membership/Membership-class-session-one.pdf',
        contentType: 'application/pdf',
        size: 744000,
        pinRank: null,
    },
];

async function seedAccount(auth, db, spec) {
    try {
        await auth.createUser({
            uid: spec.uid,
            email: spec.email,
            password: spec.password,
            displayName: spec.name,
        });
    } catch (e) {
        if (e.code !== 'auth/uid-already-exists' &&
            e.code !== 'auth/email-already-exists') throw e;
        await auth.updateUser(spec.uid, {
            email: spec.email,
            password: spec.password,
            displayName: spec.name,
        });
    }
    await db.collection('users').doc(spec.uid).set({
        email: spec.email,
        name: spec.name,
        accountLevelId: Levels.accountLevelIdForPreset(spec.level),
        permissions: Levels.buildPresetPermissions(spec.level),
    });
}

async function clear(db, name) {
    const snap = await db.collection(name).get();
    for (const doc of snap.docs) await doc.ref.delete();
}

async function main() {
    if (!process.env.FIRESTORE_EMULATOR_HOST ||
        !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
        console.error('Refusing to seed: set FIRESTORE_EMULATOR_HOST and ' +
            'FIREBASE_AUTH_EMULATOR_HOST.');
        process.exit(1);
    }

    const projectId = projectFromWebConfig();
    if (!admin.apps.length) admin.initializeApp({projectId});
    const auth = admin.auth();
    const db = admin.firestore();

    for (const spec of ACCOUNTS) await seedAccount(auth, db, spec);

    await clear(db, 'resources');
    await clear(db, 'resource_folders');

    for (const folder of FOLDERS) {
        const {id, ...spec} = folder;
        await db.collection('resource_folders').doc(id).set(
            Object.assign(Core.buildFolder(spec), {createdByName: 'Ada Thatcher'}));
    }
    for (const resource of RESOURCES) {
        const {id, kind, ...spec} = resource;
        const record = kind === 'link' ?
            Core.buildLinkResource(spec) :
            Core.buildFileResource(spec);
        await db.collection('resources').doc(id).set(
            Object.assign(record, {createdByName: 'Ada Thatcher'}));
    }

    console.log('Seeded the Resources emulator shelf:');
    ACCOUNTS.forEach((a) => console.log(`  ${a.level}: ${a.email} ${a.password}`));
    console.log(`  ${FOLDERS.length} folders, ${RESOURCES.length} resources`);
    console.log('  open http://localhost:5005/resources.html' +
        '?emulator=1&emulatorUser=member');
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
