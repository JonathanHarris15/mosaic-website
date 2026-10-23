/**
 * Delete legacy elder_meetings documents (MS-799, ADR-0015).
 *
 * Meeting minutes live in elder_documents. Dry-run by default.
 */

const path = require('path');
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

    const snap = await db.collection('elder_meetings').get();
    const ids = snap.docs.map((d) => d.id);
    console.log(JSON.stringify({ meetingDocsToDelete: ids.length, sampleIds: ids.slice(0, 20) }, null, 2));

    if (!COMMIT) {
        console.log('Dry run: no writes made.');
        return;
    }

    const batchSize = 400;
    for (let i = 0; i < snap.docs.length; i += batchSize) {
        const batch = db.batch();
        snap.docs.slice(i, i + batchSize).forEach((doc) => batch.delete(doc.ref));
        await batch.commit();
    }

    console.log('Deleted', ids.length, 'elder_meetings documents.');
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
