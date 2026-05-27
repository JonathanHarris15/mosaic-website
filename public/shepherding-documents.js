function genId() {
    return typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2) + Date.now().toString(36);
}

document.addEventListener('alpine:init', () => {
    Alpine.data('documentLibrary', () => ({
        loading: true,
        currentUser: null,
        currentUserRole: null,
        currentUserName: '',

        structure: { children: [] },
        allDocs: {},

        currentPath: [],

        renamingItemId: null,
        renameValue: '',

        draggedItem: null,
        dragOverFolderId: null,

        showMoveModal: false,
        movingItem: null,
        moveTargetId: '__root__',

        showDeleteConfirm: false,
        deletingItem: null,
        deleteDocCount: 0,
        deleteFolderName: '',

        toast: { show: false, message: '', type: 'success' },

        // ── Computed ──────────────────────────────────────────────────────────

        get currentFolder() {
            if (this.currentPath.length === 0) return this.structure;
            return this.getFolderById(this.currentPath[this.currentPath.length - 1]) || this.structure;
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
            auth.onAuthStateChanged(async (user) => {
                if (!user) { window.location.href = 'login.html'; return; }
                const userData = await getUserData(user.uid);
                this.currentUserRole = (userData && userData.role) || 'viewer';
                if (!['elder', 'super_admin'].includes(this.currentUserRole)) {
                    window.location.href = 'index.html';
                    return;
                }
                this.currentUser = user;
                this.currentUserName = (userData && userData.email)
                    ? userData.email.split('@')[0] : 'Elder';

                await this.loadData();

                const params = new URLSearchParams(window.location.search);
                const folderId = params.get('folder');
                if (folderId) {
                    const path = this.findPathToFolder(folderId, this.structure, []);
                    if (path) this.currentPath = path;
                }

                this.loading = false;
            });
        },

        async loadData() {
            try {
                const [structSnap, docsSnap] = await Promise.all([
                    db.collection('elder_document_structure').doc('root').get(),
                    db.collection('elder_documents').orderBy('createdAt', 'desc').get(),
                ]);

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
            } catch (e) {
                console.error('Error loading data:', e);
                this.showToast('Error loading documents', 'error');
            }
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

        findPathToFolder(targetId, node, path) {
            for (const child of (node.children || [])) {
                if (child.type === 'folder') {
                    if (child.id === targetId) return [...path, child.id];
                    const found = this.findPathToFolder(targetId, child, [...path, child.id]);
                    if (found) return found;
                }
            }
            return null;
        },

        // ── Tree Helpers ──────────────────────────────────────────────────────

        getFolderById(id, node = null) {
            const root = node || this.structure;
            for (const child of (root.children || [])) {
                if (child.type === 'folder') {
                    if (child.id === id) return child;
                    const found = this.getFolderById(id, child);
                    if (found) return found;
                }
            }
            return null;
        },

        getDocTitle(id) {
            return this.allDocs[id]?.title || 'Untitled Document';
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

        findParent(targetId, node = null) {
            const root = node || this.structure;
            for (const child of (root.children || [])) {
                if (child.id === targetId) return root;
                if (child.type === 'folder') {
                    const found = this.findParent(targetId, child);
                    if (found) return found;
                }
            }
            return null;
        },

        getAllDocIds(node) {
            const ids = [];
            for (const child of (node.children || [])) {
                if (child.type === 'document') ids.push(child.id);
                else if (child.type === 'folder') ids.push(...this.getAllDocIds(child));
            }
            return ids;
        },

        removeFromTree(targetId, node = null) {
            const root = node || this.structure;
            const idx = (root.children || []).findIndex(c => c.id === targetId);
            if (idx !== -1) { root.children.splice(idx, 1); return true; }
            for (const child of (root.children || [])) {
                if (child.type === 'folder' && this.removeFromTree(targetId, child)) return true;
            }
            return false;
        },

        isDescendant(potentialDescendantId, ancestorId) {
            const ancestor = this.getFolderById(ancestorId);
            if (!ancestor) return false;
            return this.getFolderById(potentialDescendantId, ancestor) !== null;
        },

        async saveStructure() {
            const plain = JSON.parse(JSON.stringify(this.structure));
            await db.collection('elder_document_structure').doc('root').set(plain);
            this.structure = plain;
        },

        // ── Create ────────────────────────────────────────────────────────────

        async createDocument() {
            try {
                const docRef = await db.collection('elder_documents').add({
                    title: 'New Document',
                    contentJson: null,
                    authorName: this.currentUserName,
                    authorUid: this.currentUser.uid,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                    updatedByName: this.currentUserName,
                });
                this.allDocs[docRef.id] = { id: docRef.id, title: 'New Document', authorName: this.currentUserName };

                const currentFolder = this.currentFolder;
                if (!currentFolder.children) currentFolder.children = [];
                currentFolder.children.push({ type: 'document', id: docRef.id });
                await this.saveStructure();

                this.renamingItemId = docRef.id;
                this.renameValue = 'New Document';
                this.$nextTick(() => {
                    const el = document.getElementById(`rename-${docRef.id}`);
                    if (el) { el.focus(); el.select(); }
                });
            } catch (e) {
                console.error('Error creating document:', e);
                this.showToast('Error creating document', 'error');
            }
        },

        async createFolder() {
            const folderId = genId();
            const currentFolder = this.currentFolder;
            if (!currentFolder.children) currentFolder.children = [];
            currentFolder.children.unshift({ type: 'folder', id: folderId, name: 'New Folder', children: [] });
            await this.saveStructure();

            this.renamingItemId = folderId;
            this.renameValue = 'New Folder';
            this.$nextTick(() => {
                const el = document.getElementById(`rename-${folderId}`);
                if (el) { el.focus(); el.select(); }
            });
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
                    const folder = this.getFolderById(item.id);
                    if (folder) folder.name = newName;
                    await this.saveStructure();
                } else {
                    if (this.allDocs[item.id]) this.allDocs[item.id].title = newName;
                    await db.collection('elder_documents').doc(item.id).update({
                        title: newName,
                        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                        updatedByName: this.currentUserName,
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
                const folder = this.getFolderById(item.id);
                this.deleteDocCount = folder ? this.getAllDocIds(folder).length : 0;
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
                if (item.type === 'document') {
                    await db.collection('elder_documents').doc(item.id).delete();
                    delete this.allDocs[item.id];
                } else {
                    const folder = this.getFolderById(item.id);
                    if (folder) {
                        const docIds = this.getAllDocIds(folder);
                        await Promise.all(docIds.map(id => db.collection('elder_documents').doc(id).delete()));
                        docIds.forEach(id => delete this.allDocs[id]);
                    }
                }
                this.removeFromTree(item.id);
                await this.saveStructure();
                this.showToast('Deleted successfully');
            } catch (e) {
                console.error('Error deleting:', e);
                this.showToast('Error deleting', 'error');
            }
        },

        // ── Open Document ─────────────────────────────────────────────────────

        openDocument(docId) {
            window.location.href = `shepherding-document.html?id=${docId}`;
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
            if (this.draggedItem.type === 'folder' && this.isDescendant(targetFolder.id, this.draggedItem.id)) return;
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
            if (this.draggedItem.type === 'folder' && this.isDescendant(targetFolder.id, this.draggedItem.id)) {
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
            const parent = this.findParent(item.id);
            if (parent === this.structure || !parent) return; // already at root
            this.moveItem(item, '__root__');
        },

        // ── Move ──────────────────────────────────────────────────────────────

        async moveItem(item, targetFolderId) {
            const itemInTree = item.type === 'folder'
                ? this.getFolderById(item.id)
                : this.currentChildren.find(c => c.id === item.id) || this.findItemById(item.id);

            this.removeFromTree(item.id);

            let targetNode;
            if (targetFolderId === '__root__') {
                targetNode = this.structure;
            } else {
                targetNode = this.getFolderById(targetFolderId);
            }
            if (!targetNode) { await this.loadData(); return; }
            if (!targetNode.children) targetNode.children = [];

            const snapshot = item.type === 'folder'
                ? (itemInTree || item)
                : { type: 'document', id: item.id };
            targetNode.children.push(snapshot);

            try {
                await this.saveStructure();
            } catch (e) {
                console.error('Error moving:', e);
                this.showToast('Error moving item', 'error');
                await this.loadData();
            }
        },

        findItemById(id, node = null) {
            const root = node || this.structure;
            for (const child of (root.children || [])) {
                if (child.id === id) return child;
                if (child.type === 'folder') {
                    const found = this.findItemById(id, child);
                    if (found) return found;
                }
            }
            return null;
        },

        openMoveDialog(item) {
            this.movingItem = item;
            this.moveTargetId = '__root__';
            this.showMoveModal = true;
        },

        getFolderOptions(node = null, depth = 0, excludeId = null) {
            const root = node || this.structure;
            const options = [];
            for (const child of (root.children || [])) {
                if (child.type === 'folder' && child.id !== excludeId) {
                    options.push({ id: child.id, name: child.name, depth });
                    options.push(...this.getFolderOptions(child, depth + 1, excludeId));
                }
            }
            return options;
        },

        async confirmMove() {
            if (!this.movingItem) return;
            this.showMoveModal = false;
            const item = this.movingItem;
            const targetId = this.moveTargetId;
            this.movingItem = null;

            if (item.type === 'folder' && targetId !== '__root__') {
                if (targetId === item.id || this.isDescendant(targetId, item.id)) {
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
