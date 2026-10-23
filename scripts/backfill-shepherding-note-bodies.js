/**
 * Backfill shepherding_notes content / contentJson (MS-798).
 *
 * Dry-run by default. Prod requires --project mosaic-hymn-database --i-mean-prod.
 */

const path = require('path');
const Body = require('../public/shepherding-note-body-core.js');
const {loadProject} = require('./firebase-project.js');

function committing(argv) {
    return argv.includes('--commit');
}

function willWrite(argv) {
    return committing(argv) && argv.includes('--i-mean-prod');
}

async function main() {
    const argv = process.argv;
    const projectId = require('./firebase-project').requireProject(argv);
    const COMMIT = willWrite(argv);
    if (committing(argv) && !COMMIT) {
        throw new Error('--commit against the church project also needs --i-mean-prod.');
    }

    const project = loadProject(path.join(__dirname, '..'), projectId);
    const admin = require('firebase-admin');
    if (!admin.apps.length) {
        admin.initializeApp({
            credential: admin.credential.cert(require(require('./service-account').serviceAccountPath())),
            projectId,
            storageBucket: project.storageBucket,
        });
    }
    const db = admin.firestore();

    const totals = { notesScanned: 0, wouldUpdate: 0 };
    const planned = [];

    const peopleSnap = await db.collection('people').get();
    for (const person of peopleSnap.docs) {
        const notesSnap = await person.ref.collection('shepherding_notes').get();
        for (const noteDoc of notesSnap.docs) {
            totals.notesScanned += 1;
            const plan = Body.planNoteBodyBackfill(noteDoc.data());
            if (!plan) continue;
            totals.wouldUpdate += 1;
            planned.push({ personId: person.id, noteId: noteDoc.id, update: plan });
        }
    }

    console.log(JSON.stringify({ totals, sample: planned.slice(0, 15) }, null, 2));

    if (!COMMIT) {
        console.log('Dry run: no writes made.');
        return;
    }

    for (const row of planned) {
        await db.collection('people').doc(row.personId)
            .collection('shepherding_notes').doc(row.noteId)
            .update(row.update);
    }

    console.log('Updated', planned.length, 'notes.');
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
