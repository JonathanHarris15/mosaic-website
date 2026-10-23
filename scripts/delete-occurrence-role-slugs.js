/**
 * Strip legacy occurrenceRoleSlugs from event_occurrences (MS-794).
 *
 * Dry-run by default. Prod requires --project mosaic-hymn-database --i-mean-prod.
 *
 *   node scripts/delete-occurrence-role-slugs.js \
 *       --project mosaic-hymn-database --i-mean-prod
 *   node scripts/delete-occurrence-role-slugs.js \
 *       --project mosaic-hymn-database --i-mean-prod --commit
 */

const path = require('path');
const Plan = require('../public/delete-occurrence-role-slugs-core.js');
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

    const totals = { occurrencesScanned: 0, wouldDeleteField: 0 };
    const planned = [];

    const snap = await db.collection('event_occurrences').get();
    for (const doc of snap.docs) {
        totals.occurrencesScanned += 1;
        const plan = Plan.planOccurrenceRoleSlugDeletion(doc.data() || {});
        if (!plan.deleteField) continue;
        totals.wouldDeleteField += 1;
        planned.push({ occurrenceId: doc.id });
    }

    console.log(JSON.stringify({ totals, sample: planned.slice(0, 20) }, null, 2));

    if (!COMMIT) {
        console.log('Dry run: no writes made.');
        return;
    }

    const batchSize = 400;
    for (let i = 0; i < planned.length; i += batchSize) {
        const batch = db.batch();
        planned.slice(i, i + batchSize).forEach((row) => {
            batch.update(db.collection('event_occurrences').doc(row.occurrenceId), {
                occurrenceRoleSlugs: FieldValue.delete(),
            });
        });
        await batch.commit();
    }

    console.log('occurrenceRoleSlugs removed from', planned.length, 'occurrences.');
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
