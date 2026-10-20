/**
 * Clear lastSendAttemptDate on specific pastoral-prayer request docs so the
 * hourly sender can retry after a Textbelt failure.
 *
 * Dry-run by default. Prod needs --project mosaic-hymn-database --i-mean-prod.
 *
 *   node scripts/reset-prayer-send-attempt.js \
 *       --project mosaic-hymn-database --i-mean-prod \
 *       --service-date 2026-10-25 \
 *       --ids yOhdWHurhmFxn7KKfZTv,rtLaPcywYrcNcdQyt1xp
 *
 *   node scripts/reset-prayer-send-attempt.js ... --commit
 */

const admin = require('firebase-admin');
const {
    parsePersonIds,
    assertServiceDate,
    planClears,
} = require('./reset-prayer-send-attempt-lib');

function arg(name) {
    const i = process.argv.indexOf(name);
    return i === -1 ? null : process.argv[i + 1];
}

function initAdmin(projectId) {
    if (!admin.apps.length) {
        admin.initializeApp({
            credential: admin.credential.cert(require(require('./service-account').serviceAccountPath())),
            projectId,
        });
    }
    return admin.firestore();
}

async function main() {
    const commit = process.argv.includes('--commit');
    const serviceDate = arg('--service-date');
    const personIds = parsePersonIds(arg('--ids'));
    assertServiceDate(serviceDate);

    const projectId = require('./firebase-project').requireProject(process.argv);
    const db = initAdmin(projectId);
    const plans = planClears(serviceDate, personIds);

    for (const plan of plans) {
        const ref = db.doc(plan.path);
        const snap = await ref.get();
        const before = snap.exists ? (snap.data().lastSendAttemptDate || null) : null;
        console.log(
            `${commit ? 'APPLY' : 'DRY RUN'} — ${plan.path}: ` +
            `lastSendAttemptDate ${JSON.stringify(before)} → null`);
        if (!commit) continue;
        if (!snap.exists) {
            console.log(`  skip: document does not exist`);
            continue;
        }
        await ref.set({
            serviceDate,
            lastSendAttemptDate: admin.firestore.FieldValue.delete(),
        }, {merge: true});
    }
    if (commit) console.log('Done.');
}

main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
});
