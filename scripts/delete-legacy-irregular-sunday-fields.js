/**
 * Delete isIrregular and irregularElements from services (MS-796).
 *
 * Copies nothing — run only after irregular content has been moved to liturgy
 * orders or liturgyLeftovers by hand. Dry-run reports counts.
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

    const totals = { servicesScanned: 0, irregularServices: 0, wouldDeleteFields: 0 };
    const planned = [];

    const snap = await db.collection('services').get();
    for (const doc of snap.docs) {
        totals.servicesScanned += 1;
        const plan = Plan.planIrregularFieldDeletion(doc.data());
        if (plan.irregular) totals.irregularServices += 1;
        if (!plan.deleteFields) continue;
        totals.wouldDeleteFields += 1;
        planned.push({ date: doc.id });
    }

    console.log(JSON.stringify({ totals, sampleDates: planned.slice(0, 20) }, null, 2));

    if (!COMMIT) {
        console.log('Dry run: no writes made.');
        return;
    }

    for (const row of planned) {
        await db.collection('services').doc(row.date).update({
            isIrregular: FieldValue.delete(),
            irregularElements: FieldValue.delete(),
        });
    }

    console.log('Cleared irregular fields on', planned.length, 'services.');
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
