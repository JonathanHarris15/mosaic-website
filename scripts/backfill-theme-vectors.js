/**
 * @fileoverview Backfill: populate the `themes` collection (docs/plans/
 * theme-similarity.md) from every existing services/*.theme, so the corpus
 * onServiceThemeWritten (functions/index.js) maintains going forward starts
 * with the church's actual preaching history instead of empty.
 *
 * Each DISTINCT theme (by ThemeSimilarityCore.themeKey — same normalization
 * as the live trigger, so this can never disagree with it) is embedded
 * exactly once. A second run only tops up `usedOn` for themes already
 * embedded with the current model/dims — it does not re-embed them, because
 * embedding costs money and the vector for the same text does not change.
 *
 * Needs GEMINI_API_KEY in the environment (the Cloud Function reads the same
 * key from a Firebase secret; this script, run by hand, reads it from env —
 * see scripts/spike/analyze-themes.js for the same convention).
 *
 * Run:  node scripts/backfill-theme-vectors.js [--dry-run]
 */

const admin = require('firebase-admin');
const ThemeSimilarityCore = require('../public/theme-similarity-core.js');

const FIREBASE_PROJECT_ID = 'mosaic-hymn-database';
// Small, unlike the other backfill scripts' 400 — each doc here carries a
// 768-float embedding vector (~6-8KB), and 400 of those in one batch blows
// past Firestore's 10MB write-batch limit ("Transaction too big").
const BATCH_SIZE = 50;
const EMBED_WINDOW = 5; // small concurrency window, same as the spike

// Must match functions/index.js's THEME_EMBEDDING_MODEL/DIMS exactly — a
// vector embedded here under a different model/size would silently break
// comparability with everything scoreTheme reads later.
const MODEL = 'gemini-embedding-001';
const DIMS = 768;

const DRY_RUN = process.argv.includes('--dry-run');
const API_KEY = process.env.GEMINI_API_KEY;

const { serviceAccount } = require('./service-account.js');

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount()),
    projectId: FIREBASE_PROJECT_ID,
});

const db = admin.firestore();

async function embedOne(text) {
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/' +
        MODEL + ':embedContent?key=' + API_KEY;
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: 'models/' + MODEL,
            content: { parts: [{ text }] },
            taskType: 'SEMANTIC_SIMILARITY',
            outputDimensionality: DIMS,
        }),
    });
    if (!res.ok) throw new Error(res.status + ' ' + (await res.text()));
    return (await res.json()).embedding.values;
}

async function embedWithRetry(text) {
    for (let attempt = 0; attempt < 4; attempt++) {
        try {
            return await embedOne(text);
        } catch (e) {
            if (attempt === 3) throw e;
            await new Promise(r => setTimeout(r, 500 * Math.pow(2, attempt)));
        }
    }
}

// Every distinct theme across every service, keyed the same way the live
// trigger keys `themes/{key}` — so this backfill and that trigger can never
// disagree about what "the same theme" means.
async function distinctThemes() {
    const snap = await db.collection('services').get();
    const byKey = new Map();

    snap.forEach(doc => {
        const key = ThemeSimilarityCore.themeKey(doc.data().theme);
        if (!key) return;
        if (!byKey.has(key)) {
            byKey.set(key, {
                key,
                text: ThemeSimilarityCore.normalizeThemeText(doc.data().theme),
                dates: [],
            });
        }
        byKey.get(key).dates.push(doc.id); // doc id is the YYYY-MM-DD service date
    });

    byKey.forEach(t => t.dates.sort());
    return { themes: [...byKey.values()], serviceCount: snap.size };
}

async function run() {
    if (!API_KEY && !DRY_RUN) {
        console.error('GEMINI_API_KEY is not set. (A dry run does not need it.)');
        process.exit(1);
    }

    console.log('Finding distinct Service Themes...' + (DRY_RUN ? ' (dry run)' : ''));
    const { themes, serviceCount } = await distinctThemes();
    console.log(`  ${serviceCount} services scanned, ${themes.length} distinct themes.`);

    const existingSnap = await db.collection('themes').get();
    const existing = new Map();
    existingSnap.forEach(doc => existing.set(doc.id, doc.data()));

    const needsEmbedding = themes.filter(t => {
        const have = existing.get(t.key);
        return !have || have.model !== MODEL || have.dims !== DIMS;
    });
    const needsUsedOnOnly = themes.filter(t => !needsEmbedding.includes(t));

    console.log(`  ${needsEmbedding.length} need embedding` +
        ` (new, or embedded under a different model/size).`);
    console.log(`  ${needsUsedOnOnly.length} already embedded — usedOn will be topped up only.`);

    if (DRY_RUN) {
        console.log('\nDry run: no writes made. Sample of what would be embedded:');
        needsEmbedding.slice(0, 10).forEach(t => console.log(`  ${t.dates.length}x  ${t.text}`));
        return;
    }

    console.log('\nEmbedding new themes...');
    let embedded = 0;
    for (let i = 0; i < needsEmbedding.length; i += EMBED_WINDOW) {
        const window = needsEmbedding.slice(i, i + EMBED_WINDOW);
        const vectors = await Promise.all(window.map(t => embedWithRetry(t.text)));
        window.forEach((t, n) => { t.vector = vectors[n]; });
        embedded += window.length;
        console.log(`  ${embedded}/${needsEmbedding.length}`);
    }

    console.log('\nWriting themes...');
    let written = 0;
    for (let i = 0; i < themes.length; i += BATCH_SIZE) {
        const batch = db.batch();
        themes.slice(i, i + BATCH_SIZE).forEach(t => {
            const ref = db.collection('themes').doc(t.key);
            if (t.vector) {
                batch.set(ref, {
                    text: t.text,
                    vector: t.vector,
                    model: MODEL,
                    dims: DIMS,
                    usedOn: t.dates,
                    embeddedAt: admin.firestore.FieldValue.serverTimestamp(),
                });
            } else {
                batch.set(ref, { usedOn: t.dates }, { merge: true });
            }
        });
        await batch.commit();
        written += Math.min(BATCH_SIZE, themes.length - i);
        console.log(`  ${written}/${themes.length}`);
    }

    console.log(`\nBackfill complete — ${embedded} embedded, ${themes.length} themes written.`);
}

run()
    .then(() => process.exit(0))
    .catch(err => {
        console.error(err);
        process.exit(1);
    });
