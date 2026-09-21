/**
 * @fileoverview MS-554 — Person account-rank backfill (MS-539 / MS-557).
 *
 * One-shot, idempotent backfill that writes `people.accountRank` for every
 * Person from their Linked User. `syncAccountRankToPerson` keeps the field
 * in sync from here on, but it only fires on FUTURE `users/{uid}` writes —
 * so already-linked People have no projected rank until their user doc is
 * next touched. Without this pass existing Linked Users stay unprojected
 * (fail-closed on non-public Trades once the picker ships).
 *
 * Rank matches server `rankOf`: permissionLevel, then the legacy `role`
 * fallback. The same pure helper the trigger uses
 * (`account-rank-sync.planPersonProjection`).
 *
 * Usage:
 *   node scripts/backfill-account-rank.js            # dry run (default)
 *   node scripts/backfill-account-rank.js --commit   # apply
 *
 * Run AFTER `functions:syncAccountRankToPerson` is live via the standing
 * Firebase Actions path (MS-557 / MS-561). Note the result on MS-539.
 */

const Sync = require('../functions/account-rank-sync.js');

if (require.main === module) {
    const admin = require('firebase-admin');
    const path = require('path');
    const fs = require('fs');

    const FIREBASE_PROJECT_ID = 'mosaic-hymn-database';
    const COMMIT = process.argv.includes('--commit');

    function resolveServiceAccount() {
        const root = path.join(__dirname, '..');
        const match = fs.readdirSync(root).find(
            f => f.startsWith('mosaic-hymn-database-firebase-adminsdk') &&
                f.endsWith('.json')
        );
        if (!match) {
            throw new Error(
                'No mosaic-hymn-database-firebase-adminsdk-*.json ' +
                'found in project root.');
        }
        return require(path.join(root, match));
    }

    require('./firebase-project').requireProject(process.argv, {
        hardcoded: 'mosaic-hymn-database',
    });
    admin.initializeApp({
        credential: admin.credential.cert(resolveServiceAccount()),
        projectId: FIREBASE_PROJECT_ID,
    });
    const db = admin.firestore();

    async function backfillPeople() {
        const usersSnap = await db.collection('users').get();
        const userByUid = {};
        usersSnap.docs.forEach(d => {
            userByUid[d.id] = d.data() || {};
        });

        const snap = await db.collection('people').get();
        let changed = 0;
        let unchanged = 0;
        for (const doc of snap.docs) {
            const person = doc.data();
            const user = person.userId ? userByUid[person.userId] || null : null;
            const plan = Sync.planPersonProjection(person, user);
            if (!plan.needsWrite) {
                unchanged++;
                continue;
            }
            changed++;
            const label = person.name || doc.id;
            const verb = plan.next ? `set ${plan.next}` : 'clear';
            console.log(
                `  ${COMMIT ? 'update' : 'would update'} ${label}: ${verb}`);
            if (COMMIT) {
                await doc.ref.update({
                    accountRank: plan.next,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                });
            }
        }
        return { changed, unchanged };
    }

    (async () => {
        console.log(
            `\nAccount-rank backfill (MS-554 / MS-557) — ` +
            `${COMMIT ? 'COMMIT' : 'DRY RUN (use --commit to apply)'}\n`);
        const { changed, unchanged } = await backfillPeople();
        console.log(
            `\nDone. People ${COMMIT ? 'updated' : 'to update'}: ` +
            `${changed}, unchanged: ${unchanged}.`);
        if (!COMMIT) {
            console.log('No changes were written. Re-run with --commit.\n');
        }
        process.exit(0);
    })().catch(err => {
        console.error('Backfill failed:', err);
        process.exit(1);
    });
}
