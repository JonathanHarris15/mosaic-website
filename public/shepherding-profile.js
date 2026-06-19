const NOTE_TYPES = ['Elder Check-in', 'Elder Interview', 'Elder Meeting', 'Life Update', 'Prayer Request', 'Other'];

// Shepherding Status value model — single source of truth in shepherding-core.js.
// The Profile uses the full label variant.
const URGENCY_LEVELS = ShepherdingCore.URGENCY_LEVELS;
const IMPORTANCE_LEVELS = ShepherdingCore.IMPORTANCE_LEVELS;
const URGENCY_LABEL = ShepherdingCore.URGENCY_LABEL;
const IMPORTANCE_LABEL = ShepherdingCore.IMPORTANCE_LABEL;

// Kept outside Alpine to avoid reactive proxying of the TipTap editor object
let _noteEditor = null;
let _mentionPeople   = [];
let _mentionNotes    = [];
let _mentionDocs     = [];
let _mentionFolders  = [];
let _mentionDataLoaded = false;

// ── Mention data ─────────────────────────────────────────────────────────────

function _collectFolders(node, out) {
    for (const child of (node.children || [])) {
        if (child.type === 'folder') {
            out.push({ id: JSON.stringify({ kind: 'elder_folder', id: child.id }), label: child.name });
            _collectFolders(child, out);
        }
    }
}

async function loadMentionData() {
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
            _collectFolders(structResult.value.data(), _mentionFolders);
        }

        _mentionDataLoaded = true;
    } catch (e) {
        console.error('Error loading mention data:', e);
    }
}

// ── Mention suggestion ────────────────────────────────────────────────────────

function createMentionSuggestion() {
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
                items.forEach(item => {
                    const k = getKind(item);
                    (groups[k] || groups.elder_document).push(item);
                });
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
                    if (r) {
                        popup.style.left = `${Math.min(r.left, window.innerWidth - 240)}px`;
                        popup.style.top  = `${r.bottom + 4}px`;
                    }
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
                onStart(props) {
                    currentProps = props;
                    selectedIndex = 0;
                    redraw(props.items, props.clientRect, selectedIndex, props.command);
                },
                onUpdate(props) {
                    currentProps = props;
                    selectedIndex = 0;
                    redraw(props.items, props.clientRect, selectedIndex, props.command);
                },
                onKeyDown({ event }) {
                    if (!currentProps) return false;
                    const total = currentProps.items.length;
                    if (event.key === 'Escape') {
                        popup?.remove(); popup = null; return true;
                    }
                    if (!total) return false;
                    if (event.key === 'ArrowUp') {
                        selectedIndex = (selectedIndex - 1 + total) % total;
                        redraw(currentProps.items, null, selectedIndex, currentProps.command);
                        return true;
                    }
                    if (event.key === 'ArrowDown') {
                        selectedIndex = (selectedIndex + 1) % total;
                        redraw(currentProps.items, null, selectedIndex, currentProps.command);
                        return true;
                    }
                    if (event.key === 'Enter') {
                        if (currentProps.items[selectedIndex]) currentProps.command(currentProps.items[selectedIndex]);
                        return true;
                    }
                    return false;
                },
                onExit() {
                    popup?.remove();
                    popup = null;
                    currentProps = null;
                },
            };
        },
    };
}

// ── TipTap JSON → HTML ────────────────────────────────────────────────────────

// Delegates to the shared renderer in tiptap-render.js. The profile shows notes
// without a back-link, so no breadcrumb option is passed.
function tiptapJsonToHtml(doc) {
    return TiptapRender.renderTiptapJson(doc);
}

document.addEventListener('alpine:init', () => {
    Alpine.data('shepherdingProfile', () => ({
        currentUser: null,
        currentUserRole: null,
        currentUserName: '',

        personId: null,
        person: null,

        fromPage: null,
        fromId: null,
        fromTitle: null,

        notes: [],
        activity: [],
        sourceDocTitles: {},
        editingExplanation: {},
        explanationDraft: {},
        showNoteEditor: false,
        editingNote: null,
        noteForm: { type: 'Elder Check-in', subject: '', contentJson: null },
        editorUpdated: 0,

        showEditProfileModal: false,
        selectedPerson: null,
        isSubmitting: false,

        shepherdingTags: [],
        showTagPanel: false,
        newTagName: '',

        showDeletePersonModal: false,
        deletePassword: '',
        deleteError: '',
        isDeleting: false,

        collapseStatusChanges: false,

        noteTypes: [...NOTE_TYPES, 'Create New Note Type'],
        loading: true,
        toast: { show: false, message: '', type: 'success' },

        async init() {
            const params = new URLSearchParams(window.location.search);
            this.personId  = params.get('id');
            this.fromPage  = params.get('fromPage')  || null;
            this.fromId    = params.get('fromId')    || null;
            this.fromTitle = params.get('fromTitle') || null;
            if (!this.personId) {
                window.location.href = 'shepherding-dashboard.html';
                return;
            }

            auth.onAuthStateChanged(async (user) => {
                if (!user) {
                    window.location.href = 'login.html';
                    return;
                }
                const userData = await getUserData(user.uid);
                this.currentUserRole = (userData && userData.role) || 'viewer';
                if (!['elder', 'super_admin'].includes(this.currentUserRole)) {
                    window.location.href = 'index.html';
                    return;
                }
                this.currentUser = user;
                this.currentUserName = (userData && userData.email)
                    ? userData.email.split('@')[0]
                    : 'Elder';

                await Promise.all([
                    this.loadPerson(),
                    this.loadNotes(),
                    this.loadTags(),
                    this.loadActivity(),
                ]);
                this.loading = false;
            });
        },

        async loadPerson() {
            try {
                const doc = await db.collection('people').doc(this.personId).get();
                if (!doc.exists) {
                    window.location.href = 'shepherding-dashboard.html';
                    return;
                }
                this.person = { id: doc.id, ...doc.data() };
            } catch (e) {
                console.error('Error loading person:', e);
            }
        },

        async loadNotes() {
            try {
                const [notesSnap, careListNotes] = await Promise.all([
                    db.collection('people').doc(this.personId)
                        .collection('shepherding_notes')
                        .orderBy('createdAt', 'desc')
                        .get(),
                    this.loadCareListNotes()
                ]);

                this.notes = [
                    ...notesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })),
                    ...careListNotes
                ];

                const sourceIds = [...new Set(this.notes.map(n => n.sourceDocumentId).filter(Boolean))];
                if (sourceIds.length > 0) {
                    const results = await Promise.allSettled(
                        sourceIds.map(id => db.collection('elder_documents').doc(id).get())
                    );
                    const titles = {};
                    results.forEach((r, i) => {
                        if (r.status === 'fulfilled' && r.value.exists) {
                            titles[sourceIds[i]] = r.value.data().title || 'Untitled Document';
                        }
                    });
                    this.sourceDocTitles = titles;
                }
            } catch (e) {
                console.error('Error loading notes:', e);
            }
        },

        async loadCareListNotes() {
            try {
                const snap = await db.collection('elder_documents')
                    .where('docType', '==', 'care-list')
                    .get();

                const careListNotes = [];
                snap.docs.forEach(doc => {
                    const data = doc.data();
                    const personCells = data.careListData?.[this.personId];
                    if (personCells) {
                        const columns = data.careListColumns || [];
                        Object.entries(personCells).forEach(([colId, contentJson]) => {
                            if (contentJson && contentJson.content && contentJson.content.length > 0) {
                                // Basic check for non-empty TipTap doc
                                const hasText = contentJson.content.some(n => n.content && n.content.length > 0 || n.type === 'table');
                                if (hasText) {
                                    const col = columns.find(c => c.id === colId);
                                    careListNotes.push({
                                        id: `carelist-${doc.id}-${colId}`,
                                        type: 'Care List',
                                        subject: col ? col.name : 'Notes',
                                        contentJson: contentJson,
                                        createdAt: data.updatedAt || data.createdAt,
                                        authorName: data.updatedByName || 'Elder',
                                        sourceDocumentId: doc.id,
                                        isCareList: true
                                    });
                                }
                            }
                        });
                    }
                });
                return careListNotes;
            } catch (e) {
                console.error('Error loading Care List notes:', e);
                return [];
            }
        },

        async loadActivity() {
            try {
                const snap = await db.collection('people').doc(this.personId)
                    .collection('shepherding_activity')
                    .orderBy('createdAt', 'desc')
                    .get();
                this.activity = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

                const actSourceIds = [...new Set(
                    this.activity.filter(a => a.sourceDocumentId).map(a => a.sourceDocumentId)
                )].filter(id => !this.sourceDocTitles[id]);
                if (actSourceIds.length > 0) {
                    const results = await Promise.allSettled(
                        actSourceIds.map(id => db.collection('elder_documents').doc(id).get())
                    );
                    const titles = { ...this.sourceDocTitles };
                    results.forEach((r, i) => {
                        if (r.status === 'fulfilled' && r.value.exists) {
                            titles[actSourceIds[i]] = r.value.data().title || 'Untitled Document';
                        }
                    });
                    this.sourceDocTitles = titles;
                }
            } catch (e) {
                console.error('Error loading activity:', e);
            }
        },

        get pastoralRecord() {
            return ShepherdingCore.assemblePastoralRecord(this.notes, this.activity, {
                editingNoteId: this.editingNote ? this.editingNote.id : null,
            });
        },

        get displayRecord() {
            if (!this.collapseStatusChanges) return this.pastoralRecord;
            return ShepherdingCore.collapsePastoralRecord(this.pastoralRecord);
        },

        async loadTags() {
            try {
                const snap = await db.collection('people_tags').orderBy('name', 'asc').get();
                this.shepherdingTags = snap.docs.map(doc => ({
                    id: doc.id,
                    name: doc.data().name || doc.id,
                    hiddenFromOthers: doc.data().hiddenFromOthers || false,
                    hidePeople: doc.data().hidePeople || false,
                }));
            } catch (e) {
                console.error('Error loading tags:', e);
            }
        },

        // ── Editor ────────────────────────────────────────────────────────────

        openAddNote() {
            this.editingNote = null;
            this.noteForm = { type: 'Elder Check-in', subject: '', contentJson: null };
            this.showNoteEditor = true;
            this.$nextTick(() => this.initEditor());
        },

        openEditNote(note) {
            this.editingNote = note;
            this.noteForm = {
                type: note.type || 'Elder Check-in',
                subject: note.subject || '',
                contentJson: note.contentJson || null,
            };
            this.showNoteEditor = true;
            this.$nextTick(() => this.initEditor(note.contentJson || note.content || ''));
        },

        closeEditor() {
            this.showNoteEditor = false;
            this.editingNote = null;
            if (_noteEditor) {
                _noteEditor.destroy();
                _noteEditor = null;
            }
        },

        handleNoteTypeChange() {
            if (this.noteForm.type === 'Create New Note Type') {
                const newType = prompt('Enter new note type:');
                if (newType && newType.trim()) {
                    const trimmed = newType.trim();
                    if (!this.noteTypes.includes(trimmed)) {
                        // Insert before 'Create New Note Type'
                        const baseTypes = this.noteTypes.filter(t => t !== 'Create New Note Type');
                        this.noteTypes = [...baseTypes, trimmed, 'Create New Note Type'];
                    }
                    this.noteForm.type = trimmed;
                } else {
                    // Revert to first option if cancelled
                    this.noteForm.type = this.noteTypes[0];
                }
            }
        },

        async initEditor(content = '') {
            if (!window._TipTap) {
                const [
                    { Editor, Extension },
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
                        return [{
                            types: this.options.types,
                            attributes: {
                                fontSize: {
                                    default: null,
                                    parseHTML: el => el.style.fontSize || null,
                                    renderHTML: attrs => attrs.fontSize ? { style: `font-size: ${attrs.fontSize}` } : {},
                                },
                            },
                        }];
                    },
                    addCommands() {
                        return {
                            setFontSize: size => ({ chain }) => chain().setMark('textStyle', { fontSize: size }).run(),
                            unsetFontSize: () => ({ chain }) => chain().setMark('textStyle', { fontSize: null }).removeEmptyTextStyle().run(),
                        };
                    },
                });

                window._TipTap = { Editor, StarterKit, Underline, Mention, TextStyle, FontFamily, FontSize, Highlight, Table, TableRow, TableHeader, TableCell };
            }

            await loadMentionData();

            const el = document.getElementById('tiptap-note-editor');
            if (!el) return;

            if (_noteEditor) { _noteEditor.destroy(); _noteEditor = null; }

            const { Editor, StarterKit, Underline, Mention, TextStyle, FontFamily, FontSize, Highlight, Table, TableRow, TableHeader, TableCell } = window._TipTap;
            const self = this;
            _noteEditor = new Editor({
                element: el,
                extensions: [
                    StarterKit,
                    Underline,
                    TextStyle,
                    FontFamily,
                    FontSize,
                    Highlight.configure({ multicolor: true }),
                    Table.configure({ resizable: false }),
                    TableRow,
                    TableHeader,
                    TableCell,
                    Mention.configure({
                        HTMLAttributes: { class: 'mention-chip' },
                        suggestion: createMentionSuggestion(),
                    }),
                ],
                content: content || '',
                onTransaction() { self.editorUpdated++; },
            });
        },

        focusEditor() { _noteEditor?.commands.focus(); },

        isActive(name) { return _noteEditor ? _noteEditor.isActive(name) : false; },

        editorCmd(command) {
            _noteEditor?.chain().focus()[command]().run();
        },

        setFontFamily(family) {
            if (!_noteEditor) return;
            if (!family) {
                _noteEditor.chain().focus().unsetFontFamily().run();
            } else {
                _noteEditor.chain().focus().setFontFamily(family).run();
            }
        },

        setFontSize(size) {
            if (!_noteEditor) return;
            if (!size) {
                _noteEditor.chain().focus().unsetFontSize().run();
            } else {
                _noteEditor.chain().focus().setFontSize(size).run();
            }
        },

        setHighlight(color) {
            if (!_noteEditor) return;
            if (color === null) {
                _noteEditor.chain().focus().unsetHighlight().run();
            } else {
                _noteEditor.chain().focus().setHighlight({ color }).run();
            }
        },

        insertTable(rows = 3, cols = 3) {
            _noteEditor?.chain().focus().insertTable({ rows, cols, withHeaderRow: true }).run();
        },

        async saveNote() {
            if (!_noteEditor) return;
            const contentJson = _noteEditor.getJSON();
            const contentText = _noteEditor.getText().trim();
            if (!contentText) return;

            try {
                const notesRef = db.collection('people').doc(this.personId)
                    .collection('shepherding_notes');
                const payload = {
                    type: this.noteForm.type,
                    subject: this.noteForm.subject.trim(),
                    contentJson,
                    content: contentText,
                };

                if (this.editingNote) {
                    await notesRef.doc(this.editingNote.id).update({
                        ...payload,
                        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                        updatedBy: this.currentUser.uid,
                        updatedByName: this.currentUserName,
                    });
                    this.showToast('Note updated');
                } else {
                    await notesRef.add({
                        ...payload,
                        authorUid: this.currentUser.uid,
                        authorName: this.currentUserName,
                        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                    });
                    this.showToast('Note added');
                }

                this.closeEditor();
                await this.loadNotes();
            } catch (e) {
                console.error('Error saving note:', e);
                this.showToast('Error saving note', 'error');
            }
        },

        async deleteNote(id) {
            const note = this.notes.find(n => n.id === id);
            if (!note) return;
            if (!confirm('Delete this note? This cannot be undone.')) return;
            try {
                if (note.sourceDocumentId) {
                    await this._detachPanelFromDocument(note.sourceDocumentId, note.id, note.contentJson, note.content);
                    // Notify any open document tab so it can replace the panel live
                    try {
                        const bc = new BroadcastChannel('mosaic-shepherding');
                        bc.postMessage({
                            type: 'note-deleted',
                            noteId: note.id,
                            sourceDocumentId: note.sourceDocumentId,
                            personName: this.person?.name || '',
                            noteType: note.type || '',
                            bodySnapshot: note.contentJson ? JSON.stringify(note.contentJson) : null,
                        });
                        bc.close();
                    } catch (_) {}
                }
                await db.collection('people').doc(this.personId)
                    .collection('shepherding_notes').doc(id).delete();
                this.notes = this.notes.filter(n => n.id !== id);
                this.showToast('Note deleted');
            } catch (e) {
                console.error('Error deleting note:', e);
                this.showToast('Error deleting note', 'error');
            }
        },

        async _detachPanelFromDocument(docId, noteId, noteContentJson, noteText) {
            try {
                const docSnap = await db.collection('elder_documents').doc(docId).get();
                if (!docSnap.exists) return;
                const docData = docSnap.data();
                const contentJson = docData.contentJson;
                if (!contentJson || !contentJson.content) return;

                let changed = false;
                const newContent = [];
                for (const node of contentJson.content) {
                    if (node.type === 'personPanel' && node.attrs && node.attrs.noteId === noteId) {
                        const personName = node.attrs.personName || '';
                        const noteType = node.attrs.noteType || '';
                        const headerText = [personName, noteType].filter(Boolean).join(' — ');
                        const headerPara = {
                            type: 'paragraph',
                            content: [{ type: 'text', text: headerText, marks: [{ type: 'bold' }] }],
                        };
                        const bodyNodes = (noteContentJson && noteContentJson.content && noteContentJson.content.length > 0)
                            ? noteContentJson.content
                            : noteText
                                ? [{ type: 'paragraph', content: [{ type: 'text', text: noteText }] }]
                                : [];
                        newContent.push(headerPara, ...bodyNodes);
                        changed = true;
                    } else {
                        newContent.push(node);
                    }
                }

                if (!changed) return;
                await db.collection('elder_documents').doc(docId).update({
                    contentJson: { ...contentJson, content: newContent },
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                });
            } catch (e) {
                console.error('Error detaching panel from document:', e);
            }
        },

        renderNoteHtml(note) {
            if (note.contentJson) return tiptapJsonToHtml(note.contentJson);
            if (note.content) {
                const escaped = note.content
                    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                    .replace(/\n/g, '<br>');
                return `<p>${escaped}</p>`;
            }
            return '';
        },

        // ── Tags ──────────────────────────────────────────────────────────────

        hasTag(tagId) { return (this.person?.tags || []).includes(tagId); },

        async toggleTag(tagId) {
            const current = this.person?.tags || [];
            const hasIt = current.includes(tagId);
            const newTags = hasIt ? current.filter(t => t !== tagId) : [...current, tagId];
            const hidePeopleIds = new Set(this.shepherdingTags.filter(t => t.hidePeople).map(t => t.id));
            const shepherdingHidden = newTags.some(id => hidePeopleIds.has(id));
            const tagName = this.getTagName(tagId);
            try {
                await ShepherdingCore.commitPastoralChange(db, this.personId, {
                    tags: hasIt
                        ? firebase.firestore.FieldValue.arrayRemove(tagId)
                        : firebase.firestore.FieldValue.arrayUnion(tagId),
                    shepherdingHidden,
                }, ShepherdingCore.buildTagChange({
                    tagId, tagName,
                    action: hasIt ? 'removed' : 'added',
                    authorUid: this.currentUser.uid,
                    authorName: this.currentUserName,
                    source: 'profile',
                }));
                this.person.tags = newTags;
                await this.loadActivity();
            } catch (e) {
                console.error('Error toggling tag:', e);
                this.showToast('Error updating tags', 'error');
            }
        },

        async createTag() {
            const name = this.newTagName.trim();
            if (!name) return;
            const exists = this.shepherdingTags.some(t => t.name.toLowerCase() === name.toLowerCase());
            if (exists) { this.showToast('Tag already exists', 'error'); return; }
            try {
                await db.collection('people_tags').doc(name).set({
                    name,
                    hiddenFromOthers: false,
                    hidePeople: false,
                });
                this.shepherdingTags = [...this.shepherdingTags, { id: name, name, hiddenFromOthers: false, hidePeople: false }]
                    .sort((a, b) => a.name.localeCompare(b.name));
                this.newTagName = '';
                this.showToast(`Tag "${name}" created`);
            } catch (e) {
                console.error('Error creating tag:', e);
                this.showToast('Error creating tag', 'error');
            }
        },

        getTagName(tagId) {
            const tag = this.shepherdingTags.find(t => t.id === tagId);
            return tag ? tag.name : tagId;
        },

        // ── Profile Editing ──────────────────────────────────────────────────

        openEditProfile() {
            this.selectedPerson = JSON.parse(JSON.stringify(this.person));
            if (!this.selectedPerson.contact) this.selectedPerson.contact = {};
            this.showEditProfileModal = true;
        },

        async saveProfile() {
            if (!this.selectedPerson) return;
            this.isSubmitting = true;
            try {
                const personRef = db.collection('people').doc(this.personId);
                const updates = {
                    name: this.selectedPerson.name.trim(),
                    'contact.email': (this.selectedPerson.contact?.email || '').trim(),
                    'contact.phone': (this.selectedPerson.contact?.phone || '').trim(),
                    'contact.address': (this.selectedPerson.contact?.address || '').trim(),
                    birthday: this.selectedPerson.birthday || null,
                    sex: this.selectedPerson.sex || null,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                };

                await personRef.update(updates);
                this.person = { ...this.person, ...this.selectedPerson };
                this.showEditProfileModal = false;
                this.showToast('Profile updated');
            } catch (e) {
                console.error('Error updating profile:', e);
                this.showToast('Error updating profile', 'error');
            } finally {
                this.isSubmitting = false;
            }
        },

        // ── Delete Person ─────────────────────────────────────────────────────

        openDeletePerson() {
            this.deletePassword = '';
            this.deleteError = '';
            this.showDeletePersonModal = true;
        },

        async confirmDeletePerson() {
            if (!this.deletePassword) {
                this.deleteError = 'Please enter your password.';
                return;
            }
            this.isDeleting = true;
            this.deleteError = '';
            try {
                const liveUser = auth.currentUser;
                const credential = firebase.auth.EmailAuthProvider.credential(
                    liveUser.email,
                    this.deletePassword
                );
                await liveUser.reauthenticateWithCredential(credential);
            } catch (e) {
                this.deleteError = 'Incorrect password. Please try again.';
                this.isDeleting = false;
                return;
            }

            try {
                // Delete all notes and activity records first
                const [notesSnap, activitySnap] = await Promise.all([
                    db.collection('people').doc(this.personId).collection('shepherding_notes').get(),
                    db.collection('people').doc(this.personId).collection('shepherding_activity').get(),
                ]);
                const batch = db.batch();
                notesSnap.docs.forEach(doc => batch.delete(doc.ref));
                activitySnap.docs.forEach(doc => batch.delete(doc.ref));
                if (!notesSnap.empty || !activitySnap.empty) await batch.commit();

                // Delete the person document
                await db.collection('people').doc(this.personId).delete();

                window.location.href = 'shepherding-people.html';
            } catch (e) {
                console.error('Error deleting person:', e);
                this.deleteError = 'An error occurred while deleting. Please try again.';
                this.isDeleting = false;
            }
        },

        async deleteStatusHistory() {
            if (!confirm('Are you sure you want to delete all status change history for this person? This cannot be undone.')) return;
            
            try {
                const snap = await db.collection('people').doc(this.personId)
                    .collection('shepherding_activity')
                    .where('kind', '==', 'status_change')
                    .get();
                
                if (snap.empty) {
                    this.showToast('No status history to delete.');
                    return;
                }

                const batch = db.batch();
                snap.docs.forEach(doc => batch.delete(doc.ref));
                await batch.commit();

                await this.loadActivity();
                this.showToast('Status history deleted.');
            } catch (e) {
                console.error('Error deleting status history:', e);
                this.showToast('Error deleting status history', 'error');
            }
        },

        // ── Pastoral Status ───────────────────────────────────────────────────

        isCurrentStatus(urgency, importance) {
            const s = this.person?.shepherdingStatus;
            return s?.urgency === urgency && s?.importance === importance;
        },

        async setShepherdingStatus(urgency, importance) {
            const clearing = this.isCurrentStatus(urgency, importance);
            const previousStatus = this.person?.shepherdingStatus || null;
            const newStatus = clearing ? null : { urgency, importance };
            try {
                await ShepherdingCore.commitPastoralChange(db, this.personId, {
                    shepherdingStatus: newStatus,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                }, ShepherdingCore.buildStatusChange({
                    previousStatus, newStatus,
                    authorUid: this.currentUser.uid,
                    authorName: this.currentUserName,
                    source: 'profile',
                }));
                this.person.shepherdingStatus = newStatus;
                await this.loadActivity();
                this.showToast(clearing ? 'Status cleared' : 'Status updated');
            } catch (e) {
                console.error('Error updating status:', e);
                this.showToast('Error updating status', 'error');
            }
        },

        formatStatus(status) {
            if (!status) return '';
            return `${URGENCY_LABEL[status.urgency] || status.urgency} · ${IMPORTANCE_LABEL[status.importance] || status.importance}`;
        },

        statusCellColor(urgency, importance) {
            return ShepherdingCore.statusCellColor(urgency, importance);
        },

        // ── Explanations ──────────────────────────────────────────────────────

        startEditExplanation(activityId, currentText) {
            this.explanationDraft = { ...this.explanationDraft, [activityId]: currentText || '' };
            this.editingExplanation = { ...this.editingExplanation, [activityId]: true };
        },

        async saveExplanation(activityId) {
            const text = (this.explanationDraft[activityId] || '').trim();
            try {
                await db.collection('people').doc(this.personId)
                    .collection('shepherding_activity').doc(activityId)
                    .update({ explanation: text });
                const idx = this.activity.findIndex(a => a.id === activityId);
                if (idx !== -1) this.activity[idx].explanation = text;
                this.editingExplanation = { ...this.editingExplanation, [activityId]: false };
                this.showToast('Explanation saved');
            } catch (e) {
                console.error('Error saving explanation:', e);
                this.showToast('Error saving explanation', 'error');
            }
        },

        cancelEditExplanation(activityId) {
            this.editingExplanation = { ...this.editingExplanation, [activityId]: false };
        },

        // ── Helpers ───────────────────────────────────────────────────────────

        renderMiniMatrix(status) {
            if (!status) return '';
            const URGENCY    = ShepherdingCore.URGENCY_LEVELS;
            const IMPORTANCE = ShepherdingCore.IMPORTANCE_LEVELS;
            const ACTIVE_COLOR  = { 0: '#ba1a1a', 1: '#ba1a1a', 2: '#436082', 3: '#436082', 4: '#75777f' };
            const PASSIVE_COLOR = { 0: '#ffdad6', 1: '#ffdad6', 2: '#d1e4ff', 3: '#d1e4ff', 4: '#f0eee8' };
            let html = '<div style="display:grid;grid-template-columns:repeat(3,20px);gap:2px;">';
            IMPORTANCE.forEach(imp => {
                URGENCY.forEach(urg => {
                    const active = status.urgency === urg && status.importance === imp;
                    const score  = ShepherdingCore.statusScore(urg, imp);
                    const bg     = active ? (ACTIVE_COLOR[score] || '#75777f') : (PASSIVE_COLOR[score] || '#f0eee8');
                    html += `<div style="width:20px;height:20px;border-radius:3px;background:${bg};border:${active ? 'none' : '1px solid #c5c6d0'};display:flex;align-items:center;justify-content:center;">`;
                    if (active) html += '<span style="width:5px;height:5px;border-radius:50%;background:#fff;display:block;"></span>';
                    html += '</div>';
                });
            });
            html += '</div>';
            return html;
        },

        formatDate(val) {
            if (!val) return '';
            // If it's a string like "YYYY-MM-DD"
            if (typeof val === 'string' && val.includes('-')) {
                const [y, m, d] = val.split('-');
                return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
            }
            const date = val.toDate ? val.toDate() : new Date(val);
            return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
        },

        showToast(message, type = 'success') {
            this.toast = { show: true, message, type };
            setTimeout(() => { this.toast.show = false; }, 3000);
        },
    }));
});
