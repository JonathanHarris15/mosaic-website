/**
 * @fileoverview Sync script to backfill role IDs in the 'services' collection from 'people/involvement' records.
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
    console.log('Backfilling service roles from involvements...');
    
    const peopleSnap = await db.collection('people').get();
    const peopleData = {}; // id -> name
    peopleSnap.forEach(doc => {
        peopleData[doc.id] = doc.data().name;
    });

    const servicesToUpdate = {}; // date -> { fields }

    for (const personId in peopleData) {
        const name = peopleData[personId];
        const involvementsSnap = await db.collection('people').doc(personId).collection('involvement').get();
        
        involvementsSnap.forEach(doc => {
            const data = doc.data();
            const date = data.serviceDate;
            if (!date) return;

            if (!servicesToUpdate[date]) servicesToUpdate[date] = {};
            const s = servicesToUpdate[date];

            switch (data.type) {
                case 'preacher':
                    s.preacherId = personId;
                    s.preacher = name;
                    break;
                case 'service_leader':
                    s.serviceLeaderId = personId;
                    s.serviceLeader = name;
                    break;
                case 'worship_leader':
                    s.musicLeaderId = personId;
                    s.musicLeader = name;
                    break;
                case 'prayer':
                    if (data.metadata?.prayer_type === 'praise') {
                        s.prayerPraiseId = personId;
                        s.prayerPraiseName = name;
                    } else if (data.metadata?.prayer_type === 'confession') {
                        s.prayerConfessionId = personId;
                        s.prayerConfessionName = name;
                    }
                    break;
                case 'sermonette':
                    s.sermonetteId = personId;
                    s.sermonette = name;
                    break;
            }
        });
    }

    console.log(`Prepared updates for ${Object.keys(servicesToUpdate).length} services.`);

    const BATCH_SIZE = 400;
    const dates = Object.keys(servicesToUpdate);
    
    for (let i = 0; i < dates.length; i += BATCH_SIZE) {
        const batch = db.batch();
        const chunk = dates.slice(i, i + BATCH_SIZE);
        
        chunk.forEach(date => {
            const serviceRef = db.collection('services').doc(date);
            batch.set(serviceRef, servicesToUpdate[date], { merge: true });
        });

        await batch.commit();
        console.log(`Committed batch ${Math.floor(i / BATCH_SIZE) + 1}`);
    }

    console.log('Backfill complete!');
    process.exit(0);
}

run().catch(console.error);
