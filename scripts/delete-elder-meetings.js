/**
 * Delete legacy elder_meetings documents (MS-799, ADR-0015).
 *
 * Meeting minutes live in elder_documents. Commit refuses unless the collection
 * is empty or every meeting id also exists in elder_documents (same id).
 *
 * Dry-run by default. Prod requires --project mosaic-hymn-database --i-mean-prod.
 */

const path = require('path');
const Plan = require('../public/delete-elder-meetings-core.js');
const {loadProject} = require('./firebase-project.js');

/** @param {string[]} argv */
function committing(argv) {
    return argv.includes('--commit');
}

/** @param {string[]} argv */
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

    const [meetingsSnap, documentsSnap] = await Promise.all([
        db.collection('elder_meetings').get(),
        db.collection('elder_documents').get(),
    ]);
    const meetingIds = meetingsSnap.docs.map((d) => d.id);
    const elderDocumentIds = documentsSnap.docs.map((d) => d.id);
    const plan = Plan.planElderMeetingsDeletion(meetingIds, elderDocumentIds);

    console.log(JSON.stringify({
        meetingDocsToDelete: plan.meetingIds.length,
        elderDocumentsScanned: elderDocumentIds.length,
        canDelete: plan.canDelete,
        missingInElderDocuments: plan.missingInElderDocuments.slice(0, 20),
        sampleMeetingIds: plan.meetingIds.slice(0, 20),
    }, null, 2));

    if (!plan.canDelete) {
        throw new Error(
            'Refusing to delete elder_meetings: some ids are not present in elder_documents.');
    }

    if (!COMMIT) {
        console.log('Dry run: no writes made.');
        return;
    }

    const batchSize = 400;
    for (let i = 0; i < meetingsSnap.docs.length; i += batchSize) {
        const batch = db.batch();
        meetingsSnap.docs.slice(i, i + batchSize).forEach((doc) => batch.delete(doc.ref));
        await batch.commit();
    }

    console.log('Deleted', plan.meetingIds.length, 'elder_meetings documents.');
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
