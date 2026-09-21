/**
 * @fileoverview Repair pastoral-prayer history from Service slots.
 *
 * The history doc is the record. A subject named on a Service with no history
 * doc for that Sunday is the hole the picker shows as "Never prayed for."
 * This walks Services, plans those missing docs (the doc id is the Sunday),
 * and rebuilds each Person's cached last-prayed date from the history those
 * docs complete. A Sunday still ahead is included: being booked is already a
 * commitment.
 *
 * Dry-run is the default and writes nothing. `--apply` writes. The church
 * project also needs `--i-mean-prod`, the same refusal as the other scripts.
 *
 *   node scripts/repair-pastoral-prayer-history.js --project mosaic-hymn-database --i-mean-prod
 *   node scripts/repair-pastoral-prayer-history.js --project mosaic-hymn-database --i-mean-prod --apply
 */

const Core = require('../public/pastoral-prayer-core.js');

function slot(value) {
    if (!value || typeof value !== 'object') return { id: null, name: '' };
    const id = (typeof value.id === 'string' && value.id) ? value.id : null;
    return { id: id, name: value.name || '' };
}

// A Service document as the repair reads it. The doc id is the Sunday. A slot
// saved under the old dotted field name still counts.
function serviceFromDoc(id, data) {
    const raw = data || {};
    const liturgy = (raw.liturgy && typeof raw.liturgy === 'object')
        ? Object.assign({}, raw.liturgy) : {};
    ['prayerMale', 'prayerFemale'].forEach(field => {
        if (!liturgy[field] && raw['liturgy.' + field]) liturgy[field] = raw['liturgy.' + field];
    });
    const male = slot(liturgy.prayerMale);
    const female = slot(liturgy.prayerFemale);
    return {
        date: id,
        prayerMaleId: male.id,
        prayerMaleName: male.name,
        prayerFemaleId: female.id,
        prayerFemaleName: female.name,
    };
}

function historyByPersonFromDocs(docs) {
    const byPerson = {};
    (docs || []).forEach(doc => {
        const date = Core.normalizeDate(doc.serviceDate || doc.id);
        if (!doc.personId || !date) return;
        (byPerson[doc.personId] = byPerson[doc.personId] || []).push(date);
    });
    return byPerson;
}

function wantsApply(argv) {
    return (argv || []).includes('--apply');
}

function formatPlan(plan) {
    return (plan.adds || []).map(add => {
        const cache = (plan.caches || []).find(row => row.personId === add.personId);
        const cached = cache ? JSON.stringify(cache.lastPastoralPrayerDate) : 'unchanged';
        return `${add.name || add.personId} (${add.personId}) ${add.serviceDate} cache ${cached}`;
    });
}

// Writes the planned creates and cached dates. Callers pass an explicit apply.
async function applyPlan(db, plan, serverTimestamp) {
    const batchSize = 400;
    const ops = [];
    (plan.adds || []).forEach(add => {
        ops.push({
            kind: 'set',
            ref: db.collection('people').doc(add.personId)
                .collection(Core.HISTORY_COLLECTION)
                .doc(Core.historyDocId(add.serviceDate)),
            data: Object.assign(Core.historyRecord(add.serviceDate), {
                createdAt: serverTimestamp(),
            }),
        });
    });
    (plan.caches || []).forEach(cache => {
        ops.push({
            kind: 'update',
            ref: db.collection('people').doc(cache.personId),
            data: { lastPastoralPrayerDate: cache.lastPastoralPrayerDate },
        });
    });
    for (let i = 0; i < ops.length; i += batchSize) {
        const batch = db.batch();
        ops.slice(i, i + batchSize).forEach(op => {
            if (op.kind === 'set') batch.set(op.ref, op.data);
            else batch.update(op.ref, op.data);
        });
        await batch.commit();
    }
}

// `write` is only called when apply is true. Dry-run returns the plan.
async function repairFromSnapshots(services, historyDocs, options) {
    const apply = !!(options && options.apply);
    const plan = Core.planPastoralPrayerRepair(
        services, historyByPersonFromDocs(historyDocs));
    if (!apply) return { wrote: false, plan: plan };
    await options.write(plan);
    return { wrote: true, plan: plan };
}

module.exports = {
    serviceFromDoc,
    historyByPersonFromDocs,
    wantsApply,
    formatPlan,
    applyPlan,
    repairFromSnapshots,
};

if (require.main === module) {
    const admin = require('firebase-admin');
    const {requireProject} = require('./firebase-project');
    const {serviceAccount} = require('./service-account');

    const projectId = requireProject(process.argv);
    const apply = wantsApply(process.argv);

    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount()),
        projectId: projectId,
    });
    const db = admin.firestore();

    (async () => {
        const svcSnap = await db.collection('services').get();
        const services = [];
        svcSnap.forEach(doc => services.push(serviceFromDoc(doc.id, doc.data())));

        const histSnap = await db.collectionGroup(Core.HISTORY_COLLECTION).get();
        const historyDocs = [];
        histSnap.forEach(doc => {
            historyDocs.push({
                personId: doc.ref.parent.parent.id,
                id: doc.id,
                serviceDate: doc.data().serviceDate,
            });
        });

        const plan = Core.planPastoralPrayerRepair(
            services, historyByPersonFromDocs(historyDocs));
        console.log(`${plan.adds.length} missing pastoral-prayer history row(s) on ${projectId}.`);
        formatPlan(plan).forEach(line => console.log('  ' + line));

        if (!apply) {
            console.log('Dry run — nothing written. Pass --apply to write.');
            process.exit(0);
        }

        await applyPlan(db, plan, () => admin.firestore.FieldValue.serverTimestamp());
        console.log('Applied.');
        process.exit(0);
    })().catch(err => {
        console.error(err);
        process.exit(1);
    });
}
