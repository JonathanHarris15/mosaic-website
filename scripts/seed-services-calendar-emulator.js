#!/usr/bin/env node
// Seeds Auth + liturgy_orders for Services calendar emulator screenshots (MS-770).
// Runs seed-resources-emulator.js first for the shared member/editor accounts.

'use strict';

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

process.env.FIRESTORE_EMULATOR_HOST =
    process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST =
    process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';

const admin = require('firebase-admin');

function projectFromWebConfig() {
    const file = path.join(__dirname, '..', 'public', 'firebase-config.js');
    const src = fs.readFileSync(file, 'utf8');
    const json = src.slice(src.indexOf('{'), src.lastIndexOf('}') + 1);
    return JSON.parse(json).projectId;
}

async function main() {
    if (!process.env.FIRESTORE_EMULATOR_HOST ||
        !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
        console.error('Refusing to seed: set FIRESTORE_EMULATOR_HOST and ' +
            'FIREBASE_AUTH_EMULATOR_HOST.');
        process.exit(1);
    }

    execSync('node scripts/seed-resources-emulator.js', {
        stdio: 'inherit',
        env: process.env,
        cwd: path.join(__dirname, '..'),
    });

    const projectId = projectFromWebConfig();
    if (!admin.apps.length) admin.initializeApp({ projectId });
    const db = admin.firestore();
    const batch = db.batch();
    batch.set(db.collection('liturgy_orders').doc('standard'), {
        id: 'standard',
        name: 'Standard',
        elements: [{ id: 'hymn1', kind: 'hymn', name: 'Hymn 1', hasNote: true }],
        elementIds: ['hymn1'],
    });
    batch.set(db.collection('liturgy_orders').doc('baptism-week'), {
        id: 'baptism-week',
        name: 'Baptism week',
        elements: [{ id: 'baptism', kind: 'person', name: 'Baptism', hasNote: false }],
        elementIds: ['baptism'],
    });
    batch.set(db.collection('liturgy_orders').doc('textbelt-url-test'), {
        id: 'textbelt-url-test',
        name: 'TEXTBELT URL whitelist test (ops)',
        ops: true,
        elements: [{ id: 'tbPrayer', kind: 'prayer', name: 'Test prayer', hasNote: false }],
        elementIds: ['tbPrayer'],
    });
    await batch.commit();
    console.log('Seeded liturgy_orders for Services calendar emulator.');
    console.log('  open http://localhost:5005/service-calendar.html' +
        '?emulator=1&emulatorUser=editor');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
