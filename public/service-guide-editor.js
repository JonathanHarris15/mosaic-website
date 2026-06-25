// Unified OOS / Service Guide Editor (ADR-0008 §6) — the weekly surface.
//
// Replaces the old service-guide.js generator: instead of eight hardcoded page
// types it drives the general pipeline. It resolves the Service into context,
// applies the church's default Service Guide Template (or a per-week override),
// renders the live booklet via GuideEngine, prompts for the snapshot's Entry
// Fields, and prints — all reusing the pure, tested engine. Structured liturgy
// (preacher / hymn / person pickers) stays in the Order of Service Builder, which
// this page links to; the structured Service remains the canonical source feeding
// Bound Components.
//
// Weeks whose guide predates this system (no format:'v2') render through the kept
// legacy generator (service-guide.html); this page offers to rebuild them on the
// template system.
//
// db / auth / getUserData come from auth.js; GuideEngine / GuideComponents /
// GuideSeed / GuideStore / DateUtils from their modules loaded before this one.

const ESV_API_KEY = '3ca8c306dfdefdc42598bb88a037361a0f44cb0b';

function guideEditorV2() {
    return {
        date: '',
        userRole: 'viewer',
        loading: true,
        saving: false,
        legacy: false,
        legacyGuideUrl: '',
        _baseline: null,      // JSON of the saved state; drives hasChanges by diff
        _resolveTimer: null,

        service: null,
        context: null,
        catalogData: { stylePresets: [], pageTemplates: [], guideTemplates: [] },
        catalog: (window.GuideComponents && window.GuideComponents.defaultCatalog) || null,
        stylePresetsById: {},
        pageTemplatesById: {},

        selectedTemplateId: '',
        snapshot: null,
        values: {},
        resolved: { pages: [], total: 0, realCount: 0, fillerCount: 0, overflow: false, target: 16 },

        selectedPageIndex: null,
        zoomLevel: 1.0,

        previousAnnouncements: [],
        previousAnnouncementsDate: '',

        get canEdit() { return ['editor', 'elder', 'admin', 'super_admin'].includes(this.userRole); },

        // Dirty by diff against the last saved state (template + values), so
        // merely opening or clicking around never shows "Unsaved". A new week
        // (no baseline) is dirty for editors until first save.
        _stateKey() { return JSON.stringify({ t: this.selectedTemplateId, v: this.values }); },
        markBaseline() { this._baseline = this._stateKey(); },
        get hasChanges() {
            if (!this.snapshot || !this.canEdit) return false;
            return this._baseline == null ? true : this._baseline !== this._stateKey();
        },
        get hasNoTemplate() { return !this.legacy && (!this.snapshot || !this.snapshot.pages.length); },

        async init() {
            const self = this;
            auth.onAuthStateChanged(async (user) => {
                if (!user) { window.location.href = 'login.html'; return; }
                const userData = await getUserData(user.uid);
                if (!userData) { window.location.href = 'service-calendar.html'; return; }
                self.userRole = userData.role || 'viewer';

                const params = new URLSearchParams(window.location.search);
                self.date = params.get('date');
                if (!self.date) { window.location.href = 'service-calendar.html'; return; }
                self.legacyGuideUrl = 'service-guide.html?date=' + encodeURIComponent(self.date);

                try {
                    await self.bootstrap();
                } catch (e) {
                    console.error('Failed to load the guide editor:', e);
                    alert('Could not load the service guide. Check the console for details.');
                }
                self.loading = false;
            });
        },

        async bootstrap() {
            // Resolve the Service into render context (names, ESV verse, hymn
            // images, schedule) and load the authoring catalog (seeding it on a
            // fresh church).
            const [{ context, service }] = await Promise.all([
                GuideStore.resolveServiceContext(db, this.date, { esvFetch: (ref) => this.getESVPlainText(ref) }),
                this.loadCatalog(),
            ]);
            this.context = context;
            this.service = service;

            const guide = service.guide || null;
            if (GuideStore.isLegacyGuide(guide)) {
                this.legacy = true;
                return;
            }

            let savedWeek = false;
            if (GuideStore.isV2Guide(guide)) {
                this.snapshot = guide.snapshot;
                this.values = guide.values || {};
                this.selectedTemplateId = guide.guideTemplateId || this.defaultTemplateId();
                savedWeek = true;
            } else {
                // First open of this week: snapshot from the church default.
                this.selectedTemplateId = this.defaultTemplateId();
                this.snapshot = this.buildSnapshotFor(this.selectedTemplateId);
            }

            this.primeRequiredLists();
            this.applyPreviewStyles();
            this.resolve();
            // A saved week starts clean; a new week is dirty until first save.
            if (savedWeek) this.markBaseline();
            await this.fetchPreviousAnnouncements();

            if (this.canEdit) {
                // Re-render on edits (debounced — resolveGuide re-expands the
                // whole booklet); hasChanges is a diff getter, not set here.
                this.$watch('values', () => { if (!this.loading) this.scheduleResolve(); }, { deep: true });
            }
        },

        scheduleResolve() {
            clearTimeout(this._resolveTimer);
            this._resolveTimer = setTimeout(() => this.resolve(), 150);
        },

        // Give required list Entry Fields one starter row at load (e.g. the blank
        // announcement the old editor showed), folded into the baseline so it is
        // not counted as an unsaved change.
        primeRequiredLists() {
            if (!this.snapshot) return;
            for (const page of this.snapshot.pages) {
                for (const f of (page.entryFields || [])) {
                    if (f.type === 'list' && f.required && !Array.isArray(this.values[f.key])) {
                        this.values[f.key] = [f.renderAs === 'announcements' ? { title: '', content: '' } : ''];
                    }
                }
            }
        },

        async loadCatalog() {
            let data = await GuideStore.loadCatalog(db);
            if (!data.guideTemplates.length && this.canEdit) {
                await GuideStore.seedAll(db, this.catalog);
                data = await GuideStore.loadCatalog(db);
            }
            this.catalogData = data;
            this.stylePresetsById = GuideStore.indexById(data.stylePresets);
            this.pageTemplatesById = GuideStore.indexById(data.pageTemplates);
            return data;
        },

        // ── templates ──────────────────────────────────────────────────────────
        get templates() { return this.catalogData.guideTemplates; },
        defaultTemplateId() {
            const d = this.templates.find(t => t.isDefault) || this.templates[0];
            return d ? d.id : null;
        },
        buildSnapshotFor(templateId) {
            const gt = this.templates.find(t => t.id === templateId);
            if (!gt) return { targetPageCount: 16, pages: [] };
            return GuideStore.buildSnapshot(gt, this.pageTemplatesById, this.stylePresetsById);
        },
        changeTemplate(id, selectEl) {
            if (!id || id === this.selectedTemplateId) return;
            if (!confirm('Switch this week to a different Service Guide Template? Filled-in fields that exist in the new template are kept; the rest are cleared.')) {
                // revert the <select> back to the still-current template
                if (selectEl) selectEl.value = this.selectedTemplateId;
                return;
            }
            const newSnap = this.buildSnapshotFor(id);
            this.values = GuideStore.preserveValues(this.values, newSnap);
            this.snapshot = newSnap;
            this.selectedTemplateId = id;
            this.selectedPageIndex = null;
            this.primeRequiredLists();
            this.applyPreviewStyles();
            this.resolve();
        },

        // Rebuild a legacy week on the template system (discards the old elements
        // blob; the legacy print remains available until then).
        rebuildOnTemplateSystem() {
            if (!confirm('Rebuild this week on the new template system? The old guide stays printable from the classic editor, but editing moves here.')) return;
            this.legacy = false;
            this.selectedTemplateId = this.defaultTemplateId();
            this.snapshot = this.buildSnapshotFor(this.selectedTemplateId);
            this.values = {};
            this.primeRequiredLists();
            this.applyPreviewStyles();
            this.resolve();
        },

        // ── rendering ────────────────────────────────────────────────────────────
        resolve() {
            if (!this.snapshot) return;
            this.resolved = GuideEngine.resolveGuide(this.snapshot, this.values, this.context, this.catalog);
        },

        // Inject the snapshot's Style Preset + page CSS so the preview matches what
        // will print. The booklet base CSS is also in the page <style> as a
        // fallback, but custom templates may add their own.
        applyPreviewStyles() {
            if (!this.snapshot) return;
            const seen = new Set();
            let css = '';
            for (const p of this.snapshot.pages) {
                for (const chunk of [p.resolvedStylePresetCss, p.css]) {
                    if (chunk && !seen.has(chunk)) { seen.add(chunk); css += chunk + '\n'; }
                }
            }
            const el = document.getElementById('guide-dynamic-style');
            if (el) el.textContent = css;
        },

        pageNum(index) { return GuideEngine.pageNumber(index, this.resolved.pages.length); },

        // ── Entry Field inputs ─────────────────────────────────────────────────
        selectPageByPhysical(physicalPage) {
            if (physicalPage && physicalPage.snapshotIndex != null) this.selectPage(physicalPage.snapshotIndex);
        },
        selectPage(snapshotIndex) {
            this.selectedPageIndex = snapshotIndex;
            const page = this.snapshot.pages[snapshotIndex];
            if (!page) return;
            // scroll the first physical page from this snapshot page into view
            const idx = this.resolved.pages.findIndex(p => p.snapshotIndex === snapshotIndex);
            if (idx >= 0) {
                const node = document.getElementById('vp-page-' + idx);
                if (node) node.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        },
        get selectedPage() {
            return (this.selectedPageIndex != null && this.snapshot) ? this.snapshot.pages[this.selectedPageIndex] : null;
        },
        get selectedFields() {
            const p = this.selectedPage;
            return (p && p.entryFields) || [];
        },
        pageLabel(snapshotIndex) {
            const p = this.snapshot && this.snapshot.pages[snapshotIndex];
            if (!p) return 'Page';
            const pt = this.pageTemplatesById[p.pageTemplateId];
            return (pt && pt.name) || p.pageTemplateId || 'Page';
        },

        ensureList(key) {
            if (!Array.isArray(this.values[key])) this.values[key] = [];
            return this.values[key];
        },
        addListItem(field) {
            const arr = this.ensureList(field.key);
            arr.push(field.renderAs === 'announcements' ? { title: '', content: '' } : '');
        },
        removeListItem(field, i) { this.ensureList(field.key).splice(i, 1); },

        setValue(key, val) { this.values[key] = val; },

        handleImage(field, event) {
            const file = event.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (e) => { this.values[field.key] = e.target.result; };
            reader.readAsDataURL(file);
        },

        async handleDocx(field, event) {
            const file = event.target.files[0];
            if (!file) return;
            try {
                const arrayBuffer = await file.arrayBuffer();
                const result = await mammoth.convertToHtml({ arrayBuffer }, {
                    styleMap: ['p => p:fresh', 'h1 => h1:fresh', 'h2 => h2:fresh', 'h3 => h3:fresh', 'bold => b', 'italic => i'],
                });
                this.values[field.key] = result.value;
            } catch (e) {
                console.error('docx import failed:', e);
                alert('Failed to import Word document. Ensure it is a valid .docx file.');
            } finally {
                event.target.value = '';
            }
        },

        autoResize(el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; },

        // ── tasks ────────────────────────────────────────────────────────────────
        get tasksRemaining() { return this.snapshot ? GuideStore.tasksRemaining(this.snapshot, this.values) : 0; },
        goToNextTask() {
            const i = GuideStore.nextTaskPageIndex(this.snapshot, this.values);
            if (i >= 0) this.selectPage(i);
        },

        // ── previous-week announcement suggestions (port) ──────────────────────
        async fetchPreviousAnnouncements() {
            try {
                const start = DateUtils.addDays(this.date, -120);
                const snap = await db.collection('services')
                    .where(firebase.firestore.FieldPath.documentId(), '>=', start)
                    .where(firebase.firestore.FieldPath.documentId(), '<', this.date)
                    .get();
                const docs = snap.docs.sort((a, b) => b.id.localeCompare(a.id));
                for (const doc of docs) {
                    const items = this.extractAnnouncements(doc.data());
                    if (items.length) {
                        this.previousAnnouncements = JSON.parse(JSON.stringify(items));
                        this.previousAnnouncementsDate = doc.id;
                        return;
                    }
                }
            } catch (e) { console.error('Error fetching previous announcements:', e); }
        },
        // Read announcements from either a v2 guide (values.announcements) or a
        // legacy guide (elements[announcements].items).
        extractAnnouncements(raw) {
            const data = GuideStore.normalizeServiceData(raw);
            const guide = data.guide;
            let items = [];
            if (guide && guide.format === 'v2' && guide.values) items = guide.values.announcements || [];
            else if (guide && Array.isArray(guide.elements)) {
                const ann = guide.elements.find(el => el.type === 'announcements');
                items = (ann && ann.items) || [];
            }
            return items.filter(it => it && (it.title || it.content));
        },
        addSuggestedAnnouncement(field, item) {
            const arr = this.ensureList(field.key);
            if (arr.some(it => it.title === item.title && it.content === item.content)) return;
            if (arr.length === 1 && !arr[0].title && !arr[0].content) {
                arr[0].title = item.title || ''; arr[0].content = item.content || '';
            } else {
                arr.push({ title: item.title || '', content: item.content || '' });
            }
        },

        // ── persistence ──────────────────────────────────────────────────────────
        async save() {
            if (!this.canEdit || !this.snapshot) return;
            this.saving = true;
            try {
                const template = this.templates.find(t => t.id === this.selectedTemplateId) || { id: this.selectedTemplateId };
                const record = GuideStore.buildGuideRecord(template, this.snapshot, JSON.parse(JSON.stringify(this.values)));
                await GuideStore.saveWeekGuide(db, this.date, record);
                this.markBaseline();
            } catch (e) {
                console.error('Error saving guide:', e);
                alert('Error saving. Check the console for details.');
            } finally {
                this.saving = false;
            }
        },

        // ── ESV ────────────────────────────────────────────────────────────────
        async getESVPlainText(reference) {
            const url = `https://api.esv.org/v3/passage/text/?q=${encodeURIComponent(reference)}&include-passage-references=false&include-verse-numbers=false&include-first-verse-numbers=false&include-footnotes=false&include-headings=false&include-short-copyright=false`;
            try {
                const res = await fetch(url, { headers: { 'Authorization': `Token ${ESV_API_KEY}` } });
                const data = await res.json();
                return (data.passages && data.passages[0] || '').trim();
            } catch (e) { return ''; }
        },

        formatDate(dateStr) { return DateUtils.formatDateLong(dateStr); },

        // ── print ────────────────────────────────────────────────────────────────
        // Clone the live-preview pages into saddle-stitch imposition order, so the
        // PDF matches the screen (same approach as the old printGuide).
        printGuide() {
            const layer = document.getElementById('booklet-print-layer');
            if (!layer) return;
            const spreads = GuideEngine.imposeSpreads(this.resolved.pages);
            const clonePage = (idx) => {
                if (idx != null && idx >= 0) {
                    const src = document.getElementById('vp-page-' + idx);
                    if (src) { const c = src.cloneNode(true); c.removeAttribute('id'); return c; }
                }
                const blank = document.createElement('div');
                blank.className = 'preview-page';
                return blank;
            };
            layer.innerHTML = '';
            for (const spread of spreads) {
                const container = document.createElement('div');
                container.className = 'spread-container';
                container.setAttribute('x-ignore', '');
                container.appendChild(clonePage(spread.left ? spread.leftIdx : null));
                container.appendChild(clonePage(spread.right ? spread.rightIdx : null));
                layer.appendChild(container);
            }
            const cleanup = () => { layer.innerHTML = ''; window.removeEventListener('afterprint', cleanup); };
            window.addEventListener('afterprint', cleanup);
            setTimeout(() => window.print(), 150);
        },
    };
}
