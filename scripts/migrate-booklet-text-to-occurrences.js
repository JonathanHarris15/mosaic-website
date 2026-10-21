/**
 * Copy Sunday booklet text onto event occurrence fill-ins.
 *
 * Reads `services/{date}.typedContent` and the week's guide, and writes any
 * key the Sunday Service occurrence has never stored onto each printable
 * that reads booklet text (`printableInputs[printableId].legacy_*`).
 * A key that is already present, including a blank, is left alone.
 *
 * Also rewrites stored `sunday_typed` wires to event fill-ins. Does not
 * delete `typedContent` or guide fields. That delete is a later script.
 *
 * Dry-run by default. Prod requires --project mosaic-hymn-database --i-mean-prod.
 *
 *   node scripts/migrate-booklet-text-to-occurrences.js \
 *       --project mosaic-hymn-database --i-mean-prod
 *   node scripts/migrate-booklet-text-to-occurrences.js \
 *       --project mosaic-hymn-database --i-mean-prod --commit
 *
 * Optional: --from YYYY-MM-DD --to YYYY-MM-DD (service document ids)
 */

const path = require('path');
const Migrate = require('../public/printable-legacy-migrate-core.js');
const Occurrence = require('../public/events-occurrence-core.js');
const {loadProject, requireProject} = require('./firebase-project.js');

const SUNDAY_SERIES = 'sunday_service';
const BATCH_LIMIT = 400;

/** @param {string[]} argv */
function committing(argv) {
    return argv.includes('--commit');
}

/** @param {string[]} argv */
function willWrite(argv) {
    return committing(argv) && argv.includes('--i-mean-prod');
}

/** @param {string[]} argv @param {string} name @return {string|null} */
function arg(argv, name) {
    const i = argv.indexOf(name);
    return i === -1 ? null : (argv[i + 1] || null);
}

/** @param {any} id @return {boolean} */
function isDateId(id) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(id || ''));
}

/** @param {any} id @param {string|null} from @param {string|null} to @return {boolean} */
function inDateRange(id, from, to) {
    if (!isDateId(id)) return false;
    if (from && id < from) return false;
    if (to && id > to) return false;
    return true;
}

/** @param {any} date @return {string} */
function occurrenceId(date) {
    return SUNDAY_SERIES + '_' + date;
}

/**
 * @param {any} service
 * @param {any} bagsByPrintable
 * @return {{ plans: Record<string, any>, wouldWrite: boolean, fieldsCopied: number, blanksLeft: number, hasBookletText: boolean }}
 */
function planServiceCopies(service, bagsByPrintable) {
    const incoming = Migrate.valuesFromTyped(Migrate.contentFromLegacyStores(service));
    /** @type {Record<string, any>} */
    const bags = bagsByPrintable && typeof bagsByPrintable === 'object' ? bagsByPrintable : {};
    /** @type {Record<string, any>} */
    const plans = {};
    let fieldsCopied = 0;
    let blanksLeft = 0;
    Object.keys(bags).forEach((printableId) => {
        const existing = bags[printableId] && typeof bags[printableId] === 'object'
            ? bags[printableId]
            : {};
        Object.keys(incoming).forEach((id) => {
            if (Object.prototype.hasOwnProperty.call(existing, id) && existing[id] === '') {
                blanksLeft += 1;
            }
        });
        const plan = Migrate.planOccurrenceFill(existing, service);
        if (!plan.wouldWrite) return;
        plans[printableId] = plan.patch;
        fieldsCopied += Object.keys(plan.patch).length;
    });
    return {
        plans: plans,
        wouldWrite: Object.keys(plans).length > 0,
        fieldsCopied: fieldsCopied,
        blanksLeft: blanksLeft,
        hasBookletText: Object.keys(incoming).length > 0,
    };
}

/**
 * @param {any} prevInputs
 * @param {any} plans
 * @return {Record<string, any>}
 */
function mergePrintableInputs(prevInputs, plans) {
    /** @type {Record<string, any>} */
    const prev = prevInputs && typeof prevInputs === 'object' ? prevInputs : {};
    /** @type {Record<string, any>} */
    const next = {};
    Object.keys(prev).forEach((id) => {
        next[id] = prev[id];
    });
    Object.keys(plans || {}).forEach((id) => {
        const prior = next[id] && typeof next[id] === 'object' ? next[id] : {};
        next[id] = Object.assign({}, prior, plans[id]);
    });
    return next;
}

/**
 * The first write of a Sunday Service date. Visibility is public when the
 * series document carries none (the series rule names that service rather
 * than a field). participantIds come from the roster already on the date,
 * so a parent created for booklet text does not hide people who are on it.
 * @param {any} date
 * @param {any} series
 * @param {any} plans
 * @param {any} [assignments]
 * @return {Record<string, any>}
 */
function newOccurrenceBody(date, series, plans, assignments) {
    const list = Array.isArray(assignments) ? assignments : [];
    const visibility = (series && series.visibility) || 'public';
    const occurrence = { assignments: list, visibility: visibility, seriesId: SUNDAY_SERIES };
    return {
        seriesId: SUNDAY_SERIES,
        date: date,
        visibility: visibility,
        rosterShared: !!(series && series.rosterShared === true),
        participantIds: Occurrence.participantIds(list),
        needsAttention: Occurrence.needsAttention(occurrence),
        outForCover: Occurrence.outForCover(occurrence),
        printableInputs: mergePrintableInputs({}, plans),
    };
}

/** @param {any} batch @param {number} count */
async function commitBatch(batch, count) {
    if (count > 0) await batch.commit();
}

async function main() {
    const argv = process.argv;
    const projectId = requireProject(argv);
    const COMMIT = willWrite(argv);
    if (committing(argv) && !COMMIT) {
        throw new Error('--commit also needs --i-mean-prod.');
    }
    const from = arg(argv, '--from');
    const to = arg(argv, '--to');

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

    const totals = {
        printablesScanned: 0,
        printablesRewritten: 0,
        bookletPrintables: 0,
        servicesScanned: 0,
        servicesWithBookletText: 0,
        occurrencesUpdated: 0,
        fieldsCopied: 0,
        blanksLeft: 0,
        typedContentDeleted: 0,
        guideFieldsDeleted: 0,
    };

    const bookletIds = [];
    const printables = await db.collection('printables').get();
    let batch = db.batch();
    let batchCount = 0;
    for (const doc of printables.docs) {
        totals.printablesScanned += 1;
        const raw = Object.assign({id: doc.id}, doc.data() || {});
        const out = Migrate.migrateProject(raw);
        const record = out.project || raw;
        if (out.changed) {
            totals.printablesRewritten += 1;
            if (COMMIT) {
                batch.set(doc.ref, {
                    pages: record.pages || [],
                    inputs: record.inputs || [],
                }, {merge: true});
                batchCount += 1;
                if (batchCount >= BATCH_LIMIT) {
                    await batch.commit();
                    batch = db.batch();
                    batchCount = 0;
                }
            }
        }
        if (Migrate.readsBookletText(record)) bookletIds.push(doc.id);
    }
    if (COMMIT) await commitBatch(batch, batchCount);
    totals.bookletPrintables = bookletIds.length;

    const seriesSnap = await db.collection('events').doc(SUNDAY_SERIES).get();
    const series = seriesSnap.exists ? (seriesSnap.data() || {}) : {};

    batch = db.batch();
    batchCount = 0;
    const services = await db.collection('services').get();
    for (const doc of services.docs) {
        if (!inDateRange(doc.id, from, to)) continue;
        totals.servicesScanned += 1;
        const data = doc.data() || {};
        const probe = planServiceCopies(data, {});
        if (!probe.hasBookletText) continue;
        totals.servicesWithBookletText += 1;
        if (!bookletIds.length) continue;

        const occRef = db.collection('event_occurrences').doc(occurrenceId(doc.id));
        const occSnap = await occRef.get();
        const exists = !!(occSnap && occSnap.exists);
        const prevInputs = exists ? ((occSnap.data() || {}).printableInputs || {}) : {};
        /** @type {Record<string, any>} */
        const bags = {};
        bookletIds.forEach((id) => {
            const bag = prevInputs[id];
            bags[id] = bag && typeof bag === 'object' ? bag : {};
        });
        const plan = planServiceCopies(data, bags);
        totals.fieldsCopied += plan.fieldsCopied;
        totals.blanksLeft += plan.blanksLeft;
        if (!plan.wouldWrite) continue;
        totals.occurrencesUpdated += 1;
        if (!COMMIT) continue;
        if (!exists) {
            const rosterSnap = await occRef.collection('roster').get();
            const assignments = rosterSnap.docs.map(/** @param {any} d */ (d) => d.data() || {});
            batch.set(occRef, newOccurrenceBody(doc.id, series, plan.plans, assignments), {merge: true});
        } else {
            batch.set(occRef, {
                printableInputs: mergePrintableInputs(prevInputs, plan.plans),
            }, {merge: true});
        }
        batchCount += 1;
        if (batchCount >= BATCH_LIMIT) {
            await batch.commit();
            batch = db.batch();
            batchCount = 0;
        }
    }
    if (COMMIT) await commitBatch(batch, batchCount);

    console.log(JSON.stringify({
        mode: COMMIT ? 'commit' : 'dry-run',
        projectId,
        from: from || null,
        to: to || null,
        totals,
    }, null, 2));
}

module.exports = {
    inDateRange,
    occurrenceId,
    planServiceCopies,
    mergePrintableInputs,
    newOccurrenceBody,
    SUNDAY_SERIES,
};

if (require.main === module) {
    main().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}
