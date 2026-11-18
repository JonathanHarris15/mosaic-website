/**
 * @fileoverview Bring the whole cover list into line with its occurrences, once.
 *
 * The cover list is a DERIVED VIEW of each occurrence and its roster
 * (public/place-core.js, `desiredCover`). Two triggers now keep it so as things
 * change: a roster row written, and the occurrence itself written
 * (`endTradesOnFilledPlace`, `reconcileCoverOnOccurrence`). Neither can reach
 * an entry made wrong BEFORE they existed, because nothing will ever write
 * about it again:
 *
 *   - places whose roster rows were cleared while only a delete-only sweep ran;
 *   - places on dates since cancelled or moved (and the moved date's own
 *     declined places, which were never put back on the list);
 *   - entries stamped with a rung their Event no longer has;
 *   - one-off jobs sharing a single entry under the old `…__one_off__one_off`
 *     id, which now have one each.
 *
 * So this runs the same reconcile — `reconcileCover`, the one the triggers run
 * — over every occurrence the list names and every occurrence from today on.
 *
 * DRY RUN BY DEFAULT. It writes, so writing has to be asked for. Through the
 * Prod ops workflow (docs/ops/prod-ops-script.md): `commit=false` first, read
 * the log, then `commit=true`.
 *
 *   node scripts/reconcile-cover.js --project mosaic-hymn-database --i-mean-prod
 *   node scripts/reconcile-cover.js --project mosaic-hymn-database --i-mean-prod --commit
 */

const aa = require('../functions/assignment-answer.js');
const aw = require('../functions/assignment-writes.js');
const ac = require('../functions/assignment-conversion.js');
const place = require('../functions/shared/place-core.js');
const {serviceAccount} = require('./service-account.js');

const OCCURRENCES = 'event_occurrences';
const COVER = 'cover';

let db;

/**
 * Is this advertisement still true?
 *
 * The predicate the whole script turns on, so it takes plain data and is
 * exported to be tested rather than trusted.
 * @param {*} entry The cover document's data.
 * @param {Array<*>} roster Every roster row on that occurrence.
 * @return {boolean} true when the place really is still looking for somebody.
 */
function stillNeeded(entry, roster) {
    const e = entry || {};
    const row = (roster || []).find((a) => place.samePlace(a, e));
    if (!row) return false;
    return (row.state || null) === aa.STATES.DECLINED;
}

/** Reconcile every occurrence the list names, and every one from today on. */
async function main() {
    const argv = process.argv;
    const projectId = require('./firebase-project').requireProject(argv);
    const committing = argv.includes('--commit');
    const APPLY = committing && argv.includes('--i-mean-prod');
    if (committing && !APPLY) {
        throw new Error('--commit against the church project also needs --i-mean-prod.');
    }
    const admin = require('firebase-admin');
    if (!admin.apps.length) {
        admin.initializeApp({credential: admin.credential.cert(serviceAccount()), projectId});
    }
    db = admin.firestore();

    const ids = new Set();
    const entries = await db.collection(COVER).get();
    entries.docs.forEach((d) => { if (d.data().occurrenceId) ids.add(d.data().occurrenceId); });
    const upcoming = await db.collection(OCCURRENCES)
        .where('date', '>=', ac.churchToday(new Date())).get();
    upcoming.docs.forEach((d) => ids.add(d.id));
    // An entry naming no occurrence at all can be reached by nothing else.
    const orphans = entries.docs.filter((d) => !d.data().occurrenceId);
    console.log(`${entries.size} cover entries; ${ids.size} occurrences to check.`);

    const {loadRoleRegistry} = require('../functions/roles-read.js');
    const roleNameOf = (await loadRoleRegistry(db)).nameOf;
    let set = 0;
    let removed = orphans.length;
    for (const id of ids) {
        const changes = await aw.reconcileCover(db, id, {roleNameOf, dryRun: !APPLY});
        changes.set.forEach((c) => console.log(`  + ${c.entry.date}  ${c.entry.roleName || c.entry.roleSlug}  (${c.entry.eventName})`));
        changes.remove.forEach((c) => console.log(`  - ${c}`));
        set += changes.set.length;
        removed += changes.remove.length;
    }
    orphans.forEach((d) => console.log(`  - ${d.id} (names no occurrence)`));
    if (APPLY) {
        for (const d of orphans) await d.ref.delete();
        console.log(`\nWrote ${set}, removed ${removed}.`);
    } else {
        console.log(`\nDry run: ${set} to write, ${removed} to remove. Re-run with --commit.`);
    }
}

module.exports = {stillNeeded};

if (require.main === module) {
    main().then(() => process.exit(0)).catch((e) => {
        console.error(e);
        process.exit(1);
    });
}
