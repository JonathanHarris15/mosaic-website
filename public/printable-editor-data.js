// The Printable editor's data side (MS-396, MS-397): the drawer, the wires,
// iterated elements and the real pages an overflowing list keeps.
//
// Mixed into the editor's Alpine object by printable-editor.js, so `this` is
// the editor. It owns:
//
//   • the DRAWER on the right, in three parts (MS-730):
//       – the QUERY BUILDER: every catalog source this viewer may read,
//         single or list — pick one, set its params and filters, drag its
//         fields; a list meeting a selected box iterates that box;
//       – the FILL-IN LIBRARY: blanks this printable defines; values are
//         typed where it is linked (any event, any printable);
//       – GENERAL LIVE DATA: the date, the page number, brand assets;
//   • WIRING — drag a chip onto an element to bind it, with a wire drawn from
//     the chip to the cursor and, once bound, from the chip to the element
//     whenever that element is selected;
//   • ITERATION — "Make this element iterated": the element stands for one
//     row of a list, its filters and layout live on the element panel, and a
    //     list that overflows keeps real pages, each editable, with live rows;
//     the query for a list lives in the drawer and only offers what this
//     viewer may query;
//   • LIVE DATA — one fetch of everything the project reads, resolved through
//     PrintableLive, redrawn on demand, with a Warnings list of every gap.
//
// The model never holds a value, only which field feeds which element
// (ADR-0057); what is drawn is resolved afresh every time.

(function (global) {
    'use strict';

    const Data = global.PrintableDataCore;
    const Live = global.PrintableLive;
    const Render = global.PrintableRenderCore;
    const Core = global.PrintableCore;

    // A wire is drawn only while the bound element still overlaps the
    // canvas. Off-screen copies leave a stray curve; coming back on
    // screen is a fresh show, animated by the drawer.
    function rectsOverlap(elRect, viewRect) {
        if (!elRect || !viewRect) return false;
        return elRect.right > viewRect.left
            && elRect.left < viewRect.right
            && elRect.bottom > viewRect.top
            && elRect.top < viewRect.bottom;
    }

    // Catalog home for a source. Prefer the catalog helper; fall back to the
    // same flags when this module loads in Node before PrintableDataCore is on
    // the global (string tests that only require the wires).
    function drawerPartOf(source) {
        if (Data && typeof Data.drawerPartOf === 'function') return Data.drawerPartOf(source);
        if (!source || typeof source === 'string') return '';
        if (source.noDrawer || source.blank) return '';
        if (source.scalar) return 'general';
        return 'query';
    }

    // The query builder's menu: the sources it was handed, grouped by
    // region. Related lists (`of`) sit first, under what one row of their
    // parent is called — "Of this household" — and only if the caller
    // passed them in. Scalars and noDrawer sources are never in the menu.
    function groupQuerySources(sources, search, parent) {
        const q = String(search || '').trim().toLowerCase();
        const filtered = (sources || []).filter(s => {
            if (!s || drawerPartOf(s) !== 'query') return false;
            if (!q) return true;
            const hay = [s.label, s.region, s.blurb]
                .concat((s.fields || []).map(f => f.label))
                .join(' ')
                .toLowerCase();
            return hay.includes(q);
        });
        const related = filtered.filter(s => s.of);
        const top = filtered.filter(s => !s.of);
        const byRegion = {};
        const order = [];
        top.forEach(s => {
            if (!byRegion[s.region]) { byRegion[s.region] = []; order.push(s.region); }
            byRegion[s.region].push(s);
        });
        const regions = order.map(r => ({ name: r, sources: byRegion[r] }));
        if (related.length) {
            const row = (parent && parent.row) || 'row';
            regions.unshift({ name: 'Of this ' + row, sources: related, related: true });
        }
        return regions;
    }

    // What the query builder is looking at, from the selection.
    //   own    — the selected box repeats: the builder is that box's query,
    //            and picking a list changes what it repeats over.
    //   row    — the selection sits in an iterated card: the builder shows
    //            that card's list, so the fields of one row are at hand.
    //   browse — anything else: the drawer holds the params, and a chip
    //            carries them onto the element it lands on.
    // An unbound box inside a card with related lists browses the first of
    // them, so the sub-iteration is one press away. A pick made while this
    // selection is chosen wins over the card.
    function querySubject(o) {
        const opts = o || {};
        if (opts.ownRepeat) {
            // Browse other data: look at a single (or another list) without
            // rewriting this box's Repeat. Cleared when the selection moves.
            if (opts.browseFor && opts.selectionId && opts.browseFor === opts.selectionId) {
                return { scope: 'browse', source: opts.pick || '' };
            }
            return { scope: 'own', source: opts.ownRepeat.source || '' };
        }
        const ctx = opts.context || null;
        const pick = opts.pick || '';
        const pickedHere = !!pick && (opts.pickedFor || null) === (opts.selectionId || null);
        if (ctx && !pickedHere) {
            if (opts.related && opts.related.length) return { scope: 'browse', source: opts.related[0] };
            return { scope: 'row', source: ctx.source || '' };
        }
        if (ctx && pick === ctx.source) return { scope: 'row', source: pick };
        return { scope: 'browse', source: pick };
    }

    // The source the builder opens on: the one this printable already reads
    // most, so a booklet opens on its Sunday and a directory on its people.
    // Ties go to the catalog's order; a printable that reads nothing opens
    // on nothing picked.
    function defaultQuerySource(project, keys) {
        const offered = keys || [];
        const counts = {};
        const visit = nodes => (nodes || []).forEach(node => {
            if (!node) return;
            if (node.repeat && node.repeat.source) counts[node.repeat.source] = (counts[node.repeat.source] || 0) + 1;
            Object.keys(node.bind || {}).forEach(prop => {
                const b = node.bind[prop];
                if (b && b.scope === 'global' && b.source) counts[b.source] = (counts[b.source] || 0) + 1;
            });
            visit(node.children);
        });
        ((project && project.pages) || []).forEach(page => visit(page && page.nodes));
        let best = '';
        offered.forEach(key => {
            if ((counts[key] || 0) > (counts[best] || 0)) best = key;
        });
        return best;
    }

    // What an empty choice in a picker says: a required param asks for one,
    // an optional one means every event, no role, or no form yet.
    function specEmptyLabel(spec) {
        const s = spec || {};
        if (s.kind === 'series') return s.required ? 'Choose an event' : 'Every event';
        if (s.kind === 'role') return s.required ? 'Choose a role' : 'No role';
        if (s.kind === 'form') return 'Choose a form';
        return '';
    }

    // What the query preview calls a row: a name, a slot, a date in words —
    // never an id like "2026-09-20".
    function previewName(row) {
        const r = row || {};
        return r.name || r.personName || r.label || r.date || r._id || 'A row';
    }

    // Draw a wire on: dash the path's own length, then run it to zero.
    // Rebuilding the svg from scratch would cancel this, so syncWirePaths
    // keeps the path node while the line is still showing.
    function drawWireIn(path) {
        let len = 0;
        try { len = path.getTotalLength(); } catch (e) { return; }
        if (!len) return;
        path.style.strokeDasharray = String(len);
        path.style.strokeDashoffset = String(len);
        path.getBoundingClientRect();
        path.style.transition = 'stroke-dashoffset .45s ease-out';
        requestAnimationFrame(function () { path.style.strokeDashoffset = '0'; });
        path.addEventListener('transitionend', function () {
            path.classList.remove('is-enter');
            path.style.strokeDasharray = '';
            path.style.strokeDashoffset = '';
            path.style.transition = '';
        }, { once: true });
    }

    function syncWirePaths(svg, wires, dFor) {
        if (!svg) return;
        const keep = {};
        (wires || []).forEach((w, i) => {
            const id = w.key || (w.live ? 'live' : 'w' + i);
            keep[id] = true;
            let path = svg.querySelector('path[data-wire="' + id + '"]');
            const fresh = !path;
            if (!path) {
                path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                path.setAttribute('data-wire', id);
                svg.appendChild(path);
            }
            path.setAttribute('d', dFor(w));
            const cls = [];
            if (w.live) cls.push('is-live');
            if ((fresh && w.enter && !w.live) || (!fresh && path.classList.contains('is-enter') && !w.live)) {
                cls.push('is-enter');
            }
            path.setAttribute('class', cls.join(' '));
            if (fresh && w.enter && !w.live) drawWireIn(path);
        });
        Array.from(svg.querySelectorAll('path[data-wire]')).forEach(p => {
            if (!keep[p.getAttribute('data-wire')]) p.remove();
        });
    }

    // The key a wire looks up. Scripture words and the citation are two
    // chips of one Sunday field, so the reading is part of the key.
    function wireKey(bind, repeatSource) {
        const b = bind || {};
        if (b.scope === 'asset') return 'asset|' + (b.assetId || '');
        if (b.scope === 'item') return 'item|' + (repeatSource || b.source || '') + '|' + (b.field || '');
        let field = b.field || '';
        const Passage = global.ScripturePassage;
        const Core = global.PrintableDataCore;
        if (b.source === 'sunday' && (
            (Passage && Passage.isScriptureField(b.field))
            || b.reading === 'passage'
            || (Core && Core.isScriptureField && Core.isScriptureField(b.field))
        )) {
            field += (b.reading === 'passage' ? '#passage' : '#citation');
        }
        return 'global|' + (b.source || '') + '|' + field;
    }

    // A chip inside a closed catalog section is still in the document, at
    // no size. A wire to that point runs to the corner of the editor.
    // The first chip with this key that actually has a box is the one on
    // screen. When a drawer viewport is passed, a chip that has scrolled
    // out of that box is skipped — the wire breaks instead of dragging
    // the drawer back to keep the land chip in view.
    function firstLaidOutChip(chips, key, viewRect) {
        const list = chips || [];
        for (let i = 0; i < list.length; i++) {
            const chip = list[i];
            if (!chip || chip.key !== key) continue;
            const r = chip.rect || {};
            if ((r.width || 0) <= 0 || (r.height || 0) <= 0) continue;
            if (viewRect && !rectsOverlap(r, viewRect)) continue;
            return chip;
        }
        return null;
    }

    // How far to move the drawer so the chip sits inside it. Positive
    // scrolls down. Zero when the chip is already in view.
    function drawerScrollDelta(bodyRect, chipRect) {
        if (!bodyRect || !chipRect) return 0;
        const pad = 8;
        if (chipRect.top < bodyRect.top + pad) return chipRect.top - bodyRect.top - pad;
        if (chipRect.bottom > bodyRect.bottom - pad) return chipRect.bottom - bodyRect.bottom + pad;
        return 0;
    }

    // The chips the query builder shows for A Sunday, grouped Service,
    // Hymns and Scripture. Extra date formats stay off — longDate is the
    // one the guide prints. `fillFields` is the typed-on-the-Sunday set
    // (prayer, Mosaic Kids), which the Fill-in library offers. Chips follow
    // the Liturgy Order that Sunday uses (ADR 0080): identity fields, then
    // that order's placements under their order names. Without a catalog,
    // Standard is the order.
    function sundayDrawerFields(Data, Passage, fillFields, options) {
        const Liturgy = global.LiturgyOrderCore;
        const liturgy = options && options.liturgy;
        const cat = liturgy || (Liturgy && Liturgy.standardCatalog ? Liturgy.standardCatalog() : null);
        const order = Liturgy && Liturgy.orderFor
            ? Liturgy.orderFor((options && options.service) || {}, cat)
            : null;
        const orderEls = order && Liturgy.elementsOf ? Liturgy.elementsOf(order) : [];
        const orderById = new Map(orderEls.map(el => [el.id, el]));
        const fields = Data && Data.fieldsFor
            ? Data.fieldsFor('sunday', {}, { liturgy: cat })
            : ((Data && Data.sourceByKey && Data.sourceByKey('sunday') || {}).fields || []);
        const skip = { date: true, shortDate: true, dateShort: true };
        const shortLabel = { longDate: 'Date' };
        const service = [];
        const hymns = [];
        const scripture = [];
        if (!orderById.size && Passage && Passage.FIELDS) {
            // No liturgy module — keep the old seed split so the drawer still paints.
            const hymnSlots = (Data && Data.HYMN_SLOTS) || [];
            const scriptureKeys = Passage.FIELDS;
            fields.forEach(f => {
                if (!f || skip[f.key]) return;
                if (f.key === 'keyVerse' || scriptureKeys.indexOf(f.key) !== -1) {
                    scripture.push(f.key === 'keyVerse'
                        ? Object.assign({}, f, { label: 'Key verse' })
                        : f);
                    return;
                }
                const chip = shortLabel[f.key] ? Object.assign({}, f, { label: shortLabel[f.key] }) : f;
                if (hymnSlots.indexOf(f.key) !== -1) hymns.push(chip);
                else service.push(chip);
            });
        } else {
            fields.forEach(f => {
                if (!f || skip[f.key]) return;
                if (f.key === 'keyVerse') {
                    scripture.push(Object.assign({}, f, { label: 'Key verse' }));
                    return;
                }
                const el = orderById.get(f.key);
                if (el) {
                    const label = Liturgy.elementDisplayName
                        ? Liturgy.elementDisplayName(el)
                        : (el.name || f.label);
                    const chip = Object.assign({}, f, { label: label, element: el.kind || el.primitive });
                    if (el.kind === 'hymn' || el.primitive === 'song') hymns.push(chip);
                    else if (el.kind === 'scripture' || el.primitive === 'scripture') scripture.push(chip);
                    else service.push(chip);
                    return;
                }
                if (f.element || f.element === '') return;
                // Identity fields of the Sunday (preacher, theme, …) — not placements.
                const chip = shortLabel[f.key] ? Object.assign({}, f, { label: shortLabel[f.key] }) : f;
                service.push(chip);
            });
        }
        return { service: service, hymns: hymns, typed: typedChipFields(fillFields), scripture: scripture };
    }

    // The Sunday booklet fields offered as chips. Announcements are a list
    // — the query builder iterates them — so the joined field and its
    // count stay off.
    function typedChipFields(fields) {
        const skip = { announcements: true, announcementCount: true };
        return (fields || []).filter(f => f && !skip[f.key]);
    }

    function chipPreview(kind, raw) {
        if (raw == null || raw === '') return '';
        if (kind === 'image') return 'Picture set';
        if (typeof raw === 'object') return '';
        const s = String(raw).replace(/\s+/g, ' ').trim();
        if (!s) return '';
        return s.length > 48 ? s.slice(0, 47) + '…' : s;
    }

    const PrintableEditorWires = {
        elementOnCanvas: rectsOverlap,
        wireKey: wireKey,
        firstLaidOutChip: firstLaidOutChip,
        drawerScrollDelta: drawerScrollDelta,
        drawerPartOf: drawerPartOf,
        groupQuerySources: groupQuerySources,
        querySubject: querySubject,
        defaultQuerySource: defaultQuerySource,
        specEmptyLabel: specEmptyLabel,
        previewName: previewName,
        syncWirePaths: syncWirePaths,
        sundayDrawerFields: sundayDrawerFields,
        typedChipFields: typedChipFields,
        chipPreview: chipPreview,
    };
    global.PrintableEditorWires = PrintableEditorWires;

    // Alpine evaluates x-model even behind x-show. A missing draft used to
    // throw on every kids/announcements field the moment a single source
    // rendered. Always stand a blank draft up; loadTypedDraft replaces it.
    function emptyTypedDraft() {
        const Typed = global.SundayTypedCore;
        if (Typed && typeof Typed.toDraft === 'function') {
            return Typed.toDraft(Typed.empty ? Typed.empty() : {});
        }
        return {
            prayerNation: '', prayerContinent: '', prayerCapital: '',
            prayerPopulation: '', prayerLanguage: '', prayerTotalLanguages: '',
            prayerLiteracy: '', prayerChristian: '', prayerEvangelical: '',
            prayerUnevangelized: '', prayerPrompts: '', prayerCountryImage: '',
            kidsLessonTitle: '', kidsLessonVerse: '', kidsSummary: '',
            kidsQuestions: '', announcements: [{ title: '', content: '' }],
        };
    }

    function emptyQueryPreview() {
        return { key: '', loading: false, count: null, names: [], row: {}, warnings: [], service: null, liturgy: null, error: '' };
    }

    function initialViewDate() {
        const Clock = global.PrintableDataCore || Data;
        try {
            const q = new URLSearchParams(global.location.search).get('asOf');
            if (Clock && Clock.isDateStr(q)) return q;
        } catch (e) { /* no address bar */ }
        if (Clock && Clock.toDateStr) return Clock.toDateStr(new Date());
        const d = new Date();
        return d.getFullYear() + '-'
            + String(d.getMonth() + 1).padStart(2, '0') + '-'
            + String(d.getDate()).padStart(2, '0');
    }

    function initialOccurrenceId() {
        try {
            const q = new URLSearchParams(global.location.search).get('occurrence') || '';
            return /^[A-Za-z0-9_-]{1,160}$/.test(q) ? q : '';
        } catch (e) {
            return '';
        }
    }

    const SCRIPTURE_LABELS = {
        keyVerse: 'Key verse',
        callToWorship: 'Call to worship',
        callToConfession: 'Call to confession',
        assuranceOfPardon: 'Assurance of pardon',
        scriptureReading: 'Scripture reading',
        sermon: 'Sermon passage',
        benediction: 'Benediction',
    };

    function linkFields() {
        return global.PrintableLinkCore || null;
    }

    function PrintableEditorData(ui) {
        return {
            // ── State ────────────────────────────────────────────────────
            data: {
                mode: 'live',          // 'live' | 'standins'
                loading: false,
                loaded: false,
                error: '',
                search: '',
                queryMenuOpen: false,  // the source picker dropdown
                warningsOpen: true,    // "Not all data could be pulled" is open until folded
                params: {},            // sourceKey -> the params a browsed source's chips carry
                options: { series: [], roles: [], forms: [] },
                warnings: [],
                // The query builder's own pick, and the selection it was
                // made for (see querySubject). The preview is what that
                // pick reads today, fetched for the builder alone.
                query: { source: '', pickedFor: null, browseFor: '', preview: emptyQueryPreview() },
                typed: { date: '', draft: emptyTypedDraft(), row: {}, saving: false, status: '' },
                assetUploadError: '',
            },
            layout: [],                // what the canvas draws: stored pages, overflow continuations included
            viewDate: initialViewDate(),
            occurrenceId: initialOccurrenceId(),
            sendingSnapshot: false,
            snapshotListLoading: false,
            snapshotTargets: [],
            snapshotTargetError: '',
            snapshotSendProgress: '',
            dragField: null,           // the chip in the air
            dropTarget: null,          // the element under it, when it may take it
            wires: [],                 // [{x1,y1,x2,y2}] in main-area coordinates
            dragWire: null,
            _wireKeys: {},             // last-drawn wire keys, so a return can animate
            _wirePinnedFor: null,      // selection id last pinned into the drawer
            _wiresBound: false,

            // ── Boot ─────────────────────────────────────────────────────

            async initData() {
                if (!this.project) return;
                if (!Array.isArray(this.project.assets)) this.project.assets = [];
                ['insert_date', 'insert_page_number'].forEach(key => {
                    const src = Data.sourceByKey(key);
                    if (src && !this.data.params[key]) this.data.params[key] = Data.defaultParams(src);
                });
                if (!this.data.query.source) {
                    this.data.query.source = defaultQuerySource(this.project, Data.querySourcesFor(this.permissionLevel).map(s => s.key));
                }
                this.data.loading = true;
                try {
                    this.data.options = await global.PrintableDataStore.loadOptions(db, this.viewer());
                } catch (e) {
                    this.data.options = { series: [], roles: [], forms: [] };
                }
                this.bindWireTracking();
                await this.refreshData();
            },

            // The chip end of a wire lives in the drawer; without a scroll
            // listener the curve sits still while the chip moves.
            bindWireTracking() {
                if (this._wiresBound) return;
                this._wiresBound = true;
                const body = document.querySelector('.pe-drawer__body');
                if (body) body.addEventListener('scroll', () => this.refreshWires(), { passive: true });
            },

            viewer() {
                return { level: this.permissionLevel, personId: (this.currentUserData && this.currentUserData.personId) || null };
            },

            // One fetch of everything the project reads, then a resolver the
            // canvas draws through. Called on open, on Refresh, and when a
            // list's params change (its needs may have changed).
            // The drawer's Refresh: today's data again, and the query
            // builder's preview with it.
            reloadData() {
                ui.previews = {};
                this.data.query.preview = emptyQueryPreview();
                return this.refreshData();
            },

            async refreshData() {
                if (!this.project || !this.template) return;
                this.data.loading = true;
                this.data.error = '';
                try {
                    const needs = Live.collectNeeds(this.project, this.viewDate, { occurrenceId: this.occurrenceId });
                    const bundle = await global.PrintableDataStore.fetch(db, needs, this.viewer());
                    ui.bundle = bundle;
                    ui.resolver = Live.resolver(this.project, bundle, { level: this.permissionLevel, canEdit: this.canEdit, today: this.viewDate });
                    this.data.loaded = true;
                } catch (e) {
                    console.error(e);
                    this.data.error = 'The data did not load. The canvas shows stand-ins.';
                    ui.resolver = null;
                } finally {
                    this.data.loading = false;
                }
                this.renderAll();
            },

            // Bindings changed but the data did not: re-resolve against the
            // same bundle. Cheap, so every edit can call it.
            rebindData() {
                if (!ui.bundle) return;
                ui.resolver = Live.resolver(this.project, ui.bundle, { level: this.permissionLevel, canEdit: this.canEdit, today: this.viewDate });
            },

            get resolver() {
                return this.data.mode === 'live' ? (ui.resolver || null) : null;
            },

            setDataMode(mode) {
                this.data.mode = mode;
                this.renderAll();
            },

            // ── What the canvas draws ────────────────────────────────────

            computeLayout(opts) {
                if (!this.project || !this.template) { this.layout = []; return []; }
                if (ui.resolver && this.data.mode === 'live') {
                    // Bindings may have changed since the last resolve.
                    this.rebindData();
                }
                const host = document.getElementById('pe-measure');
                const res = this.resolver;
                this.layout = Live.layoutPages(this.project, res, res ? host : null);
                if ((!opts || opts.persist !== false) && this.canEdit && this.persistOverflowPages(this.layout)) {
                    this.layout = Live.layoutPages(this.project, res, res ? host : null);
                }
                this.data.warnings = res ? Live.warningsFor(this.layout, res, this.project) : [];
                return this.layout;
            },

            // Overflow that still has rows and no stored page yet becomes a
            // real page in the project, so the Elements panel can address it.
            persistOverflowPages(entries) {
                const extras = (entries || []).filter(e => e.needsPersist && e.page);
                if (!extras.length || !this.project || !this.project.pages) return false;
                extras.forEach(e => {
                    const pages = this.project.pages;
                    let after = pages.findIndex(p => p.id === e.originId);
                    pages.forEach((p, i) => {
                        if (p.id === e.originId || (p.continues && p.continues.from === e.originId)) after = i;
                    });
                    if (after < 0) after = pages.length - 1;
                    pages.splice(after + 1, 0, e.page);
                });
                this.commit();
                return true;
            },

            get wantsBookletExport() {
                const Ex = global.PrintableExportCore;
                return !!(Ex && Ex.isSundayBookletPath(this.project));
            },

            // The pages for flat print: Sunday booklet path pads to ×4 for
            // the copier's booklet mode (MS-589 / MS-592). Other Printables
            // print as laid out. Order is unchanged. Folio print imposes
            // its own spreads and does not use this list.
            printPages() {
                const entries = this.computeLayout({ persist: false });
                const Ex = global.PrintableExportCore;
                const printed = Ex ? Ex.exportEntries(entries, this.project) : entries;
                return printed.map(e => ({ page: Object.assign({}, e.page, { nodes: e.nodes }), blank: !!e.blank }));
            },

            // ── The drawer ───────────────────────────────────────────────

            // The iterated element the selection sits in (itself, or an
            // ancestor), if any.
            get repeatContext() {
                const page = this.currentPage;
                if (!page || !this.selection.nodeId) return null;
                const node = Core.findNode(page, this.selection.nodeId);
                if (!node) return null;
                if (node.repeat) return node;
                const chain = Core.ancestorsOf(page, node.id);
                for (let i = chain.length - 1; i >= 0; i--) if (chain[i].repeat) return chain[i];
                return null;
            },

            get repeatSource() {
                const r = this.repeatContext;
                if (!r || !r.repeat.source) return null;
                return Data.sourcesFor(this.permissionLevel).find(s => s.key === r.repeat.source) || null;
            },

            get queryTarget() {
                const node = this.selectedNode;
                if (node && Core.kindOf(node) === 'box') return node;
                return this.repeatContext;
            },

            get enclosingRepeat() {
                const page = this.currentPage;
                const target = this.queryTarget;
                if (!page || !target) return null;
                const chain = Core.ancestorsOf(page, target.id);
                for (let i = chain.length - 1; i >= 0; i--) {
                    if (chain[i].repeat && chain[i].repeat.source) return chain[i];
                }
                return null;
            },

            get listSources() {
                const parent = this.enclosingRepeat;
                return Data.listSourcesFor(this.permissionLevel, parent && parent.repeat.source);
            },

            get relatedListSources() {
                return this.listSources.filter(s => s.of);
            },

            get topListSources() {
                return this.listSources.filter(s => !s.of);
            },

            // ── The query builder ────────────────────────────────────────
            // One builder for every source this viewer may read. What it
            // shows follows the selection (see querySubject): a repeating
            // box is its own query, a card's inside reads that card's rows,
            // and anything else browses a pick the drawer remembers.

            get querySubject() {
                const node = this.selectedNode;
                const own = node && node.repeat ? node.repeat : null;
                const selectionId = (this.selection && this.selection.nodeId) || null;
                // Drop browse-other when the selection leaves the box it was for.
                if (this.data.query.browseFor && this.data.query.browseFor !== selectionId) {
                    this.data.query.browseFor = '';
                }
                const ctx = !own && this.repeatContext ? this.repeatContext.repeat : null;
                const related = this.canStartSubIteration ? this.relatedListSources.map(s => s.key) : [];
                return PrintableEditorWires.querySubject({
                    ownRepeat: own,
                    context: ctx,
                    related: related,
                    pick: this.data.query.source,
                    pickedFor: this.data.query.pickedFor,
                    browseFor: this.data.query.browseFor,
                    selectionId: selectionId,
                });
            },

            get queryScope() {
                return this.querySubject.scope;
            },

            get querySourceKey() {
                return this.querySubject.source;
            },

            // The catalog entry, as this viewer may see it. Null for a list
            // above them (a locked query) and for an event list, which is
            // not a catalog source.
            get querySource() {
                const key = this.querySourceKey;
                if (!key) return null;
                return Data.sourcesFor(this.permissionLevel).find(s => s.key === key) || null;
            },

            // The Repeat the builder reads and writes: the selected box's,
            // or the card's while the builder shows that card's rows.
            get queryRepeatNode() {
                const scope = this.queryScope;
                if (scope === 'own') return this.selectedNode;
                if (scope === 'row') return this.repeatContext;
                return null;
            },

            // What the menu offers. A repeating box picks among lists —
            // related ones first when it sits in their parent. Browsing
            // offers every source this viewer may read, singles too.
            // An event_list Repeat is not a catalog source: the menu stays
            // shut so a pick cannot replace the fill-in list.
            get queryOffered() {
                if (this.queryScope === 'own') {
                    const node = this.selectedNode;
                    if (node && node.repeat && node.repeat.source === 'event_list') return [];
                    return this.listSources;
                }
                const card = this.repeatContext;
                return Data.querySourcesFor(this.permissionLevel, card && card.repeat ? card.repeat.source : null);
            },

            get queryIsEventList() {
                return this.queryScope === 'own' && this.querySourceKey === 'event_list';
            },

            get queryCatalogRegions() {
                const offered = this.queryOffered;
                const parentKey = this.queryScope === 'own'
                    ? (this.enclosingRepeat && this.enclosingRepeat.repeat.source)
                    : (this.repeatContext && this.repeatContext.repeat.source);
                return groupQuerySources(offered, this.data.search, parentKey ? Data.sourceByKey(parentKey) : null);
            },

            get querySourceLabel() {
                const key = this.querySourceKey;
                if (!key) return this.queryScope === 'own' ? 'Pick a list' : 'Pick what to read';
                if (key === 'event_list') {
                    const Link = linkFields();
                    const r = this.queryRepeatNode;
                    const input = Link && r && Link.inputById(this.project, r.repeat.params && r.repeat.params.inputId);
                    return (input ? input.label : 'A list') + ' · filled on the event';
                }
                const src = this.querySource || Data.sourceByKey(key);
                return (src && src.label) || key;
            },

            get queryLocked() {
                const r = this.queryRepeatNode;
                const key = r && r.repeat && r.repeat.source;
                return !!(key && key !== 'event_list' && !Data.mayQuery(this.permissionLevel, key));
            },

            // The params and filters this viewer may set on the pick.
            get querySpecs() {
                const src = this.querySource;
                if (!src || this.queryLocked) return [];
                return Data.querySpecsFor(src, this.permissionLevel, this.data && this.data.options);
            },

            // The params a browsed source's chips carry, defaults filled in.
            browseParams(key) {
                const src = Data.sourceByKey(key);
                if (!src) return {};
                return Object.assign(Data.defaultParams(src), this.data.params[key] || {});
            },

            queryParam(key) {
                const r = this.queryRepeatNode;
                const src = this.querySource || Data.sourceByKey(this.querySourceKey);
                if (!src) return undefined;
                if (r) return Object.assign(Data.defaultParams(src), r.repeat.params || {})[key];
                return this.browseParams(src.key)[key];
            },

            // A box's query is stored on its Repeat. A browsed pick is the
            // drawer's: it changes what the next chip carries, and nothing
            // already wired.
            setQueryParam(key, value) {
                if (!this.querySpecs.some(s => s.key === key)) return;
                if (this.queryRepeatNode) { this.setRepeatParam(key, value); return; }
                const src = this.querySource;
                if (!src) return;
                this.data.params[src.key] = Object.assign({}, this.browseParams(src.key), { [key]: value });
            },

            // Picking from the menu. A repeating box now repeats over that
            // list; otherwise the pick is browsed, and remembered for this
            // selection so a card's rows do not take it back. Never retarget
            // an event_list — that list is named in the Fill-in library.
            setQuerySource(key) {
                if (!key) return;
                if (this.queryScope === 'own') {
                    const node = this.selectedNode;
                    if (node && node.repeat && node.repeat.source === 'event_list') return;
                    const list = this.listSources.find(s => s.key === key);
                    if (list) this.chooseList(list);
                    return;
                }
                if (!this.queryOffered.some(s => s.key === key)) return;
                this.data.query.source = key;
                this.data.query.pickedFor = (this.selection && this.selection.nodeId) || null;
            },

            // Look at other catalog data without changing this box's Repeat.
            browseOtherData() {
                const node = this.selectedNode;
                if (!node || !node.repeat) return;
                this.data.query.browseFor = node.id;
                this.data.query.pickedFor = node.id;
                if (!this.data.query.source) {
                    this.data.query.source = defaultQuerySource(
                        this.project,
                        Data.querySourcesFor(this.permissionLevel).map(s => s.key)
                    ) || 'sunday';
                }
            },

            backToRows() {
                this.data.query.browseFor = '';
            },

            // The chips the pick offers.
            //   item   — fields of one row, dropped inside the repeating box;
            //   global — fields of a single, carrying the browsed params;
            //   inert  — a browsed list's fields, shown so you know what a
            //            row carries before a box repeats over it.
            get queryChipScope() {
                const scope = this.queryScope;
                if (scope === 'own' || scope === 'row') return 'item';
                const src = this.querySource;
                if (!src) return '';
                return src.shape === 'list' ? 'inert' : 'global';
            },

            get queryFields() {
                const chipScope = this.queryChipScope;
                if (!chipScope || this.queryLocked) return [];
                if (chipScope === 'item') return this.itemFields;
                const src = this.querySource;
                const row = this.data.query.preview.row || {};
                return Data.fieldsFor(src, this.browseParams(src.key), this.data.options)
                    .filter(f => !f.minLevel || Data.mayRead(this.permissionLevel, f.minLevel))
                    .map(f => chipScope === 'global'
                        ? Object.assign({}, f, { value: chipPreview(f.kind, row[f.key]) })
                        : f);
            },

            // A Sunday's fields, grouped by the order that Sunday follows.
            get queryIsSunday() {
                return this.queryChipScope === 'global' && this.querySourceKey === 'sunday';
            },

            get querySundayGroups() {
                if (!this.queryIsSunday) return { service: [], hymns: [], scripture: [] };
                const groups = this.sundayDrawer();
                const row = this.data.query.preview.row || {};
                const chips = list => list.map(f => Object.assign({}, f, { value: chipPreview(f.kind, row[f.key]) }));
                return {
                    service: chips(groups.service),
                    hymns: chips(groups.hymns),
                    scripture: groups.scripture.map(f => ({
                        key: f.key,
                        label: f.label || SCRIPTURE_LABELS[f.key] || f.key,
                        citation: row[f.key] ? String(row[f.key]) : '',
                    })),
                };
            },

            // How many rows the pick reads today, and the first few by
            // name. A box's query is read off the live resolver; a browsed
            // list off the builder's own preview.
            get queryResults() {
                if (this.queryRepeatNode) {
                    const p = this.repeatPreview;
                    return { count: p.count, names: p.names, warnings: [], loading: false, error: '' };
                }
                const pv = this.data.query.preview;
                const src = this.querySource;
                const isList = !!(src && src.shape === 'list');
                return {
                    count: isList ? pv.count : null,
                    names: isList ? pv.names : [],
                    warnings: pv.warnings || [],
                    loading: !!pv.loading,
                    error: pv.error || '',
                };
            },

            // What a browsed list offers the selection. A box with no
            // Repeat may iterate it; a related list only from inside its
            // parent card, as a sub-iteration.
            get queryIterateOffer() {
                const src = this.querySource;
                if (this.queryScope !== 'browse' || !src || src.shape !== 'list') return '';
                const node = this.selectedNode;
                if (!node || Core.kindOf(node) !== 'box' || node.repeat) return 'needs-box';
                if (src.of) {
                    return this.canStartSubIteration && this.relatedListSources.some(s => s.key === src.key)
                        ? 'sub' : 'needs-parent';
                }
                return this.canStartIteration ? 'iterate' : 'nested';
            },

            // The selected box repeats over the browsed list, with the
            // params already set on it.
            iterateSelectedBox() {
                const offer = this.queryIterateOffer;
                if (offer !== 'iterate' && offer !== 'sub') return;
                const src = this.querySource;
                const node = this.selectedNode;
                const page = this.currentPage;
                if (!src || !node || !page) return;
                const params = JSON.parse(JSON.stringify(this.browseParams(src.key)));
                const repeat = { source: src.key, params: params, layout: { direction: 'column', perLine: 1, gap: 12, maxPerPage: 0 }, overflow: 'clip' };
                this.replacePage(Core.updateNode(page, node.id, { repeat: repeat }));
                this.commit();
                this.renderAll();
                this.readProps();
                this.refreshData();
                this.flash((node.name || this.tagLabel(node)) + ' repeats over ' + src.label + '.');
            },

            // Asked for by the builder's section whenever what it shows
            // changes: a browsed pick reads today's rows for itself, so a
            // chip can say what it holds before anything is wired to it.
            ensureQueryPreview() {
                const subject = this.querySubject;
                const src = subject.scope === 'browse' && subject.source ? this.querySource : null;
                if (!src || !this.project) {
                    if (this.data.query.preview.key) this.data.query.preview = emptyQueryPreview();
                    return;
                }
                const params = this.browseParams(src.key);
                const key = src.key + '|' + JSON.stringify(params) + '|' + this.viewDate;
                if (this.data.query.preview.key === key) return;
                return this.loadQueryPreview(src, params, key);
            },

            async loadQueryPreview(src, params, key) {
                this.data.query.preview = Object.assign(emptyQueryPreview(), { key: key, loading: true });
                const Store = global.PrintableDataStore;
                ui.previews = ui.previews || {};
                try {
                    let out = ui.previews[key];
                    if (!out) {
                        if (!Store || typeof db === 'undefined') throw new Error('no store');
                        const bundle = await Store.fetch(db, Data.needsFor(src.key, params, this.viewDate), this.viewer());
                        const res = Data.resolve(src.key, params, bundle, { today: this.viewDate, level: this.permissionLevel, canEdit: this.canEdit });
                        const date = params.when && src.params && src.params.some(p => p.kind === 'when')
                            ? Data.resolveWhen(params.when, this.viewDate) : '';
                        out = {
                            rows: res.rows || [],
                            warnings: res.warnings || [],
                            service: (date && bundle.services && bundle.services[date]) || null,
                            liturgy: bundle.liturgy || null,
                        };
                        ui.previews[key] = out;
                    }
                    if (this.data.query.preview.key !== key) return;
                    const isList = src.shape === 'list';
                    this.data.query.preview = {
                        key: key,
                        loading: false,
                        count: isList ? out.rows.length : null,
                        names: isList ? out.rows.slice(0, 8).map(previewName) : [],
                        row: isList ? {} : (out.rows[0] || {}),
                        warnings: out.warnings.slice(0, 3),
                        service: out.service,
                        liturgy: out.liturgy,
                        error: '',
                    };
                } catch (e) {
                    if (this.data.query.preview.key !== key) return;
                    if (e && e.message !== 'no store') console.error(e);
                    this.data.query.preview = Object.assign(emptyQueryPreview(), { key: key, error: 'Today\'s values did not load. The fields still wire.' });
                }
            },

            get currentPageIndex() {
                const page = this.currentPage;
                if (!page) return -1;
                return this.pages.findIndex(p => p.id === page.id);
            },

            get brandAssets() {
                return (this.project && this.project.assets) || [];
            },

            scalarParams(key) {
                const src = Data.sourceByKey(key);
                if (!src) return {};
                if (!this.data.params[key]) this.data.params[key] = Data.defaultParams(src);
                return this.data.params[key];
            },

            scalarDateMode() {
                const p = Data.scalarDateParams(this.scalarParams('insert_date'));
                return p.mode;
            },

            setScalarDateMode(mode) {
                const p = this.scalarParams('insert_date');
                p.mode = mode;
                if (mode === 'today') p.offsetDays = 0;
                this.renderAll();
            },

            setScalarOffsetDays(n) {
                const p = this.scalarParams('insert_date');
                p.mode = 'offset';
                p.offsetDays = Math.round(Number(n) || 0);
                this.renderAll();
            },

            setScalarFixedDate(dateStr) {
                const p = this.scalarParams('insert_date');
                p.mode = 'fixed';
                p.fixed = dateStr || '';
                this.renderAll();
            },

            setScalarThisSunday() {
                const today = Data.toDateStr(new Date());
                const sunday = Data.sundayOnOrAfter(today);
                const a = today.split('-').map(Number);
                const b = sunday.split('-').map(Number);
                const d0 = new Date(a[0], a[1] - 1, a[2]);
                const d1 = new Date(b[0], b[1] - 1, b[2]);
                const days = Math.round((d1 - d0) / 86400000);
                const p = this.scalarParams('insert_date');
                p.mode = 'offset';
                p.offsetDays = days;
                this.renderAll();
            },

            scalarDatePreview() {
                const row = Data.resolve('insert_date', this.scalarParams('insert_date'), {}, { today: Data.toDateStr(new Date()) }).rows[0];
                return row ? row.value : '';
            },

            setScalarPageStart(n) {
                const p = this.scalarParams('insert_page_number');
                p.startAt = Math.max(1, Math.round(Number(n) || 1));
                this.renderAll();
            },

            scalarPagePreview() {
                const idx = this.currentPageIndex;
                if (idx < 0) return '—';
                const n = Data.insertPageNumberDisplay(idx, this.scalarParams('insert_page_number').startAt);
                return n == null ? 'Before numbering' : ('This page → ' + n);
            },

            assetChipKey(assetId) {
                return 'asset|' + assetId;
            },

            assetKindIcon(kind) {
                return kind === 'font' ? 'font_download' : 'image';
            },

            formatAssetSize(bytes) {
                const n = Number(bytes) || 0;
                if (n < 1024) return n + ' B';
                if (n < 1024 * 1024) return Math.round(n / 1024) + ' KB';
                return (n / (1024 * 1024)).toFixed(1) + ' MB';
            },

            onScalarChipDragStart(e, sourceKey, fieldKey) {
                const src = Data.sourceByKey(sourceKey);
                if (!src) return;
                const field = src.fields.find(f => f.key === fieldKey);
                if (!field) return;
                const params = JSON.parse(JSON.stringify(this.scalarParams(sourceKey)));
                this.dragField = {
                    scope: 'global',
                    source: sourceKey,
                    field: fieldKey,
                    kind: field.kind,
                    params: params,
                    label: field.label,
                };
                this.dropTarget = null;
                try { e.dataTransfer.setData('text/plain', fieldKey); e.dataTransfer.effectAllowed = 'link'; } catch (err) { /* older browsers */ }
                const chip = e.currentTarget;
                this.dragWire = { from: this.pointOf(chip), to: this.pointOf(chip) };
                this.refreshWires();
            },

            onAssetChipDragStart(e, asset) {
                if (!asset) return;
                const kind = asset.kind === 'font' ? 'text' : 'image';
                this.dragField = {
                    scope: 'asset',
                    assetId: asset.id,
                    kind: kind,
                    apply: asset.kind === 'font' ? 'font' : 'image',
                    label: asset.name,
                };
                this.dropTarget = null;
                try { e.dataTransfer.setData('text/plain', asset.id); e.dataTransfer.effectAllowed = 'link'; } catch (err) { /* older browsers */ }
                const chip = e.currentTarget;
                this.dragWire = { from: this.pointOf(chip), to: this.pointOf(chip) };
                this.refreshWires();
            },

            ensurePrintableFontFace(page, asset) {
                if (!page || !asset || asset.kind !== 'font') return page;
                const fam = String(asset.fontFamily || asset.name.replace(/\.[^.]+$/, '')).replace(/"/g, '');
                const token = '/* asset-font-' + asset.id + ' */';
                let css = page.css || '';
                if (css.indexOf(token) !== -1) return page;
                const rule = '@font-face { font-family: "' + fam + '"; src: url("' + asset.url + '"); font-display: swap; }';
                return Object.assign({}, page, { css: (css + '\n' + token + '\n' + rule + '\n').trim() + '\n' });
            },

            async uploadBrandAsset(event) {
                const file = event.target.files && event.target.files[0];
                if (event.target) event.target.value = '';
                this.data.assetUploadError = '';
                if (!file || !this.project) return;
                const isFont = /\.(woff2?|ttf|otf)$/i.test(file.name) || (file.type && /font|woff|ttf|otf/i.test(file.type));
                const intake = global.ImageIntake;
                const heic = intake && intake.isHeic(file);
                const isImage = file.type && /^image\//.test(file.type);
                if (!isFont && !isImage && !heic) {
                    this.data.assetUploadError = 'Upload an image or font file.';
                    return;
                }
                const cap = 8 * 1024 * 1024 - 1;
                let upload = file;
                if (isImage && intake && intake.needsWork(file, cap)) {
                    this.notice = intake.COMPRESSING_MESSAGE;
                    try {
                        upload = await intake.prepare(file, { maxBytes: cap });
                    } catch (err) {
                        this.data.assetUploadError = (err && err.message) || 'Could not read that file.';
                        return;
                    } finally {
                        this.notice = '';
                    }
                } else if (upload.size > cap) {
                    this.data.assetUploadError = 'Files up to 8 MB, please.';
                    return;
                }
                try {
                    const Core = global.PrintableCore;
                    const fileId = (Core && Core.newId ? Core.newId('brand') : String(Date.now())) + '_' + upload.name.replace(/[^\w.-]+/g, '_');
                    const ref = firebase.storage().ref('printable_assets/' + this.project.id + '/' + fileId);
                    await ref.put(upload, { contentType: upload.type || (isFont ? 'font/woff2' : 'image/jpeg') });
                    const url = await ref.getDownloadURL();
                    const asset = {
                        id: fileId,
                        name: upload.name,
                        url: url,
                        kind: isFont ? 'font' : 'image',
                        fontFamily: isFont ? upload.name.replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '_') : '',
                        bytes: upload.size,
                    };
                    this.project.assets = (this.project.assets || []).concat([asset]);
                    this.commit();
                    this.flash('Uploaded ' + asset.name + '. Drag it onto the page.');
                } catch (ex) {
                    console.error(ex);
                    this.data.assetUploadError = 'That file did not upload.';
                }
            },

            get hasOwnRepeat() {
                const n = this.selectedNode;
                return !!(n && n.repeat);
            },

            // A box with no Repeat may repeat over a top-level list —
            // except inside a card whose list has related lists, where an
            // inner box lists a row of that card instead (ADR 0072).
            get canStartIteration() {
                const n = this.selectedNode;
                if (!n || Core.kindOf(n) !== 'box' || n.repeat) return false;
                if (this.repeatContext && this.relatedListSources.length) return false;
                return true;
            },

            // A related list (children of this household) is only for an
            // unbound box sitting inside an iterated card. A child that
            // already has a field wired is a field of the parent row, not
            // a nested list; a text or image cannot stand for a row.
            get canStartSubIteration() {
                const n = this.selectedNode;
                if (!n || Core.kindOf(n) !== 'box' || n.repeat) return false;
                if (!this.repeatContext || n.id === this.repeatContext.id) return false;
                if (this.selectedBindings.length) return false;
                return this.relatedListSources.length > 0;
            },

            // The Repeat a repeating node sits inside, if any.
            repeatAround(node) {
                const page = node && this.pageOfNode(node.id);
                if (!page) return null;
                const chain = Core.ancestorsOf(page, node.id);
                for (let i = chain.length - 1; i >= 0; i--) {
                    if (chain[i].repeat && chain[i].repeat.source) return chain[i];
                }
                return null;
            },

            get repeatPreview() {
                const r = this.repeatContext;
                const res = this.resolver;
                if (!r || !res || !r.repeat.source) return { count: null, names: [] };
                const parent = this.repeatAround(r);
                const parentRow = parent && (res.rowsFor(parent) || [])[0];
                const rows = res.rowsFor(r, parentRow) || [];
                return {
                    count: rows.length,
                    names: rows.slice(0, 8).map(previewName),
                };
            },

            // The fields a row of the selection's list carries, as chips.
            get itemFields() {
                const r = this.repeatContext;
                if (!r || !r.repeat.source) return [];
                if (r.repeat.source === 'event_list') {
                    const Link = linkFields();
                    const input = Link && Link.inputById(this.project, r.repeat.params && r.repeat.params.inputId);
                    return (input && input.fields || []).map(f => ({ key: f.id, label: f.label, kind: f.kind }));
                }
                return Data.fieldsFor(r.repeat.source, r.repeat.params, this.data.options)
                    .filter(f => !f.minLevel || Data.mayRead(this.permissionLevel, f.minLevel));
            },

            specEmptyLabel(spec) {
                return specEmptyLabel(spec);
            },

            formatTypedDate(date) {
                return Data.formatDate(date, 'medium');
            },

            kindIcon(kind) {
                return kind === 'image' ? 'image' : kind === 'date' ? 'event' : kind === 'number' ? 'tag' : 'title';
            },

            rolesFor(seriesId) {
                const s = this.data.options.series.find(x => x.id === seriesId);
                const slugs = s ? s.roleSlugs : [];
                const roles = this.data.options.roles;
                if (!slugs.length) return roles;
                return slugs.map(slug => roles.find(r => r.slug === slug) || { slug: slug, name: Data.roleLabel(slug, { roles: roles }) });
            },

            // ── Wiring ───────────────────────────────────────────────────

            chipKey(scope, source, field) {
                return scope + '|' + source + '|' + field;
            },

            // A chip carries the params it was shown with: the builder's for
            // a browsed source, the wire's own for a chip already wired.
            onChipDragStart(e, scope, source, field, carried) {
                const key = (source && source.key) || source;
                const params = scope === 'item' ? null : JSON.parse(JSON.stringify(carried || this.browseParams(key)));
                this.dragField = { scope: scope, source: key, field: field.key, kind: field.kind, params: params, label: field.label };
                this.dropTarget = null;
                try { e.dataTransfer.setData('text/plain', field.key); e.dataTransfer.effectAllowed = 'link'; } catch (err) { /* older browsers */ }
                const chip = e.currentTarget;
                this.dragWire = { from: this.pointOf(chip), to: this.pointOf(chip) };
                this.refreshWires();
            },

            onChipDragEnd() {
                this.dragField = null;
                this.dropTarget = null;
                this.dragWire = null;
                this.refreshWires();
            },

            onCanvasDragOver(e) {
                if (!this.dragField) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'link';
                const main = document.querySelector('.pe-main').getBoundingClientRect();
                if (this.dragWire) this.dragWire.to = { x: e.clientX - main.left, y: e.clientY - main.top };
                const under = document.elementFromPoint(e.clientX, e.clientY);
                const el = under && under.closest && under.closest('[data-pid]');
                let target = null;
                if (el) {
                    const nodeId = Render.originalId(el.getAttribute('data-pid'));
                    const page = this.pageOfNode(nodeId);
                    const node = page && Core.findNode(page, nodeId);
                    if (node && this.mayBind(node, this.dragField)) target = { nodeId: nodeId, pageId: page.id };
                }
                if ((target && target.nodeId) !== (this.dropTarget && this.dropTarget.nodeId)) {
                    this.dropTarget = target;
                    this.hover.nodeId = target ? target.nodeId : null;
                    this.refreshOverlays();
                }
                this.refreshWires();
            },

            // An item chip may only land inside its own list; a global chip
            // may land anywhere its kind fits.
            mayBind(node, field) {
                if (field.scope === 'asset') {
                    if (field.apply === 'font') return Core.kindOf(node) === 'text';
                    return Core.kindOf(node) === 'image';
                }
                if (!Data.accepts(Core.kindOf(node), field.kind)) return false;
                if (field.scope !== 'item') return true;
                const page = this.pageOfNode(node.id);
                const chain = Core.ancestorsOf(page, node.id).concat(node);
                const owner = this.repeatContext;
                return !!owner && chain.some(n => n.id === owner.id);
            },

            onCanvasDrop(e) {
                if (!this.dragField) return;
                e.preventDefault();
                const target = this.dropTarget;
                const field = this.dragField;
                this.onChipDragEnd();
                if (!target) return;
                this.bindField(target.pageId, target.nodeId, field);
            },

            bindField(pageId, nodeId, field) {
                const page = this.pages.find(p => p.id === pageId);
                let node = page && Core.findNode(page, nodeId);
                if (!node) return;
                const prop = field.scope === 'asset'
                    ? (field.apply === 'font' ? 'text' : 'src')
                    : Data.propFor(field.kind);
                const bind = Object.assign({}, node.bind || {});
                if (field.scope === 'asset') {
                    bind[prop] = { scope: 'asset', assetId: field.assetId, apply: field.apply || 'image' };
                    let nextPage = page;
                    if (field.apply === 'font') {
                        const asset = (this.project.assets || []).find(a => a.id === field.assetId);
                        nextPage = this.ensurePrintableFontFace(page, asset);
                    }
                    this.replacePage(Core.updateNode(nextPage, nodeId, { bind: bind }));
                } else {
                    const wire = field.scope === 'item'
                        ? { scope: 'item', field: field.field }
                        : { scope: 'global', source: field.source, params: field.params || {}, field: field.field };
                    if (field.reading === 'passage') {
                        const Passage = global.ScripturePassage;
                        wire.reading = 'passage';
                        wire.passage = Passage ? Passage.normalize(field.passage) : (field.passage || {});
                    }
                    bind[prop] = wire;
                    this.replacePage(Core.updateNode(page, nodeId, { bind: bind }));
                }
                this.commit();
                if (field.scope === 'item' || field.scope === 'asset') { this.rebindData(); this.renderAll(); }
                else if (field.source === 'insert_date' || field.source === 'insert_page_number') {
                    this.rebindData();
                    this.renderAll();
                }
                else this.refreshData();
                this.select(pageId, nodeId);
                this.flash('Wired ' + (node.name || this.tagLabel(node)) + ' to ' + field.label + '.');
            },

            unbind(prop) {
                const page = this.currentPage;
                const node = this.selectedNode;
                if (!page || !node || !node.bind) return;
                const bind = Object.assign({}, node.bind);
                delete bind[prop];
                this.replacePage(Core.updateNode(page, node.id, { bind: Object.keys(bind).length ? bind : null }));
                this.commit();
                this.renderAll();
                this.readProps();
            },

            // What the element panel says about each wire on the selection.
            get selectedBindings() {
                const node = this.selectedNode;
                if (!node || !node.bind) return [];
                return Object.keys(node.bind).map(prop => {
                    const b = node.bind[prop];
                    let label;
                    if (b.scope === 'asset') {
                        const a = (this.project.assets || []).find(x => x.id === b.assetId);
                        label = (a ? a.name : 'File') + (b.apply === 'font' ? ' › Font' : ' › Picture');
                    } else if (b.scope === 'item') {
                        const src = this.repeatSource;
                        const eventCol = this.repeatContext && this.repeatContext.repeat && this.repeatContext.repeat.source === 'event_list'
                            ? this.itemFields.find(x => x.key === b.field)
                            : null;
                        const f = eventCol || (src && Data.fieldsFor(src, this.repeatContext.repeat.params, this.data.options).find(x => x.key === b.field));
                        label = 'Each row › ' + (f ? f.label : b.field);
                    } else if (b.source === 'event_field') {
                        const Link = linkFields();
                        const input = Link && Link.inputById(this.project, b.field);
                        label = 'Filled on the event › ' + (input ? input.label : b.field);
                    } else {
                        const src = Data.sourceByKey(b.source);
                        const f = src && Data.fieldsFor(src, b.params, this.data.options).find(x => x.key === b.field);
                        label = (src ? src.label : b.source) + ' › ' + (f ? f.label : b.field);
                    }
                    const detail = b.scope === 'global' ? Data.describeParams(b.source, b.params, this.data.options) : '';
                    return { prop: prop, label: label, detail: detail, bind: b, propLabel: prop === 'src' ? 'Picture' : 'Text' };
                });
            },

            // Change a global binding's params from the element panel.
            setBindParam(prop, key, value) {
                const page = this.currentPage;
                const node = this.selectedNode;
                if (!page || !node || !node.bind || !node.bind[prop]) return;
                const bind = JSON.parse(JSON.stringify(node.bind));
                bind[prop].params = Object.assign({}, bind[prop].params || {}, { [key]: value });
                this.replacePage(Core.updateNode(page, node.id, { bind: bind }));
                this.commit();
                this.refreshData();
            },

            isScriptureBind(b) {
                if (!b || !b.bind) return false;
                const liturgy = this.data && this.data.options && this.data.options.liturgy;
                if (Data.isScriptureField) return Data.isScriptureField(b.bind.field, liturgy);
                const Passage = global.ScripturePassage;
                return !!(Passage && Passage.isScriptureField(b.bind.field));
            },

            passageOf(b) {
                const Passage = global.ScripturePassage;
                return Passage ? Passage.normalize(b && b.bind && b.bind.passage) : {};
            },

            // Citation is the reference as typed. Passage is the verses,
            // with the presentation stored on the wire (ADR 0079).
            setReading(prop, reading) {
                const page = this.currentPage;
                const node = this.selectedNode;
                if (!page || !node || !node.bind || !node.bind[prop]) return;
                const Passage = global.ScripturePassage;
                const bind = JSON.parse(JSON.stringify(node.bind));
                if (reading === 'passage') {
                    bind[prop].reading = 'passage';
                    bind[prop].passage = Passage ? Passage.normalize(bind[prop].passage) : {};
                } else {
                    delete bind[prop].reading;
                    delete bind[prop].passage;
                }
                this.replacePage(Core.updateNode(page, node.id, { bind: bind }));
                this.commit();
                this.refreshData();
            },

            setPassage(prop, patch) {
                const page = this.currentPage;
                const node = this.selectedNode;
                if (!page || !node || !node.bind || !node.bind[prop]) return;
                const Passage = global.ScripturePassage;
                const bind = JSON.parse(JSON.stringify(node.bind));
                bind[prop].reading = 'passage';
                bind[prop].passage = Passage.normalize(Object.assign({}, bind[prop].passage || {}, patch));
                this.replacePage(Core.updateNode(page, node.id, { bind: bind }));
                this.commit();
                this.refreshData();
            },

            async openSendSnapshot() {
                this.fileMenu = false;
                this.sendingSnapshot = true;
                this.snapshotListLoading = true;
                this.snapshotTargetError = '';
                this.snapshotSendProgress = '';
                this.snapshotTargets = [];
                try {
                    const from = Data.addDays(this.viewDate, -7);
                    const to = Data.addDays(this.viewDate, 28);
                    const personId = (this.currentUserData && this.currentUserData.personId) || null;
                    const rows = await global.EventsStore.loadCalendar(db, {
                        from: from, to: to, rank: this.permissionLevel, personId: personId,
                    });
                    this.snapshotTargets = Data.orderSnapshotTargets(rows, this.viewDate);
                } catch (e) {
                    console.error(e);
                    this.snapshotTargetError = 'The events did not load. Try again.';
                } finally {
                    this.snapshotListLoading = false;
                }
            },

            closeSendSnapshot() {
                if (this.snapshotSendProgress) return;
                this.sendingSnapshot = false;
            },

            async sendSnapshotTo(target) {
                if (!target || !target.occurrence || this.snapshotSendProgress) return;
                const occurrence = target.occurrence;
                this.snapshotTargetError = '';
                this.snapshotSendProgress = 'Reading the data…';
                try {
                    const record = this.project;
                    if (!record || !record.template) throw new Error('not laid out');
                    const clock = occurrence.date || this.viewDate;
                    const needs = Live.collectNeeds(record, clock, { occurrenceId: occurrence.id });
                    const bundle = await global.PrintableDataStore.fetch(db, needs, this.viewer());
                    const resolver = Live.resolver(record, bundle, {
                        level: this.permissionLevel, canEdit: true, today: clock,
                    });
                    const host = document.createElement('div');
                    host.style.cssText = 'position:absolute;left:-100000px;top:0;visibility:hidden;pointer-events:none;';
                    document.body.appendChild(host);
                    let entries;
                    try { entries = Live.layoutPages(record, resolver, host); }
                    finally { host.remove(); }
                    const Ex = global.PrintableExportCore;
                    const booklet = !!(Ex && Ex.isSundayBookletPath(record));
                    const printCount = Ex ? Ex.exportPageCount(entries.length, record) : entries.length;
                    this.snapshotSendProgress = 'Drawing ' + printCount + ' page' + (printCount === 1 ? '' : 's') + (booklet ? '…' : '…');
                    const blob = await global.PrintablePdf.render(record, entries, {
                        scale: 1,
                        onProgress: (done, total) => { this.snapshotSendProgress = 'Drawing page ' + done + ' of ' + total + '…'; },
                    });
                    this.snapshotSendProgress = 'Filing…';
                    const Store = global.EventsStore;
                    const Attachments = global.EventAttachmentsCore;
                    await Store.ensureOccurrenceDocument(db, occurrence);
                    const name = global.PrintablePdf.fileName(record, occurrence.date);
                    const attachmentId = Store.newAttachmentId(db, occurrence.id);
                    const path = Attachments.storagePath(occurrence.id, attachmentId, name);
                    await firebase.storage().ref().child(path).put(blob, { contentType: 'application/pdf' });
                    const personId = (this.currentUserData && this.currentUserData.personId) || null;
                    const attachment = Attachments.buildAttachmentRecord({
                        name: name,
                        contentType: 'application/pdf',
                        size: blob.size,
                        storagePath: path,
                        uploadedBy: this.currentUser && this.currentUser.uid,
                        uploadedByName: personId ? null : (this.currentUserData && (this.currentUserData.displayName || this.currentUserData.name)) || null,
                        uploadedAt: new Date().toISOString(),
                    });
                    await Store.saveAttachment(db, occurrence.id, attachmentId, attachment);
                    this.snapshotSendProgress = '';
                    this.sendingSnapshot = false;
                    if (this.flash) this.flash('Filed on ' + (occurrence.name || 'the event') + ' · ' + occurrence.date + '.');
                } catch (e) {
                    console.error(e);
                    this.snapshotSendProgress = '';
                    this.snapshotTargetError = 'That snapshot could not be filed. Try again.';
                }
            },

            // ── Wires drawn on screen ────────────────────────────────────

            pointOf(el) {
                const main = document.querySelector('.pe-main');
                if (!el || !main) return { x: 0, y: 0 };
                const r = el.getBoundingClientRect();
                const m = main.getBoundingClientRect();
                return { x: r.left - m.left, y: r.top - m.top + r.height / 2, w: r.width, h: r.height };
            },

            // A selection wire lands on the query builder when the bind is a
            // catalog query source. Fill-ins, page inserts, and assets draw
            // no line — there is no query-builder home for them.
            wireLandsOnQuery(bind) {
                if (!bind || bind.scope === 'asset') return false;
                const source = bind.source || (this.repeatContext && this.repeatContext.repeat && this.repeatContext.repeat.source) || '';
                if (!source || source === 'event_field' || source === 'event_list') return false;
                const src = Data.sourceByKey(source);
                return drawerPartOf(src || source) === 'query';
            },

            // When the selection is wired to a query source, show that source
            // in the builder so the line and the menu agree.
            syncQueryToSelection() {
                const node = this.selectedNode;
                if (!node || !node.bind) return;
                const prop = Object.keys(node.bind)[0];
                const b = prop && node.bind[prop];
                if (!b || !this.wireLandsOnQuery(b)) return;
                if (b.scope === 'item') {
                    const repeat = this.repeatContext && this.repeatContext.repeat;
                    if (repeat && repeat.source) this.setQuerySource(repeat.source);
                    return;
                }
                if (b.source && this.data.query.source !== b.source) {
                    this.setQuerySource(b.source);
                }
                if (b.params && typeof b.params === 'object') {
                    this.data.params[b.source] = Object.assign({}, this.browseParams(b.source), b.params);
                }
            },

            scrollQueryIntoDrawer() {
                const body = document.querySelector('.pe-drawer__body');
                const query = document.querySelector('.pe-query');
                if (!body || !query) return;
                const delta = PrintableEditorWires.drawerScrollDelta(
                    body.getBoundingClientRect(), query.getBoundingClientRect()
                );
                if (delta) body.scrollTop += delta;
            },

            // The line runs from the selected element to the query builder.
            // Pin (scroll the builder into view) only when the selection changes.
            refreshWires(opts) {
                const wires = [];
                const main = document.querySelector('.pe-main');
                const viewport = document.getElementById('pe-viewport');
                const query = document.querySelector('.pe-query');
                const node = this.selectedNode;
                const nodeId = node && node.id;
                const pin = !!(opts && opts.pinChip)
                    || !!(nodeId && nodeId !== this._wirePinnedFor);
                if (nodeId) this._wirePinnedFor = nodeId;
                else this._wirePinnedFor = null;
                const prev = this._wireKeys || {};
                const nextKeys = {};
                const repeatSource = this.repeatContext && this.repeatContext.repeat
                    ? this.repeatContext.repeat.source : '';
                if (pin && node) this.syncQueryToSelection();
                if (main && node && node.bind && !this.dragWire && query) {
                    Object.keys(node.bind).forEach(prop => {
                        const b = node.bind[prop];
                        if (!this.wireLandsOnQuery(b)) return;
                        const key = PrintableEditorWires.wireKey(b, repeatSource);
                        if (pin) this.scrollQueryIntoDrawer();
                        const el = ui.world && ui.world.querySelector('[data-pid="' + node.id + '"]');
                        if (!el) return;
                        if (viewport && !PrintableEditorWires.elementOnCanvas(el.getBoundingClientRect(), viewport.getBoundingClientRect())) return;
                        const a = this.pointOf(el);
                        const c = this.pointOf(query);
                        const enter = !prev[key];
                        nextKeys[key] = true;
                        wires.push({ x1: a.x + a.w, y1: a.y, x2: c.x, y2: c.y, key: key, enter: enter });
                    });
                }
                if (this.dragWire) wires.push({ x1: this.dragWire.to.x, y1: this.dragWire.to.y, x2: this.dragWire.from.x, y2: this.dragWire.from.y, live: true });
                this.wires = wires;
                this._wireKeys = nextKeys;
                // Drawn by hand: Alpine's <template> does not exist inside an
                // <svg>. Paths are kept in place so a draw-on is not killed
                // by the next overlay refresh.
                PrintableEditorWires.syncWirePaths(document.getElementById('pe-wires'), wires, w => this.wirePath(w));
            },

            wirePath(w) {
                const dx = Math.max(40, Math.abs(w.x2 - w.x1) / 2);
                return 'M ' + w.x1 + ' ' + w.y1 + ' C ' + (w.x1 + dx) + ' ' + w.y1 + ', ' + (w.x2 - dx) + ' ' + w.y2 + ', ' + w.x2 + ' ' + w.y2;
            },

            // ── Iteration ────────────────────────────────────────────────

            // From the context menu: the box becomes iterated over nothing
            // yet, and the query builder opens its menu on the lists it may
            // repeat over.
            makeIterated() {
                const node = this.selectedNode;
                if (!node) return;
                if (Core.kindOf(node) !== 'box') {
                    this.flash('Iterate a box — put this element in one first (right-click › Wrap in a box).');
                    return;
                }
                if (!node.repeat) {
                    const page = this.currentPage;
                    this.replacePage(Core.updateNode(page, node.id, { repeat: { source: '', params: {}, layout: { direction: 'column', perLine: 1, gap: 12, maxPerPage: 0 }, overflow: 'clip' } }));
                    this.commit();
                    this.renderAll();
                    this.readProps();
                }
                this.data.search = '';
                this.data.queryMenuOpen = true;
            },

            // A repeating box changes the list it repeats over. Params the
            // box already set survive only when the list is the same.
            chooseList(source) {
                const page = this.currentPage;
                const node = this.selectedNode;
                if (!page || !node || !source) return;
                if (Core.kindOf(node) !== 'box' || !node.repeat) return;
                const same = node.repeat && node.repeat.source === source.key;
                const params = same
                    ? Object.assign({}, Data.defaultParams(source.key), node.repeat.params || {})
                    : Data.defaultParams(source.key);
                const repeat = Object.assign({}, node.repeat || { layout: { direction: 'column', perLine: 1, gap: 12, maxPerPage: 0 }, overflow: 'clip' }, {
                    source: source.key,
                    params: params,
                });
                this.replacePage(Core.updateNode(page, node.id, { repeat: repeat }));
                this.commit();
                this.readProps();
                this.refreshData();
            },

            stopIterating() {
                const page = this.currentPage;
                const node = this.selectedNode;
                if (!page || !node || !node.repeat) return;
                // Row bindings inside it would have nothing to read from.
                let next = Core.updateNode(page, node.id, { repeat: null });
                Core.walk([Core.findNode(next, node.id)], n => {
                    if (!n.bind) return;
                    const kept = {};
                    Object.keys(n.bind).forEach(p => { if (n.bind[p].scope !== 'item') kept[p] = n.bind[p]; });
                    next = Core.updateNode(next, n.id, { bind: Object.keys(kept).length ? kept : null });
                });
                this.replacePage(next);
                this.commit();
                this.renderAll();
                this.readProps();
            },

            // The builder's params land on the Repeat it is showing. A
            // query above this viewer stays as it was saved, and still runs.
            setRepeatParam(key, value) {
                const r = this.queryRepeatNode;
                const page = this.pageOfNode(r && r.id);
                if (!r || !page || this.queryLocked) return;
                if (!this.querySpecs.some(s => s.key === key)) return;
                const params = Object.assign({}, r.repeat.params || {}, { [key]: value });
                this.replacePage(Core.updateNode(page, r.id, { repeat: Object.assign({}, r.repeat, { params: params }) }));
                this.commit();
                this.refreshData();
            },

            setRepeatLayout(key, value) {
                const r = this.repeatContext;
                const page = this.pageOfNode(r && r.id);
                if (!r || !page) return;
                const layout = Object.assign({}, r.repeat.layout, { [key]: value });
                this.replacePage(Core.updateNode(page, r.id, { repeat: Object.assign({}, r.repeat, { layout: layout }) }));
                this.commit();
                this.renderAll();
            },

            setRepeatOverflow(value) {
                const r = this.repeatContext;
                const page = this.pageOfNode(r && r.id);
                if (!r || !page) return;
                this.replacePage(Core.updateNode(page, r.id, { repeat: Object.assign({}, r.repeat, { overflow: value }) }));
                this.commit();
                this.renderAll();
            },

            setContinueWith(pageId) {
                const r = this.repeatContext;
                const page = this.pageOfNode(r && r.id);
                if (!r || !page) return;
                this.replacePage(Core.updateNode(page, r.id, { repeat: Object.assign({}, r.repeat, { continueWith: pageId || null }) }));
                this.commit();
                this.renderAll();
            },

            // Which pages may be copied for the list's new pages: only those
            // that carry the list, since a page without it has nowhere to put
            // the rows.
            get continuationPages() {
                const r = this.repeatContext;
                if (!r) return [];
                return this.pages
                    .map((pg, i) => ({
                        id: pg.id,
                        label: 'Page ' + (i + 1) + (pg.name ? ' · ' + pg.name : ''),
                        has: !!(Render.overflowingRepeats(pg)[0] || Core.findNode(pg, r.id)),
                    }))
                    .filter(x => x.has);
            },

            // Sub-fields of a param, for the small editors: a `when`, a range.
            whenMode(v) { return (v && v.mode) || 'this'; },
            rangeMode(v) { return (v && v.mode) || 'relative'; },

            // A range on the Sundays list counts Sundays; on event dates it
            // counts weeks. The catalog says which.
            rangeUnitLabel(spec) {
                const unit = String((spec && spec.unit) || 'weeks');
                return unit.charAt(0).toUpperCase() + unit.slice(1);
            },

            // Switching how a range counts starts from the catalog's default
            // for that way of counting. Pressing the way it already counts
            // keeps the numbers the editor chose.
            setRangeMode(spec, mode) {
                if (this.rangeMode(this.queryParam(spec.key)) === mode) return;
                this.setQueryParam(spec.key, Data.rangeForMode(spec, mode));
            },

            setRangePart(spec, key, value) {
                this.setQueryParam(spec.key, Object.assign({}, this.queryParam(spec.key), { [key]: value }));
            },

            // "For the 5 Sundays from this Sunday." — the range read back.
            rangeWords(spec) {
                const words = Data.describeRange(this.queryParam(spec.key), spec.unit);
                return words.charAt(0).toUpperCase() + words.slice(1) + '.';
            },

            // How many rows the selection's list resolved to, for the panel.
            get repeatRowCount() {
                const r = this.repeatContext;
                const res = this.resolver;
                if (!r || !res || !r.repeat.source) return null;
                const rows = res.rowsFor(r);
                return rows ? rows.length : null;
            },

            // ── Warnings ─────────────────────────────────────────────────

            goToWarning(w) {
                if (w.kind === 'element' && w.pageId) {
                    this.select(w.pageId, w.nodeId);
                    this.scrollToPage(w.pageId);
                }
            },

            // ── Sunday booklet text (MS-588) ─────────────────────────────
            // Typed once on the Sunday; every bound Printable reads it. It is
            // a blank, so it lives in the Fill-in library: which Sunday, its
            // chips, and the form that fills them.

            typedSundayDate() {
                const clock = this.viewDate || Data.toDateStr(new Date());
                if (!Data.sourceByKey('sunday_typed')) return clock;
                return Data.resolveWhen(this.browseParams('sunday_typed').when, clock);
            },

            get typedWhen() {
                return this.browseParams('sunday_typed').when;
            },

            // Another Sunday's text: its chips carry that Sunday, and the
            // form opens on what was typed for it.
            setTypedWhen(when) {
                if (!when || !when.mode) return;
                this.data.params.sunday_typed = Object.assign({}, this.browseParams('sunday_typed'), { when: when });
                this.loadTypedDraft();
            },

            get sundayTypedChips() {
                const row = this.data.typed.row || {};
                return typedChipFields(Data.fieldsFor('sunday_typed')).map(f => ({
                    key: f.key,
                    label: f.label,
                    kind: f.kind,
                    value: chipPreview(f.kind, row[f.key]),
                }));
            },

            // What the chips say today: the typed text of that Sunday, read
            // the way a wire would read it.
            typedRowFor(date, service) {
                try {
                    const res = Data.resolve('sunday_typed', { when: { mode: 'date', date: date } }, { services: { [date]: service } }, {
                        today: this.viewDate, level: this.permissionLevel,
                    });
                    return (service && res.rows && res.rows[0]) || {};
                } catch (e) {
                    return {};
                }
            },

            setViewDate(date) {
                if (!Data.isDateStr(date) || date === this.viewDate) return;
                this.viewDate = date;
                try {
                    const url = new URL(global.location.href);
                    url.searchParams.set('asOf', date);
                    global.history.replaceState(null, '', url);
                } catch (e) { /* keep the clock even if the address cannot change */ }
                this.refreshData();
                if (this.loadTypedDraft) this.loadTypedDraft();
            },

            stepViewDate(direction) {
                this.setViewDate(Data.addDays(this.viewDate, direction < 0 ? -7 : 7));
            },

            get viewHref() {
                const id = this.id || '';
                let href = 'printable-view.html?id=' + encodeURIComponent(id) + '&asOf=' + encodeURIComponent(this.viewDate || '');
                if (this.occurrenceId) href += '&occurrence=' + encodeURIComponent(this.occurrenceId);
                return href;
            },

            // ── A Sunday's fields, grouped by its order ──────────────────

            // The Sunday the builder is browsing decides the order its chips
            // follow (ADR 0080): the builder's own read of it when there is
            // one, else whatever the page already fetched for that date.
            sundayDrawer() {
                const fill = (global.SundayTypedCore && global.SundayTypedCore.FIELDS) || [];
                const pv = this.data && this.data.query && this.data.query.preview;
                const fromPreview = !!(pv && pv.key && pv.key.indexOf('sunday|') === 0 && (pv.service || pv.liturgy));
                const liturgy = (fromPreview && pv.liturgy) || (this.data && this.data.options && this.data.options.liturgy);
                let service = fromPreview ? pv.service : null;
                if (!service && ui.bundle && ui.bundle.services && Data) {
                    const date = Data.resolveWhen(this.browseParams('sunday').when, this.viewDate);
                    service = ui.bundle.services[date] || null;
                }
                return PrintableEditorWires.sundayDrawerFields(Data, global.ScripturePassage, fill, {
                    liturgy: liturgy,
                    service: service,
                });
            },

            onSundayChipDragStart(e, sourceKey, field) {
                const src = Data.sourceByKey(sourceKey);
                if (!src || !field) return;
                this.onChipDragStart(e, 'global', src, field);
            },

            // A scripture chip carries the Sunday the builder is on, so a
            // reading for next Sunday stays next Sunday's once wired.
            onScriptureChipDragStart(e, ref, mode, params) {
                const Passage = global.ScripturePassage;
                const field = {
                    scope: 'global',
                    source: 'sunday',
                    field: ref.key,
                    kind: 'text',
                    params: JSON.parse(JSON.stringify(params || this.browseParams('sunday'))),
                    label: ref.label + (mode === 'passage' ? ' (words)' : ' (reference)'),
                };
                if (mode === 'passage' && Passage) {
                    field.reading = 'passage';
                    field.passage = Passage.normalize(null);
                }
                this.dragField = field;
                this.dropTarget = null;
                try { e.dataTransfer.setData('text/plain', ref.key); e.dataTransfer.effectAllowed = 'link'; } catch (err) { /* older browsers */ }
                const chip = e.currentTarget;
                this.dragWire = { from: this.pointOf(chip), to: this.pointOf(chip) };
                this.refreshWires();
            },

            scriptureChipKey(ref, mode) {
                return PrintableEditorWires.wireKey({
                    scope: 'global', source: 'sunday', field: ref.key,
                    reading: mode === 'passage' ? 'passage' : '',
                }, '');
            },

            // The chips the selection is actually wired to. They sit at the
            // top of the drawer so the connector has a chip on screen even
            // when that field's catalog card is hidden.
            get connectedChips() {
                const node = this.selectedNode;
                if (!node || !node.bind) return [];
                const repeatSource = this.repeatContext && this.repeatContext.repeat
                    ? this.repeatContext.repeat.source : '';
                return Object.keys(node.bind).map(prop => {
                    const b = node.bind[prop];
                    return {
                        prop: prop,
                        key: PrintableEditorWires.wireKey(b, repeatSource),
                        label: this.connectedChipLabel(b),
                        kind: this.connectedChipKind(b),
                        bind: b,
                    };
                });
            },

            connectedChipLabel(b) {
                if (!b) return '';
                if (b.scope === 'asset') return 'Brand asset';
                const liturgy = this.data && this.data.options && this.data.options.liturgy;
                if (b.source === 'sunday' && Data.isScriptureField && Data.isScriptureField(b.field, liturgy)) {
                    const fromDrawer = (this.sundayDrawer().scripture || []).find(f => f.key === b.field);
                    const name = (fromDrawer && fromDrawer.label) || SCRIPTURE_LABELS[b.field] || b.field;
                    return name + (b.reading === 'passage' ? ' · Words' : ' · Reference');
                }
                const src = b.source ? Data.sourceByKey(b.source) : null;
                const fields = src
                    ? Data.fieldsFor(src, b.params || {}, this.data && this.data.options)
                    : [];
                const field = fields.find(f => f.key === b.field)
                    || (src && (src.fields || []).find(f => f.key === b.field));
                if (b.scope === 'item') return (field && field.label) || b.field || 'This row';
                const sourceLabel = (src && src.label) || b.source || '';
                const fieldLabel = (field && field.label) || b.field || '';
                return sourceLabel && fieldLabel ? sourceLabel + ' · ' + fieldLabel : (fieldLabel || sourceLabel);
            },

            connectedChipKind(b) {
                if (!b) return 'text';
                if (b.scope === 'asset') return 'image';
                if (b.source === 'event_field') {
                    const input = (this.eventInputs || []).find(i => i.id === b.field);
                    return (input && input.kind) || 'text';
                }
                const src = b.source ? Data.sourceByKey(b.source) : null;
                const field = src && (src.fields || []).find(f => f.key === b.field);
                return (field && field.kind) || 'text';
            },

            onConnectedChipDragStart(e, chip) {
                const b = chip && chip.bind;
                if (!b) return;
                const liturgy = this.data && this.data.options && this.data.options.liturgy;
                if (b.source === 'sunday' && Data.isScriptureField && Data.isScriptureField(b.field, liturgy)) {
                    this.onScriptureChipDragStart(e, { key: b.field, label: chip.label }, b.reading === 'passage' ? 'passage' : 'citation', b.params);
                    return;
                }
                if (b.scope === 'asset') return;
                const repeatSource = this.repeatContext && this.repeatContext.repeat
                    ? this.repeatContext.repeat.source : '';
                const source = b.scope === 'item'
                    ? { key: repeatSource || b.source || '' }
                    : (Data.sourceByKey(b.source) || { key: b.source });
                this.onChipDragStart(e, b.scope === 'item' ? 'item' : 'global', source, {
                    key: b.field, kind: chip.kind || 'text', label: chip.label,
                }, b.scope === 'item' ? null : (b.params || {}));
            },

            // ── Filled on the event ──────────────────────────────────────

            get eventInputs() {
                const Link = linkFields();
                return Link ? Link.normalizeInputs(this.project && this.project.inputs) : [];
            },

            eventKindLabel(kind) {
                const Link = linkFields();
                return Link ? Link.kindLabel(kind) : kind;
            },

            addEventInput(kind) {
                const Link = linkFields();
                if (!Link || !this.project || !this.canEdit) return;
                const n = (this.project.inputs || []).length + 1;
                const names = { text: 'Text', image: 'Image', number: 'Number', date: 'Date', list: 'List' };
                const input = Link.newInput(kind, (names[kind] || 'Field') + ' ' + n, Core.newId('in'));
                if (!input) return;
                if (input.kind === 'list') {
                    input.fields = [Link.newColumn('text', 'Name', Core.newId('col'))].filter(Boolean);
                }
                this.project.inputs = Link.normalizeInputs((this.project.inputs || []).concat([input]));
                this.commit();
            },

            renameEventInput(id, label) {
                const Link = linkFields();
                if (!Link || !this.project) return;
                this.project.inputs = Link.normalizeInputs((this.project.inputs || []).map(input => {
                    if (input.id !== id) return input;
                    return Object.assign({}, input, { label: label });
                }));
                this.commit();
            },

            addEventColumn(inputId) {
                const Link = linkFields();
                if (!Link || !this.project) return;
                const col = Link.newColumn('text', 'Column', Core.newId('col'));
                if (!col) return;
                this.project.inputs = Link.normalizeInputs((this.project.inputs || []).map(input => {
                    if (input.id !== inputId || input.kind !== 'list') return input;
                    return Object.assign({}, input, { fields: (input.fields || []).concat([col]) });
                }));
                this.commit();
            },

            renameEventColumn(inputId, columnId, label) {
                const Link = linkFields();
                if (!Link || !this.project) return;
                this.project.inputs = Link.normalizeInputs((this.project.inputs || []).map(input => {
                    if (input.id !== inputId || input.kind !== 'list') return input;
                    return Object.assign({}, input, {
                        fields: (input.fields || []).map(col => col.id === columnId ? Object.assign({}, col, { label: label }) : col),
                    });
                }));
                this.commit();
            },

            removeEventColumn(inputId, columnId) {
                const Link = linkFields();
                if (!Link || !this.project) return;
                this.project.inputs = Link.normalizeInputs((this.project.inputs || []).map(input => {
                    if (input.id !== inputId || input.kind !== 'list') return input;
                    return Object.assign({}, input, { fields: (input.fields || []).filter(col => col.id !== columnId) });
                }));
                this.commit();
            },

            removeEventInput(id) {
                const Link = linkFields();
                if (!Link || !this.project) return;
                this.project.inputs = Link.normalizeInputs((this.project.inputs || []).filter(input => input.id !== id));
                (this.project.pages || []).forEach(page => {
                    let next = page;
                    Core.walk(page.nodes, node => {
                        if (node.repeat && node.repeat.source === 'event_list' && node.repeat.params && node.repeat.params.inputId === id) {
                            next = Core.updateNode(next, node.id, { repeat: null });
                        }
                        if (!node.bind) return;
                        const kept = {};
                        Object.keys(node.bind).forEach(prop => {
                            const b = node.bind[prop];
                            if (b && b.source === 'event_field' && b.field === id) return;
                            kept[prop] = b;
                        });
                        if (Object.keys(kept).length !== Object.keys(node.bind).length) {
                            next = Core.updateNode(next, node.id, { bind: Object.keys(kept).length ? kept : null });
                        }
                    });
                    if (next !== page) this.replacePage(next);
                });
                this.commit();
                this.refreshData();
            },

            onEventChipDragStart(e, input) {
                if (!input || input.kind === 'list') return;
                this.dragField = {
                    scope: 'global',
                    source: 'event_field',
                    field: input.id,
                    kind: input.kind,
                    params: {},
                    label: input.label,
                };
                this.dropTarget = null;
                try { e.dataTransfer.setData('text/plain', input.id); e.dataTransfer.effectAllowed = 'link'; } catch (err) { /* older browsers */ }
                const chip = e.currentTarget;
                this.dragWire = { from: this.pointOf(chip), to: this.pointOf(chip) };
                this.refreshWires();
            },

            onEventColumnDragStart(e, input, col) {
                this.dragField = {
                    scope: 'item',
                    source: 'event_list',
                    field: col.id,
                    kind: col.kind,
                    params: { inputId: input.id },
                    label: (input.label || 'List') + ' › ' + col.label,
                };
                this.dropTarget = null;
                try { e.dataTransfer.setData('text/plain', col.id); e.dataTransfer.effectAllowed = 'link'; } catch (err) { /* older browsers */ }
                const chip = e.currentTarget;
                this.dragWire = { from: this.pointOf(chip), to: this.pointOf(chip) };
                this.refreshWires();
            },

            useEventList(input) {
                const node = this.selectedNode;
                if (!node || Core.kindOf(node) !== 'box') {
                    this.flash('Iterate a box — put this element in one first (right-click › Wrap in a box).');
                    return;
                }
                const page = this.currentPage;
                if (!page) return;
                const repeat = Object.assign({}, node.repeat || { layout: { direction: 'column', perLine: 1, gap: 12, maxPerPage: 0 }, overflow: 'clip' }, {
                    source: 'event_list',
                    params: { inputId: input.id },
                });
                this.replacePage(Core.updateNode(page, node.id, { repeat: repeat }));
                this.commit();
                this.readProps();
                this.refreshData();
            },

            async loadTypedDraft() {
                const Typed = global.SundayTypedCore;
                if (!Typed) {
                    this.data.typed.draft = emptyTypedDraft();
                    return;
                }
                const date = this.typedSundayDate();
                let service = (ui.bundle && ui.bundle.services && ui.bundle.services[date]) || null;
                if (!service && typeof db !== 'undefined' && db) {
                    try {
                        const doc = await db.collection('services').doc(date).get();
                        if (doc && doc.exists) {
                            service = doc.data();
                            if (!ui.bundle) ui.bundle = { services: {} };
                            ui.bundle.services = ui.bundle.services || {};
                            ui.bundle.services[date] = service;
                        }
                    } catch (e) { service = null; }
                }
                if (date !== this.typedSundayDate()) return;
                this.data.typed.date = date;
                this.data.typed.draft = Typed.toDraft(Typed.fromService(service));
                this.data.typed.row = this.typedRowFor(date, service);
                this.data.typed.status = '';
            },

            addTypedAnnouncement() {
                if (!this.data.typed.draft) return;
                this.data.typed.draft.announcements.push({ title: '', content: '' });
            },

            removeTypedAnnouncement(i) {
                if (!this.data.typed.draft) return;
                this.data.typed.draft.announcements.splice(i, 1);
                if (!this.data.typed.draft.announcements.length) {
                    this.data.typed.draft.announcements.push({ title: '', content: '' });
                }
            },

            async onTypedCountryImage(e) {
                const file = e.target.files && e.target.files[0];
                if (e.target) e.target.value = '';
                if (!file || !this.data.typed.draft) return;
                const Typed = global.SundayTypedCore;
                if (!Typed) return;
                const err = Typed.fileUploadError(file);
                if (err) { this.data.typed.status = err; return; }
                let upload = file;
                const intake = global.ImageIntake;
                if (Typed.fileNeedsPrepare(file)) {
                    this.data.typed.status = (intake && intake.COMPRESSING_MESSAGE) || 'Compressing the image…';
                    if (!intake) {
                        this.data.typed.status = 'Could not read that image.';
                        return;
                    }
                    try {
                        upload = await intake.prepare(file, { maxBytes: Typed.MAX_UPLOAD_BYTES - 1 });
                    } catch (prep) {
                        this.data.typed.status = (prep && prep.message) || 'Could not read that image.';
                        return;
                    }
                }
                this.data.typed.status = 'Uploading country map…';
                try {
                    const date = this.typedSundayDate();
                    const safe = (upload.name || 'map').replace(/[^\w.-]+/g, '_');
                    const fileId = (global.PrintableCore && PrintableCore.newId
                        ? PrintableCore.newId('map')
                        : String(Date.now())) + '_' + safe;
                    const path = Typed.countryMapStoragePath(date, fileId);
                    if (!path || typeof firebase === 'undefined' || !firebase.storage) {
                        this.data.typed.status = 'Country map upload is not available.';
                        return;
                    }
                    const ref = firebase.storage().ref(path);
                    await ref.put(upload, { contentType: upload.type || 'image/jpeg' });
                    const url = await ref.getDownloadURL();
                    this.data.typed.draft.prayerCountryImage = url;
                    this.data.typed.status = 'Country map uploaded. Save to keep it on this Sunday.';
                } catch (ex) {
                    console.error(ex);
                    this.data.typed.status = 'That country map did not upload.';
                }
            },

            async saveTypedDraft() {
                const Typed = global.SundayTypedCore;
                if (!Typed || !this.data.typed.draft || !this.canEdit) return;
                const date = this.typedSundayDate();
                this.data.typed.saving = true;
                this.data.typed.status = '';
                try {
                    Typed.assertCountryImageWritable(this.data.typed.draft.prayerCountryImage);
                    const content = Typed.fromDraft(this.data.typed.draft);
                    Typed.assertCountryImageWritable(content.pastoralPrayer.countryImage);
                    await db.collection('services').doc(date).set({ typedContent: Typed.normalise(content) }, { merge: true });
                    if (!ui.bundle) ui.bundle = { services: {} };
                    ui.bundle.services = ui.bundle.services || {};
                    const cur = ui.bundle.services[date] || {};
                    ui.bundle.services[date] = Object.assign({}, cur, { typedContent: Typed.normalise(content) });
                    this.data.typed.date = date;
                    this.data.typed.row = this.typedRowFor(date, ui.bundle.services[date]);
                    this.data.typed.status = 'Saved for ' + Data.formatDate(date, 'medium') + '. Bound pages will read it.';
                    this.rebindData();
                    this.renderAll();
                } catch (e) {
                    console.error(e);
                    this.data.typed.status = (e && e.code === 'country-map-size' && e.message)
                        ? e.message
                        : 'Could not save. Check your connection and try again.';
                } finally {
                    this.data.typed.saving = false;
                }
            },
        };
    }

    global.PrintableEditorData = PrintableEditorData;
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { PrintableEditorData: PrintableEditorData, PrintableEditorWires: PrintableEditorWires };
    }
})(typeof window !== 'undefined' ? window : globalThis);
