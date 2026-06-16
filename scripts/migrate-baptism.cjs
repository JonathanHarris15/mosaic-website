#!/usr/bin/env node
/**
 * One-off migration: convert legacy free-text `liturgy.baptism` values on
 * Services into Baptism Candidate Person references, and stamp each baptized
 * Person's `baptismDate` with that Service's date.
 *
 * Behaviour (decided during grilling):
 *   - Split each value on commas, ampersands, and the word "and".
 *   - A confident "First Last" name is resolved against People:
 *       exactly one case-insensitive match  -> link to that Person
 *       no match                            -> create a new Person
 *       more than one match (ambiguous)     -> FLAG for manual review
 *   - A value with a lone first name / digits / junk is FLAGGED, never guessed.
 *   - Flagged services are listed but NOT modified — resolve them by hand.
 *
 * Usage:
 *   node scripts/migrate-baptism.cjs            # dry run: prints the plan + review list
 *   node scripts/migrate-baptism.cjs --commit   # apply the plan
 *
 * Auth: uses Application Default Credentials. Run `gcloud auth application-default login`
 * (or set GOOGLE_APPLICATION_CREDENTIALS to a service-account key) first.
 */
const path = require('path');
const admin = require('firebase-admin');
const { parseBaptismNames } = require(path.join(__dirname, '..', 'public', 'service-builder.js'));

const COMMIT = process.argv.includes('--commit');
const PROJECT_ID = process.env.GCLOUD_PROJECT || 'mosaic-hymn-database';

admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();

const normalize = (name) => (name || '').trim().toLowerCase().replace(/\s+/g, ' ');

async function main() {
    console.log(`\nBaptism migration — project ${PROJECT_ID} — ${COMMIT ? 'COMMIT' : 'DRY RUN'}\n`);

    // Index existing People by normalized name.
    const peopleByName = new Map();
    const peopleSnap = await db.collection('people').get();
    peopleSnap.forEach((d) => {
        const nm = normalize(d.data().name);
        if (!nm) return;
        if (!peopleByName.has(nm)) peopleByName.set(nm, []);
        peopleByName.get(nm).push({ id: d.id, name: d.data().name });
    });

    const plan = [];     // services we can apply confidently
    const review = [];    // services needing a human decision

    const servicesSnap = await db.collection('services').get();
    for (const doc of servicesSnap.docs) {
        const date = doc.id;
        const bap = doc.data().liturgy && doc.data().liturgy.baptism;
        if (typeof bap !== 'string') continue;            // already migrated (array) or absent
        const parsed = parseBaptismNames(bap);
        if (!parsed.candidates.length && !parsed.needsReview) continue;  // empty/placeholder
        if (parsed.needsReview) {
            review.push({ date, value: bap, reason: parsed.reason });
            continue;
        }
        const refs = [];
        let ambiguous = false;
        for (const name of parsed.candidates) {
            const matches = peopleByName.get(normalize(name)) || [];
            if (matches.length === 1) refs.push({ name: matches[0].name, id: matches[0].id, action: 'link' });
            else if (matches.length === 0) refs.push({ name, id: null, action: 'create' });
            else { ambiguous = true; review.push({ date, value: bap, reason: `"${name}" matches ${matches.length} existing people` }); }
        }
        if (!ambiguous) plan.push({ date, value: bap, refs });
    }

    console.log(`Services to migrate: ${plan.length}`);
    for (const item of plan) {
        const summary = item.refs.map(r => `${r.name} [${r.action}]`).join(', ');
        console.log(`  ${item.date}: "${item.value}"  ->  ${summary}`);
    }

    console.log(`\nServices needing manual review: ${review.length}`);
    for (const item of review) {
        console.log(`  ${item.date}: "${item.value}"  (${item.reason})`);
    }

    if (!COMMIT) {
        console.log('\nDry run only — re-run with --commit to apply the plan above.\n');
        return;
    }

    let created = 0, linked = 0, services = 0;
    for (const item of plan) {
        const batch = db.batch();
        const finalRefs = [];
        for (const r of item.refs) {
            let id = r.id;
            if (r.action === 'create') {
                const ref = db.collection('people').doc();
                batch.set(ref, {
                    name: r.name,
                    totalInvolvements: 0,
                    baptismDate: item.date,
                    createdAt: admin.firestore.FieldValue.serverTimestamp()
                });
                id = ref.id;
                created++;
            } else {
                batch.update(db.collection('people').doc(id), { baptismDate: item.date });
                linked++;
            }
            finalRefs.push({ name: r.name, id });
        }
        batch.update(db.collection('services').doc(item.date), { 'liturgy.baptism': finalRefs });
        await batch.commit();
        services++;
    }
    console.log(`\nDone. Migrated ${services} services; linked ${linked}, created ${created} people.`);
    console.log(`${review.length} services still need manual review.\n`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
