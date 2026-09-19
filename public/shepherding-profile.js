// A read whose RESULT DECIDES A WRITE — a merge, a re-point, a batch of
// deletes. In the phone app ordinary reads are answered from the device
// (local-cache.js); these must not be. Stale input to a write does not show
// you old data, it destroys new data: a merge planned from a people list a
// minute old silently drops whoever was added in that minute. Ignored on the
// web, where reads were always live.
var FRESH_READ = { source: 'server' };
// One list, in shepherding-core.js, so the page and the MCP cannot come to
// disagree about what a Note Type is.
const NOTE_TYPES = ShepherdingCore.NOTE_TYPES;

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
let _docTypeById     = {}; // elder_document id → docType (e.g. 'care-list')
let _mentionDataLoaded = false;

// The live watches this page holds (MS-490), kept outside Alpine so they are not
// proxied, and stopped when the page goes.
let _profileWatches = [];
// Source-document titles already asked for, so a feed that re-arrives does not
// ask again while the first answer is still on its way.
const _titlesAsked = new Set();

function stopProfileWatches() {
    _profileWatches.forEach(stop => { try { stop(); } catch (e) {} });
    _profileWatches = [];
}

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
                    popup.style.cssText = 'position:fixed;z-index:9999;background:var(--surface-container-lowest);border:1px solid var(--outline-variant);border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.12);min-width:220px;max-height:280px;overflow-y:auto;padding:4px 0;font-family:"Work Sans",sans-serif;font-size:14px;';
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
    return TiptapRender.renderTiptapJson(doc, { docTypeById: _docTypeById });
}

document.addEventListener('alpine:init', () => {
    // withQuickAssign, not object spread: the quick-assign card exposes getters and
    // spreading would freeze them at their page-load values.
    Alpine.data('shepherdingProfile', () => window.withQuickAssign({
        currentUser: null,
        currentPermissionLevel: null,
        currentUserName: '',
        // Dev-only blur (shepherding-blur.js): true when this profile is the
        // current user's own Person record, so nothing on it is screened.
        ownProfile: false,

        personId: null,
        person: null,

        // Which profile tab is showing: the Pastoral Record, the per-person
        // Documents directory (MS-98), or the Tasks the elders owe this person
        // (ADR-0061).
        activeTab: 'record', // 'record' | 'documents' | 'tasks'

        // The Tasks tab reads the whole task collection to resolve repeats, so
        // it is not built until somebody asks for it — and then it stays built,
        // because a tab that reloaded every time you looked at it would lose
        // whatever you had half-typed into it.
        tasksTabOpened: false,

        fromPage: null,
        fromId: null,
        fromTitle: null,

        // What arrives live (MS-490). `notes` and the Pastoral Record are built
        // from these by ShepherdingCore.combineProfile — the same function the
        // phone uses — rather than kept as a second copy that could drift.
        personNotes: [],
        careListDocs: [],
        activity: [],
        sourceDocTitles: {},
        editingExplanation: {},
        explanationDraft: {},
        showNoteEditor: false,
        editingNote: null,
        noteForm: { type: 'Elder Check-in', subject: '', contentJson: null },
        editorUpdated: 0,

        // ── Presence (MS-491) ───────────────────────────────────────────────
        // Everybody's presence as it last arrived, so the page redraws when
        // somebody opens or closes an editor. The store's own list is the truth.
        presenceEntries: [],
        // Bumped every heartbeat, so a hold whose holder has gone quiet or whose
        // page died stops showing as held even when nothing new arrives.
        presenceTick: 0,
        // The note editor's box was taken by somebody else while it was open.
        noteLost: false,
        // Our own save is on its way, so our own change arriving is not
        // "somebody changed this".
        savingNote: false,
        // The details as they were when the editor opened, and whether its box
        // was taken while it was open.
        detailsOpenedWith: null,
        detailsLost: false,
        // Your name as the church knows it, once presence has resolved it.
        myName: '',

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

        // Relationships (ADR-0012, MS-89) — the elder-only edge graph.
        relationships: [],
        relationshipTypes: [],
        allPeople: [],
        families: [],   // ADR-0013, MS-93 — source of the read-only Family projection
        // Relationship Tracker card (MS-93 design): two avatars + a phrase with a
        // directional chevron at each end. rightActive = flows toward the other
        // person (this Person is the source); leftActive = flows toward this
        // Person; both = symmetric (non-directional).
        relPersonQuery: '',

        // Elder Assignment (ADR-0013, MS-94)
        showAssignElder: false,
        assignmentSaving: false,

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
                Object.assign(this, AccessCore.pageFlags(userData));
                if (!this.canReadElder) {
                    window.location.href = 'index.html';
                    return;
                }
                this.currentUser = user;
                this.currentUserName = (userData && userData.email)
                    ? userData.email.split('@')[0]
                    : 'Elder';

                // Dev-only privacy screen. Content on the current user's own
                // profile is never blurred (it's about them).
                this.ownProfile = !!(userData && userData.personId && userData.personId === this.personId);
                ShepherdingBlur.configure({
                    permissionLevel: this.currentPermissionLevel,
                    pastoralAssistant: this.pastoralAssistant,
                    uid: user.uid,
                    personId: userData && userData.personId,
                });

                await this.watchProfile();
                this.loading = false;

                // After editing rights and after the person — and it cannot
                // throw at this handler (ADR-0035 section 3).
                this.startPresence(user);
            });
        },

        // ── Live (MS-490) ────────────────────────────────────────────────────
        // Everything this page draws is watched rather than read once, through
        // live-read.js — a listener on the web, and on the phone a listener that
        // falls back to re-reading if it stays silent. Data about THIS person
        // re-reads every few seconds in that fallback; church-wide lists every
        // thirty, because re-reading the whole directory every three seconds
        // would be a bill for nothing.
        //
        // ⚠ NOTHING RELOADS AFTER A SAVE ANY MORE. Each write still updates the
        // page at once, so your own change shows immediately; the watch brings
        // back the server's copy, which is the same. A reload after a save was
        // the page's only way of hearing about anything, and now it is not.
        //
        // Resolves once the person has been read, so the page can stop its
        // spinner — the rest arrives as it arrives.
        watchProfile() {
            const Live = window.MosaicLiveRead;
            const PERSON = Live.PERSON_EVERY_MS;
            const ROSTER = Live.ROSTER_EVERY_MS;
            // serverTimestamps: 'estimate' — a note saved a moment ago carries a
            // local guess at its time rather than null, so it lands at the top of
            // the feed straight away instead of the bottom until the server answers.
            const rows = snap => snap.docs.map(d => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) }));

            return new Promise(resolve => {
                const watch = (ref, onNext, every, what) => {
                    _profileWatches.push(Live.watch(ref, onNext, {
                        fallbackEveryMs: every,
                        onError: e => { console.error('Could not keep ' + what + ' current:', e); if (what === 'person') resolve(); },
                    }));
                };

                const person = db.collection('people').doc(this.personId);

                watch(person, doc => {
                    if (!doc.exists) {
                        // Deleted here or somewhere else: either way there is no
                        // profile to show.
                        if (!this.isDeleting) window.location.href = 'shepherding-dashboard.html';
                        return;
                    }
                    this.person = { id: doc.id, ...doc.data({ serverTimestamps: 'estimate' }) };
                    resolve();
                }, PERSON, 'person');

                watch(person.collection('shepherding_notes').orderBy('createdAt', 'desc'), snap => {
                    this.personNotes = rows(snap);
                    this.fillSourceTitles();
                }, PERSON, 'notes');

                watch(person.collection('shepherding_activity').orderBy('createdAt', 'desc'), snap => {
                    this.activity = rows(snap);
                    this.fillSourceTitles();
                }, PERSON, 'the Pastoral Record');

                // Every Care List, for the cells about this person. Church-wide,
                // so the slow pace.
                watch(db.collection('elder_documents').where('docType', '==', 'care-list'), snap => {
                    this.careListDocs = rows(snap);
                    this.fillSourceTitles();
                }, ROSTER, 'Care List cells');

                watch(db.collection('people_tags').orderBy('name', 'asc'), snap => {
                    this.shepherdingTags = snap.docs.map(doc => ({
                        id: doc.id,
                        name: doc.data().name || doc.id,
                        hiddenFromOthers: doc.data().hiddenFromOthers || false,
                        hidePeople: doc.data().hidePeople || false,
                    }));
                }, ROSTER, 'tags');

                // Relationships (ADR-0012, MS-89; ADR-0013, MS-93).
                watch(db.collection('relationships'), snap => {
                    this.relationships = rows(snap);
                }, ROSTER, 'relationships');
                watch(db.collection('relationship_types'), snap => {
                    this.relationshipTypes = rows(snap);
                }, ROSTER, 'relationship types');
                watch(db.collection('relationship_groups'), snap => {
                    this.relGroups = snap.docs.map(d => ({ id: d.id, leaderId: null, memberIds: [], ...d.data() }));
                }, ROSTER, 'relationship groups');
                watch(db.collection('families'), snap => {
                    this.families = rows(snap);
                }, ROSTER, 'families');
                // Carry `sex` for the Family projection's gendered labels, `tags`
                // so the Assigned-Elder picker can find Elder-Tag People, and
                // `shepherding` so an elder's Care Group (reverse query) resolves.
                watch(db.collection('people').orderBy('name'), snap => {
                    this.allPeople = snap.docs.map(d => ({ id: d.id, name: (d.data().name || '(Unnamed)'), sex: d.data().sex || null, tags: d.data().tags || [], shepherding: d.data().shepherding || {} }));
                }, ROSTER, 'the directory');

                // A page that is gone stops listening — on the phone, a screen
                // left behind would otherwise keep re-reading in the background.
                window.addEventListener('pagehide', stopProfileWatches);
            });
        },

        // The title of each document a note or change came from. Titles barely
        // change, so each is read once, when an entry first names it.
        async fillSourceTitles() {
            const wanted = [...new Set([
                ...this.notes.map(n => n.sourceDocumentId),
                ...this.activity.map(a => a.sourceDocumentId),
            ].filter(Boolean))].filter(id => !(id in this.sourceDocTitles) && !_titlesAsked.has(id));
            if (!wanted.length) return;
            wanted.forEach(id => _titlesAsked.add(id));
            const results = await Promise.allSettled(
                wanted.map(id => db.collection('elder_documents').doc(id).get())
            );
            const titles = { ...this.sourceDocTitles };
            results.forEach((r, i) => {
                if (r.status === 'fulfilled' && r.value.exists) {
                    titles[wanted[i]] = r.value.data().title || 'Untitled Document';
                }
            });
            this.sourceDocTitles = titles;
        },

        // The profile, combined: notes (with Care List cells), the Pastoral
        // Record, and what has happened under an open note editor.
        get combined() {
            return ShepherdingCore.combineProfile({
                personId: this.personId,
                personNotes: this.personNotes,
                careListDocs: this.careListDocs,
                activity: this.activity,
                editor: this.showNoteEditor ? {
                    kind: 'note',
                    openedWith: this.editingNote,
                    holder: this.editingNote ? this.noteHolder(this.editingNote) : null,
                    lost: this.noteLost,
                } : null,
            });
        },

        get notes() { return this.combined.notes; },

        // ── Presence and the Box lock (MS-491, ADR-0035, ADR-0062) ──────────
        // The note editor, the details editor and the Task editor on this page
        // are boxes: one elder at a time, their face on it for everyone else,
        // and the hold lets go after a minute without typing.
        //
        // ⚠ PRESENCE MAY REMOVE A LOCK, NEVER AN EDITOR. Starting it cannot
        // throw, and while it is not running every editor simply opens.
        startPresence(user) {
            try {
                ShepherdingPresence.subscribe(entries => { this.presenceEntries = entries; });
                MosaicIdentity.me({ db, getUserData, uid: user.uid }).then(identity => {
                    // Your name as the church knows it, for "Sam changed this".
                    if (identity && identity.name) this.myName = identity.name;
                    ShepherdingPresence.start({
                        db,
                        uid: user.uid,
                        identity,
                        surface: 'shepherding-profile',
                        pageKey: this.personId,
                        stamp: () => firebase.firestore.FieldValue.serverTimestamp(),
                    });
                }).catch(e => console.warn('Presence could not work out who you are:', e));
                setInterval(() => { this.presenceTick++; }, PresenceCore.HEARTBEAT_MS);
                // leave(), not release(): release writes a fresh timestamp and
                // would leave you looking present for half a minute after going.
                const leave = () => ShepherdingPresence.leave();
                window.addEventListener('beforeunload', leave);
                window.addEventListener('pagehide', leave);
            } catch (e) {
                console.warn('Presence could not start on this profile; carrying on without it:', e);
            }
        },

        // Whoever else holds this box, or null.
        heldBy(box) {
            this.presenceTick; // read, so a quiet hold is redrawn as free
            return ShepherdingPresence.holderIn(
                this.presenceEntries, this.currentUser && this.currentUser.uid, box, Date.now());
        },

        noteHolder(entry) {
            if (!entry || entry.isCareList) return null;
            return this.heldBy(ShepherdingPresence.box.note(this.personId, entry.id));
        },

        get detailsHolder() {
            return this.heldBy(ShepherdingPresence.box.details(this.personId));
        },

        // The other elders on THIS person's profile — the row of faces.
        get othersHere() {
            this.presenceTick;
            if (!this.currentUser) return [];
            return PresenceCore.peopleHere(
                this.presenceEntries, this.currentUser.uid, 'shepherding-profile', this.personId,
                Date.now(), { idleMs: PresenceCore.SHEPHERDING_IDLE_MS });
        },

        holderLabel(holder) { return PresenceCore.holderLabel(holder); },
        holderTitle(holder) { return PresenceCore.holderTitle(holder); },

        editorWarning(state, what) { return ShepherdingCore.editorWarning(state, what); },

        // Every keystroke in an open editor. False back from the store means
        // somebody took the box while you were away.
        touchNote() {
            if (this.editingNote && !ShepherdingPresence.touch()) this.noteLost = true;
        },

        touchDetails() {
            if (this.showEditProfileModal && !ShepherdingPresence.touch()) this.detailsLost = true;
        },

        get noteEditorState() {
            if (!this.showNoteEditor || !this.editingNote || this.savingNote) return { state: 'unchanged' };
            return this.combined.editor || { state: 'unchanged' };
        },

        get noteSaveBlocked() { return this.noteEditorState.state !== 'unchanged'; },

        get detailsEditorState() {
            if (!this.showEditProfileModal || this.isSubmitting) return { state: 'unchanged' };
            return ShepherdingCore.editorState({
                kind: 'details', openedWith: this.detailsOpenedWith, current: this.person,
                holder: this.detailsHolder, lost: this.detailsLost,
            });
        },

        get detailsSaveBlocked() { return this.detailsEditorState.state !== 'unchanged'; },

        // ── Relationships (ADR-0012, MS-89; ADR-0013, MS-93) ─────────────────

        relPersonName(id) {
            const p = this.allPeople.find(x => x.id === id);
            return p ? p.name : '(unknown)';
        },

        relPersonSex(id) {
            const p = this.allPeople.find(x => x.id === id);
            return p ? p.sex : null;
        },

        relTypeById(id) {
            return this.relationshipTypes.find(t => t.id === id) || null;
        },

        // personRelationships — the card's row model (Family + Pairwise + Group)
        // — now lives in shepherding-quick-assign.js, beside the actions that
        // mutate those rows.

        relInitials(name) {
            const parts = (name || '').trim().split(/\s+/).filter(Boolean);
            if (!parts.length) return '?';
            if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
            return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
        },

        // The free-type relationship form (relForm, the chevron direction toggles,
        // relSentencePreview) lived here. It is gone: a Relationship Type is now a
        // kind × priority structure that a text box cannot express, and vocabulary is
        // curated in one place. The card applies existing types — see
        // shepherding-quick-assign.js.

        // ── Elder Assignment (ADR-0013, MS-94) ───────────────────────────────
        // A dedicated section (NOT the Relationships panel) assigns this member to
        // exactly one elder for care. Writes shepherding.assignedElderId (the
        // elder's Person id) and logs an Assignment Change to the Pastoral Record.
        get assignedElderId() {
            return (this.person && this.person.shepherding && this.person.shepherding.assignedElderId) || null;
        },
        get assignedElderName() {
            return this.assignedElderId ? this.relPersonName(this.assignedElderId) : '';
        },
        // The assignable set is exactly the Elder-Tag People (excluding self, so a
        // person is never their own elder).
        get elderCandidates() {
            return this.allPeople
                .filter(p => p.id !== this.personId && ShepherdingCore.isElderPerson(p))
                .slice()
                .sort((a, b) => a.name.localeCompare(b.name));
        },

        async setAssignedElder(elderId) {
            if (!this.canDecide) return;
            const newId = elderId || null;
            const prevId = this.assignedElderId;
            if (newId === prevId) return;
            this.assignmentSaving = true;
            try {
                await ShepherdingCore.commitAssignmentChange(db, this.personId, {
                    previous: { elderId: prevId, elderName: prevId ? this.relPersonName(prevId) : '' },
                    next: { elderId: newId, elderName: newId ? this.relPersonName(newId) : '' },
                    authorUid: this.currentUser && this.currentUser.uid,
                    authorName: this.currentUserName,
                    source: 'profile',
                });
                if (!this.person.shepherding) this.person.shepherding = {};
                this.person.shepherding.assignedElderId = newId;
                this.showToast(newId ? `Assigned to ${this.relPersonName(newId)}` : 'Assignment cleared');
            } catch (e) {
                console.error('Error updating elder assignment:', e);
                this.showToast('Error updating assignment', 'error');
            } finally {
                this.assignmentSaving = false;
            }
        },
        clearAssignedElder() { return this.setAssignedElder(null); },

        // Is the Person being viewed an elder (carries the projected Elder Tag)?
        get viewedPersonIsElder() {
            return ShepherdingCore.isElderPerson(this.person);
        },
        // The elder's Care Group: the members assigned to them (reverse query).
        get careGroup() {
            return ShepherdingCore.careGroupOf(this.allPeople, this.personId)
                .slice()
                .sort((a, b) => a.name.localeCompare(b.name));
        },

        // ── Membership Track (ADR-0012) — the stage slider, also on the profile ──
        // The same Track control the People list has, driven off this Person and
        // committing one Membership Change (silent tag swap) per move. A decision:
        // same AccessCore flag as Relations Viewer, not canWriteEditor. MS-594
        // gives a Pastoral Assistant the slider too.
        get canEditMembership() {
            return this.canDecide;
        },
        get membershipStages() { return ShepherdingCore.MEMBERSHIP_STAGES; },
        get membershipIndex() {
            const stage = this.person && this.person.membership && this.person.membership.stage;
            const i = ShepherdingCore.MEMBERSHIP_STAGES.indexOf(stage);
            return i === -1 ? 0 : i;
        },
        get membershipInactive() {
            return !!(this.person && this.person.membership && this.person.membership.inactive);
        },
        get membershipStageLabel() {
            if (this.membershipInactive) return 'Inactive';
            const stage = this.person && this.person.membership && this.person.membership.stage;
            return ShepherdingCore.MEMBERSHIP_STAGE_LABEL[stage] || 'Not on the Track';
        },
        async setMembershipStageByIndex(index) {
            const stage = ShepherdingCore.MEMBERSHIP_STAGES[Number(index)];
            if (!stage) return;
            await this.commitMembership({ stage, inactive: false });
        },
        async toggleMembershipInactive() {
            const m = (this.person && this.person.membership) || {};
            await this.commitMembership({ stage: m.stage || null, inactive: !m.inactive });
        },
        async commitMembership(next) {
            if (!this.canDecide) return;
            const person = this.person;
            if (!person) return;
            const previous = {
                stage: (person.membership && person.membership.stage) || null,
                inactive: !!(person.membership && person.membership.inactive),
            };
            if (previous.stage === next.stage && previous.inactive === next.inactive) return;
            try {
                await ShepherdingCore.commitMembershipChange(db, person.id, {
                    currentTags: person.tags || [],
                    previous,
                    next,
                    authorUid: this.currentUser && this.currentUser.uid,
                    authorName: this.currentUserName,
                    source: 'profile',
                });
                // Reflect the field + re-projected tags locally, then refresh the feed.
                const newTags = ShepherdingCore.applyMembershipTags(person.tags || [], next);
                person.membership = { ...(person.membership || {}), stage: next.stage, inactive: next.inactive };
                person.tags = newTags;
                this.showToast(ShepherdingCore.describeMembershipChange(
                    ShepherdingCore.buildMembershipChange({ previous, next })
                ));
            } catch (e) {
                console.error('Error updating membership:', e);
                this.showToast('Error updating membership', 'error');
            }
        },

        // Create (or reuse) a Relationship Type by the typed phrase, then add the
        // edge oriented by the chevrons: both ends on → symmetric (non-directional);
        // left-only → the other person is the source (flows toward this Person);
        // otherwise this Person is the source.
        // addRelationship() lived here. It free-typed a Relationship Type into
        // existence — `{ name, directional }` — straight from the profile. ADR-0014
        // retires both halves of that: `directional` is gone, and vocabulary is now
        // curated in Manage Tags and Relationships, never minted from a profile. The
        // card applies existing types only; see qaAddPairwise in
        // shepherding-quick-assign.js.

        async deleteRelationship(edgeId) {
            try {
                await db.collection('relationships').doc(edgeId).delete();
                this.relationships = this.relationships.filter(r => r.id !== edgeId);
                this.showToast('Relationship removed');
            } catch (e) {
                console.error('Error removing relationship:', e);
                this.showToast('Error removing relationship', 'error');
            }
        },

        get pastoralRecord() {
            return this.combined.record;
        },

        get displayRecord() {
            if (!this.collapseStatusChanges) return this.pastoralRecord;
            return ShepherdingCore.collapsePastoralRecord(this.pastoralRecord);
        },

        // ── Editor ────────────────────────────────────────────────────────────

        openAddNote() {
            this.editingNote = null;
            this.noteForm = { type: 'Elder Check-in', subject: '', contentJson: null };
            this.showNoteEditor = true;
            this.$nextTick(() => this.initEditor());
        },

        openEditNote(note) {
            // A note somebody else has open does not open (ADR-0035).
            const box = ShepherdingPresence.box.note(this.personId, note.id);
            if (!ShepherdingPresence.claimBox(box)) {
                this.showToast(this.holderTitle(this.noteHolder(note)) || 'Someone is editing this', 'error');
                return;
            }
            this.noteLost = false;
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
            if (this.editingNote) ShepherdingPresence.release();
            this.noteLost = false;
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
            // The VENDORED bundle, not esm.sh. This was a dozen dynamic
            // imports from a CDN nobody chose: if it was slow, blocked or
            // down, the editor did not open and nothing said why — on the
            // pages the elders write in. tiptap-editor-loader.js reads
            // vendor/tiptap/tiptap.bundle.js, the same file the phone app has
            // always used, and builds the identical window._TipTap (ADR-0050).
            await window.TiptapEditorLoader.ensureTipTap();

            await loadMentionData();

            const el = document.getElementById('tiptap-note-editor');
            if (!el) return;

            if (_noteEditor) { _noteEditor.destroy(); _noteEditor = null; }

            const { Editor, StarterKit, Underline, Mention, TextStyle, FontFamily, FontSize, Highlight, Table, TableRow, TableHeader, TableCell, Image, Link, TextAlign } = window._TipTap;
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
                    // Added with the Word work. Image is the one that matters
                    // most: without it a picture in an imported .docx is
                    // dropped on the way in and nobody is told.
                    Image.configure({ inline: false, allowBase64: true }),
                    Link.configure({ openOnClick: false, autolink: true }),
                    TextAlign.configure({ types: ['heading', 'paragraph'] }),
                    Mention.configure({
                        HTMLAttributes: { class: 'mention-chip' },
                        suggestion: createMentionSuggestion(),
                    }),
                ],
                content: content || '',
                onTransaction() { self.editorUpdated++; },
                onUpdate() { self.touchNote(); },
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

            // Never over somebody else's work. The warning above Save already
            // says why; the text stays in the editor.
            this.touchNote();
            if (this.noteSaveBlocked) return;

            this.savingNote = true;
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
                        updatedBy: this.currentUser && this.currentUser.uid,
                        updatedByName: this.myName || this.currentUserName,
                    });
                    this.showToast('Note updated');
                } else {
                    await notesRef.add({
                        ...payload,
                        authorUid: this.currentUser && this.currentUser.uid,
                        authorName: this.currentUserName,
                        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                    });
                    await ShepherdingCore.touchLastNoteAt(
                        db, this.personId, firebase.firestore.FieldValue.serverTimestamp());
                    this.showToast('Note added');
                }

                this.closeEditor();
            } catch (e) {
                console.error('Error saving note:', e);
                this.showToast('Error saving note', 'error');
            } finally {
                this.savingNote = false;
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
                await ShepherdingCore.refreshLastNoteAt(db, this.personId);
                this.personNotes = this.personNotes.filter(n => n.id !== id);
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
            if (!this.canDecide) return;
            // Projected Tags follow their source of truth (ADR-0012 Membership
            // Track, ADR-0013 Elder role), never manual tagging.
            if (ShepherdingCore.isProjectedTagId(tagId)) {
                this.showToast('This tag is set by the system, not manual tagging', 'error');
                return;
            }
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
                    authorUid: this.currentUser && this.currentUser.uid,
                    authorName: this.currentUserName,
                    source: 'profile',
                }));
                this.person.tags = newTags;
            } catch (e) {
                console.error('Error toggling tag:', e);
                this.showToast('Error updating tags', 'error');
            }
        },

        async createTag() {
            if (!this.canDecide) return;
            const name = this.newTagName.trim();
            if (!name) return;
            const exists = this.shepherdingTags.some(t => t.name.toLowerCase() === name.toLowerCase());
            if (exists) { this.showToast('Tag already exists', 'error'); return; }
            try {
                // Stable auto-id identity, independent of the name (ADR-0011).
                const ref = await db.collection('people_tags').add({
                    name,
                    hiddenFromOthers: false,
                    hidePeople: false,
                });
                this.shepherdingTags = [...this.shepherdingTags, { id: ref.id, name, hiddenFromOthers: false, hidePeople: false }]
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

        // Tag Hold per carried tag, derived from the Pastoral Record (ADR-0011).
        get tagHolds() {
            return ShepherdingCore.deriveTagHolds(
                this.activity,
                (this.person && this.person.tags) || [],
                Date.now()
            );
        },

        // Human Hold Duration for a tag chip, or '' when the hold is unknown.
        tagHoldLabel(tagId) {
            const hold = this.tagHolds[tagId];
            return hold ? ShepherdingCore.formatHoldDuration(hold.durationMs) : '';
        },

        // ── Profile Editing ──────────────────────────────────────────────────

        openEditProfile() {
            if (!ShepherdingPresence.claimBox(ShepherdingPresence.box.details(this.personId))) {
                this.showToast(this.holderTitle(this.detailsHolder) || 'Someone is editing this', 'error');
                return;
            }
            this.detailsLost = false;
            this.detailsOpenedWith = JSON.parse(JSON.stringify(this.person));
            this.selectedPerson = JSON.parse(JSON.stringify(this.person));
            if (!this.selectedPerson.contact) this.selectedPerson.contact = {};
            this.showEditProfileModal = true;
        },

        closeEditProfile() {
            if (this.showEditProfileModal) ShepherdingPresence.release();
            this.showEditProfileModal = false;
            this.detailsLost = false;
            this.detailsOpenedWith = null;
        },

        async saveProfile() {
            if (!this.selectedPerson) return;
            this.touchDetails();
            if (this.detailsSaveBlocked) return;
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
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                    // Who saved it, so another elder with the details open can
                    // be told by name that they changed (MS-490).
                    updatedByName: this.myName || this.currentUserName,
                };

                await personRef.update(updates);
                this.person = { ...this.person, ...this.selectedPerson };
                this.closeEditProfile();
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
                    liveUser && liveUser.email,
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
                    db.collection('people').doc(this.personId).collection('shepherding_notes').get(FRESH_READ),
                    db.collection('people').doc(this.personId).collection('shepherding_activity').get(FRESH_READ),
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
            if (!confirm('Are you sure you want to delete all status and tag change history for this person? This cannot be undone.')) return;

            try {
                const snap = await db.collection('people').doc(this.personId)
                    .collection('shepherding_activity')
                    .where('kind', 'in', ['status_change', 'tag_change'])
                    .get(FRESH_READ);

                if (snap.empty) {
                    this.showToast('No status or tag history to delete.');
                    return;
                }

                const batch = db.batch();
                snap.docs.forEach(doc => batch.delete(doc.ref));
                await batch.commit();

                this.showToast('Status and tag history deleted.');
            } catch (e) {
                console.error('Error deleting status/tag history:', e);
                this.showToast('Error deleting history', 'error');
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
                    authorUid: this.currentUser && this.currentUser.uid,
                    authorName: this.currentUserName,
                    source: 'profile',
                }));
                this.person.shepherdingStatus = newStatus;
                this.showToast(clearing ? 'Status cleared' : 'Status updated');
            } catch (e) {
                console.error('Error updating status:', e);
                this.showToast('Error updating status', 'error');
            }
        },

        // The id of the newest Status Change in the record. Only this change is
        // undoable: undoing it reverts the Person's current status to what this
        // change replaced, so it must be the one currently in force. Once it's
        // undone (and deleted), the next-newest becomes the latest and, in turn,
        // undoable — giving a natural step-back through the history.
        get latestStatusChangeId() {
            const latest = this.activity.find(a => a.kind === 'status_change');
            return latest ? latest.id : null;
        },

        canUndoStatusChange(entry) {
            return !!this.canDecide && !!entry && entry.id === this.latestStatusChangeId;
        },

        // Undo an accidental status change straight from the timeline: restore
        // the status this change replaced and delete the change's record, in one
        // atomic batch (ADR-0005 mirror — revertPastoralChange). A decision —
        // canUndoStatusChange already asks canDecide; refuse here too so a
        // caller without decide never reaches the toast.
        async undoStatusChange(entry) {
            if (!this.canDecide || !this.canUndoStatusChange(entry)) return;
            const restored = entry.previousStatus || null;
            try {
                await ShepherdingCore.revertPastoralChange(db, this.personId, {
                    shepherdingStatus: restored,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                }, entry.id);
                this.person.shepherdingStatus = restored;
                this.showToast('Status change undone');
            } catch (e) {
                console.error('Error undoing status change:', e);
                this.showToast('Error undoing change', 'error');
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
            if (!this.canDecide) return;
            this.explanationDraft = { ...this.explanationDraft, [activityId]: currentText || '' };
            this.editingExplanation = { ...this.editingExplanation, [activityId]: true };
        },

        async saveExplanation(activityId) {
            if (!this.canDecide) return;
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
            // Three bands over the 0-4 score: pressing, worth a look, settled.
            // These were pre-brand Material values until the palette moved
            // without them, which is why the grid drew a different red from
            // every other warning in the app.
            const ACTIVE_COLOR  = { 0: 'var(--error)', 1: 'var(--error)', 2: 'var(--secondary)', 3: 'var(--secondary)', 4: 'var(--outline)' };
            const PASSIVE_COLOR = { 0: 'var(--error-container)', 1: 'var(--error-container)', 2: 'var(--primary-fixed)', 3: 'var(--primary-fixed)', 4: 'var(--surface-container)' };
            let html = '<div style="display:grid;grid-template-columns:repeat(3,20px);gap:2px;">';
            IMPORTANCE.forEach(imp => {
                URGENCY.forEach(urg => {
                    const active = status.urgency === urg && status.importance === imp;
                    const score  = ShepherdingCore.statusScore(urg, imp);
                    const bg     = active ? (ACTIVE_COLOR[score] || 'var(--outline)') : (PASSIVE_COLOR[score] || 'var(--surface-container)');
                    html += `<div style="width:20px;height:20px;border-radius:3px;background:${bg};border:${active ? 'none' : '1px solid var(--outline-variant)'};display:flex;align-items:center;justify-content:center;">`;
                    if (active) html += '<span style="width:5px;height:5px;border-radius:50%;background:var(--surface-container-lowest);display:block;"></span>';
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
