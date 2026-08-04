/**
 * @fileoverview Rebuild every Person's `lastPastoralPrayerDate` from their
 * pastoral prayer history.
 *
 * The field is a cache of the newest date in `people/{id}/pastoral_prayer_history`
 * (future dates included — a Sunday already booked must stop the rotation
 * offering that person). Four surfaces used to maintain it by hand and none of
 * them agreed, so the stored values drifted from the history three ways:
 *
 *   - The Order of Service editor read the history BEFORE committing its own
 *     write, so a chosen subject kept their previous date and a removed subject
 *     kept the date they had just lost.
 *   - Two paths wrote the string '0000-00-00' for "never" and two wrote null.
 *   - Nothing ever cleared the field for a person whose last history record was
 *     deleted, so a removed subject stayed "recently prayed for" for good.
 *
 * Safe to run repeatedly. Unlike its earlier version this also CLEARS the field
 * for people with no history left and normalizes '0000-00-00' to null — the two
 * cases that quietly hold a member out of the rotation.
 *
 * Usage: node scripts/sync-pastoral-prayer-dates.js [--dry-run]
 */

const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

const FIREBASE_PROJECT_ID = 'mosaic-hymn-database';

// Find the key by shape, not by name. The older scripts hardcode a filename,
// and every one of them breaks the day the key is rotated.
function resolveServiceAccount() {
    const root = path.join(__dirname, '..');
    const match = fs.readdirSync(root).find(
        f => f.startsWith('mosaic-hymn-database-firebase-adminsdk') && f.endsWith('.json')
    );
    if (!match) throw new Error('No mosaic-hymn-database-firebase-adminsdk-*.json found in project root.');
    return require(path.join(root, match));
}

admin.initializeApp({
    credential: admin.credential.cert(resolveServiceAccount()),
    projectId: FIREBASE_PROJECT_ID
});

const db = admin.firestore();

// The same rules the app runs on, so the repair and the live writes can never
// disagree about what a stored date means.
const { normalizeDate, latestDate, HISTORY_COLLECTION } =
    require('../public/pastoral-prayer-core.js');

const APPLY = !process.argv.includes('--dry-run');

async function run() {
    console.log(`Rebuilding lastPastoralPrayerDate from history${APPLY ? '' : ' (dry run)'}...`);

    // 1. Every history date, per person.
    const historySnap = await db.collectionGroup(HISTORY_COLLECTION).get();
    const datesByPerson = {};
    historySnap.forEach(doc => {
        const personId = doc.ref.parent.parent.id;
        const date = normalizeDate(doc.data().serviceDate || doc.id);
        if (!date) return;
        (datesByPerson[personId] = datesByPerson[personId] || []).push(date);
    });
    console.log(`Read ${historySnap.size} history records for ` +
        `${Object.keys(datesByPerson).length} people.`);

    // 2. Compare against every Person — including those with no history, whose
    // field has to be cleared rather than left standing.
    const peopleSnap = await db.collection('people').get();
    const corrections = [];
    peopleSnap.forEach(doc => {
        const stored = doc.data().lastPastoralPrayerDate;
        const truth = latestDate(datesByPerson[doc.id] || []);
        const alreadyRight = stored === truth || (truth === null && stored === undefined);
        if (!alreadyRight) {
            corrections.push({ ref: doc.ref, name: doc.data().name, stored, truth });
        }
    });

    console.log(`${peopleSnap.size} people checked, ${corrections.length} out of step.`);
    corrections.forEach(c => console.log(
        `  ${c.name || c.ref.id}: ` +
        `${c.stored === undefined ? '(unset)' : JSON.stringify(c.stored)} -> ${JSON.stringify(c.truth)}`));

    if (!APPLY) {
        console.log('Dry run — nothing written.');
        process.exit(0);
    }

    // 3. Write.
    const BATCH_SIZE = 400;
    for (let i = 0; i < corrections.length; i += BATCH_SIZE) {
        const batch = db.batch();
        corrections.slice(i, i + BATCH_SIZE).forEach(c => {
            batch.update(c.ref, { lastPastoralPrayerDate: c.truth });
        });
        await batch.commit();
        console.log(`Updated ${Math.min(i + BATCH_SIZE, corrections.length)}/${corrections.length}...`);
    }

    console.log('Done.');
    process.exit(0);
}

run().catch(err => {
    console.error(err);
    process.exit(1);
});
