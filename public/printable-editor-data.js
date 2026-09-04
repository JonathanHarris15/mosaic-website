// The Printable editor's data side (MS-396, MS-397): the drawer, the wires,
// iterated elements and the pages an overflowing list generates.
//
// Mixed into the editor's Alpine object by printable-editor.js, so `this` is
// the editor. It owns:
//
//   • the DRAWER on the right — what the catalog offers this viewer, grouped
//     by region, with each source's params and its fields as draggable chips;
//   • WIRING — drag a chip onto an element to bind it, with a wire drawn from
//     the chip to the cursor and, once bound, from the chip to the element
//     whenever that element is selected;
//   • ITERATION — "Make this element iterated": the element stands for one
//     row of a list, its filters and layout live on the element panel, and a
//     list that overflows makes new pages that copy the page it started on;
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

    function PrintableEditorData(ui) {
        return {
            // ── State ────────────────────────────────────────────────────
            data: {
                mode: 'live',          // 'live' | 'standins'
                loading: false,
                loaded: false,
                error: '',
                search: '',
                open: {},              // sourceKey -> expanded in the drawer
                params: {},            // sourceKey -> the params chips carry (single sources)
                options: { series: [], roles: [], forms: [] },
                warnings: [],
                picking: false,        // choosing a list for the selected element
            },
            layout: [],                // what the canvas draws: pages, generated ones included
            dragField: null,           // the chip in the air
            dropTarget: null,          // the element under it, when it may take it
            wires: [],                 // [{x1,y1,x2,y2}] in main-area coordinates
            dragWire: null,

            // ── Boot ─────────────────────────────────────────────────────

            async initData() {
                if (!this.project) return;
                this.data.loading = true;
                try {
                    this.data.options = await global.PrintableDataStore.loadOptions(db, this.viewer());
                } catch (e) {
                    this.data.options = { series: [], roles: [], forms: [] };
                }
                await this.refreshData();
            },

            viewer() {
                return { level: this.permissionLevel, personId: (this.currentUserData && this.currentUserData.personId) || null };
            },

            // One fetch of everything the project reads, then a resolver the
            // canvas draws through. Called on open, on Refresh, and when a
            // list's params change (its needs may have changed).
            async refreshData() {
                if (!this.project || !this.template) return;
                this.data.loading = true;
                this.data.error = '';
                try {
                    const needs = Live.collectNeeds(this.project);
                    const bundle = await global.PrintableDataStore.fetch(db, needs, this.viewer());
                    ui.bundle = bundle;
                    ui.resolver = Live.resolver(this.project, bundle, { level: this.permissionLevel, canEdit: this.canEdit });
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
                ui.resolver = Live.resolver(this.project, ui.bundle, { level: this.permissionLevel, canEdit: this.canEdit });
            },

            get resolver() {
                return this.data.mode === 'live' ? (ui.resolver || null) : null;
            },

            setDataMode(mode) {
                this.data.mode = mode;
                this.renderAll();
            },

            // ── What the canvas draws ────────────────────────────────────

            computeLayout() {
                if (!this.project || !this.template) { this.layout = []; return []; }
                if (ui.resolver && this.data.mode === 'live') {
                    // Bindings may have changed since the last resolve.
                    this.rebindData();
                }
                const host = document.getElementById('pe-measure');
                const res = this.resolver;
                this.layout = Live.layoutPages(this.project, res, res ? host : null);
                this.data.warnings = res ? Live.warningsFor(this.layout, res, this.project) : [];
                return this.layout;
            },

            // The pages for print: the same layout.
            printPages() {
                const entries = this.computeLayout();
                return entries.map(e => ({ page: Object.assign({}, e.page, { nodes: e.nodes }) }));
            },

            // ── The drawer ───────────────────────────────────────────────

            get regions() {
                const q = this.data.search.trim().toLowerCase();
                const sources = Data.sourcesFor(this.permissionLevel).filter(s => {
                    if (!q) return true;
                    const hay = (s.label + ' ' + s.region + ' ' + s.fields.map(f => f.label).join(' ')).toLowerCase();
                    return hay.includes(q);
                });
                const byRegion = {};
                const order = [];
                sources.forEach(s => {
                    if (!byRegion[s.region]) { byRegion[s.region] = []; order.push(s.region); }
                    byRegion[s.region].push(s);
                });
                return order.map(r => ({ name: r, sources: byRegion[r] }));
            },

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
                return r && r.repeat.source ? Data.sourceByKey(r.repeat.source) : null;
            },

            // The fields a row of the selection's list carries, as chips.
            get itemFields() {
                const r = this.repeatContext;
                if (!r || !r.repeat.source) return [];
                return Data.fieldsFor(r.repeat.source, r.repeat.params, this.data.options)
                    .filter(f => !f.minLevel || Data.mayRead(this.permissionLevel, f.minLevel));
            },

            sourceParams(source) {
                if (!this.data.params[source.key]) this.data.params[source.key] = Data.defaultParams(source);
                return this.data.params[source.key];
            },

            fieldsOf(source) {
                return Data.fieldsFor(source, this.sourceParams(source), this.data.options)
                    .filter(f => !f.minLevel || Data.mayRead(this.permissionLevel, f.minLevel));
            },

            toggleSource(key) {
                this.data.open[key] = !this.data.open[key];
                this.$nextTick(() => this.refreshWires());
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

            onChipDragStart(e, scope, source, field) {
                const params = scope === 'item' ? null : JSON.parse(JSON.stringify(this.sourceParams(source)));
                this.dragField = { scope: scope, source: source.key || source, field: field.key, kind: field.kind, params: params, label: field.label };
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
                const node = page && Core.findNode(page, nodeId);
                if (!node) return;
                const prop = Data.propFor(field.kind);
                const bind = Object.assign({}, node.bind || {});
                bind[prop] = field.scope === 'item'
                    ? { scope: 'item', field: field.field }
                    : { scope: 'global', source: field.source, params: field.params || {}, field: field.field };
                this.replacePage(Core.updateNode(page, nodeId, { bind: bind }));
                this.commit();
                // A row field reads from data already loaded; a global field
                // may name a source nothing has fetched yet.
                if (field.scope === 'item') { this.rebindData(); this.renderAll(); }
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
                    if (b.scope === 'item') {
                        const src = this.repeatSource;
                        const f = src && Data.fieldsFor(src, this.repeatContext.repeat.params, this.data.options).find(x => x.key === b.field);
                        label = 'Each row › ' + (f ? f.label : b.field);
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

            // ── Wires drawn on screen ────────────────────────────────────

            pointOf(el) {
                const main = document.querySelector('.pe-main');
                if (!el || !main) return { x: 0, y: 0 };
                const r = el.getBoundingClientRect();
                const m = main.getBoundingClientRect();
                return { x: r.left - m.left, y: r.top - m.top + r.height / 2, w: r.width, h: r.height };
            },

            refreshWires() {
                const wires = [];
                const main = document.querySelector('.pe-main');
                const node = this.selectedNode;
                if (main && node && node.bind && !this.dragWire) {
                    Object.keys(node.bind).forEach(prop => {
                        const b = node.bind[prop];
                        const key = b.scope === 'item' ? this.chipKey('item', this.repeatContext ? this.repeatContext.repeat.source : '', b.field) : this.chipKey('global', b.source, b.field);
                        const chip = document.querySelector('[data-chip="' + key + '"]');
                        const el = ui.world && ui.world.querySelector('[data-pid="' + node.id + '"]');
                        if (!chip || !el) return;
                        const a = this.pointOf(el);
                        const c = this.pointOf(chip);
                        wires.push({ x1: a.x + a.w, y1: a.y, x2: c.x, y2: c.y });
                    });
                }
                if (this.dragWire) wires.push({ x1: this.dragWire.to.x, y1: this.dragWire.to.y, x2: this.dragWire.from.x, y2: this.dragWire.from.y, live: true });
                this.wires = wires;
                // Drawn by hand: Alpine's <template> does not exist inside an
                // <svg>, so the paths are built here.
                const svg = document.getElementById('pe-wires');
                if (!svg) return;
                svg.innerHTML = '';
                wires.forEach(w => {
                    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                    path.setAttribute('d', this.wirePath(w));
                    if (w.live) path.setAttribute('class', 'is-live');
                    svg.appendChild(path);
                });
            },

            wirePath(w) {
                const dx = Math.max(40, Math.abs(w.x2 - w.x1) / 2);
                return 'M ' + w.x1 + ' ' + w.y1 + ' C ' + (w.x1 + dx) + ' ' + w.y1 + ', ' + (w.x2 - dx) + ' ' + w.y2 + ', ' + w.x2 + ' ' + w.y2;
            },

            // ── Iteration ────────────────────────────────────────────────

            // From the context menu: the element becomes iterated, and the
            // drawer shows the lists it may stand for.
            makeIterated() {
                const node = this.selectedNode;
                if (!node) return;
                if (Core.kindOf(node) !== 'box') {
                    this.flash('Iterate a box — put this element in one first (right-click › Wrap in a box).');
                    return;
                }
                this.data.picking = true;
                if (!node.repeat) {
                    const page = this.currentPage;
                    this.replacePage(Core.updateNode(page, node.id, { repeat: { source: '', params: {}, layout: { direction: 'column', perLine: 1, gap: 12, maxPerPage: 0 }, overflow: 'clip' } }));
                    this.commit();
                    this.renderAll();
                    this.readProps();
                }
            },

            chooseList(source) {
                const page = this.currentPage;
                const node = this.selectedNode;
                if (!page || !node) return;
                const repeat = Object.assign({}, node.repeat || { layout: { direction: 'column', perLine: 1, gap: 12, maxPerPage: 0 }, overflow: 'clip' }, {
                    source: source.key,
                    params: Data.defaultParams(source),
                });
                this.replacePage(Core.updateNode(page, node.id, { repeat: repeat }));
                this.data.picking = false;
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
                this.data.picking = false;
                this.commit();
                this.renderAll();
                this.readProps();
            },

            // The params a list carries, editable on the element panel.
            get repeatParamSpecs() {
                const src = this.repeatSource;
                if (!src) return [];
                return (src.params || []).concat(src.filters || []);
            },

            repeatParam(key) {
                const r = this.repeatContext;
                const src = this.repeatSource;
                if (!r || !src) return undefined;
                const p = Object.assign(Data.defaultParams(src), r.repeat.params || {});
                return p[key];
            },

            setRepeatParam(key, value) {
                const r = this.repeatContext;
                const page = this.pageOfNode(r && r.id);
                if (!r || !page) return;
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

            // Sub-fields of a param, for the small editors: a `when`, a range.
            whenMode(v) { return (v && v.mode) || 'this'; },
            rangeMode(v) { return (v && v.mode) || 'relative'; },

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
        };
    }

    global.PrintableEditorData = PrintableEditorData;
})(typeof window !== 'undefined' ? window : globalThis);
