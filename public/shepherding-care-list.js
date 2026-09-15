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

// ── Live Care List state (MS-439 / MS-443 / MS-448) ───────────────────────────
// Kept outside Alpine: none of it is drawn, and a proxy around the session or
// the watch handles would only slow every keystroke down.
const _careList = {
    session: null,   // CareListCore session: the stored copy and what is unsaved
    focus: null,     // { personId, columnId } while the cursor is in a cell
    inTitle: false,  // while the cursor is in the title
    watches: [],     // functions that stop a live read
    ticker: null,
    saving: null,    // the save on its way, if one is
};

function stopCareListWatches() {
    _careList.watches.forEach(stop => { try { stop(); } catch (e) {} });
    _careList.watches = [];
    if (_careList.ticker) { clearInterval(_careList.ticker); _careList.ticker = null; }
}

document.addEventListener('alpine:init', () => {
    Alpine.data('careListEditor', () => ({
        loading: true,
        currentUser: null,
        currentPermissionLevel: null,
        currentUserName: '',
        // Your name as the church knows it, once presence has resolved it.
        myName: '',

        docId: null,
        doc: null,
        title: '',
        filterId: null,
        filterTitle: '…',
        viewConfig: null,

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

        // Presence (MS-443): everybody's claims, and a tick so a hold that
        // went quiet is redrawn as free without anybody writing anything.
        presenceEntries: [],
        presenceTick: 0,

        toast: { show: false, message: '', type: 'success' },

        async init() {
            const params = new URLSearchParams(window.location.search);
            this.docId = params.get('id');
            if (!this.docId) { window.location.href = 'shepherding-documents.html'; return; }

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

                // Dev-only privacy screen (shepherding-blur.js).
                ShepherdingBlur.configure({
                    permissionLevel: this.currentPermissionLevel,
                    uid: user.uid,
                    personId: userData && userData.personId,
                });

                await Promise.all([this.loadDoc(), this.loadTags()]);
                this.loading = false;
                this.$nextTick(() => this.initEditors());

                // Editing is already open by here. Presence only ever takes a
                // box away, and if it fails every box stays open (ADR-0035 §3).
                this.watchCareList();
                this.startPresence(user);
            });

            window.addEventListener('pagehide', () => {
                // Anything typed in the last second and a half goes first.
                this.save();
                stopCareListWatches();
                try { ShepherdingPresence.leave(); } catch (e) {}
            });
        },

        async loadDoc() {
            try {
                const snap = await db.collection('elder_documents').doc(this.docId).get();
                if (!snap.exists) { window.location.href = 'shepherding-documents.html'; return; }
                this.doc = { id: snap.id, ...snap.data() };
                // The session reads an old-shaped list as one Notes column. It
                // is only WRITTEN in the column shape by the first save
                // (CareListCore.saveEdits), so opening a list writes nothing.
                _careList.session = CareListCore.createSession(this.doc);
                this.title = _careList.session.title();
                this.careListColumns = _careList.session.columns();

                if (this.doc.filterId) {
                    this.filterId = this.doc.filterId;
                    const viewSnap = await db.collection('shepherding_views').doc(this.doc.filterId).get();
                    if (viewSnap.exists) {
                        this.filterTitle = viewSnap.data().title || 'Untitled Filter';
                        this.viewConfig = viewSnap.data();
                    }
                } else if (this.doc.filterConfig) {
                    this.filterTitle = 'Custom Filter';
                    this.viewConfig = this.doc.filterConfig;
                }
            } catch (e) {
                console.error('Error loading document:', e);
                this.showToast('Error loading document', 'error');
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

        // ── Live (MS-439 / MS-448) ────────────────────────────────────────────
        // The list itself, who is on it, and the Filtered View it reads all
        // arrive as they change. Somebody else's cell goes into its editor
        // without counting as an edit, so it is never saved back; a cell this
        // page has typed into and not saved is left alone (CareListCore).
        watchCareList() {
            const Live = window.MosaicLiveRead;
            _careList.watches.push(CareListCore.watch(db, this.docId, data => this.adoptRemote(data)));

            const people = snap => {
                this.people = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                this.applyFilter();
            };
            const failed = what => e => console.error('Could not keep ' + what + ' current:', e);
            _careList.watches.push(Live.watch(db.collection('people'), people, {
                fallbackEveryMs: Live.ROSTER_EVERY_MS, onError: failed('the people on this list'),
            }));

            if (this.filterId) {
                _careList.watches.push(Live.watch(db.collection('shepherding_views').doc(this.filterId), snap => {
                    if (!snap.exists) return;
                    this.viewConfig = snap.data();
                    this.filterTitle = this.viewConfig.title || 'Untitled Filter';
                    this.applyFilter();
                }, { fallbackEveryMs: Live.ROSTER_EVERY_MS, onError: failed('this list\'s filter') }));
            }
        },

        adoptRemote(data) {
            const session = _careList.session;
            if (!session) return;
            if (!data) {
                this.showToast('This Care List was deleted', 'error');
                setTimeout(() => { window.location.href = 'shepherding-documents.html'; }, 1500);
                return;
            }
            if (data.filterConfig && !this.filterId &&
                !CareListCore.sameContent(data.filterConfig, this.viewConfig)) {
                this.viewConfig = data.filterConfig;
                this.applyFilter();
            }
            const out = session.adopt(data, { inCell: _careList.focus, inTitle: _careList.inTitle });
            if (out.title !== null) this.title = out.title;
            out.cells.forEach(cell => this.putCell(cell.personId, cell.columnId, cell.value));
            if (out.columns) {
                this.careListColumns = out.columns;
                this.$nextTick(() => this.syncEditors());
            }
        },

        // Somebody else's value into a cell's editor, without it counting as
        // an edit: setContent's second argument keeps onUpdate quiet.
        putCell(personId, colId, value) {
            const editor = this.editors[personId] && this.editors[personId][colId];
            if (editor) editor.commands.setContent(value || '', false);
        },

        applyFilter() {
            let result;
            if (!this.viewConfig) {
                result = this.people.slice();
            } else {
                const view = this.viewConfig;
                result = this.people.filter(p => !ShepherdingCore.isInactiveMembership(p.membership));

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
            }

            // A row that leaves the filter while you are typing in it stays
            // until you leave the cell — it is never pulled out from under you.
            const focus = _careList.focus;
            if (focus && !result.some(p => p.id === focus.personId)) {
                const kept = this.people.find(p => p.id === focus.personId);
                if (kept) result.push(kept);
            }

            this.filteredPeople = result.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
            this.$nextTick(() => this.syncEditors());
        },

        async initEditors() {
            // The VENDORED bundle, not esm.sh. This was a dozen dynamic
            // imports from a CDN nobody chose: if it was slow, blocked or
            // down, the editor did not open and nothing said why — on the
            // pages the elders write in. tiptap-editor-loader.js reads
            // vendor/tiptap/tiptap.bundle.js, the same file the phone app has
            // always used, and builds the identical window._TipTap (ADR-0050).
            await window.TiptapEditorLoader.ensureTipTap();

            await loadDocMentionData();

            this.syncEditors();
        },

        // Every row on the list and every column has an editor; nothing else
        // does. A cell with unsaved typing is saved before its editor goes.
        syncEditors() {
            if (!window._TipTap) return;
            const rows = new Set(this.filteredPeople.map(p => p.id));
            const cols = new Set(this.careListColumns.map(c => c.id));
            const going = [];
            Object.keys(this.editors).forEach(personId => {
                Object.keys(this.editors[personId]).forEach(colId => {
                    if (!rows.has(personId) || !cols.has(colId)) going.push([personId, colId]);
                });
            });
            const session = _careList.session;
            if (session && going.some(([p, c]) => session.isDirty(p, c))) this.save();
            // The cell under the cursor can go too — its column removed. TipTap
            // does not report a blur on destroy, so let go of it here.
            const focus = _careList.focus;
            if (focus && going.some(([p, c]) => p === focus.personId && c === focus.columnId)) {
                _careList.focus = null;
                if (!_careList.inTitle) ShepherdingPresence.release();
            }
            going.forEach(([personId, colId]) => {
                try { this.editors[personId][colId].destroy(); } catch (e) {}
                delete this.editors[personId][colId];
            });

            this.filteredPeople.forEach(person => {
                this.careListColumns.forEach(col => {
                    if (!this.editors[person.id] || !this.editors[person.id][col.id]) {
                        this._mountCellEditor(person, col.id);
                    }
                });
            });
            this.refreshHeld();
        },

        _makeTriggerExt(person) {
            const self = this;
            return createInlineTriggersExtension({
                personId: person.id,
                getAllTags:      () => self.shepherdingTags,
                getPersonTags:  () => { const p = self.people.find(x => x.id === person.id); return p?.tags || []; },
                getCurrentStatus: () => { const p = self.people.find(x => x.id === person.id); return p?.shepherdingStatus || null; },
                createTag:      (name) => self.createNewTag(name),
                // A trigger pick is activity too, for the one-minute rule.
                // One in a cell somebody took from you is not recorded.
                onTagAdd:       (tagId, tagName) => self.touchCell() ? self.handleTagAdd(person.id, tagId, tagName) : undefined,
                onTagRemove:    (tagId, tagName) => self.touchCell() ? self.handleTagRemove(person.id, tagId, tagName) : undefined,
                onStatusChange: (urg, imp) => self.touchCell() ? self.handleStatusChange(person.id, urg, imp) : Promise.resolve(null),
                onStatusUndo: (activityId, urg, imp) => self.handleStatusUndo(person.id, activityId, urg, imp),
            });
        },

        _mountCellEditor(person, colId) {
            const el = document.getElementById(`editor-${person.id}-${colId}`);
            if (!el || !window._TipTap) return;
            const { Editor, StarterKit, Underline, Mention, TextStyle, FontFamily, FontSize, Highlight, Table, TableRow, TableHeader, TableCell, Image, Link, TextAlign } = window._TipTap;
            const self = this;
            const content = (_careList.session && _careList.session.cell(person.id, colId)) || '';
            if (!this.editors[person.id]) this.editors[person.id] = {};
            this.editors[person.id][colId] = new Editor({
                element: el,
                extensions: [
                    StarterKit, Underline, TextStyle, FontFamily, FontSize,
                    Highlight.configure({ multicolor: true }),
                    Table.configure({ resizable: false }), TableRow, TableHeader, TableCell,
                    // Added with the Word work. Image is the one that matters
                    // most: without it a picture in an imported .docx is
                    // dropped on the way in and nobody is told.
                    Image.configure({ inline: false, allowBase64: true }),
                    Link.configure({ openOnClick: false, autolink: true }),
                    TextAlign.configure({ types: ['heading', 'paragraph'] }),
                    Mention.configure({ HTMLAttributes: { class: 'mention-chip' }, suggestion: createDocMentionSuggestion() }),
                    this._makeTriggerExt(person),
                ],
                content,
                onUpdate() { self.cellEdited(person.id, colId); },
                onFocus()  { self.enterCell(person.id, colId); },
                onBlur()   { self.leaveCell(person.id, colId); },
            });
        },

        // ── Boxes (MS-443) ────────────────────────────────────────────────────

        cellEdited(personId, colId) {
            const session = _careList.session;
            if (!session) return;
            this.editorUpdated++;
            session.edited(personId, colId);
            if (!this.touchCell()) return;
            this.scheduleSave();
        },

        // Every keystroke in a held box. False means somebody else took it
        // after you went quiet: what you just typed goes back to what is stored,
        // and is not saved over theirs.
        touchCell() {
            const focus = _careList.focus;
            if (!focus) return true;
            if (ShepherdingPresence.touch()) return true;
            const stored = _careList.session.discard(focus.personId, focus.columnId);
            this.putCell(focus.personId, focus.columnId, stored);
            const holder = this.cellHolder(focus.personId, focus.columnId);
            const editor = this.editors[focus.personId] && this.editors[focus.personId][focus.columnId];
            if (editor) editor.commands.blur();
            this.showToast((holder ? holder.name : 'Somebody') + ' is editing this cell now', 'error');
            return false;
        },

        enterCell(personId, colId) {
            const box = CareListCore.box.cell(this.docId, personId, colId);
            if (!ShepherdingPresence.claimBox(box)) {
                const editor = this.editors[personId] && this.editors[personId][colId];
                if (editor) editor.commands.blur();
                this.sayHeld(this.cellHolder(personId, colId), 'cell');
                return;
            }
            _careList.focus = { personId, columnId: colId };
            this.activePersonId = personId;
            this.activeColId = colId;
            // Somebody else's save may have arrived while they held it: start
            // from that, not from the older copy on screen.
            const arrived = _careList.session && _careList.session.catchUpCell(personId, colId);
            if (arrived) this.putCell(personId, colId, arrived.value);
        },

        // The hold goes only once this cell's pending save has — so letting go
        // never strands unsaved text. Then whatever arrived while you were in
        // it goes in, and a row that left the filter meanwhile can go.
        async leaveCell(personId, colId) {
            const focus = _careList.focus;
            if (!focus || focus.personId !== personId || focus.columnId !== colId) return;
            _careList.focus = null;
            const session = _careList.session;
            // Wait for this cell's save — the one still to start, or the one
            // already on its way — before the hold goes.
            if (session && session.isDirty(personId, colId)) await this.save();
            else if (_careList.saving) await _careList.saving;
            const arrived = session && session.catchUpCell(personId, colId);
            if (arrived) this.putCell(personId, colId, arrived.value);
            // Already in another cell, which claimed its own box: releasing
            // now would let go of that one.
            if (!_careList.focus && !_careList.inTitle) ShepherdingPresence.release();
            this.applyFilter();
        },

        enterTitle(event) {
            if (!ShepherdingPresence.claimBox(CareListCore.box.title(this.docId))) {
                event.target.blur();
                this.sayHeld(this.titleHolder, 'title');
                return;
            }
            _careList.inTitle = true;
            const arrived = _careList.session && _careList.session.catchUpTitle();
            if (arrived !== null && arrived !== undefined) this.title = arrived;
        },

        async leaveTitle() {
            if (!_careList.inTitle) return;
            _careList.inTitle = false;
            const session = _careList.session;
            if (session && session.hasUnsaved()) await this.save();
            else if (_careList.saving) await _careList.saving;
            const arrived = session && session.catchUpTitle();
            if (arrived !== null && arrived !== undefined) this.title = arrived;
            if (!_careList.focus && !_careList.inTitle) ShepherdingPresence.release();
        },

        startPresence(user) {
            try {
                ShepherdingPresence.subscribe(entries => { this.presenceEntries = entries; this.refreshHeld(); });
                MosaicIdentity.me({ db, getUserData, uid: user.uid }).then(identity => {
                    if (identity && identity.name) this.myName = identity.name;
                    ShepherdingPresence.start({
                        db,
                        uid: user.uid,
                        identity,
                        // The phone's Care List screen says the same, so web and
                        // phone count as being on one list.
                        surface: 'shepherding-care-list',
                        pageKey: this.docId,
                        stamp: () => firebase.firestore.FieldValue.serverTimestamp(),
                    });
                    // Presence waits on who you are; editing does not. A box
                    // entered before it started was let in unrecorded, so
                    // record it now or nobody else would see the lock.
                    const focus = _careList.focus;
                    if (focus) ShepherdingPresence.claimBox(CareListCore.box.cell(this.docId, focus.personId, focus.columnId));
                    else if (_careList.inTitle) ShepherdingPresence.claimBox(CareListCore.box.title(this.docId));
                }).catch(e => console.warn('Presence could not work out who you are:', e));
                _careList.ticker = setInterval(() => { this.presenceTick++; this.refreshHeld(); }, PresenceCore.HEARTBEAT_MS);
                // leave(), not release(): release writes a fresh timestamp and
                // would leave you looking present for half a minute after going.
                window.addEventListener('beforeunload', () => ShepherdingPresence.leave());
            } catch (e) {
                console.warn('Presence could not start on this Care List; carrying on without it:', e);
            }
        },

        // Whoever else holds this box, or null.
        heldBy(box) {
            this.presenceTick; // read, so a quiet hold is redrawn as free
            return ShepherdingPresence.holderIn(
                this.presenceEntries, this.currentUser && this.currentUser.uid, box, Date.now());
        },

        cellHolder(personId, colId) {
            return this.heldBy(CareListCore.box.cell(this.docId, personId, colId));
        },

        get titleHolder() {
            return this.heldBy(CareListCore.box.title(this.docId));
        },

        // The other elders on this Care List — the row of faces.
        get othersHere() {
            this.presenceTick;
            if (!this.currentUser) return [];
            return PresenceCore.peopleHere(
                this.presenceEntries, this.currentUser.uid, 'shepherding-care-list', this.docId,
                Date.now(), { idleMs: PresenceCore.SHEPHERDING_IDLE_MS });
        },

        holderLabel(holder) { return PresenceCore.holderLabel(holder); },
        holderTitle(holder) { return PresenceCore.holderTitle(holder); },

        // A cell somebody else holds cannot be typed into. setEditable's
        // second argument keeps it from firing an update, which would read as
        // an edit and save the cell.
        refreshHeld() {
            Object.keys(this.editors).forEach(personId => {
                Object.keys(this.editors[personId]).forEach(colId => {
                    const editor = this.editors[personId][colId];
                    const open = !this.cellHolder(personId, colId);
                    if (editor && editor.isEditable !== open) editor.setEditable(open, false);
                });
            });
        },

        // A click on a held cell says who has it.
        onCellPointer(event, personId, colId) {
            const holder = this.cellHolder(personId, colId);
            if (!holder) return;
            event.preventDefault();
            this.sayHeld(holder, 'cell');
        },

        sayHeld(holder, what) {
            this.showToast((holder ? holder.name : 'Somebody') + ' is editing this ' + what, 'error');
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
            if (!editor || !editor.isEditable) return;

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
            if (!_careList.session) return;
            if (!ShepherdingPresence.touch()) {
                this.title = _careList.session.title();
                this.sayHeld(this.titleHolder, 'title');
                return;
            }
            _careList.session.titleEdited();
            this.scheduleSave();
        },

        scheduleSave() {
            this.saveStatus = 'unsaved';
            clearTimeout(this._saveTimer);
            this._saveTimer = setTimeout(() => this.save(), 1500);
        },

        // Writes the cells typed into since the last save, each to its own
        // field, and the title if it was typed into — nothing else, so a cell
        // somebody else saved, or one belonging to a person outside the filter,
        // is never written back (MS-439).
        async save() {
            const session = _careList.session;
            if (!this.docId || !session) return;
            clearTimeout(this._saveTimer);

            const edits = session.takeSave(
                (personId, colId) => {
                    const editor = this.editors[personId] && this.editors[personId][colId];
                    return editor ? editor.getJSON() : session.cell(personId, colId);
                },
                () => this.title.trim() || 'Untitled Care List');
            if (!edits.cells.length && edits.title === null) {
                if (!session.hasUnsaved()) this.saveStatus = 'saved';
                return;
            }

            this.saveStatus = 'saving';
            const saving = CareListCore.saveEdits(db, firebase.firestore, this.docId, Object.assign({}, edits, {
                byName: this.myName || this.currentUserName,
                oldShape: session.oldShape(),
            })).then(() => {
                session.markNormalised();
                this.saveStatus = session.hasUnsaved() ? 'unsaved' : 'saved';
            }, e => {
                console.error('Error saving:', e);
                session.saveFailed(edits);
                this.saveStatus = 'unsaved';
                this.showToast('Error saving care list', 'error');
            }).then(() => { if (_careList.saving === saving) _careList.saving = null; });
            _careList.saving = saving;
            await saving;
        },

        // ── Column management ─────────────────────────────────────────────────
        // Each is ONE change applied to the latest stored list in a
        // transaction, so two elders' column changes both stand (ADR-0039).

        async changeColumn(change) {
            try {
                const out = await CareListCore.changeColumn(db, firebase.firestore, this.docId, change,
                    this.myName || this.currentUserName);
                _careList.session.columnsChanged(out.columns);
                this.careListColumns = out.columns;
                await this.$nextTick();
                this.syncEditors();
                return out;
            } catch (e) {
                console.error('Error changing column:', e);
                // A rename shown before it was written goes back.
                this.careListColumns = _careList.session.columns();
                this.showToast(e && e.message && /last column/.test(e.message)
                    ? 'Cannot delete the last column' : 'Error changing column', 'error');
                return null;
            }
        },

        async addColumn() {
            const out = await this.changeColumn({ kind: 'add', name: 'Column ' + (this.careListColumns.length + 1) });
            if (out && out.column) this.startEditColumnName(out.column.id, out.column.name);
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
            if (this.editingColumnId !== id) return;
            const name = this.editingColumnName.trim() || 'Untitled';
            this.editingColumnId = null;
            this.careListColumns = this.careListColumns.map(c => c.id === id ? { ...c, name } : c);
            this.changeColumn({ kind: 'rename', columnId: id, name });
        },

        deleteColumn(id) {
            if (this.careListColumns.length <= 1) { this.showToast('Cannot delete the last column', 'error'); return; }
            // Removing a column deletes every cell in it, so not while somebody
            // is writing in one of them.
            if (this.refuseWhileWritten(id)) return;
            if (!confirm('Delete this column? Its content will be permanently lost.')) return;
            // Asked again: somebody may have stepped into a cell while the
            // question was open.
            if (this.refuseWhileWritten(id)) return;
            this.changeColumn({ kind: 'remove', columnId: id });
        },

        refuseWhileWritten(columnId) {
            const claims = this.currentUser ? PresenceCore.claimsByBox(this.presenceEntries, this.currentUser.uid,
                Date.now(), { idleMs: PresenceCore.SHEPHERDING_IDLE_MS }) : {};
            const holder = CareListCore.columnHolder(claims, this.docId, columnId);
            if (!holder) return false;
            this.showToast(holder.name + ' is writing in this column — it can\'t be deleted now', 'error');
            return true;
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
            // Stable auto-id identity, independent of the name (ADR-0011).
            const ref = await db.collection('people_tags').add({ name: trimmed, hiddenFromOthers: false, hidePeople: false });
            const newTag = { id: ref.id, name: trimmed, hidePeople: false };
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
                const activityId = await ShepherdingCore.commitPastoralChange(db, personId, {
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
                return activityId;
            } catch (e) { console.error('Error updating status:', e); this.showToast('Error updating status', 'error'); }
        },

        // Take a status change back entirely (chip backspaced out): restore the
        // previous status and delete the record it logged — no timeline trace.
        async handleStatusUndo(personId, activityId, prevUrgency, prevImportance) {
            try {
                const idx = this.people.findIndex(p => p.id === personId);
                const prevStatus = (prevUrgency && prevImportance) ? { urgency: prevUrgency, importance: prevImportance } : null;
                await ShepherdingCore.revertPastoralChange(db, personId, {
                    shepherdingStatus: prevStatus,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                }, activityId);
                if (idx !== -1) {
                    this.people = this.people.map((p, i) => i === idx ? { ...p, shepherdingStatus: prevStatus } : p);
                }
            } catch (e) { console.error('Error undoing status change:', e); this.showToast('Error undoing status', 'error'); }
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
