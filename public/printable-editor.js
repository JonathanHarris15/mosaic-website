// The Printable editor (MS-393, MS-394) — where pages are laid out.
//
// Three parts: a CANVAS in the middle showing every page with generous space
// around it, an ELEMENT PANEL on the left carrying the element tree and the
// controls for whatever is selected, and the DATA DRAWER on the right (MS-396).
//
// Alpine drives the panels, the header and the dialogs. The canvas and the
// tree are drawn by hand from the model — a page is a tree of elements that
// PrintableDom turns into real DOM, and re-drawing a page after every edit is
// cheap and keeps one renderer for editing, viewing and printing.
//
// ⚠ Everything the panels change goes THROUGH PrintableCore — insertNode,
// updateNode, moveNode — and each of those returns a new page. That is what
// makes undo a stack of snapshots: `commit()` records the state after a change
// and `undo()` walks back through them. Nothing here mutates a node in place.
//
// The page saves itself (ADR-0032): 1.5 s after the last edit, with the chip;
// the Save button means "now".

function printableEditor() {
    // Things Alpine must NOT make reactive: DOM handles, the undo stack, the
    // CodeMirror instances (a proxied CodeMirror throws on click — see
    // service-guide-manager.js), and the drag state, which changes on every
    // mouse move and would re-run every getter if it were reactive.
    const ui = {
        viewport: null, world: null, tree: null,
        history: [], future: [],
        drag: null,          // { kind: 'pan'|'move'|'resize', ... }
        treeDrag: null,      // { nodeId, pageId }
        cm: { html: null, css: null },
        pageEls: {},         // pageId -> the rendered page element
        editingText: null,   // node id being edited inline
    };

    const PAD = 600;         // world padding round the pages, so panning never feels pinned
    const GAP = 80;          // between pages

    const STYLE_KEYS = [
        'width', 'height', 'min-height', 'max-width', 'display', 'flex-direction', 'flex-wrap', 'gap',
        'justify-content', 'align-items', 'grid-template-columns', 'flex', 'position', 'left', 'top',
        'padding', 'margin', 'border-width', 'border-style', 'border-color', 'border-radius',
        'background-color', 'opacity', 'overflow', 'font-family', 'font-size', 'font-weight', 'font-style',
        'color', 'line-height', 'text-align', 'letter-spacing', 'text-transform', 'object-fit',
    ];

    const FONTS = [
        { label: 'EB Garamond (serif)', value: 'EB Garamond, Georgia, serif' },
        { label: 'Libre Franklin (sans)', value: 'Libre Franklin, Helvetica, Arial, sans-serif' },
        { label: 'Cinzel (display)', value: 'Cinzel, Georgia, serif' },
        { label: 'PT Serif', value: 'PT Serif, Georgia, serif' },
        { label: 'Georgia', value: 'Georgia, serif' },
        { label: 'Times New Roman', value: 'Times New Roman, Times, serif' },
        { label: 'Arial', value: 'Arial, Helvetica, sans-serif' },
        { label: 'Courier', value: 'Courier New, Courier, monospace' },
    ];

    return {
        id: '',
        loading: true,
        problem: '',
        permissionLevel: 'viewer',
        currentUser: null,
        project: null,
        saveStatus: 'saved',
        _saveTimer: null,
        saving: false,

        // ── The picker (MS-393) ──────────────────────────────────────────
        picker: { open: false, tab: 'paper', paper: 'letter', orientation: 'portrait', dpi: 150, customs: [], customId: '', busy: false },
        papers: PrintableCore.PAPERS,
        densities: PrintableCore.DENSITIES,
        fonts: FONTS,

        // ── Selection and view ───────────────────────────────────────────
        selection: { pageId: null, nodeId: null },
        view: { x: 0, y: 0, zoom: 0.5 },
        props: {},
        customCss: '',
        pageProps: { marginMode: 'all', all: 0, tb: 0, lr: 0, top: 0, right: 0, bottom: 0, left: 0, bg: '#ffffff', name: '' },
        menu: { open: false, x: 0, y: 0, nodeId: null, pageId: null },
        renaming: false,
        renameText: '',
        savingTemplate: false,
        templateName: '',
        fileMenu: false,
        codeOpen: false,
        codeTab: 'html',
        codeProblem: '',
        codeDirty: false,
        hover: { nodeId: null },
        selBox: null,
        hoverBox: null,

        // ── Derived ──────────────────────────────────────────────────────

        get canEdit() { return ['editor', 'elder', 'admin', 'super_admin'].includes(this.permissionLevel); },
        get template() { return this.project ? this.project.template : null; },
        get pages() { return this.project ? this.project.pages : []; },
        get currentPage() {
            if (!this.project) return null;
            return this.pages.find(p => p.id === this.selection.pageId) || this.pages[0] || null;
        },
        get selectedNode() {
            const page = this.currentPage;
            if (!page || !this.selection.nodeId) return null;
            return PrintableCore.findNode(page, this.selection.nodeId);
        },
        get selectedKind() { return this.selectedNode ? PrintableCore.kindOf(this.selectedNode) : ''; },
        get pageSelected() { return !!this.currentPage && !this.selection.nodeId; },
        get zoomLabel() { return Math.round(this.view.zoom * 100) + '%'; },
        get paperPreview() {
            const t = PrintableCore.buildTemplate({ paper: this.picker.paper, orientation: this.picker.orientation, dpi: this.picker.dpi });
            return t;
        },
        get customPreview() {
            const c = this.picker.customs.find(x => x.id === this.picker.customId);
            return c ? c.template : null;
        },

        // ── Boot ─────────────────────────────────────────────────────────

        async init() {
            this.id = new URLSearchParams(location.search).get('id') || '';
            auth.onAuthStateChanged(async (user) => {
                if (!user) { window.location.href = 'index.html'; return; }
                try {
                    const userData = await getUserData(user.uid);
                    this.permissionLevel = (userData && (userData.permissionLevel || userData.role)) || 'viewer';
                    if (!this.canEdit) { window.location.href = 'index.html'; return; }
                    this.currentUser = user;
                    if (!this.id) { this.problem = 'No printable was named. Open one from the library.'; return; }
                    const record = await PrintableStore.loadPrintable(db, this.id);
                    if (!record) { this.problem = 'That printable no longer exists.'; return; }
                    this.project = Object.assign({ id: record.id, createdAt: record.createdAt, createdBy: record.createdBy, createdByName: record.createdByName },
                        PrintableCore.migrate(record));
                    ui.history = [this.snapshot()];
                    ui.future = [];
                    if (!this.project.template) {
                        await this.openPicker();
                    }
                } catch (e) {
                    console.error(e);
                    this.problem = 'The printable did not load. Check your connection and refresh.';
                } finally {
                    this.loading = false;
                }
                this.$nextTick(() => this.mount());
            });
        },

        mount() {
            ui.viewport = document.getElementById('pe-viewport');
            ui.world = document.getElementById('pe-world');
            ui.tree = document.getElementById('pe-tree');
            if (!ui.viewport || !ui.world) return;
            this.bindCanvasEvents();
            this.bindKeys();
            if (this.project && this.project.template) {
                this.renderAll();
                this.fitToView();
                if (!this.selection.pageId && this.pages[0]) this.selectPage(this.pages[0].id);
            }
            window.addEventListener('resize', () => this.refreshOverlays());
        },

        // ── The picker ───────────────────────────────────────────────────

        async openPicker() {
            this.picker.open = true;
            try {
                this.picker.customs = await PrintableStore.listTemplates(db);
            } catch (e) {
                this.picker.customs = [];
            }
        },

        pickerCardStyle(t) {
            // A little rectangle in the paper's proportion, at most 72px a side.
            const w = t.widthIn, h = t.heightIn;
            const scale = 72 / Math.max(w, h);
            return 'width:' + Math.round(w * scale) + 'px;height:' + Math.round(h * scale) + 'px';
        },

        paperFor(key) {
            return PrintableCore.buildTemplate({ paper: key, orientation: this.picker.orientation, dpi: this.picker.dpi });
        },

        async startFromPicker() {
            if (this.picker.busy) return;
            this.picker.busy = true;
            try {
                let template, firstPage;
                if (this.picker.tab === 'custom' && this.customPreview) {
                    const custom = this.picker.customs.find(x => x.id === this.picker.customId);
                    template = PrintableCore.buildTemplate(custom.template);
                    firstPage = PrintableCore.buildPage(template, custom.page || {});
                } else {
                    template = PrintableCore.buildTemplate({ paper: this.picker.paper, orientation: this.picker.orientation, dpi: this.picker.dpi });
                    firstPage = PrintableCore.buildPage(template, {});
                }
                this.project.template = template;
                this.project.pages = [firstPage];
                this.picker.open = false;
                ui.history = [this.snapshot()];
                ui.future = [];
                await this.save(true);
                this.$nextTick(() => {
                    this.renderAll();
                    this.fitToView();
                    this.selectPage(firstPage.id);
                });
            } finally {
                this.picker.busy = false;
            }
        },

        async deleteCustom(t) {
            if (!confirm('Delete the "' + t.name + '" template? Projects already started from it are not affected.')) return;
            try {
                await PrintableStore.deleteTemplate(db, t.id);
                this.picker.customs = this.picker.customs.filter(x => x.id !== t.id);
                if (this.picker.customId === t.id) this.picker.customId = '';
            } catch (e) {
                this.problem = 'That template was not deleted.';
            }
        },

        startSaveTemplate() {
            if (!this.currentPage) return;
            this.fileMenu = false;
            this.templateName = this.project.name + ' page';
            this.savingTemplate = true;
            this.$nextTick(() => { const el = document.getElementById('pe-template-name'); if (el) { el.focus(); el.select(); } });
        },

        async confirmSaveTemplate() {
            const name = this.templateName.trim();
            this.savingTemplate = false;
            if (!name || !this.currentPage) return;
            try {
                await PrintableStore.saveTemplate(db, firebase, this.currentUser, {
                    name: name, template: this.template, page: this.currentPage,
                });
                this.flash('Saved as a page template. It is in the picker for every new printable.');
            } catch (e) {
                this.problem = 'That template was not saved.';
            }
        },

        // ── Saving (ADR-0032) ────────────────────────────────────────────

        touch() {
            this.saveStatus = 'unsaved';
            clearTimeout(this._saveTimer);
            this._saveTimer = setTimeout(() => this.save(false), 1500);
        },

        async save(pressed) {
            clearTimeout(this._saveTimer);
            if (!this.project || !this.canEdit) return;
            this.saveStatus = 'saving';
            this.saving = true;
            try {
                await PrintableStore.savePrintable(db, firebase, this.currentUser, this.project.id, this.project);
                this.saveStatus = 'saved';
            } catch (e) {
                console.error(e);
                this.saveStatus = 'unsaved';
                // A failed autosave is silent; a press reports.
                if (pressed) this.problem = 'That save did not go through. Check your connection and try again.';
            } finally {
                this.saving = false;
            }
        },

        flash(text) {
            this.problem = '';
            this.notice = text;
            clearTimeout(this._noticeTimer);
            this._noticeTimer = setTimeout(() => { this.notice = ''; }, 4000);
        },
        notice: '',
        _noticeTimer: null,

        // ── Undo ─────────────────────────────────────────────────────────

        snapshot() { return JSON.stringify(this.project ? this.project.pages : []); },

        commit() {
            const s = this.snapshot();
            if (ui.history[ui.history.length - 1] !== s) {
                ui.history.push(s);
                if (ui.history.length > 100) ui.history.shift();
                ui.future = [];
            }
            this.touch();
        },

        undo() {
            if (ui.history.length < 2) return;
            ui.future.push(ui.history.pop());
            this.restore(ui.history[ui.history.length - 1]);
        },

        redo() {
            if (!ui.future.length) return;
            const s = ui.future.pop();
            ui.history.push(s);
            this.restore(s);
        },

        restore(s) {
            this.project.pages = JSON.parse(s);
            if (!this.pages.find(p => p.id === this.selection.pageId)) this.selection.pageId = this.pages[0] ? this.pages[0].id : null;
            if (this.selection.nodeId && !this.selectedNode) this.selection.nodeId = null;
            this.renderAll();
            this.readProps();
            this.touch();
        },

        // ── Pages ────────────────────────────────────────────────────────

        replacePage(next) {
            const i = this.pages.findIndex(p => p.id === next.id);
            if (i < 0) return;
            this.project.pages.splice(i, 1, next);
        },

        addPage(afterId) {
            const page = PrintableCore.buildPage(this.template, {});
            const i = afterId ? this.pages.findIndex(p => p.id === afterId) : this.pages.length - 1;
            this.project.pages.splice(i + 1, 0, page);
            this.commit();
            this.renderAll();
            this.selectPage(page.id);
            this.scrollToPage(page.id);
        },

        duplicatePage(pageId) {
            const src = this.pages.find(p => p.id === pageId);
            if (!src) return;
            const copy = PrintableCore.buildPage(this.template, Object.assign(JSON.parse(JSON.stringify(src)), { id: null }));
            // Fresh element ids so the copy is its own.
            const reid = (n) => { n.id = PrintableCore.newId(); (n.children || []).forEach(reid); };
            copy.nodes.forEach(reid);
            const i = this.pages.findIndex(p => p.id === pageId);
            this.project.pages.splice(i + 1, 0, copy);
            this.commit();
            this.renderAll();
            this.selectPage(copy.id);
        },

        deletePage(pageId) {
            const page = this.pages.find(p => p.id === pageId);
            if (!page) return;
            if (this.pages.length === 1) { this.flash('A printable keeps at least one page.'); return; }
            if (page.nodes.length && !confirm('Delete this page and the ' + page.nodes.length + ' element' + (page.nodes.length === 1 ? '' : 's') + ' on it?')) return;
            this.project.pages = this.pages.filter(p => p.id !== pageId);
            if (this.selection.pageId === pageId) { this.selection.pageId = this.pages[0].id; this.selection.nodeId = null; }
            this.commit();
            this.renderAll();
            this.readProps();
        },

        movePage(pageId, delta) {
            const i = this.pages.findIndex(p => p.id === pageId);
            const j = i + delta;
            if (i < 0 || j < 0 || j >= this.pages.length) return;
            const list = this.project.pages;
            const [pg] = list.splice(i, 1);
            list.splice(j, 0, pg);
            this.commit();
            this.renderAll();
        },

        selectPage(pageId) {
            this.selection.pageId = pageId;
            this.selection.nodeId = null;
            this.readProps();
            this.refreshOverlays();
            this.renderTree();
            this.syncCode();
        },

        // ── Elements ─────────────────────────────────────────────────────

        select(pageId, nodeId) {
            this.selection.pageId = pageId;
            this.selection.nodeId = nodeId;
            this.readProps();
            this.refreshOverlays();
            this.renderTree();
            this.syncCode();
        },

        clearSelection() {
            this.selection.nodeId = null;
            this.readProps();
            this.refreshOverlays();
            this.renderTree();
        },

        // Where a new element goes: inside the selected box, beside a selected
        // text or image, or at the end of the page.
        addElement(kind) {
            const page = this.currentPage;
            if (!page) return;
            const dpi = this.template.dpi;
            const node = kind === 'text' ? PrintableCore.newText(dpi) : kind === 'image' ? PrintableCore.newImage(dpi) : PrintableCore.newBox(dpi);
            const sel = this.selectedNode;
            let parentId = null, index = null;
            if (sel) {
                if (PrintableCore.kindOf(sel) === 'box') { parentId = sel.id; }
                else {
                    const at = PrintableCore.locate(page, sel.id);
                    parentId = at.parent ? at.parent.id : null;
                    index = at.index + 1;
                }
            }
            const next = PrintableCore.insertNode(page, parentId, node, index);
            this.replacePage(next);
            this.commit();
            this.renderPage(next.id);
            this.select(next.id, node.id);
        },

        deleteSelected() {
            const page = this.currentPage;
            if (!page || !this.selection.nodeId) return;
            const next = PrintableCore.removeNode(page, this.selection.nodeId);
            this.replacePage(next);
            this.selection.nodeId = null;
            this.commit();
            this.renderPage(next.id);
            this.readProps();
            this.refreshOverlays();
            this.renderTree();
        },

        duplicateSelected() {
            const page = this.currentPage;
            if (!page || !this.selection.nodeId) return;
            const next = PrintableCore.duplicateNode(page, this.selection.nodeId);
            const at = PrintableCore.locate(next, this.selection.nodeId);
            const copy = at.list[at.index + 1];
            this.replacePage(next);
            this.commit();
            this.renderPage(next.id);
            if (copy) this.select(next.id, copy.id);
        },

        wrapSelected() {
            const page = this.currentPage;
            if (!page || !this.selection.nodeId) return;
            const next = PrintableCore.wrapNode(page, this.selection.nodeId, this.template.dpi);
            this.replacePage(next);
            this.commit();
            this.renderPage(next.id);
            this.select(next.id, this.selection.nodeId);
        },

        // Bring forward / send back: earlier in the list draws first.
        nudgeSelected(delta) {
            const page = this.currentPage;
            if (!page || !this.selection.nodeId) return;
            const at = PrintableCore.locate(page, this.selection.nodeId);
            if (!at) return;
            const target = at.index + delta;
            if (target < 0 || target >= at.list.length) return;
            const r = PrintableCore.moveNode(page, this.selection.nodeId, at.parent ? at.parent.id : null, delta > 0 ? target + 1 : target);
            if (!r.ok) return;
            this.replacePage(r.page);
            this.commit();
            this.renderPage(r.page.id);
            this.select(r.page.id, this.selection.nodeId);
        },

        moveElement(nodeId, parentId, index) {
            const page = this.currentPage;
            const r = PrintableCore.moveNode(page, nodeId, parentId, index);
            if (!r.ok) { this.flash(r.why); return; }
            this.replacePage(r.page);
            this.commit();
            this.renderPage(r.page.id);
            this.select(r.page.id, nodeId);
        },

        // Selecting a page's element from another page moves the selection's
        // page too, so "current page" always means the one you are on.
        pageOfNode(nodeId) {
            return this.pages.find(p => PrintableCore.findNode(p, nodeId)) || null;
        },

        // ── The property panel ───────────────────────────────────────────

        readProps() {
            const node = this.selectedNode;
            const props = {};
            if (node) {
                STYLE_KEYS.forEach(k => { props[k] = node.style[k] || ''; });
                props.name = node.name || '';
                props.tag = node.tag;
                props.text = node.text || '';
                props.src = (node.attrs && node.attrs.src) || '';
                props.alt = (node.attrs && node.attrs.alt) || '';
                const rest = Object.keys(node.style).filter(k => !STYLE_KEYS.includes(k));
                this.customCss = rest.map(k => k + ': ' + node.style[k] + ';').join('\n');
            } else {
                this.customCss = '';
            }
            this.props = props;
            const page = this.currentPage;
            if (page) {
                const m = page.margins;
                const same = m.top === m.right && m.top === m.bottom && m.top === m.left;
                const pairs = m.top === m.bottom && m.left === m.right;
                const mode = this.pageProps.marginMode;
                this.pageProps = {
                    marginMode: same ? (mode === 'four' || mode === 'pairs' ? mode : 'all') : pairs ? (mode === 'four' ? 'four' : 'pairs') : 'four',
                    all: m.top, tb: m.top, lr: m.left, top: m.top, right: m.right, bottom: m.bottom, left: m.left,
                    bg: (page.style && page.style['background-color']) || '#ffffff',
                    name: page.name || '',
                };
            }
        },

        // Live while typing; `commit` true (on change) records it for undo.
        applyProps(commit) {
            const node = this.selectedNode;
            const page = this.currentPage;
            if (!node || !page) return;
            const style = {};
            STYLE_KEYS.forEach(k => { style[k] = this.props[k] === undefined ? '' : String(this.props[k]); });
            // Anything the panel does not know about lives in the custom box.
            const custom = PrintableCore.cssToStyle(this.customCss.replace(/\n/g, ' '));
            Object.keys(node.style).forEach(k => { if (!STYLE_KEYS.includes(k) && !(k in custom)) style[k] = ''; });
            Object.assign(style, custom);
            const patch = { style: style, name: this.props.name, attrs: {} };
            if (PrintableCore.kindOf(node) === 'text') { patch.text = this.props.text; patch.tag = this.props.tag; }
            if (PrintableCore.kindOf(node) === 'box') { patch.tag = this.props.tag; }
            if (node.tag === 'img') { patch.attrs.src = this.props.src; patch.attrs.alt = this.props.alt; }
            const next = PrintableCore.updateNode(page, node.id, patch);
            this.replacePage(next);
            this.renderPage(next.id);
            if (commit) this.commit(); else this.touch();
            this.refreshOverlays();
            this.renderTree();
        },

        setProp(key, value, commit) {
            this.props[key] = value;
            this.applyProps(commit !== false);
        },

        applyPageProps(commit) {
            const page = this.currentPage;
            if (!page) return;
            const pp = this.pageProps;
            const n = v => Math.max(0, Math.round(Number(v) || 0));
            let margins;
            if (pp.marginMode === 'all') margins = { top: n(pp.all), right: n(pp.all), bottom: n(pp.all), left: n(pp.all) };
            else if (pp.marginMode === 'pairs') margins = { top: n(pp.tb), right: n(pp.lr), bottom: n(pp.tb), left: n(pp.lr) };
            else margins = { top: n(pp.top), right: n(pp.right), bottom: n(pp.bottom), left: n(pp.left) };
            const next = Object.assign({}, page, {
                margins: margins,
                name: String(pp.name || '').slice(0, 40),
                style: Object.assign({}, page.style, { 'background-color': pp.bg || '#ffffff' }),
            });
            this.replacePage(next);
            this.renderPage(next.id);
            if (commit) this.commit(); else this.touch();
            this.refreshOverlays();
            this.renderTree();
        },

        // The page CSS (the code view's second pane).
        applyPageCss(css) {
            const page = this.currentPage;
            if (!page) return;
            this.replacePage(Object.assign({}, page, { css: css }));
            this.renderPage(page.id);
            this.commit();
        },

        // A colour box only understands #rrggbb; a name typed in the text box
        // still applies, the swatch just cannot show it.
        swatch(value) {
            return /^#[0-9a-f]{6}$/i.test(String(value || '')) ? value : '#000000';
        },

        marginIn(px) {
            if (!this.template) return '';
            return (px / this.template.dpi).toFixed(2) + ' in';
        },

        async uploadImage(event) {
            const file = event.target.files && event.target.files[0];
            event.target.value = '';
            const node = this.selectedNode;
            if (!file || !node || node.tag !== 'img') return;
            if (!/^image\//.test(file.type)) { this.flash('That is not an image.'); return; }
            if (file.size > 8 * 1024 * 1024) { this.flash('Images up to 8 MB, please.'); return; }
            try {
                const fileId = PrintableCore.newId('img') + '_' + file.name.replace(/[^\w.-]+/g, '_');
                const ref = firebase.storage().ref('printable_assets/' + this.project.id + '/' + fileId);
                await ref.put(file, { contentType: file.type });
                const url = await ref.getDownloadURL();
                this.props.src = url;
                this.applyProps(true);
            } catch (e) {
                console.error(e);
                this.flash('That image did not upload.');
            }
        },

        // ── Rename ───────────────────────────────────────────────────────

        startRename() {
            this.renaming = true;
            this.renameText = this.project.name;
            this.$nextTick(() => { const el = document.getElementById('pe-rename'); if (el) { el.focus(); el.select(); } });
        },

        async commitRename() {
            if (!this.renaming) return;
            this.renaming = false;
            const name = this.renameText.trim();
            if (!name || name === this.project.name) return;
            this.project.name = PrintableCore.normaliseName(name);
            this.touch();
        },

        // ── Drawing the canvas ───────────────────────────────────────────

        pageTop(index) {
            let y = PAD;
            for (let i = 0; i < index; i++) y += this.template.heightPx + GAP;
            return y;
        },

        renderAll() {
            if (!ui.world || !this.template) return;
            ui.world.innerHTML = '';
            ui.pageEls = {};
            const t = this.template;
            this.pages.forEach((page, i) => {
                ui.world.appendChild(this.buildPageEl(page, i));
            });
            // The "+" below the last page.
            const add = document.createElement('button');
            add.type = 'button';
            add.className = 'pe-add-page';
            add.innerHTML = '<span class="material-symbols-outlined">add</span><span>Add a page</span>';
            add.style.left = PAD + 'px';
            add.style.top = (this.pageTop(this.pages.length) - GAP + 16) + 'px';
            add.style.width = t.widthPx + 'px';
            add.addEventListener('click', () => this.addPage());
            ui.world.appendChild(add);
            ui.world.style.width = (PAD * 2 + t.widthPx) + 'px';
            ui.world.style.height = (this.pageTop(this.pages.length) + PAD) + 'px';
            this.applyView();
            this.renderTree();
            this.refreshOverlays();
        },

        buildPageEl(page, index) {
            const t = this.template;
            const holder = document.createElement('div');
            holder.className = 'pe-page-holder';
            holder.style.left = PAD + 'px';
            holder.style.top = this.pageTop(index) + 'px';
            holder.style.width = t.widthPx + 'px';
            holder.style.height = t.heightPx + 'px';
            holder.setAttribute('data-page-holder', page.id);

            const label = document.createElement('div');
            label.className = 'pe-page-label';
            label.textContent = 'Page ' + (index + 1) + (page.name ? ' · ' + page.name : '');
            label.style.fontSize = Math.round(14 / Math.max(0.2, this.view.zoom)) + 'px';
            label.style.top = (-Math.round(22 / Math.max(0.2, this.view.zoom))) + 'px';
            holder.appendChild(label);

            const el = PrintableDom.renderPage(page, t, { editing: true, values: this.valuesFor ? this.valuesFor(page) : null });
            holder.appendChild(el);

            const guide = document.createElement('div');
            guide.className = 'pe-margin-guide';
            guide.style.top = page.margins.top + 'px';
            guide.style.right = page.margins.right + 'px';
            guide.style.bottom = page.margins.bottom + 'px';
            guide.style.left = page.margins.left + 'px';
            holder.appendChild(guide);

            ui.pageEls[page.id] = holder;
            return holder;
        },

        renderPage(pageId) {
            const i = this.pages.findIndex(p => p.id === pageId);
            const old = ui.pageEls[pageId];
            if (i < 0 || !old) { this.renderAll(); return; }
            const fresh = this.buildPageEl(this.pages[i], i);
            old.replaceWith(fresh);
            this.refreshOverlays();
            this.renderTree();
        },

        // A hook the data drawer (MS-396) fills in: resolved values per node.
        valuesFor: null,

        applyView() {
            if (!ui.world) return;
            ui.world.style.transform = 'translate(' + this.view.x + 'px, ' + this.view.y + 'px) scale(' + this.view.zoom + ')';
            // Page labels are drawn in screen size, so they re-size with zoom.
            Object.keys(ui.pageEls).forEach(id => {
                const label = ui.pageEls[id].querySelector('.pe-page-label');
                if (label) {
                    label.style.fontSize = Math.round(14 / Math.max(0.2, this.view.zoom)) + 'px';
                    label.style.top = (-Math.round(22 / Math.max(0.2, this.view.zoom))) + 'px';
                }
            });
            this.refreshOverlays();
        },

        fitToView() {
            if (!ui.viewport || !this.template) return;
            const vw = ui.viewport.clientWidth, vh = ui.viewport.clientHeight;
            const t = this.template;
            const zoom = Math.min(1.5, (vw - 120) / t.widthPx, (vh - 120) / t.heightPx);
            this.view.zoom = Math.max(0.05, zoom);
            this.view.x = (vw - t.widthPx * this.view.zoom) / 2 - PAD * this.view.zoom;
            this.view.y = 48 - PAD * this.view.zoom;
            this.applyView();
        },

        zoomTo(z, cx, cy) {
            const next = Math.max(0.05, Math.min(4, z));
            const vp = ui.viewport.getBoundingClientRect();
            const mx = (cx == null ? vp.width / 2 : cx - vp.left);
            const my = (cy == null ? vp.height / 2 : cy - vp.top);
            const k = next / this.view.zoom;
            this.view.x = mx - (mx - this.view.x) * k;
            this.view.y = my - (my - this.view.y) * k;
            this.view.zoom = next;
            this.applyView();
        },

        zoomIn() { this.zoomTo(this.view.zoom * 1.2); },
        zoomOut() { this.zoomTo(this.view.zoom / 1.2); },

        scrollToPage(pageId) {
            const i = this.pages.findIndex(p => p.id === pageId);
            if (i < 0) return;
            this.view.y = 48 - this.pageTop(i) * this.view.zoom;
            this.applyView();
        },

        // ── Overlays: selection and hover, drawn in screen space ─────────

        refreshOverlays() {
            this.selBox = this.boxFor(this.selection.nodeId) || (this.pageSelected ? this.pageBoxFor(this.selection.pageId) : null);
            this.hoverBox = (this.hover.nodeId && this.hover.nodeId !== this.selection.nodeId) ? this.boxFor(this.hover.nodeId) : null;
        },

        boxFor(nodeId) {
            if (!nodeId || !ui.viewport) return null;
            const el = ui.world.querySelector('[data-pid="' + nodeId + '"]');
            if (!el) return null;
            return this.screenBox(el, this.nameOf(nodeId));
        },

        pageBoxFor(pageId) {
            const holder = ui.pageEls[pageId];
            if (!holder) return null;
            const i = this.pages.findIndex(p => p.id === pageId);
            return this.screenBox(holder.querySelector('.pr-page'), 'Page ' + (i + 1));
        },

        screenBox(el, label) {
            const r = el.getBoundingClientRect();
            const v = ui.viewport.getBoundingClientRect();
            return { x: r.left - v.left, y: r.top - v.top, w: r.width, h: r.height, label: label };
        },

        nameOf(nodeId) {
            const page = this.pageOfNode(nodeId);
            const node = page && PrintableCore.findNode(page, nodeId);
            if (!node) return '';
            return node.name || this.tagLabel(node);
        },

        tagLabel(node) {
            const kind = PrintableCore.kindOf(node);
            if (kind === 'image') return 'Image';
            if (kind === 'text') return node.tag === 'p' || node.tag === 'span' ? 'Text' : node.tag.toUpperCase();
            return node.tag === 'div' ? 'Box' : node.tag;
        },

        // ── Canvas events ────────────────────────────────────────────────

        bindCanvasEvents() {
            const vp = ui.viewport;

            vp.addEventListener('wheel', (e) => {
                e.preventDefault();
                if (e.ctrlKey || e.metaKey) {
                    const factor = Math.exp(-e.deltaY * 0.0015);
                    this.zoomTo(this.view.zoom * factor, e.clientX, e.clientY);
                } else {
                    const dx = e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX;
                    const dy = e.shiftKey && !e.deltaX ? 0 : e.deltaY;
                    this.view.x -= dx;
                    this.view.y -= dy;
                    this.applyView();
                }
            }, { passive: false });

            vp.addEventListener('mousedown', (e) => {
                if (this.menu.open) this.menu.open = false;
                if (e.button === 1 || (e.button === 0 && (this.spaceHeld || !e.target.closest('.pr-page')))) {
                    if (ui.editingText) return;
                    ui.drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, ox: this.view.x, oy: this.view.y, moved: false };
                    vp.classList.add('pe-panning');
                    e.preventDefault();
                    return;
                }
                if (e.button === 0) {
                    const target = e.target.closest('[data-pid]');
                    if (target && ui.editingText !== target.getAttribute('data-pid')) {
                        const nodeId = target.getAttribute('data-pid');
                        const page = this.pageOfNode(nodeId);
                        const node = page && PrintableCore.findNode(page, nodeId);
                        if (node && node.style.position === 'absolute') {
                            ui.drag = { kind: 'move', nodeId: nodeId, sx: e.clientX, sy: e.clientY,
                                ox: parseFloat(node.style.left) || 0, oy: parseFloat(node.style.top) || 0, moved: false };
                            e.preventDefault();
                        }
                    }
                }
            });

            window.addEventListener('mousemove', (e) => {
                const d = ui.drag;
                if (!d) return;
                if (d.kind === 'pan') {
                    this.view.x = d.ox + (e.clientX - d.sx);
                    this.view.y = d.oy + (e.clientY - d.sy);
                    d.moved = true;
                    this.applyView();
                } else if (d.kind === 'move') {
                    const dx = (e.clientX - d.sx) / this.view.zoom, dy = (e.clientY - d.sy) / this.view.zoom;
                    if (Math.abs(dx) + Math.abs(dy) < 2 && !d.moved) return;
                    d.moved = true;
                    this.liveStyle(d.nodeId, { left: Math.round(d.ox + dx) + 'px', top: Math.round(d.oy + dy) + 'px' });
                } else if (d.kind === 'resize') {
                    const dx = (e.clientX - d.sx) / this.view.zoom, dy = (e.clientY - d.sy) / this.view.zoom;
                    d.moved = true;
                    this.liveStyle(d.nodeId, { width: Math.max(4, Math.round(d.ow + dx)) + 'px', height: Math.max(4, Math.round(d.oh + dy)) + 'px' });
                }
            });

            window.addEventListener('mouseup', () => {
                const d = ui.drag;
                if (!d) return;
                ui.drag = null;
                vp.classList.remove('pe-panning');
                if ((d.kind === 'move' || d.kind === 'resize') && d.moved) {
                    this.commit();
                    this.readProps();
                    this.renderPage(this.pageOfNode(d.nodeId).id);
                    this.refreshOverlays();
                }
            });

            vp.addEventListener('click', (e) => {
                if (ui.drag && ui.drag.moved) return;
                if (e.target.closest('.pe-add-page') || e.target.closest('.pe-overlay')) return;
                const target = e.target.closest('[data-pid]');
                if (target) {
                    const nodeId = target.getAttribute('data-pid');
                    if (ui.editingText === nodeId) return;
                    this.finishTextEdit();
                    const page = this.pageOfNode(nodeId);
                    this.select(page.id, nodeId);
                    return;
                }
                const pageEl = e.target.closest('.pr-page');
                this.finishTextEdit();
                if (pageEl) { this.selectPage(pageEl.getAttribute('data-page')); return; }
                if (this.selection.nodeId) this.clearSelection();
            });

            vp.addEventListener('dblclick', (e) => {
                const target = e.target.closest('[data-pid]');
                if (!target) return;
                const nodeId = target.getAttribute('data-pid');
                const page = this.pageOfNode(nodeId);
                const node = page && PrintableCore.findNode(page, nodeId);
                if (node && PrintableCore.kindOf(node) === 'text') this.startTextEdit(nodeId, target);
            });

            vp.addEventListener('mousemove', (e) => {
                if (ui.drag) return;
                const target = e.target.closest('[data-pid]');
                const id = target ? target.getAttribute('data-pid') : null;
                if (id !== this.hover.nodeId) { this.hover.nodeId = id; this.refreshOverlays(); }
            });
            vp.addEventListener('mouseleave', () => { this.hover.nodeId = null; this.refreshOverlays(); });

            vp.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                const target = e.target.closest('[data-pid]');
                const pageEl = e.target.closest('.pr-page');
                if (target) {
                    const nodeId = target.getAttribute('data-pid');
                    this.select(this.pageOfNode(nodeId).id, nodeId);
                } else if (pageEl) {
                    this.selectPage(pageEl.getAttribute('data-page'));
                } else { return; }
                const v = vp.getBoundingClientRect();
                this.menu = { open: true, x: e.clientX - v.left, y: e.clientY - v.top, nodeId: this.selection.nodeId, pageId: this.selection.pageId };
            });

            // Pinch on a touch screen zooms; a single finger pans.
            let pinch = null;
            vp.addEventListener('touchstart', (e) => {
                if (e.touches.length === 2) {
                    const [a, b] = e.touches;
                    pinch = { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), z: this.view.zoom };
                } else if (e.touches.length === 1 && !e.target.closest('.pr-page')) {
                    ui.drag = { kind: 'pan', sx: e.touches[0].clientX, sy: e.touches[0].clientY, ox: this.view.x, oy: this.view.y, moved: false };
                }
            }, { passive: true });
            vp.addEventListener('touchmove', (e) => {
                if (pinch && e.touches.length === 2) {
                    const [a, b] = e.touches;
                    const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
                    this.zoomTo(pinch.z * (d / pinch.d), (a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2);
                    e.preventDefault();
                } else if (ui.drag && ui.drag.kind === 'pan' && e.touches.length === 1) {
                    this.view.x = ui.drag.ox + (e.touches[0].clientX - ui.drag.sx);
                    this.view.y = ui.drag.oy + (e.touches[0].clientY - ui.drag.sy);
                    this.applyView();
                }
            }, { passive: false });
            vp.addEventListener('touchend', () => { pinch = null; ui.drag = null; });
        },

        // Style applied straight to the DOM and the model while dragging,
        // without a re-render per mouse move.
        liveStyle(nodeId, style) {
            const page = this.pageOfNode(nodeId);
            if (!page) return;
            const next = PrintableCore.updateNode(page, nodeId, { style: style });
            this.replacePage(next);
            const el = ui.world.querySelector('[data-pid="' + nodeId + '"]');
            if (el) PrintableDom.applyStyle(el, style);
            this.refreshOverlays();
        },

        startResize(e) {
            const node = this.selectedNode;
            if (!node) return;
            const el = ui.world.querySelector('[data-pid="' + node.id + '"]');
            if (!el) return;
            ui.drag = { kind: 'resize', nodeId: node.id, sx: e.clientX, sy: e.clientY, ow: el.offsetWidth, oh: el.offsetHeight, moved: false };
            e.preventDefault();
            e.stopPropagation();
        },

        // ── Inline text editing ──────────────────────────────────────────

        startTextEdit(nodeId, el) {
            this.finishTextEdit();
            ui.editingText = nodeId;
            el.setAttribute('contenteditable', 'plaintext-only');
            el.classList.add('pe-editing');
            el.focus();
            const range = document.createRange();
            range.selectNodeContents(el);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
            const finish = () => this.finishTextEdit();
            el.addEventListener('blur', finish, { once: true });
            el.addEventListener('keydown', (ev) => {
                if (ev.key === 'Escape' || (ev.key === 'Enter' && !ev.shiftKey)) { ev.preventDefault(); el.blur(); }
            });
        },

        finishTextEdit() {
            const nodeId = ui.editingText;
            if (!nodeId) return;
            ui.editingText = null;
            const el = ui.world && ui.world.querySelector('[data-pid="' + nodeId + '"]');
            if (!el) return;
            const text = el.textContent;
            el.removeAttribute('contenteditable');
            el.classList.remove('pe-editing');
            const page = this.pageOfNode(nodeId);
            const node = page && PrintableCore.findNode(page, nodeId);
            if (!node || node.text === text) return;
            const next = PrintableCore.updateNode(page, nodeId, { text: text });
            this.replacePage(next);
            this.commit();
            this.renderPage(page.id);
            this.readProps();
        },

        // ── Keyboard ─────────────────────────────────────────────────────

        spaceHeld: false,

        bindKeys() {
            window.addEventListener('keydown', (e) => {
                const inField = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) || document.activeElement.isContentEditable
                    || document.activeElement.closest('.CodeMirror');
                const mod = e.ctrlKey || e.metaKey;
                if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); this.save(true); return; }
                if (mod && e.key.toLowerCase() === 'p') { e.preventDefault(); this.printPrintable(); return; }
                if (inField) return;
                if (e.key === ' ') { this.spaceHeld = true; if (ui.viewport) ui.viewport.classList.add('pe-space'); e.preventDefault(); return; }
                if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) this.redo(); else this.undo(); return; }
                if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); this.redo(); return; }
                if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); this.duplicateSelected(); return; }
                if (mod && (e.key === '=' || e.key === '+')) { e.preventDefault(); this.zoomIn(); return; }
                if (mod && e.key === '-') { e.preventDefault(); this.zoomOut(); return; }
                if (mod && e.key === '0') { e.preventDefault(); this.fitToView(); return; }
                if (e.key === 'Delete' || e.key === 'Backspace') { if (this.selection.nodeId) { e.preventDefault(); this.deleteSelected(); } return; }
                if (e.key === 'Escape') { this.menu.open = false; this.fileMenu = false; if (this.selection.nodeId) this.clearSelection(); return; }
            });
            window.addEventListener('keyup', (e) => {
                if (e.key === ' ') { this.spaceHeld = false; if (ui.viewport) ui.viewport.classList.remove('pe-space'); }
            });
        },

        // ── The element tree ─────────────────────────────────────────────

        renderTree() {
            if (!ui.tree || !this.project) return;
            const frag = document.createDocumentFragment();
            this.pages.forEach((page, i) => {
                const row = document.createElement('div');
                row.className = 'pe-tree__page' + (this.selection.pageId === page.id && !this.selection.nodeId ? ' is-selected' : '');
                row.innerHTML = '<span class="material-symbols-outlined">description</span>'
                    + '<span class="pe-tree__label"></span>'
                    + '<span class="pe-tree__acts">'
                    + '<button type="button" title="Move up" data-act="up"><span class="material-symbols-outlined">arrow_upward</span></button>'
                    + '<button type="button" title="Move down" data-act="down"><span class="material-symbols-outlined">arrow_downward</span></button>'
                    + '<button type="button" title="Duplicate page" data-act="dup"><span class="material-symbols-outlined">content_copy</span></button>'
                    + '<button type="button" title="Delete page" data-act="del"><span class="material-symbols-outlined">delete</span></button>'
                    + '</span>';
                row.querySelector('.pe-tree__label').textContent = 'Page ' + (i + 1) + (page.name ? ' · ' + page.name : '');
                row.addEventListener('click', (e) => {
                    const act = e.target.closest('[data-act]');
                    if (act) {
                        const a = act.getAttribute('data-act');
                        if (a === 'up') this.movePage(page.id, -1);
                        else if (a === 'down') this.movePage(page.id, 1);
                        else if (a === 'dup') this.duplicatePage(page.id);
                        else if (a === 'del') this.deletePage(page.id);
                        return;
                    }
                    this.selectPage(page.id);
                    this.scrollToPage(page.id);
                });
                row.addEventListener('dragover', (e) => { if (ui.treeDrag) { e.preventDefault(); row.classList.add('is-drop'); } });
                row.addEventListener('dragleave', () => row.classList.remove('is-drop'));
                row.addEventListener('drop', (e) => {
                    e.preventDefault(); row.classList.remove('is-drop');
                    if (!ui.treeDrag) return;
                    this.dropOnPage(ui.treeDrag.nodeId, page.id);
                    ui.treeDrag = null;
                });
                frag.appendChild(row);
                const list = document.createElement('div');
                list.className = 'pe-tree__list';
                page.nodes.forEach(n => list.appendChild(this.treeRow(page, n, 1)));
                frag.appendChild(list);
            });
            ui.tree.innerHTML = '';
            ui.tree.appendChild(frag);
            const sel = ui.tree.querySelector('.is-selected');
            if (sel && sel.scrollIntoViewIfNeeded) sel.scrollIntoViewIfNeeded(false);
        },

        treeRow(page, node, depth) {
            const kind = PrintableCore.kindOf(node);
            const wrap = document.createElement('div');
            const row = document.createElement('div');
            row.className = 'pe-tree__row' + (this.selection.nodeId === node.id ? ' is-selected' : '');
            row.style.paddingLeft = (8 + depth * 14) + 'px';
            row.setAttribute('draggable', 'true');
            row.setAttribute('data-node', node.id);
            const icon = kind === 'image' ? 'image' : kind === 'text' ? 'title' : node.repeat ? 'repeat' : 'crop_square';
            const preview = kind === 'text' ? (node.text || '').slice(0, 28) : '';
            row.innerHTML = '<span class="material-symbols-outlined"></span><span class="pe-tree__label"></span><span class="pe-tree__hint"></span>'
                + (node.bind ? '<span class="material-symbols-outlined pe-tree__bound" title="Wired to data">cable</span>' : '');
            row.querySelector('.material-symbols-outlined').textContent = icon;
            row.querySelector('.pe-tree__label').textContent = node.name || this.tagLabel(node);
            row.querySelector('.pe-tree__hint').textContent = preview;
            row.addEventListener('click', () => this.select(page.id, node.id));
            row.addEventListener('dblclick', () => { this.select(page.id, node.id); this.$nextTick(() => { const el = document.getElementById('pe-prop-name'); if (el) { el.focus(); el.select(); } }); });
            row.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                this.select(page.id, node.id);
                const v = ui.viewport.getBoundingClientRect();
                this.menu = { open: true, x: Math.max(8, e.clientX - v.left), y: e.clientY - v.top, nodeId: node.id, pageId: page.id };
            });
            row.addEventListener('dragstart', (e) => {
                ui.treeDrag = { nodeId: node.id, pageId: page.id };
                e.dataTransfer.effectAllowed = 'move';
                try { e.dataTransfer.setData('text/plain', node.id); } catch (err) { /* IE */ }
            });
            row.addEventListener('dragend', () => { ui.treeDrag = null; this.clearDropMarks(); });
            row.addEventListener('dragover', (e) => {
                if (!ui.treeDrag || ui.treeDrag.nodeId === node.id) return;
                e.preventDefault();
                const r = row.getBoundingClientRect();
                const y = (e.clientY - r.top) / r.height;
                const where = kind === 'box' ? (y < 0.25 ? 'before' : y > 0.75 ? 'after' : 'inside') : (y < 0.5 ? 'before' : 'after');
                row.classList.remove('is-drop-before', 'is-drop-after', 'is-drop-inside');
                row.classList.add('is-drop-' + where);
                row.setAttribute('data-where', where);
            });
            row.addEventListener('dragleave', () => { row.classList.remove('is-drop-before', 'is-drop-after', 'is-drop-inside'); });
            row.addEventListener('drop', (e) => {
                e.preventDefault();
                const where = row.getAttribute('data-where');
                row.classList.remove('is-drop-before', 'is-drop-after', 'is-drop-inside');
                if (!ui.treeDrag || !where) return;
                this.dropOnNode(ui.treeDrag, page, node, where);
                ui.treeDrag = null;
            });
            wrap.appendChild(row);
            (node.children || []).forEach(c => wrap.appendChild(this.treeRow(page, c, depth + 1)));
            return wrap;
        },

        clearDropMarks() {
            if (!ui.tree) return;
            ui.tree.querySelectorAll('.is-drop, .is-drop-before, .is-drop-after, .is-drop-inside').forEach(el => {
                el.classList.remove('is-drop', 'is-drop-before', 'is-drop-after', 'is-drop-inside');
            });
        },

        // Dropping across pages moves the element to the other page.
        dropOnNode(drag, page, target, where) {
            if (drag.pageId !== page.id) {
                this.moveAcrossPages(drag, page, target, where);
                return;
            }
            const at = PrintableCore.locate(page, target.id);
            if (!at) return;
            if (where === 'inside') this.moveElement(drag.nodeId, target.id, null);
            else this.moveElement(drag.nodeId, at.parent ? at.parent.id : null, where === 'before' ? at.index : at.index + 1);
        },

        dropOnPage(nodeId, pageId) {
            const from = this.pageOfNode(nodeId);
            if (!from) return;
            if (from.id === pageId) { this.selection.pageId = pageId; this.moveElement(nodeId, null, null); return; }
            this.moveAcrossPages({ nodeId: nodeId, pageId: from.id }, this.pages.find(p => p.id === pageId), null, 'inside');
        },

        moveAcrossPages(drag, page, target, where) {
            const from = this.pages.find(p => p.id === drag.pageId);
            const node = PrintableCore.findNode(from, drag.nodeId);
            if (!node) return;
            const without = PrintableCore.removeNode(from, drag.nodeId);
            let parentId = null, index = null;
            if (target) {
                const at = PrintableCore.locate(page, target.id);
                if (where === 'inside') parentId = target.id;
                else { parentId = at.parent ? at.parent.id : null; index = where === 'before' ? at.index : at.index + 1; }
            }
            const placed = PrintableCore.insertNode(page, parentId, node, index);
            this.replacePage(without);
            this.replacePage(placed);
            this.commit();
            this.renderAll();
            this.select(page.id, drag.nodeId);
        },

        // ── The context menu ─────────────────────────────────────────────

        menuAct(action) {
            this.menu.open = false;
            if (action === 'duplicate') this.duplicateSelected();
            else if (action === 'delete') this.deleteSelected();
            else if (action === 'wrap') this.wrapSelected();
            else if (action === 'forward') this.nudgeSelected(1);
            else if (action === 'back') this.nudgeSelected(-1);
            else if (action === 'iterate') this.makeIterated && this.makeIterated();
            else if (action === 'add-page') this.addPage(this.menu.pageId);
            else if (action === 'dup-page') this.duplicatePage(this.menu.pageId);
            else if (action === 'del-page') this.deletePage(this.menu.pageId);
            else if (action === 'rename') this.$nextTick(() => { const el = document.getElementById('pe-prop-name'); if (el) { el.focus(); el.select(); } });
        },

        // ── Code view (MS-395) ───────────────────────────────────────────

        toggleCode() {
            this.codeOpen = !this.codeOpen;
            this.fileMenu = false;
            if (this.codeOpen) this.$nextTick(() => this.mountCode());
        },

        mountCode() {
            if (typeof CodeMirror === 'undefined') return;
            const mk = (id, mode) => {
                const host = document.getElementById(id);
                if (!host) return null;
                host.innerHTML = '';
                const cm = CodeMirror(host, {
                    mode: mode, theme: 'material-darker', lineNumbers: true, lineWrapping: true,
                    autoCloseBrackets: true, matchBrackets: true, tabSize: 2, indentUnit: 2,
                });
                cm.on('change', () => { if (!ui.cmSuppress) { this.codeDirty = true; } });
                return cm;
            };
            ui.cm.html = mk('pe-cm-html', 'htmlmixed');
            ui.cm.css = mk('pe-cm-css', 'css');
            this.syncCode(true);
        },

        // The panes follow the selected page. Left alone while the code has
        // unapplied edits, so a click on the canvas cannot throw them away.
        syncCode(force) {
            if (!this.codeOpen || !ui.cm.html || !this.currentPage) return;
            if (this.codeDirty && !force) return;
            ui.cmSuppress = true;
            ui.cm.html.setValue(PrintableCore.pageToHtml(this.currentPage));
            ui.cm.css.setValue(this.currentPage.css || '');
            ui.cmSuppress = false;
            this.codeDirty = false;
            this.codeProblem = '';
            setTimeout(() => { ui.cm.html.refresh(); ui.cm.css.refresh(); }, 30);
        },

        applyCode() {
            const page = this.currentPage;
            if (!page || !ui.cm.html) return;
            const parsed = PrintableCore.htmlToNodes(ui.cm.html.getValue());
            if (!parsed.ok) { this.codeProblem = parsed.problems[0]; return; }
            const next = Object.assign({}, page, { nodes: parsed.nodes, css: ui.cm.css.getValue() });
            this.replacePage(next);
            this.codeProblem = '';
            this.codeDirty = false;
            if (this.selection.nodeId && !PrintableCore.findNode(next, this.selection.nodeId)) this.selection.nodeId = null;
            this.commit();
            this.renderPage(next.id);
            this.readProps();
            this.syncCode(true);
        },

        discardCode() { this.syncCode(true); },

        // ── Print (MS-398) ───────────────────────────────────────────────

        printPrintable() {
            this.fileMenu = false;
            if (!this.project || !this.template) return;
            this.finishTextEdit();
            const layer = document.getElementById('pe-print');
            if (!layer) return;
            layer.innerHTML = '';
            const t = this.template;
            const scale = PrintableCore.printScale(t);
            const style = document.createElement('style');
            style.textContent = '@page { size: ' + t.widthIn + 'in ' + t.heightIn + 'in; margin: 0; }'
                + ' .pe-sheet { width: ' + t.widthIn + 'in; height: ' + t.heightIn + 'in; overflow: hidden; page-break-after: always; break-after: page; position: relative; }'
                + ' .pe-sheet > .pr-page { transform: scale(' + scale + '); transform-origin: 0 0; }';
            layer.appendChild(style);
            const pages = this.printPages ? this.printPages() : this.pages.map(p => ({ page: p }));
            pages.forEach(entry => {
                const sheet = document.createElement('div');
                sheet.className = 'pe-sheet';
                sheet.appendChild(PrintableDom.renderPage(entry.page, t, { values: entry.values || null }));
                layer.appendChild(sheet);
            });
            document.body.classList.add('pe-printing');
            const done = () => { document.body.classList.remove('pe-printing'); layer.innerHTML = ''; window.removeEventListener('afterprint', done); };
            window.addEventListener('afterprint', done);
            setTimeout(() => window.print(), 150);
        },

        // A hook MS-397 fills in: the pages to print, overflow pages included.
        printPages: null,
    };
}
