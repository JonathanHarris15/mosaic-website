/**
 * @fileoverview One-off cleanup: take down cover advertisements for places that
 * are no longer looking for anybody.
 *
 * The cover list is DERIVED from the roster but stored as its own collection —
 * a small denormalised document written alongside a decline, so the list can
 * render without opening the occurrence the reader may not be allowed to see
 * (cover-store.js).
 *
 * Every path that SETTLED a place deleted that document by hand: taking one,
 * settling a Trade, going quiet. Nothing deleted it when an editor simply
 * removed the roster row — and "empty the ticked dates" removes hundreds at
 * once. The place was gone, the decline was gone, and the advertisement was
 * still up: the cover list asking for help on Sundays that no longer had a
 * rota, and offering people a "Take it" that the server would then refuse.
 *
 * The trigger on the roster now takes them down as they happen (see
 * `sweepCover` and `endTradesOnFilledPlace`). This clears the ones already
 * stranded, which no future write will ever touch — their roster rows are gone,
 * so nothing will fire about them again.
 *
 * WHAT IT DELETES. A cover entry whose place is not, right now, a declined row
 * on that occurrence's roster. That is the same question `sweepCover` asks, and
 * it is asked of the live roster rather than of anything remembered.
 *
 * WHAT IT LEAVES. Anything still declined — those advertisements are true. A
 * quiet Cover has no entry here in the first place, so there is nothing of
 * theirs to get wrong.
 *
 * DRY RUN BY DEFAULT. It deletes, so deleting has to be asked for.
 *
 * Run:  node scripts/clean-stale-cover.js            # report only
 *       node scripts/clean-stale-cover.js --apply    # actually delete
 */

const admin = require('firebase-admin');
const aa = require('../functions/assignment-answer.js');

const FIREBASE_PROJECT_ID = 'mosaic-hymn-database';
const OCCURRENCES = 'event_occurrences';
const COVER = 'cover';
const BATCH_SIZE = 400;

const APPLY = process.argv.includes('--apply');

let db;

/**
 * Is this advertisement still true?
 *
 * The predicate the whole script turns on, so it takes plain data and is
 * exported to be tested rather than trusted.
 * @param {Object} entry The cover document's data.
 * @param {Array<Object>} roster Every roster row on that occurrence.
 * @return {boolean} true when the place really is still looking for somebody.
 */
function stillNeeded(entry, roster) {
    const e = entry || {};
    const row = (roster || []).find((a) => (
        a && a.roleSlug === e.roleSlug &&
        (a.slotId || null) === (e.slotId || null)
    ));
    if (!row) return false;
    return (row.state || null) === aa.STATES.DECLINED;
}

/**
 * Read every roster row on one occurrence.
 * @param {string} occurrenceId which occurrence
 * @return {Promise<?Array<Object>>} its roster, or null if the Event has gone
 */
async function rosterOf(occurrenceId) {
    const ref = db.collection(OCCURRENCES).doc(occurrenceId);
    const occ = await ref.get();
    // The Event itself is gone. Nothing on it can be looking for anybody.
    if (!occ.exists) return null;
    const snap = await ref.collection('roster').get();
    return snap.docs.map((d) => d.data());
}

/** Walk the cover list and clear what is no longer true. */
async function main() {
    admin.initializeApp({projectId: FIREBASE_PROJECT_ID});
    db = admin.firestore();

    const entries = await db.collection(COVER).get();
    console.log(`${entries.size} cover entries.`);

    const rosters = new Map();
    const stale = [];

    for (const doc of entries.docs) {
        const entry = doc.data();
        const occurrenceId = entry.occurrenceId;
        if (!occurrenceId) {
            stale.push({doc, why: 'names no occurrence'});
            continue;
        }
        if (!rosters.has(occurrenceId)) {
            rosters.set(occurrenceId, await rosterOf(occurrenceId));
        }
        const roster = rosters.get(occurrenceId);

        if (roster === null) {
            stale.push({doc, why: 'the Event has gone'});
            continue;
        }
        if (!stillNeeded(entry, roster)) {
            const row = roster.find((a) => (
                a && a.roleSlug === entry.roleSlug &&
                (a.slotId || null) === (entry.slotId || null)
            ));
            stale.push({
                doc,
                why: row ? `the place is ${row.state || 'unanswered'} now`
                    : 'the place is no longer on the roster',
            });
        }
    }

    console.log(`${stale.length} no longer true:\n`);
    stale.forEach(({doc, why}) => {
        const e = doc.data();
        console.log(`  ${e.date || '????-??-??'}  ${e.roleName || e.roleSlug}` +
            `  (${e.eventName || 'Event'}) — ${why}`);
    });

    if (!stale.length) {
        console.log('\nNothing to clear.');
        return;
    }

    if (!APPLY) {
        console.log(`\nDry run. Re-run with --apply to delete these ${stale.length}.`);
        return;
    }

    for (let i = 0; i < stale.length; i += BATCH_SIZE) {
        const batch = db.batch();
        stale.slice(i, i + BATCH_SIZE).forEach(({doc}) => batch.delete(doc.ref));
        await batch.commit();
    }
    console.log(`\nCleared ${stale.length}.`);
}

module.exports = {stillNeeded};

if (require.main === module) {
    main().then(() => process.exit(0)).catch((e) => {
        console.error(e);
        process.exit(1);
    });
}
