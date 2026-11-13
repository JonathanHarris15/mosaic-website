/**
 * @fileoverview Backfill: stamp `visibility` and `rosterShared` onto occurrence
 * documents that were written without them (ADR-0018 §5, MS-783).
 *
 * Dry-run by default. Prod requires --project mosaic-hymn-database --i-mean-prod.
 *
 *   node scripts/backfill-occurrence-visibility.js \
 *       --project mosaic-hymn-database --i-mean-prod
 *   node scripts/backfill-occurrence-visibility.js \
 *       --project mosaic-hymn-database --i-mean-prod --commit
 */

const BackfillCore = require('../public/backfill-occurrence-visibility-core.js');
const { serviceAccount } = require('./service-account.js');

const BATCH_SIZE = 400;

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

    const admin = require('firebase-admin');
    if (!admin.apps.length) {
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount()),
            projectId,
        });
    }

    const db = admin.firestore();

    console.log(`Backfilling occurrence visibility${COMMIT ? '' : ' (dry run)'}\n`);

    const [occurrences, seriesSnap] = await Promise.all([
        db.collection('event_occurrences').get(),
        db.collection('events').get(),
    ]);

    const seriesById = {};
    seriesSnap.docs.forEach(d => { seriesById[d.id] = d.data() || {}; });

    const needing = occurrences.docs.filter(d =>
        BackfillCore.occurrenceNeedsVisibilityStamp(d.data()));

    console.log(`  ${occurrences.size} occurrence documents`);
    console.log(`  ${occurrences.size - needing.length} already stamped`);
    console.log(`  ${needing.length} to stamp\n`);

    if (!needing.length) {
        console.log('Nothing to do.');
        return;
    }

    const orphans = [];
    const fixable = [];

    needing.forEach(d => {
        const data = d.data() || {};
        const plan = BackfillCore.planStampForOccurrence(data, seriesById);
        if (plan.kind === 'orphan') {
            orphans.push(d);
            return;
        }
        if (plan.kind === 'stamp') {
            fixable.push({ doc: d, data, stamp: plan.stamp });
        }
    });

    if (orphans.length) {
        console.log(`  ⚠ ${orphans.length} have no seriesId and are being SKIPPED —`);
        console.log('    a one-off has no series to inherit a stamp from. Set these by hand:');
        orphans.forEach(d => console.log(`      ${d.id}`));
        console.log('');
    }

    let written = 0;
    for (let i = 0; i < fixable.length; i += BATCH_SIZE) {
        const chunk = fixable.slice(i, i + BATCH_SIZE);
        const batch = db.batch();

        chunk.forEach(({ doc, data, stamp }) => {
            console.log(
                `  ${doc.id}  ${data.date || '(no date)'}  ->  ` +
                `visibility=${stamp.visibility} rosterShared=${stamp.rosterShared}`
            );
            if (COMMIT) batch.set(doc.ref, stamp, { merge: true });
            written++;
        });

        if (COMMIT) await batch.commit();
    }

    console.log(`\n${COMMIT ? 'Stamped' : 'Would stamp'} ${written} occurrence document(s).`);
    if (orphans.length) console.log(`Skipped ${orphans.length} with no series.`);
}

main().then(() => process.exit(0)).catch(e => {
    console.error('Backfill failed:', e);
    process.exit(1);
});
