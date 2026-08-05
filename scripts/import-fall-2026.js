/**
 * @fileoverview Import the Fall 2026 Master Plan into the Calendar.
 *
 * The plan itself is data, in `fall-2026-plan.js`. This is only the writing of
 * it — read that file to check the church's plan, and this one to check the
 * import.
 *
 * ── Safe to run twice ───────────────────────────────────────────────────────
 *
 * Every document is written under an id chosen by hand, so a second run
 * overwrites rather than duplicates. It is a reconcile, in the same spirit as
 * `seed-events.js` — but a blunter one: it OWNS these documents and restates
 * them in full, because the import is the source of truth for them until
 * somebody edits one in the app.
 *
 * That is worth saying plainly: **re-running this discards edits made in the app
 * to the documents it owns.** It is an import, not a merge. Run it once, then
 * edit in the app.
 *
 * ── What it checks before it writes ─────────────────────────────────────────
 *
 * Every recurrence rule is expanded and compared against the dates the workbook
 * actually shows. A wrong weekday, or a monthly rule anchored to the wrong week
 * of the month, produces a plausible calendar that is silently wrong — and
 * nobody finds out until they open November. So a mismatch stops the run.
 *
 * Run:  node scripts/import-fall-2026.js [--dry-run]
 */

const admin = require('firebase-admin');
const Core = require('../public/events-occurrence-core.js');
const { SERIES, EXPECTED, ONE_OFFS } = require('./fall-2026-plan.js');

const FIREBASE_PROJECT_ID = 'mosaic-hymn-database';
const SERIES_COLLECTION = 'events';
const OCCURRENCES_COLLECTION = 'event_occurrences';

const DRY_RUN = process.argv.includes('--dry-run');

// ── Checking the plan before touching the database ───────────────────────────

// Every rule expanded over the whole window the plan covers, so a rule that
// produces the right FIRST few dates and then drifts is still caught.
const WINDOW = { from: '2026-08-01', to: '2027-01-31' };

function checkSeries(problems) {
    SERIES.forEach(series => {
        const produced = Core.datesBetween(series.recurrence, WINDOW.from, WINDOW.to);
        const expected = EXPECTED[series.id] || [];

        const missing = expected.filter(d => produced.indexOf(d) === -1);
        const extra = produced.filter(d => expected.indexOf(d) === -1);

        if (missing.length) {
            problems.push(`${series.id}: the rule does not produce ${missing.join(', ')}`);
        }
        if (extra.length) {
            problems.push(`${series.id}: the rule also produces ${extra.join(', ')}, which the workbook does not show`);
        }

        // A skip has to land on a date the pattern actually produces, or it is a
        // document saying "not happening" about a day nothing was happening on.
        (series.skip || []).forEach(s => {
            if (produced.indexOf(s.date) === -1) {
                problems.push(`${series.id}: skipping ${s.date}, which the rule never produces`);
            }
        });

        if (Core.VISIBILITY_ORDER.indexOf(series.visibility) === -1) {
            problems.push(`${series.id}: unknown visibility "${series.visibility}"`);
        }
    });
}

function checkOneOffs(problems) {
    const seen = new Set();

    ONE_OFFS.forEach(o => {
        if (seen.has(o.id)) problems.push(`${o.id}: used twice`);
        seen.add(o.id);

        // ⚠ The one that would fail quietly. An id ending in `_YYYY-MM-DD` is
        // read by `parseOccurrenceId` as one date of a series, which would deny
        // this one-off its own date and its own span.
        if (Core.parseOccurrenceId(o.id)) {
            problems.push(`${o.id}: reads as one date of a series — a one-off id must not end in _YYYY-MM-DD`);
        }

        const spanFault = Core.spanError(o);
        if (spanFault) problems.push(`${o.id}: ${spanFault}`);

        if (Core.VISIBILITY_ORDER.indexOf(o.visibility) === -1) {
            problems.push(`${o.id}: unknown visibility "${o.visibility}"`);
        }
    });
}

// ── Building the writes ──────────────────────────────────────────────────────

function seriesDocument(series) {
    return {
        name: series.name,
        locked: false,
        // Roles are not imported. Which Roles an Event carries is the Roles
        // Manager's business, and inventing a roster here would put made-up data
        // in front of the user on first open — the same reason `seed-events.js`
        // seeds no Servant Roles.
        roleSlugs: [],
        lockedRoleSlugs: [],
        recurrence: Object.assign({ time: null }, series.recurrence),
        location: series.location || null,
        description: series.description || null,
        visibility: series.visibility,
        rosterShared: false,
        colour: series.colour,
    };
}

// A date of a series that is not happening. It has to carry the series'
// visibility like any other occurrence — a document with no visibility is
// refused to everyone by the security rule and dropped by every list query, so
// the skip would land in the database and then vanish.
function skipDocument(series, skip) {
    const id = Core.occurrenceId(series.id, skip.date);
    return {
        id: id,
        data: {
            id: id,
            seriesId: series.id,
            date: skip.date,
            cancelled: true,
            description: skip.why || null,
            visibility: series.visibility,
            rosterShared: false,
            participantIds: [],
            needsAttention: false,
        },
    };
}

function oneOffDocument(o) {
    return {
        id: o.id,
        data: {
            id: o.id,
            seriesId: null,
            date: o.date,
            endDate: o.endDate || null,
            name: o.name,
            time: o.time || null,
            location: o.location || null,
            description: o.description || null,
            visibility: o.visibility,
            rosterShared: false,
            colour: o.colour || null,
            participantIds: [],
            needsAttention: false,
        },
    };
}

// ── Running it ───────────────────────────────────────────────────────────────

function summarise() {
    const skips = SERIES.reduce((n, s) => n + (s.skip || []).length, 0);
    const runs = ONE_OFFS.filter(o => Core.isMultiDay(o));
    const days = runs.reduce((n, o) => n + Core.spanLength(o), 0);

    console.log(`  ${SERIES.length} recurring events`);
    SERIES.forEach(s => {
        const dates = Core.datesBetween(s.recurrence, WINDOW.from, WINDOW.to);
        const held = dates.length - (s.skip || []).length;
        console.log(
            `    ${s.name} — ${dates.length} dates, ${held} held` +
            ((s.skip || []).length ? `, ${s.skip.length} skipped` : '')
        );
    });
    console.log(`  ${skips} skipped dates`);
    console.log(`  ${ONE_OFFS.length} one-off events`);
    console.log(`    of which ${runs.length} run over several days, ${days} days in total:`);
    runs.forEach(o => console.log(`      ${o.name} — ${o.date} to ${o.endDate} (${Core.spanLength(o)} days)`));
}

async function run() {
    console.log('Fall 2026 Master Plan → Calendar' + (DRY_RUN ? ' (dry run)' : ''));
    console.log('');

    const problems = [];
    checkSeries(problems);
    checkOneOffs(problems);

    if (problems.length) {
        console.error('The plan does not check out, so nothing was written:');
        problems.forEach(p => console.error('  ✖ ' + p));
        process.exit(1);
    }
    console.log('Every rule produces exactly the dates the workbook shows.');
    console.log('');
    summarise();
    console.log('');

    if (DRY_RUN) {
        console.log('Dry run: no writes made.');
        return;
    }

    const { serviceAccount } = require('./service-account.js');
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount()),
        projectId: FIREBASE_PROJECT_ID,
    });
    const db = admin.firestore();

    // Series first. A skipped date carries its series' visibility, so writing it
    // before the series it belongs to would leave a window where the skip is
    // readable and the Event itself is not.
    let batch = db.batch();
    let queued = 0;
    const flush = async (force) => {
        // Firestore caps a batch at 500. 450 leaves room, the same margin the
        // rest of the codebase commits in.
        if (!queued || (!force && queued < 450)) return;
        await batch.commit();
        batch = db.batch();
        queued = 0;
    };

    for (const series of SERIES) {
        batch.set(db.collection(SERIES_COLLECTION).doc(series.id), seriesDocument(series));
        queued++;
        await flush(false);
    }
    for (const series of SERIES) {
        for (const skip of (series.skip || [])) {
            const doc = skipDocument(series, skip);
            batch.set(db.collection(OCCURRENCES_COLLECTION).doc(doc.id), doc.data);
            queued++;
            await flush(false);
        }
    }
    for (const o of ONE_OFFS) {
        const doc = oneOffDocument(o);
        batch.set(db.collection(OCCURRENCES_COLLECTION).doc(doc.id), doc.data);
        queued++;
        await flush(false);
    }
    await flush(true);

    console.log('Import complete.');
}

run()
    .then(() => process.exit(0))
    .catch(err => {
        console.error(err);
        process.exit(1);
    });
