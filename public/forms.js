// The Forms library (MS-360, MS-370).
//
// A place you navigate INTO, not a list you pick from beside an editor
// (ADR-0053). Opening a form goes to its own page — which is why the split pane
// this nearly was would have been thrown away the moment folders arrived.
//
// Folders arrived in MS-376. On screen they behave exactly like the Document
// Library's: created inline with no dialog, dragged to move with a "Move to…"
// fallback, renamed in place, and a confirmation naming the count before a
// full one goes. Underneath they are nothing like it (ADR-0054) — a form
// remembers its folder, a folder does not remember its forms — and the page
// still lists the whole `forms` collection, so filing changes where a form is
// drawn and never whether it is.

function formsPage() {
    return {
        loading: true,
        forms: [],
        folders: [],
        // Where we are. null is the top level.
        currentFolderId: null,
        search: '',
        // Inline editing, the Document Library's way: no dialog, the name is
        // editable where the row already is.
        creatingFolder: false,
        newFolderName: '',
        renamingId: null,
        renameText: '',
        // The "Move to…" fallback, and what is being dragged.
        moving: null,
        moveTargetId: '',
        dragging: null,
        // The one thing that does get a dialog, because it destroys answers.
        deleting: null,
        deletingCount: 0,
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

        // What a folder row says under its name. The count reaches every
        // depth, so a folder holding only sub-folders does not read as empty.
        folderSub(folder) {
            const forms = FormFoldersCore.formsUnder(this.folders, this.forms, folder.id).length;
            const subs = FormFoldersCore.childFolders(this.folders, folder.id).length;
            const bits = [];
            if (subs) bits.push(subs === 1 ? '1 folder' : subs + ' folders');
            bits.push(forms === 1 ? '1 form' : forms + ' forms');
            return bits.join(' · ');
        },

        stateFor(form) {
            if (this.isClosed(form)) return { text: 'Closed', tone: 'm-badge--neutral' };
            if (!form.published) return { text: 'Draft', tone: 'm-badge--warning' };
            return { text: 'Open', tone: 'm-badge--success' };
        },

        // ── Where we are ─────────────────────────────────────────────────

        get searching() { return this.search.trim().length > 0; },

        get breadcrumb() {
            return FormFoldersCore.breadcrumbFor(this.folders, this.currentFolderId);
        },

        // Folders shown in this folder. Hidden while searching: a search is
        // over every form wherever it is filed, so a folder list beside it
        // would be answering a different question.
        get visibleFolders() {
            if (this.searching) return [];
            return FormFoldersCore.childFolders(this.folders, this.currentFolderId);
        },

        openFolder(folderId) {
            this.currentFolderId = folderId || null;
            this.search = '';
            this.cancelRename();
        },

        // Where a form is filed, for the sub-line while searching — a hit three
        // folders deep is not much use without saying where it was found.
        pathFor(form) {
            const crumbs = FormFoldersCore.breadcrumbFor(this.folders, form.folderId);
            return crumbs.length ? crumbs.map(c => c.name).join(' / ') : 'Forms';
        },

        get visible() {
            const q = this.search.trim().toLowerCase();
            // Browsing shows this folder; searching reaches every one of them.
            //
            // WHICH forms count as being in this folder is the module's answer
            // rather than this page's, because it is not a plain comparison: a
            // form filed into a folder that has since gone comes back to the top
            // level instead of disappearing (ADR-0054), and that rule written
            // twice is a rule that can drift.
            const here = q
                ? this.forms
                : FormFoldersCore.formsIn(this.forms, this.currentFolderId, this.folders);
            return here.filter(f => {
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
            return !this.loading && this.forms.length === 0 && this.folders.length === 0;
        },

        // This folder, as opposed to the whole library, has nothing in it.
        get folderEmpty() {
            return !this.loading && !this.isEmpty && !this.searching
                && !this.visible.length && !this.visibleFolders.length;
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
                    // Two reads, not one. They are separate records on purpose
                    // (ADR-0054) and neither orders the other.
                    //
                    // ⚠ Only the FORMS read is allowed to take the page down.
                    // Folders are how the library is arranged; forms are what it
                    // is for. A folder read that fails — rules not yet deployed,
                    // a network blip — must leave a flat library rather than an
                    // empty one, because the same principle applies as when a
                    // folder is deleted: a live form whose link people are
                    // answering has to stay findable.
                    this.forms = await FormsStore.listForms(db);
                    try {
                        this.folders = await FormsStore.listFolders(db);
                    } catch (e) {
                        this.folders = [];
                        this.problem = 'Folders did not load, so everything is listed flat. ' +
                            'The forms themselves are all here.';
                    }
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
                    // Made where you are standing, which is what filing means.
                    folderId: this.currentFolderId,
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

        // ── Making a folder ──────────────────────────────────────────────────

        startFolder() {
            this.creatingFolder = true;
            this.newFolderName = '';
            this.$nextTick(() => {
                const el = document.getElementById('new-folder-name');
                if (el) { el.focus(); el.select(); }
            });
        },

        cancelFolder() {
            this.creatingFolder = false;
            this.newFolderName = '';
        },

        async createFolder() {
            const name = this.newFolderName.trim();
            if (!name) { this.cancelFolder(); return; }
            try {
                const id = await FormsStore.createFolder(db, firebase, this.currentUser, {
                    name: name,
                    parentId: this.currentFolderId,
                });
                this.folders.push({
                    id: id,
                    name: FormFoldersCore.normaliseFolderName(name),
                    parentId: this.currentFolderId,
                });
                this.cancelFolder();
            } catch (e) {
                this.problem = 'That folder was not created. Try again.';
                this.cancelFolder();
            }
        },

        // ── Renaming, in place ───────────────────────────────────────────────

        startRename(item) {
            this.renamingId = item.id;
            this.renameText = item.name || item.title || '';
            this.$nextTick(() => {
                const el = document.getElementById('rename-' + item.id);
                if (el) { el.focus(); el.select(); }
            });
        },

        cancelRename() {
            this.renamingId = null;
            this.renameText = '';
        },

        async commitRename(item, isFolder) {
            const name = this.renameText.trim();
            const id = item.id;
            this.cancelRename();
            if (!name) return;
            try {
                if (isFolder) {
                    await FormsStore.renameFolder(db, id, name);
                    const folder = this.folders.find(f => f.id === id);
                    if (folder) folder.name = FormFoldersCore.normaliseFolderName(name);
                } else {
                    await FormsStore.renameFormTitle(db, firebase, this.currentUser, id, name);
                    const form = this.forms.find(f => f.id === id);
                    if (form) form.title = FormsCore.normaliseTitle(name);
                }
            } catch (e) {
                this.problem = 'That rename did not save. Refresh and try again.';
            }
        },

        // ── Moving: dragged, or picked from a list ───────────────────────────

        startDrag(item, kind) {
            this.dragging = { id: item.id, kind: kind };
        },

        endDrag() {
            this.dragging = null;
        },

        // Whether the thing currently in the air may be dropped here. Asked of
        // the model so the row cannot light up for a drop that would then be
        // refused.
        mayDropOn(folderId) {
            if (!this.dragging) return false;
            if (this.dragging.kind === 'form') return true;
            return FormFoldersCore.canMoveFolder(this.folders, this.dragging.id, folderId).ok;
        },

        async dropOn(folderId) {
            const held = this.dragging;
            this.dragging = null;
            if (!held) return;
            await this.moveItem(held.id, held.kind, folderId);
        },

        async moveItem(id, kind, targetId) {
            const target = targetId === FormFoldersCore.TOP_LEVEL ? null : (targetId || null);
            try {
                if (kind === 'folder') {
                    const verdict = FormFoldersCore.canMoveFolder(this.folders, id, target);
                    if (!verdict.ok) { this.problem = verdict.why; return; }
                    await FormsStore.moveFolder(db, id, target);
                    const folder = this.folders.find(f => f.id === id);
                    if (folder) folder.parentId = target;
                } else {
                    await FormsStore.moveForm(db, firebase, this.currentUser, id, target);
                    const form = this.forms.find(f => f.id === id);
                    if (form) form.folderId = target;
                }
                this.problem = '';
            } catch (e) {
                this.problem = 'That move did not save. Refresh and try again.';
            }
        },

        // The fallback, for a device where dragging is awkward — which on a
        // touch screen is every device.
        startMove(item, kind) {
            this.moving = { id: item.id, kind: kind, name: item.name || item.title };
            this.moveTargetId = FormFoldersCore.TOP_LEVEL;
        },

        cancelMove() { this.moving = null; },

        get moveOptions() {
            const exclude = this.moving && this.moving.kind === 'folder' ? this.moving.id : null;
            return FormFoldersCore.moveTargets(this.folders, exclude);
        },

        async confirmMove() {
            const held = this.moving;
            const target = this.moveTargetId;
            this.moving = null;
            if (held) await this.moveItem(held.id, held.kind, target);
        },

        // ── Deleting a folder ────────────────────────────────────────────────
        //
        // The only thing on this page that gets a dialog, because it is the only
        // one that destroys answers people gave. The count is what makes the
        // question answerable — "delete Sign-ups?" is unanswerable, "delete
        // Sign-ups and the 14 forms in it?" is not.

        startDeleteFolder(folder) {
            this.deleting = folder;
            this.deletingCount = FormFoldersCore.formsUnder(this.folders, this.forms, folder.id).length;
        },

        cancelDelete() { this.deleting = null; this.deletingCount = 0; },

        get deleteLine() {
            const n = this.deletingCount;
            if (!n) return 'It is empty, so nothing goes with it.';
            return (n === 1 ? 'One form goes with it' : n + ' forms go with it') +
                ', and the answers they have gathered. That cannot be undone.';
        },

        async confirmDeleteFolder() {
            const folder = this.deleting;
            this.deleting = null;
            if (!folder) return;
            try {
                const goneIds = [folder.id]
                    .concat(FormFoldersCore.descendantFolderIds(this.folders, folder.id));
                const goneForms = FormFoldersCore
                    .formsUnder(this.folders, this.forms, folder.id).map(f => f.id);
                await FormsStore.deleteFolderTree(db, this.folders, this.forms, folder.id);
                this.folders = this.folders.filter(f => !goneIds.includes(f.id));
                this.forms = this.forms.filter(f => !goneForms.includes(f.id));
                if (goneIds.includes(this.currentFolderId)) this.currentFolderId = null;
            } catch (e) {
                this.problem = 'That folder was not fully deleted. Refresh to see what is left.';
            }
        },
    };
}
