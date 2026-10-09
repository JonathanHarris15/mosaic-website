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
            if (k === 'services' || k === 'printedAnnouncements') {
                out[k] = Array.from(new Set((out[k] || []).concat(v)));
            }
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

    // The congregation's Liturgy Elements and Orders (ADR-0080), read like
    // the guide templates: world-readable. A page that did not load the store
    // reads null, and the resolvers fall back to Standard.
    async function loadLiturgy(db) {
        const Store = global.LiturgyOrderStore;
        return Store ? safely(Store.loadCatalog(db), null) : null;
    }

    // `viewer` is { level, personId }. Every read below is one the viewer
    // may make; a read the rules refuse degrades to an empty set and the
    // resolvers say so, rather than the page failing.
    async function fetch(db, needs, viewer) {
        const n = needs || {};
        const v = viewer || {};
        const isEditor = ['editor', 'admin', 'elder', 'super_admin', 'pastoral_assistant'].includes(v.level);
        const bundle = {
            people: [], families: [], households: [], services: {}, hymns: {},
            series: [], occurrences: [], roles: [], forms: [], responses: [],
            printedEventsBySunday: {}, liturgy: null, prayerRequests: {},
        };
        const jobs = [];

        const liturgy = (n.liturgy || n.hymns) ? loadLiturgy(db) : Promise.resolve(null);
        jobs.push(liturgy.then(c => { bundle.liturgy = c; }));

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
                const songs = Data.hymnSlotOptions(await liturgy).map(o => o.value);
                const ids = new Set();
                Object.keys(bundle.services).forEach(date => {
                    const s = Data.normaliseService(bundle.services[date]);
                    songs.forEach(slot => { const h = (s.liturgy || {})[slot]; if (h && h.id) ids.add(h.id); });
                });
                await Promise.all(Array.from(ids).map(async id => {
                    const doc = await safely(db.collection('hymns').doc(id).get(), null);
                    if (doc && doc.exists) bundle.hymns[id] = doc.data();
                }));
            }
        })());

        if (n.printedAnnouncements && n.printedAnnouncements.length) {
            jobs.push((async () => {
                const Guide = global.PrintedAnnouncementGuide;
                if (!Guide) return;
                const dates = n.printedAnnouncements;
                const lists = await Promise.all(dates.map(date => safely(Guide.eventsForSunday(db, date, v), [])));
                dates.forEach((date, i) => { bundle.printedEventsBySunday[date] = lists[i]; });
            })());
        }

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

        if (n.eventInputs && n.eventInputs.printableId) {
            jobs.push(loadEventInputs(db, n.eventInputs, v).then(bag => { bundle.eventInputs = bag; }));
        }

        await Promise.all(jobs);

        // Prayer requests after services are in: subjects come from the liturgy.
        if (n.prayerRequests && n.prayerRequests.length && readsPrayerRequests(v)) {
            await loadPrayerRequests(db, bundle, n.prayerRequests);
        }

        // Migrated booklet fills: empty occurrence slots ← typedContent.
        if (bundle.eventInputs && n.eventInputs && n.eventInputs.date) {
            const Migrate = global.PrintableLegacyMigrate;
            const Typed = global.SundayTypedCore;
            const svc = bundle.services && bundle.services[n.eventInputs.date];
            if (Migrate && Typed && svc) {
                bundle.eventInputs = Migrate.mergeEventWithTyped(
                    bundle.eventInputs,
                    Typed.fromService(svc)
                );
            }
        }

        if (n.passages && n.passages.length) await fetchPassages(bundle, n.passages);
        return bundle;
    }

    function readsPrayerRequests(viewer) {
        const level = (viewer && viewer.level) || '';
        return ['elder', 'super_admin', 'admin', 'pastoral_assistant'].indexOf(level) !== -1;
    }

    async function loadPrayerRequests(db, bundle, dates) {
        const Data = global.PrintableDataCore;
        const bag = bundle.prayerRequests || {};
        const wanted = [];
        (dates || []).forEach(date => {
            const s = bundle.services && bundle.services[date];
            if (!s || !Data || !Data.prayerSubjectsOf) return;
            Data.prayerSubjectsOf(s, bundle.liturgy).forEach(sub => {
                if (sub && sub.personId) wanted.push({ personId: sub.personId, date: date });
            });
        });
        await Promise.all(wanted.map(async w => {
            const doc = await safely(
                db.collection('people').doc(w.personId).collection('prayer_requests').doc(w.date).get(),
                null
            );
            if (doc && doc.exists) {
                bag[w.personId + '/' + w.date] = doc.data();
                bag[w.personId] = doc.data();
            }
        }));
        bundle.prayerRequests = bag;
    }

    // Values typed on the event this Printable is linked to, for this date.
    // The occurrence id wins when the page opened from that date. Otherwise
    // the series that links the Printable, and the occurrence on this date.
    async function loadEventInputs(db, spec, viewer) {
        const printableId = spec && spec.printableId;
        if (!printableId) return {};
        const fromDoc = data => {
            const all = (data && data.printableInputs) || {};
            return all[printableId] || {};
        };
        if (spec.occurrenceId) {
            const doc = await safely(db.collection('event_occurrences').doc(spec.occurrenceId).get(), null);
            if (doc && doc.exists) return fromDoc(doc.data());
        }
        if (!spec.date) return {};
        const ES = global.EventsStore;
        const occurrences = (ES && ES.loadCalendar)
            ? await safely(ES.loadCalendar(db, {
                from: spec.date,
                to: spec.date,
                rank: (viewer && viewer.level) || null,
                personId: (viewer && viewer.personId) || null,
            }), [])
            : [];
        const seriesSnap = await safely(
            db.collection('events').where('printables', 'array-contains', printableId).get(),
            null
        );
        const seriesIds = {};
        if (seriesSnap) seriesSnap.docs.forEach(d => { seriesIds[d.id] = true; });
        const hit = (occurrences || []).find(o => o && o.date === spec.date && seriesIds[o.seriesId]);
        if (!hit) return {};
        if (hit.printableInputs) return fromDoc(hit);
        if (!hit.id) return {};
        const doc = await safely(db.collection('event_occurrences').doc(hit.id).get(), null);
        return (doc && doc.exists) ? fromDoc(doc.data()) : {};
    }

    // Verses for passage wires, after the Sundays they cite are in the
    // bundle. A missing passage stays absent; the resolver says so.
    async function fetchPassages(bundle, requests) {
        const Passage = global.ScripturePassage;
        if (!Passage) return;
        bundle.passages = bundle.passages || {};
        const wanted = [];
        (requests || []).forEach(req => {
            const today = req.today || Data.toDateStr(new Date());
            let rows = [];
            try {
                rows = (Data.resolve(req.source, req.params, bundle, { today: today, level: 'editor' }).rows) || [];
            } catch (e) {
                rows = [];
            }
            rows.forEach(row => {
                const citation = row && row[req.field];
                if (!citation || typeof citation !== 'string' || !citation.trim()) return;
                const key = Passage.cacheKey(citation, req.presentation);
                if (bundle.passages[key] || wanted.some(w => w.key === key)) return;
                wanted.push({ key: key, citation: citation.trim(), presentation: req.presentation });
            });
        });
        await Promise.all(wanted.map(async w => {
            const text = await fetchEsv(w.citation, w.presentation);
            if (text) bundle.passages[w.key] = text;
        }));
    }

    async function fetchEsv(reference, presentation) {
        const Passage = global.ScripturePassage;
        // `fetch` above is this module's bundle loader. The ESV call has to
        // reach the platform fetch, or the verses never land in the bundle
        // and every passage wire warns that it did not load.
        const http = global.fetch;
        if (!Passage || typeof http !== 'function') return '';
        const key = Passage.apiKey();
        if (!key) return '';
        const url = 'https://api.esv.org/v3/passage/text/?' + Passage.query(reference, presentation);
        try {
            const res = await http(url, { headers: { Authorization: 'Token ' + key } });
            if (!res.ok) return '';
            const data = await res.json();
            return ((data.passages && data.passages[0]) || '').trim();
        } catch (e) {
            return '';
        }
    }

    // What the drawer's pickers offer: the events and roles (any signed-in
    // viewer sees what the calendar would show them) and, for an editor, the
    // forms.
    async function loadOptions(db, viewer) {
        const v = viewer || {};
        const isEditor = ['editor', 'admin', 'elder', 'super_admin', 'pastoral_assistant'].includes(v.level);
        const ES = global.EventsStore;
        const [series, roles, forms, liturgy] = await Promise.all([
            ES ? safely(ES.loadVisibleSeries(db, { rank: v.level || null, personId: v.personId || null }), []) : [],
            safely(db.collection('roles').get().then(docsOf), []),
            isEditor ? safely(db.collection('forms').get().then(docsOf), []) : [],
            loadLiturgy(db),
        ]);
        return {
            liturgy: liturgy,
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
