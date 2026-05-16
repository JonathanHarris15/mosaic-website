/**
 * @fileoverview One-time script to sync 'lastPastoralPrayerDate' on person records.
 * It scans all pastoral prayer history and sets the date to the latest serviceDate found (past or future).
 */

const admin = require('firebase-admin');
const path = require('path');

const SERVICE_ACCOUNT_FILE = 'mosaic-hymn-database-firebase-adminsdk-fbsvc-8d55863f5a.json';
const FIREBASE_PROJECT_ID = 'mosaic-hymn-database';

const serviceAccountPath = path.join(__dirname, '..', SERVICE_ACCOUNT_FILE);
const serviceAccount = require(serviceAccountPath);

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: FIREBASE_PROJECT_ID
});

const db = admin.firestore();

async function run() {
    console.log('Starting Pastoral Prayer Date Sync...');
    
    // 1. Fetch all history records using Collection Group
    const historySnap = await db.collectionGroup('pastoral_prayer_history').get();
    const personLatestDate = {}; // personId -> latestDate string

    historySnap.forEach(doc => {
        const data = doc.data();
        const date = data.serviceDate;
        const personId = doc.ref.parent.parent.id;

        if (date && (!personLatestDate[personId] || date > personLatestDate[personId])) {
            personLatestDate[personId] = date;
        }
    });

    console.log(`Found ${Object.keys(personLatestDate).length} people with prayer history.`);

    // 2. Update people records
    const personIds = Object.keys(personLatestDate);
    const BATCH_SIZE = 400;
    let count = 0;

    for (let i = 0; i < personIds.length; i += BATCH_SIZE) {
        const batch = db.batch();
        const chunk = personIds.slice(i, i + BATCH_SIZE);

        chunk.forEach(id => {
            batch.update(db.collection('people').doc(id), {
                lastPastoralPrayerDate: personLatestDate[id]
            });
            count++;
        });

        await batch.commit();
        console.log(`Updated ${count} people...`);
    }

    console.log('Sync complete!');
    process.exit(0);
}

run().catch(console.error);
