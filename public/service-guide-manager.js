// Service Guide Manager (ADR-0008 §5) — the authoring surface, gated to editor+.
//
// Three sub-areas over the new global collections:
//   1. Page Library    — create/edit/delete Page Templates in a split editor
//                        (HTML + CSS) with a live preview against sample data, a
//                        Component palette, and inline validation.
//   2. Style Presets   — reusable master CSS a Page Template can inherit.
//   3. Guide Templates — assemble ordered Page Templates into a Service Guide
//                        Template, set the target page count, mark the Filler
//                        Page, and choose the church-wide default.
//
// Guardrails (the editor+ group is wide and a bad template can brick the
// booklet): preview-before-save, inline validation, and "reset to seeded
// default". The per-week snapshot (ADR-0008 #3) is what makes this safe — a bad
// edit can never retroactively break an already-printed week.
//
// Reuses the pure engine for preview/validation; no special-cased rendering.

function guideManager() {
    // CodeMirror instances live OUTSIDE the object Alpine makes reactive. If they
    // were stored as Alpine data, Alpine would wrap them in reactive Proxies, and
    // calling CM methods through the proxy leaks proxied objects into CodeMirror's
    // internals — its rendered line views then fail their identity checks against
    // the document (mapFromLineView returns undefined) and clicking a line throws,
    // so you can't place the cursor. Keeping them in this closure keeps them raw.
    const __cm = { html: null, css: null };
    return {
        userRole: 'viewer',
        loading: true,
        tab: 'pages',
        catalog: (window.GuideComponents && window.GuideComponents.defaultCatalog) || null,
        palette: { bound: [], input: [] },

        stylePresets: [],
        pageTemplates: [],
        guideTemplates: [],
        assets: [],
        uploadingAssets: false,

        // editing buffers
        editingPage: null,         // { id?, name, html, css, stylePresetId, emitsPages, isFiller }
        pageValidation: { ok: true, problems: [] },
        pagePreviewPages: [],
        // IDE editor state (Page Library split editor)
        editorTab: 'html',         // 'html' | 'css'
        paletteOpen: true,         // collapsible Insert palette beside the code editor
        paletteWidth: 176,         // px width of the open Insert palette (drag-resizable)
        splitPct: 56,              // % width of the editor column vs the live preview
        previewZoom: 0.75,
        _cmSuppress: false,        // ignore CodeMirror change events while we set values
        _previewTimer: null,
        _fitTimer: null,
        editingPreset: null,       // { id?, name, css }
        editingTemplate: null,     // { id?, name, targetPageCount, isDefault, pages:[] }

        toast: '',
        _uidCounter: 0,

        get canEdit() { return ['editor', 'elder', 'admin', 'super_admin'].includes(this.userRole); },

        async init() {
            const self = this;
            // Keep the live preview fitted when the window is resized or moved to a
            // different monitor, so the editor never depends on the screen ratio.
            window.addEventListener('resize', () => {
                if (!self.editingPage) return;
                clearTimeout(self._fitTimer);
                self._fitTimer = setTimeout(() => {
                    self.fitPreview();
                    const cm = self.editorTab === 'html' ? __cm.html : __cm.css;
                    if (cm) cm.refresh();
                }, 150);
            });
            auth.onAuthStateChanged(async (user) => {
                if (!user) { window.location.href = 'login.html'; return; }
                const userData = await getUserData(user.uid);
                self.userRole = (userData && userData.role) || 'viewer';
                if (!self.canEdit) { window.location.href = 'service-calendar.html'; return; }
                self.palette = self.catalog.palette();
                try {
                    await self.reload();
                    if (!self.guideTemplates.length) {
                        await GuideStore.seedAll(db, self.catalog);
                        await self.reload();
                    }
                } catch (e) {
                    console.error('Failed to load the manager:', e);
                    alert('Could not load templates. Check the console.');
                }
                self.loading = false;
            });
        },

        async reload() {
            const data = await GuideStore.loadCatalog(db);
            this.stylePresets = data.stylePresets.sort(byName);
            this.pageTemplates = data.pageTemplates.sort(byName);
            this.guideTemplates = data.guideTemplates.sort(byName);
            try { this.assets = (await GuideStore.loadAssets(db)).sort(byName); } catch (e) { console.warn('Assets failed to load', e); }
        },

        flash(msg) { this.toast = msg; setTimeout(() => { if (this.toast === msg) this.toast = ''; }, 2500); },

        // ── Asset Library ──────────────────────────────────────────────────────────
        // Read an image File's natural dimensions (best-effort) before upload.
        _imageSize(file) {
            return new Promise((resolve) => {
                if (!/^image\//.test(file.type)) { resolve({}); return; }
                const url = URL.createObjectURL(file);
                const img = new Image();
                img.onload = () => { resolve({ width: img.naturalWidth, height: img.naturalHeight }); URL.revokeObjectURL(url); };
                img.onerror = () => { resolve({}); URL.revokeObjectURL(url); };
                img.src = url;
            });
        },
        async uploadAssets(event) {
            const files = Array.from(event.target.files || []);
            if (!files.length) return;
            this.uploadingAssets = true;
            try {
                for (const file of files) {
                    const dims = await this._imageSize(file);
                    const name = file.name.replace(/\.[^.]+$/, '');
                    await GuideStore.saveAsset(db, file, Object.assign({ name }, dims));
                }
                await this.reload();
                this.flash(files.length === 1 ? 'Asset uploaded' : (files.length + ' assets uploaded'));
            } catch (e) {
                console.error('Asset upload failed', e);
                alert('Upload failed: ' + (e && e.message ? e.message : e));
            } finally {
                this.uploadingAssets = false;
                event.target.value = ''; // allow re-selecting the same file
            }
        },
        async renameAsset(asset) {
            const name = (asset.name || '').trim() || 'Asset';
            asset.name = name;
            try { await GuideStore.renameAsset(db, asset.id, name); } catch (e) { console.warn('Rename failed', e); }
        },
        async deleteAsset(asset) {
            if (!confirm('Delete "' + asset.name + '"? Pages still referencing it will show a broken image.')) return;
            try {
                await GuideStore.deleteAsset(db, asset);
                this.assets = this.assets.filter(a => a.id !== asset.id);
                this.flash('Asset deleted');
            } catch (e) {
                console.error('Delete failed', e);
                alert('Could not delete the asset.');
            }
        },
        assetSnippet(asset) {
            const alt = String(asset.name || 'image').replace(/"/g, '&quot;');
            return '<img src="' + asset.url + '" alt="' + alt + '" class="w-[3em] h-auto" />';
        },
        async copyAssetSnippet(asset) {
            await this._copy(this.assetSnippet(asset), 'Image tag copied — paste it into a page');
        },
        async copyAssetUrl(asset) {
            await this._copy(asset.url, 'URL copied');
        },
        async _copy(text, okMsg) {
            try {
                await navigator.clipboard.writeText(text);
                this.flash(okMsg);
            } catch (e) {
                // Fallback for older/insecure contexts.
                const ta = document.createElement('textarea');
                ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
                document.body.appendChild(ta); ta.select();
                try { document.execCommand('copy'); this.flash(okMsg); } catch (_) { alert('Copy failed — here it is:\n\n' + text); }
                document.body.removeChild(ta);
            }
        },
        formatBytes(n) {
            if (!n) return '';
            if (n < 1024) return n + ' B';
            if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
            return (n / (1024 * 1024)).toFixed(1) + ' MB';
        },

        pageTemplateName(id) {
            const pt = this.pageTemplates.find(p => p.id === id);
            return (pt && pt.name) || id || '(none)';
        },
        pageTemplate(id) { return this.pageTemplates.find(p => p.id === id); },
        isSeed(id) { return typeof id === 'string' && id.indexOf('seed_') === 0; },

        // ── Page Library ─────────────────────────────────────────────────────────
        newPage() {
            this.editingPage = { name: 'New Page', html: '<div class="h-full"></div>', css: '',
                stylePresetId: (this.stylePresets[0] && this.stylePresets[0].id) || '', emitsPages: 'single', isFiller: false };
            this.editorTab = 'html';
            this.refreshPagePreview();
            this.openEditorUI();
        },
        editPage(pt) {
            this.editingPage = JSON.parse(JSON.stringify(pt));
            if (this.editingPage.emitsPages == null) this.editingPage.emitsPages = 'single';
            this.editorTab = 'html';
            this.refreshPagePreview();
            this.openEditorUI();
        },
        closePage() {
            this.editingPage = null;
            this.pagePreviewPages = [];
            // The editor markup is removed from the DOM (x-if) on close, which takes
            // the CodeMirror instances with it — drop the refs so they re-create
            // against the fresh textareas next time a page is opened.
            __cm.html = null;
            __cm.css = null;
        },

        // ── code editor (CodeMirror) ───────────────────────────────────────────
        // Enhance the two textareas into line-numbered, syntax-highlighted editors.
        // Created once (lazily) and reused; falls back to the plain textareas when
        // the CodeMirror CDN is unavailable.
        initCodeEditors() {
            if (typeof CodeMirror === 'undefined') return;
            const self = this;
            const common = {
                theme: 'material-darker', lineNumbers: true, lineWrapping: false,
                autoCloseBrackets: true, matchBrackets: true, styleActiveLine: true,
                tabSize: 2, indentUnit: 2,
            };
            if (!__cm.html) {
                const ta = document.getElementById('page-html-editor');
                if (ta) {
                    __cm.html = CodeMirror.fromTextArea(ta, Object.assign({ mode: 'htmlmixed' }, common));
                    __cm.html.on('change', (cm) => {
                        if (self._cmSuppress || !self.editingPage) return;
                        self.editingPage.html = cm.getValue();
                        self.schedulePreview();
                    });
                }
            }
            if (!__cm.css) {
                const ta = document.getElementById('page-css-editor');
                if (ta) {
                    __cm.css = CodeMirror.fromTextArea(ta, Object.assign({ mode: 'css' }, common));
                    __cm.css.on('change', (cm) => {
                        if (self._cmSuppress || !self.editingPage) return;
                        self.editingPage.css = cm.getValue();
                        self.schedulePreview();
                    });
                }
            }
        },
        // Re-measure both editors. CodeMirror caches line geometry at creation; if it
        // was measured before the flex layout settled or before the mono font loaded,
        // clicks map to the wrong line (you can place the cursor at the very top or
        // bottom but not in the middle). refresh() recomputes that geometry.
        refreshEditors() {
            if (__cm.html) __cm.html.refresh();
            if (__cm.css) __cm.css.refresh();
        },
        // Push the current editingPage buffer into the editors without retriggering
        // the change handlers, then refresh layout.
        syncEditorsFromState() {
            if (!this.editingPage) return;
            this._cmSuppress = true;
            if (__cm.html) __cm.html.setValue(this.editingPage.html || '');
            if (__cm.css) __cm.css.setValue(this.editingPage.css || '');
            this._cmSuppress = false;
            this.$nextTick(() => this.refreshEditors());
        },
        openEditorUI() {
            this.$nextTick(() => {
                this.initCodeEditors();
                this.syncEditorsFromState();
                this.fitPreview();
                // Re-measure after the layout has actually painted (double rAF) and
                // once the editor font has loaded — either can land after the initial
                // $nextTick, leaving CodeMirror with stale geometry until then.
                requestAnimationFrame(() => requestAnimationFrame(() => this.refreshEditors()));
                if (document.fonts && document.fonts.ready) {
                    document.fonts.ready.then(() => this.refreshEditors());
                }
            });
        },
        setEditorTab(tab) {
            this.editorTab = tab;
            this.$nextTick(() => {
                const cm = tab === 'html' ? __cm.html : __cm.css;
                if (cm) cm.refresh();
            });
        },
        // Collapse/expand the Insert palette; the code editor changes width, so let
        // CodeMirror re-measure once the layout settles.
        togglePalette() {
            this.paletteOpen = !this.paletteOpen;
            this.$nextTick(() => {
                const cm = this.editorTab === 'html' ? __cm.html : __cm.css;
                if (cm) cm.refresh();
            });
        },
        // Drag the splitter between two panes. which='palette' resizes the Insert
        // panel (px, relative to the editor area); which='main' resizes the editor
        // column vs the live preview (% of the body).
        startResize(e, which) {
            e.preventDefault();
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
            const move = (ev) => {
                if (which === 'main') {
                    const c = document.getElementById('editor-body');
                    if (!c) return;
                    const r = c.getBoundingClientRect();
                    this.splitPct = Math.min(80, Math.max(20, ((ev.clientX - r.left) / r.width) * 100));
                } else {
                    const c = document.getElementById('editor-area');
                    if (!c) return;
                    const r = c.getBoundingClientRect();
                    this.paletteWidth = Math.min(420, Math.max(120, ev.clientX - r.left));
                }
            };
            const stop = () => {
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
                document.removeEventListener('mousemove', move);
                document.removeEventListener('mouseup', stop);
                const cm = this.editorTab === 'html' ? __cm.html : __cm.css;
                if (cm) cm.refresh();
            };
            document.addEventListener('mousemove', move);
            document.addEventListener('mouseup', stop);
        },
        schedulePreview() {
            clearTimeout(this._previewTimer);
            this._previewTimer = setTimeout(() => this.refreshPagePreview(), 200);
        },
        zoomPreview(delta) {
            this.previewZoom = Math.min(3, Math.max(0.3, Math.round((this.previewZoom + delta) * 100) / 100));
            this.resetPan(); // recentre on zoom
        },
        // Ctrl + mouse wheel zooms the preview, anchored to the cursor so you zoom
        // into whatever you're pointing at (rather than recentring). Plain wheel is
        // left alone. Intercepts the browser's page-zoom while over the preview.
        wheelZoom(e) {
            if (!e.ctrlKey) return;
            e.preventDefault();
            const el = document.getElementById('preview-scroll');
            if (!el) return;
            const z0 = this.previewZoom;
            const z1 = Math.min(3, Math.max(0.3, Math.round(z0 * (e.deltaY < 0 ? 1.1 : 1 / 1.1) * 100) / 100));
            if (z1 === z0) return;
            const f = z1 / z0;
            const r = el.getBoundingClientRect();
            const qx = e.clientX - (r.left + r.width / 2);
            const qy = e.clientY - (r.top + r.height / 2);
            this.previewZoom = z1;
            this.panX = qx * (1 - f) + f * this.panX;
            this.panY = qy * (1 - f) + f * this.panY;
            this.clampPan();
        },
        // Scale the page so the WHOLE 5.5in × 8.5in sheet fits inside the preview
        // pane. The page is portrait, so height is usually the binding constraint —
        // fitting width alone left the bottom half off-screen.
        fitPreview() {
            const el = document.getElementById('preview-scroll');
            if (!el) return;
            const pad = 48; // p-6 on every side
            const availW = el.clientWidth - pad;
            const availH = el.clientHeight - pad;
            if (availW <= 0 || availH <= 0) return;
            const pageW = 5.5 * 96;
            const pageH = 8.5 * 96;
            const z = Math.min(availW / pageW, availH / pageH);
            this.previewZoom = Math.min(1.5, Math.max(0.3, Math.round(z * 100) / 100));
            this.resetPan(); // recentre on fit
        },

        // Grab-to-pan: left-click and drag anywhere in the preview to move the page
        // around. The page stack lives on a "canvas" we translate directly via panX/
        // panY, so panning never depends on scroll overflow engaging (which behaved
        // inconsistently across monitors). Mouse events + preventDefault keep a drag
        // over the rendered page text from turning into a text selection.
        panning: false,
        panX: 0,
        panY: 0,
        startPan(e) {
            if (e.button !== 0) return; // left button only
            const startX = e.clientX, startY = e.clientY;
            const baseX = this.panX, baseY = this.panY;
            this.panning = true;
            const move = (ev) => {
                this.panX = baseX + (ev.clientX - startX);
                this.panY = baseY + (ev.clientY - startY);
                this.clampPan();
                ev.preventDefault();
            };
            const stop = () => {
                this.panning = false;
                document.removeEventListener('mousemove', move);
                document.removeEventListener('mouseup', stop);
            };
            document.addEventListener('mousemove', move);
            document.addEventListener('mouseup', stop);
            e.preventDefault(); // don't start a text selection while dragging
        },
        // Effectively unbounded panning: you can drag the page far past the pane edges
        // in any direction without worrying about zoom. The clamp only exists as a
        // distant backstop (a few screenfuls of slack) so the page can always be
        // found again — hit Fit to recentre.
        clampPan() {
            const el = document.getElementById('preview-scroll');
            const inner = document.getElementById('preview-canvas');
            if (!el || !inner) return;
            const slackX = el.clientWidth * 3 + 2000;
            const slackY = el.clientHeight * 3 + 2000;
            const maxX = Math.max(0, (inner.scrollWidth - el.clientWidth) / 2) + slackX;
            const maxY = Math.max(0, (inner.scrollHeight - el.clientHeight) / 2) + slackY;
            this.panX = Math.min(maxX, Math.max(-maxX, this.panX));
            this.panY = Math.min(maxY, Math.max(-maxY, this.panY));
        },
        resetPan() { this.panX = 0; this.panY = 0; },

        // Live validation + preview against sample data.
        refreshPagePreview() {
            const p = this.editingPage;
            if (!p) return;
            this.pageValidation = GuideEngine.validatePageHtml(p.html || '', this.catalog);
            const fields = this.pageValidation.entryFields || [];
            const snapshotPage = {
                pageTemplateId: p.id || 'preview', role: 'normal',
                html: p.html || '', css: p.css || '',
                resolvedStylePresetCss: this.presetCss(p.stylePresetId),
                entryFields: fields, emitsPages: p.emitsPages || 'single', params: this.samplePageParams(p),
            };
            try {
                this.pagePreviewPages = GuideEngine.expandPage(snapshotPage, sampleValues(fields), SAMPLE_CONTEXT, this.catalog);
            } catch (e) {
                this.pagePreviewPages = [];
            }
            this.applyPreviewStyles(snapshotPage);
        },
        presetCss(id) {
            const sp = this.stylePresets.find(s => s.id === id);
            return (sp && sp.css) || '';
        },
        // For a component (hymn) page, preview against a sample hymn slot.
        samplePageParams(p) {
            return (p.emitsPages === 'component') ? { field: 'hymn1' } : {};
        },
        applyPreviewStyles(snapshotPage) {
            const el = document.getElementById('manager-dynamic-style');
            if (el) el.textContent = (snapshotPage.resolvedStylePresetCss || '') + '\n' + (snapshotPage.css || '');
        },

        insertTag(tag, kind) {
            let snippet;
            if (kind === 'input') {
                const key = (tag === 'input-list') ? 'my_list' : 'my_field';
                const extra = (tag === 'input-list') ? ' render-as="bullets"' : '';
                snippet = `<${tag} key="${key}" label="My Field"${extra}></${tag}>`;
            } else {
                snippet = `<${tag}></${tag}>`;
            }
            // Components live in the HTML, so always target the HTML editor.
            if (__cm.html) {
                if (this.editorTab !== 'html') this.setEditorTab('html');
                const cm = __cm.html;
                this.$nextTick(() => {
                    cm.replaceSelection(snippet);
                    this.editingPage.html = cm.getValue();
                    cm.focus();
                    this.refreshPagePreview();
                });
                return;
            }
            // Fallback: plain textarea (CodeMirror unavailable).
            const ta = document.getElementById('page-html-editor');
            if (!ta) return;
            const start = ta.selectionStart || 0;
            const end = ta.selectionEnd || 0;
            const v = this.editingPage.html || '';
            this.editingPage.html = v.slice(0, start) + snippet + v.slice(end);
            this.$nextTick(() => { ta.focus(); ta.selectionStart = ta.selectionEnd = start + snippet.length; this.refreshPagePreview(); });
        },

        async savePage() {
            if (!this.editingPage.name || !this.editingPage.name.trim()) { alert('Give the page a name.'); return; }
            this.refreshPagePreview();
            if (!this.pageValidation.ok && !confirm('This page has validation problems (unknown tags or duplicate field keys). Save anyway?')) return;
            try {
                const id = await GuideStore.savePageTemplate(db, this.editingPage, this.catalog);
                await this.reload();
                this.editingPage = JSON.parse(JSON.stringify(this.pageTemplate(id)));
                this.syncEditorsFromState();
                this.flash('Page saved');
            } catch (e) { console.error(e); alert('Error saving page. Check the console.'); }
        },
        async deletePage(pt) {
            if (this.usedByTemplates(pt.id).length) { alert('This page is used by a Service Guide Template; remove it there first.'); return; }
            if (!confirm(`Delete the page "${pt.name}"?`)) return;
            await GuideStore.deletePageTemplate(db, pt.id);
            if (this.editingPage && this.editingPage.id === pt.id) this.closePage();
            await this.reload();
            this.flash('Page deleted');
        },
        usedByTemplates(pageTemplateId) {
            return this.guideTemplates.filter(gt => (gt.pages || []).some(pl => pl.pageTemplateId === pageTemplateId));
        },

        // ── Style Presets ──────────────────────────────────────────────────────
        newPreset() { this.editingPreset = { name: 'New Style Preset', css: '' }; },
        editPreset(sp) { this.editingPreset = JSON.parse(JSON.stringify(sp)); },
        closePreset() { this.editingPreset = null; },
        async savePreset() {
            if (!this.editingPreset.name || !this.editingPreset.name.trim()) { alert('Give the preset a name.'); return; }
            try {
                const id = await GuideStore.saveStylePreset(db, this.editingPreset);
                await this.reload();
                this.editingPreset = JSON.parse(JSON.stringify(this.stylePresets.find(s => s.id === id)));
                this.flash('Style preset saved');
            } catch (e) { console.error(e); alert('Error saving preset.'); }
        },
        async deletePreset(sp) {
            if (this.pageTemplates.some(pt => pt.stylePresetId === sp.id)) { alert('This preset is inherited by a Page Template; change those first.'); return; }
            if (!confirm(`Delete the style preset "${sp.name}"?`)) return;
            await GuideStore.deleteStylePreset(db, sp.id);
            if (this.editingPreset && this.editingPreset.id === sp.id) this.closePreset();
            await this.reload();
            this.flash('Preset deleted');
        },

        // ── Service Guide Templates ──────────────────────────────────────────────
        // Stable client id for each placement row, so the reorder/remove x-for is
        // keyed by identity (not array index) and native control state follows
        // the moved row. Stripped before save.
        _uid() { return 'row' + (this._uidCounter++); },
        newTemplate() {
            this.editingTemplate = { name: 'New Service Guide Template', targetPageCount: 16, numberStartPage: 2, isDefault: false, pages: [] };
        },
        editTemplate(gt) {
            const copy = JSON.parse(JSON.stringify(gt));
            if (copy.numberStartPage == null) copy.numberStartPage = 2; // back-fill legacy templates
            copy.pages = (copy.pages || []).map(p => ({ pageTemplateId: p.pageTemplateId, role: p.role || 'normal', params: p.params || {}, _uid: this._uid() }));
            this.editingTemplate = copy;
        },
        closeTemplate() { this.editingTemplate = null; },
        addTemplatePage() {
            const first = this.pageTemplates[0];
            this.editingTemplate.pages.push({ pageTemplateId: first ? first.id : '', role: 'normal', params: {}, _uid: this._uid() });
        },
        removeTemplatePage(i) { this.editingTemplate.pages.splice(i, 1); },
        moveTemplatePage(i, delta) {
            const arr = this.editingTemplate.pages;
            const j = i + delta;
            if (j < 0 || j >= arr.length) return;
            const [item] = arr.splice(i, 1);
            arr.splice(j, 0, item);
        },
        setFiller(i) {
            // Exactly one Filler Page per template. The control is a radio, so it
            // can only move the filler, never clear it (cleared only by removing
            // the row); saveTemplate enforces exactly-one.
            this.editingTemplate.pages.forEach((p, idx) => { p.role = (idx === i) ? 'filler' : 'normal'; });
        },
        pageEmitsComponent(pageTemplateId) {
            const pt = this.pageTemplate(pageTemplateId);
            return pt && pt.emitsPages === 'component';
        },
        async saveTemplate() {
            const t = this.editingTemplate;
            if (!t.name || !t.name.trim()) { alert('Give the template a name.'); return; }
            // Exactly one Filler Page (it absorbs page-count variance to hit the target).
            if (t.pages.filter(p => p.role === 'filler').length !== 1) { alert('Mark exactly one page as the Filler Page.'); return; }
            // Never orphan the church default: a default template can't be demoted
            // without promoting another first (mirrors the delete guard).
            const prior = this.guideTemplates.find(g => g.id === t.id);
            if (prior && prior.isDefault && !t.isDefault) {
                alert('A church default is required. Make another template the default before removing it from this one.');
                return;
            }
            // Persist a clean copy: strip the client-only _uid from placements.
            const clean = {
                id: t.id, name: t.name, isDefault: !!t.isDefault,
                // Floor only (no longer user-set); the booklet auto-grows in ×4 above it.
                targetPageCount: Number(t.targetPageCount) > 0 ? Number(t.targetPageCount) : 16,
                numberStartPage: Number(t.numberStartPage) > 0 ? Number(t.numberStartPage) : 2,
                pages: t.pages.map(p => ({ pageTemplateId: p.pageTemplateId, role: p.role || 'normal', params: p.params || {} })),
            };
            try {
                const id = await GuideStore.saveGuideTemplate(db, clean);
                await this.reload();
                if (clean.isDefault) await this.makeDefault(id, true);
                await this.reload();
                this.editingTemplate = null;
                this.flash('Template saved');
            } catch (e) { console.error(e); alert('Error saving template.'); }
        },
        async makeDefault(id, silent) {
            await GuideStore.setDefaultGuideTemplate(db, id, this.guideTemplates);
            await this.reload();
            if (!silent) this.flash('Default template set');
        },
        async deleteTemplate(gt) {
            if (gt.isDefault) { alert('Set another template as default before deleting this one.'); return; }
            if (!confirm(`Delete the Service Guide Template "${gt.name}"? Past weeks keep their frozen snapshot.`)) return;
            await GuideStore.deleteGuideTemplate(db, gt.id);
            if (this.editingTemplate && this.editingTemplate.id === gt.id) this.closeTemplate();
            await this.reload();
            this.flash('Template deleted');
        },

        // Reset all seeded docs to their shipped definitions (guardrail).
        async resetSeed() {
            if (!confirm('Reset the seeded Style Preset, Page Templates, and the default Service Guide Template to their shipped versions? Your own custom templates are untouched.')) return;
            await GuideStore.seedAll(db, this.catalog);
            await this.reload();
            this.closePage(); this.closePreset(); this.closeTemplate();
            this.flash('Seeded defaults restored');
        },
    };
}

function byName(a, b) { return String(a.name || '').localeCompare(String(b.name || '')); }

// A representative context so the Page Library preview shows realistic output
// without a real week (ADR-0008 §5: preview against sample/placeholder data).
const SAMPLE_CONTEXT = {
    date: '2026-06-14', longDate: 'Sunday, June 14, 2026', shortDate: '06/14/26',
    theme: 'Sample Theme', keyVerse: 'John 3:16', keyVerseText: 'For God so loved the world…',
    preacher: 'Sample Preacher', musicLeader: 'Sample Music Leader', serviceLeader: 'Sample Leader',
    hasBaptism: false, removedHymns: [], baptismNames: '',
    liturgy: {
        prayerLabel: 'Pastoral Prayer', callToWorship: 'Psalm 100', callToConfession: '1 John 1:8',
        assuranceOfPardon: '1 John 1:9', scriptureReading: 'Romans 8', sermon: 'Sample Sermon', benediction: 'Numbers 6',
        preparatoryHymn: { name: 'Prep Hymn' }, hymn1: { id: 'h', name: 'Sample Hymn' }, hymn2: { name: 'Hymn Two' },
        hymnMid1: { name: 'Mid Hymn' }, hymnMid2: { name: 'Mid Hymn 2' }, hymnEnd1: { name: 'Closing Hymn' }, hymnEnd2: { name: 'Final Hymn' },
        prayerMale: { name: 'Sample Male' }, prayerFemale: { name: 'Sample Female' },
    },
    hymnsByField: { hymn1: { name: 'Sample Hymn', pages: [], attribution: 'Sample, 1900' } },
    schedule: [{ id: '2026-06-14', preacher: 'Sample Preacher', sermon: 'Sample Sermon' },
               { id: '2026-06-21', preacher: 'Guest', sermon: 'Acts 2' }],
};

function sampleValues(fields) {
    const out = {};
    for (const f of fields || []) {
        if (f.type === 'list') out[f.key] = (f.renderAs === 'announcements')
            ? [{ title: 'Sample Announcement', content: 'Sample details' }]
            : ['Sample item one', 'Sample item two'];
        else if (f.type === 'image') out[f.key] = null;
        else if (f.type === 'richtext') out[f.key] = '<p>Sample rich text content.</p>';
        else out[f.key] = 'Sample ' + (f.label || f.key);
    }
    return out;
}
