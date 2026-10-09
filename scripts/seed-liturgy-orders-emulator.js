#!/usr/bin/env node
// Seeds Auth + Firestore emulators for MS-716 Liturgy Orders screenshots and flows.
// Never targets production: refuses to run without emulator env vars set.

'use strict';

const path = require('path');

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';

const admin = require('firebase-admin');
const Core = require('../public/liturgy-order-core.js');
const Store = require('../public/liturgy-order-store.js');
const Levels = require('../public/account-levels-core.js');
const PROJECT = 'demo-ms716-liturgy-orders';
const EDITOR = { uid: 'ms716-editor', email: 'editor@ms716.emulator.test', password: 'ms716-emulator-pass' };
const VIEWER = { uid: 'ms716-viewer', email: 'viewer@ms716.emulator.test', password: 'ms716-emulator-pass' };

function el(id, kind, name, extra) {
    return Object.assign({
        id,
        kind,
        name,
        hasNote: extra && extra.hasNote === false ? false : true,
    }, extra || {});
}

function designCatalog() {
    const pastoral = el('pastoralPrayer', 'prayer', 'Pastoral Prayer', {
        prayedByOther: true,
        requests: { people: [{ who: 'male' }, { who: 'female' }], count: 2 },
        noticeDays: [5, 3, 1],
        message: '',
        response: '',
    });
    const standardEls = [
        el('preparatoryHymn', 'hymn', 'Preparatory Hymn'),
        el('callToWorship', 'scripture', 'Call to Worship'),
        el('hymn1', 'hymn', 'Hymn 1'),
        el('hymn2', 'hymn', 'Hymn 2'),
        el('callToConfession', 'scripture', 'Call to Confession'),
        el('prayerOfConfession', 'prayer', 'Prayer of Confession'),
        el('assuranceOfPardon', 'scripture', 'Assurance of Pardon'),
        el('hymnMid1', 'hymn', 'Hymn 3'),
        el('scriptureReading', 'scripture', 'Scripture Reading'),
        pastoral,
        el('sermon', 'scripture', 'Sermon'),
        el('baptism', 'person', 'Baptism', { hasNote: false }),
        el('hymnEnd1', 'hymn', 'Closing Hymn'),
        el('benediction', 'scripture', 'Benediction', { hasNote: false }),
    ];
    const communionEls = [
        el('cHymn1', 'hymn', 'Hymn 1'),
        el('cCallWorship', 'scripture', 'Call to Worship'),
        el('cHymn2', 'hymn', 'Hymn 2'),
        el('cConfession', 'scripture', 'Call to Confession'),
        el('cAssurance', 'scripture', 'Assurance of Pardon'),
        el('cHymn3', 'hymn', 'Hymn 3'),
        el('cScripture', 'scripture', 'Scripture Reading'),
        el('cPastoral', 'prayer', 'Pastoral Prayer', {
            prayedByOther: true,
            requests: { people: [{ who: 'male' }, { who: 'female' }], count: 2 },
            noticeDays: [5, 3, 1],
        }),
        el('cSermon', 'scripture', 'Sermon'),
        el('cSupper', 'other', 'The Lord\u2019s Supper'),
        el('cHymn4', 'hymn', 'Closing Hymn'),
        el('cBenediction', 'scripture', 'Benediction', { hasNote: false }),
    ];
    const christmasEls = [
        el('xHymn1', 'hymn', 'Hymn 1'),
        el('xLesson1', 'scripture', 'First Lesson'),
        el('xHymn2', 'hymn', 'Hymn 2'),
        el('xLesson2', 'scripture', 'Second Lesson'),
        el('xHymn3', 'hymn', 'Hymn 3'),
        el('xGospel', 'scripture', 'Gospel Reading'),
        el('xPrayer', 'prayer', 'Prayer'),
        el('xCandle', 'other', 'Candle Lighting', { hasNote: false }),
        el('xHymn4', 'hymn', 'Closing Hymn'),
        el('xBenediction', 'scripture', 'Benediction', { hasNote: false }),
    ];
    const orders = [
        { id: 'standard', name: 'Standard', elements: standardEls, elementIds: standardEls.map(e => e.id) },
        { id: 'christmas-eve', name: 'Christmas Eve', elements: christmasEls, elementIds: christmasEls.map(e => e.id) },
        { id: 'communion', name: 'Communion', elements: communionEls, elementIds: communionEls.map(e => e.id) },
    ];
    const elements = [];
    const seen = new Set();
    orders.forEach((o) => o.elements.forEach((e) => {
        if (!seen.has(e.id)) { seen.add(e.id); elements.push(e); }
    }));
    return Core.catalogFrom({ elements, orders });
}

function userDoc(presetKey) {
    const permissions = Levels.buildPresetPermissions(presetKey);
    return {
        accountLevelId: Levels.accountLevelIdForPreset(presetKey),
        permissions,
        permissionLevel: presetKey,
        role: presetKey,
        name: presetKey === 'editor' ? 'Editor MS716' : 'Viewer MS716',
        pastoralAssistant: false,
    };
}

async function wipeFirestore(db) {
    const host = process.env.FIRESTORE_EMULATOR_HOST;
    const url = `http://${host}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`;
    const res = await fetch(url, { method: 'DELETE' });
    if (!res.ok) throw new Error('Firestore emulator wipe failed: ' + res.status);
}

async function seedAuth(auth) {
    for (const spec of [EDITOR, VIEWER]) {
        try {
            await auth.createUser({ uid: spec.uid, email: spec.email, password: spec.password });
        } catch (e) {
            if (e.code !== 'auth/uid-already-exists' && e.code !== 'auth/email-already-exists') throw e;
            await auth.updateUser(spec.uid, { email: spec.email, password: spec.password });
        }
    }
}

async function main() {
    if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
        console.error('Refusing to seed: set FIRESTORE_EMULATOR_HOST and FIREBASE_AUTH_EMULATOR_HOST.');
        process.exit(1);
    }

    if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
    const auth = admin.auth();
    const db = admin.firestore();

    await wipeFirestore(db);
    await seedAuth(auth);

    await db.collection('users').doc(EDITOR.uid).set(userDoc('editor'));
    await db.collection('users').doc(VIEWER.uid).set(userDoc('viewer'));

    const catalog = designCatalog();
    const plan = Store.planSave(catalog, { elementIds: [], orderIds: [] });
    const batch = db.batch();
    plan.setOrders.forEach((doc) => {
        batch.set(db.collection('liturgy_orders').doc(doc.id), doc);
    });
    await batch.commit();

    console.log('Seeded MS-716 emulator data:');
    console.log('  editor:', EDITOR.email, EDITOR.password);
    console.log('  viewer:', VIEWER.email, VIEWER.password);
    console.log('  orders:', catalog.orders.map(o => o.name + ' (' + o.elementIds.length + ' elements)').join(', '));
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
