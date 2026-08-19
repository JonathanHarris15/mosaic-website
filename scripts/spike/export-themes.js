/**
 * @fileoverview SPIKE (throwaway): dump distinct Service Themes out of Firestore
 * so the similarity spike has real data to chew on.
 *
 * Usage:
 *   node scripts/spike/export-themes.js --key=path/to/adminsdk.json
 *   node scripts/spike/export-themes.js            (uses GOOGLE_APPLICATION_CREDENTIALS)
 *
 * Writes scripts/spike/themes.json:
 *   [{ text, key, dates: ['2024-04-14', ...] }]
 *
 * If you'd rather not hand a service-account key to a script, see
 * export-themes-browser.md for a console snippet that does the same thing.
 */

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const FIREBASE_PROJECT_ID = 'mosaic-hymn-database';
const OUT = path.join(__dirname, 'themes.json');

const keyArg = process.argv.find((a) => a.startsWith('--key='));
const keyPath = keyArg ? keyArg.slice('--key='.length) : process.env.GOOGLE_APPLICATION_CREDENTIALS;

if (!keyPath) {
    console.error('No credentials. Pass --key=path/to/adminsdk.json or set GOOGLE_APPLICATION_CREDENTIALS.');
    process.exit(1);
}

admin.initializeApp({
    credential: admin.credential.cert(require(path.resolve(keyPath))),
    projectId: FIREBASE_PROJECT_ID,
});

/** Light normalization: whitespace, smart quotes, trailing punctuation. */
function normalize(raw) {
    return String(raw)
        .replace(/[\u2018\u2019]/g, "'")
        .replace(/[\u201C\u201D]/g, '"')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/[.,;:]+$/, '');
}

async function main() {
    const snap = await admin.firestore().collection('services').get();
    const byKey = new Map();

    snap.forEach((doc) => {
        const text = normalize(doc.data().theme || '');
        if (!text) return;
        const key = text.toLowerCase();
        if (!byKey.has(key)) byKey.set(key, { text, key, dates: [] });
        byKey.get(key).dates.push(doc.id); // doc id is the YYYY-MM-DD service date
    });

    const themes = [...byKey.values()].sort((a, b) => a.text.localeCompare(b.text));
    themes.forEach((t) => t.dates.sort());

    fs.writeFileSync(OUT, JSON.stringify(themes, null, 2));

    const used = themes.reduce((n, t) => n + t.dates.length, 0);
    console.log(`${snap.size} services scanned`);
    console.log(`${used} of them have a theme`);
    console.log(`${themes.length} distinct themes -> ${path.relative(process.cwd(), OUT)}`);
    const repeats = themes.filter((t) => t.dates.length > 1);
    if (repeats.length) {
        console.log(`\n${repeats.length} themes reused verbatim (exact-duplicate detection is free):`);
        repeats.slice(0, 15).forEach((t) => console.log(`  ${t.dates.length}x  ${t.text}`));
    }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
