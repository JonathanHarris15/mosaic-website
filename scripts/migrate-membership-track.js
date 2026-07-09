/**
 * @fileoverview MS-83 — Membership Track migration (ADR-0012).
 *
 * One-shot, idempotent migration that moves every Person off the three old,
 * conflicting membership signals onto the single Membership Track:
 *
 *   1. Maps the legacy `membership.status` (visitor / regular_attender / member /
 *      inactive) onto the new { stage, inactive } shape via the same pure
 *      mapping the app uses (ShepherdingCore.membershipFromLegacyStatus).
 *   2. Re-projects each Person's `tags` so they carry exactly the Membership Tags
 *      their stage implies (applyMembershipTags). Moving Membership carries both
 *      its own tag and 'Member'; Inactive carries 'Inactive'.
 *   3. Seeds a `people_tags` document for every code-defined Membership Tag so the
 *      tag vocabulary shows them. The legacy 'Member' tag doc is left in place —
 *      its id already IS 'Member', so the Track absorbs it with no rewrite.
 *
 * The legacy `membership.status` field is intentionally left untouched for
 * back-compat with screens not yet migrated (MS-85 removes those readers). No
 * Pastoral Record entries are written — a migration is silent by design.
 *
 * Idempotent: re-running maps the same status again and applyMembershipTags first
 * strips all Membership Tags before re-adding, so tags never accumulate.
 *
 * Usage:
 *   node scripts/migrate-membership-track.js            # dry run (default) — reports only
 *   node scripts/migrate-membership-track.js --commit   # apply the changes
 */

const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

const Core = require('../public/shepherding-core.js');

const FIREBASE_PROJECT_ID = 'mosaic-hymn-database';
const COMMIT = process.argv.includes('--commit');

// Find whichever Firebase Admin SDK service-account key is present in the repo
// root (the exact filename hash differs between machines).
function resolveServiceAccount() {
    const root = path.join(__dirname, '..');
    const match = fs.readdirSync(root).find(
        f => f.startsWith('mosaic-hymn-database-firebase-adminsdk') && f.endsWith('.json')
    );
    if (!match) {
        throw new Error('No mosaic-hymn-database-firebase-adminsdk-*.json found in project root.');
    }
    return require(path.join(root, match));
}

admin.initializeApp({
    credential: admin.credential.cert(resolveServiceAccount()),
    projectId: FIREBASE_PROJECT_ID,
});

const db = admin.firestore();

// Shallow-equal two string arrays regardless of order — so we only write when a
// Person's tag set actually changes.
function sameTagSet(a, b) {
    if (a.length !== b.length) return false;
    const sa = [...a].sort();
    const sb = [...b].sort();
    return sa.every((v, i) => v === sb[i]);
}

async function seedMembershipTagDocs() {
    const col = db.collection('people_tags');
    const existing = new Set((await col.get()).docs.map(d => d.id));
    let created = 0;
    for (const tagId of Core.MEMBERSHIP_TAG_IDS) {
        if (existing.has(tagId)) continue;
        if (COMMIT) {
            await col.doc(tagId).set({ name: tagId, hiddenFromOthers: false, hidePeople: false }, { merge: true });
        }
        created++;
        console.log(`  ${COMMIT ? 'seeded' : 'would seed'} Membership Tag doc: "${tagId}"`);
    }
    if (!created) console.log('  all Membership Tag docs already present');
    return created;
}

async function migratePeople() {
    const snap = await db.collection('people').get();
    let changed = 0;
    let unchanged = 0;
    for (const doc of snap.docs) {
        const data = doc.data();
        const legacyStatus = data.membership && data.membership.status;
        const membership = Core.membershipFromLegacyStatus(legacyStatus);
        const currentTags = data.tags || [];
        const nextTags = Core.applyMembershipTags(currentTags, membership);

        const membershipChanged =
            !data.membership ||
            data.membership.stage !== membership.stage ||
            !!data.membership.inactive !== membership.inactive;
        const tagsChanged = !sameTagSet(currentTags, nextTags);

        if (!membershipChanged && !tagsChanged) {
            unchanged++;
            continue;
        }
        changed++;
        const stageLabel = membership.inactive
            ? 'Inactive'
            : (membership.stage ? Core.MEMBERSHIP_STAGE_LABEL[membership.stage] : '(unset)');
        console.log(`  ${COMMIT ? 'update' : 'would update'} ${data.name || doc.id}: status="${legacyStatus || ''}" → ${stageLabel}; tags [${currentTags.join(', ')}] → [${nextTags.join(', ')}]`);

        if (COMMIT) {
            // Merge stage/inactive into the existing membership object so joinedAt
            // and the back-compat status field survive.
            await doc.ref.update({
                'membership.stage': membership.stage,
                'membership.inactive': membership.inactive,
                tags: nextTags,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
        }
    }
    return { changed, unchanged };
}

(async () => {
    console.log(`\nMembership Track migration (ADR-0012) — ${COMMIT ? 'COMMIT' : 'DRY RUN (use --commit to apply)'}\n`);
    console.log('Seeding Membership Tag docs:');
    const seeded = await seedMembershipTagDocs();
    console.log('\nMigrating people:');
    const { changed, unchanged } = await migratePeople();
    console.log(`\nDone. Tag docs ${COMMIT ? 'seeded' : 'to seed'}: ${seeded}. People ${COMMIT ? 'updated' : 'to update'}: ${changed}, unchanged: ${unchanged}.`);
    if (!COMMIT) console.log('No changes were written. Re-run with --commit to apply.\n');
    process.exit(0);
})().catch(err => {
    console.error('Migration failed:', err);
    process.exit(1);
});
