/**
 * Rewrite printable page-number wires to node.pageNumber (MS-801).
 */

const path = require('path');
const Migrate = require('../public/migrate-printable-page-number-core.js');
const Core = require('../public/printable-core.js');
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

    const totals = { printablesScanned: 0, printablesToUpdate: 0 };
    const snap = await db.collection('printables').get();
    const planned = [];

    for (const doc of snap.docs) {
        totals.printablesScanned += 1;
        const data = doc.data() || {};
        const result = Migrate.walkPages(data, Core.normalizePageNumber);
        if (!result.changed) continue;
        totals.printablesToUpdate += 1;
        planned.push({ id: doc.id, project: result.project });
    }

    console.log(JSON.stringify({ totals, sample: planned.slice(0, 10).map((p) => p.id) }, null, 2));

    if (!COMMIT) {
        console.log('Dry run: no writes made.');
        return;
    }

    for (const row of planned) {
        await db.collection('printables').doc(row.id).set(row.project, { merge: false });
    }

    console.log('Updated', planned.length, 'printables.');
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
