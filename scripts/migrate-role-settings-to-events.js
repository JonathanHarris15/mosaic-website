/**
 * Move who a Role needs, its rules and its rest onto every Event that runs it
 * (ADR 0085). The plan is scripts/role-settings-migration-core.js.
 *
 * Dry-run by default. Prod requires --project mosaic-hymn-database --i-mean-prod.
 *
 * Phase 1 — copy onto every series (safe to run any time, and again):
 *   node scripts/migrate-role-settings-to-events.js \
 *       --project mosaic-hymn-database --i-mean-prod [--commit]
 *
 * Phase 2 — strip the old fields off every Role. Only once the code that no
 * longer reads them is deployed; refused while any series still lacks settings:
 *   node scripts/migrate-role-settings-to-events.js \
 *       --project mosaic-hymn-database --i-mean-prod --strip [--commit]
 */

const path = require('path');
const Plan = require('./role-settings-migration-core.js');
const {loadProject} = require('./firebase-project.js');

const committing = argv => argv.includes('--commit');
const willWrite = argv => committing(argv) && argv.includes('--i-mean-prod');

async function main() {
    const argv = process.argv;
    const projectId = require('./firebase-project').requireProject(argv);
    const COMMIT = willWrite(argv);
    if (committing(argv) && !COMMIT) {
        throw new Error('--commit against the church project also needs --i-mean-prod.');
    }
    const STRIP = argv.includes('--strip');

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

    const [rolesSnap, seriesSnap] = await Promise.all([
        db.collection('roles').get(),
        db.collection('events').get(),
    ]);
    const roles = rolesSnap.docs.map(d => Object.assign({ id: d.id }, d.data()));
    const bySlug = {};
    roles.forEach(r => { if (r.slug) bySlug[r.slug] = r; });
    const seriesList = seriesSnap.docs.map(d => Object.assign({ id: d.id }, d.data()))
        .filter(s => Array.isArray(s.roleSlugs));

    if (!STRIP) {
        const planned = [];
        seriesList.forEach(s => {
            const plan = Plan.planSeries(s, bySlug);
            if (plan.changed) planned.push({ id: s.id, name: s.name, plan });
        });
        console.log(JSON.stringify({
            phase: 'copy',
            seriesScanned: seriesList.length,
            seriesToWrite: planned.length,
            rows: planned.map(p => ({
                series: p.id, name: p.name,
                seeded: p.plan.seeded, converted: p.plan.converted, missing: p.plan.missing,
                crossRoleRules: p.plan.crossRoleRules.length,
            })),
        }, null, 2));
        if (!COMMIT) { console.log('Dry run: no writes made.'); return; }
        for (const p of planned) {
            await db.collection('events').doc(p.id).update({
                roleSettings: p.plan.roleSettings,
                crossRoleRules: p.plan.crossRoleRules,
            });
        }
        console.log('Settings written to', planned.length, 'series.');
        return;
    }

    const blocking = Plan.unmigrated(seriesList, bySlug);
    if (blocking.length) {
        throw new Error('Refusing to strip: these series still read the Role itself — run the copy first: '
            + blocking.join(', '));
    }
    const strips = roles
        .map(r => ({ id: r.id, slug: r.slug, fields: Plan.planRoleStrip(r) }))
        .filter(r => r.fields.length);
    console.log(JSON.stringify({ phase: 'strip', rolesScanned: roles.length, rolesToStrip: strips.length, rows: strips }, null, 2));
    if (!COMMIT) { console.log('Dry run: no writes made.'); return; }
    for (const r of strips) {
        const patch = {};
        r.fields.forEach(f => { patch[f] = FieldValue.delete(); });
        await db.collection('roles').doc(r.id).update(patch);
    }
    console.log('Old fields removed from', strips.length, 'Roles.');
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
