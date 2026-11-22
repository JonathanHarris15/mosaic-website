/**
 * Strip the old fields off every Role once each Event has its own settings
 * (ADR 0085). The plan is scripts/role-settings-migration-core.js. The copy
 * phase ran on 2026-11-21 and was retired; --strip is the only phase left.
 *
 * Dry-run by default. Prod requires --project mosaic-hymn-database --i-mean-prod:
 *   node scripts/migrate-role-settings-to-events.js --strip \
 *       --project mosaic-hymn-database --i-mean-prod [--commit]
 */

const path = require('path');
const Plan = require('./role-settings-migration-core.js');
const {loadProject} = require('./firebase-project.js');

/** @param {*} argv */
const committing = argv => argv.includes('--commit');
/** @param {*} argv */
const willWrite = argv => committing(argv) && argv.includes('--i-mean-prod');

async function main() {
    const argv = process.argv;
    const projectId = require('./firebase-project').requireProject(argv);
    const COMMIT = willWrite(argv);
    if (committing(argv) && !COMMIT) {
        throw new Error('--commit against the church project also needs --i-mean-prod.');
    }
    if (!argv.includes('--strip')) {
        throw new Error('The copy phase ran on 2026-11-21 and was retired. Pass --strip.');
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

    const [rolesSnap, seriesSnap] = await Promise.all([
        db.collection('roles').get(),
        db.collection('events').get(),
    ]);
    const roles = rolesSnap.docs.map((/** @type {*} */ d) => Object.assign({ id: d.id }, d.data()));
    const bySlug = {};
    roles.forEach((/** @type {*} */ r) => { if (r.slug) bySlug[r.slug] = r; });
    const seriesList = seriesSnap.docs.map((/** @type {*} */ d) => Object.assign({ id: d.id }, d.data()))
        .filter((/** @type {*} */ s) => Array.isArray(s.roleSlugs));

    const blocking = Plan.unmigrated(seriesList, bySlug);
    if (blocking.length) {
        throw new Error('Refusing to strip: these series have no settings of their own for a Role they run: '
            + blocking.join(', '));
    }
    const strips = roles
        .map((/** @type {*} */ r) => ({ id: r.id, slug: r.slug, fields: Plan.planRoleStrip(r) }))
        .filter((/** @type {*} */ r) => r.fields.length);
    console.log(JSON.stringify({ phase: 'strip', rolesScanned: roles.length, rolesToStrip: strips.length, rows: strips }, null, 2));
    if (!COMMIT) { console.log('Dry run: no writes made.'); return; }
    for (const r of strips) {
        const patch = {};
        r.fields.forEach((/** @type {*} */ f) => { patch[f] = FieldValue.delete(); });
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
