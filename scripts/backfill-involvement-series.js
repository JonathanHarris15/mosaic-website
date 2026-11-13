/**
 * @fileoverview Backfill: stamp every existing Involvement record with the Event
 * series it belonged to (MS-27, MS-782, ADR-0016 §5).
 *
 * Fairness queries filter on `seriesId`; records written before that field
 * existed must be stamped (historically Sunday Service).
 *
 * Idempotent: records that already carry a series are skipped.
 *
 * Dry-run by default. Prod requires --project mosaic-hymn-database --i-mean-prod.
 *
 *   node scripts/backfill-involvement-series.js \
 *       --project mosaic-hymn-database --i-mean-prod
 *   node scripts/backfill-involvement-series.js \
 *       --project mosaic-hymn-database --i-mean-prod --commit
 */

const path = require('path');
const EventsCore = require('../public/events-core.js');
const {loadProject} = require('./firebase-project.js');

const BATCH_SIZE = 400;

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

    console.log(
        `Backfilling Involvement series -> "${EventsCore.SUNDAY_SERVICE_ID}"` +
        (COMMIT ? '' : ' (dry run)')
    );

    const snap = await db.collectionGroup('involvement').get();
    const needsSeries = snap.docs.filter((doc) => !doc.data().seriesId);

    console.log(JSON.stringify({
        involvementScanned: snap.size,
        withoutSeriesId: needsSeries.length,
    }, null, 2));

    if (needsSeries.length === 0) {
        console.log('Nothing to do — every record already carries its series.');
        return;
    }

    if (!COMMIT) {
        console.log('Dry run: no writes made.');
        return;
    }

    let written = 0;
    for (let i = 0; i < needsSeries.length; i += BATCH_SIZE) {
        const batch = db.batch();
        needsSeries.slice(i, i + BATCH_SIZE).forEach((doc) => {
            batch.update(doc.ref, { seriesId: EventsCore.SUNDAY_SERVICE_ID });
        });
        await batch.commit();
        written += Math.min(BATCH_SIZE, needsSeries.length - i);
        console.log(`  ${written}/${needsSeries.length}`);
    }

    console.log(`Backfill complete — ${written} records stamped.`);
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
