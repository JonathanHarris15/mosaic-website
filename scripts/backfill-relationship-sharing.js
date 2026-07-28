/**
 * @fileoverview Backfill: project each Relationship Type's Shared-with-Editors
 * decision onto its edges (MS-132, ADR-0014 §4 write-through).
 *
 * Every relationship edge predates the sharing projection, so none of them state
 * whether an editor may see them. This stamps them all from their Type.
 *
 * ── Safe by construction ────────────────────────────────────────────────────
 *
 * Nothing is shared by default, so in practice this marks everything NOT shared.
 * It cannot expose anything it shouldn't: an edge is only ever stamped `true`
 * when its own Type already says `true`, and an edge whose Type is missing is
 * stamped `false`.
 *
 * The app is already correct before this runs — reads fail closed
 * (RelationshipCore.isEdgeSharedWithEditors), so an unstamped edge is treated as
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

const DRY_RUN = process.argv.includes('--dry-run');

const serviceAccountPath = path.join(__dirname, '..', SERVICE_ACCOUNT_FILE);
const serviceAccount = require(serviceAccountPath);

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: FIREBASE_PROJECT_ID,
});

const db = admin.firestore();

async function run() {
    console.log('Backfilling relationship sharing projection' + (DRY_RUN ? ' (dry run)' : ''));

    const typesSnap = await db.collection('relationship_types').get();
    const types = typesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    const sharedCount = RelationshipCore.sharedTypes(types).length;
    console.log(`${types.length} Relationship Types, ${sharedCount} shared with editors.`);

    const edgesSnap = await db.collection('relationships').get();
    const edges = edgesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    console.log(`${edges.length} relationship edges.`);

    // Plan per Type, so each edge is judged against its own Type and nothing
    // else. Edges whose Type no longer exists are handled separately below.
    const updates = [];
    types.forEach(type => {
        updates.push(...RelationshipCore.planSharingReprojection(edges, type));
    });

    // An edge pointing at a Type that is gone must still end up explicitly
    // closed — a dangling typeId cannot be allowed to read as shared.
    const knownTypeIds = new Set(types.map(t => t.id));
    edges
        .filter(e => !knownTypeIds.has(e.typeId) && e.sharedWithEditors !== false)
        .forEach(e => updates.push({ id: e.id, sharedWithEditors: false, orphaned: true }));

    const orphaned = updates.filter(u => u.orphaned).length;
    if (orphaned) console.log(`  ${orphaned} edge(s) reference a Type that no longer exists — closing them.`);

    if (updates.length === 0) {
        console.log('Nothing to do — every edge already states its sharing.');
        return;
    }

    const opening = updates.filter(u => u.sharedWithEditors === true).length;
    console.log(`${updates.length} edge(s) to stamp (${opening} shared, ${updates.length - opening} not shared).`);

    if (DRY_RUN) {
        console.log('Dry run: no writes made.');
        return;
    }

    let written = 0;
    for (let i = 0; i < updates.length; i += BATCH_SIZE) {
        const batch = db.batch();
        updates.slice(i, i + BATCH_SIZE).forEach(update => {
            batch.update(db.collection('relationships').doc(update.id), {
                sharedWithEditors: update.sharedWithEditors,
            });
        });
        await batch.commit();
        written += Math.min(BATCH_SIZE, updates.length - i);
        console.log(`  ${written}/${updates.length}`);
    }

    console.log(`Backfill complete — ${written} edge(s) stamped.`);
}

run()
    .then(() => process.exit(0))
    .catch(err => {
        console.error(err);
        process.exit(1);
    });
