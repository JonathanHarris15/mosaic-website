// The view page for a Printable (MS-398): the project resolved as of its
// view date (ADR 0078), laid out page by page, with Print. No asOf in the
// address means today.
//
// The same renderer the editor uses. Below editor the page is static. An
// editor types in the blanks where they already sit on the page. Print never
// draws those boxes.

function printableView() {
    const ui = { resolver: null, bundle: null };
    return {
        id: '',
        viewDate: '',
        occurrenceId: '',
        loading: true,
        problem: '',
        project: null,
        permissionLevel: 'viewer',
        currentUserData: null,
        entries: [],
        warnings: [],
        zoom: 1,
        zoomPinned: false,
        showWarnings: false,
        fillTotal: 0,
        fillLeft: 0,
        fillNote: '',
        focusId: '',
        focusIndex: 0,
        justDone: false,
        eventBag: {},
        sundayDrafts: {},
        kidsLines: {},
        fillSlots: [],
        fillById: {},
        fillCommitted: {},
        extraSlots: [],
        pendingFocus: null,
        folioPadOpen: false,
        folioPadEntries: [],
        folioPadBrushIndex: null,
        folioPadError: '',
        folioPadBaseCount: 0,

        get template() { return this.project ? this.project.template : null; },
        get canEdit() { return AccessCore.writesAsEditor(this.permissionLevel); },
        get canFill() { return this.canEdit; },
        get fillLeftText() {
            const Fill = window.PrintableFillCore;
            return Fill ? Fill.leftToGoText(this.fillLeft) : '';
        },
        get zoomLabel() { return Math.round(this.zoom * 100) + '%'; },
        get editorHref() {
            let href = 'printable-editor.html?id=' + encodeURIComponent(this.id);
            if (this.viewDate) href += '&asOf=' + encodeURIComponent(this.viewDate);
            if (this.occurrenceId) href += '&occurrence=' + encodeURIComponent(this.occurrenceId);
            return href;
        },
        get wantsBookletExport() {
            const Ex = typeof PrintableExportCore !== 'undefined' ? PrintableExportCore : null;
            return !!(Ex && Ex.isSundayBookletPath(this.project));
        },
        get printPageCount() {
            const Ex = typeof PrintableExportCore !== 'undefined' ? PrintableExportCore : null;
            return Ex ? Ex.exportPageCount(this.entries.length, this.project) : this.entries.length;
        },
        get bookletPadCount() {
            const Ex = typeof PrintableExportCore !== 'undefined' ? PrintableExportCore : null;
            return Ex ? Ex.exportPadCount(this.entries.length, this.project) : 0;
        },
        get folioSheetCount() {
            const Ex = typeof PrintableExportCore !== 'undefined' ? PrintableExportCore : null;
            return Ex ? Ex.folioSpreads(this.entries).length : 0;
        },
        get folioTitle() {
            const n = this.folioSheetCount;
            const sheets = n + ' landscape sheet' + (n === 1 ? '' : 's');
            return 'Print folio: two pages on each landscape sheet (' + sheets + '). Fold the stack; leave the copier booklet mode off.';
        },
        get folioPadNeedCount() {
            const Ex = typeof PrintableExportCore !== 'undefined' ? PrintableExportCore : null;
            return Ex ? Ex.folioPadNeed(this.folioPadEntries) : 0;
        },
        get folioPadTargetCount() {
            return (this.folioPadEntries || []).length + this.folioPadNeedCount;
        },
        get folioPadReady() {
            const Ex = typeof PrintableExportCore !== 'undefined' ? PrintableExportCore : null;
            return !!(Ex && Ex.folioReadyToPrint(this.folioPadEntries));
        },
        get folioPadBrushLabel() {
            const Ex = typeof PrintableExportCore !== 'undefined' ? PrintableExportCore : null;
            const i = this.folioPadBrushIndex;
            if (i == null || i < 0 || i >= (this.folioPadEntries || []).length) return '';
            return Ex ? Ex.entryLabel(this.folioPadEntries[i], i) : ('Page ' + (i + 1));
        },

        async init() {
            const params = new URLSearchParams(location.search);
            this.id = params.get('id') || '';
            const asOf = params.get('asOf') || '';
            const occurrence = params.get('occurrence') || '';
            const Data = window.PrintableDataCore;
            this.viewDate = (Data && Data.isDateStr(asOf)) ? asOf : (Data ? Data.toDateStr(new Date()) : '');
            this.occurrenceId = /^[A-Za-z0-9_-]{1,160}$/.test(occurrence) ? occurrence : '';
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
                    this.$nextTick(() => this.fit());
                }
            });
            window.addEventListener('resize', () => this.fit());
            this.bindChrome();
        },

        bindChrome() {
            if (this._chrome) return;
            this._chrome = true;
            const view = this;
            window.addEventListener('keydown', (e) => {
                if (!view.template) return;
                const mod = e.ctrlKey || e.metaKey;
                if (!mod) return;
                if (e.key === '=' || e.key === '+') { e.preventDefault(); view.zoomIn(); }
                else if (e.key === '-' || e.key === '_') { e.preventDefault(); view.zoomOut(); }
                else if (e.key === '0') { e.preventDefault(); view.zoomFit(); }
            });
            window.addEventListener('wheel', (e) => {
                if (!(e.ctrlKey || e.metaKey) || !view.template) return;
                e.preventDefault();
                view.setZoom(view.zoom * Math.exp(-e.deltaY * 0.0015));
            }, { passive: false });
            // Remember which blank the person is in, including one they
            // clicked themselves. The arrow click moves focus onto the
            // arrow before it runs, so the remembered blank is what it steps from.
            document.addEventListener('focusin', (e) => {
                const t = e.target;
                if (!t || !t.closest) return;
                const host = t.closest('[data-fill-id]');
                if (!host) return;
                const id = host.getAttribute('data-fill-id');
                const blanks = view.remainingBlanks();
                const at = blanks.findIndex(s => s.id === id);
                if (at < 0) return;
                view.focusId = id;
                view.focusIndex = at;
                view.markBlank(id);
            });
        },

        async resolveAndDraw() {
            const viewer = { level: this.permissionLevel, personId: (this.currentUserData && this.currentUserData.personId) || null };
            try {
                const today = this.viewDate || undefined;
                const occurrenceId = this.occurrenceId || '';
                const needs = PrintableLive.collectNeeds(this.project, today, { occurrenceId: occurrenceId });
                const bundle = await PrintableDataStore.fetch(db, needs, viewer);
                ui.bundle = bundle;
                this.captureFills(bundle);
                this.rebuildResolver();
            } catch (e) {
                console.error(e);
                ui.resolver = null;
                ui.bundle = null;
            }
            this.$nextTick(() => this.draw());
        },

        captureFills(bundle) {
            this.eventBag = JSON.parse(JSON.stringify((bundle && bundle.eventInputs) || {}));
            this.sundayDrafts = {};
            this.kidsLines = {};
            this.fillCommitted = {};
        },

        sundayDate(when) {
            const Data = window.PrintableDataCore;
            if (!Data) return this.viewDate;
            return Data.resolveWhen(when || { mode: 'this' }, this.viewDate);
        },

        sundayDraft(date) {
            if (!this.sundayDrafts[date]) {
                const Typed = window.SundayTypedCore;
                const service = ui.bundle && ui.bundle.services && ui.bundle.services[date];
                this.sundayDrafts[date] = Typed
                    ? Typed.toDraft(Typed.fromService(service))
                    : {};
            }
            return this.sundayDrafts[date];
        },

        kidsLinesFor(date) {
            if (!this.kidsLines[date]) {
                const Fill = window.PrintableFillCore;
                this.kidsLines[date] = Fill.linesOf(this.sundayDraft(date).kidsQuestions);
            }
            return this.kidsLines[date];
        },

        inputById(id) {
            const Link = window.PrintableLinkCore;
            return Link ? Link.inputById(this.project, id) : null;
        },

        rebuildResolver() {
            const today = this.viewDate || undefined;
            ui.resolver = PrintableLive.resolver(this.project, ui.bundle, {
                level: this.permissionLevel,
                canEdit: this.canEdit,
                today: today,
            });
            if (!this.canFill || !ui.resolver) return;
            const baseRows = ui.resolver.rowsFor.bind(ui.resolver);
            const view = this;
            ui.resolver.rowsFor = function (node, parent) {
                if (node.repeat && node.repeat.source === 'sunday_kids_questions') {
                    const Fill = window.PrintableFillCore;
                    const when = Fill.whenOf(node.repeat.params);
                    const date = view.sundayDate(when);
                    return view.kidsLinesFor(date).map((text, i) => ({
                        _id: date + '~' + i,
                        text: text,
                        number: i + 1,
                    }));
                }
                return baseRows(node, parent);
            };
        },

        valueForSlot(slot) {
            const Fill = window.PrintableFillCore;
            if (!slot || !Fill) return '';
            if (slot.store === 'empty-list') return '';
            if (slot.store === 'event' || slot.store === 'event-row') return Fill.eventValue(this.eventBag, slot);
            const date = this.sundayDate(slot.when);
            if (slot.store === 'kids') {
                const lines = this.kidsLinesFor(date);
                return lines[slot.rowIndex] == null ? '' : lines[slot.rowIndex];
            }
            return Fill.sundayValue(this.sundayDraft(date), slot);
        },

        syncBundle() {
            if (!ui.bundle) ui.bundle = { services: {} };
            ui.bundle.eventInputs = this.eventBag;
            const Typed = window.SundayTypedCore;
            if (!Typed) return;
            Object.keys(this.sundayDrafts).forEach(date => {
                const draft = Object.assign({}, this.sundayDrafts[date]);
                if (this.kidsLines[date]) draft.kidsQuestions = this.kidsLines[date].join('\n');
                const content = Typed.normalise(Typed.fromDraft(draft));
                ui.bundle.services = ui.bundle.services || {};
                ui.bundle.services[date] = Object.assign({}, ui.bundle.services[date], { typedContent: content });
            });
        },

        relayout() {
            if (!this.project) return;
            this.syncBundle();
            this.rebuildResolver();
            this.draw();
        },

        draw() {
            const host = document.getElementById('pv-measure');
            const stage = document.getElementById('pv-pages');
            if (!stage) return;
            this.entries = PrintableLive.layoutPages(this.project, ui.resolver, host);
            this.warnings = ui.resolver ? PrintableLive.warningsFor(this.entries, ui.resolver, this.project) : [];
            stage.innerHTML = '';
            this.extraSlots = [];
            const t = this.template;
            const Fill = window.PrintableFillCore;
            const fillIndex = (this.canFill && Fill) ? Fill.indexProject(this.project) : null;
            const fillFor = fillIndex ? (node => {
                const slot = Fill.slotFor(node, fillIndex);
                if (!slot) return null;
                const value = this.valueForSlot(slot);
                return Object.assign({}, slot, { value: value == null ? '' : String(value) });
            }) : null;
            this.entries.forEach(entry => {
                const sheet = document.createElement('div');
                sheet.className = 'pv-sheet';
                sheet.style.width = (t.widthPx * this.zoom) + 'px';
                sheet.style.height = (t.heightPx * this.zoom) + 'px';
                const page = PrintableDom.renderPage(Object.assign({}, entry.page, { nodes: entry.nodes }), t, {
                    scopeId: entry.page.id,
                    fillFor: fillFor,
                    pageIndex: entry.pageIndex,
                });
                page.style.transform = 'scale(' + this.zoom + ')';
                page.style.transformOrigin = '0 0';
                sheet.appendChild(page);
                stage.appendChild(sheet);
                if (fillFor) this.mountListAdds(page);
            });
            this.recount();
            if (fillFor) this.wireFills(stage);
            this.focusPendingRow();
            this.fit();
        },

        focusPendingRow() {
            const pending = this.pendingFocus;
            this.pendingFocus = null;
            if (!pending) return;
            const nodes = document.querySelectorAll('[data-fill-id]');
            let el = null;
            nodes.forEach(node => {
                if (el || node.tagName === 'BUTTON') return;
                const id = node.getAttribute('data-fill-id') || '';
                if (pending.id && id === pending.id) el = node;
                else if (pending.prefix && id.indexOf(pending.prefix) === 0) el = node;
            });
            if (!el || typeof el.focus !== 'function') return;
            try { el.focus({ preventScroll: true }); }
            catch (e) { el.focus(); }
        },

        recount() {
            const Fill = window.PrintableFillCore;
            if (!this.canFill || !Fill || !this.project) {
                this.fillSlots = [];
                this.fillById = {};
                this.fillTotal = 0;
                this.fillLeft = 0;
                return;
            }
            this.fillSlots = Fill.slotsOn(this.project, this.entries.map(e => e.nodes)).concat(this.extraSlots || []);
            this.fillById = {};
            this.fillSlots.forEach(slot => { this.fillById[slot.id] = slot; });
            const tally = Fill.tally(this.fillSlots, slot => this.valueForSlot(slot));
            const before = this.fillLeft;
            this.fillTotal = tally.total;
            this.fillLeft = tally.left;
            if (before > 0 && this.fillLeft === 0) {
                this.justDone = true;
                if (this._doneTimer) clearTimeout(this._doneTimer);
                this._doneTimer = setTimeout(() => { this.justDone = false; }, 900);
            } else if (this.fillLeft > 0) {
                this.justDone = false;
            }
        },

        remainingBlanks() {
            const Fill = window.PrintableFillCore;
            if (!Fill) return [];
            return Fill.remaining(this.fillSlots, slot => this.valueForSlot(slot));
        },

        liveBlankId(ids) {
            const active = document.activeElement;
            const host = active && active.closest ? active.closest('[data-fill-id]') : null;
            const activeId = host ? host.getAttribute('data-fill-id') : '';
            if (activeId && ids.indexOf(activeId) >= 0) return { id: activeId, fallback: 0 };
            if (this.focusId && ids.indexOf(this.focusId) >= 0) return { id: this.focusId, fallback: 0 };
            if (this.focusId) return { id: this.focusId, fallback: this.focusIndex };
            return { id: '', fallback: 0 };
        },

        goBlank(delta) {
            const Fill = window.PrintableFillCore;
            const blanks = this.remainingBlanks();
            if (!Fill || !blanks.length) return;
            const ids = blanks.map(s => s.id);
            const live = this.liveBlankId(ids);
            const id = Fill.stepBlank(ids, live.id, delta, live.fallback);
            const slot = blanks.find(s => s.id === id);
            if (slot) this.revealBlank(slot);
        },

        markBlank(slotId) {
            document.querySelectorAll('.pv-fill--current').forEach(node => node.classList.remove('pv-fill--current'));
            const el = document.querySelector(this.fillSelector(slotId));
            if (!el) return null;
            const mark = el.closest('.pv-fill-img') || el;
            mark.classList.add('pv-fill--current');
            return { el: el, mark: mark };
        },

        revealBlank(slot) {
            const blanks = this.remainingBlanks();
            const at = blanks.findIndex(s => s.id === slot.id);
            this.focusId = slot.id;
            this.focusIndex = at < 0 ? 0 : at;
            const found = this.markBlank(slot.id);
            if (!found) return;
            const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            found.mark.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center', inline: 'nearest' });
            if (typeof found.el.focus === 'function') {
                try { found.el.focus({ preventScroll: true }); }
                catch (e) { found.el.focus(); }
            }
        },

        mountListAdds(page) {
            const Fill = window.PrintableFillCore;
            page.querySelectorAll('[data-list-of]').forEach(el => {
                const spec = Fill.listSpec(this.project, el.getAttribute('data-list-of'));
                if (!spec) return;
                Array.from(el.children).forEach(copy => {
                    const raw = copy.getAttribute('data-copy');
                    const rowIndex = raw != null && /^\d+$/.test(raw) ? Number(raw) : 0;
                    this.mountRowFill(copy, spec, rowIndex);
                });
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'pv-fill-add';
                btn.textContent = spec.label;
                const empty = Fill.emptyListSlot(this.project, el.getAttribute('data-list-of'));
                if (empty) btn.setAttribute('data-fill-id', empty.id);
                btn.addEventListener('click', () => this.addFillRow(spec));
                el.appendChild(btn);
            });
        },

        // A new row has to be somewhere a person can type, and somewhere they
        // can take back. Columns already placed on the row stay where the
        // page put them. A column that was never placed still gets a blank,
        // so the row is not just empty space.
        mountRowFill(copy, spec, rowIndex) {
            const Fill = window.PrintableFillCore;
            const Dom = window.PrintableDom;
            if (!Fill || !Dom || !copy || !spec) return;
            const present = [];
            const prefix = spec.list === 'event'
                ? ('row:' + spec.inputId + ':' + rowIndex + ':')
                : '';
            copy.querySelectorAll('[data-fill-id]').forEach(el => {
                const id = el.getAttribute('data-fill-id') || '';
                if (prefix && id.indexOf(prefix) === 0) present.push(id.slice(prefix.length));
            });
            const extra = document.createElement('div');
            extra.className = 'pv-fill-extra';
            if (spec.list === 'event') {
                const input = this.inputById(spec.inputId);
                Fill.unplacedColumns(input, present).forEach(col => {
                    const slot = {
                        id: 'row:' + input.id + ':' + rowIndex + ':' + col.id,
                        store: 'event-row',
                        inputId: input.id,
                        columnId: col.id,
                        rowIndex: rowIndex,
                        kind: col.kind === 'image' ? 'image' : col.kind,
                        label: (input.label || 'List') + ', ' + (col.label || 'Column'),
                        multiline: false,
                    };
                    const value = Fill.eventValue(this.eventBag, slot);
                    this.extraSlots.push(slot);
                    const node = { tag: 'div', style: { width: '100%', 'min-height': '4.5em' }, attrs: {} };
                    extra.appendChild(slot.kind === 'image'
                        ? Dom.renderFillImage(node, Object.assign({}, slot, { value: value }))
                        : Dom.renderFillControl(Object.assign({}, slot, { value: value })));
                });
            } else if (spec.list === 'kids') {
                const whenKey = Fill.whenKey(spec.when);
                const id = 'kids:' + whenKey + ':' + rowIndex;
                const has = copy.querySelector('[data-fill-id="' + id.replace(/"/g, '\\"') + '"]');
                if (!has) {
                    const slot = {
                        id: id,
                        store: 'kids',
                        rowIndex: rowIndex,
                        when: spec.when,
                        kind: 'text',
                        label: 'Question ' + (rowIndex + 1),
                        multiline: false,
                    };
                    this.extraSlots.push(slot);
                    extra.appendChild(Dom.renderFillControl(Object.assign({}, slot, {
                        value: this.valueForSlot(slot),
                    })));
                }
            }
            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'pv-fill-remove';
            remove.textContent = 'Remove row';
            remove.setAttribute('aria-label', 'Remove row ' + (rowIndex + 1));
            remove.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.removeFillRow(spec, rowIndex);
            });
            extra.appendChild(remove);
            if (copy.style && copy.style.overflow === 'hidden') copy.style.overflow = 'visible';
            copy.appendChild(extra);
        },

        wireFills(stage) {
            stage.querySelectorAll('[data-fill-id]').forEach(el => {
                if (el.tagName === 'BUTTON') return;
                const id = el.getAttribute('data-fill-id');
                if (this.fillCommitted[id] == null) this.fillCommitted[id] = el.value || '';
                if (el.type === 'file') {
                    el.addEventListener('change', () => {
                        const file = el.files && el.files[0];
                        if (el.value) el.value = '';
                        if (file) this.onFillFile(id, file, el);
                    });
                    return;
                }
                el.addEventListener('input', () => this.onFillInput(id, el.value, el));
                el.addEventListener('change', () => this.onFillCommit(id));
                el.addEventListener('blur', () => this.onFillCommit(id));
            });
        },

        fillSelector(id) {
            const esc = (window.CSS && CSS.escape) ? CSS.escape(id) : String(id).replace(/"/g, '\\"');
            return '[data-fill-id="' + esc + '"]';
        },

        onFillInput(id, value, source) {
            const Fill = window.PrintableFillCore;
            const slot = this.fillById[id];
            if (!Fill || !slot) return;
            if (slot.store === 'event') {
                this.eventBag = Fill.setEventScalar(this.eventBag, slot.inputId, value);
            } else if (slot.store === 'event-row') {
                const input = this.inputById(slot.inputId);
                if (!input) return;
                this.eventBag = Fill.setEventCell(this.eventBag, input, slot.rowIndex, slot.columnId, value);
            } else if (slot.store === 'sunday') {
                const date = this.sundayDate(slot.when);
                this.sundayDrafts[date] = Fill.setSundayField(this.sundayDraft(date), slot.field, value);
            } else if (slot.store === 'kids') {
                const date = this.sundayDate(slot.when);
                this.kidsLines[date] = Fill.writeKidsLine(this.kidsLinesFor(date), slot.rowIndex, value);
                const draft = this.sundayDraft(date);
                draft.kidsQuestions = this.kidsLines[date].join('\n');
            }
            document.querySelectorAll(this.fillSelector(id)).forEach(el => {
                if (el !== source && el.type !== 'file' && el.value !== value) el.value = value;
            });
            this.recount();
        },

        onFillCommit(id) {
            const slot = this.fillById[id];
            if (!slot) return;
            const value = String(this.valueForSlot(slot) == null ? '' : this.valueForSlot(slot));
            if (this.fillCommitted[id] === value) return;
            this.fillCommitted[id] = value;
            this.persistSlot(slot);
        },

        async onFillFile(id, file, input) {
            const slot = this.fillById[id];
            if (!slot || !file) return;
            const url = await this.uploadFillImage(slot, file);
            if (!url) return;
            this.onFillInput(id, url, input);
            this.fillCommitted[id] = null;
            this.onFillCommit(id);
            const lab = input.closest('.pv-fill-img');
            const img = lab && lab.querySelector('img');
            const cap = lab && lab.querySelector('.pv-fill-img__btn');
            if (img) img.src = url;
            if (cap) cap.textContent = 'Replace image';
        },

        async uploadFillImage(slot, file) {
            const Store = window.PrintableLinkStore;
            const Typed = window.SundayTypedCore;
            let path = '';
            if (slot.store === 'sunday' && slot.field === 'prayerCountryImage' && Typed) {
                const err = Typed.fileUploadError(file);
                if (err) { this.fillNote = err; return ''; }
                const safe = String(file.name || 'map').replace(/[^\w.-]+/g, '_');
                const fileId = (window.PrintableCore && PrintableCore.newId)
                    ? PrintableCore.newId('map') + '_' + safe
                    : String(Date.now()) + '_' + safe;
                path = Typed.countryMapStoragePath(this.sundayDate(slot.when), fileId);
            } else if (Store) {
                const safe = String(file.name || 'image').replace(/[^\w.-]+/g, '_');
                const fileId = (window.PrintableCore && PrintableCore.newId)
                    ? PrintableCore.newId('img') : String(Date.now());
                path = 'printable_assets/' + this.id + '/' + fileId + '_' + safe;
            }
            if (!Store) { this.fillNote = 'Image upload is not available.'; return ''; }
            this.fillNote = 'Uploading…';
            const result = await Store.uploadImage(file, path);
            if (!result || !result.url) {
                this.fillNote = (result && result.error) || 'That image did not upload.';
                return '';
            }
            this.fillNote = '';
            return result.url;
        },

        async persistSlot(slot) {
            if (slot.store === 'event' || slot.store === 'event-row') return this.persistEvent();
            if (slot.store === 'sunday' || slot.store === 'kids') {
                return this.persistSunday(this.sundayDate(slot.when));
            }
        },

        async persistEvent() {
            if (!this.occurrenceId) {
                this.fillNote = 'Open this printable from its date to save.';
                return;
            }
            try {
                const Store = window.EventsStore;
                if (Store && Store.loadOccurrence) {
                    const occ = await Store.loadOccurrence(db, this.occurrenceId);
                    if (occ && occ.stored === false && Store.ensureOccurrenceDocument) {
                        await Store.ensureOccurrenceDocument(db, occ);
                    }
                }
                const ref = db.collection('event_occurrences').doc(this.occurrenceId);
                const snap = await ref.get();
                const prev = (snap && snap.exists && snap.data() && snap.data().printableInputs) || {};
                const next = Object.assign({}, prev);
                next[this.id] = JSON.parse(JSON.stringify(this.eventBag));
                await ref.set({ printableInputs: next }, { merge: true });
                if (ui.bundle) ui.bundle.eventInputs = this.eventBag;
                this.fillNote = '';
            } catch (e) {
                console.error(e);
                this.fillNote = 'That did not save. Try again.';
            }
        },

        async persistSunday(date) {
            const Typed = window.SundayTypedCore;
            if (!Typed || !date) return;
            const draft = Object.assign({}, this.sundayDraft(date));
            if (this.kidsLines[date]) draft.kidsQuestions = this.kidsLines[date].join('\n');
            try {
                Typed.assertCountryImageWritable(draft.prayerCountryImage);
                const content = Typed.normalise(Typed.fromDraft(draft));
                await db.collection('services').doc(date).set({ typedContent: content }, { merge: true });
                if (!ui.bundle) ui.bundle = { services: {} };
                ui.bundle.services = ui.bundle.services || {};
                ui.bundle.services[date] = Object.assign({}, ui.bundle.services[date], { typedContent: content });
                this.fillNote = '';
            } catch (e) {
                console.error(e);
                this.fillNote = (e && e.code === 'country-map-size' && e.message)
                    ? e.message
                    : 'That did not save. Try again.';
            }
        },

        async addFillRow(spec) {
            const Fill = window.PrintableFillCore;
            if (!Fill || !spec) return;
            if (spec.list === 'event') {
                const input = this.inputById(spec.inputId);
                if (!input) return;
                this.eventBag = Fill.addEventRow(this.eventBag, input);
                const rows = this.eventBag[input.id];
                const rowIndex = Array.isArray(rows) ? rows.length - 1 : 0;
                this.pendingFocus = { prefix: 'row:' + input.id + ':' + rowIndex + ':' };
                if (ui.bundle) ui.bundle.eventInputs = this.eventBag;
                await this.persistEvent();
            } else if (spec.list === 'kids') {
                const date = this.sundayDate(spec.when);
                this.kidsLines[date] = Fill.addKidsLine(this.kidsLinesFor(date));
                const rowIndex = this.kidsLines[date].length - 1;
                this.pendingFocus = { id: 'kids:' + Fill.whenKey(spec.when) + ':' + rowIndex };
                const draft = this.sundayDraft(date);
                draft.kidsQuestions = this.kidsLines[date].join('\n');
                await this.persistSunday(date);
            }
            this.relayout();
        },

        async removeFillRow(spec, rowIndex) {
            const Fill = window.PrintableFillCore;
            if (!Fill || !spec) return;
            if (spec.list === 'event') {
                const input = this.inputById(spec.inputId);
                if (!input) return;
                this.eventBag = Fill.removeEventRow(this.eventBag, input, rowIndex);
                if (ui.bundle) ui.bundle.eventInputs = this.eventBag;
                await this.persistEvent();
            } else if (spec.list === 'kids') {
                const date = this.sundayDate(spec.when);
                this.kidsLines[date] = Fill.removeKidsLine(this.kidsLinesFor(date), rowIndex);
                const draft = this.sundayDraft(date);
                draft.kidsQuestions = this.kidsLines[date].join('\n');
                await this.persistSunday(date);
            }
            this.pendingFocus = null;
            this.relayout();
        },

        applyZoom() {
            const stage = document.getElementById('pv-pages');
            const t = this.template;
            if (!stage || !t) return;
            const zoom = this.zoom;
            Array.from(stage.children).forEach(sheet => {
                sheet.style.width = (t.widthPx * zoom) + 'px';
                sheet.style.height = (t.heightPx * zoom) + 'px';
                const page = sheet.firstChild;
                if (page) page.style.transform = 'scale(' + zoom + ')';
            });
        },

        setZoom(next) {
            const z = Math.max(0.15, Math.min(3, next));
            this.zoomPinned = true;
            if (Math.abs(z - this.zoom) < 0.001) return;
            this.zoom = z;
            this.applyZoom();
        },

        zoomIn() { this.setZoom(this.zoom * 1.2); },
        zoomOut() { this.setZoom(this.zoom / 1.2); },
        zoomFit() { this.zoomPinned = false; this.fit(); },

        fit() {
            const stage = document.getElementById('pv-pages');
            const t = this.template;
            if (!stage || !t) return;
            if (this.zoomPinned) { this.applyZoom(); return; }
            if (!stage.clientWidth) return;
            const available = Math.min(stage.clientWidth - 32, 1100);
            const zoom = Math.max(0.1, Math.min(1, available / t.widthPx));
            if (Math.abs(zoom - this.zoom) < 0.001) return;
            this.zoom = zoom;
            this.applyZoom();
        },

        printEntries() {
            const Ex = typeof PrintableExportCore !== 'undefined' ? PrintableExportCore : null;
            return Ex ? Ex.exportEntries(this.entries, this.project) : this.entries;
        },

        beginPrint(layer) {
            document.body.classList.add('pv-printing');
            const done = () => { document.body.classList.remove('pv-printing'); layer.innerHTML = ''; window.removeEventListener('afterprint', done); };
            window.addEventListener('afterprint', done);
            setTimeout(() => window.print(), 150);
        },

        printPrintable() {
            if (this.canFill) this.relayout();
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
            this.printEntries().forEach((entry, i) => {
                const sheet = document.createElement('div');
                sheet.className = 'pv-print-sheet';
                sheet.appendChild(PrintableDom.renderPage(Object.assign({}, entry.page, { nodes: entry.nodes }), t, {
                    scopeId: entry.page.id,
                    pageIndex: entry.pageIndex == null ? i : entry.pageIndex,
                }));
                layer.appendChild(sheet);
            });
            this.beginPrint(layer);
        },

        printFolio() {
            if (this.canFill) this.relayout();
            if (!this.template || !this.entries.length) return;
            const Ex = typeof PrintableExportCore !== 'undefined' ? PrintableExportCore : null;
            if (!Ex) return;
            // Always open the board so the operator can delete or stamp
            // pages before printing — even when the count is already ×4.
            this.openFolioPad();
        },

        openFolioPad() {
            const Ex = typeof PrintableExportCore !== 'undefined' ? PrintableExportCore : null;
            if (!Ex || !this.entries.length) return;
            this.folioPadEntries = Ex.cloneEntriesForFolio(this.entries);
            this.folioPadBaseCount = this.entries.length;
            this.folioPadError = '';
            let brush = null;
            for (let i = this.folioPadEntries.length - 1; i >= 0; i--) {
                if (this.folioPadEntries[i] && !this.folioPadEntries[i].blank) { brush = i; break; }
            }
            this.folioPadBrushIndex = brush;
            this.folioPadOpen = true;
            this.$nextTick(() => this.paintFolioPadBoard());
        },

        closeFolioPad() {
            this.folioPadOpen = false;
            this.folioPadError = '';
            this.folioPadEntries = [];
            this.folioPadBrushIndex = null;
            const host = document.getElementById('pv-folio-board');
            if (host) host.innerHTML = '';
        },

        paintFolioPadBoard() {
            const host = document.getElementById('pv-folio-board');
            if (!host || !this.template || typeof PrintableDom.mountFolioPadBoard !== 'function') return;
            const view = this;
            PrintableDom.mountFolioPadBoard(host, {
                template: this.template,
                entries: this.folioPadEntries,
                brushIndex: this.folioPadBrushIndex,
                needCount: this.folioPadNeedCount,
                onBrush: (i) => view.setFolioBrush(i),
                onInsert: (after) => view.insertFolioBrushAt(after),
                onRemove: (i) => view.removeFolioPadRow(i),
            });
        },

        setFolioBrush(index) {
            const i = Math.round(Number(index));
            if (!Number.isFinite(i) || i < 0 || i >= (this.folioPadEntries || []).length) return;
            const entry = this.folioPadEntries[i];
            if (!entry || entry.blank) {
                this.folioPadError = 'Pick a real page for the brush.';
                return;
            }
            this.folioPadBrushIndex = i;
            this.folioPadError = '';
            this.paintFolioPadBoard();
        },

        insertFolioBrushAt(afterIndex) {
            const Ex = typeof PrintableExportCore !== 'undefined' ? PrintableExportCore : null;
            if (!Ex) return;
            const brush = this.folioPadBrushIndex;
            if (brush == null || brush < 0) {
                this.folioPadError = 'Pick a page for the brush first.';
                return;
            }
            if (this.folioPadNeedCount <= 0) {
                this.folioPadError = 'The fold is already a multiple of 4.';
                return;
            }
            const result = Ex.applyFolioPad(this.folioPadEntries, {
                kind: 'duplicate',
                sourceIndex: brush,
                afterIndex: afterIndex,
            });
            if (!result.ok) {
                this.folioPadError = result.why || 'Could not place that page.';
                return;
            }
            this.folioPadEntries = result.entries;
            this.folioPadError = '';
            if (afterIndex < brush) this.folioPadBrushIndex = brush + 1;
            this.$nextTick(() => this.paintFolioPadBoard());
        },

        removeFolioPadRow(index) {
            const Ex = typeof PrintableExportCore !== 'undefined' ? PrintableExportCore : null;
            if (!Ex) return;
            const result = Ex.removeFolioPadAt(this.folioPadEntries, index);
            if (!result.ok) {
                this.folioPadError = result.why || 'Could not remove that page.';
                return;
            }
            const brush = this.folioPadBrushIndex;
            this.folioPadEntries = result.entries;
            this.folioPadError = '';
            if (brush == null) {
                /* keep */
            } else if (brush === index) {
                this.folioPadBrushIndex = null;
            } else if (brush > index) {
                this.folioPadBrushIndex = brush - 1;
            }
            this.$nextTick(() => this.paintFolioPadBoard());
        },

        confirmFolioPadPrint() {
            if (!this.folioPadReady) return;
            const stack = this.folioPadEntries.slice();
            this.closeFolioPad();
            this.runFolioPrint(stack);
        },

        runFolioPrint(entries) {
            const layer = document.getElementById('pv-print');
            if (!layer || !this.template || !(entries || []).length) return;
            if (typeof PrintableDom.mountFolioPrint !== 'function') return;
            PrintableDom.mountFolioPrint(layer, this.template, entries);
            this.beginPrint(layer);
        },
    };
}
