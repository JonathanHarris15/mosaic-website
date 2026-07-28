/**
 * @fileoverview Backfill: stamp every existing Involvement record with the Event
 * series it belonged to (MS-27, ADR-0016 §5).
 *
 * Fairness is counted per Event series, so an Involvement record has to say
 * which series it came from. Every record written before that field existed is a
 * Sunday Service — this stamps them all with `sunday_service`.
 *
 * Reading Involvement already falls back to the Sunday Service when the field is
 * absent (EventsCore.seriesIdOf), so the app is correct BEFORE this runs. The
 * backfill exists so the field can be relied on by a Firestore query, which
 * cannot fall back.
 *
 * Idempotent: records that already carry a series are skipped, so a second run
 * reports "nothing to do" and writes nothing.
 *
 * Run:  node scripts/backfill-involvement-series.js [--dry-run]
 */

const admin = require('firebase-admin');
const path = require('path');
const EventsCore = require('../public/events-core.js');

const SERVICE_ACCOUNT_FILE = 'mosaic-hymn-database-firebase-adminsdk-fbsvc-8d55863f5a.json';
const FIREBASE_PROJECT_ID = 'mosaic-hymn-database';
const BATCH_SIZE = 400;

const DRY_RUN = process.argv.includes('--dry-run');

const serviceAccountPath = path.join(__dirname, '..', SERVICE_ACCOUNT_FILE);
const serviceAccount = require(serviceAccountPath);

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: FIREBASE_PROJECT_ID,
});

const db = admin.firestore();

async function run() {
    console.log(
        `Backfilling Involvement series -> "${EventsCore.SUNDAY_SERVICE_ID}"` +
        (DRY_RUN ? ' (dry run)' : '')
    );

    // A collection-group query reaches every person's involvement subcollection
    // in one pass, the same way the app already queries involvement across People.
    const snap = await db.collectionGroup('involvement').get();

    const needsSeries = snap.docs.filter(doc => !doc.data().seriesId);
    console.log(`${snap.size} Involvement records, ${needsSeries.length} without a series.`);

    if (needsSeries.length === 0) {
        console.log('Nothing to do — every record already carries its series.');
        return;
    }

    if (DRY_RUN) {
        console.log('Dry run: no writes made.');
        return;
    }

    let written = 0;
    for (let i = 0; i < needsSeries.length; i += BATCH_SIZE) {
        const batch = db.batch();
        needsSeries.slice(i, i + BATCH_SIZE).forEach(doc => {
            batch.update(doc.ref, { seriesId: EventsCore.SUNDAY_SERVICE_ID });
        });
        await batch.commit();
        written += Math.min(BATCH_SIZE, needsSeries.length - i);
        console.log(`  ${written}/${needsSeries.length}`);
    }

    console.log(`Backfill complete — ${written} records stamped.`);
}

run()
    .then(() => process.exit(0))
    .catch(err => {
        console.error(err);
        process.exit(1);
    });
