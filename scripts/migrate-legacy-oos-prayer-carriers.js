/**
 * Copy legacy top-level prayer leader fields into `carriedBy.<prayerElementId>`.
 * Does not delete legacy fields.
 *
 * Dry-run by default. Prod requires --project mosaic-hymn-database --i-mean-prod.
 *
 *   node scripts/migrate-legacy-oos-prayer-carriers.js \
 *       --project mosaic-hymn-database --i-mean-prod
 *   node scripts/migrate-legacy-oos-prayer-carriers.js \
 *       --project mosaic-hymn-database --i-mean-prod --commit
 *
 * Optional: --from YYYY-MM-DD --to YYYY-MM-DD (service document ids / dates)
 */

const path = require('path');
const Legacy = require('../public/legacy-oos-migrate-core.js');
const Liturgy = require('../public/liturgy-order-core.js');
const {loadProject} = require('./firebase-project.js');

function committing(argv) {
    return argv.includes('--commit');
}

function willWrite(argv) {
    return committing(argv) && argv.includes('--i-mean-prod');
}

function arg(name) {
    const i = process.argv.indexOf(name);
    return i === -1 ? null : process.argv[i + 1];
}

async function loadCatalog(db) {
    const ords = await db.collection(Liturgy.COLLECTIONS.orders).get();
    const orders = ords.docs.map((d) => Object.assign({}, d.data(), {id: d.id}));
    return Liturgy.catalogFrom({orders});
}

function inDateRange(id, from, to) {
    if (from && id < from) return false;
    if (to && id > to) return false;
    return true;
}

async function main() {
    const argv = process.argv;
    const projectId = require('./firebase-project').requireProject(argv);
    const COMMIT = willWrite(argv);
    if (committing(argv) && !COMMIT) {
        throw new Error('--commit against the church project also needs --i-mean-prod.');
    }
    const from = arg('--from');
    const to = arg('--to');

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
    const catalog = await loadCatalog(db);

    const totals = {
        servicesScanned: 0,
        servicesWithLegacy: 0,
        wouldUpdate: 0,
        praise: 0,
        confession: 0,
        skippedAlreadySet: 0,
        missingTarget: 0,
    };

    const snap = await db.collection('services').get();
    const batchSize = 400;
    let batch = db.batch();
    let batchCount = 0;

    for (const doc of snap.docs) {
        if (!inDateRange(doc.id, from, to)) continue;
        totals.servicesScanned += 1;
        const data = doc.data() || {};
        const hasLegacy = Legacy.LEGACY_SPECS.some((spec) => data[spec.idField] || data[spec.nameField]);
        if (!hasLegacy) continue;
        totals.servicesWithLegacy += 1;

        const plan = Legacy.planLegacyPrayerMigration(data, catalog);
        totals.praise += plan.counts.praise;
        totals.confession += plan.counts.confession;
        totals.skippedAlreadySet += plan.counts.skipped;
        totals.missingTarget += plan.counts.missingTarget;

        if (!COMMIT && plan.skippedSlots && plan.skippedSlots.length) {
            plan.skippedSlots.forEach((slot) => {
                console.log(JSON.stringify({
                    serviceId: doc.id,
                    slot: slot.kind,
                    targetId: slot.targetId,
                    legacyPerson: slot.legacy,
                    carriedByPerson: slot.existing,
                }));
            });
        }

        if (!plan.wouldWrite) continue;
        totals.wouldUpdate += 1;

        if (COMMIT) {
            batch.set(doc.ref, plan.patch, {merge: true});
            batchCount += 1;
            if (batchCount >= batchSize) {
                await batch.commit();
                batch = db.batch();
                batchCount = 0;
            }
        }
    }

    if (COMMIT && batchCount > 0) {
        await batch.commit();
    }

    console.log(JSON.stringify({
        mode: COMMIT ? 'commit' : 'dry-run',
        projectId,
        from: from || null,
        to: to || null,
        totals,
    }, null, 2));
}

module.exports = {inDateRange};

if (require.main === module) {
    main().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}
