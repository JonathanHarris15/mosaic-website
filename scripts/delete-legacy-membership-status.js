/**
 * Backfill membership.inactive from legacy status and delete membership.status (MS-786).
 *
 * Dry-run by default. Prod requires --project mosaic-hymn-database --i-mean-prod.
 *
 *   node scripts/delete-legacy-membership-status.js \
 *       --project mosaic-hymn-database --i-mean-prod
 *   node scripts/delete-legacy-membership-status.js \
 *       --project mosaic-hymn-database --i-mean-prod --commit
 */

const path = require('path');
const Plan = require('../public/delete-legacy-membership-status-core.js');
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
        peopleScanned: 0,
        peopleWithStatus: 0,
        wouldSetInactive: 0,
        wouldDeleteStatus: 0,
        blockedPeople: 0,
    };
    const blocked = [];
    const planned = [];

    const snap = await db.collection('people').get();
    for (const doc of snap.docs) {
        totals.peopleScanned += 1;
        const plan = Plan.planMembershipStatusRemoval(doc.data() || {});
        if (plan.blocked) {
            totals.blockedPeople += 1;
            totals.peopleWithStatus += 1;
            blocked.push({personId: doc.id, blockReasons: plan.blockReasons});
            continue;
        }
        if (!plan.setInactive && !plan.deleteStatus) continue;
        totals.peopleWithStatus += 1;
        if (plan.setInactive) totals.wouldSetInactive += 1;
        if (plan.deleteStatus) totals.wouldDeleteStatus += 1;
        planned.push({personId: doc.id, setInactive: plan.setInactive, deleteStatus: plan.deleteStatus});
    }

    if (blocked.length) {
        console.log(JSON.stringify({blocked, totals}, null, 2));
        console.error(
            `Abort: ${blocked.length} person document(s) have membership.status that disagrees with membership.stage.`);
        process.exit(1);
    }

    if (COMMIT) {
        const batchSize = 400;
        let batch = db.batch();
        let batchCount = 0;
        for (const row of planned) {
            /** @type {Record<string, any>} */
            const patch = {};
            if (row.setInactive) patch['membership.inactive'] = true;
            if (row.deleteStatus) patch['membership.status'] = FieldValue.delete();
            batch.update(db.collection('people').doc(row.personId), patch);
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
        personIds: planned.map((row) => row.personId),
    }, null, 2));
}

if (require.main === module) {
    main().catch((err) => {
        console.error(err && err.message ? err.message : err);
        process.exit(1);
    });
}

module.exports = {main};
