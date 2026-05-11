/**
 * @fileoverview CLI script to reconcile people and hymns in imported services.
 * Links name strings to document IDs and creates involvement records.
 */

const admin = require('firebase-admin');
const readline = require('readline');
const fs = require('fs');

// Initialize Firebase Admin
const SERVICE_ACCOUNT_FILE = 'mosaic-hymn-database-firebase-adminsdk-fbsvc-8d55863f5a.json';
let serviceAccountPath = '';

if (fs.existsSync(`./${SERVICE_ACCOUNT_FILE}`)) {
    serviceAccountPath = `./${SERVICE_ACCOUNT_FILE}`;
} else if (fs.existsSync(`../${SERVICE_ACCOUNT_FILE}`)) {
    serviceAccountPath = `../${SERVICE_ACCOUNT_FILE}`;
} else {
    console.error(`Error: ${SERVICE_ACCOUNT_FILE} not found in the root or parent directory.`);
    process.exit(1);
}

const serviceAccount = require(serviceAccountPath.startsWith('.') ? `../${SERVICE_ACCOUNT_FILE}` : serviceAccountPath);

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const question = (query) => new Promise((resolve) => rl.question(query, resolve));

// Simple Levenshtein distance for fuzzy matching
function levenshtein(a, b) {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;
    const matrix = [];
    for (let i = 0; i <= b.length; i++) matrix[i] = [i];
    for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1);
            }
        }
    }
    return matrix[b.length][a.length];
}

function fuzzyMatch(str, list, key, threshold = 1.0) {
    if (!str) return [];
    const matches = list.map(item => {
        const itemStr = key ? item[key] : item;
        const dist = levenshtein(str.toLowerCase(), itemStr.toLowerCase());
        const score = dist / Math.max(str.length, itemStr.length);
        return { item, score };
    }).sort((a, b) => a.score - b.score);
    
    // We keep them all sorted, but we can still use a threshold for filtering if we wanted.
    // However, since we want to see the "closest regardless", we'll return the full sorted list.
    return matches.filter(m => m.score <= threshold);
}

const BIBLE_BOOKS = [
    "Genesis", "Exodus", "Leviticus", "Numbers", "Deuteronomy", "Joshua", "Judges", "Ruth", "1 Samuel", "2 Samuel",
    "1 Kings", "2 Kings", "1 Chronicles", "2 Chronicles", "Ezra", "Nehemiah", "Esther", "Job", "Psalms", "Proverbs",
    "Ecclesiastes", "Song of Solomon", "Isaiah", "Jeremiah", "Lamentations", "Ezekiel", "Daniel", "Hosea", "Joel",
    "Amos", "Obadiah", "Jonah", "Micah", "Nahum", "Habakkuk", "Zephaniah", "Haggai", "Zechariah", "Malachi",
    "Matthew", "Mark", "Luke", "John", "Acts", "Romans", "1 Corinthians", "2 Corinthians", "Galatians", "Ephesians",
    "Philippians", "Colossians", "1 Thessalonians", "2 Thessalonians", "1 Timothy", "2 Timothy", "Titus", "Philemon",
    "Hebrews", "James", "1 Peter", "2 Peter", "1 John", "2 John", "3 John", "Jude", "Revelation"
];

async function run() {
    console.log('\x1Bc');
    console.log('====================================================');
    console.log('      Mosaic Hymn Reconciliation Tool               ');
    console.log('====================================================\n');

    // 1. Fetch reference data
    process.stdout.write('Fetching reference data... ');
    const hymnsSnap = await db.collection('hymns').get();
    const hymns = hymnsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    const servicesSnap = await db.collection('services').get();
    const services = servicesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    console.log('Done.');
    console.log(`Found ${hymns.length} hymns and ${services.length} services.`);
    await question('\nPress Enter to start hymn reconciliation...');

    const manualMemory = []; // Array of { seenName, hymn }

    for (const service of services) {
        const updates = {};

        // --- Hymn Reconciliation ---
        if (service.liturgy) {
            const hymnFields = [
                { key: 'hymn1', label: 'Hymn 1' },
                { key: 'hymn2', label: 'Hymn 2' },
                { key: 'hymnMid1', label: 'Hymn Mid 1' },
                { key: 'hymnMid2', label: 'Hymn Mid 2' },
                { key: 'hymnEnd1', label: 'Hymn End 1' },
                { key: 'hymnEnd2', label: 'Hymn End 2' },
                { key: 'preparatoryHymn', label: 'Preparatory Hymn' }
            ];

            let hasPendingHymns = false;
            for (const { key } of hymnFields) {
                const hymnData = service.liturgy[key];
                if (hymnData && hymnData.name && !hymnData.id) {
                    hasPendingHymns = true;
                    break;
                }
            }

            if (hasPendingHymns) {
                console.log('\x1Bc');
                console.log('====================================================');
                console.log(` SERVICE: ${service.id}`);
                console.log(` THEME:   ${service.theme || 'No Theme'}`);
                console.log('====================================================\n');

                for (const { key, label } of hymnFields) {
                    const hymnData = service.liturgy[key];
                    if (!hymnData || !hymnData.name) continue;
                    
                    if (hymnData.id) {
                        console.log(`  [OK] ${label}: ${hymnData.name} (linked)`);
                        continue;
                    }

                    const name = hymnData.name;
                    let matchedHymn = null;

                    // 1. Check session memory first (manual links)
                    const memoryMatches = fuzzyMatch(name, manualMemory, 'seenName');
                    if (memoryMatches.length > 0 && memoryMatches[0].score < 0.1) {
                        matchedHymn = memoryMatches[0].item.hymn;
                        updates[`liturgy.${key}.id`] = matchedHymn.id;
                        updates[`liturgy.${key}.name`] = matchedHymn.hymn_name;
                        console.log(`  [OK] ${label}: ${name} -> Auto-linked via memory to ${matchedHymn.hymn_name}`);
                        continue;
                    }

                    // 2. Check database for exact/close matches
                    const matches = fuzzyMatch(name, hymns, 'hymn_name');
                    
                    if (matches.length > 0 && matches[0].score < 0.1) {
                        matchedHymn = matches[0].item;
                        updates[`liturgy.${key}.id`] = matchedHymn.id;
                        updates[`liturgy.${key}.name`] = matchedHymn.hymn_name;
                        console.log(`  [OK] ${label}: ${name} -> Auto-linked to ${matchedHymn.hymn_name}`);
                    } else {
                        console.log(`\n  [?] ${label}: "${name}"`);
                        if (matches.length > 0) {
                            console.log(`      Suggestions:`);
                            matches.slice(0, 3).forEach((m, idx) => console.log(`      ${idx + 1}. ${m.item.hymn_name} (${m.score.toFixed(2)})`));
                        }
                        const ans = await question(`      Action for hymn "${name}"? (1-3 to link, [A]dd new, [S]kip): `);

                        if (ans.toLowerCase() === 'a') {
                            const newHymnRef = await db.collection('hymns').add({
                                hymn_name: name,
                                versions: [],
                                createdAt: admin.firestore.FieldValue.serverTimestamp()
                            });
                            matchedHymn = { id: newHymnRef.id, hymn_name: name };
                            hymns.push(matchedHymn);
                            console.log(`      Added new hymn: ${name}`);
                        } else if (parseInt(ans) > 0 && parseInt(ans) <= matches.length) {
                            matchedHymn = matches[parseInt(ans) - 1].item;
                        }

                        if (matchedHymn) {
                            updates[`liturgy.${key}.id`] = matchedHymn.id;
                            updates[`liturgy.${key}.name`] = matchedHymn.hymn_name;
                            
                            // Remember this manual link for the rest of the session
                            manualMemory.push({ seenName: name, hymn: matchedHymn });
                        }
                    }
                }

                if (Object.keys(updates).length > 0) {
                    await db.collection('services').doc(service.id).update(updates);
                    console.log(`\n[SUCCESS] Updated service ${service.id}`);
                    await question('\nPress Enter for next service...');
                }
            }
        }
    }

    console.log('\n\x1Bc');
    console.log('====================================================');
    console.log('      Hymn Reconciliation Complete!                 ');
    console.log('====================================================\n');
    process.exit(0);
}

run().catch(err => {
    console.error(err);
    process.exit(1);
});
