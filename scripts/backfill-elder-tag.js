/**
 * @fileoverview MS-92 — Elder Tag backfill (ADR-0013).
 *
 * One-shot, idempotent backfill that brings existing data in line with the Elder
 * Tag projection. The `syncElderRoleToTag` Cloud Function keeps the tag in sync
 * from here on, but it only fires on FUTURE `users/{uid}` writes — so Persons
 * already linked to an elder-role User won't carry the projected "Elder" tag
 * until their user doc is next touched. This reconciles every Person once.
 *
 * For each Person it computes the correct elder-ness from their Linked User
 * (people.userId → users.role === 'elder'; super_admin is NOT an elder) and
 * re-projects the Elder Tag with the same pure helper the app uses
 * (ShepherdingCore.applyElderTag). It also seeds the `people_tags/Elder` doc so
 * the tag shows in the Tags Manager. Idempotent: applyElderTag strips-then-
 * re-adds, so tags never accumulate and a second run is a no-op.
 *
 * No Pastoral Record entries are written (the Elder Tag is a silent projection,
 * exactly like the Membership Tags).
 *
 * Usage:
 *   node scripts/backfill-elder-tag.js            # dry run (default)
 *   node scripts/backfill-elder-tag.js --commit   # apply
 */

const Core = require('../public/shepherding-core.js');

if (require.main === module) {
    const admin = require('firebase-admin');
    const path = require('path');
    const fs = require('fs');

    const FIREBASE_PROJECT_ID = 'mosaic-hymn-database';
    const COMMIT = process.argv.includes('--commit');

    function resolveServiceAccount() {
        const root = path.join(__dirname, '..');
        const match = fs.readdirSync(root).find(
            f => f.startsWith('mosaic-hymn-database-firebase-adminsdk') && f.endsWith('.json')
        );
        if (!match) throw new Error('No mosaic-hymn-database-firebase-adminsdk-*.json found in project root.');
        return require(path.join(root, match));
    }

    admin.initializeApp({ credential: admin.credential.cert(resolveServiceAccount()), projectId: FIREBASE_PROJECT_ID });
    const db = admin.firestore();

    function sameTagSet(a, b) {
        if (a.length !== b.length) return false;
        const sa = [...a].sort(), sb = [...b].sort();
        return sa.every((v, i) => v === sb[i]);
    }

    async function seedElderTagDoc() {
        const ref = db.collection('people_tags').doc(Core.ELDER_TAG_ID);
        if ((await ref.get()).exists) { console.log('  people_tags/Elder already present'); return 0; }
        if (COMMIT) await ref.set({ name: Core.ELDER_TAG_ID, hiddenFromOthers: false, hidePeople: false }, { merge: true });
        console.log(`  ${COMMIT ? 'seeded' : 'would seed'} Elder Tag doc: "${Core.ELDER_TAG_ID}"`);
        return 1;
    }

    async function backfillPeople() {
        // Build a uid → role map once, so we don't read users per Person.
        const usersSnap = await db.collection('users').get();
        const roleByUid = {};
        usersSnap.docs.forEach(d => { roleByUid[d.id] = (d.data() || {}).role; });

        const snap = await db.collection('people').get();
        let changed = 0, unchanged = 0;
        for (const doc of snap.docs) {
            const data = doc.data();
            const isElder = !!data.userId && Core.isElderUser({ role: roleByUid[data.userId] });
            const currentTags = data.tags || [];
            const nextTags = Core.applyElderTag(currentTags, isElder);
            if (sameTagSet(currentTags, nextTags)) { unchanged++; continue; }

            changed++;
            const verb = isElder ? 'tag Elder' : 'untag Elder';
            console.log(`  ${COMMIT ? 'update' : 'would update'} ${data.name || doc.id}: ${verb}; [${currentTags.join(', ')}] → [${nextTags.join(', ')}]`);
            if (COMMIT) {
                await doc.ref.update({ tags: nextTags, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
            }
        }
        return { changed, unchanged };
    }

    (async () => {
        console.log(`\nElder Tag backfill (ADR-0013) — ${COMMIT ? 'COMMIT' : 'DRY RUN (use --commit to apply)'}\n`);
        console.log('Seeding Elder Tag doc:');
        const seeded = await seedElderTagDoc();
        console.log('\nReconciling people (elder-ness from the Linked User role):');
        const { changed, unchanged } = await backfillPeople();
        console.log(`\nDone. Tag doc ${COMMIT ? 'seeded' : 'to seed'}: ${seeded}. People ${COMMIT ? 'updated' : 'to update'}: ${changed}, unchanged: ${unchanged}.`);
        if (!COMMIT) console.log('No changes were written. Re-run with --commit to apply.\n');
        process.exit(0);
    })().catch(err => { console.error('Backfill failed:', err); process.exit(1); });
}
