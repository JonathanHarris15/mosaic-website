/**
 * @fileoverview Backfill: stamp `elderOnly: false` onto every Form Template and
 * every Response written before the flag existed (MS-404).
 *
 * A form an elder has shut to elders is closed in `firestore.rules`, which
 * reads the flag straight off the record. A rule that narrows per document does
 * NOT narrow a query, though: Firestore refuses the whole query unless it can
 * see that every row it could return is allowed. So a reader below elder has to
 * ask for `elderOnly == false` by name — and that query cannot match a document
 * where the field is simply absent.
 *
 * Which is the whole problem this repairs. Every form and every answer written
 * before MS-404 has no such field, so without this an ordinary editor's Forms
 * library comes back empty and every Responses tab fails to load. The saves
 * write the flag now, false included; this stamps the ones already written.
 *
 * `false` is the honest value for all of them: nothing was elder-only before
 * there was a way to say so.
 *
 * Idempotent: a document that already carries `elderOnly` is left completely
 * alone, so a second run reports "nothing to do" and writes nothing.
 *
 * ⚠ RUN THIS BEFORE DEPLOYING THE RULES, not after. In that order the worst
 * case is a stamped field nothing reads yet; the other way round is a library
 * that has gone blank for every editor who is not an elder.
 *
 * Run:  node scripts/backfill-form-elder-only.js [--dry-run]
 */

const admin = require('firebase-admin');

const FIREBASE_PROJECT_ID = 'mosaic-hymn-database';
const BATCH_SIZE = 400;

const DRY_RUN = process.argv.includes('--dry-run');

const { serviceAccount } = require('./service-account.js');

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount()),
    projectId: FIREBASE_PROJECT_ID,
});

const db = admin.firestore();

async function stampCollection(name, label) {
    const snap = await db.collection(name).get();
    const needing = snap.docs.filter(d => !('elderOnly' in (d.data() || {})));

    console.log(`  ${snap.size} ${label}`);
    console.log(`  ${snap.size - needing.length} already stamped`);
    console.log(`  ${needing.length} to stamp\n`);

    for (let i = 0; i < needing.length; i += BATCH_SIZE) {
        const chunk = needing.slice(i, i + BATCH_SIZE);
        const batch = db.batch();
        chunk.forEach(doc => {
            if (!DRY_RUN) batch.set(doc.ref, { elderOnly: false }, { merge: true });
        });
        if (!DRY_RUN) await batch.commit();
        console.log(`  stamped ${Math.min(i + BATCH_SIZE, needing.length)} of ${needing.length}`);
    }

    return needing.length;
}

async function run() {
    console.log(`Stamping elderOnly onto forms and answers${DRY_RUN ? ' (DRY RUN)' : ''}\n`);

    console.log('Form Templates');
    const forms = await stampCollection('forms', 'form templates');

    console.log('Responses');
    const answers = await stampCollection('form_responses', 'responses');

    if (!forms && !answers) {
        console.log('Nothing to do.');
        return;
    }
    console.log(
        `\n${DRY_RUN ? 'Would stamp' : 'Stamped'} ${forms} form(s) and ${answers} answer(s).`
    );
}

run()
    .then(() => process.exit(0))
    .catch(e => {
        console.error(e);
        process.exit(1);
    });
