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
        currentUserRole: null,

        people: [],
        lastNoteDates: {},
        shepherdingTags: [],

        search: '',
        tagFilters: [],
        tagFilterMode: 'any',
        statusZoneFilters: [],
        sortBy: 'name',

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
            } catch {}

            this.$watch('tagFilters', val => sessionStorage.setItem('shepherding_tagFilters', JSON.stringify(val)));
            this.$watch('tagFilterMode', val => sessionStorage.setItem('shepherding_tagFilterMode', val));
            this.$watch('statusZoneFilters', val => sessionStorage.setItem('shepherding_statusZoneFilters', JSON.stringify(val)));

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

                await Promise.all([
                    this.loadPeople(),
                    this.loadTags(),
                    this.loadFilterViews(),
                ]);
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

            if (this.tagFilters.length > 0) {
                result = result.filter(p => {
                    const personTags = p.tags || [];
                    if (this.tagFilterMode === 'all') {
                        return this.tagFilters.every(t => personTags.includes(t));
                    }
                    return this.tagFilters.some(t => personTags.includes(t));
                });
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
            } else {
                this.tagFilters = [...this.tagFilters, tagId];
            }
        },

        getTagName(tagId) {
            const tag = this.shepherdingTags.find(t => t.id === tagId);
            return tag ? tag.name : tagId;
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
