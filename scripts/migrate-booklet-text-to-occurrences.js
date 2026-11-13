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
 * A data URL of 2,048 bytes or more is uploaded to Storage and the field
 * keeps the https URL. The dry run reports size.maxResultBytes. A document
 * that would still exceed the ceiling is listed in size.skipped and is not
 * written; the run continues with the next Sunday.
 *
 * The copy helpers live in this file. Print still reads the old stores
 * until a later change. This script does not call SundayTyped.fromService,
 * because that reader stops consulting the guide in that later change.
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

const crypto = require('crypto');
const path = require('path');
const Migrate = require('../public/printable-legacy-migrate-core.js');
const Typed = require('../public/sunday-typed-core.js');
const Occurrence = require('../public/events-occurrence-core.js');
const Size = require('./firestore-doc-size.js');
const {loadProject, requireProject} = require('./firebase-project.js');

const SUNDAY_SERIES = 'sunday_service';
const BATCH_LIMIT = 400;
// A data URL shorter than this stays inline. Country maps are far larger.
const DATA_URL_MIN_BYTES = 2048;
const OCCURRENCE_COLLECTION = 'event_occurrences';

/**
 * Dry-run unless both --commit and --i-mean-prod are present.
 * --commit alone is a mistake and throws before any read.
 * @param {string[]} argv
 * @return {{ commit: boolean }}
 */
function writeMode(argv) {
    const asked = argv.includes('--commit');
    const armed = argv.includes('--i-mean-prod');
    if (asked && !armed) throw new Error('--commit also needs --i-mean-prod.');
    return { commit: asked && armed };
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
 * Both old stores. The stored record wins a field that has text; a blank
 * there still takes the guide, which is what a week used to print.
 * @param {any} service
 * @return {any}
 */
function contentFromLegacyStores(service) {
    const s = service && typeof service === 'object' ? service : {};
    const stored = Typed.normalise(s.typedContent);
    const guide = s.guide || {};
    const values = guide.values && typeof guide.values === 'object' ? guide.values : null;
    const elements = Array.isArray(guide.elements) ? guide.elements : [];
    const hasGuide = guide.format === 'v2' || !!values || elements.length > 0;
    if (!hasGuide) return stored;
    const fallback = (guide.format === 'v2' || values)
        ? Typed.fromGuideValues(values)
        : Typed.fromLegacyGuide(guide);
    return Typed.mergePreferFilled(stored, fallback);
}

/**
 * Copy into keys the occurrence has never stored. A present key, including
 * '', stays as it is. Nothing here deletes the old service fields.
 * @param {any} existingBag
 * @param {any} service
 * @return {{ patch: Record<string, any>, bag: Record<string, any>, wouldWrite: boolean }}
 */
function planOccurrenceFill(existingBag, service) {
    /** @type {Record<string, any>} */
    const incoming = Migrate.valuesFromTyped(contentFromLegacyStores(service));
    /** @type {Record<string, any>} */
    const base = existingBag && typeof existingBag === 'object' ? Object.assign({}, existingBag) : {};
    /** @type {Record<string, any>} */
    const patch = {};
    Object.keys(incoming).forEach((id) => {
        if (Object.prototype.hasOwnProperty.call(base, id)) return;
        patch[id] = incoming[id];
        base[id] = incoming[id];
    });
    return { patch: patch, bag: base, wouldWrite: Object.keys(patch).length > 0 };
}

/** @param {any[]|undefined} nodes @param {(node: any) => void} fn */
function walkNodes(nodes, fn) {
    (nodes || []).forEach((node) => {
        if (!node) return;
        fn(node);
        walkNodes(node.children, fn);
    });
}

/**
 * A printable that shows booklet text: a legacy fill-in, a joined
 * announcements or kids-questions repeat, or a wire to those fields.
 * @param {any} project
 * @return {boolean}
 */
function readsBookletText(project) {
    /** @type {any[]} */
    const inputs = (project && project.inputs) || [];
    if (inputs.some((input) => input && Migrate.isLegacyFillId(input.id))) return true;
    let found = false;
    /** @type {any[]} */
    const pages = (project && project.pages) || [];
    pages.forEach((page) => {
        walkNodes(page && page.nodes, (node) => {
            if (!node || found) return;
            const repeat = node.repeat && node.repeat.source;
            if (repeat === 'sunday_announcements' || repeat === 'sunday_kids_questions') found = true;
            if (!node.bind) return;
            ['text', 'src'].forEach((prop) => {
                const bind = node.bind[prop];
                if (!bind) return;
                if (bind.source === 'event_field' && Migrate.isLegacyFillId(bind.field)) found = true;
            });
        });
    });
    return found;
}

/**
 * @param {any} service
 * @param {any} bagsByPrintable
 * @return {{ plans: Record<string, any>, wouldWrite: boolean, fieldsCopied: number, blanksLeft: number, hasBookletText: boolean }}
 */
function planServiceCopies(service, bagsByPrintable) {
    const incoming = Migrate.valuesFromTyped(contentFromLegacyStores(service));
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
        const plan = planOccurrenceFill(existing, service);
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

/** @param {string} contentType @return {string} */
function extensionFor(contentType) {
    const type = String(contentType || '').split(';')[0].trim().toLowerCase();
    if (type === 'image/jpeg' || type === 'image/jpg') return 'jpg';
    if (type === 'image/png') return 'png';
    if (type === 'image/gif') return 'gif';
    if (type === 'image/webp') return 'webp';
    if (type === 'image/svg+xml') return 'svg';
    return 'img';
}

/**
 * @param {string} value
 * @return {{ contentType: string, buffer: Buffer }|null}
 */
function decodeDataUrl(value) {
    if (typeof value !== 'string' || !value.startsWith('data:')) return null;
    const comma = value.indexOf(',');
    if (comma < 0) return null;
    const header = value.slice(5, comma);
    const payload = value.slice(comma + 1);
    const contentType = (header.split(';')[0] || 'application/octet-stream').trim() || 'application/octet-stream';
    const base64 = /;base64/i.test(header);
    try {
        const buffer = base64
            ? Buffer.from(payload, 'base64')
            : Buffer.from(decodeURIComponent(payload), 'utf8');
        return { contentType, buffer };
    } catch (e) {
        return null;
    }
}

/**
 * Upload one offloaded country map and set its download token.
 * @param {{ save: Function, setMetadata: Function }} file
 * @param {{ buffer: Buffer, contentType: string, token: string }} upload
 * @return {Promise<void>}
 */
async function saveOffloadedImage(file, upload) {
    await file.save(upload.buffer, {contentType: upload.contentType});
    await file.setMetadata({
        metadata: {firebaseStorageDownloadTokens: upload.token},
    });
}

/** @param {string} bucket @param {string} objectPath @param {string} token @return {string} */
function storageDownloadUrl(bucket, objectPath, token) {
    return 'https://firebasestorage.googleapis.com/v0/b/' + bucket
        + '/o/' + encodeURIComponent(objectPath)
        + '?alt=media&token=' + token;
}

/**
 * Replace large data URLs with one Storage URL each. The same bytes keep
 * one object, so two printables do not store the image twice.
 * @param {any} value
 * @param {{ date: string, bucket: string }} options
 * @return {{ value: any, uploads: Array<{ path: string, buffer: Buffer, contentType: string, token: string, url: string }>, count: number, bytes: number }}
 */
function offloadDataUrls(value, options) {
    const date = options && options.date ? options.date : 'undated';
    const bucket = options && options.bucket ? options.bucket : 'bucket';
    /** @type {Map<string, { path: string, buffer: Buffer, contentType: string, token: string, url: string }>} */
    const byUrl = new Map();
    let count = 0;
    let bytes = 0;

    /** @param {any} node @return {any} */
    function walk(node) {
        if (typeof node === 'string') {
            if (!node.startsWith('data:') || Buffer.byteLength(node, 'utf8') < DATA_URL_MIN_BYTES) return node;
            const decoded = decodeDataUrl(node);
            if (!decoded) return node;
            let planned = byUrl.get(node);
            if (!planned) {
                const hash = crypto.createHash('sha256').update(node).digest('hex');
                const objectPath = 'sunday_typed/' + date + '/country_map/booklet_' + hash.slice(0, 16) + '.' + extensionFor(decoded.contentType);
                const token = hash.slice(16, 48);
                const url = storageDownloadUrl(bucket, objectPath, token);
                planned = {
                    path: objectPath,
                    buffer: decoded.buffer,
                    contentType: decoded.contentType,
                    token,
                    url,
                };
                byUrl.set(node, planned);
            }
            count += 1;
            bytes += Buffer.byteLength(node, 'utf8');
            return planned.url;
        }
        if (Array.isArray(node)) return node.map(walk);
        if (!node || typeof node !== 'object') return node;
        if (node instanceof Date) return node;
        /** @type {Record<string, any>} */
        const out = {};
        Object.keys(node).forEach(key => { out[key] = walk(node[key]); });
        return out;
    }

    return {
        value: walk(value),
        uploads: Array.from(byUrl.values()),
        count,
        bytes,
    };
}

/**
 * The strings that dominate a document, paths and sizes only.
 * @param {any} value
 * @param {number} [limit]
 * @return {Array<{ path: string, bytes: number, dataUrl: boolean }>}
 */
function largestStrings(value, limit) {
    /** @type {Array<{ path: string, bytes: number, dataUrl: boolean }>} */
    const found = [];
    /** @param {any} node @param {string} path */
    function walk(node, path) {
        if (typeof node === 'string') {
            found.push({
                path: path,
                bytes: Buffer.byteLength(node, 'utf8'),
                dataUrl: node.startsWith('data:'),
            });
            return;
        }
        if (Array.isArray(node)) {
            node.forEach((item, i) => walk(item, path + '[' + i + ']'));
            return;
        }
        if (!node || typeof node !== 'object' || node instanceof Date) return;
        if (typeof node.toDate === 'function' || typeof node.path === 'string' && node.firestore) return;
        Object.keys(node).forEach(key => walk(node[key], path ? path + '.' + key : key));
    }
    walk(value, '');
    found.sort((a, b) => b.bytes - a.bytes);
    return found.slice(0, limit || 5);
}

/**
 * @param {any} existing Firestore data, or null when the occurrence is absent
 * @param {any} plans
 * @param {{ occurrenceId: string, date: string, bucket: string, series?: any, assignments?: any[] }} options
 * @return {{
 *   occurrenceId: string,
 *   currentBytes: number,
 *   beforeOffloadBytes: number,
 *   resultBytes: number,
 *   overLimit: boolean,
 *   imagesOffloaded: number,
 *   inlineImageBytes: number,
 *   uploads: any[],
 *   body: Record<string, any>,
 *   largestBefore: Array<{ path: string, bytes: number, dataUrl: boolean }>,
 *   largestAfter: Array<{ path: string, bytes: number, dataUrl: boolean }>,
 * }}
 */
function prepareOccurrenceWrite(existing, plans, options) {
    const id = options.occurrenceId;
    const pathSegments = [OCCURRENCE_COLLECTION, id];
    const exists = !!(existing && typeof existing === 'object');
    const prevInputs = exists && existing.printableInputs && typeof existing.printableInputs === 'object'
        ? existing.printableInputs
        : {};
    const merged = mergePrintableInputs(prevInputs, plans);
    const beforeDoc = exists
        ? Object.assign({}, existing, { printableInputs: merged })
        : newOccurrenceBody(options.date, options.series, plans, options.assignments);
    const offloaded = offloadDataUrls(beforeDoc.printableInputs, {
        date: options.date,
        bucket: options.bucket,
    });
    const afterDoc = Object.assign({}, beforeDoc, { printableInputs: offloaded.value });
    const currentBytes = exists ? Size.documentSize(pathSegments, existing) : 0;
    const beforeOffloadBytes = Size.documentSize(pathSegments, beforeDoc);
    const resultBytes = Size.documentSize(pathSegments, afterDoc);
    const body = exists
        ? { printableInputs: offloaded.value }
        : afterDoc;
    return {
        occurrenceId: id,
        currentBytes,
        beforeOffloadBytes,
        resultBytes,
        overLimit: resultBytes > Size.WRITE_CEILING_BYTES,
        imagesOffloaded: offloaded.count,
        inlineImageBytes: offloaded.bytes,
        uploads: offloaded.uploads,
        body,
        largestBefore: largestStrings(beforeDoc, 5),
        largestAfter: largestStrings(afterDoc, 5),
    };
}

/**
 * Skip a document that is over the ceiling, or that the server rejected
 * for size. Any other error is thrown.
 * @param {{ overLimit?: boolean }} prep
 * @param {any} [err]
 * @return {'write'|'skip'|'throw'}
 */
function writeOutcome(prep, err) {
    if (prep && prep.overLimit) return 'skip';
    if (err) return isSizeError(err) ? 'skip' : 'throw';
    return 'write';
}

/**
 * Rewrite a stored printable and say whether it reads booklet text.
 * The patch is what a commit writes. Discarding migrateProject would
 * leave the sunday_typed wire in that patch.
 * @param {any} raw
 * @return {{ changed: boolean, record: any, readsBooklet: boolean, patch: { pages: any[], inputs: any[] }|null }}
 */
function printableMigration(raw) {
    const out = Migrate.migrateProject(raw);
    const record = out.project || raw;
    const changed = !!out.changed;
    return {
        changed: changed,
        record: record,
        readsBooklet: readsBookletText(record),
        patch: changed ? { pages: record.pages || [], inputs: record.inputs || [] } : null,
    };
}

/**
 * A new occurrence takes its roster from the subcollection. An existing
 * document, and a dry run, do not.
 * @param {any} occRef
 * @param {boolean} exists
 * @param {boolean} commit
 * @return {Promise<any[]>}
 */
async function rosterAssignments(occRef, exists, commit) {
    if (!commit || exists) return [];
    const rosterSnap = await occRef.collection('roster').get();
    return rosterSnap.docs.map(/** @param {any} d */ (d) => d.data() || {});
}

/**
 * Write one occurrence. A server size rejection is a skip. Anything else throws.
 * @param {any} occRef
 * @param {any} prep
 * @return {Promise<'wrote'|'skipped'>}
 */
async function commitOccurrence(occRef, prep) {
    try {
        await occRef.set(prep.body, { merge: true });
        return 'wrote';
    } catch (err) {
        if (writeOutcome(prep, err) === 'throw') throw err;
        return 'skipped';
    }
}

/** @param {any} err @return {boolean} */
function isSizeError(err) {
    const message = err && (err.details || err.message) ? String(err.details || err.message) : '';
    return message.includes('exceeds the maximum allowed size');
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

/** @return {Record<string, any>} */
function emptySizeReport() {
    return {
        limitBytes: Size.LIMIT_BYTES,
        ceilingBytes: Size.WRITE_CEILING_BYTES,
        maxResultBytes: 0,
        maxResultOccurrenceId: null,
        maxBeforeOffloadBytes: 0,
        maxBeforeOffloadOccurrenceId: null,
        largestBeforeOffload: [],
        occurrencesSkipped: 0,
        imagesOffloaded: 0,
        inlineImageBytes: 0,
        storageObjects: 0,
        skipped: [],
    };
}

/**
 * Fold one prepared write into the dry-run size report. The maximum
 * resulting size is the larger result, not the zero the report starts at.
 * @param {Record<string, any>} report
 * @param {{ occurrenceId: string, beforeOffloadBytes: number, resultBytes: number, largestBefore: any[] }} prep
 * @return {Record<string, any>}
 */
function notePreparedSize(report, prep) {
    if (prep.beforeOffloadBytes > report.maxBeforeOffloadBytes) {
        report.maxBeforeOffloadBytes = prep.beforeOffloadBytes;
        report.maxBeforeOffloadOccurrenceId = prep.occurrenceId;
        report.largestBeforeOffload = prep.largestBefore;
    }
    if (prep.resultBytes > report.maxResultBytes) {
        report.maxResultBytes = prep.resultBytes;
        report.maxResultOccurrenceId = prep.occurrenceId;
    }
    return report;
}

/** @param {any} batch @param {number} count */
async function commitBatch(batch, count) {
    if (count > 0) await batch.commit();
}

async function main() {
    const argv = process.argv;
    const projectId = requireProject(argv);
    const COMMIT = writeMode(argv).commit;
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
        fieldsSkipped: 0,
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
        const migrated = printableMigration(raw);
        const record = migrated.record;
        if (migrated.changed && migrated.patch) {
            totals.printablesRewritten += 1;
            if (COMMIT) {
                batch.set(doc.ref, migrated.patch, {merge: true});
                batchCount += 1;
                if (batchCount >= BATCH_LIMIT) {
                    await batch.commit();
                    batch = db.batch();
                    batchCount = 0;
                }
            }
        }
        if (readsBookletText(record)) bookletIds.push(doc.id);
    }
    if (COMMIT) await commitBatch(batch, batchCount);
    totals.bookletPrintables = bookletIds.length;

    const seriesSnap = await db.collection('events').doc(SUNDAY_SERIES).get();
    const series = seriesSnap.exists ? (seriesSnap.data() || {}) : {};

    const services = await db.collection('services').get();
    const bucketName = project.storageBucket || (projectId + '.firebasestorage.app');
    const bucket = COMMIT ? admin.storage().bucket() : null;
    const sizeReport = emptySizeReport();
    for (const doc of services.docs) {
        if (!inDateRange(doc.id, from, to)) continue;
        totals.servicesScanned += 1;
        const data = doc.data() || {};
        const probe = planServiceCopies(data, {});
        if (!probe.hasBookletText) continue;
        totals.servicesWithBookletText += 1;
        if (!bookletIds.length) continue;

        const occId = occurrenceId(doc.id);
        const occRef = db.collection(OCCURRENCE_COLLECTION).doc(occId);
        const occSnap = await occRef.get();
        const exists = !!(occSnap && occSnap.exists);
        const existing = exists ? (occSnap.data() || {}) : null;
        const prevInputs = existing && existing.printableInputs ? existing.printableInputs : {};
        /** @type {Record<string, any>} */
        const bags = {};
        bookletIds.forEach((id) => {
            const bag = prevInputs[id];
            bags[id] = bag && typeof bag === 'object' ? bag : {};
        });
        const plan = planServiceCopies(data, bags);
        totals.blanksLeft += plan.blanksLeft;
        if (!plan.wouldWrite) continue;

        const assignments = await rosterAssignments(occRef, exists, COMMIT);
        const prep = prepareOccurrenceWrite(existing, plan.plans, {
            occurrenceId: occId,
            date: doc.id,
            bucket: bucketName,
            series,
            assignments,
        });
        notePreparedSize(sizeReport, prep);
        if (writeOutcome(prep) === 'skip') {
            totals.fieldsSkipped += plan.fieldsCopied;
            sizeReport.occurrencesSkipped += 1;
            sizeReport.skipped.push({
                id: occId,
                currentBytes: prep.currentBytes,
                beforeOffloadBytes: prep.beforeOffloadBytes,
                resultBytes: prep.resultBytes,
                largest: prep.largestAfter,
            });
            continue;
        }
        if (COMMIT) {
            if (bucket && prep.uploads.length) {
                for (const upload of prep.uploads) {
                    await saveOffloadedImage(bucket.file(upload.path), upload);
                }
            }
            if ((await commitOccurrence(occRef, prep)) === 'skipped') {
                totals.fieldsSkipped += plan.fieldsCopied;
                sizeReport.occurrencesSkipped += 1;
                sizeReport.skipped.push({
                    id: occId,
                    currentBytes: prep.currentBytes,
                    beforeOffloadBytes: prep.beforeOffloadBytes,
                    resultBytes: prep.resultBytes,
                    largest: prep.largestAfter,
                    serverRejected: true,
                });
                continue;
            }
        }
        totals.fieldsCopied += plan.fieldsCopied;
        totals.occurrencesUpdated += 1;
        sizeReport.imagesOffloaded += prep.imagesOffloaded;
        sizeReport.inlineImageBytes += prep.inlineImageBytes;
        sizeReport.storageObjects += prep.uploads.length;
    }

    console.log(JSON.stringify({
        mode: COMMIT ? 'commit' : 'dry-run',
        projectId,
        from: from || null,
        to: to || null,
        totals,
        size: sizeReport,
    }, null, 2));
}

module.exports = {
    inDateRange,
    occurrenceId,
    planServiceCopies,
    readsBookletText,
    mergePrintableInputs,
    newOccurrenceBody,
    prepareOccurrenceWrite,
    printableMigration,
    rosterAssignments,
    commitOccurrence,
    saveOffloadedImage,
    emptySizeReport,
    notePreparedSize,
    writeMode,
    writeOutcome,
    isSizeError,
    DATA_URL_MIN_BYTES,
    WRITE_CEILING_BYTES: Size.WRITE_CEILING_BYTES,
    LIMIT_BYTES: Size.LIMIT_BYTES,
};

if (require.main === module) {
    main().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}
