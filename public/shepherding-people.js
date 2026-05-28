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
            
            // Optimization: Apply hidePeople logic if relevant
            const hidePeopleIds = new Set(this.shepherdingTags.filter(t => t.hidePeople).map(t => t.id));
            const shepherdingHidden = newTags.some(id => hidePeopleIds.has(id));

            try {
                await db.collection('people').doc(this.tagPerson.id).update({
                    tags: hasIt 
                        ? firebase.firestore.FieldValue.arrayRemove(tagId)
                        : firebase.firestore.FieldValue.arrayUnion(tagId),
                    shepherdingHidden
                });
                
                this.tagPerson.tags = newTags;
                
                // Update in main list
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
