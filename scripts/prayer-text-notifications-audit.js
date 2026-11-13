// @ts-nocheck
const admin = require('firebase-admin');
const {summarizePrayerTextFailures} = require('./prayer-text-notifications-audit-lib');

function arg(name) {
    const i = process.argv.indexOf(name);
    return i === -1 ? null : process.argv[i + 1];
}

async function main() {
    const projectId = require('./firebase-project').requireProject(process.argv);
    const sinceStr = arg('--since') || '2026-10-13';
    if (!admin.apps.length) {
        admin.initializeApp({
            credential: admin.credential.cert(require(require('./service-account').serviceAccountPath())),
            projectId,
        });
    }
    const db = admin.firestore();
    const since = admin.firestore.Timestamp.fromDate(new Date(sinceStr + 'T00:00:00.000Z'));
    console.log(`DRY RUN — notifications audit since ${sinceStr}`);
    const snap = await db.collection('notifications')
        .where('createdAt', '>=', since)
        .orderBy('createdAt', 'desc')
        .limit(4000)
        .get();
    const rows = snap.docs.map((d) => Object.assign({id: d.id}, d.data() || {}));
    console.log(JSON.stringify(summarizePrayerTextFailures(rows), null, 2));
    console.log(`scanned rows: ${rows.length}`);
}

main().catch((e) => {
    console.error(e.message || e);
    process.exit(1);
});
