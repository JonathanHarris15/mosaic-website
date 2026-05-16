/**
 * @fileoverview Sync script to backfill pastoral prayer male/female subjects in 'services' collection
 * from 'people/pastoral_prayer_history' records.
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
    console.log('Backfilling pastoral prayer subjects...');
    
    // 1. Get all people with their sex
    const peopleSnap = await db.collection('people').get();
    const peopleInfo = {}; // id -> { name, sex }
    peopleSnap.forEach(doc => {
        const data = doc.data();
        peopleInfo[doc.id] = { name: data.name, sex: data.sex };
    });

    // 2. Get all pastoral prayer history records
    console.log('Fetching pastoral prayer history...');
    const historySnap = await db.collectionGroup('pastoral_prayer_history').get();
    
    const servicesToUpdate = {}; // date -> { male: {id, name}, female: {id, name} }

    historySnap.forEach(doc => {
        const data = doc.data();
        const date = data.serviceDate;
        if (!date) return;

        const personId = doc.ref.parent.parent.id;
        const info = peopleInfo[personId];
        if (!info) return;

        if (!servicesToUpdate[date]) {
            servicesToUpdate[date] = { male: null, female: null };
        }

        if (info.sex === 'male') {
            servicesToUpdate[date].male = { id: personId, name: info.name };
        } else if (info.sex === 'female') {
            servicesToUpdate[date].female = { id: personId, name: info.name };
        }
    });

    console.log(`Prepared pastoral prayer updates for ${Object.keys(servicesToUpdate).length} services.`);

    // 3. Update services documents
    const dates = Object.keys(servicesToUpdate);
    let updatedCount = 0;

    for (const date of dates) {
        const serviceRef = db.collection('services').doc(date);
        const serviceDoc = await serviceRef.get();
        
        const update = servicesToUpdate[date];
        // We are updating the liturgy object directly in the service document
        let liturgyData = {};

        if (serviceDoc.exists) {
            const data = serviceDoc.data();
            liturgyData = data.liturgy || {};
        }

        let hasChanges = false;

        if (update.male && (!liturgyData.prayerMale || liturgyData.prayerMale.id !== update.male.id)) {
            liturgyData.prayerMale = update.male;
            hasChanges = true;
        }
        
        if (update.female && (!liturgyData.prayerFemale || liturgyData.prayerFemale.id !== update.female.id)) {
            liturgyData.prayerFemale = update.female;
            hasChanges = true;
        }

        if (hasChanges) {
            await serviceRef.set({ liturgy: liturgyData }, { merge: true });
            updatedCount++;
            if (updatedCount % 10 === 0) console.log(`Updated ${updatedCount} services...`);
        }
    }

    console.log(`Backfill complete! Updated ${updatedCount} services.`);
    process.exit(0);
}

run().catch(console.error);
