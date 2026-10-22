/**
 * Delete shepherding_reminders after migrate-reminders-to-tasks (MS-791).
 *
 * Dry-run by default. Prod requires --project mosaic-hymn-database --i-mean-prod.
 * Every reminder must already be a Task (migratedFrom) or have no readable due
 * date blocks the run. Never deletes prod data without a successful plan.
 *
 *   node scripts/delete-shepherding-reminders.js \
 *       --project mosaic-hymn-database --i-mean-prod
 *   node scripts/delete-shepherding-reminders.js \
 *       --project mosaic-hymn-database --i-mean-prod --commit
 */

const path = require('path');
const Plan = require('../public/delete-shepherding-reminders-core.js');
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

    const [remSnap, taskSnap] = await Promise.all([
        db.collection(Plan.COLLECTION).get(),
        db.collection(Plan.TASKS).get(),
    ]);
    const reminders = remSnap.docs.map((d) => ({id: d.id, data: d.data()}));
    const tasks = taskSnap.docs.map((d) => ({id: d.id, data: d.data()}));
    const plan = Plan.planDelete(reminders, tasks);

    console.log(`\nDelete ${Plan.COLLECTION} (MS-791) — ${COMMIT ? 'COMMIT' : 'DRY RUN'}\n`);
    console.log(`  reminders scanned: ${reminders.length}`);
    console.log(`  migrated:          ${plan.migrated}`);
    console.log(`  unmigrated:        ${plan.unmigrated}`);
    console.log(`  undated (blocked): ${plan.undated}`);

    if (!reminders.length) {
        console.log('  nothing to delete.');
        return;
    }

    if (!plan.canDelete) {
        console.log('  blocked — run migrate-reminders-to-tasks.js first, or resolve:');
        plan.blocked.slice(0, 20).forEach((line) => console.log('    ' + line));
        if (plan.blocked.length > 20) {
            console.log(`    … and ${plan.blocked.length - 20} more`);
        }
        process.exitCode = 1;
        return;
    }

    if (!COMMIT) {
        console.log(`  would delete ${reminders.length} reminder document(s).`);
        return;
    }

    const BATCH = 400;
    let batch = db.batch();
    let pending = 0;
    for (const r of reminders) {
        batch.delete(db.collection(Plan.COLLECTION).doc(r.id));
        pending += 1;
        if (pending >= BATCH) {
            await batch.commit();
            batch = db.batch();
            pending = 0;
        }
    }
    if (pending) await batch.commit();
    console.log(`  deleted ${reminders.length} reminder document(s).`);
}

if (require.main === module) {
    main().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}

module.exports = {main};
