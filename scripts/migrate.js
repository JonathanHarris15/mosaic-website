const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

// --- IMPORTANT ---
// Make sure your Firebase Project ID is correct here.
const FIREBASE_PROJECT_ID = 'mosaic-hymn-database';
// ---

const serviceAccount = require('./mosaic-hymn-database-firebase-adminsdk-fbsvc-8d55863f5a.json');

// Initialize the Firebase Admin SDK
try {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: FIREBASE_PROJECT_ID,
    });
} catch (e) {
    console.error(`Error initializing Firebase Admin SDK. Please make sure you are logged in with the Firebase CLI and that the project ID "${FIREBASE_PROJECT_ID}" is correct.`);
    process.exit(1);
}


const db = admin.firestore();
const hymnsJsonPath = path.join(__dirname, 'public', 'hymn_index.json');

async function migrateHymns() {
    console.log('Starting migration...');

    try {
        const fileContent = fs.readFileSync(hymnsJsonPath, 'utf8');
        const hymns = JSON.parse(fileContent);

        console.log(`Found ${hymns.length} hymns in hymn_index.json.`);

        const batch = db.batch();

        for (const hymn of hymns) {
            // Use the existing 'id' from the JSON as the document ID in Firestore
            const docRef = db.collection('hymns').doc(hymn.id);

            // Create a structured object for Firestore
            const firestoreHymn = {
                hymn_name: hymn.hymn_name,
                lyrics_writer: hymn.lyrics_writer,
                music_writer: hymn.music_writer,
                last_played_date: hymn.last_played_date,
                // Create a default 'versions' array based on our proposed structure
                versions: [
                    {
                        name: "Default",
                        pages: [] // Assuming no images yet
                    }
                ]
            };

            batch.set(docRef, firestoreHymn);
        }

        await batch.commit();

        console.log('----------------------------------------------------');
        console.log(`✅ Successfully migrated ${hymns.length} hymns to Cloud Firestore!`);
        console.log('You can now view the data in your Firebase console.');
        console.log('----------------------------------------------------');

    } catch (error) {
        console.error('Migration failed:', error);
        process.exit(1);
    }
}

migrateHymns();
