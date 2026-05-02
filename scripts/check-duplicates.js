/**
 * @fileoverview Utility script to identify duplicate hymn entries in Firestore.
 * Duplicates are identified based on the 'hymn_name' field.
 */

const admin = require('firebase-admin');

const FIREBASE_PROJECT_ID = 'mosaic-hymn-database';
const serviceAccount = require('./mosaic-hymn-database-firebase-adminsdk-fbsvc-8d55863f5a.json');

try {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: FIREBASE_PROJECT_ID,
    });
} catch (e) {
    console.error(`Error initializing Firebase Admin SDK:`, e);
    process.exit(1);
}

const db = admin.firestore();

/**
 * Fetches all hymns from Firestore and logs any duplicates found by name.
 * @async
 * @function checkDuplicates
 */
async function checkDuplicates() {
    console.log('Checking for duplicate hymns...');

    try {
        const snapshot = await db.collection('hymns').get();
        const hymns = [];
        snapshot.forEach(doc => {
            hymns.push({ id: doc.id, ...doc.data() });
        });

        const nameGroups = {};
        hymns.forEach(hymn => {
            if (!nameGroups[hymn.hymn_name]) {
                nameGroups[hymn.hymn_name] = [];
            }
            nameGroups[hymn.hymn_name].push(hymn);
        });

        let duplicatesFound = false;
        for (const name in nameGroups) {
            if (nameGroups[name].length > 1) {
                duplicatesFound = true;
                console.log(`\nDuplicate found for hymn: "${name}"`);
                nameGroups[name].forEach(hymn => {
                    console.log(`  - ID: ${hymn.id}, Music: ${hymn.music_writer}, Lyrics: ${hymn.lyrics_writer}`);
                });
            }
        }

        if (!duplicatesFound) {
            console.log('No duplicates found.');
        } else {
            console.log('\nDuplicates identified above.');
        }

    } catch (error) {
        console.error('Error checking duplicates:', error);
    }
}

checkDuplicates();