/**
 * @fileoverview Migration: store every Elder Document's Note Body as Blocks
 * (MS-503, ADR-0065).
 *
 * A document still holding `contentJson` is converted the first time a page or
 * the assistant opens or writes it, so nothing depends on this having run. It
 * exists so that is not the first thing an elder's click does, and so a document
 * that cannot be converted is found by a person reading a report rather than by
 * an elder meeting a read-only page.
 *
 * ⚠ A DRY RUN UNLESS TOLD OTHERWISE. With no flag it reads every document and
 * reports what it would do; `--write` does it.
 *
 * Per document:
 *   - already Blocks, or not a note (a Care List, a Form Document) → left alone
 *   - converts, and the Blocks give back exactly the same body     → converted
 *   - the round trip would change a word, or the result would be
 *     too near Firestore's 1 MiB document limit                    → left alone,
 *     named in the report
 *
 * Each write is a transaction that converts only if the document still has no
 * Blocks when it is read, so a page converting it at the same moment wins and
 * this changes nothing. Running it twice is safe: the second run finds nothing
 * to do.
 *
 * Run:  node scripts/migrate-elder-documents-to-blocks.js           (report)
 *       node scripts/migrate-elder-documents-to-blocks.js --write   (convert)
 */

const DocumentBodyCore = require('../public/document-body-core.js');

const COLLECTION = 'elder_documents';

// Firestore refuses a document over 1 MiB. Blocks add a little per block
// (type, parent, order, the field name), so leave room rather than find the
// limit by failing a write.
const MAX_BYTES = 900 * 1024;

// A rough size of a document as Firestore counts it: UTF-8 bytes of its JSON.
function approxBytes(data) {
    return Buffer.byteLength(JSON.stringify(data || {}), 'utf8');
}

// What to do with one document, from what is stored.
// Returns { action: 'skip' | 'convert' | 'refuse', reason, blocks? }.
function planFor(data) {
    const d = data || {};
    if ((d.docType || 'note') !== 'note') return { action: 'skip', reason: 'not a note (' + d.docType + ')' };
    if (DocumentBodyCore.hasBlocks(d)) return { action: 'skip', reason: 'already Blocks' };
    const converted = DocumentBodyCore.convertLegacy(d);
    if (!converted.ok) return { action: 'refuse', reason: 'the Blocks would not give back the same body' };
    const after = Object.assign({}, d, { blocks: converted.blocks });
    delete after.contentJson;
    const bytes = approxBytes(after);
    if (bytes > MAX_BYTES) {
        return { action: 'refuse', reason: 'too large as Blocks (' + Math.round(bytes / 1024) + ' KB)' };
    }
    return { action: 'convert', reason: Object.keys(converted.blocks).length + ' blocks', blocks: converted.blocks };
}

// Convert one document, only if it still has no Blocks when read.
// Returns true when this run wrote it.
async function convertOne(db, FieldValue, ref) {
    return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return false;
        const plan = planFor(snap.data());
        if (plan.action !== 'convert') return false;
        tx.update(ref, { blocks: plan.blocks, contentJson: FieldValue.delete() });
        return true;
    });
}

async function run({ db, FieldValue, write, log }) {
    const say = log || console.log;
    say(`Elder Documents to Blocks${write ? '' : ' (DRY RUN: nothing is written; pass --write)'}\n`);
    const snap = await db.collection(COLLECTION).get();
    const counts = { skip: 0, convert: 0, refuse: 0, written: 0 };
    const refused = [];
    for (const doc of snap.docs) {
        const plan = planFor(doc.data());
        counts[plan.action]++;
        if (plan.action === 'refuse') refused.push({ id: doc.id, title: doc.data().title || '', reason: plan.reason });
        if (plan.action === 'convert' && write) {
            if (await convertOne(db, FieldValue, doc.ref)) counts.written++;
        }
    }
    say(`  ${snap.size} documents`);
    say(`  ${counts.skip} left alone (already Blocks, or not a note)`);
    say(`  ${counts.convert} ${write ? 'to convert, ' + counts.written + ' written' : 'would be converted'}`);
    say(`  ${counts.refuse} cannot be converted without changing them\n`);
    refused.forEach(r => say(`  ✗ ${r.id}  "${r.title}"  ${r.reason}`));
    if (!counts.convert && !counts.refuse) say('Nothing to do.');
    return Object.assign(counts, { refused });
}

module.exports = { COLLECTION, MAX_BYTES, planFor, convertOne, run };

if (require.main === module) {
    const admin = require('firebase-admin');
    const { serviceAccount } = require('./service-account.js');
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount()),
        projectId: 'mosaic-hymn-database',
    });
    run({
        db: admin.firestore(),
        FieldValue: admin.firestore.FieldValue,
        write: process.argv.includes('--write'),
    }).then(() => process.exit(0)).catch((e) => {
        console.error(e);
        process.exit(1);
    });
}
