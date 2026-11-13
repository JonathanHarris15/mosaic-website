// The Resources library (MS-693) — the church's shelf, as a file manager.
//
// Members browse; `resources.edit` fills. The page mirrors the rules rather
// than inventing its own gate: `AccessCore.readsAsMember` to get in,
// `AccessCore.canEditResources` for every control, and the rules refuse
// anyway if somebody edits this file in a console.
//
// Three decisions live in `resources-core.js` rather than here, and that is
// the point of it: what a row says about itself, where a dragged pin lands,
// and whether a file may be uploaded at all. This file is navigation, the
// shapes the design asked for, and talking to the store.
//
// The folder walks are `filing-core.js`, shared with Forms and Printables —
// a resource remembers its folder, a folder does not remember its resources
// (ADR-0054).

// Roughly the tallest row menu (six items). Used only to pick which way a
// menu opens, so near enough is enough.
const MENU_HEIGHT = 200;

// The folder tree is a narrow scroller, so its menu cannot live inside the
// row the way the list's does — the tree would clip it. It is placed on the
// window instead, beside the button that opened it.
const TREE_MENU_WIDTH = 180;

/**
 * Where a tree menu sits so it stays on screen.
 * Opens downward unless that would miss the bottom and upward fits.
 * @param {{top: number, bottom: number, left: number, right: number}} rect
 * @param {{height: number, width: number}} viewport
 * @param {number} menuHeight
 * @return {{openUp: boolean, style: {top: string, bottom: string, left: string, right: string}}}
 */
function placeFloatingMenu(rect, viewport, menuHeight) {
    const height = menuHeight || MENU_HEIGHT;
    const margin = 8;
    const openUp = rect.bottom + height > viewport.height - margin
        && rect.top - height > margin;
    let left = rect.right - 28;
    const maxLeft = viewport.width - TREE_MENU_WIDTH - margin;
    if (left > maxLeft) left = maxLeft;
    if (left < margin) left = margin;
    return {
        openUp: openUp,
        style: {
            top: openUp ? 'auto' : (rect.bottom + 4) + 'px',
            bottom: openUp ? (viewport.height - rect.top + 4) + 'px' : 'auto',
            left: left + 'px',
            right: 'auto',
        },
    };
}

function resourcesPage() {
    return {
        loading: true,
        problem: '',
        busy: false,

        folders: [],
        resources: [],

        currentFolderId: null,
        search: '',

        currentUser: null,
        canEdit: false,

        // One open row menu at a time, keyed the way the core keys a pin.
        menuKey: '',
        menuUp: false,
        // The tree menu is positioned on the window (see placeFloatingMenu).
        // The list menu stays in its row, so these stay empty for that one.
        menuFixed: false,
        menuStyle: null,

        // Folder ids the tree is hiding the children of. Absent means open —
        // the shelf starts with the whole tree drawn, and a disclosure
        // control folds a branch when it gets in the way.
        collapsed: {},
        renamingKey: '',
        renameText: '',

        creatingFolder: false,
        newFolderName: '',

        addingLink: false,
        linkUrl: '',
        linkName: '',

        uploading: false,

        moving: null,
        moveTargetId: '',

        deleting: null,
        deletingCount: 0,

        dragKey: '',
        dragOverKey: '',

        openingKey: '',

        // ── Where we are ─────────────────────────────────────────────────────

        get inShell() {
            return new URLSearchParams(location.search).get('shell') === 'mobile';
        },
        get homeHref() { return this.inShell ? 'mobile.html#/home' : 'index.html'; },
        get signInHref() { return this.inShell ? 'mobile.html#/login' : 'index.html'; },

        get searching() { return this.search.trim().length > 0; },

        get atRoot() { return !this.currentFolderId; },

        keyOf(item) {
            if (!item) return '';
            return (item.isFolder || item.kind === 'folder' ? 'folder:' : 'resource:') + item.id;
        },

        // Folders and resources in one list, which is what a pin order spans.
        get everything() {
            return this.folders.concat(this.resources);
        },

        // ── The Pinned card ──────────────────────────────────────────────────
        //
        // Root only, and only when something is pinned — the design omits the
        // card rather than drawing an empty one. A search replaces the whole
        // browser, so the card goes with it.
        get pinned() {
            if (!this.atRoot || this.searching) return [];
            return ResourcesCore.pinnedOrder(this.everything);
        },

        get showPinCard() { return this.pinned.length > 0; },

        isPinned(item) { return ResourcesCore.isPinned(item); },

        // ── The folder tree ──────────────────────────────────────────────────

        // Every folder the tree is currently willing to draw, with the depth
        // it is indented and whether it has children to disclose. A collapsed
        // folder stays in the list; the folders inside it do not.
        get treeNodes() {
            const out = [];
            const walk = (parentId, depth) => {
                FilingCore.childFolders(this.folders, parentId).forEach((folder) => {
                    const hasChildren = FilingCore.childFolders(this.folders, folder.id).length > 0;
                    out.push({
                        id: folder.id,
                        depth: depth,
                        hasChildren: hasChildren,
                        folder: folder,
                    });
                    if (hasChildren && !this.collapsed[folder.id]) walk(folder.id, depth + 1);
                });
            };
            walk(null, 0);
            return out;
        },

        isCollapsed(id) { return !!this.collapsed[id]; },

        toggleCollapsed(id) {
            const next = Object.assign({}, this.collapsed);
            if (next[id]) delete next[id];
            else next[id] = true;
            this.collapsed = next;
        },

        // Opening a folder from the list or a search has to be able to show
        // that folder in the tree, which means the branches above it cannot
        // stay folded.
        revealFolder(folderId) {
            if (!folderId) return;
            const crumbs = FilingCore.breadcrumbFor(this.folders, folderId);
            const next = Object.assign({}, this.collapsed);
            let changed = false;
            crumbs.forEach((crumb) => {
                if (crumb.id === folderId || !next[crumb.id]) return;
                delete next[crumb.id];
                changed = true;
            });
            if (changed) this.collapsed = next;
        },

        get breadcrumb() {
            return FilingCore.breadcrumbFor(this.folders, this.currentFolderId);
        },

        get hereName() {
            const crumbs = this.breadcrumb;
            return crumbs.length ? crumbs[crumbs.length - 1].name : 'All resources';
        },

        openFolder(folderId) {
            this.revealFolder(folderId);
            this.currentFolderId = folderId || null;
            this.closeMenu();
            this.search = '';
        },

        // ── What the list shows ──────────────────────────────────────────────
        //
        // A search is over the WHOLE library, because somebody looking for
        // "Romans" does not know which folder it was filed in — which is the
        // entire reason the box is there.

        get visibleFolders() {
            if (this.searching) {
                return this.folders
                    .filter(f => ResourcesCore.matchesSearch(f, this.search))
                    .slice()
                    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
            }
            return FilingCore.childFolders(this.folders, this.currentFolderId);
        },

        get visibleResources() {
            const here = this.searching
                ? this.resources.filter(r => ResourcesCore.matchesSearch(r, this.search))
                : FilingCore.itemsIn(this.resources, this.currentFolderId, this.folders);
            return here.slice().sort((a, b) => String(a.name).localeCompare(String(b.name)));
        },

        get nothingHere() {
            return !this.visibleFolders.length && !this.visibleResources.length;
        },

        get emptyLine() {
            if (this.searching) return 'Nothing matches that.';
            if (this.atRoot) {
                return this.canEdit
                    ? 'The library is empty. Upload a file or make a folder to start it.'
                    : 'The library is empty.';
            }
            return 'No files in ' + this.hereName + ' yet.';
        },

        // ── How a row reads ──────────────────────────────────────────────────

        iconFor(item) { return ResourcesCore.iconFor(item); },

        // The colour classes the design gives each kind, so a scan down the
        // list separates a PDF from a Word document without reading.
        typeClassFor(item) {
            if (item.isFolder || item.kind === 'folder') return 'type-folder';
            const type = ResourcesCore.typeOf(item);
            if (type === 'link') return 'type-link';
            if (type === 'pdf') return 'type-pdf';
            if (type === 'image') return 'type-img';
            if (type === 'doc') return 'type-doc';
            return '';
        },

        metaFor(item) {
            if (item.isFolder || item.kind === 'folder') {
                const files = FilingCore.itemsUnder(this.folders, this.resources, item.id).length;
                const subs = FilingCore.childFolders(this.folders, item.id).length;
                const bits = ['Folder'];
                if (subs) bits.push(subs === 1 ? '1 folder' : subs + ' folders');
                if (files) bits.push(files === 1 ? '1 file' : files + ' files');
                return bits.join(' · ');
            }
            const meta = ResourcesCore.metaFor(item);
            return this.searching ? meta + ' · ' + this.pathFor(item) : meta;
        },

        pathFor(item) {
            const crumbs = FilingCore.breadcrumbFor(this.folders, item.folderId);
            return crumbs.length ? crumbs.map(c => c.name).join(' / ') : 'All resources';
        },

        // ── Opening one ──────────────────────────────────────────────────────

        openItem(item) {
            if (item.isFolder || item.kind === 'folder') return this.openFolder(item.id);
            if (item.kind === ResourcesCore.KIND_LINK) {
                window.open(item.url, '_blank', 'noopener');
                return undefined;
            }
            return this.downloadResource(item);
        },

        async downloadResource(resource) {
            if (this.openingKey) return;
            this.openingKey = this.keyOf(resource);
            try {
                const blob = await ResourcesStore.fetchResourceBlob(firebase, resource);
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = resource.name || 'resource';
                document.body.appendChild(link);
                link.click();
                link.remove();
                // Revoking in the same breath cancels the save.
                setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
            } catch (e) {
                this.problem = 'That file could not be opened. You may no longer have access to it.';
            } finally {
                this.openingKey = '';
            }
        },

        // ── The row menu ─────────────────────────────────────────────────────

        // ⚠ THE LIST CLIPS WHAT HANGS OUT OF IT, so the menu on the bottom
        // row opens upward or it is simply not there. The card scrolls its
        // own contents, which is what makes the shelf dense; the cost is that
        // an absolutely positioned menu is invisible rather than merely
        // awkward, and "the last file has no actions" is a bug nobody reports
        // because it reads as a dead button.
        toggleMenu(item, event) {
            const key = this.keyOf(item);
            if (this.menuKey === key) {
                this.closeMenu();
                return;
            }
            const button = event && event.currentTarget;
            const inTree = button && typeof button.closest === 'function'
                && button.closest('.fm-tree');
            if (inTree && typeof button.getBoundingClientRect === 'function') {
                const placed = placeFloatingMenu(
                    button.getBoundingClientRect(),
                    { height: globalThis.innerHeight, width: globalThis.innerWidth },
                    MENU_HEIGHT);
                this.menuUp = placed.openUp;
                this.menuFixed = true;
                this.menuStyle = placed.style;
            } else {
                this.menuUp = this.opensUpward(event);
                this.menuFixed = false;
                this.menuStyle = null;
            }
            this.menuKey = key;
        },

        opensUpward(event) {
            const button = event && event.currentTarget;
            if (!button || typeof button.closest !== 'function') return false;
            const clip = button.closest('.fm-list, .fm-pin-card');
            if (!clip) return false;
            const row = button.getBoundingClientRect();
            const box = clip.getBoundingClientRect();
            // Downward unless it would be cut off AND upward actually fits —
            // a box too short for either way keeps the familiar direction.
            return row.bottom + MENU_HEIGHT > box.bottom
                && row.top - MENU_HEIGHT > box.top;
        },

        closeMenu() {
            this.menuKey = '';
            this.menuFixed = false;
            this.menuStyle = null;
        },

        // Escape leaves a menu. Dialogs handle their own Escape; a closed
        // menu makes this a no-op so the two do not fight.
        onEscape() {
            if (this.menuKey) this.closeMenu();
        },

        // Scrolling the tree would leave a fixed menu pointing at nothing.
        onTreeScroll() {
            if (this.menuFixed) this.closeMenu();
        },

        menuOpen(item) { return this.menuKey === this.keyOf(item); },

        // ── Adding ───────────────────────────────────────────────────────────

        startFolder() {
            this.creatingFolder = true;
            this.addingLink = false;
            this.newFolderName = '';
            this.$nextTick(() => {
                const el = document.getElementById('new-folder-name');
                if (el) el.focus();
            });
        },

        cancelFolder() { this.creatingFolder = false; this.newFolderName = ''; },

        async createFolder() {
            const name = this.newFolderName.trim();
            if (!name) { this.cancelFolder(); return; }
            try {
                const id = await ResourcesStore.createFolder(db, firebase, this.currentUser, {
                    name: name,
                    parentId: this.currentFolderId,
                });
                this.folders.push({
                    id: id,
                    name: FilingCore.normaliseFolderName(name),
                    parentId: this.currentFolderId,
                    pinRank: null,
                    isFolder: true,
                });
                this.problem = '';
            } catch (e) {
                this.problem = 'That folder was not created. You may not have permission.';
            }
            this.cancelFolder();
        },

        startLink() {
            this.addingLink = true;
            this.creatingFolder = false;
            this.linkUrl = '';
            this.linkName = '';
            this.$nextTick(() => {
                const el = document.getElementById('new-link-url');
                if (el) el.focus();
            });
        },

        cancelLink() { this.addingLink = false; this.linkUrl = ''; this.linkName = ''; },

        async createLink() {
            const check = ResourcesCore.validateLinkUrl(this.linkUrl);
            if (!check.ok) { this.problem = check.error; return; }
            try {
                const id = await ResourcesStore.addLink(db, firebase, this.currentUser, {
                    name: this.linkName.trim() || check.url,
                    url: check.url,
                    folderId: this.currentFolderId,
                });
                this.resources.push(Object.assign(
                    { id: id },
                    ResourcesCore.buildLinkResource({
                        name: this.linkName.trim() || check.url,
                        url: check.url,
                        folderId: this.currentFolderId,
                    })));
                this.problem = '';
            } catch (e) {
                this.problem = 'That link was not added. You may not have permission.';
            }
            this.cancelLink();
        },

        pickFile() {
            const el = document.getElementById('resource-file');
            if (el) el.click();
        },

        async onFilePicked(event) {
            const input = event.target;
            const file = input.files && input.files[0];
            input.value = '';
            if (!file) return;

            const check = ResourcesCore.validateUploadFile(file);
            if (!check.ok) { this.problem = check.error; return; }

            this.uploading = true;
            this.problem = '';
            try {
                const folderId = this.currentFolderId;
                const id = await ResourcesStore.uploadFile(db, firebase, this.currentUser, {
                    file: file,
                    folderId: folderId,
                });
                this.resources.push(Object.assign(
                    { id: id },
                    ResourcesCore.buildFileResource({
                        name: file.name,
                        folderId: folderId,
                        storagePath: ResourcesCore.storagePathFor(id, file.name),
                        contentType: file.type || null,
                        size: file.size,
                    })));
            } catch (e) {
                this.problem = 'That file was not uploaded. ' +
                    'It may be too large, or you may not have permission.';
            } finally {
                this.uploading = false;
            }
        },

        // ── Renaming, in place ───────────────────────────────────────────────

        startRename(item, event) {
            this.closeMenu();
            this.renamingKey = this.keyOf(item);
            this.renameText = item.name || '';
            const fromTree = !!(event && event.target && event.target.closest
                && event.target.closest('.fm-tree'));
            const key = this.renamingKey;
            this.$nextTick(() => {
                const scoped = fromTree
                    ? '.fm-tree [data-rename="' + key + '"]'
                    : '.fm-main [data-rename="' + key + '"], .fm-pin-card [data-rename="' + key + '"]';
                const el = document.querySelector(scoped)
                    || document.querySelector('[data-rename="' + key + '"]');
                if (el) { el.focus(); el.select(); }
            });
        },

        renaming(item) { return this.renamingKey === this.keyOf(item); },

        cancelRename() { this.renamingKey = ''; this.renameText = ''; },

        // The same folder can be mid-rename in the tree and in the list.
        // Leaving one field for the other is not a commit.
        finishRename(item, event) {
            const next = event && event.relatedTarget;
            if (next && next.classList && next.classList.contains('fm-rename')) return;
            this.commitRename(item);
        },

        async commitRename(item) {
            const name = this.renameText.trim();
            this.cancelRename();
            if (!name || name === item.name) return;
            try {
                item.name = await ResourcesStore.rename(db, firebase, this.currentUser, item, name);
                this.problem = '';
            } catch (e) {
                this.problem = 'That rename did not save. Refresh and try again.';
            }
        },

        // ── Moving ───────────────────────────────────────────────────────────

        startMove(item) {
            this.closeMenu();
            this.moving = item;
            this.moveTargetId = FilingCore.TOP_LEVEL;
        },

        cancelMove() { this.moving = null; this.moveTargetId = ''; },

        get moveOptions() {
            const exclude = this.moving && (this.moving.isFolder || this.moving.kind === 'folder')
                ? this.moving.id : null;
            return FilingCore.moveTargets(this.folders, exclude, 'All resources');
        },

        async confirmMove() {
            const item = this.moving;
            const target = this.moveTargetId === FilingCore.TOP_LEVEL ? null : this.moveTargetId;
            this.cancelMove();
            if (!item) return;
            const isFolder = !!(item.isFolder || item.kind === 'folder');
            if (isFolder) {
                const verdict = FilingCore.canMoveFolder(this.folders, item.id, target);
                if (!verdict.ok) { this.problem = verdict.why; return; }
            }
            try {
                await ResourcesStore.move(db, firebase, this.currentUser, item, target);
                if (isFolder) item.parentId = target;
                else item.folderId = target;
                this.problem = '';
            } catch (e) {
                this.problem = 'That move did not save. Refresh and try again.';
            }
        },

        // ── Deleting ─────────────────────────────────────────────────────────

        startDelete(item) {
            this.closeMenu();
            this.deleting = item;
            this.deletingCount = (item.isFolder || item.kind === 'folder')
                ? FilingCore.itemsUnder(this.folders, this.resources, item.id).length
                : 0;
        },

        cancelDelete() { this.deleting = null; this.deletingCount = 0; },

        get deleteLine() {
            const item = this.deleting;
            if (!item) return '';
            if (!(item.isFolder || item.kind === 'folder')) {
                return 'It goes from the library for everybody. That cannot be undone.';
            }
            const n = this.deletingCount;
            if (!n) return 'It is empty, so nothing goes with it.';
            return (n === 1 ? 'One file goes with it' : n + ' files go with it') +
                '. That cannot be undone.';
        },

        async confirmDelete() {
            const item = this.deleting;
            this.cancelDelete();
            if (!item) return;
            const isFolder = !!(item.isFolder || item.kind === 'folder');
            try {
                if (isFolder) {
                    const goneFolders = [item.id]
                        .concat(FilingCore.descendantFolderIds(this.folders, item.id));
                    const gone = FilingCore
                        .itemsUnder(this.folders, this.resources, item.id).map(r => r.id);
                    await ResourcesStore.deleteFolderTree(
                        db, firebase, this.folders, this.resources, item.id);
                    this.folders = this.folders.filter(f => !goneFolders.includes(f.id));
                    this.resources = this.resources.filter(r => !gone.includes(r.id));
                    if (goneFolders.includes(this.currentFolderId)) this.currentFolderId = null;
                } else {
                    await ResourcesStore.deleteResource(db, firebase, item);
                    this.resources = this.resources.filter(r => r.id !== item.id);
                }
                this.problem = '';
            } catch (e) {
                this.problem = 'That was not deleted. Refresh to see what is left.';
            }
        },

        // ── Pins (ADR-0083) ──────────────────────────────────────────────────

        async togglePin(item) {
            this.closeMenu();
            try {
                if (ResourcesCore.isPinned(item)) {
                    await ResourcesStore.unpin(db, item);
                    item.pinRank = null;
                } else {
                    item.pinRank = await ResourcesStore.pin(db, item, this.everything);
                }
                this.problem = '';
            } catch (e) {
                this.problem = 'That pin did not save. Refresh and try again.';
            }
        },

        // One step up or down, which is how the phone reorders — the arrows
        // are a desktop affordance and the menu carries the same two moves.
        async nudge(item, delta) {
            this.closeMenu();
            const plan = ResourcesCore.planPinNudge(this.everything, {
                id: item.id,
                isFolder: !!(item.isFolder || item.kind === 'folder'),
            }, delta);
            if (!plan.ok) return;
            await this.applyPinPlan(plan);
        },

        canNudge(item, delta) {
            const at = this.pinned.findIndex(p => this.keyOf(p) === this.keyOf(item));
            if (at < 0) return false;
            const to = at + delta;
            return to >= 0 && to < this.pinned.length;
        },

        // ── Dragging a pin ───────────────────────────────────────────────────

        startPinDrag(item) { this.dragKey = this.keyOf(item); },

        endPinDrag() { this.dragKey = ''; this.dragOverKey = ''; },

        overPin(item) {
            if (!this.dragKey) return;
            this.dragOverKey = this.keyOf(item);
        },

        async dropOnPin(item) {
            const held = this.dragKey;
            this.endPinDrag();
            if (!held || held === this.keyOf(item)) return;
            const to = this.pinned.findIndex(p => this.keyOf(p) === this.keyOf(item));
            if (to < 0) return;
            const moved = this.pinned.find(p => this.keyOf(p) === held);
            if (!moved) return;
            const plan = ResourcesCore.planPinMove(this.everything, {
                id: moved.id,
                isFolder: !!(moved.isFolder || moved.kind === 'folder'),
            }, to);
            if (!plan.ok) { this.problem = plan.why; return; }
            await this.applyPinPlan(plan);
        },

        // The plan is written to the records in hand before it is written to
        // Firestore, so the card settles into its new order immediately; a
        // failure puts the message up and the next load corrects it.
        async applyPinPlan(plan) {
            try {
                await ResourcesStore.applyPinWrites(db, plan.writes);
                const byKey = new Map(this.everything.map(it => [this.keyOf(it), it]));
                plan.writes.forEach((w) => {
                    const held = byKey.get((w.isFolder ? 'folder:' : 'resource:') + w.id);
                    if (held) held.pinRank = w.pinRank;
                });
                this.problem = '';
            } catch (e) {
                this.problem = 'That order did not save. Refresh and try again.';
            }
        },

        // ── Boot ─────────────────────────────────────────────────────────────

        async init() {
            auth.onAuthStateChanged(async (user) => {
                // Localhost with ?emulator=1 only; the hook is undefined
                // anywhere else, so this costs the real page nothing. It is
                // what lets a read-only smoke test arrive as a member without
                // anybody driving a login form.
                if (!user && typeof window.MosaicEmulatorSignIn === 'function') {
                    try { await window.MosaicEmulatorSignIn(); return; }
                    catch (e) { /* fall through to the sign-in redirect */ }
                }
                if (!user) { window.location.href = this.signInHref; return; }
                // ⚠ The read of WHO YOU ARE is inside the try, not before it,
                // so a throw there shows a message rather than a spinner for
                // ever.
                try {
                    const userData = await getUserData(user.uid);
                    if (!AccessCore.readsAsMember(userData)) {
                        window.location.href = this.homeHref;
                        return;
                    }
                    this.currentUser = user;
                    this.canEdit = AccessCore.canEditResources(userData);

                    // Two reads, separate records (ADR-0054). Only the
                    // RESOURCES read may take the page down: a folder read
                    // that fails leaves a flat library rather than an empty
                    // one.
                    this.resources = await ResourcesStore.listResources(db);
                    try {
                        this.folders = await ResourcesStore.listFolders(db);
                    } catch (e) {
                        this.folders = [];
                        this.problem = 'Folders did not load, so everything is listed flat. ' +
                            'The files themselves are all here.';
                    }
                } catch (e) {
                    this.problem = 'Could not load the library. Refresh and try again.';
                } finally {
                    this.loading = false;
                }
            });
        },
    };
}

// Exposed for Node-based tests; ignored in the browser.
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {resourcesPage, MENU_HEIGHT, placeFloatingMenu, TREE_MENU_WIDTH};
}
