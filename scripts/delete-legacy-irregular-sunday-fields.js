/**
 * Migrate irregularElements into liturgyLeftovers, then delete legacy fields (MS-796).
 */

const path = require('path');
const Plan = require('../public/delete-legacy-irregular-sunday-core.js');
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
    const FieldValue = admin.firestore.FieldValue;

    const totals = {
        servicesScanned: 0,
        irregularServices: 0,
        wouldMigrate: 0,
        leftoversToAdd: 0,
    };
    const planned = [];

    const snap = await db.collection('services').get();
    for (const doc of snap.docs) {
        totals.servicesScanned += 1;
        const plan = Plan.planIrregularSundayMigration(doc.data());
        if (plan.irregular) totals.irregularServices += 1;
        if (!plan.migrate) continue;
        totals.wouldMigrate += 1;
        totals.leftoversToAdd += plan.leftoversAdded;
        planned.push({
            date: doc.id,
            leftoversAdded: plan.leftoversAdded,
            liturgyLeftoversCount: (plan.liturgyLeftovers || []).length,
        });
    }

    console.log(JSON.stringify({ totals, sample: planned.slice(0, 20) }, null, 2));

    if (!COMMIT) {
        console.log('Dry run: no writes made.');
        return;
    }

    for (const row of planned) {
        const plan = Plan.planIrregularSundayMigration(
            (await db.collection('services').doc(row.date).get()).data(),
        );
        await db.collection('services').doc(row.date).update({
            liturgyLeftovers: plan.liturgyLeftovers,
            isIrregular: FieldValue.delete(),
            irregularElements: FieldValue.delete(),
        });
    }

    console.log('Migrated and cleared irregular fields on', planned.length, 'services.');
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
