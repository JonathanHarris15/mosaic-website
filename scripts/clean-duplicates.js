/**
 * @fileoverview Utility script to clean up duplicate hymn entries in Firestore.
 * Keeps the first entry found for a given name and deletes the rest.
 */

const admin = require('firebase-admin');
const readline = require('readline');

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

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

/**
 * Identifies and deletes duplicate hymns.
 * Can be run with --force to skip confirmation.
 * @async
 * @function cleanDuplicates
 */
async function cleanDuplicates() {
    console.log('Fetching hymns for cleanup...');

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

        const toDelete = [];
        for (const name in nameGroups) {
            if (nameGroups[name].length > 1) {
                // Keep the first one, delete the rest
                const [keep, ...others] = nameGroups[name];
                console.log(`
Duplicate found for: "${name}"`);
                console.log(`  Keeping:  ${keep.id}`);
                others.forEach(hymn => {
                    console.log(`  Deleting: ${hymn.id}`);
                    toDelete.push(hymn.id);
                });
            }
        }

        if (toDelete.length === 0) {
            console.log('\nNo duplicates to delete.');
            process.exit(0);
        }

        if (process.argv.includes('--force')) {
             console.log('Deleting duplicates (force mode)...');
             const batch = db.batch();
             toDelete.forEach(id => {
                 batch.delete(db.collection('hymns').doc(id));
             });
             await batch.commit();
             console.log('Successfully cleaned up duplicates.');
             process.exit(0);
        }

        rl.question(`\nAre you sure you want to delete ${toDelete.length} duplicate(s)? (y/N): `, async (answer) => {
            if (answer.toLowerCase() === 'y') {
                console.log('Deleting duplicates...');
                const batch = db.batch();
                toDelete.forEach(id => {
                    batch.delete(db.collection('hymns').doc(id));
                });
                await batch.commit();
                console.log('Successfully cleaned up duplicates.');
            } else {
                console.log('Cleanup cancelled.');
            }
            rl.close();
        });

    } catch (error) {
        console.error('Error during cleanup:', error);
        rl.close();
    }
}

cleanDuplicates();
