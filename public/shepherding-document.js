let _docEditor = null;
let _mentionPeople   = [];
let _mentionNotes    = [];
let _mentionDocs     = [];
let _mentionFolders  = [];
let _mentionDataLoaded = false;

// ── Mention data ──────────────────────────────────────────────────────────────

async function loadDocMentionData() {
    if (_mentionDataLoaded) return;
    try {
        const [peopleResult, meetingsResult, notesResult, structResult] = await Promise.allSettled([
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

        if (meetingsResult.status === 'fulfilled') {
            _mentionDocs = meetingsResult.value.docs.map(doc => {
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

function collectFolders(node, out) {
    for (const child of (node.children || [])) {
        if (child.type === 'folder') {
            out.push({ id: JSON.stringify({ kind: 'elder_folder', id: child.id }), label: child.name });
            collectFolders(child, out);
        }
    }
}

// ── Mention suggestion ────────────────────────────────────────────────────────

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

// ── TipTap JSON → HTML ────────────────────────────────────────────────────────

function docTiptapJsonToHtml(doc) {
    if (!doc || !doc.content) return '';
    return docRenderNodes(doc.content);
}

function docRenderNodes(nodes) {
    if (!nodes) return '';
    return nodes.map(docRenderNode).join('');
}

function docRenderNode(node) {
    switch (node.type) {
        case 'paragraph': {
            const inner = node.content ? docRenderNodes(node.content) : '';
            return inner ? `<p>${inner}</p>` : '<p></p>';
        }
        case 'text': {
            let t = (node.text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
            const label = (node.attrs?.label || '?').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            let parsed = null;
            try { parsed = JSON.parse(rawId); } catch {}
            if (parsed?.kind === 'person') return `<a class="mention-chip" href="shepherding-profile.html?id=${encodeURIComponent(parsed.id)}">@${label}</a>`;
            if (parsed?.kind === 'note' && parsed.personId) return `<a class="mention-chip" href="shepherding-profile.html?id=${encodeURIComponent(parsed.personId)}">@${label}</a>`;
            if (parsed?.kind === 'elder_document') return `<a class="mention-chip" href="shepherding-document.html?id=${encodeURIComponent(parsed.id)}">@${label}</a>`;
            if (parsed?.kind === 'elder_folder') return `<a class="mention-chip" href="shepherding-documents.html?folder=${encodeURIComponent(parsed.id)}">@${label}</a>`;
            return `<span class="mention-chip" style="opacity:.5">@${label}</span>`;
        }
        case 'bulletList':  return `<ul>${docRenderNodes(node.content)}</ul>`;
        case 'orderedList': return `<ol>${docRenderNodes(node.content)}</ol>`;
        case 'listItem':    return `<li>${docRenderNodes(node.content)}</li>`;
        case 'hardBreak':   return '<br>';
        case 'table':       return `<table class="note-table">${docRenderNodes(node.content)}</table>`;
        case 'tableRow':    return `<tr>${docRenderNodes(node.content)}</tr>`;
        case 'tableHeader': return `<th>${node.content ? docRenderNodes(node.content) : ''}</th>`;
        case 'tableCell':   return `<td>${node.content ? docRenderNodes(node.content) : ''}</td>`;
        default:            return node.content ? docRenderNodes(node.content) : (node.text || '');
    }
}

// ── Alpine component ──────────────────────────────────────────────────────────

document.addEventListener('alpine:init', () => {
    Alpine.data('documentEditor', () => ({
        loading: true,
        currentUser: null,
        currentUserRole: null,
        currentUserName: '',

        docId: null,
        doc: null,
        title: '',

        saveStatus: 'saved',
        _saveTimer: null,
        editorUpdated: 0,

        toast: { show: false, message: '', type: 'success' },

        async init() {
            const params = new URLSearchParams(window.location.search);
            this.docId = params.get('id');
            if (!this.docId) { window.location.href = 'shepherding-documents.html'; return; }

            this._onKeyDown = (e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                    e.preventDefault();
                    clearTimeout(this._saveTimer);
                    this.save();
                }
            };
            window.addEventListener('keydown', this._onKeyDown);
            this.$watch('$destroy', () => window.removeEventListener('keydown', this._onKeyDown));

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

                await this.loadDoc();
                this.loading = false;
                this.$nextTick(() => this.initEditor());
            });
        },

        async loadDoc() {
            try {
                const snap = await db.collection('elder_documents').doc(this.docId).get();
                if (!snap.exists) { window.location.href = 'shepherding-documents.html'; return; }
                this.doc = { id: snap.id, ...snap.data() };
                this.title = this.doc.title || '';
            } catch (e) {
                console.error('Error loading document:', e);
                this.showToast('Error loading document', 'error');
            }
        },

        // ── Editor ─────────────────────────────────────────────────────────────

        async initEditor() {
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
                        return [{ types: this.options.types, attributes: { fontSize: { default: null, parseHTML: el => el.style.fontSize || null, renderHTML: attrs => attrs.fontSize ? { style: `font-size: ${attrs.fontSize}` } : {} } } }];
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

            await loadDocMentionData();

            const el = document.getElementById('tiptap-doc-editor');
            if (!el) return;
            if (_docEditor) { _docEditor.destroy(); _docEditor = null; }

            const { Editor, StarterKit, Underline, Mention, TextStyle, FontFamily, FontSize, Highlight, Table, TableRow, TableHeader, TableCell } = window._TipTap;
            const self = this;
            _docEditor = new Editor({
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
                        suggestion: createDocMentionSuggestion(),
                    }),
                ],
                content: this.doc?.contentJson || '',
                onTransaction() { self.editorUpdated++; self.scheduleSave(); },
            });
        },

        focusEditor() { _docEditor?.commands.focus(); },
        isActive(name) { return _docEditor ? _docEditor.isActive(name) : false; },
        editorCmd(command) { _docEditor?.chain().focus()[command]().run(); },

        setFontFamily(family) {
            if (!_docEditor) return;
            family ? _docEditor.chain().focus().setFontFamily(family).run()
                   : _docEditor.chain().focus().unsetFontFamily().run();
        },

        setFontSize(size) {
            if (!_docEditor) return;
            size ? _docEditor.chain().focus().setFontSize(size).run()
                 : _docEditor.chain().focus().unsetFontSize().run();
        },

        setHighlight(color) {
            if (!_docEditor) return;
            color === null ? _docEditor.chain().focus().unsetHighlight().run()
                           : _docEditor.chain().focus().setHighlight({ color }).run();
        },

        insertTable(rows = 3, cols = 3) {
            _docEditor?.chain().focus().insertTable({ rows, cols, withHeaderRow: true }).run();
        },

        // ── Auto-save ─────────────────────────────────────────────────────────

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
            if (!_docEditor || !this.docId) return;
            this.saveStatus = 'saving';
            try {
                const contentJson = _docEditor.getJSON();
                await db.collection('elder_documents').doc(this.docId).update({
                    title: this.title.trim() || 'Untitled Document',
                    contentJson,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                    updatedByName: this.currentUserName,
                });
                this.saveStatus = 'saved';
            } catch (e) {
                console.error('Error saving:', e);
                this.saveStatus = 'unsaved';
                this.showToast('Error saving document', 'error');
            }
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
