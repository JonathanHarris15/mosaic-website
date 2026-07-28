/**
 * @fileoverview Backfill: project each Relationship Type's Shared-with-Editors
 * decision onto its edges AND its Relationship Groups (MS-132, ADR-0014 §4
 * write-through).
 *
 * Every relationship record predates the sharing projection, so none of them
 * state whether an editor may see them. This stamps them all from their Type.
 *
 * Groups are included because serving rules need them in both directions —
 * "everyone on this Role from the same group" and "no two from the same group" —
 * so a shared Group-kind Type has to bring its rosters with it. A group carries a
 * `typeId` exactly as an edge does, so the same projection applies unchanged.
 *
 * ── Safe by construction ────────────────────────────────────────────────────
 *
 * Nothing is shared by default, so in practice this marks everything NOT shared.
 * It cannot expose anything it shouldn't: a record is only ever stamped `true`
 * when its own Type already says `true`, and a record whose Type is missing is
 * stamped `false`.
 *
 * The app is already correct before this runs — reads fail closed
 * (RelationshipCore.isSharedRelationship), so an unstamped record is treated as
 * private. This exists so the SECURITY RULE can rely on the field being there
 * rather than having to infer it, and so an elder toggling a Type later has a
 * consistent starting point.
 *
 * All the decision logic lives in RelationshipCore and is unit-tested; this
 * script is only the Firestore plumbing around it.
 *
 * Run:  node scripts/backfill-relationship-sharing.js [--dry-run]
 */

const admin = require('firebase-admin');
const path = require('path');
const RelationshipCore = require('../public/relationship-core.js');

const SERVICE_ACCOUNT_FILE = 'mosaic-hymn-database-firebase-adminsdk-fbsvc-8d55863f5a.json';
const FIREBASE_PROJECT_ID = 'mosaic-hymn-database';
const BATCH_SIZE = 400;

// Both collections carry { id, typeId } and project identically.
const COLLECTIONS = ['relationships', 'relationship_groups'];

const DRY_RUN = process.argv.includes('--dry-run');

const serviceAccountPath = path.join(__dirname, '..', SERVICE_ACCOUNT_FILE);
const serviceAccount = require(serviceAccountPath);

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: FIREBASE_PROJECT_ID,
});

const db = admin.firestore();

// The writes needed to make one collection agree with the Types.
function planFor(records, types, knownTypeIds) {
    const updates = [];

    // Plan per Type, so each record is judged against its own Type and nothing else.
    types.forEach(type => {
        updates.push(...RelationshipCore.planSharingReprojection(records, type));
    });

    // A record pointing at a Type that is gone must still end up explicitly
    // closed — a dangling typeId cannot be allowed to read as shared.
    const orphans = records
        .filter(r => !knownTypeIds.has(r.typeId) && r.sharedWithEditors !== false)
        .map(r => ({ id: r.id, sharedWithEditors: false }));

    return { updates: updates.concat(orphans), orphanCount: orphans.length };
}

async function applyUpdates(collection, updates) {
    let written = 0;
    for (let i = 0; i < updates.length; i += BATCH_SIZE) {
        const batch = db.batch();
        updates.slice(i, i + BATCH_SIZE).forEach(update => {
            batch.update(db.collection(collection).doc(update.id), {
                sharedWithEditors: update.sharedWithEditors,
            });
        });
        await batch.commit();
        written += Math.min(BATCH_SIZE, updates.length - i);
        console.log(`    ${written}/${updates.length}`);
    }
    return written;
}

async function run() {
    console.log('Backfilling relationship sharing projection' + (DRY_RUN ? ' (dry run)' : ''));

    const typesSnap = await db.collection('relationship_types').get();
    const types = typesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    const knownTypeIds = new Set(types.map(t => t.id));

    console.log(
        `${types.length} Relationship Types, ` +
        `${RelationshipCore.sharedTypes(types).length} shared with editors.`
    );

    let totalWritten = 0;

    for (const collection of COLLECTIONS) {
        const snap = await db.collection(collection).get();
        const records = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        console.log(`\n${collection}: ${records.length} record(s).`);

        const { updates, orphanCount } = planFor(records, types, knownTypeIds);
        if (orphanCount) {
            console.log(`  ${orphanCount} reference a Type that no longer exists — closing them.`);
        }

        if (updates.length === 0) {
            console.log('  Nothing to do — every record already states its sharing.');
            continue;
        }

        const opening = updates.filter(u => u.sharedWithEditors === true).length;
        console.log(`  ${updates.length} to stamp (${opening} shared, ${updates.length - opening} not shared).`);

        if (DRY_RUN) continue;
        totalWritten += await applyUpdates(collection, updates);
    }

    if (DRY_RUN) {
        console.log('\nDry run: no writes made.');
        return;
    }
    console.log(`\nBackfill complete — ${totalWritten} record(s) stamped.`);
}

run()
    .then(() => process.exit(0))
    .catch(err => {
        console.error(err);
        process.exit(1);
    });
