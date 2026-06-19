// ── Mention data ──────────────────────────────────────────────────────────────
let _mentionPeople = [];
let _mentionNotes = [];
let _mentionDocs = [];
let _mentionFolders = [];
let _mentionDataLoaded = false;
let _peopleList = [];

function collectFolders(node, out) {
    for (const child of (node.children || [])) {
        if (child.type === 'folder') {
            out.push({ id: JSON.stringify({ kind: 'elder_folder', id: child.id }), label: child.name });
            collectFolders(child, out);
        }
    }
}

async function loadDocMentionData() {
    if (_mentionDataLoaded) return;
    try {
        const [peopleResult, docsResult, notesResult, structResult] = await Promise.allSettled([
            db.collection('people').orderBy('name', 'asc').get(),
            db.collection('elder_documents').get(),
            db.collectionGroup('shepherding_notes').orderBy('createdAt', 'desc').get(),
            db.collection('elder_document_structure').doc('root').get(),
        ]);

        const personMap = {};
        if (peopleResult.status === 'fulfilled') {
            _mentionPeople = peopleResult.value.docs.map(doc => {
                const name = doc.data().name || doc.id;
                personMap[doc.id] = name;
                _peopleList.push({ id: doc.id, name });
                return { id: JSON.stringify({ kind: 'person', id: doc.id }), label: name };
            });
        }

        if (docsResult.status === 'fulfilled') {
            _mentionDocs = docsResult.value.docs.map(doc => {
                const d = doc.data();
                return { id: JSON.stringify({ kind: 'elder_document', id: doc.id }), label: d.title || 'Untitled Document' };
            });
        }

        if (notesResult.status === 'fulfilled') {
            _mentionNotes = notesResult.value.docs.map(doc => {
                const d = doc.data();
                const personId = doc.ref.parent.parent.id;
                const personName = personMap[personId] || '';
                const label = d.subject || `${d.type || 'Note'}${personName ? ' – ' + personName : ''}`;
                return { id: JSON.stringify({ kind: 'note', id: doc.id, personId }), label };
            });
        }

        if (structResult.status === 'fulfilled' && structResult.value.exists) {
            _mentionFolders = [];
            collectFolders(structResult.value.data(), _mentionFolders);
        }

        _mentionDataLoaded = true;
    } catch (e) {
        console.error('Error loading mention data:', e);
    }
}

function createDocMentionSuggestion() {
    return {
        items({ query }) {
            const q = query.toLowerCase();
            const match = arr => arr.filter(i => i.label.toLowerCase().includes(q));
            return [
                ...match(_mentionPeople),
                ...match(_mentionNotes),
                ...match(_mentionDocs),
                ...match(_mentionFolders),
            ].slice(0, 30);
        },
        render() {
            let popup = null;
            let selectedIndex = 0;
            let currentProps = null;

            function getKind(item) {
                try { return JSON.parse(item.id).kind; } catch { return 'unknown'; }
            }

            function buildGrouped(items) {
                const groups = { person: [], note: [], elder_document: [], elder_folder: [] };
                items.forEach(item => { const k = getKind(item); (groups[k] || groups.elder_document).push(item); });
                const out = [];
                if (groups.person.length)        { out.push({ _hdr: 'People' });    out.push(...groups.person); }
                if (groups.note.length)          { out.push({ _hdr: 'Notes' });     out.push(...groups.note); }
                if (groups.elder_document.length){ out.push({ _hdr: 'Documents' }); out.push(...groups.elder_document); }
                if (groups.elder_folder.length)  { out.push({ _hdr: 'Folders' });   out.push(...groups.elder_folder); }
                return out;
            }

            function redraw(items, rect, selIdx, command) {
                if (!popup) {
                    popup = document.createElement('div');
                    popup.style.cssText = 'position:fixed;z-index:9999;background:#fff;border:1px solid #c5c6d0;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.12);min-width:220px;max-height:280px;overflow-y:auto;padding:4px 0;font-family:"Work Sans",sans-serif;font-size:14px;';
                    document.body.appendChild(popup);
                }
                if (rect) {
                    const r = typeof rect === 'function' ? rect() : rect;
                    if (r) { popup.style.left = `${Math.min(r.left, window.innerWidth - 240)}px`; popup.style.top = `${r.bottom + 4}px`; }
                }
                popup.innerHTML = '';
                if (!items.length) {
                    const el = document.createElement('div');
                    el.style.cssText = 'padding:8px 16px;color:#75777f;font-style:italic;';
                    el.textContent = 'No matches';
                    popup.appendChild(el);
                    return;
                }
                const grouped = buildGrouped(items);
                let si = 0;
                grouped.forEach(entry => {
                    if (entry._hdr) {
                        const el = document.createElement('div');
                        el.style.cssText = 'padding:4px 16px 2px;font-size:11px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:#75777f;';
                        el.textContent = entry._hdr;
                        popup.appendChild(el);
                    } else {
                        const myI = si++;
                        const el = document.createElement('button');
                        el.type = 'button';
                        el.style.cssText = `display:block;width:100%;text-align:left;padding:6px 16px;cursor:pointer;border:none;background:${myI === selIdx ? '#d8e2ff' : 'transparent'};color:${myI === selIdx ? '#001a42' : '#1c1c18'};font-size:14px;font-family:inherit;`;
                        el.textContent = entry.label;
                        el.addEventListener('mousedown', e => { e.preventDefault(); command(entry); });
                        popup.appendChild(el);
                    }
                });
            }

            return {
                onStart(props) { currentProps = props; selectedIndex = 0; redraw(props.items, props.clientRect, selectedIndex, props.command); },
                onUpdate(props) { currentProps = props; selectedIndex = 0; redraw(props.items, props.clientRect, selectedIndex, props.command); },
                onKeyDown({ event }) {
                    if (!currentProps) return false;
                    const total = currentProps.items.length;
                    if (event.key === 'Escape') { popup?.remove(); popup = null; return true; }
                    if (!total) return false;
                    if (event.key === 'ArrowUp')   { selectedIndex = (selectedIndex - 1 + total) % total; redraw(currentProps.items, null, selectedIndex, currentProps.command); return true; }
                    if (event.key === 'ArrowDown') { selectedIndex = (selectedIndex + 1) % total; redraw(currentProps.items, null, selectedIndex, currentProps.command); return true; }
                    if (event.key === 'Enter') { if (currentProps.items[selectedIndex]) currentProps.command(currentProps.items[selectedIndex]); return true; }
                    return false;
                },
                onExit() { popup?.remove(); popup = null; currentProps = null; },
            };
        },
    };
}

document.addEventListener('alpine:init', () => {
    Alpine.data('careListEditor', () => ({
        loading: true,
        currentUser: null,
        currentUserRole: null,
        currentUserName: '',

        docId: null,
        doc: null,
        title: '',
        filterId: null,
        filterTitle: '…',

        people: [],
        filteredPeople: [],
        shepherdingTags: [],

        careListColumns: [],
        editingColumnId: null,
        editingColumnName: '',

        editors: {}, // personId -> { colId -> Editor }
        activePersonId: null,
        activeColId: null,
        editorUpdated: 0,

        saveStatus: 'saved',
        _saveTimer: null,

        toast: { show: false, message: '', type: 'success' },

        async init() {
            const params = new URLSearchParams(window.location.search);
            this.docId = params.get('id');
            if (!this.docId) { window.location.href = 'shepherding-documents.html'; return; }

            auth.onAuthStateChanged(async user => {
                if (!user) { window.location.href = 'login.html'; return; }
                const userData = await getUserData(user.uid);
                this.currentUserRole = (userData && userData.role) || 'viewer';
                if (!['elder', 'super_admin'].includes(this.currentUserRole)) {
                    window.location.href = 'index.html';
                    return;
                }
                this.currentUser = user;
                this.currentUserName = (userData && userData.email) ? userData.email.split('@')[0] : 'Elder';

                await Promise.all([this.loadDoc(), this.loadPeople(), this.loadTags()]);
                this.applyFilter();

                this.loading = false;

                this.$nextTick(() => this.initEditors());
            });
        },

        async loadDoc() {
            try {
                const snap = await db.collection('elder_documents').doc(this.docId).get();
                if (!snap.exists) { window.location.href = 'shepherding-documents.html'; return; }
                this.doc = { id: snap.id, ...snap.data() };
                this.title = this.doc.title || '';
                
                if (this.doc.filterId) {
                    const viewSnap = await db.collection('shepherding_views').doc(this.doc.filterId).get();
                    if (viewSnap.exists) {
                        this.filterTitle = viewSnap.data().title || 'Untitled Filter';
                        this.viewConfig = viewSnap.data();
                    }
                } else if (this.doc.filterConfig) {
                    this.filterTitle = 'Custom Filter';
                    this.viewConfig = this.doc.filterConfig;
                }

                // Process columns — backward compat: old format has no careListColumns
                if (this.doc.careListColumns && this.doc.careListColumns.length > 0) {
                    this.careListColumns = this.doc.careListColumns;
                } else {
                    this.careListColumns = [{ id: 'col_default', name: 'Notes' }];
                    // Migrate careListData: { personId: tiptapJson } → { personId: { col_default: tiptapJson } }
                    if (this.doc.careListData) {
                        const migrated = {};
                        Object.entries(this.doc.careListData).forEach(([pid, val]) => {
                            migrated[pid] = (val && typeof val === 'object' && val.type === 'doc')
                                ? { col_default: val }
                                : (val || {});
                        });
                        this.doc.careListData = migrated;
                    }
                }
            } catch (e) {
                console.error('Error loading document:', e);
                this.showToast('Error loading document', 'error');
            }
        },

        async loadPeople() {
            try {
                const snap = await db.collection('people').get();
                this.people = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            } catch (e) {
                console.error('Error loading people:', e);
            }
        },

        async loadTags() {
            try {
                const snap = await db.collection('people_tags').orderBy('name', 'asc').get();
                this.shepherdingTags = snap.docs.map(doc => ({
                    id: doc.id,
                    name: doc.data().name || doc.id,
                    hidePeople: doc.data().hidePeople || false,
                }));
            } catch (e) {
                console.error('Error loading tags:', e);
            }
        },

        applyFilter() {
            if (!this.viewConfig) {
                this.filteredPeople = this.people;
                return;
            }

            const view = this.viewConfig;
            let result = this.people.filter(p => p.membership?.status !== 'inactive');

            if (view.filterTags && view.filterTags.length > 0) {
                result = result.filter(p => {
                    const personTags = p.tags || [];
                    if (view.filterMode === 'all') {
                        return view.filterTags.every(t => personTags.includes(t));
                    }
                    return view.filterTags.some(t => personTags.includes(t));
                });
            }

            if (view.statusZoneFilters && view.statusZoneFilters.length > 0) {
                result = result.filter(p => {
                    if (!p.shepherdingStatus) return false;
                    const key = `${p.shepherdingStatus.urgency}__${p.shepherdingStatus.importance}`;
                    return view.statusZoneFilters.includes(key);
                });
            }

            this.filteredPeople = result.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        },

        async initEditors() {
            if (!window._TipTap) {
                const [
                    { Editor, Extension, Node, InputRule },
                    { Plugin, PluginKey },
                    { default: StarterKit },
                    { default: Underline },
                    { default: Mention },
                    { default: TextStyle },
                    { default: FontFamily },
                    { default: Highlight },
                    { default: Table },
                    { default: TableRow },
                    { default: TableHeader },
                    { default: TableCell },
                ] = await Promise.all([
                    import('https://esm.sh/@tiptap/core@2'),
                    import('https://esm.sh/prosemirror-state@1'),
                    import('https://esm.sh/@tiptap/starter-kit@2'),
                    import('https://esm.sh/@tiptap/extension-underline@2'),
                    import('https://esm.sh/@tiptap/extension-mention@2'),
                    import('https://esm.sh/@tiptap/extension-text-style@2'),
                    import('https://esm.sh/@tiptap/extension-font-family@2'),
                    import('https://esm.sh/@tiptap/extension-highlight@2'),
                    import('https://esm.sh/@tiptap/extension-table@2'),
                    import('https://esm.sh/@tiptap/extension-table-row@2'),
                    import('https://esm.sh/@tiptap/extension-table-header@2'),
                    import('https://esm.sh/@tiptap/extension-table-cell@2'),
                ]);

                const FontSize = Extension.create({
                    name: 'fontSize',
                    addOptions() { return { types: ['textStyle'] }; },
                    addGlobalAttributes() {
                        return [{ types: this.options.types, attributes: { fontSize: { default: null, parseHTML: el => el.style.fontSize || null, renderHTML: attrs => attrs.fontSize ? { style: `font-size: ${attrs.fontSize}` } : {} } } }];
                    },
                    addCommands() {
                        return {
                            setFontSize:   size => ({ chain }) => chain().setMark('textStyle', { fontSize: size }).run(),
                            unsetFontSize: ()   => ({ chain }) => chain().setMark('textStyle', { fontSize: null }).removeEmptyTextStyle().run(),
                        };
                    },
                });

                window._TipTap = { Editor, Extension, Node, InputRule, Plugin, PluginKey, StarterKit, Underline, Mention, TextStyle, FontFamily, FontSize, Highlight, Table, TableRow, TableHeader, TableCell };
            }

            await loadDocMentionData();

            this.filteredPeople.forEach(person => {
                if (!this.editors[person.id]) this.editors[person.id] = {};
                this.careListColumns.forEach(col => {
                    this._mountCellEditor(person, col.id);
                });
            });
        },

        _makeTriggerExt(person) {
            const self = this;
            return createInlineTriggersExtension({
                personId: person.id,
                getAllTags:      () => self.shepherdingTags,
                getPersonTags:  () => { const p = self.people.find(x => x.id === person.id); return p?.tags || []; },
                getCurrentStatus: () => { const p = self.people.find(x => x.id === person.id); return p?.shepherdingStatus || null; },
                createTag:      (name) => self.createNewTag(name),
                onTagAdd:       (tagId, tagName) => self.handleTagAdd(person.id, tagId, tagName),
                onTagRemove:    (tagId, tagName) => self.handleTagRemove(person.id, tagId, tagName),
                onStatusChange: (urg, imp) => self.handleStatusChange(person.id, urg, imp),
            });
        },

        _mountCellEditor(person, colId) {
            const el = document.getElementById(`editor-${person.id}-${colId}`);
            if (!el || !window._TipTap) return;
            const { Editor, StarterKit, Underline, Mention, TextStyle, FontFamily, FontSize, Highlight, Table, TableRow, TableHeader, TableCell } = window._TipTap;
            const self = this;
            const content = this.doc.careListData?.[person.id]?.[colId] || '';
            if (!this.editors[person.id]) this.editors[person.id] = {};
            this.editors[person.id][colId] = new Editor({
                element: el,
                extensions: [
                    StarterKit, Underline, TextStyle, FontFamily, FontSize,
                    Highlight.configure({ multicolor: true }),
                    Table.configure({ resizable: false }), TableRow, TableHeader, TableCell,
                    Mention.configure({ HTMLAttributes: { class: 'mention-chip' }, suggestion: createDocMentionSuggestion() }),
                    this._makeTriggerExt(person),
                ],
                content,
                onUpdate() { self.editorUpdated++; self.scheduleSave(); },
                onFocus()  { self.activePersonId = person.id; self.activeColId = colId; },
            });
        },

        getActiveEditor() {
            if (!this.activePersonId || !this.activeColId) return null;
            return this.editors[this.activePersonId]?.[this.activeColId] || null;
        },

        isActive(name) {
            const editor = this.getActiveEditor();
            return editor ? editor.isActive(name) : false;
        },

        editorCmd(command, ...args) {
            const editor = this.getActiveEditor();
            if (!editor) return;
            
            if (command === 'setFontFamily') {
                const family = args[0];
                family ? editor.chain().focus().setFontFamily(family).run()
                       : editor.chain().focus().unsetFontFamily().run();
            } else if (command === 'setFontSize') {
                const size = args[0];
                size ? editor.chain().focus().setFontSize(size).run()
                     : editor.chain().focus().unsetFontSize().run();
            } else if (command === 'setHighlight') {
                const color = args[0];
                color === null ? editor.chain().focus().unsetHighlight().run()
                               : editor.chain().focus().setHighlight({ color }).run();
            } else {
                editor.chain().focus()[command]().run();
            }
        },

        onTitleInput() {
            this.saveStatus = 'unsaved';
            this.scheduleSave();
        },

        scheduleSave() {
            this.saveStatus = 'unsaved';
            clearTimeout(this._saveTimer);
            this._saveTimer = setTimeout(() => this.save(), 1500);
        },

        async save() {
            if (!this.docId) return;
            this.saveStatus = 'saving';

            const careListData = {};
            Object.keys(this.editors).forEach(personId => {
                careListData[personId] = {};
                Object.keys(this.editors[personId]).forEach(colId => {
                    careListData[personId][colId] = this.editors[personId][colId].getJSON();
                });
            });

            try {
                await db.collection('elder_documents').doc(this.docId).update({
                    title: this.title.trim() || 'Untitled Care List',
                    careListColumns: this.careListColumns,
                    careListData,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                    updatedByName: this.currentUserName,
                });
                this.saveStatus = 'saved';
            } catch (e) {
                console.error('Error saving:', e);
                this.saveStatus = 'unsaved';
                this.showToast('Error saving care list', 'error');
            }
        },

        // ── Column management ─────────────────────────────────────────────────

        async addColumn() {
            const id = 'col_' + Date.now();
            const name = 'Column ' + (this.careListColumns.length + 1);
            this.careListColumns = [...this.careListColumns, { id, name }];
            await this.$nextTick();
            this.filteredPeople.forEach(person => this._mountCellEditor(person, id));
            this.startEditColumnName(id, name);
            this.scheduleSave();
        },

        startEditColumnName(id, currentName) {
            this.editingColumnId = id;
            this.editingColumnName = currentName;
            this.$nextTick(() => {
                const input = document.getElementById('col-name-input-' + id);
                if (input) { input.focus(); input.select(); }
            });
        },

        saveColumnName(id) {
            const name = this.editingColumnName.trim() || 'Untitled';
            this.careListColumns = this.careListColumns.map(c => c.id === id ? { ...c, name } : c);
            this.editingColumnId = null;
            this.scheduleSave();
        },

        deleteColumn(id) {
            if (this.careListColumns.length <= 1) { this.showToast('Cannot delete the last column', 'error'); return; }
            if (!confirm('Delete this column? Its content will be permanently lost.')) return;
            Object.keys(this.editors).forEach(personId => {
                if (this.editors[personId][id]) {
                    this.editors[personId][id].destroy();
                    delete this.editors[personId][id];
                }
            });
            this.careListColumns = this.careListColumns.filter(c => c.id !== id);
            this.scheduleSave();
        },

        // ── Tag / status helpers ──────────────────────────────────────────────

        getTagName(tagId) {
            const t = this.shepherdingTags.find(t => t.id === tagId);
            return t ? t.name : tagId;
        },

        formatStatusShort(status) {
            if (!status) return '';
            const ul = { urgent: 'Urgent', somewhat_urgent: 'Somewhat', not_urgent: 'Not Urgent' };
            const il = { important: 'Important', somewhat_important: 'Somewhat', not_important: 'Not Imp.' };
            return `${ul[status.urgency] || ''} · ${il[status.importance] || ''}`;
        },

        async createNewTag(name) {
            const trimmed = name.trim();
            if (!trimmed) throw new Error('Empty tag name');
            const existing = this.shepherdingTags.find(t => t.name.toLowerCase() === trimmed.toLowerCase());
            if (existing) return existing;
            await db.collection('people_tags').doc(trimmed).set({ name: trimmed, hiddenFromOthers: false, hidePeople: false });
            const newTag = { id: trimmed, name: trimmed, hidePeople: false };
            this.shepherdingTags = [...this.shepherdingTags, newTag].sort((a, b) => a.name.localeCompare(b.name));
            return newTag;
        },

        async handleTagAdd(personId, tagId, tagName) {
            try {
                const idx = this.people.findIndex(p => p.id === personId);
                const current = this.people[idx]?.tags || [];
                if (current.includes(tagId)) return;
                const newTags = [...current, tagId];
                const hidePeopleIds = new Set(this.shepherdingTags.filter(t => t.hidePeople).map(t => t.id));
                const shepherdingHidden = newTags.some(id => hidePeopleIds.has(id));
                await ShepherdingCore.commitPastoralChange(db, personId,
                    { tags: firebase.firestore.FieldValue.arrayUnion(tagId), shepherdingHidden },
                    ShepherdingCore.buildTagChange({
                        tagId, tagName, action: 'added',
                        authorUid: this.currentUser.uid, authorName: this.currentUserName,
                        source: 'document', sourceDocumentId: this.docId,
                    }));
                if (idx !== -1) {
                    this.people = this.people.map((p, i) => i === idx ? { ...p, tags: newTags, shepherdingHidden } : p);
                }
                this.showToast(`Tag #${tagName} added`);
            } catch (e) { console.error('Error adding tag:', e); this.showToast('Error adding tag', 'error'); }
        },

        async handleTagRemove(personId, tagId, tagName) {
            try {
                const idx = this.people.findIndex(p => p.id === personId);
                const current = this.people[idx]?.tags || [];
                const newTags = current.filter(t => t !== tagId);
                const hidePeopleIds = new Set(this.shepherdingTags.filter(t => t.hidePeople).map(t => t.id));
                const shepherdingHidden = newTags.some(id => hidePeopleIds.has(id));
                await ShepherdingCore.commitPastoralChange(db, personId,
                    { tags: firebase.firestore.FieldValue.arrayRemove(tagId), shepherdingHidden },
                    ShepherdingCore.buildTagChange({
                        tagId, tagName, action: 'removed',
                        authorUid: this.currentUser.uid, authorName: this.currentUserName,
                        source: 'document', sourceDocumentId: this.docId,
                    }));
                if (idx !== -1) {
                    this.people = this.people.map((p, i) => i === idx ? { ...p, tags: newTags, shepherdingHidden } : p);
                }
                this.showToast(`Tag #${tagName} removed`);
            } catch (e) { console.error('Error removing tag:', e); this.showToast('Error removing tag', 'error'); }
        },

        async handleStatusChange(personId, urgency, importance) {
            try {
                const idx = this.people.findIndex(p => p.id === personId);
                const previousStatus = this.people[idx]?.shepherdingStatus || null;
                const newStatus = (urgency && importance) ? { urgency, importance } : null;
                await ShepherdingCore.commitPastoralChange(db, personId, {
                    shepherdingStatus: newStatus,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                }, ShepherdingCore.buildStatusChange({
                    previousStatus, newStatus,
                    authorUid: this.currentUser.uid, authorName: this.currentUserName,
                    source: 'document', sourceDocumentId: this.docId,
                }));
                if (idx !== -1) {
                    this.people = this.people.map((p, i) => i === idx ? { ...p, shepherdingStatus: newStatus } : p);
                }
                this.showToast(newStatus ? 'Status updated' : 'Status cleared');
            } catch (e) { console.error('Error updating status:', e); this.showToast('Error updating status', 'error'); }
        },

        formatDate(ts) {
            if (!ts) return '';
            const date = ts.toDate ? ts.toDate() : new Date(ts);
            return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
        },

        showToast(message, type = 'success') {
            this.toast = { show: true, message, type };
            setTimeout(() => { this.toast.show = false; }, 3000);
        },
    }));
});
