// The view-only page for a Printable (MS-398): the project resolved with
// today's data, laid out page by page, read-only, with a Print button.
//
// The same renderer the editor uses — PrintableLive lays out, PrintableDom
// draws — on a plain page, so what a member sees is exactly what the editor
// saw and exactly what prints. Nothing here writes.
//
// Who may open it is the rule on `printables`: an editor always; a member
// only when it is linked from an event they may see with members-may-view
// on (MS-400). A refused read shows a plain message rather than a blank.

function printableView() {
    const ui = { resolver: null };
    return {
        id: '',
        loading: true,
        problem: '',
        project: null,
        permissionLevel: 'viewer',
        currentUserData: null,
        entries: [],
        warnings: [],
        zoom: 1,
        showWarnings: false,

        get template() { return this.project ? this.project.template : null; },
        get canEdit() { return ['editor', 'elder', 'admin', 'super_admin'].includes(this.permissionLevel); },
        get editorHref() { return 'printable-editor.html?id=' + encodeURIComponent(this.id); },

        async init() {
            this.id = new URLSearchParams(location.search).get('id') || '';
            auth.onAuthStateChanged(async (user) => {
                if (!user) { window.location.href = 'index.html'; return; }
                try {
                    const userData = await getUserData(user.uid);
                    this.currentUserData = userData || null;
                    this.permissionLevel = (userData && (userData.permissionLevel || userData.role)) || 'viewer';
                    if (!this.id) { this.problem = 'No printable was named.'; return; }
                    let record = null;
                    try {
                        record = await PrintableStore.loadPrintable(db, this.id);
                    } catch (e) {
                        this.problem = 'This printable is not shared with you.';
                        return;
                    }
                    if (!record) { this.problem = 'That printable no longer exists.'; return; }
                    this.project = Object.assign({ id: record.id }, PrintableCore.migrate(record));
                    if (!this.template) { this.problem = 'This printable has not been laid out yet.'; return; }
                    await this.resolveAndDraw();
                } catch (e) {
                    console.error(e);
                    this.problem = 'The printable did not load. Check your connection and refresh.';
                } finally {
                    this.loading = false;
                    // The stage is hidden until loading ends, so it has no
                    // width to fit to until the next frame.
                    this.$nextTick(() => this.fit());
                }
            });
            window.addEventListener('resize', () => this.fit());
        },

        async resolveAndDraw() {
            const viewer = { level: this.permissionLevel, personId: (this.currentUserData && this.currentUserData.personId) || null };
            try {
                const needs = PrintableLive.collectNeeds(this.project);
                const bundle = await PrintableDataStore.fetch(db, needs, viewer);
                ui.resolver = PrintableLive.resolver(this.project, bundle, { level: this.permissionLevel, canEdit: this.canEdit });
            } catch (e) {
                console.error(e);
                ui.resolver = null;
            }
            this.$nextTick(() => this.draw());
        },

        draw() {
            const host = document.getElementById('pv-measure');
            const stage = document.getElementById('pv-pages');
            if (!stage) return;
            this.entries = PrintableLive.layoutPages(this.project, ui.resolver, host);
            this.warnings = ui.resolver ? PrintableLive.warningsFor(this.entries, ui.resolver, this.project) : [];
            stage.innerHTML = '';
            const t = this.template;
            this.entries.forEach(entry => {
                const sheet = document.createElement('div');
                sheet.className = 'pv-sheet';
                sheet.style.width = (t.widthPx * this.zoom) + 'px';
                sheet.style.height = (t.heightPx * this.zoom) + 'px';
                const page = PrintableDom.renderPage(Object.assign({}, entry.page, { nodes: entry.nodes }), t, { scopeId: entry.page.id });
                page.style.transform = 'scale(' + this.zoom + ')';
                page.style.transformOrigin = '0 0';
                sheet.appendChild(page);
                stage.appendChild(sheet);
            });
            this.fit();
        },

        // Pages are drawn at the width of the window, whatever their density.
        fit() {
            const stage = document.getElementById('pv-pages');
            const t = this.template;
            if (!stage || !t) return;
            if (!stage.clientWidth) return;
            const available = Math.min(stage.clientWidth - 32, 1100);
            const zoom = Math.max(0.1, Math.min(1, available / t.widthPx));
            if (Math.abs(zoom - this.zoom) < 0.001) return;
            this.zoom = zoom;
            Array.from(stage.children).forEach(sheet => {
                sheet.style.width = (t.widthPx * zoom) + 'px';
                sheet.style.height = (t.heightPx * zoom) + 'px';
                const page = sheet.firstChild;
                if (page) page.style.transform = 'scale(' + zoom + ')';
            });
        },

        printPrintable() {
            const layer = document.getElementById('pv-print');
            if (!layer || !this.template) return;
            layer.innerHTML = '';
            const t = this.template;
            const scale = PrintableCore.printScale(t);
            const style = document.createElement('style');
            style.textContent = '@page { size: ' + t.widthIn + 'in ' + t.heightIn + 'in; margin: 0; }'
                + ' .pv-print-sheet { width: ' + t.widthIn + 'in; height: ' + t.heightIn + 'in; overflow: hidden; page-break-after: always; break-after: page; position: relative; }'
                + ' .pv-print-sheet > .pr-page { transform: scale(' + scale + '); transform-origin: 0 0; }';
            layer.appendChild(style);
            this.entries.forEach(entry => {
                const sheet = document.createElement('div');
                sheet.className = 'pv-print-sheet';
                sheet.appendChild(PrintableDom.renderPage(Object.assign({}, entry.page, { nodes: entry.nodes }), t, { scopeId: entry.page.id }));
                layer.appendChild(sheet);
            });
            document.body.classList.add('pv-printing');
            const done = () => { document.body.classList.remove('pv-printing'); layer.innerHTML = ''; window.removeEventListener('afterprint', done); };
            window.addEventListener('afterprint', done);
            setTimeout(() => window.print(), 150);
        },
    };
}
