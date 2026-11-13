/**
 * MS-780 — inline liturgy_elements onto liturgy_orders, then delete loose docs.
 *
 * Dry-run by default. Prod requires --project mosaic-hymn-database --i-mean-prod.
 *
 *   node scripts/migrate-inline-liturgy-elements.js \
 *       --project mosaic-hymn-database --i-mean-prod
 *   node scripts/migrate-inline-liturgy-elements.js \
 *       --project mosaic-hymn-database --i-mean-prod --commit
 */

const path = require('path');
const Liturgy = require('../public/liturgy-order-core.js');
const Plan = require('../public/migrate-inline-liturgy-elements-core.js');
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

    const [looseSnap, ordersSnap] = await Promise.all([
        db.collection('liturgy_elements').get(),
        db.collection(Liturgy.COLLECTIONS.orders).get(),
    ]);
    const looseDocs = looseSnap.docs.map((d) => Object.assign({}, d.data(), {id: d.id}));
    const orderDocs = ordersSnap.docs.map((d) => Object.assign({}, d.data(), {id: d.id}));

    const plan = Plan.planCatalogInline(orderDocs, looseDocs);
    console.log(JSON.stringify({
        ordersScanned: orderDocs.length,
        looseElements: looseDocs.length,
        ordersToInline: plan.orderWrites.length,
        looseToDelete: plan.deleteLooseIds.length,
        blocked: plan.blocked.length,
    }, null, 2));

    if (plan.blocked.length) {
        console.error('Blocked — missing loose elements for elementIds:', plan.blocked);
        process.exit(1);
    }

    if (!COMMIT) {
        console.log('Dry run: no writes made.');
        return;
    }

    const batchSize = 400;
    for (let i = 0; i < plan.orderWrites.length; i += batchSize) {
        const batch = db.batch();
        plan.orderWrites.slice(i, i + batchSize).forEach((row) => {
            batch.update(db.collection(Liturgy.COLLECTIONS.orders).doc(row.id), row.update);
        });
        await batch.commit();
    }

    for (let i = 0; i < plan.deleteLooseIds.length; i += batchSize) {
        const batch = db.batch();
        plan.deleteLooseIds.slice(i, i + batchSize).forEach((id) => {
            batch.delete(db.collection('liturgy_elements').doc(id));
        });
        await batch.commit();
    }

    console.log('Inline complete.');
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
