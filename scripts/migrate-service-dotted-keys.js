/**
 * MS-781 — fold dotted top-level service keys into nested objects and delete
 * the flat dotted field names.
 *
 * Dry-run by default. Prod requires --project mosaic-hymn-database --i-mean-prod.
 *
 *   node scripts/migrate-service-dotted-keys.js \
 *       --project mosaic-hymn-database --i-mean-prod
 *   node scripts/migrate-service-dotted-keys.js \
 *       --project mosaic-hymn-database --i-mean-prod --commit
 */

const path = require('path');
const Dotted = require('../public/service-dotted-keys-core.js');
const {loadProject} = require('./firebase-project.js');

function committing(argv) {
    return argv.includes('--commit');
}

function willWrite(argv) {
    return committing(argv) && argv.includes('--i-mean-prod');
}

async function main() {
    const argv = process.argv;
    const projectId = require('./firebase-project').requireProject(argv);
    const COMMIT = willWrite(argv);
    if (committing(argv) && !COMMIT) {
        throw new Error('--commit against the church project also needs --i-mean-prod.');
    }

    const project = loadProject(path.join(__dirname, '..'), projectId);
    const admin = require('firebase-admin');
    if (!admin.apps.length) {
        admin.initializeApp({
            credential: admin.credential.cert(require(require('./service-account').serviceAccountPath())),
            projectId,
            storageBucket: project.storageBucket,
        });
    }
    const db = admin.firestore();

    const snap = await db.collection('services').get();
    const planned = [];
    snap.docs.forEach((doc) => {
        const data = doc.data() || {};
        const plan = Dotted.planDottedKeyRewrite(data);
        if (plan) planned.push({ id: doc.id, plan });
    });

    const dottedFieldCount = planned.reduce((n, row) => n + row.plan.dottedKeys.length, 0);
    console.log(JSON.stringify({
        servicesScanned: snap.size,
        servicesWithDottedKeys: planned.length,
        dottedFieldsToRemove: dottedFieldCount,
    }, null, 2));

    if (!COMMIT) {
        console.log('Dry run: no writes made.');
        return;
    }

    const batchSize = 200;
    for (let i = 0; i < planned.length; i += batchSize) {
        const batch = db.batch();
        planned.slice(i, i + batchSize).forEach((row) => {
            batch.set(db.collection('services').doc(row.id), row.plan.next);
        });
        await batch.commit();
    }

    console.log(`Rewrite complete — ${planned.length} services updated.`);
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
