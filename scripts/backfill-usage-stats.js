/**
 * @fileoverview Backfill: seed "last used / times used" for hymns, scripture
 * references, and people-in-serving-roles from history that already exists.
 *
 * The live counts (functions/index.js: updateOrderOfServiceUsageStats,
 * updateRoleUsageStats, updatePastoralPrayerUsageStats) only start
 * accumulating from the moment they're deployed. Everything scheduled
 * before that point needs to be counted once, here — using the SAME logic
 * the triggers use (UsageStatsCore.diffLiturgyUsage, UsageStatsCore.roleStatKey),
 * so the backfill and the live triggers can never compute a different answer
 * for the same data.
 *
 * Three independent passes, each a full recompute (not an increment) so a
 * second run is idempotent:
 *   1. hymns/{hymnId}.times_played / .last_played_date — from every
 *      services/{date} doc's liturgy.
 *   2. scripture_usage/{reference} — same pass, same docs.
 *   3. people/{personId}.roleStats / .pastoralPrayerStats — from every
 *      person's existing involvement and pastoral_prayer_history
 *      subcollections.
 *
 * Run:  node scripts/backfill-usage-stats.js [--dry-run]
 */

const admin = require('firebase-admin');
const UsageStatsCore = require('../public/usage-stats-core.js');

const FIREBASE_PROJECT_ID = 'mosaic-hymn-database';
const BATCH_SIZE = 400;

const DRY_RUN = process.argv.includes('--dry-run');

const { serviceAccount } = require('./service-account.js');

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount()),
    projectId: FIREBASE_PROJECT_ID,
});

const db = admin.firestore();

// Folds one usage delta into an in-memory {count, lastUsed} map, keyed by
// hymnId or by reference. "Last used" is the max date across every delta —
// correct here in a way the live trigger's max-vs-cached-value can only
// approximate, because this pass sees every service at once.
function fold(map, key, date) {
    const bucket = map[key] || (map[key] = { count: 0, lastUsed: null });
    bucket.count += 1;
    if (!bucket.lastUsed || date > bucket.lastUsed) bucket.lastUsed = date;
}

async function computeHymnAndScriptureUsage() {
    const snap = await db.collection('services').get();
    const hymnUsage = {};
    const scriptureUsage = {};

    snap.forEach(doc => {
        const { hymnDeltas, scriptureDeltas } =
            UsageStatsCore.diffLiturgyUsage(null, doc.data(), doc.id);
        hymnDeltas.forEach(d => fold(hymnUsage, d.hymnId, d.date));
        scriptureDeltas.forEach(d => fold(scriptureUsage, d.reference, d.date));
    });

    return { hymnUsage, scriptureUsage, serviceCount: snap.size };
}

async function computePeopleUsage() {
    const [involvementSnap, historySnap] = await Promise.all([
        db.collectionGroup('involvement').get(),
        db.collectionGroup('pastoral_prayer_history').get(),
    ]);

    // personId -> { roleKey -> {count, lastUsed} }
    const roleStatsByPerson = {};
    involvementSnap.forEach(doc => {
        const personId = doc.ref.parent.parent.id;
        const record = doc.data();
        const key = UsageStatsCore.roleStatKey(
            record.type, record.metadata && record.metadata.prayer_type);
        if (!key) return;
        const perPerson = roleStatsByPerson[personId] || (roleStatsByPerson[personId] = {});
        if (record.serviceDate) fold(perPerson, key, record.serviceDate);
    });

    // personId -> count. lastUsed is read from the person's existing
    // lastPastoralPrayerDate cache (pastoral-prayer-core.js already keeps
    // that correct) rather than recomputed here.
    const prayerCountByPerson = {};
    historySnap.forEach(doc => {
        const personId = doc.ref.parent.parent.id;
        prayerCountByPerson[personId] = (prayerCountByPerson[personId] || 0) + 1;
    });

    const personIds = new Set([
        ...Object.keys(roleStatsByPerson),
        ...Object.keys(prayerCountByPerson),
    ]);

    return { roleStatsByPerson, prayerCountByPerson, personIds };
}

async function writeInBatches(entries, applyToBatch) {
    let written = 0;
    for (let i = 0; i < entries.length; i += BATCH_SIZE) {
        const batch = db.batch();
        entries.slice(i, i + BATCH_SIZE).forEach(entry => applyToBatch(batch, entry));
        await batch.commit();
        written += Math.min(BATCH_SIZE, entries.length - i);
        console.log(`  ${written}/${entries.length}`);
    }
    return written;
}

async function run() {
    console.log('Computing hymn and scripture usage from services...' +
        (DRY_RUN ? ' (dry run)' : ''));
    const { hymnUsage, scriptureUsage, serviceCount } = await computeHymnAndScriptureUsage();
    console.log(`  ${serviceCount} services scanned, ` +
        `${Object.keys(hymnUsage).length} hymns, ` +
        `${Object.keys(scriptureUsage).length} scripture references.`);

    console.log('Computing people usage from involvement and pastoral prayer history...');
    const { roleStatsByPerson, prayerCountByPerson, personIds } = await computePeopleUsage();
    console.log(`  ${personIds.size} people carry serving or pastoral-prayer history.`);

    if (DRY_RUN) {
        console.log('Dry run: no writes made.');
        return;
    }

    console.log('Writing hymn usage...');
    await writeInBatches(Object.entries(hymnUsage), (batch, [hymnId, stat]) => {
        batch.set(db.collection('hymns').doc(hymnId), {
            times_played: stat.count,
            last_played_date: stat.lastUsed,
        }, { merge: true });
    });

    console.log('Writing scripture usage...');
    await writeInBatches(Object.entries(scriptureUsage), (batch, [reference, stat]) => {
        batch.set(db.collection('scripture_usage').doc(reference), {
            reference,
            count: stat.count,
            lastUsed: stat.lastUsed,
        }, { merge: true });
    });

    console.log('Writing people usage...');
    const personRefs = Array.from(personIds).map(id => db.collection('people').doc(id));
    const personDocs = await Promise.all(personRefs.map(ref => ref.get()));
    // A person can be deleted while their involvement/pastoral_prayer_history
    // subcollection records survive underneath them (subcollections don't
    // cascade-delete) — update() on a doc that no longer exists fails the
    // whole batch it's in, atomically, so this has to filter them out rather
    // than let one deleted person sink everyone batched alongside them.
    const missing = personDocs.filter(snap => !snap.exists);
    if (missing.length) {
        console.log(`  skipping ${missing.length} deleted people with orphaned history: ` +
            missing.map(s => s.id).join(', '));
    }
    const entries = personDocs.filter(snap => snap.exists).map(snap => ({
        id: snap.id,
        lastPastoralPrayerDate: snap.data().lastPastoralPrayerDate || null,
    }));
    await writeInBatches(entries, (batch, entry) => {
        const prayerCount = prayerCountByPerson[entry.id] || 0;
        batch.update(db.collection('people').doc(entry.id), {
            roleStats: roleStatsByPerson[entry.id] || {},
            pastoralPrayerStats: { count: prayerCount, lastUsed: entry.lastPastoralPrayerDate },
        });
    });

    console.log('Backfill complete.');
}

run()
    .then(() => process.exit(0))
    .catch(err => {
        console.error(err);
        process.exit(1);
    });
