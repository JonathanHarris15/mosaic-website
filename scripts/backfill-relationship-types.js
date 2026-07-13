/**
 * @fileoverview MS-102 — Relationship Type backfill (ADR-0014).
 *
 * One-shot, idempotent backfill that migrates every `relationship_types` doc from
 * the retired `directional` flag to the kind x priority structure:
 *
 *   directional: true  → kind:'pairwise', priority:true,  holderLabel = counterpartLabel = name
 *   directional: false → kind:'pairwise', priority:false, label = name
 *
 * Every existing type is Pairwise — Group-kind types did not exist before MS-97,
 * so none can be inferred. Seeding both role labels from the single old name is
 * lossy on purpose: there was only ever one label, and it stands in until an elder
 * gives the type real role names in the Relationships tab.
 *
 * **No relationship edges are rewritten.** `fromId` was already the "from" end of a
 * directional type and is now the priority holder — the same convention, so the
 * `relationships` collection is left completely alone.
 *
 * The mapping itself lives in RelationshipCore (`migrateTypeDoc`), so this script
 * and its unit tests share one source of truth with the app's defensive reads.
 * Idempotent: a doc that already carries a `kind` is skipped, so a second run is
 * a no-op.
 *
 * Usage:
 *   node scripts/backfill-relationship-types.js            # dry run (default)
 *   node scripts/backfill-relationship-types.js --commit   # apply
 */

const Rel = require('../public/relationship-core.js');

/**
 * The field patch to write for one legacy Relationship Type doc, or null if the
 * doc is already migrated. Pure — `deleteSentinel` stands in for
 * `admin.firestore.FieldValue.delete()` so this is testable without Firestore.
 */
function updateForType(doc, deleteSentinel) {
    if (!Rel.needsMigration(doc)) return null;

    const migrated = Rel.migrateTypeDoc(doc);
    const patch = {
        kind: migrated.kind,
        priority: migrated.priority,
        directional: deleteSentinel, // retired (ADR-0014 s1)
    };
    if (migrated.priority) {
        patch.holderLabel = migrated.holderLabel;
        patch.counterpartLabel = migrated.counterpartLabel;
    } else {
        patch.label = migrated.label;
    }
    return patch;
}

module.exports = { updateForType };

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

    function describe(patch) {
        return patch.priority
            ? `Prioritized (Holder/Counterpart "${patch.holderLabel}" / "${patch.counterpartLabel}")`
            : `Non-Prioritized (Label "${patch.label}")`;
    }

    async function backfillTypes() {
        const snap = await db.collection('relationship_types').get();
        let migrated = 0, already = 0;

        for (const doc of snap.docs) {
            const data = doc.data();
            const patch = updateForType(data, admin.firestore.FieldValue.delete());
            if (!patch) {
                already++;
                console.log(`  skip "${data.name || doc.id}" — already migrated (kind: ${data.kind})`);
                continue;
            }

            migrated++;
            console.log(`  ${COMMIT ? 'migrate' : 'would migrate'} "${data.name || doc.id}": directional:${data.directional === true} → ${describe(patch)}`);
            if (COMMIT) await doc.ref.update(patch);
        }
        return { migrated, already };
    }

    (async () => {
        console.log(`\nRelationship Type backfill (ADR-0014) — ${COMMIT ? 'COMMIT' : 'DRY RUN (use --commit to apply)'}\n`);
        console.log('Migrating relationship_types (directional → kind x priority):');
        const { migrated, already } = await backfillTypes();

        const edges = (await db.collection('relationships').get()).size;
        console.log(`\n${edges} Pairwise Relationship edge(s) left untouched — fromId is already the priority holder.`);
        console.log(`\nDone. Types ${COMMIT ? 'migrated' : 'to migrate'}: ${migrated}, already migrated: ${already}.`);
        if (!COMMIT) console.log('No changes were written. Re-run with --commit to apply.\n');
        process.exit(0);
    })().catch(err => { console.error('Backfill failed:', err); process.exit(1); });
}
