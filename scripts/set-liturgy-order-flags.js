/**
 * Set ops/hidden flags on one `liturgy_orders/{id}` document (MS-770).
 *
 * Dry-run by default. The Textbelt whitelist fixture is `textbelt-url-test`.
 *
 *   node scripts/set-liturgy-order-flags.js --project mosaic-hymn-database --i-mean-prod \
 *       --id textbelt-url-test --ops
 *   node scripts/set-liturgy-order-flags.js --project mosaic-hymn-database --i-mean-prod \
 *       --id textbelt-url-test --ops --commit
 */

function arg(name) {
    const i = process.argv.indexOf(name);
    return i === -1 ? null : process.argv[i + 1];
}

async function main() {
    const commit = process.argv.includes('--commit');
    const id = arg('--id');
    const ops = process.argv.includes('--ops');
    const hidden = process.argv.includes('--hidden');
    if (!id) throw new Error('Missing --id');
    if (!ops && !hidden) throw new Error('Pass --ops and/or --hidden');

    const patch = {};
    if (ops) patch.ops = true;
    if (hidden) patch.hidden = true;

    const projectId = require('./firebase-project').requireProject(process.argv);
    const admin = require('firebase-admin');
    admin.initializeApp({
        credential: admin.credential.cert(require(require('./service-account').serviceAccountPath())),
        projectId,
    });
    const ref = admin.firestore().collection('liturgy_orders').doc(id);
    const before = await ref.get();
    if (!before.exists) throw new Error(`liturgy_orders/${id} does not exist`);

    console.log(`${commit ? 'APPLY' : 'DRY RUN'} — liturgy_orders/${id}:`, patch);
    if (!commit) return;

    await ref.set(patch, { merge: true });
    console.log('Done.');
}

main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
});
