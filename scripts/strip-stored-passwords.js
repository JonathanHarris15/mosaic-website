/**
 * @fileoverview MS-300 (MS-241) — remove every stored plaintext password.
 *
 * Mosaic used to write each member's password, in plain text, into their own
 * `users/{uid}` document. Four places did it — sign-up, the admin create-user
 * callable, and both password changes — and an admin screen displayed it with a
 * reveal button and a copy button. MS-297 through MS-299 stopped all of that.
 *
 * This is the pass that removes the copies already written. Until it runs, every
 * password ever typed into this app is still sitting in Firestore: stopping the
 * writes capped the pile, it did not clear it.
 *
 * Firebase Authentication holds the real, hashed copy and always did — that is
 * the one every sign-in uses. Nothing reads this field any more, so deleting it
 * breaks no sign-in. A member who cannot remember their password uses the reset
 * link on the login page (MS-297), which did not exist when the field was added
 * and is the reason it could finally go.
 *
 * ⚠ ONE-WAY. There is no undo, and that is the point — a recoverable version of
 * this would not have removed anything. Dry run first, read the count, and only
 * then commit. Running it is deliberately a person's job (MS-301).
 *
 * Idempotent: a document with no `password` field is skipped, so a second run is
 * a no-op and is the honest way to verify the first one finished.
 *
 * Usage:
 *   node scripts/strip-stored-passwords.js            # dry run (default)
 *   node scripts/strip-stored-passwords.js --commit   # apply
 */

/**
 * The field patch to write for one user document, or null if there is nothing to
 * do. Pure — `deleteSentinel` stands in for `admin.firestore.FieldValue.delete()`
 * so the decision is testable without Firestore.
 *
 * ⚠ The patch names `password` and nothing else, ever. This runs over the
 * collection that holds permission levels, and a patch that carried a second
 * field could demote the whole church with no way back. strip-stored-passwords
 * .test.js pins that.
 *
 * Absent is not the same as empty: a document carrying `password: ''` still
 * carries the key, and skipping it would let a verification run report zero
 * while the key was still there. So the test is "has the key", not "has a value".
 */
function patchForUser(data, deleteSentinel) {
    if (!data || typeof data !== 'object') return null;
    if (!Object.prototype.hasOwnProperty.call(data, 'password')) return null;
    return { password: deleteSentinel };
}

module.exports = { patchForUser };

if (require.main === module) {
    const admin = require('firebase-admin');
    const { serviceAccount } = require('./service-account.js');

    const FIREBASE_PROJECT_ID = 'mosaic-hymn-database';
    const COMMIT = process.argv.includes('--commit');

    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount()),
        projectId: FIREBASE_PROJECT_ID,
    });
    const db = admin.firestore();
    const DELETE = admin.firestore.FieldValue.delete();

    async function strip() {
        const snap = await db.collection('users').get();
        let cleaned = 0;
        let alreadyClean = 0;

        for (const doc of snap.docs) {
            const patch = patchForUser(doc.data(), DELETE);

            if (patch === null) {
                alreadyClean++;
                continue;
            }

            cleaned++;
            // ⚠ The value is NOT logged, here or anywhere. Printing the passwords
            // on their way out — into a terminal, a scrollback buffer, a CI log —
            // would be the same disclosure this whole ticket exists to end.
            console.log(`  ${COMMIT ? 'cleared' : 'would clear'} ${doc.id}`);
            if (COMMIT) await doc.ref.update(patch);
        }

        return { cleaned, alreadyClean, total: snap.size };
    }

    (async () => {
        console.log(`\nStored-password cleanup (MS-241 / MS-300) — ${COMMIT ? 'COMMIT' : 'DRY RUN (use --commit to apply)'}\n`);

        const { cleaned, alreadyClean, total } = await strip();

        console.log(`\nDone. Users ${COMMIT ? 'cleared' : 'to clear'}: ${cleaned}, already clean: ${alreadyClean}, of ${total} total.`);

        if (!COMMIT) {
            console.log('No changes were written. Re-run with --commit to apply.');
            console.log('⚠ Check that total looks right for the size of the congregation before committing.\n');
        } else if (cleaned > 0) {
            console.log('Run once more without --commit; it should report 0 to clear.\n');
        } else {
            console.log('Nothing was carrying a stored password. This collection is clean.\n');
        }
        process.exit(0);
    })().catch(err => { console.error('Cleanup failed:', err); process.exit(1); });
}
