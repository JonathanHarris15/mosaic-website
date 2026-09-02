// The Forms library (MS-360, MS-370).
//
// A place you navigate INTO, not a list you pick from beside an editor
// (ADR-0053). Opening a form goes to its own page. That shape is here now, with
// the folders deferred to MS-361, because a folder tree cannot live in a 372px
// rail beside an editor — so the split pane this nearly was would have been
// thrown away the moment folders arrived.

function formsPage() {
    return {
        loading: true,
        forms: [],
        search: '',
        // On by default. A closed form is a record and this page is a working
        // list; three finished sign-ups at the top is three rows of noise every
        // time somebody opens it.
        hideClosed: true,
        currentUser: null,
        currentPermissionLevel: 'viewer',
        creating: false,
        newTitle: '',
        problem: '',

        get inShell() {
            return new URLSearchParams(location.search).get('shell') === 'mobile';
        },
        get homeHref() { return this.inShell ? 'mobile.html#/home' : 'index.html'; },
        get signInHref() { return this.inShell ? 'mobile.html#/login' : 'index.html'; },

        mayManageForms(level) {
            return ['editor', 'admin', 'elder', 'super_admin'].includes(level);
        },

        get today() {
            return (window.DateUtils && DateUtils.todayStr()) || new Date().toISOString().slice(0, 10);
        },

        isClosed(form) { return FormsCore.isClosed(form, this.today); },

        // What a row says under the name. Deliberately not a date: the useful
        // thing at a glance is what state it is in and how much came back.
        subFor(form) {
            const bits = [];
            bits.push(form.rung === 'public' ? 'Anyone with the link' : 'Members and above');
            if (form.attribution === false) bits.push('Anonymous');
            if (form.oneEach) bits.push('One each');
            const n = (form.questions || []).length;
            bits.push(n === 1 ? '1 question' : n + ' questions');
            return bits.join(' · ');
        },

        stateFor(form) {
            if (this.isClosed(form)) return { text: 'Closed', tone: 'm-badge--neutral' };
            if (!form.published) return { text: 'Draft', tone: 'm-badge--warning' };
            return { text: 'Open', tone: 'm-badge--success' };
        },

        get visible() {
            const q = this.search.trim().toLowerCase();
            return this.forms.filter(f => {
                if (this.hideClosed && this.isClosed(f)) return false;
                if (!q) return true;
                // Searching looks at the title AND the questions — you remember
                // that you asked about childcare long after you have forgotten
                // what you called the form.
                const hay = [f.title, f.description || '']
                    .concat((f.questions || []).map(x => x.text))
                    .join(' ').toLowerCase();
                return hay.includes(q);
            });
        },

        get closedCount() {
            return this.forms.filter(f => this.isClosed(f)).length;
        },

        get closedHidden() {
            return this.hideClosed && this.closedCount > 0;
        },

        get closedLine() {
            const n = this.closedCount;
            return `${n === 1 ? 'One closed form is' : n + ' closed forms are'} folded away. ` +
                'They are not deleted and their links still work.';
        },

        get isEmpty() {
            return !this.loading && this.forms.length === 0;
        },

        async init() {
            auth.onAuthStateChanged(async (user) => {
                if (!user) { window.location.href = this.signInHref; return; }
                // ⚠ The read of WHO YOU ARE is inside the try, not before it.
                // Left outside, a throw there escapes the boot and the page
                // spins on its spinner for ever — auth.js catches the rejection
                // and offers a reload, but a page that can say what went wrong
                // in place is better than one that can only be reloaded.
                try {
                    const userData = await getUserData(user.uid);
                    this.currentPermissionLevel = (userData && (userData.permissionLevel || userData.role)) || 'viewer';
                    if (!this.mayManageForms(this.currentPermissionLevel)) {
                        window.location.href = this.homeHref;
                        return;
                    }
                    this.currentUser = user;
                    this.forms = await FormsStore.listForms(db);
                } catch (e) {
                    this.problem = 'The forms did not load. Check your connection and refresh.';
                } finally {
                    this.loading = false;
                }
            });
        },

        startCreate() {
            this.creating = true;
            this.newTitle = '';
            this.$nextTick(() => {
                const el = document.getElementById('new-form-title');
                if (el) el.focus();
            });
        },

        cancelCreate() {
            this.creating = false;
            this.newTitle = '';
        },

        // Naming it and opening it are one move, the way the Document Library
        // creates a document. There is no blank-form-with-no-name state to get
        // stuck in.
        async createForm() {
            const title = this.newTitle.trim();
            if (!title) { this.cancelCreate(); return; }
            try {
                const id = await FormsStore.createForm(db, firebase, this.currentUser, {
                    title: title,
                    rung: 'member',
                    attribution: true,
                });
                window.location.href = this.formHref(id);
            } catch (e) {
                this.problem = 'That form was not created. Try again.';
                this.creating = false;
            }
        },

        formHref(id) {
            return 'form.html?id=' + encodeURIComponent(id) + (this.inShell ? '&shell=mobile' : '');
        },

        open(form) {
            window.location.href = this.formHref(form.id);
        },
    };
}
