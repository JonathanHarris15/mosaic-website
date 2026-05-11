/**
 * @fileoverview Cleanup script to wipe the 'people' collection and its sub-collections.
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

async function deleteCollection(collectionPath, batchSize = 100) {
    const collectionRef = db.collection(collectionPath);
    const query = collectionRef.limit(batchSize);

    return new Promise((resolve, reject) => {
        deleteQueryBatch(db, query, resolve).catch(reject);
    });
}

async function deleteQueryBatch(db, query, resolve) {
    const snapshot = await query.get();

    const batchSize = snapshot.size;
    if (batchSize === 0) {
        resolve();
        return;
    }

    const batch = db.batch();
    snapshot.docs.forEach((doc) => {
        batch.delete(doc.ref);
    });
    await batch.commit();

    process.nextTick(() => {
        deleteQueryBatch(db, query, resolve);
    });
}

async function run() {
    console.log('Cleaning up people and involvement collections...');
    
    const peopleSnap = await db.collection('people').get();
    console.log(`Found ${peopleSnap.size} people to remove.`);

    for (const personDoc of peopleSnap.docs) {
        // Delete involvement sub-collection first
        await deleteCollection(`people/${personDoc.id}/involvement`);
        // Then delete the person
        await personDoc.ref.delete();
        console.log(`Deleted ${personDoc.data().name}`);
    }

    console.log('Cleanup complete!');
    process.exit(0);
}

run().catch(console.error);
