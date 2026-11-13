/**
 * Set ops/hidden flags on one `liturgy_orders/{id}` document (MS-770).
 *
 * Dry-run by default. List every order (read-only) or resolve by display name:
 *
 *   node scripts/set-liturgy-order-flags.js --project mosaic-hymn-database --i-mean-prod --list
 *   node scripts/set-liturgy-order-flags.js --project mosaic-hymn-database --i-mean-prod \
 *       --name-match textbelt --ops
 *   node scripts/set-liturgy-order-flags.js --project mosaic-hymn-database --i-mean-prod \
 *       --id <document-id> --ops --commit
 */

const {
    formatOrderListLines,
    resolveOrderIdByNameMatch,
} = require('./set-liturgy-order-flags-lib');

function arg(name) {
    const i = process.argv.indexOf(name);
    return i === -1 ? null : process.argv[i + 1];
}

function initAdmin(projectId) {
    const admin = require('firebase-admin');
    if (!admin.apps.length) {
        admin.initializeApp({
            credential: admin.credential.cert(require(require('./service-account').serviceAccountPath())),
            projectId,
        });
    }
    return admin.firestore();
}

async function loadOrders(db) {
    const snap = await db.collection('liturgy_orders').get();
    return snap.docs.map((doc) => Object.assign({id: doc.id}, doc.data()));
}

async function main() {
    const commit = process.argv.includes('--commit');
    const list = process.argv.includes('--list');
    const idArg = arg('--id');
    const nameMatch = arg('--name-match');
    const ops = process.argv.includes('--ops');
    const hidden = process.argv.includes('--hidden');

    const projectId = require('./firebase-project').requireProject(process.argv);
    const db = initAdmin(projectId);

    if (list) {
        if (idArg || nameMatch || ops || hidden || commit) {
            throw new Error('--list is read-only; do not pass --id, --name-match, --ops, --hidden, or --commit.');
        }
        const lines = formatOrderListLines(await loadOrders(db));
        console.log(lines.join('\n'));
        return;
    }

    if (!ops && !hidden) throw new Error('Pass --ops and/or --hidden');
    if (idArg && nameMatch) {
        throw new Error('Pass only one of --id or --name-match.');
    }
    if (!idArg && !nameMatch) {
        throw new Error('Pass --id or --name-match (or --list to inspect orders).');
    }

    let id = idArg;
    if (nameMatch) {
        id = resolveOrderIdByNameMatch(await loadOrders(db), nameMatch);
        console.log(`Resolved --name-match ${JSON.stringify(nameMatch)} → liturgy_orders/${id}`);
    }

    const patch = {};
    if (ops) patch.ops = true;
    if (hidden) patch.hidden = true;

    const ref = db.collection('liturgy_orders').doc(id);
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
