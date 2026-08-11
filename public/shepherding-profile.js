// A read whose RESULT DECIDES A WRITE — a merge, a re-point, a batch of
// deletes. In the phone app ordinary reads are answered from the device
// (local-cache.js); these must not be. Stale input to a write does not show
// you old data, it destroys new data: a merge planned from a people list a
// minute old silently drops whoever was added in that minute. Ignored on the
// web, where reads were always live.
var FRESH_READ = { source: 'server' };
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
let _docTypeById     = {}; // elder_document id → docType (e.g. 'care-list')
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
                    popup.style.cssText = 'position:fixed;z-index:9999;background:var(--surface-container-lowest);border:1px solid #c5c6d0;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.12);min-width:220px;max-height:280px;overflow-y:auto;padding:4px 0;font-family:"Work Sans",sans-serif;font-size:14px;';
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

        // Which profile tab is showing (MS-98): the Pastoral Record or the
        // per-person Documents directory.
        activeTab: 'record', // 'record' | 'documents'

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
                this.currentPermissionLevel = (userData && (userData.permissionLevel || userData.role)) || 'viewer';
                if (!['elder', 'super_admin'].includes(this.currentPermissionLevel)) {
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
                    uid: user.uid,
                    personId: userData && userData.personId,
                });

                await Promise.all([
                    this.loadPerson(),
                    this.loadNotes(),
                    this.loadTags(),
                    this.loadActivity(),
                    this.loadRelationships(),
                ]);
                this.loading = false;
            });
        },

        // ── Relationships (ADR-0012, MS-89; ADR-0013, MS-93) ─────────────────
        async loadRelationships() {
            try {
                const [relSnap, typeSnap, peopleSnap, famSnap, groupSnap] = await Promise.all([
                    db.collection('relationships').get(),
                    db.collection('relationship_types').get(),
                    db.collection('people').orderBy('name').get(),
                    db.collection('families').get(),
                    db.collection('relationship_groups').get(),
                ]);
                this.relationships = relSnap.docs.map(d => ({ id: d.id, ...d.data() }));
                this.relationshipTypes = typeSnap.docs.map(d => ({ id: d.id, ...d.data() }));
                this.relGroups = groupSnap.docs.map(d => ({ id: d.id, leaderId: null, memberIds: [], ...d.data() }));
                // Carry `sex` for the Family projection's gendered labels, `tags`
                // so the Assigned-Elder picker can find Elder-Tag People, and
                // `shepherding` so an elder's Care Group (reverse query) resolves.
                this.allPeople = peopleSnap.docs.map(d => ({ id: d.id, name: (d.data().name || '(Unnamed)'), sex: d.data().sex || null, tags: d.data().tags || [], shepherding: d.data().shepherding || {} }));
                this.families = famSnap.docs.map(d => ({ id: d.id, ...d.data() }));
            } catch (e) {
                console.error('Error loading relationships:', e);
            }
        },

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
                await this.loadActivity();  // surface the new Assignment Change in the feed
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
        // committing one Membership Change (silent tag swap) per move. Editors only.
        get canEditMembership() {
            return ['editor', 'admin', 'elder', 'super_admin'].includes(this.currentPermissionLevel);
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
                await this.loadActivity();
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

                await this.loadActivity();
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
            return !!entry && entry.id === this.latestStatusChangeId;
        },

        // Undo an accidental status change straight from the timeline: restore
        // the status this change replaced and delete the change's record, in one
        // atomic batch (ADR-0005 mirror — revertPastoralChange).
        async undoStatusChange(entry) {
            if (!this.canUndoStatusChange(entry)) return;
            const restored = entry.previousStatus || null;
            try {
                await ShepherdingCore.revertPastoralChange(db, this.personId, {
                    shepherdingStatus: restored,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                }, entry.id);
                this.person.shepherdingStatus = restored;
                await this.loadActivity();
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
            // Three bands over the 0-4 score: pressing, worth a look, settled.
            // These were the pre-brand Material values (#ba1a1a, #436082,
            // #75777f and their tints) until the palette moved without them.
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
