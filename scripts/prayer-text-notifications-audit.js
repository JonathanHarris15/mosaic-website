// @ts-nocheck
/**
 * Read-only audit of pastoral-prayer texts in `notifications`.
 * Never writes. `--commit` is ignored.
 *
 *   --since YYYY-MM-DD   lower bound, UTC midnight (default 2026-10-13)
 *   --list               one JSON object per prayer-text row; phones masked
 */
const admin = require('firebase-admin');
const {
    summarizePrayerTextFailures,
    isPrayerTextRow,
    describePrayerTextRow,
    prayerTextListSummary,
    explainPrayerTextRows,
} = require('./prayer-text-notifications-audit-lib');

function arg(name) {
    const i = process.argv.indexOf(name);
    return i === -1 ? null : process.argv[i + 1];
}

/**
 * Send-state for the prayer requests these rows name. Reads only.
 * @param {object} db
 * @param {Array<object>} rows
 * @return {Promise<Array<object>>}
 */
async function loadPrayerRequestStates(db, rows) {
    const seen = {};
    const pairs = [];
    (rows || []).forEach((row) => {
        if (!row || !row.personId || !row.serviceDate) return;
        const key = row.personId + '|' + row.serviceDate;
        if (seen[key]) return;
        seen[key] = true;
        pairs.push({personId: row.personId, serviceDate: row.serviceDate});
    });
    const states = [];
    for (let i = 0; i < pairs.length; i++) {
        const pair = pairs[i];
        const snap = await db.collection('people').doc(pair.personId)
            .collection('prayer_requests').doc(pair.serviceDate).get();
        const data = snap.exists ? (snap.data() || {}) : {};
        states.push({
            personId: pair.personId,
            serviceDate: pair.serviceDate,
            missing: !snap.exists,
            sentDays: Array.isArray(data.sentDays) ? data.sentDays.slice() : [],
            initialSentDate: data.initialSentDate || null,
            reminderSent: !!data.reminderSent,
            reminderSentDate: data.reminderSentDate || null,
            lastSendAttemptDate: data.lastSendAttemptDate || null,
        });
    }
    return states;
}

/**
 * Display names for the people these rows name. Reads only.
 * @param {object} db
 * @param {Array<string>} ids
 * @return {Promise<Object<string, string>>}
 */
async function namesForPeople(db, ids) {
    const unique = [...new Set((ids || []).filter(Boolean))];
    const names = {};
    const chunkSize = 50;
    for (let i = 0; i < unique.length; i += chunkSize) {
        const slice = unique.slice(i, i + chunkSize);
        const snaps = await db.getAll(
            ...slice.map((id) => db.collection('people').doc(id)));
        snaps.forEach((snap) => {
            const data = snap.exists ? (snap.data() || {}) : {};
            names[snap.id] = data.name || '';
        });
    }
    return names;
}

async function main() {
    const projectId = require('./firebase-project').requireProject(process.argv);
    const sinceStr = arg('--since') || '2026-10-13';
    const list = process.argv.includes('--list');
    if (!admin.apps.length) {
        admin.initializeApp({
            credential: admin.credential.cert(require(require('./service-account').serviceAccountPath())),
            projectId,
        });
    }
    const db = admin.firestore();
    const since = admin.firestore.Timestamp.fromDate(new Date(sinceStr + 'T00:00:00.000Z'));
    console.log(`DRY RUN — notifications audit since ${sinceStr}`);
    if (process.argv.includes('--commit')) {
        console.log('no writes (--commit ignored)');
    }
    const snap = await db.collection('notifications')
        .where('createdAt', '>=', since)
        .orderBy('createdAt', 'desc')
        .limit(4000)
        .get();
    const rows = snap.docs.map((d) => Object.assign({id: d.id}, d.data() || {}));
    console.log(JSON.stringify(summarizePrayerTextFailures(rows), null, 2));
    console.log(`scanned rows: ${rows.length}`);
    if (!list) return;

    const prayerRows = rows.filter(isPrayerTextRow);
    const names = await namesForPeople(db, prayerRows.map((row) => row.personId));
    const listed = prayerRows.map((row) => describePrayerTextRow(row, names));
    const requests = await loadPrayerRequestStates(db, prayerRows);
    console.log('--list prayer text rows (message bodies omitted, phones masked)');
    console.log(JSON.stringify(prayerTextListSummary(listed)));
    listed.forEach((row) => console.log(JSON.stringify(row)));
    console.log('--list checks');
    console.log(JSON.stringify(explainPrayerTextRows(listed, requests), null, 2));
}

main().catch((e) => {
    console.error(e.message || e);
    process.exit(1);
});
