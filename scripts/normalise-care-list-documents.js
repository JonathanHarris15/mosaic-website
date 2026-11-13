/**
 * Rewrite care-list elder_documents onto the column shape (MS-787).
 *
 * Dry-run by default. Prod requires --project mosaic-hymn-database --i-mean-prod.
 *
 *   node scripts/normalise-care-list-documents.js \
 *       --project mosaic-hymn-database --i-mean-prod
 *   node scripts/normalise-care-list-documents.js \
 *       --project mosaic-hymn-database --i-mean-prod --commit
 */

const path = require('path');
const Plan = require('../public/normalise-care-list-documents-core.js');
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

    const totals = {
        careListsScanned: 0,
        wouldNormalise: 0,
    };
    const planned = [];

    const snap = await db.collection('elder_documents').where('docType', '==', 'care-list').get();
    for (const doc of snap.docs) {
        totals.careListsScanned += 1;
        const plan = Plan.planCareListNormalise(doc.data() || {});
        if (!plan.needsNormalise || !plan.patch) continue;
        totals.wouldNormalise += 1;
        planned.push({documentId: doc.id, patch: plan.patch});
    }

    if (COMMIT) {
        const batchSize = 200;
        let batch = db.batch();
        let batchCount = 0;
        for (const row of planned) {
            batch.update(db.collection('elder_documents').doc(row.documentId), row.patch);
            batchCount += 1;
            if (batchCount >= batchSize) {
                await batch.commit();
                batch = db.batch();
                batchCount = 0;
            }
        }
        if (batchCount > 0) await batch.commit();
    } else {
        planned.forEach((row) => console.log(JSON.stringify({
            documentId: row.documentId,
            careListColumns: row.patch.careListColumns.length,
            personCount: Object.keys(row.patch.careListData).length,
        })));
    }

    console.log(JSON.stringify({
        mode: COMMIT ? 'commit' : 'dry-run',
        projectId,
        totals,
        documentIds: planned.map((row) => row.documentId),
    }, null, 2));
}

if (require.main === module) {
    main().catch((err) => {
        console.error(err && err.message ? err.message : err);
        process.exit(1);
    });
}

module.exports = {main};
