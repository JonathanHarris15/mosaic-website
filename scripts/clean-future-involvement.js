/**
 * @fileoverview One-off cleanup: remove serve records written for Sundays that
 * have not happened yet (MS-161, ADR-0018 §1).
 *
 * Until MS-160, saving a Service wrote an Involvement immediately — including
 * for a Sunday six weeks out — so the serve log counts serving that has not
 * happened. Those records are now written the night the date passes instead.
 *
 * That leaves the Sundays already staffed. Each carries a record written the old
 * way, and the scheduled job would eventually write a second one beside it, so
 * every person already scheduled for the next few months would read as having
 * served twice. It never self-corrects, and fairness (MS-17) would route work
 * away from exactly the people it should be routing toward.
 *
 * So: delete the serve records for dates still ahead, and stamp those Services
 * `involvementDeferred` so the scheduled job pays them properly when the day
 * comes. Nothing real is lost — every record removed is a record of something
 * that has not happened.
 *
 * PASTORAL PRAYER IS NOT TOUCHED. `pastoral_prayer` records being prayed FOR,
 * not serving; it drives lastPastoralPrayerDate for the prayer rotation and
 * MS-160 deliberately left its timing alone.
 *
 * SERVANT ASSIGNMENTS ARE NOT TOUCHED. They already follow the new model — an
 * Assignment lives on the occurrence and only becomes Involvement once
 * Confirmed and past.
 *
 * DRY RUN BY DEFAULT, unlike the backfill scripts beside it. Those add a field;
 * this deletes records, so the safe direction is reversed and deleting has to be
 * asked for.
 *
 * Run:  node scripts/clean-future-involvement.js            # report only
 *       node scripts/clean-future-involvement.js --apply    # actually delete
 */

const admin = require('firebase-admin');
const si = require('../functions/service-involvement.js');
const ac = require('../functions/assignment-conversion.js');

const FIREBASE_PROJECT_ID = 'mosaic-hymn-database';
const BATCH_SIZE = 400;

const APPLY = process.argv.includes('--apply');

let db;

// Only the slugs a Service save writes. A servant Role's slug reaching this list
// would delete a legitimate Assignment conversion.
const SERVING_SLUGS = new Set(si.SERVING_FIELDS.map(f => f.slug));

/**
 * Is this record for a date still ahead, in a Role a Service save writes?
 *
 * The predicate that decides what gets deleted, so it is exported and tested
 * rather than trusted. Takes the record's data, not the document, for that
 * reason.
 * @param {Object} data An Involvement record.
 * @param {string} today YYYY-MM-DD, church-local.
 * @return {boolean}
 */
function isFutureServing(data, today) {
    const record = data || {};
    const date = record.serviceDate;
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
    if (typeof today !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return false;
    // On or after today. A record dated TODAY is still for something that has
    // not finished happening, and the scheduled job will not convert that date
    // until tomorrow either — so leaving it would be leaving a duplicate.
    return date >= today && SERVING_SLUGS.has(record.type);
}

async function commitAll(operations) {
    for (let i = 0; i < operations.length; i += BATCH_SIZE) {
        const batch = db.batch();
        operations.slice(i, i + BATCH_SIZE).forEach(op => op(batch));
        await batch.commit();
    }
}

async function run() {
    const { serviceAccount } = require('./service-account.js');
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount()),
        projectId: FIREBASE_PROJECT_ID,
    });
    db = admin.firestore();

    const today = ac.churchToday(new Date());
    console.log(
        `Cleaning serve records dated on or after ${today}` +
        (APPLY ? '' : ' (dry run — nothing will be deleted)')
    );

    const snap = await db.collectionGroup('involvement').get();
    const doomed = snap.docs.filter(doc => isFutureServing(doc.data(), today));

    console.log(`\n${snap.size} Involvement records in total, ${doomed.length} for dates still ahead.`);

    if (!doomed.length) {
        console.log('Nothing to do.');
        return;
    }

    // ── The report ───────────────────────────────────────────────────────────
    //
    // By date and by person, because those are the two ways a wrong query shows
    // itself: a date that should not be there, or somebody with far more records
    // than they could plausibly have.

    const byDate = new Map();
    const byPerson = new Map();
    const perPerson = new Map();

    doomed.forEach(doc => {
        const data = doc.data();
        // people/{personId}/involvement/{recordId}
        const personId = doc.ref.parent.parent.id;
        const role = data.type + (data.metadata && data.metadata.prayer_type
            ? ` (${data.metadata.prayer_type})` : '');

        if (!byDate.has(data.serviceDate)) byDate.set(data.serviceDate, []);
        byDate.get(data.serviceDate).push(`${personId} · ${role}`);

        byPerson.set(personId, (byPerson.get(personId) || 0) + 1);
        if (!perPerson.has(personId)) perPerson.set(personId, []);
        perPerson.get(personId).push(doc.ref);
    });

    console.log(`\nAcross ${byDate.size} Sunday(s) and ${byPerson.size} person(s):\n`);
    [...byDate.keys()].sort().forEach(date => {
        console.log(`  ${date}`);
        byDate.get(date).forEach(line => console.log(`      ${line}`));
    });

    const names = new Map();
    await Promise.all([...byPerson.keys()].map(async id => {
        const person = await db.collection('people').doc(id).get();
        names.set(id, person.exists ? (person.data().name || id) : `${id} (no such Person)`);
    }));

    console.log('\nRecords removed per person:\n');
    [...byPerson.entries()]
        .sort((a, b) => b[1] - a[1])
        .forEach(([id, count]) => console.log(`  ${String(count).padStart(3)}  ${names.get(id)}`));

    // The Sundays whose records are being taken away have to be marked as still
    // owing them, or the scheduled job never picks them up and the serving is
    // lost instead of merely deferred.
    const dates = [...byDate.keys()];
    console.log(`\n${dates.length} Service(s) will be stamped as still owing their records.`);

    if (!APPLY) {
        console.log('\nDry run. Re-run with --apply to delete.');
        return;
    }

    const ops = [];
    doomed.forEach(doc => ops.push(batch => batch.delete(doc.ref)));
    perPerson.forEach((refs, personId) => {
        ops.push(batch => batch.update(db.collection('people').doc(personId), {
            totalInvolvements: admin.firestore.FieldValue.increment(-refs.length),
        }));
    });
    dates.forEach(date => {
        ops.push(batch => batch.set(db.collection('services').doc(date), {
            [si.DEFERRED_FLAG]: true,
        }, { merge: true }));
    });

    await commitAll(ops);
    console.log(`\nDeleted ${doomed.length} record(s) and stamped ${dates.length} Service(s).`);
}

module.exports = { isFutureServing, SERVING_SLUGS };

// Only touch Firestore when this is run as a script, so the predicate above can
// be unit-tested without credentials.
if (require.main === module) {
    run()
        .then(() => process.exit(0))
        .catch(err => {
            console.error(err);
            process.exit(1);
        });
}
