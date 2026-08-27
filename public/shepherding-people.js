// Shepherding Status value model — single source of truth in shepherding-core.js.
// The People list uses the short label variant (narrow table cells).
const URGENCY_LEVELS = ShepherdingCore.URGENCY_LEVELS;
const IMPORTANCE_LEVELS = ShepherdingCore.IMPORTANCE_LEVELS;
const URGENCY_LABEL = ShepherdingCore.URGENCY_LABEL_SHORT;
const IMPORTANCE_LABEL = ShepherdingCore.IMPORTANCE_LABEL_SHORT;
const statusZoneKey = ShepherdingCore.statusZoneKey;

document.addEventListener('alpine:init', () => {
    Alpine.data('shepherdingPeople', () => ({
        currentUser: null,
        currentPermissionLevel: null,

        people: [],
        lastNoteDates: {},
        shepherdingTags: [],

        search: '',
        tagFilters: [],
        tagFilterMode: 'any',
        statusZoneFilters: [],
        sortBy: 'name',
        // Inactive people are hidden from the People list by default; this toggle
        // (in Filters) reveals them (ADR-0012 — inactive is orthogonal to the Track).
        showInactive: false,

        // Hold-Duration filter (ADR-0011): each selected tag carries its own
        // threshold in days (0 = anyone carrying it) and a direction — 'gte' (held
        // at least) or 'lt' (held less than) — both keyed by tagId. Tag Hold is
        // derived from Tag Change history, loaded lazily on first use.
        tagHoldFilters: {},
        tagHoldCmp: {},
        tagHolds: {},
        holdsLoaded: false,

        filterViews: [],
        showSaveViewModal: false,
        newFilterViewName: '',
        isSavingView: false,
        showStatusFilter: true,

        showAddPersonModal: false,
        newPerson: {
            name: '',
            email: '',
            phone: '',
            address: '',
            birthday: '',
            sex: ''
        },
        isSubmitting: false,

        showTagManagementModal: false,
        tagPerson: null,

        loading: true,
        toast: { show: false, message: '', type: 'success' },

        async init() {
            // Restore filters from session storage (persists across in-session navigation)
            try {
                const savedFilters = sessionStorage.getItem('shepherding_tagFilters');
                if (savedFilters) this.tagFilters = JSON.parse(savedFilters);
                const savedMode = sessionStorage.getItem('shepherding_tagFilterMode');
                if (savedMode) this.tagFilterMode = savedMode;
                const savedZones = sessionStorage.getItem('shepherding_statusZoneFilters');
                if (savedZones) this.statusZoneFilters = JSON.parse(savedZones);
                const savedHoldFilters = sessionStorage.getItem('shepherding_tagHoldFilters');
                if (savedHoldFilters) this.tagHoldFilters = JSON.parse(savedHoldFilters);
                const savedHoldCmp = sessionStorage.getItem('shepherding_tagHoldCmp');
                if (savedHoldCmp) this.tagHoldCmp = JSON.parse(savedHoldCmp);
                const savedShowInactive = sessionStorage.getItem('shepherding_showInactive');
                if (savedShowInactive) this.showInactive = savedShowInactive === 'true';
            } catch {}

            this.$watch('tagFilters', val => sessionStorage.setItem('shepherding_tagFilters', JSON.stringify(val)));
            this.$watch('tagFilterMode', val => sessionStorage.setItem('shepherding_tagFilterMode', val));
            this.$watch('statusZoneFilters', val => sessionStorage.setItem('shepherding_statusZoneFilters', JSON.stringify(val)));
            // Persist the per-tag Hold-Duration thresholds, and load Tag Hold
            // history the first time any threshold is raised above zero.
            this.$watch('tagHoldFilters', val => {
                sessionStorage.setItem('shepherding_tagHoldFilters', JSON.stringify(val));
                if (this.anyHoldActive() && !this.holdsLoaded) this.loadTagHolds();
            });
            this.$watch('tagHoldCmp', val => sessionStorage.setItem('shepherding_tagHoldCmp', JSON.stringify(val)));
            this.$watch('showInactive', val => sessionStorage.setItem('shepherding_showInactive', String(val)));

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

                // Dev-only privacy screen (shepherding-blur.js).
                ShepherdingBlur.configure({
                    permissionLevel: this.currentPermissionLevel,
                    uid: user.uid,
                    personId: userData && userData.personId,
                });

                await Promise.all([
                    this.loadPeople(),
                    this.loadTags(),
                    this.loadFilterViews(),
                ]);
                // A restored Hold-Duration filter needs its history up front.
                if (this.anyHoldActive()) await this.loadTagHolds();
                this.loading = false;
            });
        },

        async loadPeople() {
            try {
                const peopleSnap = await db.collection('people').orderBy('name', 'asc').get();
                this.people = peopleSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            } catch (e) {
                console.error('Error loading people:', e);
                this.showToast('Error loading people', 'error');
            }

            try {
                const notesSnap = await db.collectionGroup('shepherding_notes')
                    .orderBy('createdAt', 'desc')
                    .get();
                const latestByPerson = {};
                notesSnap.docs.forEach(doc => {
                    const personId = doc.ref.parent.parent.id;
                    if (!latestByPerson[personId]) {
                        latestByPerson[personId] = doc.data().createdAt;
                    }
                });
                this.lastNoteDates = latestByPerson;
            } catch (e) {
                console.error('Error loading last note dates (collection group query may need a Firestore index):', e);
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

        get filteredPeople() {
            let result = this.people;

            // Hide inactive people unless the Filters toggle reveals them.
            if (!this.showInactive) {
                result = result.filter(p => !ShepherdingCore.isInactiveMembership(p.membership));
            }

            if (this.tagFilters.length > 0) {
                // A person "matches" a filter tag when they carry it AND (if that
                // tag's slider is above 0) have held it at least that long. any/all
                // mode then combines the per-tag matches.
                const matches = (p, t) => {
                    if (!(p.tags || []).includes(t)) return false;
                    const min = this.tagHoldFilters[t] || 0;
                    if (min <= 0) return true;
                    const h = (this.tagHolds[p.id] || {})[t];
                    return ShepherdingCore.holdSatisfies(h && h.durationMs, min, this.tagHoldCmp[t]);
                };
                result = result.filter(p => this.tagFilterMode === 'all'
                    ? this.tagFilters.every(t => matches(p, t))
                    : this.tagFilters.some(t => matches(p, t)));
            }

            if (this.statusZoneFilters.length > 0) {
                result = result.filter(p => {
                    if (!p.shepherdingStatus) return false;
                    return this.statusZoneFilters.includes(
                        statusZoneKey(p.shepherdingStatus.urgency, p.shepherdingStatus.importance)
                    );
                });
            }

            if (this.search.trim()) {
                const q = this.search.trim().toLowerCase();
                result = result.filter(p => p.name?.toLowerCase().includes(q));
            }

            if (this.sortBy === 'attention') {
                result = [...result].sort((a, b) => {
                    const aTs = this.lastNoteDates[a.id];
                    const bTs = this.lastNoteDates[b.id];
                    if (!aTs && !bTs) return (a.name || '').localeCompare(b.name || '');
                    if (!aTs) return -1;
                    if (!bTs) return 1;
                    const aTime = aTs.toDate ? aTs.toDate().getTime() : new Date(aTs).getTime();
                    const bTime = bTs.toDate ? bTs.toDate().getTime() : new Date(bTs).getTime();
                    return aTime - bTime;
                });
            }

            return result;
        },

        toggleTagFilter(tagId) {
            if (this.tagFilters.includes(tagId)) {
                this.tagFilters = this.tagFilters.filter(t => t !== tagId);
                // Deselecting a tag drops its Hold-Duration slider and direction.
                if (tagId in this.tagHoldFilters) {
                    const next = { ...this.tagHoldFilters };
                    delete next[tagId];
                    this.tagHoldFilters = next;
                }
                if (tagId in this.tagHoldCmp) {
                    const next = { ...this.tagHoldCmp };
                    delete next[tagId];
                    this.tagHoldCmp = next;
                }
            } else {
                this.tagFilters = [...this.tagFilters, tagId];
            }
        },

        getTagName(tagId) {
            const tag = this.shepherdingTags.find(t => t.id === tagId);
            return tag ? tag.name : tagId;
        },

        // ── Hold-Duration filter (ADR-0011) ───────────────────────────────────

        // One collection-group pass over Tag Changes, grouped by person, derived
        // into current holds via the core. Loaded lazily the first time the filter
        // is switched on.
        async loadTagHolds() {
            try {
                const snap = await db.collectionGroup('shepherding_activity')
                    .where('kind', '==', 'tag_change')
                    .get();
                const byPerson = {};
                snap.docs.forEach(doc => {
                    const personId = doc.ref.parent.parent && doc.ref.parent.parent.id;
                    if (!personId) return;
                    (byPerson[personId] || (byPerson[personId] = [])).push(doc.data());
                });
                const now = Date.now();
                const holds = {};
                this.people.forEach(p => {
                    holds[p.id] = ShepherdingCore.deriveTagHolds(byPerson[p.id] || [], p.tags || [], now);
                });
                this.tagHolds = holds;
                this.holdsLoaded = true;
            } catch (e) {
                console.error('Error loading tag holds:', e);
            }
        },

        // ── Per-tag Hold-Duration slider ──────────────────────────────────────
        holdStops() { return ShepherdingCore.HOLD_FILTER_STOPS; },
        tagHoldStopIndex(tagId) { return ShepherdingCore.holdStopIndex(this.tagHoldFilters[tagId] || 0); },
        setTagHoldStop(tagId, idx) {
            const days = ShepherdingCore.HOLD_FILTER_STOPS[Number(idx)] || 0;
            this.tagHoldFilters = { ...this.tagHoldFilters, [tagId]: days };
        },
        holdShort(tagId) { return ShepherdingCore.formatHoldShort(this.tagHoldFilters[tagId] || 0); },
        anyHoldActive() { return Object.values(this.tagHoldFilters).some(d => d > 0); },

        // Dev-only blur: a shepherding filter is active when the list is narrowed
        // by tag, status zone, or Hold Duration. In that case a person's presence
        // reveals sensitive membership, so their name is screened for the super
        // admin (shepherding-blur.js nameClass).
        get shepherdingFilterActive() {
            return this.tagFilters.length > 0
                || this.statusZoneFilters.length > 0
                || this.anyHoldActive();
        },
        // Direction, in words: 'recent' (held less than) or 'older' (held at
        // least, the default). The core owns the wording so this panel and the
        // Filtered View editor cannot drift apart again (MS-279).
        holdDirectionWord(tagId) { return ShepherdingCore.holdDirectionWord(this.tagHoldCmp[tagId]); },
        holdDirectionHint(tagId) { return ShepherdingCore.holdDirectionHint(this.tagHoldCmp[tagId]); },
        holdScrubberLabel(tagId) {
            return ShepherdingCore.holdScrubberLabel(this.tagHoldCmp[tagId], this.holdShort(tagId));
        },
        toggleHoldCmp(tagId) {
            const next = this.tagHoldCmp[tagId] === 'lt' ? 'gte' : 'lt';
            this.tagHoldCmp = { ...this.tagHoldCmp, [tagId]: next };
        },

        // ── Status matrix ─────────────────────────────────────────────────────

        toggleStatusZone(urgency, importance) {
            const key = statusZoneKey(urgency, importance);
            if (this.statusZoneFilters.includes(key)) {
                this.statusZoneFilters = this.statusZoneFilters.filter(z => z !== key);
            } else {
                this.statusZoneFilters = [...this.statusZoneFilters, key];
            }
        },

        isZoneSelected(urgency, importance) {
            return this.statusZoneFilters.includes(statusZoneKey(urgency, importance));
        },

        statusCellColor(urgency, importance) {
            return ShepherdingCore.statusCellColor(urgency, importance);
        },

        formatStatus(status) {
            if (!status) return '';
            return `${URGENCY_LABEL[status.urgency] || ''} · ${IMPORTANCE_LABEL[status.importance] || ''}`;
        },

        urgencyLabel(u) { return URGENCY_LABEL[u] || u; },
        importanceLabel(i) { return IMPORTANCE_LABEL[i] || i; },

        // ── Filter views ──────────────────────────────────────────────────────

        async loadFilterViews() {
            try {
                const snap = await db.collection('shepherding_views').orderBy('title', 'asc').get();
                this.filterViews = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            } catch (e) {
                console.error('Error loading filter views:', e);
            }
        },

        loadFilterView(view) {
            this.tagFilters = view.filterTags || [];
            this.tagFilterMode = view.filterMode || 'any';
            this.statusZoneFilters = view.statusZoneFilters || [];
            if (view.sortBy) this.sortBy = view.sortBy;
        },

        async saveFilterView() {
            const title = this.newFilterViewName.trim();
            if (!title) return;
            this.isSavingView = true;
            try {
                const view = {
                    title,
                    filterTags: this.tagFilters,
                    filterMode: this.tagFilterMode,
                    statusZoneFilters: this.statusZoneFilters,
                    sortBy: this.sortBy,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                    createdBy: auth.currentUser.uid,
                };
                const ref = await db.collection('shepherding_views').add(view);
                this.filterViews = [...this.filterViews, { id: ref.id, ...view }]
                    .sort((a, b) => a.title.localeCompare(b.title));
                this.newFilterViewName = '';
                this.showSaveViewModal = false;
                this.showToast(`View "${title}" saved`);
            } catch (e) {
                console.error('Error saving filter view:', e);
                this.showToast('Error saving view', 'error');
            } finally {
                this.isSavingView = false;
            }
        },

        async deleteFilterView(id) {
            try {
                await db.collection('shepherding_views').doc(id).delete();
                this.filterViews = this.filterViews.filter(v => v.id !== id);
                this.showToast('View deleted');
            } catch (e) {
                console.error('Error deleting view:', e);
                this.showToast('Error deleting view', 'error');
            }
        },

        async addPerson() {
            const name = this.newPerson.name.trim();
            if (!name) return;
            
            this.isSubmitting = true;
            try {
                const now = firebase.firestore.FieldValue.serverTimestamp();
                const docRef = await db.collection('people').add({
                    name: name,
                    totalInvolvements: 0,
                    contact: {
                        email: (this.newPerson.email || '').trim(),
                        phone: (this.newPerson.phone || '').trim(),
                        address: (this.newPerson.address || '').trim()
                    },
                    birthday: this.newPerson.birthday || null,
                    sex: this.newPerson.sex || null,
                    lastPastoralPrayerDate: null,
                    tags: [],
                    createdAt: now,
                    updatedAt: now
                });
                
                const newId = docRef.id;
                this.newPerson = { name: '', email: '', phone: '', address: '', birthday: '', sex: '' };
                await this.loadPeople();
                this.showAddPersonModal = false;
                this.showToast('Person added successfully');
                
                // Redirect to the new person's profile
                window.location.href = `shepherding-profile.html?id=${newId}`;
            } catch (e) {
                console.error(e);
                this.showToast('Error adding person', 'error');
            } finally {
                this.isSubmitting = false;
            }
        },

        openTagManagement(person) {
            this.tagPerson = { ...person };
            if (!this.tagPerson.tags) this.tagPerson.tags = [];
            this.showTagManagementModal = true;
        },

        async togglePersonTag(tagId) {
            if (!this.tagPerson) return;
            const hasIt = this.tagPerson.tags.includes(tagId);
            const newTags = hasIt
                ? this.tagPerson.tags.filter(t => t !== tagId)
                : [...this.tagPerson.tags, tagId];

            const hidePeopleIds = new Set(this.shepherdingTags.filter(t => t.hidePeople).map(t => t.id));
            const shepherdingHidden = newTags.some(id => hidePeopleIds.has(id));
            const tag = this.shepherdingTags.find(t => t.id === tagId);
            const tagName = tag ? tag.name : tagId;
            const authorName = this.currentUser?.email ? this.currentUser.email.split('@')[0] : 'Elder';

            try {
                await ShepherdingCore.commitPastoralChange(db, this.tagPerson.id, {
                    tags: hasIt
                        ? firebase.firestore.FieldValue.arrayRemove(tagId)
                        : firebase.firestore.FieldValue.arrayUnion(tagId),
                    shepherdingHidden
                }, ShepherdingCore.buildTagChange({
                    tagId, tagName,
                    action: hasIt ? 'removed' : 'added',
                    authorUid: this.currentUser.uid,
                    authorName,
                    source: 'people_list',
                }));

                this.tagPerson.tags = newTags;

                const idx = this.people.findIndex(p => p.id === this.tagPerson.id);
                if (idx !== -1) {
                    this.people[idx].tags = newTags;
                    this.people[idx].shepherdingHidden = shepherdingHidden;
                }

                this.showToast(`Tag ${hasIt ? 'removed' : 'applied'}`);
            } catch (e) {
                console.error('Error toggling person tag:', e);
                this.showToast('Error updating tags', 'error');
            }
        },

        formatLastNote(personId) {
            const ts = this.lastNoteDates[personId];
            if (!ts) return 'Never';
            const date = ts.toDate ? ts.toDate() : new Date(ts);
            return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        },

        lastNoteColor(personId) {
            const ts = this.lastNoteDates[personId];
            if (!ts) return 'text-error';
            const date = ts.toDate ? ts.toDate() : new Date(ts);
            const daysSince = (Date.now() - date.getTime()) / (1000 * 60 * 60 * 24);
            if (daysSince > 90) return 'text-error';
            if (daysSince > 30) return 'text-on-surface-variant';
            return 'text-secondary';
        },

        showToast(message, type = 'success') {
            this.toast = { show: true, message, type };
            setTimeout(() => { this.toast.show = false; }, 3000);
        },
    }));
});
