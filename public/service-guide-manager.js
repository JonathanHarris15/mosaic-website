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
    return {
        userRole: 'viewer',
        loading: true,
        tab: 'pages',
        catalog: (window.GuideComponents && window.GuideComponents.defaultCatalog) || null,
        palette: { bound: [], input: [] },

        stylePresets: [],
        pageTemplates: [],
        guideTemplates: [],

        // editing buffers
        editingPage: null,         // { id?, name, html, css, stylePresetId, emitsPages, isFiller }
        pageValidation: { ok: true, problems: [] },
        pagePreviewPages: [],
        editingPreset: null,       // { id?, name, css }
        editingTemplate: null,     // { id?, name, targetPageCount, isDefault, pages:[] }

        toast: '',

        get canEdit() { return ['editor', 'elder', 'admin', 'super_admin'].includes(this.userRole); },

        async init() {
            const self = this;
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
        },

        flash(msg) { this.toast = msg; setTimeout(() => { if (this.toast === msg) this.toast = ''; }, 2500); },

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
            this.refreshPagePreview();
        },
        editPage(pt) {
            this.editingPage = JSON.parse(JSON.stringify(pt));
            if (this.editingPage.emitsPages == null) this.editingPage.emitsPages = 'single';
            this.refreshPagePreview();
        },
        closePage() { this.editingPage = null; this.pagePreviewPages = []; },

        // Live validation + preview against sample data.
        refreshPagePreview() {
            const p = this.editingPage;
            if (!p) return;
            this.pageValidation = GuideEngine.validatePageHtml(p.html || '', this.catalog);
            const fields = this.pageValidation.entryFields || [];
            const snapshotPage = {
                pageTemplateId: p.id || 'preview', role: p.isFiller ? 'normal' : 'normal',
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
            const ta = document.getElementById('page-html-editor');
            if (!ta) return;
            let snippet;
            if (kind === 'input') {
                const key = (tag === 'input-list') ? 'my_list' : 'my_field';
                const extra = (tag === 'input-list') ? ' render-as="bullets"' : '';
                snippet = `<${tag} key="${key}" label="My Field"${extra}></${tag}>`;
            } else {
                snippet = `<${tag}></${tag}>`;
            }
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
        newTemplate() {
            this.editingTemplate = { name: 'New Service Guide Template', targetPageCount: 16, isDefault: false, pages: [] };
        },
        editTemplate(gt) {
            const copy = JSON.parse(JSON.stringify(gt));
            copy.pages = (copy.pages || []).map(p => ({ pageTemplateId: p.pageTemplateId, role: p.role || 'normal', params: p.params || {} }));
            this.editingTemplate = copy;
        },
        closeTemplate() { this.editingTemplate = null; },
        addTemplatePage() {
            const first = this.pageTemplates[0];
            this.editingTemplate.pages.push({ pageTemplateId: first ? first.id : '', role: 'normal', params: {} });
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
            // Exactly one Filler Page per template.
            this.editingTemplate.pages.forEach((p, idx) => { p.role = (idx === i && p.role !== 'filler') ? 'filler' : 'normal'; });
        },
        pageEmitsComponent(pageTemplateId) {
            const pt = this.pageTemplate(pageTemplateId);
            return pt && pt.emitsPages === 'component';
        },
        templatePageCountValid() {
            const n = Number(this.editingTemplate.targetPageCount);
            return Number.isInteger(n) && n > 0 && n % 4 === 0;
        },
        async saveTemplate() {
            const t = this.editingTemplate;
            if (!t.name || !t.name.trim()) { alert('Give the template a name.'); return; }
            if (!this.templatePageCountValid()) { alert('Target page count must be a positive multiple of 4.'); return; }
            t.targetPageCount = Number(t.targetPageCount);
            try {
                const id = await GuideStore.saveGuideTemplate(db, t);
                await this.reload();
                if (t.isDefault) await this.makeDefault(id, true);
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
