/**
 * Delete documents in the legacy `households` collection (MS-785).
 *
 * The kiosk groups from `families` (ADR-0075). Nothing in the app reads this
 * collection anymore. Each document is removed; nothing else is touched.
 *
 * Dry-run by default. Prod requires --project mosaic-hymn-database --i-mean-prod.
 *
 *   node scripts/delete-legacy-households.js \
 *       --project mosaic-hymn-database --i-mean-prod
 *   node scripts/delete-legacy-households.js \
 *       --project mosaic-hymn-database --i-mean-prod --commit
 */

const path = require('path');
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

    const snap = await db.collection('households').get();
    const ids = snap.docs.map((d) => d.id);
    const totals = {householdsScanned: ids.length, wouldDelete: ids.length};

    if (COMMIT) {
        const batchSize = 400;
        let batch = db.batch();
        let batchCount = 0;
        for (const id of ids) {
            batch.delete(db.collection('households').doc(id));
            batchCount += 1;
            if (batchCount >= batchSize) {
                await batch.commit();
                batch = db.batch();
                batchCount = 0;
            }
        }
        if (batchCount > 0) await batch.commit();
    } else {
        ids.forEach((id) => console.log(JSON.stringify({householdId: id, action: 'delete'})));
    }

    console.log(JSON.stringify({
        mode: COMMIT ? 'commit' : 'dry-run',
        projectId,
        totals,
        householdIds: ids,
    }, null, 2));
}

if (require.main === module) {
    main().catch((err) => {
        console.error(err && err.message ? err.message : err);
        process.exit(1);
    });
}

module.exports = {main};
