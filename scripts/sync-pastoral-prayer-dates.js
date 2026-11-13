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
 * Dry-run by default. Prod requires --project mosaic-hymn-database --i-mean-prod.
 *
 *   node scripts/sync-pastoral-prayer-dates.js \
 *       --project mosaic-hymn-database --i-mean-prod
 *   node scripts/sync-pastoral-prayer-dates.js \
 *       --project mosaic-hymn-database --i-mean-prod --commit
 */

const SyncCore = require('../public/sync-pastoral-prayer-dates-core.js');
const { serviceAccount } = require('./service-account.js');
const { normalizeDate, latestDate, HISTORY_COLLECTION } =
    require('../public/pastoral-prayer-core.js');

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
    const APPLY = willWrite(argv);
    if (committing(argv) && !APPLY) {
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

    console.log(`Rebuilding lastPastoralPrayerDate from history${APPLY ? '' : ' (dry run)'}...`);

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

    const peopleSnap = await db.collection('people').get();
    const corrections = [];
    peopleSnap.forEach(doc => {
        const stored = doc.data().lastPastoralPrayerDate;
        const historyDates = datesByPerson[doc.id] || [];
        if (!SyncCore.needsCacheCorrection(stored, historyDates)) return;
        const truth = latestDate(historyDates);
        corrections.push({ ref: doc.ref, name: doc.data().name, stored, truth });
    });

    console.log(`${peopleSnap.size} people checked, ${corrections.length} out of step.`);
    corrections.forEach(c => console.log(
        `  ${c.name || c.ref.id}: ` +
        `${c.stored === undefined ? '(unset)' : JSON.stringify(c.stored)} -> ${JSON.stringify(c.truth)}`));

    if (!APPLY) {
        console.log('Dry run — nothing written.');
        return;
    }

    for (let i = 0; i < corrections.length; i += BATCH_SIZE) {
        const batch = db.batch();
        corrections.slice(i, i + BATCH_SIZE).forEach(c => {
            batch.update(c.ref, { lastPastoralPrayerDate: c.truth });
        });
        await batch.commit();
        console.log(`Updated ${Math.min(i + BATCH_SIZE, corrections.length)}/${corrections.length}...`);
    }

    console.log('Done.');
}

main().then(() => process.exit(0)).catch(err => {
    console.error(err);
    process.exit(1);
});
