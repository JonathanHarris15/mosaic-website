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
        sortBy: 'name',

        loading: true,
        toast: { show: false, message: '', type: 'success' },

        async init() {
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
