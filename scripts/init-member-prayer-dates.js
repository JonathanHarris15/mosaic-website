/**
 * @fileoverview Script to ensure every Member has a 'lastPastoralPrayerDate' field.
 * Defaults to '0000-00-00' if no history is found.
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
    console.log('Initializing Pastoral Prayer Dates for all Members...');
    
    // 1. Fetch all members
    const membersSnap = await db.collection('people')
        .where('tags', 'array-contains', 'Member')
        .get();
    
    console.log(`Found ${membersSnap.size} members.`);

    // 2. Fetch history using Collection Group to get existing dates
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

    // 3. Prepare updates
    const batch = db.batch();
    let updatedCount = 0;

    membersSnap.forEach(doc => {
        const data = doc.data();
        const existingDate = data.lastPastoralPrayerDate;
        const historyDate = personLatestDate[doc.id];
        
        // Target date: history date > existing date > placeholder
        let targetDate = historyDate || existingDate || '0000-00-00';

        if (existingDate !== targetDate) {
            batch.update(doc.ref, { lastPastoralPrayerDate: targetDate });
            updatedCount++;
        }
    });

    if (updatedCount > 0) {
        await batch.commit();
    }

    console.log(`Initialization complete! Updated ${updatedCount} records.`);
    process.exit(0);
}

run().catch(console.error);
