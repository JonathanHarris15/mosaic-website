/**
 * @fileoverview One-time script to import service involvement from Master Schedule.csv.
 */

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

// --- Configuration ---
const SERVICE_ACCOUNT_FILE = 'mosaic-hymn-database-firebase-adminsdk-fbsvc-8d55863f5a.json';
const CSV_FILE = 'Master Schedule.csv';
const FIREBASE_PROJECT_ID = 'mosaic-hymn-database';

// Initialize Firebase Admin
const serviceAccountPath = path.join(__dirname, '..', SERVICE_ACCOUNT_FILE);
if (!fs.existsSync(serviceAccountPath)) {
    console.error(`Error: ${SERVICE_ACCOUNT_FILE} not found in root.`);
    process.exit(1);
}

const serviceAccount = require(serviceAccountPath);
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: FIREBASE_PROJECT_ID
});

const db = admin.firestore();

// --- Helpers ---

/**
 * Normalizes names to handle misspellings and variations.
 */
function normalizeName(name) {
    if (!name) return '';
    let normalized = name.trim()
        .replace(/\(.*\)/g, '') // Remove parentheticals like (Tenative) or (?)
        .replace(/\.$/, '') // Remove trailing dot
        .replace(/,$/, '')  // Remove trailing comma
        .replace(/,\s+/g, ' ') // Replace ", " with " "
        .replace(/\s+/g, ' '); // Collapse double spaces

    // Tricky ones identified in CSV
    const mappings = {
        'J.P. Schafer': 'J.P. Shafer',
        'J. P. Shafer': 'J.P. Shafer',
        'J. P Shafer': 'J.P. Shafer',
        'J. P. Schafer': 'J.P. Shafer',
        'Maxwell Maret': 'Max Maret',
        'Max': 'Max Maret',
        'Griffin': 'Griffin Garrison',
        'Tony Baker Jr': 'Tony Baker Jr.',
        'Tony Baker, Jr.': 'Tony Baker Jr.',
        'Tony Baker Jr': 'Tony Baker Jr.',
        'Tony Baker Jr.': 'Tony Baker Jr.',
        'Tony Baker Jr/ Melanie': 'Tony Baker Jr.', // Special case for weird split format
        'Melanie': 'Melanie',
        'melanie': 'Melanie'
    };

    if (mappings[normalized]) {
        return mappings[normalized];
    }
    
    // Check for "Tony Baker Jr." variations more broadly
    if (normalized.includes('Tony Baker') && (normalized.includes('Jr') || normalized.includes('Junior'))) {
        return 'Tony Baker Jr.';
    }

    return normalized;
}

/**
 * Validates if a string is likely a person name.
 */
function isValidPerson(name) {
    if (!name) return false;
    const lower = name.toLowerCase();
    const blacklist = [
        'find musician',
        'no melanie',
        'tentative',
        'tenative',
        '?',
        'unknown'
    ];
    return !blacklist.some(term => lower.includes(term));
}

/**
 * Parses a CSV line handling quotes and commas.
 */
function parseCSVLine(line) {
    const result = [];
    let startValueIndex = 0;
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        if (line[i] === '"') inQuotes = !inQuotes;
        if (!inQuotes && line[i] === ',') {
            result.push(line.substring(startValueIndex, i).replace(/^"|"$/g, '').trim());
            startValueIndex = i + 1;
        }
    }
    result.push(line.substring(startValueIndex).replace(/^"|"$/g, '').trim());
    return result;
}

/**
 * Formats M/D/YYYY to YYYY-MM-DD
 */
function formatDate(dateStr) {
    if (!dateStr) return null;
    const parts = dateStr.split('/');
    if (parts.length !== 3) return null;
    const [m, d, y] = parts;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

async function run() {
    console.log('Starting Master Schedule import...');

    const csvPath = path.join(__dirname, '..', CSV_FILE);
    const content = fs.readFileSync(csvPath, 'utf8');
    const lines = content.split(/\r?\n/);

    // Skip header (Row 1 is title, Row 2 is headers)
    const headerLine = lines[1];
    if (!headerLine || !headerLine.includes('Date')) {
        console.error('Unexpected CSV format. Could not find header line.');
        process.exit(1);
    }

    const dataRows = lines.slice(2);
    const prayerCounts = {}; // name -> count
    const peopleMap = new Map(); // name -> docId

    // 1. Pre-fetch existing people
    const peopleSnap = await db.collection('people').get();
    peopleSnap.forEach(doc => {
        peopleMap.set(doc.data().name, doc.id);
    });
    console.log(`Fetched ${peopleMap.size} existing people.`);

    // 2. Identify all people and ensure they exist
    const rolesToProcess = [
        { col: 1, type: 'preacher' },
        { col: 2, type: 'service_leader' },
        { col: 3, type: 'prayer' },
        { col: 4, type: 'worship_leader' },
        { col: 5, type: 'sermonette' }
    ];

    console.log('Processing people and involvements...');
    
    // We'll process rows and collect involvements to write in batches
    const involvementsToAdd = []; // Array of { personId, data }
    const peopleUpdates = {}; // personId -> { totalInvolvements }

    for (let i = 0; i < dataRows.length; i++) {
        const row = parseCSVLine(dataRows[i]);
        if (row.length < 2 || !row[0]) continue; // Skip empty rows

        const serviceDate = formatDate(row[0]);
        if (!serviceDate) continue;

        // Check if row is empty of roles
        const hasRoles = rolesToProcess.some(r => row[r.col]);
        if (!hasRoles) continue;

        for (const role of rolesToProcess) {
            const rawValue = row[role.col];
            if (!rawValue) continue;

            // Handle splits (e.g. "Max/Melanie")
            // Special exception for Prayer "Stephen Pursley/Ian Riley"
            let namesToProcess = [];
            let isPrayerException = (role.type === 'prayer' && rawValue.includes('/'));

            if (isPrayerException) {
                // User explicitly mentioned this case: 1st is Praise, 2nd is Confession
                namesToProcess = rawValue.split('/').map(n => n.trim());
            } else if (role.type === 'worship_leader' || role.type === 'service_leader' || role.type === 'preacher' || role.type === 'sermonette') {
                // Split by '/' for multiple people in other roles too
                namesToProcess = rawValue.split('/').map(n => n.trim());
            } else {
                namesToProcess = [rawValue];
            }

            for (let idx = 0; idx < namesToProcess.length; idx++) {
                let personName = normalizeName(namesToProcess[idx]);
                
                if (!isValidPerson(personName)) continue;

                // Ensure person exists
                let personId = peopleMap.get(personName);
                if (!personId) {
                    const personRef = await db.collection('people').add({
                        name: personName,
                        totalInvolvements: 0,
                        createdAt: admin.firestore.FieldValue.serverTimestamp()
                    });
                    personId = personRef.id;
                    peopleMap.set(personName, personId);
                    console.log(`Created new person: ${personName}`);
                }

                // Create involvement record
                const invData = {
                    serviceDate,
                    type: role.type,
                    createdAt: admin.firestore.FieldValue.serverTimestamp()
                };

                if (role.type === 'prayer') {
                    let pType = 'praise';
                    if (isPrayerException) {
                        pType = (idx === 0) ? 'praise' : 'confession';
                    } else {
                        const count = prayerCounts[personName] || 0;
                        if (count === 0) pType = 'praise';
                        else if (count === 1) pType = 'confession';
                        else pType = Math.random() > 0.5 ? 'praise' : 'confession';
                        
                        prayerCounts[personName] = count + 1;
                    }
                    invData.metadata = { prayer_type: pType };
                }

                involvementsToAdd.push({ personId, data: invData });
                
                // Track count for person update
                if (!peopleUpdates[personId]) peopleUpdates[personId] = 0;
                peopleUpdates[personId]++;
            }
        }
    }

    console.log(`Total involvements to add: ${involvementsToAdd.length}`);

    // 3. Batch write involvements and updates
    const BATCH_SIZE = 400;
    
    // First, update the totalInvolvements counts for all people
    const updateEntries = Object.entries(peopleUpdates);
    for (let i = 0; i < updateEntries.length; i += BATCH_SIZE) {
        const batch = db.batch();
        const chunk = updateEntries.slice(i, i + BATCH_SIZE);
        chunk.forEach(([personId, count]) => {
            batch.update(db.collection('people').doc(personId), {
                totalInvolvements: admin.firestore.FieldValue.increment(count)
            });
        });
        await batch.commit();
        console.log(`Committed count updates batch ${Math.floor(i/BATCH_SIZE)+1}`);
    }

    // Then, add the involvements
    for (let i = 0; i < involvementsToAdd.length; i += BATCH_SIZE) {
        const batch = db.batch();
        const chunk = involvementsToAdd.slice(i, i + BATCH_SIZE);
        
        chunk.forEach(item => {
            const invRef = db.collection('people').doc(item.personId).collection('involvement').doc();
            batch.set(invRef, item.data);
        });

        await batch.commit();
        console.log(`Committed involvement batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(involvementsToAdd.length / BATCH_SIZE)}`);
    }

    console.log('Import complete!');
    process.exit(0);
}

run().catch(err => {
    console.error('Import failed:', err);
    process.exit(1);
});
