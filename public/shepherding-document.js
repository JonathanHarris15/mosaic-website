// ── Module-level state shared with NodeViews ──────────────────────────────────
let _currentDocId    = null;
let _currentDocTitle = '';
let _currentUserName = '';
let _currentUserId   = '';

let _docEditor = null;

// The open document, live: block-by-block saves, other elders' changes, and
// one person per box (elder-document-live.js, shared with the phone).
let _live = null;
let _openedBody = null;

// A face for whoever holds a box: their photo or initials, their first name
// and a lock.
function _faceFor(holder, inline) {
    const badge = document.createElement('span');
    badge.className = 'doc-held' + (inline ? ' doc-held--inline' : '');
    badge.title = PresenceCore.holderTitle(holder);
    const avatar = document.createElement('span');
    avatar.className = 'm-avatar m-avatar--sm';
    if (holder.photoUrl) {
        const img = document.createElement('img');
        img.src = holder.photoUrl;
        img.alt = '';
        img.setAttribute('style', PersonPhotoCore.frameStyle(holder.photoCrop));
        avatar.appendChild(img);
    } else {
        avatar.textContent = PersonPhotoCore.initialsOf(holder.name);
    }
    const name = document.createElement('span');
    name.className = 'doc-held__name';
    name.textContent = PresenceCore.holderLabel(holder);
    const lock = document.createElement('span');
    lock.className = 'material-symbols-outlined doc-held__lock';
    lock.textContent = 'lock';
    badge.append(avatar, name, lock);
    return badge;
}

// "Ann is editing this" — told to the page, from anywhere a change was refused.
function _notifyHeld(holder, what) {
    document.dispatchEvent(new CustomEvent('doc-held', { detail: { holder, what } }));
}

// ⚠ KEPT OUT OF ALPINE STATE ON PURPOSE. Alpine wraps state in a proxy, and a
// proxied File is no longer a File to FileReader — the brand check fails and
// the read throws. Only what the dialog needs to SAY goes into state.
let _pendingImageFile = null;

function _describeBytes(bytes) {
    const n = Number(bytes) || 0;
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return Math.round(n / 1024) + ' KB';
    return (Math.round(n / (1024 * 1024) * 10) / 10) + ' MB';
}

let _mentionPeople   = [];
let _mentionNotes    = [];
let _mentionDocs     = [];
let _mentionFolders  = [];
let _docTypeById     = {}; // elder_document id → docType (e.g. 'care-list')
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
            // MS-98: a profile-owned document is mentionable only once opted into
            // the Library. Plain Library documents (no ownerPersonId) are unaffected.
            _mentionDocs = docsResult.value.docs
                .filter(doc => { const d = doc.data(); return !(d.ownerPersonId && d.inLibrary !== true); })
                .map(doc => {
                    const d = doc.data();
                    _docTypeById[doc.id] = d.docType || 'note';
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
                    popup.style.cssText = 'position:fixed;z-index:9999;background:var(--surface-container-lowest);border:1px solid var(--outline-variant);border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.12);min-width:220px;max-height:280px;overflow-y:auto;padding:4px 0;font-family:"Work Sans",sans-serif;font-size:14px;';
                    document.body.appendChild(popup);
                }
                if (rect) {
                    const r = typeof rect === 'function' ? rect() : rect;
                    if (r) { popup.style.left = `${Math.min(r.left, window.innerWidth - 240)}px`; popup.style.top = `${r.bottom + 4}px`; }
                }
                popup.innerHTML = '';
                if (!items.length) {
                    const el = document.createElement('div');
                    el.style.cssText = 'padding:8px 16px;color:var(--on-surface-variant);font-style:italic;';
                    el.textContent = 'No matches';
                    popup.appendChild(el);
                    return;
                }
                const grouped = buildGrouped(items);
                let si = 0;
                grouped.forEach(entry => {
                    if (entry._hdr) {
                        const el = document.createElement('div');
                        el.style.cssText = 'padding:4px 16px 2px;font-size:11px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--on-surface-variant);';
                        el.textContent = entry._hdr;
                        popup.appendChild(el);
                    } else {
                        const myI = si++;
                        const el = document.createElement('button');
                        el.type = 'button';
                        el.style.cssText = `display:block;width:100%;text-align:left;padding:6px 16px;cursor:pointer;border:none;background:${myI === selIdx ? 'var(--primary-fixed)' : 'transparent'};color:${myI === selIdx ? 'var(--primary)' : 'var(--on-surface)'};font-size:14px;font-family:inherit;`;
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
            popup.style.cssText = 'position:fixed;z-index:9999;background:var(--surface-container-lowest);color:var(--on-surface);border:1px solid var(--outline-variant);border-radius:8px;box-shadow:0 4px 20px rgba(0,0,0,.14);min-width:260px;padding:4px 0;font-family:"Work Sans",sans-serif;font-size:14px;';
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
        hdr.style.cssText = 'padding:4px 16px 2px;font-size:11px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--on-surface-variant);';
        hdr.textContent = labels[ps.phase] || 'Insert';
        popup.appendChild(hdr);

        if (!items.length) {
            const el = document.createElement('div');
            el.style.cssText = 'padding:8px 16px;color:var(--on-surface-variant);font-style:italic;';
            el.textContent = ps.phase === 'person' ? 'No people found' : 'No matches';
            popup.appendChild(el);
            return;
        }

        items.forEach((item, i) => {
            const sel = i === ps.selectedIndex;
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.style.cssText = `display:flex;align-items:center;gap:12px;width:100%;text-align:left;padding:8px 16px;cursor:pointer;border:none;background:${sel ? 'var(--primary-fixed)' : 'transparent'};`;
            const ico = document.createElement('span');
            ico.style.cssText = `font-family:'Material Symbols Outlined';font-size:20px;font-variation-settings:'FILL' 0;color:${sel ? 'var(--primary)' : 'var(--on-surface-variant)'};flex-shrink:0;line-height:1;`;
            ico.textContent = item.icon || 'chevron_right';
            const txt = document.createElement('div');
            const ttl = document.createElement('div');
            ttl.style.cssText = `font-weight:600;color:${sel ? 'var(--primary)' : 'var(--on-surface)'};font-size:14px;font-family:inherit;`;
            ttl.textContent = item.title;
            txt.appendChild(ttl);
            if (item.description) {
                const dsc = document.createElement('div');
                dsc.style.cssText = 'font-size:12px;color:var(--on-surface-variant);font-family:inherit;';
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
        if (panelIsHeld()) return;
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

        if (panelIsHeld()) { typeSelect.value = currentAttrs.noteType || 'Elder Meeting'; return; }
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
            statusBtn.style.color = 'var(--secondary)';
        } else {
            statusBtn.textContent = 'Set status';
            statusBtn.style.color = 'var(--on-surface-variant)';
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
            const activityId = await ShepherdingCore.commitPastoralChange(db, currentAttrs.personId, {
                shepherdingStatus: null,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            }, ShepherdingCore.buildStatusChange({
                previousStatus, newStatus: null,
                authorUid: _currentUserId, authorName: _currentUserName,
                source: 'document', sourceDocumentId: _currentDocId,
            }));
            panelCurrentStatus = null;
            updatePanelStatusDisplay();
            return activityId;
        } catch (e) { console.error('Error clearing panel status:', e); }
    }

    // Take a status change back entirely (its chip was backspaced out): restore
    // the previous status and delete the logged record, leaving no timeline trace.
    async function handlePanelStatusUndo(activityId, prevUrgency, prevImportance) {
        const prevStatus = (prevUrgency && prevImportance) ? { urgency: prevUrgency, importance: prevImportance } : null;
        try {
            await ShepherdingCore.revertPastoralChange(db, currentAttrs.personId, {
                shepherdingStatus: prevStatus,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            }, activityId);
            panelCurrentStatus = prevStatus;
            updatePanelStatusDisplay();
        } catch (e) { console.error('Error undoing panel status:', e); }
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
            const activityId = await ShepherdingCore.commitPastoralChange(db, currentAttrs.personId, {
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
            return activityId;
        } catch (e) { console.error('Error setting panel status:', e); }
    }

    function showStatusMatrixPopup(e) {
        e.preventDefault();
        e.stopPropagation();
        if (statusMatrixPopup) { destroyStatusPopup(); return; }

        statusMatrixPopup = document.createElement('div');
        statusMatrixPopup.style.cssText = 'position:fixed;z-index:9999;background:var(--surface-container-lowest);border:1px solid var(--outline-variant);border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.12);padding:10px;font-family:"Work Sans",sans-serif;font-size:12px;';

        const headerRow = document.createElement('div');
        headerRow.style.cssText = 'display:grid;grid-template-columns:44px 44px 44px 44px;gap:3px;margin-bottom:3px;';
        headerRow.appendChild(document.createElement('div'));
        PANEL_URGENCY_LEVELS.forEach(u => {
            const h = document.createElement('div');
            h.style.cssText = 'text-align:center;font-size:9px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--on-surface-variant);padding-bottom:2px;';
            h.textContent = PANEL_URGENCY_LABEL[u].slice(0, 3);
            headerRow.appendChild(h);
        });
        statusMatrixPopup.appendChild(headerRow);

        PANEL_IMPORTANCE_LEVELS.forEach(imp => {
            const row = document.createElement('div');
            row.style.cssText = 'display:grid;grid-template-columns:44px 44px 44px 44px;gap:3px;margin-bottom:3px;';
            const rowLabel = document.createElement('div');
            rowLabel.style.cssText = 'display:flex;align-items:center;justify-content:flex-end;padding-right:4px;font-size:9px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--on-surface-variant);line-height:1.2;text-align:right;';
            rowLabel.textContent = PANEL_IMPORTANCE_LABEL[imp].slice(0, 3);
            row.appendChild(rowLabel);
            PANEL_URGENCY_LEVELS.forEach(urg => {
                const isActive = panelCurrentStatus?.urgency === urg && panelCurrentStatus?.importance === imp;
                const cell = document.createElement('button');
                cell.type = 'button';
                cell.style.cssText = `width:44px;height:44px;border-radius:6px;border:2px solid ${isActive ? 'var(--primary)' : 'var(--outline-variant)'};background:${isActive ? 'var(--primary)' : 'transparent'};cursor:pointer;display:flex;align-items:center;justify-content:center;`;
                if (isActive) {
                    const dot = document.createElement('span');
                    dot.style.cssText = 'width:8px;height:8px;border-radius:50%;background:var(--surface-container-lowest);display:block;';
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
            clearBtn.style.cssText = 'width:100%;margin-top:6px;padding:4px 8px;font-size:11px;font-family:inherit;color:var(--on-surface-variant);background:transparent;border:none;cursor:pointer;text-align:center;';
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
        if (panelIsHeld()) return;
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
    let bodyDirty  = false;     // typed here and not yet saved
    let bodySaving = null;
    let stopNoteWatch = null;
    let panelHeldBy = null;

    // Somebody else has this note open — here, in another document, or on the
    // profile: the body is read-only and says who (MS-506).
    const heldBadge = document.createElement('span');
    heldBadge.className = 'doc-held person-panel-held';
    heldBadge.hidden = true;
    header.appendChild(heldBadge);

    function showPanelHolder() {
        const holder = _live ? _live.panelHolder(currentAttrs.personId, currentAttrs.noteId) : null;
        const same = (holder && holder.uid) === (panelHeldBy && panelHeldBy.uid);
        panelHeldBy = holder;
        if (!same) {
            heldBadge.hidden = !holder;
            heldBadge.innerHTML = '';
            if (holder) heldBadge.appendChild(_faceFor(holder, true));
        }
        if (bodyEditor && !bodyEditor.isDestroyed) bodyEditor.setEditable(!holder && !(_live && _live.readOnly));
    }

    function panelIsHeld() {
        const holder = _live ? _live.panelHolder(currentAttrs.personId, currentAttrs.noteId) : null;
        if (holder) _notifyHeld(holder, 'this note');
        return !!holder;
    }

    // Replace a panel whose note has gone, the same way on every page, as
    // Blocks the live watch brings back to everybody.
    function replaceOrphan(attrs) {
        if (_live && attrs.noteId) _live.replaceOrphanPanel(attrs.noteId);
    }

    async function initBodyEditor(attrs) {
        if (stopNoteWatch) { stopNoteWatch(); stopNoteWatch = null; }
        if (bodyEditor) { bodyEditor.destroy(); bodyEditor = null; }
        clearTimeout(bodyTimer);
        bodyDirty = false;
        if (!window._TipTap) return;
        try {
            const noteRef = db.collection('people').doc(attrs.personId)
                .collection('shepherding_notes').doc(attrs.noteId);
            const snap = await noteRef.get();

            if (!snap.exists) {
                replaceOrphan(attrs);
                return;
            }

            const content = snap.data().contentJson || '';
            const { Editor, StarterKit, Underline, TextStyle, FontFamily, FontSize, Highlight, Image, Link, TextAlign } = window._TipTap;
            const trigExt = createInlineTriggersExtension({
                personId: attrs.personId,
                getAllTags:       () => _allTagsList,
                getPersonTags:   () => panelPersonTags,
                getCurrentStatus: () => panelCurrentStatus,
                createTag: async (name) => {
                    const trimmed = name.trim();
                    // Stable auto-id identity, independent of the name (ADR-0011).
                    const ref = await db.collection('people_tags').add({ name: trimmed, hiddenFromOthers: false, hidePeople: false });
                    if (!_allTagsList.find(t => t.id === ref.id)) _allTagsList.push({ id: ref.id, name: trimmed });
                    return { id: ref.id, name: trimmed };
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
                    if (!urg) return await handlePanelStatusClear();
                    return await handlePanelStatusSet(urg, imp);
                },
                onStatusUndo: (activityId, urg, imp) => handlePanelStatusUndo(activityId, urg, imp),
            });
            const { Extension, Plugin, PluginKey } = window._TipTap;
            // The note's box, held on the first keystroke; a keystroke while
            // somebody else holds it changes nothing (MS-506).
            const noteLock = Extension.create({
                name: 'panelNoteLock',
                addProseMirrorPlugins() {
                    return [new Plugin({
                        key: new PluginKey('panelNoteLock'),
                        filterTransaction(tr) {
                            if (!tr.docChanged || tr.getMeta('remote')) return true;
                            if (!_live) return true;
                            return _live.holdPanel(currentAttrs.personId, currentAttrs.noteId);
                        },
                    })];
                },
            });
            bodyEditor = new Editor({
                element: bodyMount,
                extensions: [
                    StarterKit, Underline, TextStyle, FontFamily, FontSize,
                    Highlight.configure({ multicolor: true }),
                    Image.configure({ inline: false, allowBase64: true }),
                    Link.configure({ openOnClick: false, autolink: true }),
                    TextAlign.configure({ types: ['heading', 'paragraph'] }),
                    trigExt,
                    noteLock,
                ],
                content,
                onUpdate({ editor: body, transaction }) {
                    if (transaction && transaction.getMeta('remote')) return;
                    // A keystroke the lock refused changed nothing.
                    if (transaction && body.state.doc === transaction.before) return;
                    bodyDirty = true;
                    clearTimeout(bodyTimer);
                    bodyTimer = setTimeout(() => saveBody(attrs), 1500);
                },
                onBlur() {
                    // Out of the note: save, then let its box go.
                    clearTimeout(bodyTimer);
                    Promise.resolve(bodyDirty ? saveBody(attrs) : bodySaving).then(() => {
                        if (bodyEditor && bodyEditor.isFocused) return;
                        if (_live) _live.leavePanel(attrs.personId, attrs.noteId);
                    });
                },
            });
            showPanelHolder();

            // The note, live: words written on the profile or in another
            // document arrive here while nobody on this page is typing in it.
            const onNote = (noteSnap) => {
                if (!noteSnap) return;
                if (!noteSnap.exists) { replaceOrphan(currentAttrs); return; }
                if (noteSnap.metadata && noteSnap.metadata.hasPendingWrites) return;
                if (!bodyEditor || bodyEditor.isDestroyed || bodyDirty || bodySaving || bodyEditor.isFocused) return;
                const theirs = noteSnap.data().contentJson || null;
                if (!theirs) return;
                if (JSON.stringify(theirs) === JSON.stringify(bodyEditor.getJSON())) return;
                const next = bodyEditor.schema.nodeFromJSON(theirs);
                const tr = bodyEditor.state.tr.replaceWith(0, bodyEditor.state.doc.content.size, next.content);
                tr.setMeta('remote', true);
                tr.setMeta('addToHistory', false);
                bodyEditor.view.dispatch(tr);
            };
            stopNoteWatch = window.MosaicLiveRead
                ? MosaicLiveRead.watch(noteRef, onNote, {
                    fallbackEveryMs: MosaicLiveRead.PERSON_EVERY_MS,
                    onError: e => console.warn('Lost the live connection to a Person Panel note:', e),
                })
                : noteRef.onSnapshot(onNote, () => {});
        } catch (err) {
            console.error('Error loading panel body:', err);
        }
    }

    function saveBody(attrs) {
        const mine = (bodySaving || Promise.resolve()).then(() => saveBodyNow(attrs));
        bodySaving = mine;
        return mine.then(() => { if (bodySaving === mine) bodySaving = null; });
    }

    async function saveBodyNow(attrs) {
        if (!bodyEditor || !bodyDirty) return;
        const bodyJson = bodyEditor.getJSON();
        bodyDirty = false;
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
                    // Not an edit anybody made, and not a claim on anything:
                    // the note's own box was checked when it was typed in.
                    const tr = editor.view.state.tr.setNodeMarkup(pos, null, {
                        ...currentAttrs,
                        bodySnapshot: JSON.stringify(bodyJson),
                    });
                    tr.setMeta('panelSnapshot', true);
                    tr.setMeta('addToHistory', false);
                    editor.view.dispatch(tr);
                }
            }
        } catch (err) {
            bodyDirty = true;
            console.error('Error saving panel body:', err);
        }
    }

    // Who holds the note changes without anything happening here.
    const stopPanelHolds = (window.ShepherdingPresence && ShepherdingPresence.subscribe)
        ? ShepherdingPresence.subscribe(() => showPanelHolder()) : null;
    const panelTicker = setInterval(showPanelHolder, 5000);

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
            if (bodyDirty) saveBody(currentAttrs);
            if (stopNoteWatch) { stopNoteWatch(); stopNoteWatch = null; }
            if (stopPanelHolds) stopPanelHolds();
            clearInterval(panelTicker);
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
        currentPermissionLevel: null,
        currentUserName: '',

        docId: null,
        doc: null,
        title: '',

        saveStatus: 'saved',
        editorUpdated: 0,

        // Live (MS-501/505/506): who holds the title, and what was just
        // refused because somebody else holds it.
        presenceEntries: [],
        presenceTick: 0,
        heldNotice: '',
        _heldNoticeTimer: null,
        // A legacy document that could not be turned into Blocks without
        // changing it opens to read, never to be written over.
        readOnly: false,

        // Set while a Word file is being built, so the button can say so. The
        // library is 1.1MB and arrives on the first click, so the first export
        // of a session takes a moment the rest do not.
        exportingWord: false,
        // …and the same, coming the other way.
        importingWord: false,
        insertingImage: false,
        // What the "shall I shrink it?" dialog is about, or null for none.
        pendingImage: null,

        // An Elder Document is elder-only, so linking a block of it to
        // somebody's Shepherding Note discloses nothing they could not already
        // read. The Event Document editor sets this false (ADR-0049).
        toolbarHasPersonPanel: true,

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

        // Back link — defaults to the Document Library, or the originating
        // Shepherding Profile when opened from a profile Documents tab (MS-98).
        backHref: 'shepherding-documents.html',
        backLabel: 'Documents',

        // ── Computed ──
        get filteredPeople() {
            const q = this.pickerSearch.toLowerCase();
            return _peopleList.filter(p => p.name.toLowerCase().includes(q));
        },

        async init() {
            const params = new URLSearchParams(window.location.search);
            this.docId = params.get('id');
            if (!this.docId) { window.location.href = 'shepherding-documents.html'; return; }
            if (params.get('from') === 'profile' && params.get('personId')) {
                this.backHref = `shepherding-profile.html?id=${encodeURIComponent(params.get('personId'))}`;
                this.backLabel = 'Profile';
            }

            this._onKeyDown = e => {
                if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                    e.preventDefault();
                    this.save();
                }
            };
            window.addEventListener('keydown', this._onKeyDown);

            // Listen for NodeView events (dispatched on document, not window)
            document.addEventListener('open-person-picker', e => this._handleOpenPicker(e.detail));
            document.addEventListener('panel-delete-request', e => this._handleDeleteRequest(e.detail));
            document.addEventListener('doc-held', e => this.showHeld(e.detail.holder));

            // A note deleted on a profile reaches this page as Blocks through
            // the live watch — on this device or any other — so there is no
            // message between tabs any more (MS-506).
            window.addEventListener('pagehide', () => {
                if (!_live) return;
                _live.save();
                _live.stop();
                try { ShepherdingPresence.leave(); } catch (e) {}
            });

            auth.onAuthStateChanged(async user => {
                if (!user) { window.location.href = 'login.html'; return; }
                const userData = await getUserData(user.uid);
                this.currentPermissionLevel = (userData && (userData.permissionLevel || userData.role)) || 'viewer';
                if (!['elder', 'super_admin'].includes(this.currentPermissionLevel)) {
                    window.location.href = 'index.html';
                    return;
                }
                this.currentUser = user;
                this.currentUserName = (userData && userData.email) ? userData.email.split('@')[0] : 'Elder';
                _currentUserName = this.currentUserName;
                _currentUserId   = user.uid;

                // Dev-only privacy screen (shepherding-blur.js).
                ShepherdingBlur.configure({
                    permissionLevel: this.currentPermissionLevel,
                    uid: user.uid,
                    personId: userData && userData.personId,
                });

                await this.loadDoc();
                if (!this.doc) return;
                this.startPresence(user);
                this.loading = false;
                this.$nextTick(() => this.initEditor());
            });
        },

        async loadDoc() {
            try {
                _live = ElderDocumentLive.create({
                    db,
                    fs: firebase.firestore,
                    docId: this.docId,
                    byName: () => this.currentUserName,
                    onStatus: s => {
                        if (s === 'error') {
                            this.saveStatus = 'unsaved';
                            this.showToast('Error saving document', 'error');
                        } else {
                            this.saveStatus = s;
                        }
                    },
                    onTitle: t => { this.title = t; _currentDocTitle = t; },
                    onHolds: () => this.redrawHolds(),
                    onRefused: holder => this.showHeld(holder),
                    onDeleted: () => {
                        this.showToast('This document was deleted', 'error');
                        setTimeout(() => { window.location.href = this.backHref; }, 1500);
                    },
                });
                _live.setTitleReader(() => this.title);
                const opened = await _live.open();
                if (!opened) { window.location.href = 'shepherding-documents.html'; return; }
                this.doc  = { id: this.docId, ...opened.record };
                _openedBody = opened.body;
                this.readOnly = opened.readOnly;
                this.title = this.doc.title || '';
                _currentDocId    = this.docId;
                _currentDocTitle = this.title;
                if (this.readOnly) {
                    this.showToast('This document is open to read only — it could not be updated for live editing', 'error');
                }
            } catch (e) {
                console.error('Error loading document:', e);
                this.showToast('Error loading document', 'error');
            }
        },

        // ── Live: who is here, and who holds what ─────────────────────────────

        startPresence(user) {
            if (typeof ShepherdingPresence === 'undefined') return;
            try {
                ShepherdingPresence.subscribe(entries => { this.presenceEntries = entries; });
                MosaicIdentity.me({ db, getUserData, uid: user.uid }).then(identity => {
                    ShepherdingPresence.start({
                        db,
                        uid: user.uid,
                        identity,
                        // The same surface on web and phone, so both count as
                        // being on this document.
                        surface: 'shepherding-document',
                        pageKey: this.docId,
                        stamp: () => firebase.firestore.FieldValue.serverTimestamp(),
                    });
                    // Presence waits on who you are; typing does not. A box
                    // entered before it started was let in unrecorded.
                    if (_live) _live.reclaim();
                }).catch(e => console.warn('Presence could not work out who you are:', e));
                // A quiet hold lets go after a minute; redraw so it shows.
                setInterval(() => { this.presenceTick++; this.redrawHolds(); }, PresenceCore.HEARTBEAT_MS);
                window.addEventListener('resize', () => this.redrawHolds());
                window.addEventListener('beforeunload', () => ShepherdingPresence.leave());
            } catch (e) {
                console.warn('Presence could not start on this document; carrying on without it:', e);
            }
        },

        redrawHolds() {
            this.presenceTick++;
            if (!_live || !_docEditor) return;
            if (this._holdsFrame) return;
            this._holdsFrame = requestAnimationFrame(() => {
                this._holdsFrame = null;
                _live.drawFaces(document.getElementById('doc-held-layer'), holder => _faceFor(holder));
            });
        },

        get titleHolder() {
            this.presenceTick;
            this.presenceEntries;
            return _live ? _live.titleHolder() : null;
        },

        // The other elders on this document, web or phone.
        get othersHere() {
            this.presenceTick;
            if (!this.currentUser || typeof PresenceCore === 'undefined') return [];
            return PresenceCore.peopleHere(
                this.presenceEntries, this.currentUser.uid, 'shepherding-document', this.docId,
                Date.now(), { idleMs: PresenceCore.SHEPHERDING_IDLE_MS });
        },

        holderLabel(holder) { return PresenceCore.holderLabel(holder); },
        holderTitle(holder) { return PresenceCore.holderTitle(holder); },

        showHeld(holder) {
            this.heldNotice = holder ? PresenceCore.holderTitle(holder) : 'Someone is editing this';
            clearTimeout(this._heldNoticeTimer);
            this._heldNoticeTimer = setTimeout(() => { this.heldNotice = ''; }, 3000);
            this.redrawHolds();
        },

        // ── Arriving from a Word file ─────────────────────────────────────────
        //
        // The file input is native, not Alpine-modelled — an <input type="file">
        // cannot be bound, only read at the moment it changes.
        chooseWordFile(event) {
            const file = event && event.target && event.target.files && event.target.files[0];
            if (event && event.target) event.target.value = '';
            if (file) this.importWordFile(file);
        },

        async importWordFile(file) {
            if (this.importingWord || !_docEditor) return;
            this.importingWord = true;
            try {
                const html = await DocumentDocx.wordFileToHtml(file);
                // INSERTED AT THE CURSOR, NEVER OVER THE TOP. A document you
                // imported into by accident can be undone; one that was
                // silently replaced is gone. It also means a Word file can be
                // dropped into the middle of minutes already being written,
                // which is the thing people actually want.
                _docEditor.chain().focus().insertContent(html).run();
                this.showToast('Imported ' + file.name);
            } catch (e) {
                console.error('Word import failed:', e);
                this.showToast('Could not read that Word file', 'error');
            } finally {
                this.importingWord = false;
            }
        },

        // ── Leaving as a Word file ────────────────────────────────────────────
        //
        // What is on screen, not what was last saved — somebody who has just
        // typed a line and hit Download means to take that line with them.
        async downloadAsWord() {
            if (this.exportingWord) return;
            this.exportingWord = true;
            try {
                const contentJson = _docEditor ? _docEditor.getJSON() : null;
                await DocumentDocx.downloadAsWord({
                    title: this.title.trim() || 'Untitled Document',
                    doc: contentJson,
                    panelBodies: await this.readPanelBodies(contentJson),
                });
            } catch (e) {
                console.error('Word export failed:', e);
                this.showToast('Could not make a Word file', 'error');
            } finally {
                this.exportingWord = false;
            }
        },

        // A Person Panel is an atom: the document holds only who it is about,
        // and the words live on that person's Shepherding Note (ADR-0004). So
        // the walk cannot reach them and this has to fetch them first —
        // otherwise every panel exports as a name with nothing under it.
        //
        // A note that cannot be read is left out rather than failing the whole
        // download; the core says so in the file where the body would have been.
        async readPanelBodies(contentJson) {
            const panels = [];
            (function walk(node) {
                if (!node) return;
                if (node.type === 'personPanel' && node.attrs &&
                    node.attrs.noteId && node.attrs.personId) {
                    panels.push(node.attrs);
                }
                (node.content || []).forEach(walk);
            })(contentJson);

            const bodies = {};
            await Promise.all(panels.map(async attrs => {
                try {
                    const snap = await db.collection('people').doc(attrs.personId)
                        .collection('shepherding_notes').doc(attrs.noteId).get();
                    if (snap.exists) bodies[attrs.noteId] = snap.data().contentJson || null;
                } catch (e) {
                    console.warn('Could not read a panel note for export:', e);
                }
            }));
            return bodies;
        },

        // ── Editor ────────────────────────────────────────────────────────────

        async initEditor() {
            // The VENDORED bundle, not esm.sh. This was a dozen dynamic
            // imports from a CDN nobody chose: if it was slow, blocked or
            // down, the editor did not open and nothing said why — on the
            // pages the elders write in. tiptap-editor-loader.js reads
            // vendor/tiptap/tiptap.bundle.js, the same file the phone app has
            // always used, and builds the identical window._TipTap (ADR-0050).
            await window.TiptapEditorLoader.ensureTipTap();

            await loadDocMentionData();

            const el = document.getElementById('tiptap-doc-editor');
            if (!el) return;
            if (_docEditor) { _docEditor.destroy(); _docEditor = null; }

            const { Editor, StarterKit, Underline, Mention, TextStyle, FontFamily, FontSize, Highlight, Table, TableRow, TableHeader, TableCell, Image, Link, TextAlign, BlockId, Extension, Plugin, PluginKey } = window._TipTap;
            const PersonPanelNode = createPersonPanelNode();
            const InlinePickerExtension = createInlinePickerPlugin();
            const self = this;
            // One person per box (MS-505): a change touching a paragraph, list
            // item, cell or Person Panel somebody else holds is dropped.
            const BoxLock = Extension.create({
                name: 'elderDocumentLocks',
                addProseMirrorPlugins() { return [_live.lockPlugin({ Plugin, PluginKey })]; },
            });

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
                    // Added with the Word work. Image is the one that matters
                    // most: without it a picture in an imported .docx is
                    // dropped on the way in and nobody is told.
                    Image.configure({ inline: false, allowBase64: true }),
                    Link.configure({ openOnClick: false, autolink: true }),
                    TextAlign.configure({ types: ['heading', 'paragraph'] }),
                    PersonPanelNode,
                    InlinePickerExtension,
                    Mention.configure({
                        HTMLAttributes: { class: 'mention-chip' },
                        suggestion: createDocMentionSuggestion(),
                    }),
                    // Every block carries a lasting id: it is saved, updated
                    // live and held block by block (MS-500).
                    BlockId,
                    BoxLock,
                ].filter(Boolean),
                // Drawn from the document's Blocks (MS-501).
                content: _openedBody || '',
                editable: !this.readOnly,
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
                                const page = _docTypeById[parsed.id] === 'care-list' ? 'shepherding-care-list.html' : 'shepherding-document.html';
                                window.location.href = `${page}?id=${encodeURIComponent(parsed.id)}`;
                            } else if (parsed.kind === 'elder_folder') {
                                window.location.href = `shepherding-documents.html?folder=${encodeURIComponent(parsed.id)}`;
                            }
                            return true;
                        }
                        return false;
                    },
                },
                onTransaction() { self.editorUpdated++; self.redrawHolds(); },
                onUpdate({ editor: ed, transaction }) {
                    // Somebody else's blocks arriving, ids being given out, or
                    // a keystroke the lock refused, are not edits of ours.
                    if (transaction && (transaction.getMeta('remote') || transaction.getMeta('blockIds'))) return;
                    if (transaction && ed.state.doc === transaction.before) return;
                    _live.edited();
                },
            });
            _live.attach(_docEditor);
            this.redrawHolds();
        },

        focusEditor() { _docEditor?.commands.focus(); },
        // ⚠ TOUCHES `editorUpdated` ITSELF. The markup used to carry
        // `editorUpdated >= 0 &&` in front of every call to make Alpine
        // re-evaluate when the cursor moved; the shared toolbar cannot know to
        // do that, so the dependency belongs here where it can never be
        // forgotten.
        isActive(name, attrs) {
            this.editorUpdated;
            if (!_docEditor) return false;
            // TipTap takes either a node name or a bare bag of attributes —
            // alignment is the second kind, being an attribute of whatever
            // block the cursor is in rather than a node of its own.
            return typeof name === 'object'
                ? _docEditor.isActive(name)
                : _docEditor.isActive(name, attrs || {});
        },
        editorCmd(command) { _docEditor?.chain().focus()[command]().run(); },

        command(run) {
            if (!_docEditor) return;
            run(_docEditor.chain().focus());
            this.editorUpdated++;
        },

        toggle(name) {
            this.command(chain => chain['toggle' + name.charAt(0).toUpperCase() + name.slice(1)]().run());
        },

        setHeading(level) {
            this.command(chain => level
                ? chain.toggleHeading({ level: level }).run()
                : chain.setParagraph().run());
        },

        setAlign(align) {
            this.command(chain => align ? chain.setTextAlign(align).run() : chain.unsetTextAlign().run());
        },

        // A prompt rather than a bespoke popover: this is the least interesting
        // part of the editor and a panel would be the most code in it.
        setLink() {
            if (!_docEditor) return;
            const existing = _docEditor.getAttributes('link').href || '';
            const entered = window.prompt('Link address', existing);
            if (entered === null) return;

            const href = String(entered).trim();
            if (!href) {
                this.command(chain => chain.extendMarkRange('link').unsetLink().run());
                return;
            }
            // A bare address is meant as a web address. Without this,
            // "example.org" becomes a link relative to this app.
            const url = /^[a-z][a-z0-9+.-]*:/i.test(href) ? href : 'https://' + href;
            if (!/^https?:\/\//i.test(url) && !/^mailto:/i.test(url)) {
                this.showToast('A link has to be a web address or an email address', 'error');
                return;
            }
            this.command(chain => chain.extendMarkRange('link').setLink({ href: url }).run());
        },

        // ── A picture ────────────────────────────────────────────────────────
        //
        // Kept INSIDE the Note Body as a data URI rather than uploaded, so
        // whatever rule governs the document governs the picture — and so it
        // survives the round trip out to Word and back.
        chooseImage(event) {
            const file = event && event.target && event.target.files && event.target.files[0];
            if (event && event.target) event.target.value = '';
            if (file) this.insertImage(file);
        },

        // A picture that already fits goes straight in. One that does not is
        // offered a shrink rather than refused — every photograph off a phone
        // is too big, and "attach it as a file instead" is not an answer.
        insertImage(file) {
            if (!_docEditor) return;
            const check = GuideImageCore.validateImageFile(file);
            if (!check.ok) { this.showToast(check.error, 'error'); return; }

            if (!GuideImageCore.needsRedraw(file, GuideImageCore.BUDGET_BYTES)) {
                this.placeImage(file);
                return;
            }
            _pendingImageFile = file;
            this.pendingImage = { name: file.name, size: _describeBytes(file.size) };
        },

        confirmImageShrink() {
            const file = _pendingImageFile;
            this.pendingImage = null;
            _pendingImageFile = null;
            if (file) this.placeImage(file);
        },

        cancelImage() {
            this.pendingImage = null;
            _pendingImageFile = null;
        },

        async placeImage(file) {
            this.insertingImage = true;
            try {
                const dataUrl = await GuideImageCore.capToDataUrl(file, GuideImageCore.BUDGET_BYTES);
                this.command(chain => chain.setImage({ src: dataUrl, alt: file.name }).run());
                this.scheduleSave();
            } catch (e) {
                console.error('Could not read that picture:', e);
                this.showToast('That picture could not be read', 'error');
            } finally {
                this.insertingImage = false;
            }
        },

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

        // The title is a box too: one person renames at a time (MS-505).
        onTitleInput() {
            _currentDocTitle = this.title;
            if (_live) _live.titleInput(this.title);
        },

        enterTitle(event) {
            if (_live && !_live.enterTitle() && event && event.target) event.target.blur();
        },

        leaveTitle() {
            if (_live) _live.leaveTitle();
        },

        scheduleSave() {
            if (_live) _live.edited();
        },

        // Only what changed: each changed block, and the title if it changed,
        // at its own field (elder-document-live.js).
        save() {
            return _live ? _live.save() : Promise.resolve();
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
