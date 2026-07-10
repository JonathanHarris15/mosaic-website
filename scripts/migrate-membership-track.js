/**
 * @fileoverview MS-83 — Membership Track migration (ADR-0012).
 *
 * One-shot, idempotent migration that moves every Person onto the single
 * Membership Track. Critically, in the real data membership is encoded in the
 * **existing tags** (`Member`, `Regular Attender`, `Visitor`, `Moving
 * Membership`, `Previous Member`) — the ad-hoc tag system the overhaul replaces —
 * NOT in `membership.status`, which is empty for almost everyone. So the stage is
 * derived tags-first, with the legacy `status` field only as a fallback when no
 * membership tag is present.
 *
 *   1. Derives { stage, inactive } from each Person (deriveMembership): a
 *      membership tag wins (most-advanced first: Moving Membership → Member →
 *      Previous Member → Prospective Member → Regular Attender → Visitor); else
 *      the legacy status maps across; Inactive comes from membership.inactive,
 *      the legacy 'inactive' status, or an Inactive tag.
 *   2. Re-projects the Membership Tags (applyMembershipTags) so Moving Membership
 *      carries both its own tag and Member, etc., preserving all non-membership
 *      tags.
 *   3. Seeds a `people_tags` doc for every code-defined Membership Tag.
 *   4. Reports any Person whose explicit legacy status DISAGREES with the
 *      tag-derived stage (e.g. status 'previous_member' but a Member tag) so a
 *      human can resolve those few by hand — the migration keeps the tag-derived
 *      stage and never guesses silently.
 *
 * The legacy `membership.status` field is left untouched for back-compat. No
 * Pastoral Record entries are written. Idempotent: re-running derives the same
 * stage and applyMembershipTags strips-then-re-adds, so tags never accumulate.
 *
 * The pure derivation is exported for unit tests; the Firestore side only runs
 * when the script is executed directly.
 *
 * Usage:
 *   node scripts/migrate-membership-track.js            # dry run (default)
 *   node scripts/migrate-membership-track.js --commit   # apply
 */

const Core = require('../public/shepherding-core.js');

// Tag → stage precedence (most-advanced first). Moving Membership must be tested
// before Member because such People carry BOTH tags.
const TAG_STAGE_PRECEDENCE = [
    ['Moving Membership', 'moving_membership'],
    ['Member', 'member'],
    ['Previous Member', 'previous_member'],
    ['Prospective Member', 'prospective_member'],
    ['Regular Attender', 'regular_attender'],
    ['Visitor', 'visitor'],
];

// Map a legacy `membership.status` value to a stage. The field in the real data
// holds more than the old 4-value enum (it also carries e.g. 'previous_member'),
// so a direct stage name passes through; otherwise fall back to Core's mapping
// for the historical enum. Returns null when there's nothing usable.
const ALL_STAGES = new Set(Core.MEMBERSHIP_STAGES);
function statusToStage(status) {
    if (ALL_STAGES.has(status)) return status;
    return Core.membershipFromLegacyStatus(status).stage;
}

// Derive { stage, inactive, conflict } for a Person. Tags are the primary signal
// (that is where membership actually lives today); the legacy status is a
// fallback and a conflict check.
function deriveMembership(person) {
    const p = person || {};
    const tags = p.tags || [];
    const status = p.membership && p.membership.status;

    let stage = null;
    for (const [tag, s] of TAG_STAGE_PRECEDENCE) {
        if (tags.indexOf(tag) !== -1) { stage = s; break; }
    }

    // Fallback: no membership tag at all → map the legacy status across.
    if (!stage) stage = statusToStage(status);

    const inactive = Core.isInactiveMembership(p.membership) || tags.indexOf('Inactive') !== -1;

    // Conflict: an explicit, recognised legacy status that maps to a DIFFERENT
    // stage than the tags did. Reported, not auto-resolved.
    let conflict = null;
    const statusStage = statusToStage(status);
    if (statusStage && stage && statusStage !== stage) {
        conflict = { statusStage, tagStage: stage };
    }

    return { stage, inactive, conflict };
}

module.exports = { deriveMembership, TAG_STAGE_PRECEDENCE };

// ── Firestore side (only when run directly) ──────────────────────────────────
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

    async function seedMembershipTagDocs() {
        const col = db.collection('people_tags');
        const existing = new Set((await col.get()).docs.map(d => d.id));
        let created = 0;
        for (const tagId of Core.MEMBERSHIP_TAG_IDS) {
            if (existing.has(tagId)) continue;
            if (COMMIT) await col.doc(tagId).set({ name: tagId, hiddenFromOthers: false, hidePeople: false }, { merge: true });
            created++;
            console.log(`  ${COMMIT ? 'seeded' : 'would seed'} Membership Tag doc: "${tagId}"`);
        }
        if (!created) console.log('  all Membership Tag docs already present');
        return created;
    }

    async function migratePeople() {
        const snap = await db.collection('people').get();
        let changed = 0, unchanged = 0;
        const conflicts = [];
        for (const doc of snap.docs) {
            const data = doc.data();
            const { stage, inactive, conflict } = deriveMembership(data);
            const membership = { stage, inactive };
            const currentTags = data.tags || [];
            const nextTags = Core.applyMembershipTags(currentTags, membership);

            if (conflict) conflicts.push({ name: data.name || doc.id, ...conflict });

            const membershipChanged = !data.membership
                || data.membership.stage !== stage
                || !!data.membership.inactive !== inactive;
            const tagsChanged = !sameTagSet(currentTags, nextTags);
            if (!membershipChanged && !tagsChanged) { unchanged++; continue; }

            changed++;
            const label = inactive ? 'Inactive' : (stage ? Core.MEMBERSHIP_STAGE_LABEL[stage] : '(unset)');
            console.log(`  ${COMMIT ? 'update' : 'would update'} ${data.name || doc.id}: → ${label}; tags [${currentTags.join(', ')}] → [${nextTags.join(', ')}]`);

            if (COMMIT) {
                await doc.ref.update({
                    'membership.stage': stage,
                    'membership.inactive': inactive,
                    tags: nextTags,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                });
            }
        }
        return { changed, unchanged, conflicts };
    }

    (async () => {
        console.log(`\nMembership Track migration (ADR-0012) — ${COMMIT ? 'COMMIT' : 'DRY RUN (use --commit to apply)'}\n`);
        console.log('Seeding Membership Tag docs:');
        const seeded = await seedMembershipTagDocs();
        console.log('\nMigrating people (stage derived from tags, status as fallback):');
        const { changed, unchanged, conflicts } = await migratePeople();
        if (conflicts.length) {
            console.log(`\n⚠ ${conflicts.length} status/tag CONFLICT(S) — kept the tag-derived stage; review by hand:`);
            for (const c of conflicts) {
                console.log(`   ${c.name}: legacy status → ${Core.MEMBERSHIP_STAGE_LABEL[c.statusStage]}, tags → ${Core.MEMBERSHIP_STAGE_LABEL[c.tagStage]}`);
            }
        }
        console.log(`\nDone. Tag docs ${COMMIT ? 'seeded' : 'to seed'}: ${seeded}. People ${COMMIT ? 'updated' : 'to update'}: ${changed}, unchanged: ${unchanged}, conflicts: ${conflicts.length}.`);
        if (!COMMIT) console.log('No changes were written. Re-run with --commit to apply.\n');
        process.exit(0);
    })().catch(err => { console.error('Migration failed:', err); process.exit(1); });
}
