/**
 * @fileoverview Patch the display fields of one Liturgy Order's elements —
 * `name` and `hasNote` only — with a before/after record, dry-run first.
 *
 * MS-715. The Liturgy Orders page saves a whole order; this does the same
 * write for a reviewed, written-down change, so a rename or a note toggle on
 * the live church can be proposed in a PR, dry-run, applied, and reverted
 * from the file it left behind.
 *
 * ⚠ IDS NEVER CHANGE. A Sunday keeps values at `liturgy.<elementId>` and
 * notes at `notes.<elementId>`, and a printable binds by id. A patch that
 * names an id the order does not have, or tries to set anything but `name`
 * or `hasNote`, is refused before anything is read for writing.
 *
 * Usage:
 *   # Dry run against a JSON copy of the order (no credentials needed):
 *   node scripts/patch-liturgy-order.js --patch docs/ops/ms-715-standard-order-patch.json \
 *       --order-json ./orders.json
 *   # Dry run against the live database:
 *   node scripts/patch-liturgy-order.js --project mosaic-hymn-database --i-mean-prod \
 *       --patch docs/ops/ms-715-standard-order-patch.json
 *   # Apply (writes <order>-before-<stamp>.json and -after- next to the patch):
 *   ...same... --commit
 *   # Revert: --revert <the -before- file> --commit
 */

const fs = require('fs');
const path = require('path');
const Liturgy = require('../public/liturgy-order-core.js');

const PATCHABLE = Object.freeze(['name', 'hasNote']);

/**
 * What a patch does to one stored order document.
 * @param {object} orderDoc the stored `liturgy_orders/{id}` data
 * @param {object} patch {orderId, elements: {id: {name?, hasNote?}}}
 * @return {object} {problems, changes, after}
 */
function planPatch(orderDoc, patch) {
    const problems = [];
    const changes = [];
    const elements = (orderDoc && Array.isArray(orderDoc.elements)) ? orderDoc.elements : [];
    const byId = new Map(elements.map((el) => [el.id, el]));
    const wanted = (patch && patch.elements) || {};

    Object.keys(wanted).forEach((id) => {
        if (!byId.has(id)) problems.push(`"${id}" is not an element of this order.`);
        Object.keys(wanted[id] || {}).forEach((key) => {
            if (PATCHABLE.indexOf(key) === -1) problems.push(`"${id}.${key}" cannot be patched (only ${PATCHABLE.join(', ')}).`);
        });
        if ('name' in (wanted[id] || {}) && !String(wanted[id].name || '').trim()) {
            problems.push(`"${id}" cannot be given an empty name.`);
        }
        if ('hasNote' in (wanted[id] || {}) && typeof wanted[id].hasNote !== 'boolean') {
            problems.push(`"${id}.hasNote" must be true or false.`);
        }
    });

    const after = elements.map((el) => {
        const p = wanted[el.id];
        if (!p) return Object.assign({}, el);
        const next = Object.assign({}, el);
        PATCHABLE.forEach((key) => {
            if (!(key in p)) return;
            const value = key === 'name' ? String(p.name).trim() : p[key];
            const before = key === 'hasNote' ? !!el.hasNote : el[key];
            if (before !== value) {
                changes.push({ id: el.id, field: key, before: el[key] === undefined ? null : el[key], after: value });
                next[key] = value;
            }
        });
        return next;
    });

    if (!problems.length) {
        const ids = after.map((el) => el.id);
        if (ids.join() !== elements.map((el) => el.id).join()) problems.push('The element ids or their order changed.');
        const catalog = Liturgy.catalogFrom({ orders: [Object.assign({}, orderDoc, { elements: after, elementIds: ids })] });
        Liturgy.validateCatalog(catalog).forEach((p) => problems.push(p));
    }
    return { problems, changes, after };
}

module.exports = { planPatch, PATCHABLE };

function arg(name) {
    const i = process.argv.indexOf(name);
    return i === -1 ? null : process.argv[i + 1];
}

function stamp() {
    return new Date().toISOString().replace(/[:.]/g, '-');
}

async function main() {
    const commit = process.argv.includes('--commit');
    const revertFile = arg('--revert');
    const patchFile = arg('--patch');
    if (!revertFile && !patchFile) throw new Error('Give --patch <file> or --revert <before-file>.');
    const patch = revertFile ? null : JSON.parse(fs.readFileSync(patchFile, 'utf8'));
    const reverting = revertFile ? JSON.parse(fs.readFileSync(revertFile, 'utf8')) : null;
    const orderId = (patch && patch.orderId) || (reverting && reverting.id);
    const outDir = path.dirname(path.resolve(revertFile || patchFile));

    const local = arg('--order-json');
    let db = null;
    let stored;
    if (local) {
        if (commit) throw new Error('--order-json is a dry run only.');
        const rows = JSON.parse(fs.readFileSync(local, 'utf8'));
        stored = (Array.isArray(rows) ? rows : [rows]).find((o) => o.id === orderId);
    } else {
        const projectId = require('./firebase-project').requireProject(process.argv);
        const admin = require('firebase-admin');
        admin.initializeApp({
            credential: admin.credential.cert(require(require('./service-account').serviceAccountPath())),
            projectId,
        });
        db = admin.firestore();
        const snap = await db.collection(Liturgy.COLLECTIONS.orders).doc(orderId).get();
        stored = snap.exists ? Object.assign({ id: snap.id }, snap.data()) : null;
    }
    if (!stored) throw new Error(`No stored order "${orderId}".`);

    const effective = reverting ? {
        orderId,
        elements: Object.fromEntries((reverting.elements || []).map((el) => [el.id, { name: el.name, hasNote: !!el.hasNote }])),
    } : patch;
    const plan = planPatch(stored, effective);
    if (plan.problems.length) {
        console.error('Refused:\n  ' + plan.problems.join('\n  '));
        process.exit(1);
    }
    console.log(`${commit ? 'APPLY' : 'DRY RUN'} — liturgy_orders/${orderId}: ${plan.changes.length} change(s)`);
    plan.changes.forEach((c) => console.log(`  ${c.id}.${c.field}: ${JSON.stringify(c.before)} -> ${JSON.stringify(c.after)}`));
    if (!commit || !plan.changes.length) return;

    const at = stamp();
    const before = path.join(outDir, `${orderId}-before-${at}.json`);
    fs.writeFileSync(before, JSON.stringify(stored, null, 2));
    const ref = db.collection(Liturgy.COLLECTIONS.orders).doc(orderId);
    await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const again = planPatch(Object.assign({ id: snap.id }, snap.data()), effective);
        if (again.problems.length) throw new Error(again.problems.join(' '));
        tx.update(ref, {
            elements: again.after,
            updatedAt: require('firebase-admin').firestore.FieldValue.serverTimestamp(),
        });
    });
    const afterSnap = await ref.get();
    const after = path.join(outDir, `${orderId}-after-${at}.json`);
    fs.writeFileSync(after, JSON.stringify(Object.assign({ id: afterSnap.id }, afterSnap.data()), null, 2));
    console.log(`Applied. Before: ${before}\nAfter:  ${after}\nRevert: node scripts/patch-liturgy-order.js --project ${arg('--project')} --i-mean-prod --revert ${before} --commit`);
}

if (require.main === module) {
    main().catch((e) => { console.error(e.message || e); process.exit(1); });
}
