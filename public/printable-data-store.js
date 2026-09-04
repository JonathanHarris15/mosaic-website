// Printable Data Store — fetching what a Printable's sources need, as the
// person looking at it (MS-396, MS-399).
//
// The catalog (printable-data-core.js) says what a source NEEDS — the
// directory, this Sunday's record, the events in a window — and this module
// goes and gets it, through the same doors the rest of the site uses:
//
//   • Events come through EventsStore.loadCalendar, so a member sees the
//     dates a member may see and an editor sees the rosters an editor may
//     see. Nothing here widens a query the calendar would refuse.
//   • Sundays are world-readable and are read by date.
//   • Forms and their answers are read only for an editor; the rules refuse
//     anyone below, and this module does not ask.
//
// It returns a plain **bundle** of records for the resolvers, which are pure.
// Everything that decides is in the core; everything that fetches is here.
// Browser-only (it needs firebase.firestore.FieldPath for the Sunday range).

(function (global) {
    'use strict';

    const Data = global.PrintableDataCore;

    function docsOf(snap) {
        return snap.docs.map(d => Object.assign({ id: d.id }, d.data()));
    }

    // Two needs merged: the union of collections, the widest window.
    function mergeNeeds(a, b) {
        const out = Object.assign({}, a);
        Object.keys(b || {}).forEach(k => {
            const v = b[k];
            if (k === 'services') out.services = Array.from(new Set((out.services || []).concat(v)));
            else if (k === 'serviceRange' || k === 'occurrenceRange') {
                const cur = out[k];
                out[k] = cur ? { from: cur.from < v.from ? cur.from : v.from, to: cur.to > v.to ? cur.to : v.to } : v;
            } else if (k === 'responses' || k === 'rosters') {
                const cur = out[k];
                out[k] = (cur === true || v === true) ? true : Array.from(new Set([].concat(cur || [], v)));
            } else out[k] = out[k] || v;
        });
        return out;
    }

    async function safely(promise, fallback) {
        try { return await promise; } catch (e) { console.warn('Printable data read failed', e); return fallback; }
    }

    // `viewer` is { level, personId }. Every read below is one the viewer
    // may make; a read the rules refuse degrades to an empty set and the
    // resolvers say so, rather than the page failing.
    async function fetch(db, needs, viewer) {
        const n = needs || {};
        const v = viewer || {};
        const isEditor = ['editor', 'admin', 'elder', 'super_admin'].includes(v.level);
        const bundle = { people: [], families: [], households: [], services: {}, hymns: {}, series: [], occurrences: [], roles: [], forms: [], responses: [] };
        const jobs = [];

        if (n.people) jobs.push(safely(db.collection('people').get().then(docsOf), []).then(r => { bundle.people = r; }));
        if (n.families) jobs.push(safely(db.collection('families').get().then(docsOf), []).then(r => { bundle.families = r; }));
        if (n.households) jobs.push(safely(db.collection('households').get().then(docsOf), []).then(r => { bundle.households = r; }));

        const serviceDates = (n.services || []).slice();
        jobs.push((async () => {
            const gets = serviceDates.map(async date => {
                const doc = await safely(db.collection('services').doc(date).get(), null);
                if (doc && doc.exists) bundle.services[date] = doc.data();
            });
            await Promise.all(gets);
            if (n.serviceRange) {
                const FP = global.firebase && global.firebase.firestore && global.firebase.firestore.FieldPath;
                if (FP) {
                    const snap = await safely(db.collection('services')
                        .where(FP.documentId(), '>=', n.serviceRange.from)
                        .where(FP.documentId(), '<=', n.serviceRange.to).get(), null);
                    if (snap) snap.docs.forEach(d => { bundle.services[d.id] = d.data(); });
                }
            }
            if (n.hymns) {
                const ids = new Set();
                Object.keys(bundle.services).forEach(date => {
                    const s = Data.normaliseService(bundle.services[date]);
                    Data.HYMN_SLOTS.forEach(slot => { const h = (s.liturgy || {})[slot]; if (h && h.id) ids.add(h.id); });
                });
                await Promise.all(Array.from(ids).map(async id => {
                    const doc = await safely(db.collection('hymns').doc(id).get(), null);
                    if (doc && doc.exists) bundle.hymns[id] = doc.data();
                }));
            }
        })());

        if (n.series || n.occurrenceRange) {
            jobs.push((async () => {
                const ES = global.EventsStore;
                if (!ES) return;
                const range = n.occurrenceRange || { from: Data.toDateStr(new Date()), to: Data.addDays(Data.toDateStr(new Date()), 14) };
                const opts = { from: range.from, to: range.to, rank: v.level || null, personId: v.personId || null };
                if (n.rosters) opts.staffingFrom = range.from;
                const [series, occurrences] = await Promise.all([
                    safely(ES.loadVisibleSeries(db, opts), []),
                    safely(ES.loadCalendar(db, opts), []),
                ]);
                bundle.series = series;
                bundle.occurrences = occurrences;
            })());
        }
        if (n.roles) jobs.push(safely(db.collection('roles').get().then(docsOf), []).then(r => { bundle.roles = r; }));

        if (n.forms && isEditor) {
            jobs.push((async () => {
                bundle.forms = await safely(db.collection('forms').get().then(docsOf), []);
                const ids = n.responses === true ? bundle.forms.map(f => f.id) : [].concat(n.responses || []);
                const all = await Promise.all(ids.map(id => safely(db.collection('form_responses').where('formId', '==', id).get().then(docsOf), [])));
                bundle.responses = [].concat.apply([], all);
            })());
        }

        await Promise.all(jobs);
        return bundle;
    }

    // What the drawer's pickers offer: the events and roles (any signed-in
    // viewer sees what the calendar would show them) and, for an editor, the
    // forms.
    async function loadOptions(db, viewer) {
        const v = viewer || {};
        const isEditor = ['editor', 'admin', 'elder', 'super_admin'].includes(v.level);
        const ES = global.EventsStore;
        const [series, roles, forms] = await Promise.all([
            ES ? safely(ES.loadVisibleSeries(db, { rank: v.level || null, personId: v.personId || null }), []) : [],
            safely(db.collection('roles').get().then(docsOf), []),
            isEditor ? safely(db.collection('forms').get().then(docsOf), []) : [],
        ]);
        return {
            series: series.map(s => ({ id: s.id, name: s.name || s.id, roleSlugs: s.roleSlugs || [] })).sort((a, b) => a.name.localeCompare(b.name)),
            roles: roles.map(r => ({ id: r.id, slug: r.slug || r.id, name: r.name || r.slug || r.id })).sort((a, b) => a.name.localeCompare(b.name)),
            forms: forms.map(f => ({ id: f.id, title: f.title || 'Untitled form', questions: f.questions || [] })).sort((a, b) => a.title.localeCompare(b.title)),
        };
    }

    const PrintableDataStore = { fetch, loadOptions, mergeNeeds };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = PrintableDataStore;
    }
    if (global) {
        global.PrintableDataStore = PrintableDataStore;
    }
})(typeof window !== 'undefined' ? window : globalThis);
