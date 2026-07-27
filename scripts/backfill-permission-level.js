/**
 * @fileoverview MS-121 (MS-119) — Permission Level backfill.
 *
 * One-shot, idempotent backfill for the users/{uid}.role → users/{uid}.permissionLevel
 * rename. Copies each user's existing `role` (the permission tier: viewer / member /
 * editor / elder / admin / super_admin) into a new `permissionLevel` field, leaving
 * `role` untouched so both coexist during the staged migration. MS-127 drops the
 * old `role` field afterwards. Idempotent: a user whose permissionLevel already
 * matches their role is skipped, so a second run is a no-op.
 *
 * This is STEP 1 of the migration and is safe to run before any code or rules
 * change — it only ADDS a field. Run it, then deploy the fallback rules (MS-122),
 * then release the renamed code (MS-123/124), verify every tier, and only then
 * drop `role` (MS-127).
 *
 * Usage:
 *   node scripts/backfill-permission-level.js            # dry run (default)
 *   node scripts/backfill-permission-level.js --commit   # apply
 */

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

    async function backfill() {
        const snap = await db.collection('users').get();
        let changed = 0, unchanged = 0, missing = 0;
        for (const doc of snap.docs) {
            const data = doc.data() || {};
            const role = data.role;
            const permissionLevel = data.permissionLevel;

            // Already synced — leave it (idempotent, second run is a no-op).
            if (permissionLevel !== undefined && permissionLevel === role) { unchanged++; continue; }

            // No legacy role to copy — flag for manual review rather than guess.
            if (role === undefined) {
                missing++;
                console.log(`  SKIP ${doc.id}: no 'role' field to copy (permissionLevel=${permissionLevel === undefined ? 'unset' : `"${permissionLevel}"`})`);
                continue;
            }

            changed++;
            const was = permissionLevel === undefined ? 'unset' : `"${permissionLevel}"`;
            console.log(`  ${COMMIT ? 'set' : 'would set'} ${doc.id}: permissionLevel = "${role}" (was ${was})`);
            if (COMMIT) {
                await doc.ref.update({ permissionLevel: role });
            }
        }
        return { changed, unchanged, missing };
    }

    (async () => {
        console.log(`\nPermission Level backfill (MS-119 / MS-121) — ${COMMIT ? 'COMMIT' : 'DRY RUN (use --commit to apply)'}\n`);
        const { changed, unchanged, missing } = await backfill();
        console.log(`\nDone. Users ${COMMIT ? 'updated' : 'to update'}: ${changed}, already-synced: ${unchanged}, skipped (no role): ${missing}.`);
        if (!COMMIT) console.log('No changes were written. Re-run with --commit to apply.\n');
        process.exit(0);
    })().catch(err => { console.error('Backfill failed:', err); process.exit(1); });
}
