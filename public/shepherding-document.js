// ── Module-level state shared with NodeViews ──────────────────────────────────
let _currentDocId    = null;
let _currentDocTitle = '';
let _currentUserName = '';
let _currentUserId   = '';

let _docEditor = null;

let _mentionPeople   = [];
let _mentionNotes    = [];
let _mentionDocs     = [];
let _mentionFolders  = [];
let _mentionDataLoaded = false;
let _allTagsList = []; // [{ id, name }] — for inline # trigger

// People list for the panel person picker (id → name map)
let _peopleList = []; // [{ id, name }]

// ── Mention data ──────────────────────────────────────────────────────────────

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
        const [peopleResult, docsResult, notesResult, structResult, tagsResult] = await Promise.allSettled([
            db.collection('people').orderBy('name', 'asc').get(),
            db.collection('elder_documents').get(),
            db.collectionGroup('shepherding_notes').orderBy('createdAt', 'desc').get(),
            db.collection('elder_document_structure').doc('root').get(),
            db.collection('people_tags').orderBy('name', 'asc').get(),
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

        if (tagsResult.status === 'fulfilled') {
            _allTagsList = tagsResult.value.docs.map(doc => ({ id: doc.id, name: doc.data().name || doc.id }));
        }

        _mentionDataLoaded = true;
    } catch (e) {
        console.error('Error loading mention data:', e);
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

// ── TipTap JSON → HTML ────────────────────────────────────────────────────────

// (The document-side TipTap→HTML renderer was dead code — never called — and is
// removed. The shared renderer in tiptap-render.js carries its breadcrumb
// behaviour via the `breadcrumb` option for whenever a document back-link is
// wired up.)

// ── Inline three-step slash picker ───────────────────────────────────────────
// Phase 1 (command): type / → shows command list
// Phase 2 (person):  select command → type to search people
// Phase 3 (note):    select person → pick note or create new → inserts panel

function createInlinePickerPlugin() {
    const { Extension, Plugin, PluginKey } = window._TipTap;
    const pickerKey = new PluginKey('inlinePicker');

    let ps = null;   // null = idle; { phase, triggerFrom, phaseStart, selectedIndex, selectedPerson, existingNotes }
    let popup = null;
    let edView = null;

    const COMMANDS = [
        { id: 'person', title: 'Person Note', description: 'Insert a linked Shepherding Note', icon: 'person_add' },
    ];

    function getQuery() {
        if (!ps || !edView) return '';
        const cur = edView.state.selection.from;
        const from = ps.phaseStart;
        if (cur <= from) return '';
        try { return edView.state.doc.textBetween(from, Math.min(cur, edView.state.doc.content.size)); }
        catch { return ''; }
    }

    function getItems() {
        if (!ps) return [];
        const q = getQuery().toLowerCase().trim();
        if (ps.phase === 'command') {
            return COMMANDS.filter(c => c.title.toLowerCase().includes(q) || c.id.includes(q));
        }
        if (ps.phase === 'person') {
            return _peopleList
                .filter(p => p.name.toLowerCase().includes(q))
                .slice(0, 8)
                .map(p => ({ id: p.id, title: p.name, icon: 'person', description: '' }));
        }
        return [];
    }

    function reset() {
        ps = null;
        popup?.remove();
        popup = null;
    }

    function draw() {
        if (!ps || !edView) { popup?.remove(); popup = null; return; }
        const items = getItems();

        if (!popup) {
            popup = document.createElement('div');
            popup.style.cssText = 'position:fixed;z-index:9999;background:#fff;color:#1c1c18;border:1px solid #c5c6d0;border-radius:8px;box-shadow:0 4px 20px rgba(0,0,0,.14);min-width:260px;padding:4px 0;font-family:"Work Sans",sans-serif;font-size:14px;';
            document.body.appendChild(popup);
        }

        try {
            const coords = edView.coordsAtPos(edView.state.selection.from);
            popup.style.left = `${Math.min(coords.left, window.innerWidth - 280)}px`;
            popup.style.top  = `${coords.bottom + 6}px`;
        } catch {}

        popup.innerHTML = '';
        const labels = { command: 'Insert', person: 'Select person' };
        const hdr = document.createElement('div');
        hdr.style.cssText = 'padding:4px 16px 2px;font-size:11px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:#75777f;';
        hdr.textContent = labels[ps.phase] || 'Insert';
        popup.appendChild(hdr);

        if (!items.length) {
            const el = document.createElement('div');
            el.style.cssText = 'padding:8px 16px;color:#75777f;font-style:italic;';
            el.textContent = ps.phase === 'person' ? 'No people found' : 'No matches';
            popup.appendChild(el);
            return;
        }

        items.forEach((item, i) => {
            const sel = i === ps.selectedIndex;
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.style.cssText = `display:flex;align-items:center;gap:12px;width:100%;text-align:left;padding:8px 16px;cursor:pointer;border:none;background:${sel ? '#d8e2ff' : 'transparent'};`;
            const ico = document.createElement('span');
            ico.style.cssText = `font-family:'Material Symbols Outlined';font-size:20px;font-variation-settings:'FILL' 0;color:${sel ? '#001a42' : '#44474e'};flex-shrink:0;line-height:1;`;
            ico.textContent = item.icon || 'chevron_right';
            const txt = document.createElement('div');
            const ttl = document.createElement('div');
            ttl.style.cssText = `font-weight:600;color:${sel ? '#001a42' : '#1c1c18'};font-size:14px;font-family:inherit;`;
            ttl.textContent = item.title;
            txt.appendChild(ttl);
            if (item.description) {
                const dsc = document.createElement('div');
                dsc.style.cssText = 'font-size:12px;color:#75777f;font-family:inherit;';
                dsc.textContent = item.description;
                txt.appendChild(dsc);
            }
            btn.appendChild(ico);
            btn.appendChild(txt);
            btn.addEventListener('mousedown', e => { e.preventDefault(); pick(item); });
            popup.appendChild(btn);
        });
    }

    async function pick(item) {
        if (!ps || !edView) return;

        if (ps.phase === 'command') {
            ps.phase = 'person';
            ps.phaseStart = edView.state.selection.from;
            ps.selectedIndex = 0;
            draw();

        } else if (ps.phase === 'person') {
            const person = { id: item.id, name: item.title };
            const { triggerFrom } = ps;
            const view = edView;
            reset();
            try {
                const ref = await db.collection('people').doc(person.id)
                    .collection('shepherding_notes').add({
                        type: 'Elder Meeting', subject: '', contentJson: null, content: '',
                        authorName: _currentUserName, authorUid: _currentUserId,
                        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                        sourceDocumentId: _currentDocId,
                    });
                const noteId = ref.id;
                const { state } = view;
                const maxPos = state.doc.content.size;
                const from = Math.min(Math.max(0, triggerFrom), maxPos);
                const to   = Math.min(Math.max(from, view.state.selection.from), maxPos);
                const panelNode = state.schema.nodes.personPanel.create({
                    personId: person.id, noteId, personName: person.name, noteType: 'Elder Meeting',
                });
                view.dispatch(state.tr.replaceWith(from, to, panelNode));
            } catch (e) { console.error('Error inserting panel:', e); }
        }
    }

    return Extension.create({
        name: 'inlinePicker',
        addProseMirrorPlugins() {
            return [new Plugin({
                key: pickerKey,

                view(v) {
                    edView = v;
                    return {
                        update(v2) {
                            if (!ps) { popup?.remove(); popup = null; return; }
                            const cur = v2.state.selection.from;
                            if (cur <= ps.triggerFrom) { reset(); return; }
                            const sz = v2.state.doc.content.size;
                            if (ps.triggerFrom >= sz) { reset(); return; }
                            const ch = v2.state.doc.textBetween(ps.triggerFrom, Math.min(ps.triggerFrom + 1, sz));
                            if (ch !== '/') { reset(); return; }
                            draw();
                        },
                        destroy() { reset(); edView = null; },
                    };
                },

                props: {
                    handleKeyDown(v, e) {
                        if (!ps) return false;
                        const items = getItems();
                        if (e.key === 'Escape') { reset(); return true; }
                        if (e.key === 'ArrowUp')   { if (items.length) { ps.selectedIndex = (ps.selectedIndex - 1 + items.length) % items.length; draw(); } return true; }
                        if (e.key === 'ArrowDown') { if (items.length) { ps.selectedIndex = (ps.selectedIndex + 1) % items.length; draw(); } return true; }
                        if (e.key === 'Enter') { if (items[ps.selectedIndex]) pick(items[ps.selectedIndex]); return true; }
                        if (e.key === ' ' && ps.phase === 'command') {
                            if (items[ps.selectedIndex]) { pick(items[ps.selectedIndex]); return true; }
                            reset(); return false;
                        }
                        if (e.key === 'Backspace' && getQuery().length === 0) { reset(); return false; }
                        return false;
                    },

                    handleTextInput(v, from, to, text) {
                        if (!ps && text === '/') {
                            const preceding = from > 0 ? v.state.doc.textBetween(Math.max(0, from - 1), from) : '';
                            if (!preceding || preceding === ' ') {
                                setTimeout(() => {
                                    if (!edView) return;
                                    const cur = edView.state.selection.from;
                                    ps = { phase: 'command', triggerFrom: cur - 1, phaseStart: cur, selectedIndex: 0 };
                                    draw();
                                }, 0);
                            }
                        }
                        return false;
                    },
                },
            })];
        },
    });
}

// ── Person Panel NodeView ─────────────────────────────────────────────────────

let NOTE_TYPES_ALL = ['Elder Check-in', 'Elder Interview', 'Elder Meeting', 'Life Update', 'Prayer Request', 'Other', 'Create New Note Type'];

function makePersonPanelNodeView({ node, getPos, editor }) {
    let currentAttrs = { ...node.attrs };

    // ── DOM ──
    const dom = document.createElement('div');
    dom.className = 'person-panel';
    dom.contentEditable = 'false';

    // Header
    const header = document.createElement('div');
    header.className = 'person-panel-header';

    const nameBtn = document.createElement('button');
    nameBtn.type = 'button';
    nameBtn.className = 'person-panel-name';
    nameBtn.textContent = node.attrs.personName || 'Unknown Person';
    nameBtn.title = 'Click to change person';
    nameBtn.addEventListener('mousedown', e => {
        e.preventDefault();
        e.stopPropagation();
        document.dispatchEvent(new CustomEvent('open-person-picker', {
            detail: { mode: 'reattach', pos: getPos(), currentPersonId: currentAttrs.personId, currentNoteId: currentAttrs.noteId }
        }));
    });

    const typeSelect = document.createElement('select');
    typeSelect.className = 'person-panel-type';
    NOTE_TYPES_ALL.forEach(t => {
        const opt = document.createElement('option');
        opt.value = t;
        opt.textContent = t;
        if (t === (node.attrs.noteType || 'Elder Meeting')) opt.selected = true;
        typeSelect.appendChild(opt);
    });
    typeSelect.addEventListener('change', e => {
        e.stopPropagation();
        let newType = typeSelect.value;

        if (newType === 'Create New Note Type') {
            const prompted = prompt('Enter new note type:');
            if (prompted && prompted.trim()) {
                newType = prompted.trim();
                if (!NOTE_TYPES_ALL.includes(newType)) {
                    // Insert before 'Create New Note Type'
                    const base = NOTE_TYPES_ALL.filter(t => t !== 'Create New Note Type');
                    NOTE_TYPES_ALL = [...base, newType, 'Create New Note Type'];
                }
            } else {
                typeSelect.value = node.attrs.noteType || 'Elder Meeting';
                return;
            }
        }

        if (typeof getPos === 'function') {
            editor.view.dispatch(
                editor.view.state.tr.setNodeMarkup(getPos(), null, { ...currentAttrs, noteType: newType })
            );
        }
        db.collection('people').doc(currentAttrs.personId)
            .collection('shepherding_notes').doc(currentAttrs.noteId)
            .update({ type: newType, updatedAt: firebase.firestore.FieldValue.serverTimestamp(), updatedByName: _currentUserName })
            .catch(err => console.error('Error updating note type:', err));
    });

    // Status + tag state for the panel
    let panelCurrentStatus = null;
    let panelPersonTags = [];
    let statusMatrixPopup = null;

    // Status value model from shepherding-core.js; the Person Panel matrix uses
    // the short label variant.
    const PANEL_URGENCY_LEVELS    = ShepherdingCore.URGENCY_LEVELS;
    const PANEL_IMPORTANCE_LEVELS = ShepherdingCore.IMPORTANCE_LEVELS;
    const PANEL_URGENCY_LABEL     = ShepherdingCore.URGENCY_LABEL_SHORT;
    const PANEL_IMPORTANCE_LABEL  = ShepherdingCore.IMPORTANCE_LABEL_SHORT;

    const statusBtn = document.createElement('button');
    statusBtn.type = 'button';
    statusBtn.className = 'person-panel-status';
    statusBtn.title = 'Set pastoral status';

    function updatePanelStatusDisplay() {
        if (panelCurrentStatus) {
            statusBtn.textContent = `${PANEL_URGENCY_LABEL[panelCurrentStatus.urgency] || ''} · ${PANEL_IMPORTANCE_LABEL[panelCurrentStatus.importance] || ''}`;
            statusBtn.style.color = '#436082';
        } else {
            statusBtn.textContent = 'Set status';
            statusBtn.style.color = '#75777f';
        }
    }

    async function loadPanelPersonData(personId) {
        try {
            const snap = await db.collection('people').doc(personId).get();
            if (snap.exists) {
                panelCurrentStatus = snap.data().shepherdingStatus || null;
                panelPersonTags = snap.data().tags || [];
            }
            updatePanelStatusDisplay();
        } catch (e) { console.error('Error loading panel data:', e); }
    }

    async function handlePanelStatusClear() {
        const previousStatus = panelCurrentStatus;
        if (!previousStatus) return;
        destroyStatusPopup();
        try {
            await ShepherdingCore.commitPastoralChange(db, currentAttrs.personId, {
                shepherdingStatus: null,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            }, ShepherdingCore.buildStatusChange({
                previousStatus, newStatus: null,
                authorUid: _currentUserId, authorName: _currentUserName,
                source: 'document', sourceDocumentId: _currentDocId,
            }));
            panelCurrentStatus = null;
            updatePanelStatusDisplay();
        } catch (e) { console.error('Error clearing panel status:', e); }
    }

    function destroyStatusPopup() {
        statusMatrixPopup?.remove();
        statusMatrixPopup = null;
    }

    async function handlePanelStatusSet(urgency, importance) {
        const clearing = panelCurrentStatus?.urgency === urgency && panelCurrentStatus?.importance === importance;
        const previousStatus = panelCurrentStatus;
        const newStatus = clearing ? null : { urgency, importance };
        destroyStatusPopup();
        try {
            await ShepherdingCore.commitPastoralChange(db, currentAttrs.personId, {
                shepherdingStatus: newStatus,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            }, ShepherdingCore.buildStatusChange({
                previousStatus, newStatus,
                authorUid: _currentUserId,
                authorName: _currentUserName,
                source: 'document',
                sourceDocumentId: _currentDocId,
            }));
            panelCurrentStatus = newStatus;
            updatePanelStatusDisplay();
        } catch (e) { console.error('Error setting panel status:', e); }
    }

    function showStatusMatrixPopup(e) {
        e.preventDefault();
        e.stopPropagation();
        if (statusMatrixPopup) { destroyStatusPopup(); return; }

        statusMatrixPopup = document.createElement('div');
        statusMatrixPopup.style.cssText = 'position:fixed;z-index:9999;background:#fff;border:1px solid #c5c6d0;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.12);padding:10px;font-family:"Work Sans",sans-serif;font-size:12px;';

        const headerRow = document.createElement('div');
        headerRow.style.cssText = 'display:grid;grid-template-columns:44px 44px 44px 44px;gap:3px;margin-bottom:3px;';
        headerRow.appendChild(document.createElement('div'));
        PANEL_URGENCY_LEVELS.forEach(u => {
            const h = document.createElement('div');
            h.style.cssText = 'text-align:center;font-size:9px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:#75777f;padding-bottom:2px;';
            h.textContent = PANEL_URGENCY_LABEL[u].slice(0, 3);
            headerRow.appendChild(h);
        });
        statusMatrixPopup.appendChild(headerRow);

        PANEL_IMPORTANCE_LEVELS.forEach(imp => {
            const row = document.createElement('div');
            row.style.cssText = 'display:grid;grid-template-columns:44px 44px 44px 44px;gap:3px;margin-bottom:3px;';
            const rowLabel = document.createElement('div');
            rowLabel.style.cssText = 'display:flex;align-items:center;justify-content:flex-end;padding-right:4px;font-size:9px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:#75777f;line-height:1.2;text-align:right;';
            rowLabel.textContent = PANEL_IMPORTANCE_LABEL[imp].slice(0, 3);
            row.appendChild(rowLabel);
            PANEL_URGENCY_LEVELS.forEach(urg => {
                const isActive = panelCurrentStatus?.urgency === urg && panelCurrentStatus?.importance === imp;
                const cell = document.createElement('button');
                cell.type = 'button';
                cell.style.cssText = `width:44px;height:44px;border-radius:6px;border:2px solid ${isActive ? '#001a43' : '#c5c6d0'};background:${isActive ? '#001a43' : 'transparent'};cursor:pointer;display:flex;align-items:center;justify-content:center;`;
                if (isActive) {
                    const dot = document.createElement('span');
                    dot.style.cssText = 'width:8px;height:8px;border-radius:50%;background:#fff;display:block;';
                    cell.appendChild(dot);
                }
                cell.addEventListener('mousedown', e2 => { e2.preventDefault(); e2.stopPropagation(); handlePanelStatusSet(urg, imp); });
                row.appendChild(cell);
            });
            statusMatrixPopup.appendChild(row);
        });

        if (panelCurrentStatus) {
            const clearBtn = document.createElement('button');
            clearBtn.type = 'button';
            clearBtn.style.cssText = 'width:100%;margin-top:6px;padding:4px 8px;font-size:11px;font-family:inherit;color:#75777f;background:transparent;border:none;cursor:pointer;text-align:center;';
            clearBtn.textContent = 'Clear status';
            clearBtn.addEventListener('mousedown', e2 => { e2.preventDefault(); e2.stopPropagation(); handlePanelStatusSet(panelCurrentStatus.urgency, panelCurrentStatus.importance); });
            statusMatrixPopup.appendChild(clearBtn);
        }

        const rect = statusBtn.getBoundingClientRect();
        statusMatrixPopup.style.top  = `${rect.bottom + 4}px`;
        statusMatrixPopup.style.left = `${Math.min(rect.left, window.innerWidth - 210)}px`;
        document.body.appendChild(statusMatrixPopup);

        const closeOnOutside = ev => {
            if (!statusMatrixPopup?.contains(ev.target) && ev.target !== statusBtn) {
                destroyStatusPopup();
                document.removeEventListener('mousedown', closeOnOutside);
            }
        };
        setTimeout(() => document.addEventListener('mousedown', closeOnOutside), 0);
    }

    statusBtn.addEventListener('mousedown', showStatusMatrixPopup);
    updatePanelStatusDisplay();
    loadPanelPersonData(node.attrs.personId);

    const viewLink = document.createElement('a');
    viewLink.className = 'person-panel-view-link';
    viewLink.textContent = 'View profile →';
    viewLink.href = `shepherding-profile.html?id=${node.attrs.personId}&fromPage=document&fromId=${encodeURIComponent(_currentDocId || '')}&fromTitle=${encodeURIComponent(_currentDocTitle || '')}`;
    viewLink.target = '_blank';
    viewLink.addEventListener('mousedown', e => e.stopPropagation());

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'person-panel-delete';
    deleteBtn.title = 'Remove panel';
    deleteBtn.innerHTML = '<span style="font-family:\'Material Symbols Outlined\';font-size:16px;font-variation-settings:\'FILL\' 0">close</span>';
    deleteBtn.addEventListener('mousedown', e => {
        e.preventDefault();
        e.stopPropagation();
        document.dispatchEvent(new CustomEvent('panel-delete-request', {
            detail: { pos: getPos(), personId: currentAttrs.personId, noteId: currentAttrs.noteId, personName: currentAttrs.personName }
        }));
    });

    header.appendChild(nameBtn);
    header.appendChild(typeSelect);
    header.appendChild(statusBtn);
    header.appendChild(viewLink);
    header.appendChild(deleteBtn);

    // Body
    const bodyMount = document.createElement('div');
    bodyMount.className = 'person-panel-body';

    dom.appendChild(header);
    dom.appendChild(bodyMount);

    // ── Body editor lifecycle ──
    let bodyEditor = null;
    let bodyTimer  = null;

    async function initBodyEditor(attrs) {
        if (bodyEditor) { bodyEditor.destroy(); bodyEditor = null; }
        clearTimeout(bodyTimer);
        if (!window._TipTap) return;
        try {
            const snap = await db.collection('people').doc(attrs.personId)
                .collection('shepherding_notes').doc(attrs.noteId).get();

            if (!snap.exists) {
                // Note was deleted — replace this panel with header + any saved body content
                setTimeout(() => {
                    if (typeof getPos !== 'function') return;
                    try {
                        const pos = getPos();
                        if (pos === undefined || pos === null) return;
                        const headerText = `${attrs.personName} — ${attrs.noteType}`;
                        const replacement = [
                            { type: 'paragraph', content: [{ type: 'text', text: headerText, marks: [{ type: 'bold' }] }] },
                        ];
                        if (attrs.bodySnapshot) {
                            try {
                                const snap2 = JSON.parse(attrs.bodySnapshot);
                                if (snap2 && snap2.content && snap2.content.length > 0) {
                                    replacement.push(...snap2.content);
                                }
                            } catch (_) {}
                        }
                        editor.chain().insertContentAt({ from: pos, to: pos + 1 }, replacement).run();
                    } catch (e) {
                        console.error('Error replacing orphaned panel:', e);
                    }
                }, 0);
                return;
            }

            const content = snap.data().contentJson || '';
            const { Editor, StarterKit, Underline, TextStyle, FontFamily, FontSize, Highlight } = window._TipTap;
            const trigExt = createInlineTriggersExtension({
                personId: attrs.personId,
                getAllTags:       () => _allTagsList,
                getPersonTags:   () => panelPersonTags,
                getCurrentStatus: () => panelCurrentStatus,
                createTag: async (name) => {
                    const trimmed = name.trim();
                    await db.collection('people_tags').doc(trimmed).set({ name: trimmed, hiddenFromOthers: false, hidePeople: false });
                    if (!_allTagsList.find(t => t.id === trimmed)) _allTagsList.push({ id: trimmed, name: trimmed });
                    return { id: trimmed, name: trimmed };
                },
                onTagAdd: async (tagId, tagName) => {
                    await ShepherdingCore.commitPastoralChange(db, attrs.personId,
                        { tags: firebase.firestore.FieldValue.arrayUnion(tagId) },
                        ShepherdingCore.buildTagChange({
                            tagId, tagName, action: 'added',
                            authorUid: _currentUserId, authorName: _currentUserName,
                            source: 'document', sourceDocumentId: _currentDocId,
                        }));
                    if (!panelPersonTags.includes(tagId)) panelPersonTags = [...panelPersonTags, tagId];
                },
                onTagRemove: async (tagId, tagName) => {
                    await ShepherdingCore.commitPastoralChange(db, attrs.personId,
                        { tags: firebase.firestore.FieldValue.arrayRemove(tagId) },
                        ShepherdingCore.buildTagChange({
                            tagId, tagName, action: 'removed',
                            authorUid: _currentUserId, authorName: _currentUserName,
                            source: 'document', sourceDocumentId: _currentDocId,
                        }));
                    panelPersonTags = panelPersonTags.filter(t => t !== tagId);
                },
                onStatusChange: async (urg, imp) => {
                    if (!urg) await handlePanelStatusClear();
                    else await handlePanelStatusSet(urg, imp);
                },
            });
            bodyEditor = new Editor({
                element: bodyMount,
                extensions: [StarterKit, Underline, TextStyle, FontFamily, FontSize, Highlight.configure({ multicolor: true }), trigExt],
                content,
                onUpdate() {
                    clearTimeout(bodyTimer);
                    bodyTimer = setTimeout(() => saveBody(attrs), 1500);
                },
            });
        } catch (err) {
            console.error('Error loading panel body:', err);
        }
    }

    async function saveBody(attrs) {
        if (!bodyEditor) return;
        const bodyJson = bodyEditor.getJSON();
        try {
            await db.collection('people').doc(attrs.personId)
                .collection('shepherding_notes').doc(attrs.noteId)
                .update({
                    contentJson: bodyJson,
                    content: bodyEditor.getText().trim(),
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                    updatedByName: _currentUserName,
                    sourceDocumentId: _currentDocId,
                });
            // Persist body snapshot in panel attrs so orphan detection can recover content
            if (typeof getPos === 'function') {
                const pos = getPos();
                if (pos !== undefined) {
                    editor.view.dispatch(
                        editor.view.state.tr.setNodeMarkup(pos, null, {
                            ...currentAttrs,
                            bodySnapshot: JSON.stringify(bodyJson),
                        })
                    );
                }
            }
        } catch (err) {
            console.error('Error saving panel body:', err);
        }
    }

    initBodyEditor(node.attrs);

    return {
        dom,
        contentDOM: null,

        update(updatedNode) {
            if (updatedNode.type.name !== 'personPanel') return false;

            nameBtn.textContent = updatedNode.attrs.personName || 'Unknown Person';
            typeSelect.value    = updatedNode.attrs.noteType || 'Elder Meeting';
            viewLink.href       = `shepherding-profile.html?id=${updatedNode.attrs.personId}`;

            if (updatedNode.attrs.personId !== currentAttrs.personId ||
                updatedNode.attrs.noteId   !== currentAttrs.noteId) {
                clearTimeout(bodyTimer);
                currentAttrs = { ...updatedNode.attrs };
                initBodyEditor(currentAttrs);
                loadPanelPersonData(currentAttrs.personId);
            } else {
                currentAttrs = { ...updatedNode.attrs };
            }
            return true;
        },

        destroy() {
            clearTimeout(bodyTimer);
            if (bodyEditor) { bodyEditor.destroy(); bodyEditor = null; }
            destroyStatusPopup();
        },

        stopEvent(event) {
            if (typeSelect.contains(event.target)) return true;
            if (statusBtn.contains(event.target)) return true;
            if (statusMatrixPopup?.contains(event.target)) return true;
            if (header.contains(event.target)) return false;
            return bodyMount.contains(event.target);
        },

        ignoreMutation() { return true; },
    };
}

// ── PersonPanel TipTap node ───────────────────────────────────────────────────

function createPersonPanelNode() {
    const { Node, InputRule } = window._TipTap;

    return Node.create({
        name: 'personPanel',
        group: 'block',
        atom: true,
        selectable: true,
        draggable: true,

        addAttributes() {
            return {
                personId:     { default: '' },
                noteId:       { default: '' },
                personName:   { default: '' },
                noteType:     { default: 'Elder Meeting' },
                bodySnapshot: { default: null },
            };
        },

        parseHTML()  { return [{ tag: 'div[data-person-panel]' }]; },
        renderHTML() { return ['div', { 'data-person-panel': '' }]; },

        addNodeView() {
            return (props) => makePersonPanelNodeView(props);
        },
    });
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

        // ── Person picker ──
        showPersonPicker: false,
        _pickerMode: 'insert',        // 'insert' | 'reattach'
        _pickerReattachPos: null,
        _pickerCurrentPersonId: null,
        _pickerCurrentNoteId: null,
        pickerStep: 'person',         // 'person' | 'note-mode'
        pickerSearch: '',
        pickerSelected: null,         // { id, name }
        pickerNoteMode: 'new',        // 'new' | 'existing'
        pickerExistingNotes: [],
        pickerSelectedNoteId: null,

        // ── Panel delete dialog ──
        showPanelDeleteDialog: false,
        _deletePos: null,
        _deletePersonId: null,
        _deleteNoteId: null,
        panelDeletePersonName: '',

        toast: { show: false, message: '', type: 'success' },

        // ── Computed ──
        get filteredPeople() {
            const q = this.pickerSearch.toLowerCase();
            return _peopleList.filter(p => p.name.toLowerCase().includes(q));
        },

        async init() {
            const params = new URLSearchParams(window.location.search);
            this.docId = params.get('id');
            if (!this.docId) { window.location.href = 'shepherding-documents.html'; return; }

            this._onKeyDown = e => {
                if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                    e.preventDefault();
                    clearTimeout(this._saveTimer);
                    this.save();
                }
            };
            window.addEventListener('keydown', this._onKeyDown);

            // Listen for NodeView events (dispatched on document, not window)
            document.addEventListener('open-person-picker', e => this._handleOpenPicker(e.detail));
            document.addEventListener('panel-delete-request', e => this._handleDeleteRequest(e.detail));

            // Cross-tab: react when a profile tab deletes a note linked to this document
            this._bc = new BroadcastChannel('mosaic-shepherding');
            this._bc.onmessage = (e) => {
                if (e.data?.type === 'note-deleted' && e.data.sourceDocumentId === this.docId) {
                    this._replaceOrphanedPanel(e.data.noteId, e.data.personName, e.data.noteType, e.data.bodySnapshot);
                }
            };
            window.addEventListener('beforeunload', () => this._bc?.close());

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
                _currentUserName = this.currentUserName;
                _currentUserId   = user.uid;

                await this.loadDoc();
                this.loading = false;
                this.$nextTick(() => this.initEditor());
            });
        },

        async loadDoc() {
            try {
                const snap = await db.collection('elder_documents').doc(this.docId).get();
                if (!snap.exists) { window.location.href = 'shepherding-documents.html'; return; }
                this.doc  = { id: snap.id, ...snap.data() };
                this.title = this.doc.title || '';
                _currentDocId    = this.docId;
                _currentDocTitle = this.title;
            } catch (e) {
                console.error('Error loading document:', e);
                this.showToast('Error loading document', 'error');
            }
        },

        // ── Editor ────────────────────────────────────────────────────────────

        async initEditor() {
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

            const el = document.getElementById('tiptap-doc-editor');
            if (!el) return;
            if (_docEditor) { _docEditor.destroy(); _docEditor = null; }

            const { Editor, StarterKit, Underline, Mention, TextStyle, FontFamily, FontSize, Highlight, Table, TableRow, TableHeader, TableCell } = window._TipTap;
            const PersonPanelNode = createPersonPanelNode();
            const InlinePickerExtension = createInlinePickerPlugin();
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
                    PersonPanelNode,
                    InlinePickerExtension,
                    Mention.configure({
                        HTMLAttributes: { class: 'mention-chip' },
                        suggestion: createDocMentionSuggestion(),
                    }),
                ],
                content: this.doc?.contentJson || '',
                editorProps: {
                    handleClick(view, pos, event) {
                        const target = event.target.closest('.mention-chip');
                        if (!target) return false;

                        const actualPos = view.posAtDOM(target, 0);
                        const node = view.state.doc.nodeAt(actualPos);
                        if (node && node.type.name === 'mention') {
                            const rawId = node.attrs?.id || '';
                            let parsed = null;
                            try { parsed = JSON.parse(rawId); } catch {}
                            if (!parsed) return false;

                            if (parsed.kind === 'person') {
                                window.location.href = `shepherding-profile.html?id=${encodeURIComponent(parsed.id)}&fromPage=document&fromId=${encodeURIComponent(_currentDocId||'')}&fromTitle=${encodeURIComponent(_currentDocTitle||'')}`;
                            } else if (parsed.kind === 'note' && parsed.personId) {
                                window.location.href = `shepherding-profile.html?id=${encodeURIComponent(parsed.personId)}&fromPage=document&fromId=${encodeURIComponent(_currentDocId||'')}&fromTitle=${encodeURIComponent(_currentDocTitle||'')}`;
                            } else if (parsed.kind === 'elder_document') {
                                window.location.href = `shepherding-document.html?id=${encodeURIComponent(parsed.id)}`;
                            } else if (parsed.kind === 'elder_folder') {
                                window.location.href = `shepherding-documents.html?folder=${encodeURIComponent(parsed.id)}`;
                            }
                            return true;
                        }
                        return false;
                    },
                },
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

        // ── Person Panel ──────────────────────────────────────────────────────

        insertPersonPanel() {
            document.dispatchEvent(new CustomEvent('open-person-picker', { detail: { mode: 'insert' } }));
        },

        _handleOpenPicker(detail) {
            this._pickerMode             = detail.mode || 'insert';
            this._pickerReattachPos      = detail.pos ?? null;
            this._pickerCurrentPersonId  = detail.currentPersonId || null;
            this._pickerCurrentNoteId    = detail.currentNoteId   || null;
            this.pickerStep              = 'person';
            this.pickerSearch            = '';
            this.pickerSelected          = null;
            this.pickerNoteMode          = 'new';
            this.pickerExistingNotes     = [];
            this.pickerSelectedNoteId    = null;
            this.showPersonPicker        = true;
        },

        async selectPersonForPicker(person) {
            this.pickerSelected = person;
            this.pickerStep     = 'note-mode';
            try {
                const snap = await db.collection('people').doc(person.id)
                    .collection('shepherding_notes')
                    .orderBy('createdAt', 'desc')
                    .get();
                this.pickerExistingNotes = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            } catch { this.pickerExistingNotes = []; }
        },

        async confirmPersonPicker() {
            if (!this.pickerSelected) return;
            const person   = this.pickerSelected;
            const isNew    = this.pickerNoteMode === 'new';
            const existId  = this.pickerSelectedNoteId;
            if (!isNew && !existId) return;

            this.showPersonPicker = false;

            try {
                let noteId;
                if (isNew) {
                    const ref = await db.collection('people').doc(person.id)
                        .collection('shepherding_notes').add({
                            type:            'Elder Meeting',
                            subject:         '',
                            contentJson:     null,
                            content:         '',
                            authorName:      this.currentUserName,
                            authorUid:       this.currentUser.uid,
                            createdAt:       firebase.firestore.FieldValue.serverTimestamp(),
                            sourceDocumentId: this.docId,
                        });
                    noteId = ref.id;
                } else {
                    noteId = existId;
                    // Add sourceDocumentId to existing note
                    await db.collection('people').doc(person.id)
                        .collection('shepherding_notes').doc(noteId)
                        .update({ sourceDocumentId: this.docId });
                }

                if (this._pickerMode === 'insert') {
                    _docEditor?.chain().focus().insertContent({
                        type:  'personPanel',
                        attrs: { personId: person.id, noteId, personName: person.name, noteType: 'Elder Meeting' },
                    }).run();
                } else {
                    // Reattach: move note from old person to new person
                    await this._moveNote(
                        this._pickerCurrentPersonId,
                        this._pickerCurrentNoteId,
                        person.id,
                        noteId,
                        person.name,
                        this._pickerReattachPos
                    );
                }
            } catch (e) {
                console.error('Error in person picker confirm:', e);
                this.showToast('Error creating note', 'error');
            }
        },

        async _moveNote(oldPersonId, oldNoteId, newPersonId, newNoteId, newPersonName, pos) {
            // If new note was newly created, the old note needs to be migrated
            // (if linking existing, the old note stays on old person — only attrs update)
            if (this.pickerNoteMode === 'new' && oldNoteId) {
                try {
                    // Copy old note content to new note
                    const oldSnap = await db.collection('people').doc(oldPersonId)
                        .collection('shepherding_notes').doc(oldNoteId).get();
                    if (oldSnap.exists) {
                        await db.collection('people').doc(newPersonId)
                            .collection('shepherding_notes').doc(newNoteId)
                            .update({
                                contentJson: oldSnap.data().contentJson || null,
                                content:     oldSnap.data().content     || '',
                            });
                    }
                    // Delete old note
                    await db.collection('people').doc(oldPersonId)
                        .collection('shepherding_notes').doc(oldNoteId).delete();
                } catch (e) {
                    console.error('Error moving note:', e);
                }
            }

            // Update node attrs
            if (_docEditor && typeof pos === 'number') {
                const { state, view } = _docEditor;
                const node = state.doc.nodeAt(pos);
                if (node && node.type.name === 'personPanel') {
                    view.dispatch(
                        state.tr.setNodeMarkup(pos, null, {
                            ...node.attrs,
                            personId:   newPersonId,
                            noteId:     newNoteId,
                            personName: newPersonName,
                        })
                    );
                }
            }
        },

        _handleDeleteRequest(detail) {
            this._deletePos        = detail.pos;
            this._deletePersonId   = detail.personId;
            this._deleteNoteId     = detail.noteId;
            this.panelDeletePersonName = detail.personName || 'this person';
            this.showPanelDeleteDialog = true;
        },

        _replaceOrphanedPanel(noteId, personName, noteType, bodySnapshot) {
            if (!_docEditor) return;
            const { state } = _docEditor.view;
            let targetPos = null;
            let targetAttrs = null;
            state.doc.descendants((node, pos) => {
                if (node.type.name === 'personPanel' && node.attrs.noteId === noteId) {
                    targetPos = pos;
                    targetAttrs = node.attrs;
                    return false;
                }
            });
            if (targetPos === null) return;

            const name = personName || targetAttrs.personName || '';
            const type = noteType  || targetAttrs.noteType  || '';
            const headerText = [name, type].filter(Boolean).join(' — ');
            const replacement = [
                { type: 'paragraph', content: [{ type: 'text', text: headerText, marks: [{ type: 'bold' }] }] },
            ];
            const snapshotStr = bodySnapshot || targetAttrs.bodySnapshot;
            if (snapshotStr) {
                try {
                    const snap = JSON.parse(snapshotStr);
                    if (snap?.content?.length > 0) replacement.push(...snap.content);
                } catch (_) {}
            }
            _docEditor.chain()
                .insertContentAt({ from: targetPos, to: targetPos + 1 }, replacement)
                .run();
        },

        async executePanelDelete(deleteNote) {
            this.showPanelDeleteDialog = false;
            const pos      = this._deletePos;
            const personId = this._deletePersonId;
            const noteId   = this._deleteNoteId;

            // Remove node from document
            if (_docEditor && typeof pos === 'number') {
                const { state, view } = _docEditor;
                const node = state.doc.nodeAt(pos);
                if (node) {
                    view.dispatch(state.tr.delete(pos, pos + node.nodeSize));
                }
            }

            if (deleteNote) {
                try {
                    await db.collection('people').doc(personId)
                        .collection('shepherding_notes').doc(noteId).delete();
                } catch (e) {
                    console.error('Error deleting note:', e);
                    this.showToast('Error deleting note', 'error');
                }
            } else {
                // Unlink — clear sourceDocumentId so it becomes a standalone note
                try {
                    await db.collection('people').doc(personId)
                        .collection('shepherding_notes').doc(noteId)
                        .update({ sourceDocumentId: firebase.firestore.FieldValue.delete() });
                } catch (e) {
                    console.error('Error unlinking note:', e);
                }
            }
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
                await db.collection('elder_documents').doc(this.docId).update({
                    title:          this.title.trim() || 'Untitled Document',
                    contentJson:    _docEditor.getJSON(),
                    updatedAt:      firebase.firestore.FieldValue.serverTimestamp(),
                    updatedByName:  this.currentUserName,
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
