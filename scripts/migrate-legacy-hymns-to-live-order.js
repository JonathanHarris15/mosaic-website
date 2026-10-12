/**
 * @fileoverview MS-731 — copy filled legacy Standard hymn slots onto the
 * live Standard Liturgy Order ids.
 *
 * After the live `liturgy_orders/standard` document was re-composed with
 * new hymn element ids, Sundays kept values under preparatoryHymn / hymn1 /
 * hymn2 / hymnMid* / hymnEnd*. The UI only reads the live ids, so hymns
 * vanished. hymn2 collides (live = Preparatory; legacy = Hymn 2).
 *
 * This script copies each filled legacy slot onto its live target by
 * liturgical position. Legacy keys stay. Dry-run is the default.
 *
 * Usage:
 *   node scripts/migrate-legacy-hymns-to-live-order.js \
 *       --project mosaic-hymn-database --i-mean-prod
 *   ...same... --commit
 *
 * Ops note: docs/ops/ms-731-legacy-hymn-migrate.md
 */

const fs = require('fs');
const path = require('path');
const Core = require('../public/liturgy-hymn-migrate-core.js');
const {requireProject} = require('./firebase-project');

const BATCH_SIZE = 400;

function stamp() {
    return new Date().toISOString().replace(/[:.]/g, '-');
}

/**
 * Plan every Sunday that still needs a hymn copy.
 * @param {Array<{id: string, data: object}>} services
 * @return {{planned: Array, unchanged: number}}
 */
function planAll(services) {
    const planned = [];
    let unchanged = 0;
    (services || []).forEach((row) => {
        const plan = Core.planServiceHymnMigration(row.data || {});
        if (!plan.changes.length) {
            unchanged += 1;
            return;
        }
        planned.push({
            date: row.id,
            changes: plan.changes,
            update: plan.update,
        });
    });
    return {planned, unchanged};
}

module.exports = {planAll, Core};

async function main() {
    const commit = process.argv.includes('--commit');
    const projectId = requireProject(process.argv);
    const admin = require('firebase-admin');
    admin.initializeApp({
        credential: admin.credential.cert(require(require('./service-account').serviceAccountPath())),
        projectId,
    });
    const db = admin.firestore();

    const snap = await db.collection('services').get();
    const services = snap.docs.map((doc) => ({id: doc.id, data: doc.data()}));
    const {planned, unchanged} = planAll(services);

    const outDir = path.join(__dirname, '..', 'docs', 'ops');
    const reportPath = path.join(outDir, `ms-731-hymn-migrate-${commit ? 'commit' : 'dry'}-${stamp()}.json`);
    const summary = {
        projectId,
        mode: commit ? 'commit' : 'dry-run',
        at: new Date().toISOString(),
        serviceCount: services.length,
        SundaysToWrite: planned.length,
        SundaysUnchanged: unchanged,
        fieldWrites: planned.reduce((n, row) => n + Object.keys(row.update).length, 0),
        samples: planned.slice(0, 12).map((row) => ({
            date: row.date,
            fields: Object.keys(row.update),
            hymns: row.changes
                .filter((c) => c.field.indexOf('liturgy.') === 0)
                .map((c) => ({
                    field: c.field,
                    from: c.from,
                    after: c.after && c.after.name,
                })),
        })),
    };
    fs.writeFileSync(reportPath, JSON.stringify({summary, planned}, null, 2));

    console.log(`${commit ? 'APPLY' : 'DRY RUN'} — ${projectId}`);
    console.log(`  services: ${services.length}`);
    console.log(`  Sundays to write: ${planned.length}`);
    console.log(`  Sundays unchanged: ${unchanged}`);
    console.log(`  field writes: ${summary.fieldWrites}`);
    console.log(`  report: ${reportPath}`);
    summary.samples.slice(0, 5).forEach((s) => {
        console.log(`  ${s.date}: ${s.hymns.map((h) => h.after || '(empty)').join(' | ')}`);
    });

    if (!commit || !planned.length) return;

    let written = 0;
    let batch = db.batch();
    let inBatch = 0;
    for (const row of planned) {
        const ref = db.collection('services').doc(row.date);
        batch.update(ref, Object.assign({}, row.update, {
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }));
        inBatch += 1;
        written += 1;
        if (inBatch >= BATCH_SIZE) {
            await batch.commit();
            batch = db.batch();
            inBatch = 0;
        }
    }
    if (inBatch) await batch.commit();
    console.log(`Applied. Wrote ${written} Sunday(s).`);
}

if (require.main === module) {
    main().catch((err) => {
        console.error(err.message || err);
        process.exit(1);
    });
}
