// Document directory component. Drives two surfaces off one code path:
//   • the global Document Library page   → scope { structureDocId: 'root', ownerPersonId: null }
//   • a Person's Shepherding-Profile tab → scope { structureDocId: 'person_<id>', ownerPersonId: <id>, embedded }
// The tree logic lives in ShepherdingDocsCore; this component owns Firestore and
// the Alpine view state. Called as `documentLibrary()` (defaults to the global
// Library) or `documentLibrary({ ...scope })` when embedded in a profile.
const Docs = (typeof ShepherdingDocsCore !== 'undefined') ? ShepherdingDocsCore : require('./shepherding-documents-core.js');

// Firestore's code for a write the security rules turned down.
const PERMISSION_DENIED = 'permission-denied';

// The live reads this page holds open, stopped when it goes (MS-496). Kept
// outside Alpine: a proxy around a stop function is no use to anybody.
const _libraryWatches = [];
function stopLibraryWatches() {
    _libraryWatches.splice(0).forEach(stop => { try { stop(); } catch (e) {} });
}

document.addEventListener('alpine:init', () => {
    Alpine.data('documentLibrary', (config = {}) => ({
        // ── Scope (MS-98) ─────────────────────────────────────────────────────
        // Which structure document this directory reads/writes, and (for a profile
        // tab) the Person that owns documents created here. Defaults reproduce the
        // global Library exactly.
        structureDocId: config.structureDocId || 'root',
        // Whose profile this is, for the first answer of a shepherding document
        // started here. A function because the page loads the Person after it
        // mounts this, and a value read at mount would always be ''.
        get ownerPersonName() {
            return typeof config.ownerPersonName === 'function' ? (config.ownerPersonName() || '') : '';
        },
        ownerPersonId: config.ownerPersonId || null,
        embedded: !!config.embedded, // mounted inside an already-authenticated page

        loading: true,

        // ── Identity, read live (MS-283) ──────────────────────────────────────
        // An embedded directory is handed a *reader* for its host page's identity,
        // never a copy. The host resolves the signed-in Elder asynchronously, but
        // this component mounts as soon as the Person id is known — that comes off
        // the URL, so instantly — and a copy taken in that gap stayed null for the
        // life of the page. Nothing re-mounted it. Reading through means identity
        // that arrives late is still seen, and it cannot break that way again.
        //
        // All three fields move together. Only `user` announced itself, because the
        // other two had fallbacks: every document made here would have been authored
        // by the literal string "Elder", silently.
        readHostIdentity: typeof config.identity === 'function' ? config.identity : null,
        // The standalone Library page has no host, so it fills this in itself, in
        // one assignment from the auth gate below.
        ownIdentity: { user: null, name: '', permissionLevel: null },

        get identity() {
            return (this.readHostIdentity ? this.readHostIdentity() : this.ownIdentity) || {};
        },
        get currentUser() { return this.identity.user || null; },
        get currentUserName() { return this.identity.name || ''; },
        get currentPermissionLevel() { return this.identity.permissionLevel || null; },

        structure: { children: [] },
        allDocs: {},
        // Tree changes this page has made and the server has not confirmed yet.
        // A tree that arrives in the meantime has them applied on top, so an
        // elder's own click never flickers out and back (MS-493).
        pendingTree: [],

        currentPath: [],

        renamingItemId: null,
        renameValue: '',

        draggedItem: null,
        dragOverFolderId: null,

        showMoveModal: false,
        movingItem: null,
        moveTargetId: '__root__',

        showCreateModal: false,
        createDocType: 'note',
        // The document-mode Form Templates, and which one is picked (MS-385).
        formTemplates: [],
        createTemplateId: '',
        createFilterMode: 'preset', // 'preset' | 'custom'
        customFilter: { filterTags: [], filterMode: 'any', statusZoneFilters: [] },
        views: [],
        selectedViewId: null,
        shepherdingTags: [],

        showDeleteConfirm: false,
        deletingItem: null,
        deleteDocCount: 0,
        deleteFolderName: '',

        // Opt-in-to-Library dialog (profile scope only).
        showLibraryModal: false,
        libraryItem: null,
        libraryTargetId: '__root__',
        libraryFolderOptions: [],

        toast: { show: false, message: '', type: 'success' },

        // True when this directory is a per-person profile tab rather than the
        // global Library. Drives the profile-only affordances (opt into Library).
        get isProfileScope() { return !!this.ownerPersonId; },

        // ── Computed ──────────────────────────────────────────────────────────

        get currentFolder() {
            if (this.currentPath.length === 0) return this.structure;
            return Docs.getFolderById(this.structure, this.currentPath[this.currentPath.length - 1]) || this.structure;
        },

        get currentChildren() {
            const children = this.currentFolder.children || [];
            return [
                ...children.filter(c => c.type === 'folder'),
                ...children.filter(c => c.type === 'document'),
            ];
        },

        // ── Init ──────────────────────────────────────────────────────────────

        async init() {
            if (this.embedded) {
                // Mounted inside an already-authenticated page (the Shepherding
                // Profile). The host owns identity and we read it live; no auth
                // gate and, deliberately, no copy taken here.
                await this.loadData();
                this.watchLibrary();
                this.loading = false;
                return;
            }

            auth.onAuthStateChanged(async (user) => {
                if (!user) { window.location.href = 'login.html'; return; }
                const userData = await getUserData(user.uid);
                const permissionLevel = (userData && (userData.permissionLevel || userData.role)) || 'viewer';
                if (!['elder', 'super_admin'].includes(permissionLevel)) {
                    window.location.href = 'index.html';
                    return;
                }
                this.ownIdentity = {
                    user: user,
                    name: (userData && userData.email) ? userData.email.split('@')[0] : 'Elder',
                    permissionLevel: permissionLevel,
                };

                // Dev-only privacy screen (shepherding-blur.js).
                ShepherdingBlur.configure({
                    permissionLevel: this.currentPermissionLevel,
                    uid: user.uid,
                    personId: userData && userData.personId,
                });

                await this.loadData();
                this.watchLibrary();

                const params = new URLSearchParams(window.location.search);
                const folderId = params.get('folder');
                if (folderId) {
                    const path = Docs.findPathToFolder(this.structure, folderId);
                    if (path) this.currentPath = path;
                }

                this.loading = false;
            });
        },

        async loadData() {
            try {
                const reads = [
                    db.collection('elder_document_structure').doc(this.structureDocId).get(),
                    db.collection('elder_documents').orderBy('createdAt', 'desc').get(),
                ];
                // The care-list picker (views/tags) only exists on the global
                // Library — a Care List is a list over the whole directory and
                // has no meaning scoped to one person, so a profile tab does
                // not offer one and does not pay for the reads.
                if (!this.isProfileScope) {
                    reads.push(db.collection('shepherding_views').orderBy('title', 'asc').get());
                    reads.push(db.collection('people_tags').orderBy('name', 'asc').get());
                }
                // Form Templates BOTH places (MS-405). A Form Document is an
                // interview about somebody, and the profile tab is where an
                // elder is already standing when they want one. On its own
                // rather than in the list above, so a library that cannot reach
                // the templates is still a working library — see
                // loadFormTemplates.
                this.loadFormTemplates();
                const [structSnap, docsSnap, viewsSnap, tagsSnap] = await Promise.all(reads);

                if (structSnap.exists) {
                    const data = structSnap.data();
                    this.structure = data && data.children ? data : { children: [] };
                } else {
                    this.structure = { children: [] };
                }

                this.allDocs = {};
                docsSnap.docs.forEach(doc => {
                    this.allDocs[doc.id] = { id: doc.id, ...doc.data() };
                });

                if (viewsSnap) this.views = viewsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                if (tagsSnap) this.shepherdingTags = tagsSnap.docs.map(doc => ({
                    id: doc.id,
                    name: doc.data().name || doc.id
                }));
            } catch (e) {
                console.error('Error loading data:', e);
                this.showToast('Error loading documents', 'error');
            }
        },

        // ── Live (MS-496) ─────────────────────────────────────────────────────
        //
        // After the first load, the tree, the documents and (on the Library) the
        // Filtered Views and tags are followed while the page is open, so a
        // folder or document another elder makes, renames, moves or deletes
        // shows here without reloading.
        //
        // ⚠ A DELIVERY NEVER DISTURBS SOMEBODY MID-ACTION. What the elder is
        // doing — the folder they are in, a rename box, a drag, the move
        // dialog — is held apart from the delivered data and survives it. Only
        // when the thing itself has gone does the action close, with a line
        // saying why; a folder that went takes the elder to its nearest parent
        // that is still there.
        watchLibrary() {
            if (typeof MosaicLiveRead === 'undefined') return;
            const Live = MosaicLiveRead;
            const failed = what => e => console.warn('Could not keep ' + what + ' current:', e);
            _libraryWatches.push(Live.watch(
                db.collection('elder_document_structure').doc(this.structureDocId),
                snap => this.adoptTree(snap.exists ? snap.data() : null),
                { fallbackEveryMs: Live.PERSON_EVERY_MS, onError: failed('the folders') }));
            _libraryWatches.push(Live.watch(
                db.collection('elder_documents').orderBy('createdAt', 'desc'),
                snap => {
                    const docs = {};
                    snap.docs.forEach(doc => { docs[doc.id] = { id: doc.id, ...doc.data() }; });
                    this.allDocs = docs;
                },
                { fallbackEveryMs: Live.ROSTER_EVERY_MS, onError: failed('the documents') }));
            if (!this.isProfileScope) {
                _libraryWatches.push(Live.watch(
                    db.collection('shepherding_views').orderBy('title', 'asc'),
                    snap => { this.views = snap.docs.map(doc => ({ id: doc.id, ...doc.data() })); },
                    { fallbackEveryMs: Live.ROSTER_EVERY_MS, onError: failed('the Filtered Views') }));
                _libraryWatches.push(Live.watch(
                    db.collection('people_tags').orderBy('name', 'asc'),
                    snap => { this.shepherdingTags = snap.docs.map(doc => ({ id: doc.id, name: doc.data().name || doc.id })); },
                    { fallbackEveryMs: Live.ROSTER_EVERY_MS, onError: failed('the tags') }));
            }
            window.addEventListener('pagehide', stopLibraryWatches);
        },

        adoptTree(data) {
            const tree = (data && Array.isArray(data.children))
                ? JSON.parse(JSON.stringify({ children: data.children })) : { children: [] };
            // This page's own changes still on their way stay on screen.
            this.pendingTree.forEach(change => { try { Docs.applyTreeChange(tree, change); } catch (e) {} });
            this.structure = tree;
            this.keepPlaceIn(tree);
        },

        keepPlaceIn(tree) {
            // The folder the elder is in, as far down as it still exists.
            let depth = 0;
            while (depth < this.currentPath.length && Docs.getFolderById(tree, this.currentPath[depth])) depth += 1;
            if (depth < this.currentPath.length) {
                this.currentPath = this.currentPath.slice(0, depth);
                this.renamingItemId = null;
                this.showToast('That folder was deleted, so you are in the nearest one still here.', 'error');
            }
            const gone = id => id && !Docs.findItemById(tree, id);
            if (this.renamingItemId && gone(this.renamingItemId)) {
                this.renamingItemId = null;
                this.showToast('What you were renaming was just removed by somebody else.', 'error');
            }
            if (this.draggedItem && gone(this.draggedItem.id)) {
                this.draggedItem = null;
                this.dragOverFolderId = null;
            }
            if (this.movingItem && gone(this.movingItem.id)) {
                this.movingItem = null;
                this.showMoveModal = false;
                this.showToast('What you were moving was just removed by somebody else.', 'error');
            }
        },

        // ── One change to the tree (MS-493) ───────────────────────────────────
        //
        // Applied here at once, so the click shows, and sent to the server as
        // ONE change for it to apply to the latest tree. Never the whole tree:
        // two elders filing at the same moment each wrote back the tree from
        // before the other's change, and one of them silently vanished.
        async changeTree(change) {
            const local = Docs.applyTreeChange(this.structure, change);
            if (local.refused) {
                this.showToast(local.refused, 'error');
                return false;
            }
            this.pendingTree.push(change);
            try {
                await DocumentTree.change(this.structureDocId, change);
                return true;
            } catch (e) {
                console.error('Error changing the folders:', e);
                this.showToast((e && e.message) || 'That did not save', 'error');
                await this.reloadTree();
                return false;
            } finally {
                this.pendingTree = this.pendingTree.filter(c => c !== change);
            }
        },

        // The tree as the server has it, when a change of ours was refused and
        // no delivery would put the screen right.
        async reloadTree() {
            try {
                const snap = await db.collection('elder_document_structure').doc(this.structureDocId).get();
                this.adoptTree(snap.exists ? snap.data() : null);
            } catch (e) {
                console.error('Error reloading the folders:', e);
            }
        },

        get currentFolderId() {
            return this.currentPath.length ? this.currentPath[this.currentPath.length - 1] : Docs.ROOT;
        },

        // ── Custom Filter Helpers ─────────────────────────────────────────────

        toggleCustomFilterTag(tagId) {
            const idx = this.customFilter.filterTags.indexOf(tagId);
            if (idx === -1) {
                this.customFilter.filterTags.push(tagId);
            } else {
                this.customFilter.filterTags.splice(idx, 1);
            }
        },

        toggleCustomFilterZone(urg, imp) {
            const key = `${urg}__${imp}`;
            const idx = this.customFilter.statusZoneFilters.indexOf(key);
            if (idx === -1) {
                this.customFilter.statusZoneFilters = [...this.customFilter.statusZoneFilters, key];
            } else {
                this.customFilter.statusZoneFilters = this.customFilter.statusZoneFilters.filter(z => z !== key);
            }
        },

        isCustomZoneSelected(urg, imp) {
            return this.customFilter.statusZoneFilters.includes(`${urg}__${imp}`);
        },

        customZoneCellColor(urg, imp) {
            return ShepherdingCore.statusCellColor(urg, imp);
        },

        // ── Navigation ────────────────────────────────────────────────────────

        navigateInto(folderId) {
            this.renamingItemId = null;
            this.currentPath.push(folderId);
        },

        navigateToIndex(idx) {
            this.renamingItemId = null;
            this.currentPath = this.currentPath.slice(0, idx);
        },

        navigateToRoot() {
            this.renamingItemId = null;
            this.currentPath = [];
        },

        // ── Tree Helpers (delegate to ShepherdingDocsCore) ────────────────────

        getFolderById(id) { return Docs.getFolderById(this.structure, id); },

        getDocTitle(id) {
            return this.allDocs[id]?.title || 'Untitled Document';
        },

        // Dev-only blur class for a directory item.
        docItemBlurClass(item) {
            if (!item || item.type === 'folder') return '';
            return ShepherdingBlur.contentClass(this.allDocs[item.id]?.authorUid);
        },

        getDocType(id) {
            return this.allDocs[id]?.docType || 'note';
        },

        getDocCreated(id) {
            const doc = this.allDocs[id];
            if (!doc) return '';
            const ts = doc.createdAt;
            const dateStr = ts
                ? (ts.toDate ? ts.toDate() : new Date(ts)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                : '';
            const author = doc.authorName || '';
            if (dateStr && author) return `${dateStr} · ${author}`;
            return dateStr || author;
        },

        getDocEdited(id) {
            const doc = this.allDocs[id];
            if (!doc) return '';
            const ts = doc.updatedAt;
            const dateStr = ts
                ? (ts.toDate ? ts.toDate() : new Date(ts)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                : '';
            const editor = doc.updatedByName || '';
            if (dateStr && editor) return `${dateStr} · ${editor}`;
            return dateStr || editor;
        },

        // True if this document (in the current tree) is also referenced by the
        // global Library — i.e. it has been opted in. Profile scope only.
        isInLibrary(docId) {
            return !!this.allDocs[docId] && (this.allDocs[docId].inLibrary === true);
        },

        // ── Create ────────────────────────────────────────────────────────────

        // What a New Document can be, here. A Care List is a list over the
        // whole directory, so it is not one of the answers on somebody's own
        // profile; a Form Document is, and that is the point of MS-405.
        get creatableTypes() {
            return this.isProfileScope ? ['note', 'form'] : ['note', 'care-list', 'form'];
        },

        docTypeLabel(type) {
            return { note: 'Note', 'care-list': 'Care List', form: 'Form' }[type] || 'Note';
        },

        openCreateModal() {
            this.createDocType = 'note';
            this.createFilterMode = 'preset';
            this.customFilter = { filterTags: [], filterMode: 'any', statusZoneFilters: [] };
            this.selectedViewId = this.views.length > 0 ? this.views[0].id : null;
            this.showCreateModal = true;
        },

        // Who is writing, resolved at the moment of use rather than trusted from
        // mount time — with the live auth session as a last resort, which is what
        // the mobile port does (MS-283). Belt and braces on top of the live identity
        // read. Both halves fall back together: a uid rescued on its own is no use,
        // because the builder refuses a document with no author name just as firmly.
        get author() {
            return Docs.resolveAuthor(
                this.identity,
                typeof auth !== 'undefined' ? auth.currentUser : null);
        },

        // The Form Templates that make documents (MS-385). Only
        // `document`-mode ones: a `responses` template has a link and a
        // Responses tab and belongs nowhere near this menu.
        //
        // Read once when the page loads, and quietly: a library that cannot
        // reach the templates is still a working library, so a failure here
        // leaves the menu offering a blank document rather than taking the
        // page down.
        async loadFormTemplates() {
            try {
                const snap = await db.collection('forms').get();
                this.formTemplates = snap.docs
                    .map(d => Object.assign({ id: d.id }, d.data()))
                    .filter(f => f.mode === 'document')
                    .sort((a, b) => String(a.title).localeCompare(String(b.title)));
            } catch (e) {
                this.formTemplates = [];
            }
        },

        get chosenTemplate() {
            return this.formTemplates.find(t => t.id === this.createTemplateId) || null;
        },

        async createDocument() {
            this.showCreateModal = false;
            // A type this surface does not offer is not a type it writes, even
            // if something set it — the profile tab has no Care List.
            const type = this.creatableTypes.includes(this.createDocType)
                ? this.createDocType : 'note';
            const template = type === 'form' ? this.chosenTemplate : null;
            // A form document is named for the template it came from, which is
            // what somebody will look for in a folder later. Renaming it
            // afterwards is the same inline rename as any other document.
            const title = type === 'care-list' ? 'New Care List'
                : (template ? template.title : 'New Document');
            // A personal shepherding document (MS-405) is in BOTH places by
            // construction — the Library and the person's own profile — so
            // whichever surface it was started from, the other one gets it too.
            // Started from somebody's profile, the first question is already
            // answered with them; started from the Library, nobody is named yet
            // and the document files itself when the picker is answered.
            const shepherding = !!(template && template.shepherdingDoc);
            const subject = (shepherding && this.ownerPersonId)
                ? { personId: this.ownerPersonId, name: this.ownerPersonName || '' }
                : null;

            try {
                const preset = this.createFilterMode === 'preset';
                const docData = Docs.buildElderDocument({
                    title: title,
                    docType: type,
                    author: this.author,
                    timestamp: firebase.firestore.FieldValue.serverTimestamp(),
                    ownerPersonId: this.ownerPersonId,
                    filterId: preset ? this.selectedViewId : null,
                    filterConfig: preset ? null : this.customFilter, // the builder copies it
                    templateId: template ? template.id : null,
                    // ⚠ Copied here and never read from the template again
                    // (ADR-0055). Editing the template later must not reach
                    // back into an interview already filled in.
                    questions: template ? template.questions : null,
                    shepherdingDoc: shepherding,
                    answers: subject ? { [FormsCore.SUBJECT_QUESTION_ID]: subject } : null,
                    inLibrary: shepherding ? true : null,
                });

                const docRef = await db.collection('elder_documents').add(docData);
                this.allDocs[docRef.id] = {
                    id: docRef.id, title: title, docType: type, authorName: docData.authorName,
                    ownerPersonId: this.ownerPersonId || null,
                    inLibrary: shepherding ? true : false,
                };

                await this.changeTree({ op: 'file', docId: docRef.id, folderId: this.currentFolderId });

                // The other half of "both places". Only when it was started on
                // a profile: from the Library there is nobody to file it under
                // yet. Best-effort — a document that failed to reach the
                // Library is still a document on the profile, and the button
                // that adds it by hand is still there.
                if (shepherding && this.isProfileScope) {
                    try {
                        await this.alsoFileInLibrary(docRef.id);
                    } catch (e) {
                        console.error('Error filing in the Library:', e);
                    }
                }

                this.renamingItemId = docRef.id;
                this.renameValue = title;
                this.$nextTick(() => {
                    const el = document.getElementById(`rename-${docRef.id}`);
                    if (el) { el.focus(); el.select(); }
                });
            } catch (e) {
                console.error('Error creating document:', e);
                this.showToast(this.createFailureMessage(e), 'error');
            }
        },

        // What an Elder is told when a create fails. "Error creating document" was
        // the same six words for every cause, and the real error only ever reached
        // the console — which is how a ten-second bug became an undiagnosable demo
        // failure (MS-283). The underlying error is still logged in every case.
        createFailureMessage(e) {
            if (e && e.code === Docs.MISSING_AUTHOR) {
                return 'Could not tell who is signed in, so nothing was created. Reload the page and try again.';
            }
            if (e && e.code === PERMISSION_DENIED) {
                return 'You do not have permission to create a document here.';
            }
            return 'Something went wrong creating the document. The details are in the browser console.';
        },

        async createFolder() {
            const folderId = Docs.newId();
            const made = this.changeTree({ op: 'createFolder', parentId: this.currentFolderId, folderId, name: 'New Folder' });

            this.renamingItemId = folderId;
            this.renameValue = 'New Folder';
            this.$nextTick(() => {
                const el = document.getElementById(`rename-${folderId}`);
                if (el) { el.focus(); el.select(); }
            });
            await made;
        },

        // ── Rename ────────────────────────────────────────────────────────────

        startRename(item) {
            this.renameValue = item.type === 'folder' ? item.name : this.getDocTitle(item.id);
            this.renamingItemId = item.id;
            this.$nextTick(() => {
                const el = document.getElementById(`rename-${item.id}`);
                if (el) { el.focus(); el.select(); }
            });
        },

        async finishRename(item) {
            if (this.renamingItemId !== item.id) return;
            const newName = this.renameValue.trim() || (item.type === 'folder' ? 'New Folder' : 'New Document');
            this.renamingItemId = null;
            try {
                if (item.type === 'folder') {
                    await this.changeTree({ op: 'renameFolder', folderId: item.id, name: newName });
                } else {
                    if (this.allDocs[item.id]) this.allDocs[item.id].title = newName;
                    await db.collection('elder_documents').doc(item.id).update({
                        title: newName,
                        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                        updatedByName: this.author.name,
                    });
                }
            } catch (e) {
                console.error('Error renaming:', e);
                this.showToast('Error renaming', 'error');
            }
        },

        // ── Delete ────────────────────────────────────────────────────────────

        confirmDelete(item) {
            this.deletingItem = item;
            if (item.type === 'folder') {
                const folder = Docs.getFolderById(this.structure, item.id);
                this.deleteDocCount = folder ? Docs.getAllDocIds(folder).length : 0;
                this.deleteFolderName = item.name;
            } else {
                this.deleteDocCount = 1;
                this.deleteFolderName = '';
            }
            this.showDeleteConfirm = true;
        },

        async executeDelete() {
            if (!this.deletingItem) return;
            this.showDeleteConfirm = false;
            const item = this.deletingItem;
            this.deletingItem = null;
            try {
                // Which document records this removal touches.
                let docIds = [];
                if (item.type === 'document') {
                    docIds = [item.id];
                } else {
                    const folder = Docs.getFolderById(this.structure, item.id);
                    if (folder) docIds = Docs.getAllDocIds(folder);
                }

                // MS-98 delete reconciliation, the same rule the phone uses: a
                // document held by two trees is not destroyed when it leaves one
                // (ShepherdingDocsCore.removalPlan).
                const plan = Docs.removalPlan(docIds, this.allDocs, this.isProfileScope);
                const toHardDelete = plan.destroy;
                const toPruneFromLibrary = plan.pruneFromLibrary;
                const toOptOut = plan.optOut;

                await Promise.all(toHardDelete.map(id => db.collection('elder_documents').doc(id).delete()));
                toHardDelete.forEach(id => delete this.allDocs[id]);
                await Promise.all(toOptOut.map(id =>
                    db.collection('elder_documents').doc(id).update({ inLibrary: false })));
                toOptOut.forEach(id => { if (this.allDocs[id]) this.allDocs[id].inLibrary = false; });

                await this.changeTree({ op: 'remove', itemId: item.id });

                if (toPruneFromLibrary.length) await this.pruneFromLibraryRoot(toPruneFromLibrary);

                this.showToast('Deleted successfully');
            } catch (e) {
                console.error('Error deleting:', e);
                this.showToast('Error deleting', 'error');
            }
        },

        // Remove document nodes from the global Library root tree (used when a
        // profile deletes docs that had been opted in). Profile scope only.
        async pruneFromLibraryRoot(docIds) {
            try {
                await DocumentTree.change(Docs.LIBRARY_TREE, { op: 'prune', docIds });
            } catch (e) {
                console.error('Error pruning from Library root:', e);
            }
        },

        // ── Opt into / out of the global Library (profile scope, MS-98) ────────

        openLibraryDialog(item) {
            if (item.type !== 'document') return;
            this.libraryItem = item;
            this.libraryTargetId = '__root__';
            this.showLibraryModal = true;
        },

        // Surface this profile document in the global Library by referencing the
        // same record from the Library root tree (no copy). It stays on the profile.
        async confirmAddToLibrary() {
            if (!this.libraryItem) return;
            this.showLibraryModal = false;
            const docId = this.libraryItem.id;
            const targetId = this.libraryTargetId;
            this.libraryItem = null;
            try {
                const out = await DocumentTree.change(Docs.LIBRARY_TREE, { op: 'file', docId, folderId: targetId });
                if (!out.changed) { this.showToast('Already in the Library'); return; }
                await db.collection('elder_documents').doc(docId).update({ inLibrary: true });
                if (this.allDocs[docId]) this.allDocs[docId].inLibrary = true;
                this.showToast('Added to the Library');
            } catch (e) {
                console.error('Error adding to Library:', e);
                this.showToast('Error adding to Library', 'error');
            }
        },

        // Put a document at the top of the Library, if it is not already in it.
        // The same write the opt-in dialog makes, without the dialog: a
        // shepherding document is in both places by construction and has
        // nothing to opt into.
        async alsoFileInLibrary(docId) {
            await DocumentTree.change(Docs.LIBRARY_TREE, { op: 'file', docId, folderId: Docs.ROOT });
        },

        // The Library folder choices for the opt-in dialog.
        async loadLibraryFolderOptions() {
            try {
                const snap = await db.collection('elder_document_structure').doc('root').get();
                const rootStruct = snap.exists && snap.data().children ? snap.data() : { children: [] };
                this.libraryFolderOptions = Docs.getFolderOptions(rootStruct);
            } catch (e) {
                this.libraryFolderOptions = [];
            }
        },

        // ── Open Document ─────────────────────────────────────────────────────

        openDocument(docId) {
            const doc = this.allDocs[docId];
            const isCareList = doc && doc.docType === 'care-list';
            // A Form Document opens on its own page, the way a Care List does.
            // Not a branch inside the prose editor: what it draws is a form, and
            // a 1,500-line editor gaining a second mode is how both get harder
            // to change (MS-386).
            const isForm = doc && doc.docType === 'form';
            if (isForm) {
                // The same page in the shell on a phone rather than a native
                // port, so there is one Form Document editor to keep in step
                // with the model.
                const shell = window.MOSAIC_SHELL === 'mobile' ? '&shell=mobile' : '';
                window.location.href = `shepherding-form-document.html?id=${encodeURIComponent(docId)}${shell}`;
            } else if (window.MOSAIC_SHELL === 'mobile') {
                const route = isCareList ? 'careList' : 'documentEditor';
                window.location.href = `mobile.html#/${route}?id=${encodeURIComponent(docId)}`;
            } else if (isCareList) {
                window.location.href = `shepherding-care-list.html?id=${docId}`;
            } else {
                // MS-98: opened from a profile Documents tab → back returns to that profile.
                const suffix = this.isProfileScope
                    ? `&from=profile&personId=${encodeURIComponent(this.ownerPersonId)}` : '';
                window.location.href = `shepherding-document.html?id=${docId}${suffix}`;
            }
        },

        handleItemDblClick(item) {
            if (item.type === 'folder') {
                this.navigateInto(item.id);
            } else {
                this.openDocument(item.id);
            }
        },

        // ── Drag and Drop ─────────────────────────────────────────────────────

        onDragStart(item, event) {
            this.draggedItem = { ...item };
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', item.id);
        },

        onDragOver(targetFolder, event) {
            if (!this.draggedItem) return;
            if (this.draggedItem.id === targetFolder.id) return;
            if (this.draggedItem.type === 'folder' && Docs.isDescendant(this.structure, targetFolder.id, this.draggedItem.id)) return;
            event.preventDefault();
            this.dragOverFolderId = targetFolder.id;
        },

        onDragLeave(event) {
            if (!event.currentTarget.contains(event.relatedTarget)) {
                this.dragOverFolderId = null;
            }
        },

        onDrop(targetFolder, event) {
            event.preventDefault();
            event.stopPropagation();
            this.dragOverFolderId = null;
            if (!this.draggedItem) return;
            if (this.draggedItem.id === targetFolder.id) { this.draggedItem = null; return; }
            if (this.draggedItem.type === 'folder' && Docs.isDescendant(this.structure, targetFolder.id, this.draggedItem.id)) {
                this.draggedItem = null; return;
            }
            const item = this.draggedItem;
            this.draggedItem = null;
            this.moveItem(item, targetFolder.id);
        },

        onDropAtRoot(event) {
            event.preventDefault();
            this.dragOverFolderId = null;
            if (!this.draggedItem) return;
            const item = this.draggedItem;
            this.draggedItem = null;
            const parent = Docs.findParent(this.structure, item.id);
            if (parent === this.structure || !parent) return; // already at root
            this.moveItem(item, '__root__');
        },

        // ── Move ──────────────────────────────────────────────────────────────

        async moveItem(item, targetFolderId) {
            await this.changeTree({ op: 'move', item: { type: item.type, id: item.id }, targetFolderId });
        },

        openMoveDialog(item) {
            this.movingItem = item;
            this.moveTargetId = '__root__';
            this.showMoveModal = true;
        },

        // Signature kept as (node, depth, excludeId) for the existing Library
        // move-modal markup; node/depth are always the defaults from the template.
        getFolderOptions(_node = null, _depth = 0, excludeId = null) {
            return Docs.getFolderOptions(this.structure, excludeId);
        },

        async confirmMove() {
            if (!this.movingItem) return;
            this.showMoveModal = false;
            const item = this.movingItem;
            const targetId = this.moveTargetId;
            this.movingItem = null;

            if (item.type === 'folder' && targetId !== '__root__') {
                if (targetId === item.id || Docs.isDescendant(this.structure, targetId, item.id)) {
                    this.showToast('Cannot move a folder into itself', 'error');
                    return;
                }
            }
            await this.moveItem(item, targetId);
        },

        // ── Toast ─────────────────────────────────────────────────────────────

        showToast(message, type = 'success') {
            this.toast = { show: true, message, type };
            setTimeout(() => { this.toast.show = false; }, 3000);
        },
    }));
});
