/**
 * Delete carriedBy entries that name nobody (MS-808).
 *
 * The editor used to store { name: '', id: null } so a prayer-leader picker
 * had an object. A prayer leader is the presence of that entry. Empty ones
 * are not leaders and are removed. A named person is left as { id, name }.
 *
 * Dry-run by default. Prod requires --project mosaic-hymn-database --i-mean-prod.
 *
 *   node scripts/strip-empty-prayer-leaders.js \
 *       --project mosaic-hymn-database --i-mean-prod
 *   node scripts/strip-empty-prayer-leaders.js \
 *       --project mosaic-hymn-database --i-mean-prod --commit
 */

const path = require('path');
const Plan = require('../public/strip-empty-prayer-leaders-core.js');
const {loadProject} = require('./firebase-project.js');

/**
 * @param {string[]} argv
 * @return {boolean}
 */
function committing(argv) {
    return argv.includes('--commit');
}

/**
 * @param {string[]} argv
 * @return {boolean}
 */
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
        servicesWithEmpty: 0,
        wouldDeletePaths: 0,
    };
    const planned = [];

    const snap = await db.collection('services').get();
    for (const doc of snap.docs) {
        totals.servicesScanned += 1;
        const plan = Plan.planEmptyPrayerLeaderDeletion(doc.data() || {});
        if (!plan.deletePaths.length) continue;
        totals.servicesWithEmpty += 1;
        totals.wouldDeletePaths += plan.deletePaths.length;
        planned.push({serviceId: doc.id, deletePaths: plan.deletePaths});
    }

    if (COMMIT) {
        const batchSize = 400;
        let batch = db.batch();
        let batchCount = 0;
        for (const row of planned) {
            /** @type {Record<string, any>} */
            const patch = {};
            row.deletePaths.forEach((field) => {
                patch[field] = FieldValue.delete();
            });
            batch.update(db.collection('services').doc(row.serviceId), patch);
            batchCount += 1;
            if (batchCount >= batchSize) {
                await batch.commit();
                batch = db.batch();
                batchCount = 0;
            }
        }
        if (batchCount > 0) await batch.commit();
    } else {
        planned.forEach((row) => console.log(JSON.stringify(row)));
    }

    console.log(JSON.stringify({
        mode: COMMIT ? 'commit' : 'dry-run',
        projectId,
        totals,
        serviceIds: planned.map((row) => row.serviceId),
    }, null, 2));
}

if (require.main === module) {
    main().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}
