const NOTE_TYPES = ['Elder Check-in', 'Elder Interview', 'Elder Meeting Minutes', 'Life Update', 'Other'];

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

function tiptapJsonToHtml(doc) {
    if (!doc || !doc.content) return '';
    return renderNodes(doc.content);
}

function renderNodes(nodes) {
    if (!nodes) return '';
    return nodes.map(renderNode).join('');
}

function renderNode(node) {
    switch (node.type) {
        case 'paragraph': {
            const inner = node.content ? renderNodes(node.content) : '';
            return inner ? `<p>${inner}</p>` : '<p></p>';
        }
        case 'text': {
            let t = (node.text || '')
                .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            if (node.marks) {
                for (const m of node.marks) {
                    if (m.type === 'bold')      t = `<strong>${t}</strong>`;
                    if (m.type === 'italic')    t = `<em>${t}</em>`;
                    if (m.type === 'underline') t = `<u>${t}</u>`;
                    if (m.type === 'highlight') {
                        const color = m.attrs?.color || '#fef08a';
                        t = `<mark style="background-color:${color};padding:0 2px;border-radius:2px;">${t}</mark>`;
                    }
                    if (m.type === 'textStyle') {
                        const styles = [];
                        if (m.attrs?.fontSize) styles.push(`font-size:${m.attrs.fontSize}`);
                        if (m.attrs?.fontFamily) styles.push(`font-family:${m.attrs.fontFamily}`);
                        if (styles.length) t = `<span style="${styles.join(';')}">${t}</span>`;
                    }
                }
            }
            return t;
        }
        case 'mention': {
            const rawId = node.attrs?.id || '';
            const label = (node.attrs?.label || '?')
                .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            let parsed = null;
            try { parsed = JSON.parse(rawId); } catch {}
            if (parsed?.kind === 'person') {
                return `<a class="mention-chip" href="shepherding-profile.html?id=${encodeURIComponent(parsed.id)}">@${label}</a>`;
            }
            if (parsed?.kind === 'note' && parsed.personId) {
                return `<a class="mention-chip" href="shepherding-profile.html?id=${encodeURIComponent(parsed.personId)}">@${label}</a>`;
            }
            if (parsed?.kind === 'elder_document') {
                return `<a class="mention-chip" href="shepherding-document.html?id=${encodeURIComponent(parsed.id)}">@${label}</a>`;
            }
            if (parsed?.kind === 'elder_folder') {
                return `<a class="mention-chip" href="shepherding-documents.html?folder=${encodeURIComponent(parsed.id)}">@${label}</a>`;
            }
            return `<span class="mention-chip" style="opacity:.5">@${label}</span>`;
        }
        case 'bulletList':  return `<ul>${renderNodes(node.content)}</ul>`;
        case 'orderedList': return `<ol>${renderNodes(node.content)}</ol>`;
        case 'listItem':    return `<li>${renderNodes(node.content)}</li>`;
        case 'hardBreak':   return '<br>';
        case 'table':       return `<table class="note-table">${renderNodes(node.content)}</table>`;
        case 'tableRow':    return `<tr>${renderNodes(node.content)}</tr>`;
        case 'tableHeader': return `<th>${node.content ? renderNodes(node.content) : ''}</th>`;
        case 'tableCell':   return `<td>${node.content ? renderNodes(node.content) : ''}</td>`;
        default:            return node.content ? renderNodes(node.content) : (node.text || '');
    }
}

document.addEventListener('alpine:init', () => {
    Alpine.data('shepherdingProfile', () => ({
        currentUser: null,
        currentUserRole: null,
        currentUserName: '',

        personId: null,
        person: null,

        notes: [],
        sourceDocTitles: {},
        showNoteEditor: false,
        editingNote: null,
        noteForm: { type: 'Elder Check-in', subject: '', contentJson: null },
        editorUpdated: 0,

        shepherdingTags: [],
        showTagPanel: false,
        newTagName: '',

        noteTypes: NOTE_TYPES,
        loading: true,
        toast: { show: false, message: '', type: 'success' },

        async init() {
            const params = new URLSearchParams(window.location.search);
            this.personId = params.get('id');
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
                const snap = await db.collection('people').doc(this.personId)
                    .collection('shepherding_notes')
                    .orderBy('createdAt', 'desc')
                    .get();
                this.notes = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

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
            try {
                await db.collection('people').doc(this.personId).update({
                    tags: hasIt
                        ? firebase.firestore.FieldValue.arrayRemove(tagId)
                        : firebase.firestore.FieldValue.arrayUnion(tagId),
                    shepherdingHidden,
                });
                this.person.tags = newTags;
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

        // ── Helpers ───────────────────────────────────────────────────────────

        formatDate(timestamp) {
            if (!timestamp) return '';
            const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
            return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
        },

        showToast(message, type = 'success') {
            this.toast = { show: true, message, type };
            setTimeout(() => { this.toast.show = false; }, 3000);
        },
    }));
});
