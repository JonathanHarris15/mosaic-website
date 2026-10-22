/**
 * Delete legacy top-level OOS prayer leader fields after `carriedBy` migration.
 *
 * Dry-run by default. Prod requires --project mosaic-hymn-database --i-mean-prod.
 *
 *   node scripts/delete-legacy-oos-prayer-fields.js \
 *       --project mosaic-hymn-database --i-mean-prod
 *   node scripts/delete-legacy-oos-prayer-fields.js \
 *       --project mosaic-hymn-database --i-mean-prod --commit
 *
 * Aborts without writing when any service still has legacy fields but an empty
 * matching `carriedBy` slot (migration not applied).
 */

const path = require('path');
const DeleteCore = require('../public/delete-legacy-oos-prayer-fields-core.js');
const Liturgy = require('../public/liturgy-order-core.js');
const {loadProject} = require('./firebase-project.js');

function committing(argv) {
    return argv.includes('--commit');
}

function willWrite(argv) {
    return committing(argv) && argv.includes('--i-mean-prod');
}

async function loadCatalog(db) {
    const ords = await db.collection(Liturgy.COLLECTIONS.orders).get();
    const orders = ords.docs.map((d) => Object.assign({}, d.data(), {id: d.id}));
    return Liturgy.catalogFrom({orders});
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
    const FieldValue = admin.firestore.FieldValue;
    const catalog = await loadCatalog(db);

    const totals = {
        servicesScanned: 0,
        servicesWithLegacy: 0,
        wouldDeleteFields: 0,
        blockedServices: 0,
    };
    const blocked = [];
    const planned = [];

    const snap = await db.collection('services').get();
    const batchSize = 400;
    let batch = db.batch();
    let batchCount = 0;

    for (const doc of snap.docs) {
        totals.servicesScanned += 1;
        const data = doc.data() || {};
        if (!DeleteCore.hasLegacyFields(data)) continue;
        totals.servicesWithLegacy += 1;

        const plan = DeleteCore.planLegacyPrayerFieldDeletion(data, catalog, doc.id);
        if (plan.blocked) {
            totals.blockedServices += 1;
            blocked.push({
                serviceId: doc.id,
                blockReasons: plan.blockReasons,
            });
            continue;
        }

        if (!plan.wouldDelete) continue;
        totals.wouldDeleteFields += plan.deleteFields.length;
        planned.push({
            serviceId: doc.id,
            deleteFields: plan.deleteFields,
        });

        if (COMMIT) {
            const patch = {};
            plan.deleteFields.forEach((field) => {
                patch[field] = FieldValue.delete();
            });
            batch.update(doc.ref, patch);
            batchCount += 1;
            if (batchCount >= batchSize) {
                await batch.commit();
                batch = db.batch();
                batchCount = 0;
            }
        }
    }

    if (blocked.length) {
        console.log(JSON.stringify({ blocked }, null, 2));
        console.error(
            `Abort: ${blocked.length} service(s) still have legacy prayer fields without a migrated carriedBy slot.`);
        process.exit(1);
    }

    if (COMMIT && batchCount > 0) {
        await batch.commit();
    }

    if (!COMMIT) {
        planned.forEach((row) => console.log(JSON.stringify(row)));
    }

    console.log(JSON.stringify({
        mode: COMMIT ? 'commit' : 'dry-run',
        projectId,
        totals,
        serviceIds: planned.map((p) => p.serviceId),
    }, null, 2));
}

module.exports = {loadCatalog};

if (require.main === module) {
    main().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}
