/**
 * @fileoverview Sync script to populate the 'totalInvolvements' field on all people documents.
 */

const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

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
    console.log('Syncing total involvement counts...');
    
    const peopleSnap = await db.collection('people').get();
    console.log(`Found ${peopleSnap.size} people.`);

    const batch = db.batch();
    let count = 0;

    for (const personDoc of peopleSnap.docs) {
        const involvementsSnap = await personDoc.ref.collection('involvement').get();
        const total = involvementsSnap.size;
        
        batch.update(personDoc.ref, { totalInvolvements: total });
        console.log(`- ${personDoc.data().name}: ${total}`);
        count++;

        if (count >= 400) { // Batch limit 500
            await batch.commit();
            console.log('Batch committed.');
            count = 0;
        }
    }

    if (count > 0) {
        await batch.commit();
        console.log('Final batch committed.');
    }

    console.log('Sync complete!');
    process.exit(0);
}

run().catch(console.error);
