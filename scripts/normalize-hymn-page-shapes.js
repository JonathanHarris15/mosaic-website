/**
 * Normalise hymns.versions[].pages[] to url strings (MS-802).
 */

const path = require('path');
const Shape = require('../public/hymn-page-shape-core.js');
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

    const totals = { hymnsScanned: 0, hymnsToUpdate: 0 };
    const snap = await db.collection('hymns').get();
    const planned = [];

    for (const doc of snap.docs) {
        totals.hymnsScanned += 1;
        const plan = Shape.planHymnPageShapes(doc.data());
        if (!plan || !plan.changed) continue;
        totals.hymnsToUpdate += 1;
        planned.push({ hymnId: doc.id, versions: plan.versions });
    }

    console.log(JSON.stringify({ totals, sample: planned.slice(0, 10).map((p) => p.hymnId) }, null, 2));

    if (!COMMIT) {
        console.log('Dry run: no writes made.');
        return;
    }

    for (const row of planned) {
        await db.collection('hymns').doc(row.hymnId).update({ versions: row.versions });
    }

    console.log('Updated', planned.length, 'hymns.');
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
