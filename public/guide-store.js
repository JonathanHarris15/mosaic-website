// Guide Store — the per-week Service Guide record: snapshot-on-apply, the frozen
// v2 guide shape, template override, tasks-remaining, and legacy detection
// (ADR-0008 decision #3 / #10), plus a thin Firestore adapter for the new
// global collections.
//
// The pure builders below are the test surface (test/guide-store.test.js): they
// take plain data and return plain data, no I/O. The browser-only adapter at the
// bottom (loadCatalog/saveWeekGuide/seedAll/…) is a thin shell over them, never
// reached under Node.
//
// Separation of concerns: guide-engine.js renders a snapshot; guide-store.js owns
// the lifecycle of the snapshot — building it from a template, freezing it onto a
// week, preserving values across an override, and reading whether a week is still
// on the legacy renderer.
//
// Loaded as a classic <script> after guide-engine/components/seed; IIFE exposes
// window.GuideStore. Also module.exports for Node tests.
(function (global) {
    'use strict';

    const Engine = (typeof require !== 'undefined') ? require('./guide-engine.js') : global.GuideEngine;
    const Seed = (typeof require !== 'undefined') ? require('./guide-seed.js') : global.GuideSeed;

    const COLLECTIONS = {
        stylePresets: 'style_presets',
        pageTemplates: 'page_templates',
        guideTemplates: 'guide_templates',
        assets: 'guide_assets',
    };
    const GUIDE_FORMAT = 'v2';

    // ── pure builders ──────────────────────────────────────────────────────────

    function indexById(list) {
        const out = {};
        for (const x of list || []) if (x && x.id != null) out[x.id] = x;
        return out;
    }

    // Fold legacy dotted-key fields (e.g. 'liturgy.sermon') back into nested
    // objects — older saves with set({merge}) stored some paths as top-level keys
    // containing a dot. A nested value wins over a dotted-key value for the same
    // leaf. Ported from the old service-guide.js so the new resolver reads the
    // same Service shape; pure and exported for tests.
    function normalizeServiceData(raw) {
        const data = {};
        for (const [key, val] of Object.entries(raw || {})) {
            // Copy plain object values, not their reference, so the dotted-key
            // loop below writes only into store-owned objects and never mutates
            // the caller's input (keeps this pure).
            if (!key.includes('.')) {
                data[key] = (val && typeof val === 'object' && !Array.isArray(val)) ? Object.assign({}, val) : val;
            }
        }
        for (const [key, val] of Object.entries(raw || {})) {
            if (key.includes('.')) {
                const parts = key.split('.');
                let obj = data;
                for (let i = 0; i < parts.length - 1; i++) {
                    if (typeof obj[parts[i]] !== 'object' || obj[parts[i]] === null) obj[parts[i]] = {};
                    obj = obj[parts[i]];
                }
                const leaf = parts[parts.length - 1];
                // Presence check, not truthiness: an existing nested value wins
                // even when it is intentionally empty/false/0 (the dotted key is
                // only a legacy fallback).
                if (!(leaf in obj)) obj[leaf] = val;
            }
        }
        return data;
    }

    // The Baptism Candidate display string (ports baptismNames): array of Person
    // refs post-migration, possibly a legacy free-text string.
    function baptismNamesOf(liturgy) {
        const bap = liturgy && liturgy.baptism;
        if (Array.isArray(bap)) return bap.map(c => c && c.name).filter(Boolean).join(', ');
        return typeof bap === 'string' ? bap : '';
    }

    // Resolve a Service Guide Template into a FROZEN snapshot: each placement is
    // flattened with its Page Template's html/css, the inherited Style Preset CSS,
    // its derived Entry Fields, and the placement's role/params. This is the
    // structure stored on the week (ADR-0008 §3.5) — once frozen, later template
    // edits never touch it.
    function buildSnapshot(guideTemplate, pageTemplatesById, stylePresetsById) {
        const pts = pageTemplatesById || {};
        const presets = stylePresetsById || {};
        const pages = ((guideTemplate && guideTemplate.pages) || []).map(placement => {
            const pt = pts[placement.pageTemplateId] || {};
            const preset = pt.stylePresetId ? presets[pt.stylePresetId] : null;
            return {
                pageTemplateId: placement.pageTemplateId || null,
                html: pt.html || '',
                css: pt.css || '',
                resolvedStylePresetCss: (preset && preset.css) || '',
                entryFields: Array.isArray(pt.entryFields) ? JSON.parse(JSON.stringify(pt.entryFields)) : [],
                emitsPages: pt.emitsPages || 'single',
                role: placement.role || 'normal',
                params: placement.params ? JSON.parse(JSON.stringify(placement.params)) : {},
            };
        });
        return {
            guideTemplateId: (guideTemplate && guideTemplate.id) || null,
            targetPageCount: (guideTemplate && guideTemplate.targetPageCount) || 16,
            // 1-based physical page where page numbering begins (default 2 — only
            // the cover is unnumbered, matching the original booklet).
            numberStartPage: (guideTemplate && guideTemplate.numberStartPage) || 2,
            pages,
        };
    }

    // The frozen per-week guide record written to services/{date}.guide. Pure —
    // the adapter stamps updatedAt at write time.
    function buildGuideRecord(guideTemplate, snapshot, values) {
        return {
            guideTemplateId: (guideTemplate && guideTemplate.id) || (snapshot && snapshot.guideTemplateId) || null,
            snapshot,
            values: values || {},
            format: GUIDE_FORMAT,
        };
    }

    // Switching a week's template re-snapshots while preserving the values whose
    // Entry Field keys survive into the new snapshot; the rest are dropped
    // (ADR-0008 §6).
    function preserveValues(oldValues, newSnapshot) {
        const surviving = new Set(Engine.snapshotEntryFields(newSnapshot).map(f => f.key));
        const out = {};
        for (const k of Object.keys(oldValues || {})) {
            if (surviving.has(k)) out[k] = oldValues[k];
        }
        return out;
    }

    // A week is on the new pipeline when its guide carries format:'v2'. Anything
    // else — an old `elements` blob or no guide at all — is legacy; the editor
    // renders it read-only via the kept legacy path (ADR-0008 decision #10).
    function isV2Guide(guide) {
        return !!(guide && guide.format === GUIDE_FORMAT && guide.snapshot);
    }
    function isLegacyGuide(guide) {
        return !!(guide && !isV2Guide(guide) && Array.isArray(guide.elements));
    }

    // ── Builder/Generator surfaces (ADR-0010) ─────────────────────────────────
    // The Service Guide is filled by two parties on two surfaces: the Order of
    // Service editor (builder) and the Service Guide generator (generator). These
    // pure helpers split one frozen snapshot between them.

    // Partition a snapshot's Entry Fields by the surface that informs them, so the
    // Builder shows only its prompts and the generator shows only its own. A field
    // with no surface defaults to generator (Party 2's fill-in-the-blanks).
    function partitionEntryFields(snapshot) {
        const builder = [];
        const generator = [];
        for (const f of Engine.snapshotEntryFields(snapshot)) {
            (f && f.surface === 'builder' ? builder : generator).push(f);
        }
        return { builder, generator };
    }

    function catalogOf(catalog) {
        return catalog || (globalThis.GuideComponents && globalThis.GuideComponents.defaultCatalog) || null;
    }

    // The bespoke Builder sections a template requests — the `section` id of every
    // non-static builder-surface Component placed in the snapshot (e.g. 'baptism',
    // 'pastoral-prayer-subjects', 'congregational-prayer'). Drives which extra
    // prompts the Order of Service editor renders for the chosen template.
    function builderSections(snapshot, catalog) {
        const cat = catalogOf(catalog);
        const out = [];
        const seen = new Set();
        for (const page of (snapshot && snapshot.pages) || []) {
            for (const tag of Engine.componentTagsIn(page && page.html)) {
                const comp = cat && cat.get(tag);
                if (comp && comp.surface === 'builder' && comp.section && !seen.has(comp.section)) {
                    seen.add(comp.section);
                    out.push(comp.section);
                }
            }
        }
        return out;
    }

    // A week has a baptism in the new system iff its template places the baptism
    // component — so `hasBaptism` is derived from the chosen template, not a
    // separate checkbox (ADR-0010; legacy weeks keep the checkbox).
    function templateIncludesBaptism(snapshot, catalog) {
        return builderSections(snapshot, catalog).includes('baptism');
    }

    // Which Service Guide system a week uses. An explicit per-week `guideSystem`
    // wins; otherwise a pre-existing legacy `elements` blob falls back to legacy;
    // everything else (incl. a brand-new week) defaults to the new v2 system.
    function guideSystemOf(service) {
        const s = service || {};
        if (s.guideSystem === 'legacy') return 'legacy';
        if (s.guideSystem === 'v2') return 'v2';
        if (isLegacyGuide(s.guide)) return 'legacy';
        return 'v2';
    }

    // The single routing rule shared by the Service Calendar and the Order of
    // Service editor's "Generate Service Guide" action, so the two never drift.
    function guideHref(service, date) {
        const enc = encodeURIComponent(date);
        return guideSystemOf(service) === 'legacy'
            ? `service-guide.html?date=${enc}`
            : `service-guide-editor.html?date=${enc}`;
    }

    // Merge a surface's filled values into the week's shared values map without
    // clobbering the other surface's keys (the two parties write at different
    // times — ADR-0010). Pure: neither argument is mutated.
    function mergeValues(existing, incoming) {
        return Object.assign({}, existing || {}, incoming || {});
    }

    // ── tasks-remaining (generic, ADR-0008 §6) ────────────────────────────────
    // Computed from required Entry Fields rather than the three hardcoded pages.
    // A field marked `required` in its Component tag is unfilled when blank; a
    // page with any unfilled required field is one task. This reproduces today's
    // three tasks (prayer / kids / announcements) once those pages' key fields
    // are marked required in the seed.
    function isEntryFieldFilled(value, field) {
        const type = field && field.type;
        if (type === 'list') {
            if (!Array.isArray(value) || value.length === 0) return false;
            return value.some(it => {
                if (typeof it === 'string') return it.trim() !== '';
                if (!it || typeof it !== 'object') return false;
                return !!((it.title && String(it.title).trim()) ||
                          (it.text && String(it.text).trim()) ||
                          (it.content && String(it.content).trim()));
            });
        }
        if (type === 'image') return !!value;
        return value != null && String(value).trim() !== '';
    }

    function tasksRemaining(snapshot, values) {
        let count = 0;
        for (const page of (snapshot && snapshot.pages) || []) {
            const required = (page.entryFields || []).filter(f => f && f.required);
            if (!required.length) continue;
            const incomplete = required.some(f => !isEntryFieldFilled((values || {})[f.key], f));
            if (incomplete) count++;
        }
        return count;
    }

    // The first snapshot page (and its required fields) still needing input —
    // drives the editor's "go to next task" affordance.
    function nextTaskPageIndex(snapshot, values) {
        const pages = (snapshot && snapshot.pages) || [];
        for (let i = 0; i < pages.length; i++) {
            const required = (pages[i].entryFields || []).filter(f => f && f.required);
            if (required.some(f => !isEntryFieldFilled((values || {})[f.key], f))) return i;
        }
        return -1;
    }

    // ── browser-only Firestore adapter ─────────────────────────────────────────
    // Thin: each function composes the pure builders above with a Firestore read
    // or write. Never invoked under Node (the tests exercise the pure builders).

    const HYMN_FIELDS = ['preparatoryHymn', 'hymn1', 'hymn2', 'hymnMid1', 'hymnMid2', 'hymnEnd1', 'hymnEnd2'];

    // Resolve a week's Service into the serviceContext the engine/Components read
    // (ADR-0008 §4 step 1): names, ESV key-verse text, per-slot hymn sheet images,
    // and the upcoming preaching schedule. Ports loadService/fetchHymnDetails/
    // fetchSchedule/getESVPlainText from the old service-guide.js. The ESV fetch
    // is injected (opts.esvFetch) so this stays free of the API key.
    async function resolveServiceContext(db, date, opts) {
        opts = opts || {};
        const doc = await db.collection('services').doc(date).get();
        const data = normalizeServiceData(doc.exists ? doc.data() : {});
        const liturgy = data.liturgy || {};
        const removedHymns = Array.isArray(data.removedHymns) ? data.removedHymns : [];

        const hymnsByField = {};
        for (const f of HYMN_FIELDS) {
            const h = liturgy[f];
            if (!h || !h.name) continue;
            const entry = { name: h.name, id: h.id || null, pages: [], attribution: '' };
            if (h.id) {
                try {
                    const hd = await db.collection('hymns').doc(h.id).get();
                    if (hd.exists) {
                        const d = hd.data();
                        entry.pages = (d.versions && d.versions[0] && d.versions[0].pages) || [];
                        entry.attribution = d.attribution || '';
                        entry.name = d.hymn_name || h.name;
                    }
                } catch (e) { /* leave as literal */ }
            }
            hymnsByField[f] = entry;
        }

        let schedule = [];
        try {
            const endStr = addDaysStr(date, 35);
            const snap = await db.collection('services')
                .where(firebase.firestore.FieldPath.documentId(), '>=', date)
                .where(firebase.firestore.FieldPath.documentId(), '<=', endStr)
                .get();
            schedule = snap.docs
                .map(d => { const sd = normalizeServiceData(d.data()); return { id: d.id, preacher: sd.preacher || '', sermon: (sd.liturgy && sd.liturgy.sermon) || '' }; })
                .sort((a, b) => a.id.localeCompare(b.id));
        } catch (e) { /* schedule optional */ }

        let keyVerseText = '';
        if (data.keyVerse && typeof opts.esvFetch === 'function') {
            try { keyVerseText = await opts.esvFetch(data.keyVerse); } catch (e) { keyVerseText = ''; }
        }

        const DU = globalThis.DateUtils;
        const context = {
            date,
            longDate: DU ? DU.formatDateLong(date) : date,
            shortDate: (globalThis.GuideComponents ? globalThis.GuideComponents.shortDate(date) : date),
            theme: data.theme || '',
            keyVerse: data.keyVerse || '',
            keyVerseText,
            preacher: data.preacher || '',
            musicLeader: data.musicLeader || '',
            serviceLeader: data.serviceLeader || '',
            hasBaptism: !!data.hasBaptism,
            removedHymns,
            baptismNames: baptismNamesOf(liturgy),
            liturgy,
            hymnsByField,
            schedule,
        };
        return { context, service: data };
    }

    function addDaysStr(dateStr, n) {
        const [y, m, d] = String(dateStr).split('-').map(Number);
        const dt = new Date(y, m - 1, d + n);
        return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    }

    async function loadCatalog(db) {
        const [sp, pt, gt] = await Promise.all([
            db.collection(COLLECTIONS.stylePresets).get(),
            db.collection(COLLECTIONS.pageTemplates).get(),
            db.collection(COLLECTIONS.guideTemplates).get(),
        ]);
        const map = (snap) => snap.docs.map(d => Object.assign({ id: d.id }, d.data()));
        return { stylePresets: map(sp), pageTemplates: map(pt), guideTemplates: map(gt) };
    }

    // Write the developer seed (upsert by stable id). Run once to bootstrap a
    // church, and safe to re-run — it overwrites the seeded docs in place.
    async function seedAll(db, catalog) {
        const seed = Seed.buildSeed(catalog);
        const batch = db.batch();
        for (const sp of seed.stylePresets) {
            batch.set(db.collection(COLLECTIONS.stylePresets).doc(sp.id), stamped(sp), { merge: true });
        }
        for (const pt of seed.pageTemplates) {
            batch.set(db.collection(COLLECTIONS.pageTemplates).doc(pt.id), stamped(pt), { merge: true });
        }
        // Seed every developer template (default chosen by isDefault); fall back
        // to the singular for older seeds.
        const guideTemplates = (seed.guideTemplates && seed.guideTemplates.length) ? seed.guideTemplates : [seed.guideTemplate];
        for (const gt of guideTemplates) {
            batch.set(db.collection(COLLECTIONS.guideTemplates).doc(gt.id), stamped(gt), { merge: true });
        }
        await batch.commit();
        return seed;
    }

    async function seedIfEmpty(db, catalog) {
        const snap = await db.collection(COLLECTIONS.guideTemplates).limit(1).get();
        if (!snap.empty) return null;
        return seedAll(db, catalog);
    }

    function stamped(doc) {
        return Object.assign({}, doc, {
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        });
    }

    async function saveStylePreset(db, doc) {
        const id = doc.id || db.collection(COLLECTIONS.stylePresets).doc().id;
        await db.collection(COLLECTIONS.stylePresets).doc(id).set(stamped(Object.assign({}, doc, { id })), { merge: true });
        return id;
    }

    async function savePageTemplate(db, doc, catalog) {
        const id = doc.id || db.collection(COLLECTIONS.pageTemplates).doc().id;
        // Re-derive Entry Fields on every save so the cached set never drifts.
        const cat = catalog || (globalThis.GuideComponents && globalThis.GuideComponents.defaultCatalog);
        const derived = Engine.deriveEntryFields(doc.html || '', cat);
        const toSave = Object.assign({}, doc, { id, entryFields: derived.fields });
        await db.collection(COLLECTIONS.pageTemplates).doc(id).set(stamped(toSave), { merge: true });
        return id;
    }

    async function saveGuideTemplate(db, doc) {
        const id = doc.id || db.collection(COLLECTIONS.guideTemplates).doc().id;
        await db.collection(COLLECTIONS.guideTemplates).doc(id).set(stamped(Object.assign({}, doc, { id })), { merge: true });
        return id;
    }

    // Exactly one Service Guide Template is the church default (ADR-0008 §3.4).
    async function setDefaultGuideTemplate(db, id, allGuideTemplates) {
        const batch = db.batch();
        for (const gt of allGuideTemplates || []) {
            const shouldBe = gt.id === id;
            if (!!gt.isDefault !== shouldBe) {
                batch.update(db.collection(COLLECTIONS.guideTemplates).doc(gt.id), { isDefault: shouldBe });
            }
        }
        await batch.commit();
    }

    async function deletePageTemplate(db, id) {
        await db.collection(COLLECTIONS.pageTemplates).doc(id).delete();
    }
    async function deleteStylePreset(db, id) {
        await db.collection(COLLECTIONS.stylePresets).doc(id).delete();
    }
    async function deleteGuideTemplate(db, id) {
        await db.collection(COLLECTIONS.guideTemplates).doc(id).delete();
    }

    // ── Asset Library ──────────────────────────────────────────────────────────
    // Reusable images (logos, QR codes) referenced by URL inside page HTML. Bytes
    // live in Firebase Storage under guide-assets/<id>/<file>; this collection holds
    // the metadata + public download URL. Browser-only (uses firebase.storage()).

    async function loadAssets(db) {
        const snap = await db.collection(COLLECTIONS.assets).get();
        return snap.docs.map(d => Object.assign({ id: d.id }, d.data()));
    }

    // Upload one File to Storage and persist its metadata. `meta` may carry a
    // display name and image width/height (read by the caller from an Image).
    async function saveAsset(db, file, meta) {
        meta = meta || {};
        const id = db.collection(COLLECTIONS.assets).doc().id;
        const safeName = String(file.name || 'asset').replace(/[^\w.\-]+/g, '_');
        const storagePath = `guide-assets/${id}/${safeName}`;
        const ref = firebase.storage().ref().child(storagePath);
        const snap = await ref.put(file);
        const url = await snap.ref.getDownloadURL();
        const doc = {
            id,
            name: meta.name || file.name || 'Asset',
            url,
            storagePath,
            contentType: file.type || '',
            size: file.size || 0,
            width: meta.width || null,
            height: meta.height || null,
        };
        await db.collection(COLLECTIONS.assets).doc(id).set(stamped(doc), { merge: true });
        return doc;
    }

    async function renameAsset(db, id, name) {
        await db.collection(COLLECTIONS.assets).doc(id).set(stamped({ name }), { merge: true });
    }

    // Delete the Firestore record and its Storage object (best-effort on the blob).
    async function deleteAsset(db, asset) {
        if (asset && asset.storagePath) {
            try { await firebase.storage().ref().child(asset.storagePath).delete(); } catch (e) { /* blob may already be gone */ }
        }
        await db.collection(COLLECTIONS.assets).doc(asset.id).delete();
    }

    async function saveWeekGuide(db, date, guideRecord) {
        await db.collection('services').doc(date).set({
            guide: Object.assign({}, guideRecord, {
                updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            }),
        }, { merge: true });
    }

    const GuideStore = {
        COLLECTIONS, GUIDE_FORMAT,
        // pure
        indexById, normalizeServiceData, baptismNamesOf, buildSnapshot,
        buildGuideRecord, preserveValues, isV2Guide, isLegacyGuide,
        isEntryFieldFilled, tasksRemaining, nextTaskPageIndex,
        partitionEntryFields, builderSections, templateIncludesBaptism,
        guideSystemOf, guideHref, mergeValues,
        // adapter
        resolveServiceContext, loadCatalog, seedAll, seedIfEmpty, saveStylePreset,
        savePageTemplate, saveGuideTemplate, setDefaultGuideTemplate, deletePageTemplate,
        deleteStylePreset, deleteGuideTemplate, saveWeekGuide,
        loadAssets, saveAsset, renameAsset, deleteAsset,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = GuideStore;
    }
    if (global) {
        global.GuideStore = GuideStore;
    }
})(typeof window !== 'undefined' ? window : null);
