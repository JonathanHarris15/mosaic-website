/**
 * @fileoverview Backfill: stamp `visibility` and `rosterShared` onto occurrence
 * documents that were written without them (ADR-0018 §5).
 *
 * A security rule reads `resource.data.visibility` off the occurrence document
 * and cannot go and look at the series. `stampedVisibility()` in firestore.rules
 * answers 'none' when the field is absent, and `rankCanSee('none')` is false on
 * every branch — so a document written without the stamp is one NOBODY can read
 * back, including the editor who just wrote it.
 *
 * `acceptDraft` (accepting an auto-assign roster) created occurrence documents
 * for dates that had none and never stamped them. The seats landed in the roster
 * subcollection, which an editor may still read, but the document itself was
 * refused — so the Event detail page fell back to rebuilding the date from its
 * series and showed every place as needing people. The same dates also dropped
 * off the Calendar, whose list queries filter on `visibility`.
 *
 * The store no longer writes an unstamped occurrence. This repairs the ones
 * already written.
 *
 * The stamp is taken from the series, matching `stampFor` in events-store.js:
 * the series' own visibility, or 'public' for the Sunday Service (permanently
 * public, and its series document carries no stamp of its own), or 'member'.
 *
 * Idempotent: a document that already carries `visibility` is left completely
 * alone, so a second run reports "nothing to do" and writes nothing.
 *
 * Run:  node scripts/backfill-occurrence-visibility.js [--dry-run]
 */

const admin = require('firebase-admin');
const Core = require('../public/events-occurrence-core.js');

const FIREBASE_PROJECT_ID = 'mosaic-hymn-database';
const BATCH_SIZE = 400;

const DRY_RUN = process.argv.includes('--dry-run');

const { serviceAccount } = require('./service-account.js');

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount()),
    projectId: FIREBASE_PROJECT_ID,
});

const db = admin.firestore();

// The same resolution the store uses when it creates an occurrence.
function stampFor(series, seriesId) {
    return {
        visibility: (series && series.visibility)
            || (seriesId === Core.SUNDAY_SERVICE_ID ? 'public' : 'member'),
        rosterShared: !!(series && series.rosterShared === true),
    };
}

async function run() {
    console.log(`Backfilling occurrence visibility${DRY_RUN ? ' (DRY RUN)' : ''}\n`);

    const [occurrences, seriesSnap] = await Promise.all([
        db.collection('event_occurrences').get(),
        db.collection('events').get(),
    ]);

    const seriesById = {};
    seriesSnap.docs.forEach(d => { seriesById[d.id] = d.data() || {}; });

    const needing = occurrences.docs.filter(d => !('visibility' in (d.data() || {})));

    console.log(`  ${occurrences.size} occurrence documents`);
    console.log(`  ${occurrences.size - needing.length} already stamped`);
    console.log(`  ${needing.length} to stamp\n`);

    if (!needing.length) {
        console.log('Nothing to do.');
        return;
    }

    // A one-off Event has no series to inherit from. It also cannot be reached
    // by this path — `acceptDraft` only ever writes for a series — so an
    // unstamped one means something else is wrong, and guessing a visibility for
    // it would be inventing a security answer. Reported, never written.
    const orphans = needing.filter(d => !(d.data() || {}).seriesId);
    const fixable = needing.filter(d => (d.data() || {}).seriesId);

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

        chunk.forEach(doc => {
            const data = doc.data() || {};
            const stamp = stampFor(seriesById[data.seriesId], data.seriesId);
            console.log(
                `  ${doc.id}  ${data.date || '(no date)'}  ->  ` +
                `visibility=${stamp.visibility} rosterShared=${stamp.rosterShared}`
            );
            if (!DRY_RUN) batch.set(doc.ref, stamp, { merge: true });
            written++;
        });

        if (!DRY_RUN) await batch.commit();
    }

    console.log(`\n${DRY_RUN ? 'Would stamp' : 'Stamped'} ${written} occurrence document(s).`);
    if (orphans.length) console.log(`Skipped ${orphans.length} with no series.`);
}

run().then(() => process.exit(0)).catch(e => {
    console.error('Backfill failed:', e);
    process.exit(1);
});
