// One form's page — its questions, its settings, and what came back
// (MS-360, MS-370, MS-372).
//
// Reached from the Forms library by opening a form, never as a pane beside a
// list (ADR-0053).

function formPage() {
    return {
        loading: true,
        notFound: false,
        formId: '',
        form: null,
        responses: [],
        // The Shepherding Tags a person picker may be scoped to. Loaded only
        // when a picker is on the form — see loadTags.
        tags: [],
        tab: 'questions',
        openQuestion: null,
        currentUser: null,
        currentPermissionLevel: 'viewer',

        // ADR-0032: the page saves itself, the Save button stays and means
        // "write it now", and a failed autosave is quiet while a failed press
        // is not.
        saveState: 'saved',       // saved | unsaved | saving | failed
        saveTimer: null,
        SAVE_DEBOUNCE: 1500,
        copied: false,
        problem: '',
        confirmingDelete: false,

        get inShell() { return new URLSearchParams(location.search).get('shell') === 'mobile'; },
        get libraryHref() { return 'forms.html' + (this.inShell ? '?shell=mobile' : ''); },
        get signInHref() { return this.inShell ? 'mobile.html#/login' : 'index.html'; },
        get homeHref() { return this.inShell ? 'mobile.html#/home' : 'index.html'; },

        mayManageForms(level) {
            return ['editor', 'admin', 'elder', 'super_admin'].includes(level);
        },

        get today() {
            return (window.DateUtils && DateUtils.todayStr()) || new Date().toISOString().slice(0, 10);
        },

        // ── What this form is, said in badges ────────────────────────────────
        get isClosed() { return this.form && FormsCore.isClosed(this.form, this.today); },
        get isBallot() { return this.form && FormsCore.isBallot(this.form); },
        get settings() { return FormsCore.settingsFor(this.form ? this.form.rung : 'member'); },

        // Filled in once and kept, rather than published and answered. Nearly
        // every control on this page is about a link — publishing one, closing
        // one, deciding who may follow one — and a document template has none.
        get isDocument() { return FormsCore.isDocumentMode(this.form); },
        get liveRungs() { return FormsCore.RUNGS_LIVE; },

        // Asked of the model, not spelled out here — the picker is not the only
        // place a rung gets named, and two lists of these words would drift.
        rungLabel(rung) { return FormsCore.rungLabel(rung); },

        get badges() {
            if (!this.form) return [];
            const out = [];

            // A document template says what it is and stops. The other badges
            // all describe answering a link it does not have.
            if (this.isDocument) {
                out.push({ text: 'Filled in as a document', tone: 'm-badge--tertiary', icon: 'edit_document' });
                return out;
            }

            out.push(this.form.rung === 'public'
                ? { text: 'Anyone with the link', tone: 'm-badge--tertiary', icon: 'public' }
                : { text: FormsCore.rungLabel(this.form.rung) + ' and above', tone: 'm-badge--secondary', icon: 'groups' });
            out.push(this.form.attribution
                ? { text: 'Names recorded', tone: '' }
                : { text: 'Anonymous', tone: '' });
            if (this.form.oneEach) out.push({ text: 'One response each', tone: '' });
            if (this.isClosed) {
                out.push({ text: 'Closed', tone: 'm-badge--neutral', icon: 'event_busy' });
            } else if (this.form.closingDate) {
                out.push({ text: 'Closes ' + this.pretty(this.form.closingDate), tone: 'm-badge--warning', icon: 'event_busy' });
            }
            if (!this.form.published) out.push({ text: 'Not published', tone: 'm-badge--warning' });
            return out;
        },

        get shareUrl() {
            return location.origin + '/f/' + this.formId;
        },

        get titleCount() {
            const n = (this.form && this.form.title || '').length;
            return `${n} of ${FormsCore.MAX_TITLE_LENGTH} characters`;
        },

        get askedCount() {
            const qs = FormsCore.askedQuestions(this.form || {});
            return qs.length === 1 ? '1 question' : qs.length + ' questions';
        },

        // ⚠ Counted from the ANSWERS. Never from the ledger of who answered —
        // that is closed to every client, and reaching for it would be the join
        // ADR-0052 forbids dressed up as a count.
        get responseCount() { return this.responses.length; },

        // How many Form Documents have been made from this template. Zero until
        // MS-384 builds the record; the mode control below already asks, so that
        // the day documents exist they start protecting the template without
        // anybody remembering to come back here.
        get documentCount() { return this.documentsMade || 0; },

        // May this template still change what kind of form it is?
        //
        // Only while nothing has been made from it. The refusal names the count,
        // because "you cannot change this" is not answerable and "four answers
        // have already come in" is.
        get modeChange() {
            return FormsCore.mayChangeMode(
                this.form,
                { responses: this.responseCount, documents: this.documentCount },
            );
        },

        setMode(mode) {
            if (!this.form || this.form.mode === mode) return;
            if (!this.modeChange.ok) return;
            this.form.mode = mode;
            // Rebuild through the model rather than setting one field: a
            // document template has no rung, no link and no closing date, and
            // the model is what knows that. Setting `mode` alone would leave a
            // record contradicting itself.
            this.form = FormsCore.buildFormTemplate(this.form);
            this.touch();
        },

        // ── Load ─────────────────────────────────────────────────────────────
        async init() {
            this.formId = new URLSearchParams(location.search).get('id') || '';
            if (!this.formId) { this.notFound = true; this.loading = false; return; }

            auth.onAuthStateChanged(async (user) => {
                if (!user) { window.location.href = this.signInHref; return; }
                // ⚠ The read of WHO YOU ARE is inside the try, not before it.
                // Left outside, a throw there escapes the boot and the page
                // spins for ever; auth.js catches the rejection and offers a
                // reload, but saying what went wrong in place is better.
                try {
                    const userData = await getUserData(user.uid);
                    this.currentPermissionLevel = (userData && (userData.permissionLevel || userData.role)) || 'viewer';
                    if (!this.mayManageForms(this.currentPermissionLevel)) {
                        window.location.href = this.homeHref;
                        return;
                    }
                    this.currentUser = user;
                    const form = await FormsStore.loadForm(db, this.formId);
                    if (!form) { this.notFound = true; return; }
                    this.form = FormsCore.buildFormTemplate(form);
                    this.form.createdAt = form.createdAt || null;
                    this.form.createdBy = form.createdBy || null;
                    this.form.createdByName = form.createdByName || null;
                    this.responses = await FormsStore.loadResponses(db, this.formId);
                    this.loadTags();
                } catch (e) {
                    this.problem = 'This form did not load. Check your connection and refresh.';
                } finally {
                    this.loading = false;
                }
            });
        },

        // The tags a Directory Person picker may be scoped to.
        //
        // Read on its own, so a builder that cannot reach them still edits a
        // form. Hidden tags are dropped by FormsCore.offerableTags rather than
        // here, because "which tags may a form name" is a rule about forms and
        // belongs where the rule lives.
        loadTags() {
            const wantsTags = (this.form.questions || []).some(q => q.type === 'person');
            if (!wantsTags) return;
            db.collection('people_tags').orderBy('name', 'asc').get().then(snap => {
                this.tags = snap.docs.map(doc => Object.assign({ id: doc.id }, doc.data()));
            }).catch(() => { this.tags = []; });
        },

        // ── Getting the responses out (MS-374) ───────────────────────────────
        //
        // Built here, from responses this page has ALREADY read to draw the
        // tally. The ticket asked for this server-side, "not assembled in a
        // browser that would need to read more than it should" — and the
        // reasoning behind that does not apply: this reads nothing extra. A
        // Cloud Function would move the same bytes through an extra hop for no
        // gain in what anybody can see. The deviation is recorded on the ticket.
        //
        // ⚠ What goes in the file is FormsExportCore's decision, not this
        // page's. An anonymous form's export carries no name, no timestamp and
        // no response id, and its rows come out in the same stable shuffle the
        // screen uses.
        exportResponses() {
            if (!this.form || !this.responses.length) return;
            const on = this.today;
            const csv = FormsExportCore.toCsv(this.form, this.responses, {
                formId: this.formId,
                exportedOn: on,
            });
            // A blob and an object URL: the file is made in this tab and never
            // fetched from anywhere, so there is nothing to leak and nothing to
            // forward.
            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = FormsExportCore.fileNameFor(this.form, on);
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 30000);
        },

        // Open what somebody sent.
        //
        // ⚠ FETCHED AS THE SIGNED-IN READER, NEVER LINKED. getDownloadURL()
        // would mint a token that bypasses storage.rules and never expires, so
        // one forwarded link would make an editors-only file public for ever
        // (ADR-0046). Downloading through an authenticated request means the
        // rule is checked every single time — the same thing an Event
        // Attachment does.
        async openUpload(entry) {
            if (!entry || !entry.storagePath) return;
            try {
                const ref = firebase.storage().ref(entry.storagePath);
                const blob = await ref.getBlob();
                const url = URL.createObjectURL(blob);
                // A blob: URL lives in this tab only and dies with it. It is not
                // a shareable address and nothing is stored.
                const a = document.createElement('a');
                a.href = url;
                a.download = entry.name || 'file';
                a.click();
                setTimeout(() => URL.revokeObjectURL(url), 30000);
            } catch (e) {
                this.problem = 'That file did not open. It may have been removed.';
            }
        },

        // ── Saving ───────────────────────────────────────────────────────────
        touch() {
            this.saveState = 'unsaved';
            clearTimeout(this.saveTimer);
            this.saveTimer = setTimeout(() => this.save(false), this.SAVE_DEBOUNCE);
        },

        async save(pressed) {
            clearTimeout(this.saveTimer);
            if (!this.form) return;
            this.saveState = 'saving';
            try {
                await FormsStore.saveForm(db, firebase, this.currentUser, this.formId, this.form);
                this.saveState = 'saved';
            } catch (e) {
                // A failed autosave is silent and the next edit retries; a save
                // you PRESSED reports, and never re-arms itself, because
                // retrying a refused write on a timer is a loop with no end.
                this.saveState = pressed ? 'failed' : 'unsaved';
                if (pressed) this.problem = 'That did not save. What is on screen is still here — try again.';
            }
        },

        // ── Questions ────────────────────────────────────────────────────────
        newId() {
            return 'q' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        },

        addQuestion() {
            const q = FormsCore.buildQuestion({ id: this.newId(), type: 'short_text', text: '' });
            this.form.questions.push(q);
            this.openQuestion = q.id;
            this.touch();
        },

        duplicateQuestion(q) {
            const copy = FormsCore.buildQuestion(Object.assign({}, q, { id: this.newId() }));
            const at = this.form.questions.findIndex(x => x.id === q.id);
            this.form.questions.splice(at + 1, 0, copy);
            this.openQuestion = copy.id;
            this.touch();
        },

        // ⚠ A question that has gathered answers is RETIRED, never deleted. The
        // tally it already holds would otherwise lose its label, and a column of
        // numbers with no question above it is not a record of anything.
        answersFor(q) {
            return this.responses.filter(r => (r.answers || {})[q.id] != null).length;
        },

        removeQuestion(q) {
            const n = this.answersFor(q);
            if (n > 0) {
                q.retired = true;
                this.openQuestion = null;
                this.touch();
                return;
            }
            this.form.questions = this.form.questions.filter(x => x.id !== q.id);
            this.openQuestion = null;
            this.touch();
        },

        restoreQuestion(q) { q.retired = false; this.touch(); },

        move(q, by) {
            const at = this.form.questions.findIndex(x => x.id === q.id);
            const to = at + by;
            if (to < 0 || to >= this.form.questions.length) return;
            const list = this.form.questions;
            [list[at], list[to]] = [list[to], list[at]];
            this.touch();
        },

        addOption(q) {
            if (!q.options) q.options = [];
            q.options.push('');
            this.touch();
        },

        removeOption(q, i) { q.options.splice(i, 1); this.touch(); },

        onTypeChange(q) {
            // Switching to a choice type needs somewhere to put the choices.
            if (FormsCore.hasOptions(q.type) && !(q.options || []).length) {
                q.options = ['', ''];
            }
            if (q.type === 'person') {
                if (!q.people) q.people = FormsCore.buildPeopleScope(null);
                // Adding a picker to a form that is already public would make a
                // record the model refuses to store. Said here, at the moment
                // it happens, rather than discovered at save.
                if (this.form.rung === 'public') {
                    this.form.rung = 'member';
                    this.problem = 'Moved to Members: a form anyone can open cannot ' +
                        'ask for somebody from the directory.';
                }
            }
            // And switching to a scale needs a scale to switch to. A form
            // LOADED from Firestore comes through buildFormTemplate and always
            // has one; a question retyped here is the case this covers.
            if (q.type === 'scale' && !q.scale) {
                q.scale = FormsCore.buildScale(null);
            }
            this.touch();
        },

        // The ends are clamped in the model, not by these boxes — a scale
        // arrives from a paste as well as from somebody typing. Running the
        // typed value back through it means the box shows what will actually be
        // saved rather than what was asked for.
        onScaleChange(q) {
            q.scale = FormsCore.buildScale(q.scale);
            this.touch();
        },

        scaleLine(q) {
            const points = FormsCore.scalePoints(q && q.scale).length;
            return points + (points === 1 ? ' point' : ' points');
        },

        hasOptions(type) { return FormsCore.hasOptions(type); },

        // ── The three that reach outside the form (MS-390) ───────────────────

        // Whether this form may be public at all. A Directory Person picker
        // needs an account to read the directory (ADR-0031), so a form anybody
        // can open cannot carry one.
        get publicCheck() { return FormsCore.mayBePublic(this.form); },

        // The tags a picker may be scoped to. Never the ones that hide
        // themselves or their carriers — see offerableTags.
        get scopeTags() { return FormsCore.offerableTags(this.tags); },

        onScopeChange(q) {
            q.people = FormsCore.buildPeopleScope(q.people);
            this.touch();
        },

        scopeLine(q) {
            const scope = (q.people && q.people.scope) || 'everyone';
            if (scope === 'member') return 'Members only.';
            if (scope === 'non_member') return 'People who are not members.';
            if (scope === 'tag') {
                const tag = this.scopeTags.find(t => t.id === q.people.tagId);
                return tag ? ('People tagged ' + tag.name + '.') : 'Pick a tag.';
            }
            return 'Anybody in the directory.';
        },

        // Does this entry collect an answer? Everything does except a section
        // heading. Asked of the model rather than compared against 'section'
        // here, so a second non-asking type later needs no edit on this page.
        asks(q) { return FormsCore.asksSomething(q && q.type); },

        // The type picker's own vocabulary. Derived from FormsCore rather than
        // listed here, so the day a type goes live the picker follows without
        // anybody remembering to edit a second list.
        get typeGroups() {
            const seen = [];
            FormsCore.QUESTION_TYPES.forEach(t => { if (!seen.includes(t.group)) seen.push(t.group); });
            return seen;
        },

        typesIn(group) {
            return FormsCore.QUESTION_TYPES.filter(t => t.group === group);
        },

        typeLabel(id) {
            const t = FormsCore.questionType(id);
            return t ? t.label : 'Short answer';
        },

        metaFor(q) {
            const t = FormsCore.questionType(q.type);
            const bits = [t ? t.label : q.type];
            if (FormsCore.hasOptions(q.type)) {
                const n = (q.options || []).filter(o => o.trim()).length;
                bits.push(n === 1 ? '1 option' : n + ' options');
            }
            bits.push(q.required ? 'Needed' : 'Optional');
            return bits;
        },

        // ── The settings, and the interlock between them ─────────────────────
        //
        // Changing the rung down to `public` forces both switches off, because
        // FormsCore refuses to build a record whose settings its own rung
        // forbids. Doing it here too means the screen agrees with the record
        // rather than showing a tick that will not survive the save.
        setRung(rung) {
            // Refused here as well as in the model, so the reason reaches the
            // person who tried rather than the rung quietly snapping back.
            if (rung === 'public' && !this.publicCheck.ok) {
                this.problem = this.publicCheck.why;
                return;
            }
            this.problem = '';
            this.form.rung = rung;
            const allowed = FormsCore.settingsFor(rung);
            if (!allowed.attribution.available) this.form.attribution = false;
            if (!allowed.oneEach.available) this.form.oneEach = false;
            this.touch();
        },

        // ── Publishing, closing, deleting ────────────────────────────────────
        async publish() {
            try {
                await this.save(true);
                await FormsStore.publishForm(db, firebase, this.currentUser, this.formId);
                this.form.published = true;
            } catch (e) {
                this.problem = 'That did not publish. Try again.';
            }
        },

        async setClosed(closed) {
            try {
                await FormsStore.setClosed(db, firebase, this.currentUser, this.formId, closed);
                this.form.closed = closed;
            } catch (e) {
                this.problem = closed ? 'That did not close.' : 'That did not reopen.';
            }
        },

        get deleteQuestion() {
            const n = this.responseCount;
            if (!n) return 'Delete this form?';
            return `Delete this form and ${n === 1 ? 'the 1 answer' : 'all ' + n + ' answers'} it has gathered?`;
        },

        async doDelete() {
            try {
                await FormsStore.deleteForm(db, this.formId);
                window.location.href = this.libraryHref;
            } catch (e) {
                this.problem = 'That did not delete. Try again.';
                this.confirmingDelete = false;
            }
        },

        copyLink() {
            navigator.clipboard.writeText(this.shareUrl).then(() => {
                this.copied = true;
                setTimeout(() => { this.copied = false; }, 2000);
            }).catch(() => { this.problem = 'Could not copy. Select the link and copy it by hand.'; });
        },

        // ── What came back ───────────────────────────────────────────────────
        get tally() { return FormsCore.tally(this.form || {}, this.responses); },

        // An attributed form leads with WHO answered — two answers are a list of
        // people, not a chart. An anonymous one has nobody to list and leads
        // with the tally.
        get answerers() {
            if (!this.form || !this.form.attribution) return [];
            return this.responses.map(r => ({
                id: r.id,
                name: r.personName || 'Somebody',
                answered: FormsCore.askedQuestions(this.form)
                    .filter(q => (r.answers || {})[q.id] != null).length,
                of: FormsCore.askedQuestions(this.form).length,
            }));
        },

        // ⚠ The handle is POSITIONAL, from a stable shuffle keyed by the form,
        // and carries NO date. Arrival order plus a timestamp is what lines the
        // answers back up against who answered (ADR-0052).
        quotesFor(row) {
            if (!this.form.attribution) {
                const shuffled = FormsCore.stableShuffle(row.answers || [], this.formId);
                return shuffled.map((text, i) => ({ text: text, said: 'Answer ' + (i + 1) }));
            }
            return (row.answers || []).map((text, i) => ({ text: text, said: 'Answer ' + (i + 1) }));
        },

        pretty(dateStr) {
            if (!dateStr) return '';
            const p = String(dateStr).split('-');
            if (p.length !== 3) return dateStr;
            return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]))
                .toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
        },

        get saveLabel() {
            return { saved: 'Saved', unsaved: 'Unsaved changes', saving: 'Saving…', failed: 'Not saved' }[this.saveState];
        },
    };
}
