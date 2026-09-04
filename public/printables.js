// The Printables library (MS-392).
//
// A place you navigate INTO, not a list you pick from beside an editor
// (ADR-0053, borrowed whole from the Forms library). Opening a Printable goes
// to the editor's own page.
//
// Folders behave exactly like the Forms library's: created inline with no
// dialog, dragged to move with a "Move to…" fallback, renamed in place, and a
// confirmation naming the count before a full one goes. Underneath, a
// Printable remembers its folder and a folder does not remember its Printables
// (ADR-0054), so filing changes where a project is drawn and never whether it
// is. The walks are `filing-core.js`, shared with Forms.
//
// Duplicate is a first-class action here rather than something the editor
// does, because the brief's own example — a guest directory is the members
// directory copied and given one different filter — starts in the library.

function printablesPage() {
    return {
        loading: true,
        printables: [],
        folders: [],
        // Where we are. null is the top level.
        currentFolderId: null,
        search: '',
        creatingFolder: false,
        newFolderName: '',
        renamingId: null,
        renameText: '',
        moving: null,
        moveTargetId: '',
        dragging: null,
        // Two things ask first: a folder (it takes projects with it) and a
        // project (a Printable is hours of layout).
        deleting: null,
        deletingCount: 0,
        deletingPrintable: null,
        currentUser: null,
        currentPermissionLevel: 'viewer',
        creating: false,
        newName: '',
        problem: '',
        busy: false,

        get inShell() {
            return new URLSearchParams(location.search).get('shell') === 'mobile';
        },
        get homeHref() { return this.inShell ? 'mobile.html#/home' : 'index.html'; },
        get signInHref() { return this.inShell ? 'mobile.html#/login' : 'index.html'; },

        mayManagePrintables(level) {
            return ['editor', 'admin', 'elder', 'super_admin'].includes(level);
        },

        // What a row says under the name: the paper it is on and how many
        // pages it has grown to. A project nobody has opened yet says so,
        // because "0 pages" reads like something went wrong.
        subFor(p) {
            const bits = [];
            if (p.template && p.template.label) bits.push(p.template.label);
            const n = (p.pages || []).length;
            if (!p.template) bits.push('Not started');
            else bits.push(n === 1 ? '1 page' : n + ' pages');
            if (p.memberVisible) bits.push('Members may view');
            if (p.updatedByName) bits.push('Edited by ' + p.updatedByName);
            return bits.join(' · ');
        },

        // What a folder row says under its name. The count reaches every
        // depth, so a folder holding only sub-folders does not read as empty.
        folderSub(folder) {
            const items = FilingCore.itemsUnder(this.folders, this.printables, folder.id).length;
            const subs = FilingCore.childFolders(this.folders, folder.id).length;
            const bits = [];
            if (subs) bits.push(subs === 1 ? '1 folder' : subs + ' folders');
            bits.push(items === 1 ? '1 printable' : items + ' printables');
            return bits.join(' · ');
        },

        // ── Where we are ─────────────────────────────────────────────────

        get searching() { return this.search.trim().length > 0; },

        get breadcrumb() {
            return FilingCore.breadcrumbFor(this.folders, this.currentFolderId);
        },

        // Hidden while searching: a search is over every project wherever it
        // is filed, so a folder list beside it would answer a different
        // question.
        get visibleFolders() {
            if (this.searching) return [];
            return FilingCore.childFolders(this.folders, this.currentFolderId);
        },

        openFolder(folderId) {
            this.currentFolderId = folderId || null;
            this.search = '';
            this.cancelRename();
        },

        pathFor(p) {
            const crumbs = FilingCore.breadcrumbFor(this.folders, p.folderId);
            return crumbs.length ? crumbs.map(c => c.name).join(' / ') : 'Printables';
        },

        get visible() {
            const q = this.search.trim().toLowerCase();
            // Which projects count as being in this folder is the module's
            // answer rather than this page's: a project filed into a folder
            // that has since gone comes back to the top level instead of
            // disappearing (ADR-0054).
            const here = q
                ? this.printables
                : FilingCore.itemsIn(this.printables, this.currentFolderId, this.folders);
            return here.filter(p => {
                if (!q) return true;
                return String(p.name || '').toLowerCase().includes(q);
            });
        },

        get isEmpty() {
            return !this.loading && this.printables.length === 0 && this.folders.length === 0;
        },

        get folderEmpty() {
            return !this.loading && !this.isEmpty && !this.searching
                && !this.visible.length && !this.visibleFolders.length;
        },

        async init() {
            auth.onAuthStateChanged(async (user) => {
                if (!user) { window.location.href = this.signInHref; return; }
                // ⚠ The read of WHO YOU ARE is inside the try, not before it,
                // so a throw there shows a message rather than a spinner for
                // ever.
                try {
                    const userData = await getUserData(user.uid);
                    this.currentPermissionLevel = (userData && (userData.permissionLevel || userData.role)) || 'viewer';
                    if (!this.mayManagePrintables(this.currentPermissionLevel)) {
                        window.location.href = this.homeHref;
                        return;
                    }
                    this.currentUser = user;
                    // Two reads, separate records (ADR-0054). Only the
                    // PRINTABLES read may take the page down: a folder read
                    // that fails leaves a flat library rather than an empty
                    // one.
                    this.printables = await PrintableStore.listPrintables(db);
                    try {
                        this.folders = await PrintableStore.listFolders(db);
                    } catch (e) {
                        this.folders = [];
                        this.problem = 'Folders did not load, so everything is listed flat. ' +
                            'The printables themselves are all here.';
                    }
                } catch (e) {
                    this.problem = 'The printables did not load. Check your connection and refresh.';
                } finally {
                    this.loading = false;
                }
            });
        },

        // ── Making a project ─────────────────────────────────────────────────

        startCreate() {
            this.creating = true;
            this.newName = '';
            this.$nextTick(() => {
                const el = document.getElementById('new-printable-name');
                if (el) el.focus();
            });
        },

        cancelCreate() {
            this.creating = false;
            this.newName = '';
        },

        // Naming it and opening it are one move. The editor asks for paper
        // next; there is no blank-project-with-no-name state to get stuck in.
        async createPrintable() {
            const name = this.newName.trim();
            if (!name) { this.cancelCreate(); return; }
            try {
                const id = await PrintableStore.createPrintable(db, firebase, this.currentUser, {
                    name: name,
                    folderId: this.currentFolderId,
                });
                window.location.href = this.editorHref(id);
            } catch (e) {
                this.problem = 'That printable was not created. Try again.';
                this.creating = false;
            }
        },

        editorHref(id) {
            return 'printable-editor.html?id=' + encodeURIComponent(id);
        },

        open(p) {
            window.location.href = this.editorHref(p.id);
        },

        async duplicate(p) {
            if (this.busy) return;
            this.busy = true;
            try {
                const taken = this.printables.map(x => x.name);
                const id = await PrintableStore.duplicatePrintable(db, firebase, this.currentUser, p.id, taken);
                const copy = await PrintableStore.loadPrintable(db, id);
                if (copy) this.printables.unshift(copy);
                this.problem = '';
            } catch (e) {
                this.problem = 'That copy was not made. Try again.';
            } finally {
                this.busy = false;
            }
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
                const id = await PrintableStore.createFolder(db, firebase, this.currentUser, {
                    name: name,
                    parentId: this.currentFolderId,
                });
                this.folders.push({
                    id: id,
                    name: FilingCore.normaliseFolderName(name),
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
            this.renameText = item.name || '';
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
                    await PrintableStore.renameFolder(db, id, name);
                    const folder = this.folders.find(f => f.id === id);
                    if (folder) folder.name = FilingCore.normaliseFolderName(name);
                } else {
                    await PrintableStore.renamePrintable(db, firebase, this.currentUser, id, name);
                    const p = this.printables.find(x => x.id === id);
                    if (p) p.name = PrintableCore.normaliseName(name);
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

        // Asked of the model so a row cannot light up for a drop that would
        // then be refused.
        mayDropOn(folderId) {
            if (!this.dragging) return false;
            if (this.dragging.kind === 'printable') return true;
            return FilingCore.canMoveFolder(this.folders, this.dragging.id, folderId).ok;
        },

        async dropOn(folderId) {
            const held = this.dragging;
            this.dragging = null;
            if (!held) return;
            await this.moveItem(held.id, held.kind, folderId);
        },

        async moveItem(id, kind, targetId) {
            const target = targetId === FilingCore.TOP_LEVEL ? null : (targetId || null);
            try {
                if (kind === 'folder') {
                    const verdict = FilingCore.canMoveFolder(this.folders, id, target);
                    if (!verdict.ok) { this.problem = verdict.why; return; }
                    await PrintableStore.moveFolder(db, id, target);
                    const folder = this.folders.find(f => f.id === id);
                    if (folder) folder.parentId = target;
                } else {
                    await PrintableStore.movePrintable(db, firebase, this.currentUser, id, target);
                    const p = this.printables.find(x => x.id === id);
                    if (p) p.folderId = target;
                }
                this.problem = '';
            } catch (e) {
                this.problem = 'That move did not save. Refresh and try again.';
            }
        },

        startMove(item, kind) {
            this.moving = { id: item.id, kind: kind, name: item.name };
            this.moveTargetId = FilingCore.TOP_LEVEL;
        },

        cancelMove() { this.moving = null; },

        get moveOptions() {
            const exclude = this.moving && this.moving.kind === 'folder' ? this.moving.id : null;
            return FilingCore.moveTargets(this.folders, exclude, 'Printables');
        },

        async confirmMove() {
            const held = this.moving;
            const target = this.moveTargetId;
            this.moving = null;
            if (held) await this.moveItem(held.id, held.kind, target);
        },

        // ── Deleting ─────────────────────────────────────────────────────────

        startDeleteFolder(folder) {
            this.deleting = folder;
            this.deletingCount = FilingCore.itemsUnder(this.folders, this.printables, folder.id).length;
        },

        cancelDelete() { this.deleting = null; this.deletingCount = 0; this.deletingPrintable = null; },

        get deleteLine() {
            const n = this.deletingCount;
            if (!n) return 'It is empty, so nothing goes with it.';
            return (n === 1 ? 'One printable goes with it' : n + ' printables go with it') +
                '. That cannot be undone.';
        },

        async confirmDeleteFolder() {
            const folder = this.deleting;
            this.deleting = null;
            if (!folder) return;
            try {
                const goneIds = [folder.id]
                    .concat(FilingCore.descendantFolderIds(this.folders, folder.id));
                const gone = FilingCore
                    .itemsUnder(this.folders, this.printables, folder.id).map(p => p.id);
                await PrintableStore.deleteFolderTree(db, this.folders, this.printables, folder.id);
                this.folders = this.folders.filter(f => !goneIds.includes(f.id));
                this.printables = this.printables.filter(p => !gone.includes(p.id));
                if (goneIds.includes(this.currentFolderId)) this.currentFolderId = null;
            } catch (e) {
                this.problem = 'That folder was not fully deleted. Refresh to see what is left.';
            }
        },

        startDeletePrintable(p) {
            this.deletingPrintable = p;
        },

        async confirmDeletePrintable() {
            const p = this.deletingPrintable;
            this.deletingPrintable = null;
            if (!p) return;
            try {
                await PrintableStore.deletePrintable(db, p.id);
                this.printables = this.printables.filter(x => x.id !== p.id);
            } catch (e) {
                this.problem = 'That printable was not deleted. Refresh and try again.';
            }
        },
    };
}
