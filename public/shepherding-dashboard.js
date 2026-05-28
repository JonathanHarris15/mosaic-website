document.addEventListener('alpine:init', () => {
    Alpine.data('shepherdingDashboard', () => ({
        currentUser: null,
        currentUserRole: null,
        currentUserName: '',

        reminders: [],
        showReminderModal: false,
        newReminder: { title: '', dueDatetime: '' },

        views: [],
        selectedViewId: null,
        editingViewId: null,
        showViewModal: false,
        newView: { title: '', filterTags: [], filterMode: 'any' },

        people: [],

        shepherdingTags: [],
        showTagModal: false,
        newTagName: '',

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
                this.currentUserName = (userData && userData.email)
                    ? userData.email.split('@')[0]
                    : 'Elder';

                await Promise.all([
                    this.loadReminders(),
                    this.loadViews(),
                    this.loadPeople(),
                    this.loadTags(),
                ]);
                this.loading = false;
            });
        },

        async loadReminders() {
            const now = firebase.firestore.Timestamp.now();
            try {
                const snap = await db.collection('shepherding_reminders')
                    .where('dueDatetime', '>=', now)
                    .orderBy('dueDatetime', 'asc')
                    .get();
                this.reminders = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            } catch (e) {
                console.error('Error loading reminders:', e);
            }
        },

        async loadViews() {
            try {
                const snap = await db.collection('shepherding_views')
                    .orderBy('createdAt', 'asc')
                    .get();
                this.views = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            } catch (e) {
                console.error('Error loading views:', e);
            }
        },

        async loadPeople() {
            try {
                const snap = await db.collection('people').get();
                this.people = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            } catch (e) {
                console.error('Error loading people:', e);
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

        async addReminder() {
            if (!this.newReminder.title.trim() || !this.newReminder.dueDatetime) return;
            try {
                const dueDatetime = firebase.firestore.Timestamp.fromDate(
                    new Date(this.newReminder.dueDatetime)
                );
                await db.collection('shepherding_reminders').add({
                    title: this.newReminder.title.trim(),
                    dueDatetime,
                    createdBy: this.currentUser.uid,
                    createdByName: this.currentUserName,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                });
                this.newReminder = { title: '', dueDatetime: '' };
                this.showReminderModal = false;
                await this.loadReminders();
                this.showToast('Reminder added');
            } catch (e) {
                console.error('Error adding reminder:', e);
                this.showToast('Error adding reminder', 'error');
            }
        },

        async deleteReminder(id) {
            try {
                await db.collection('shepherding_reminders').doc(id).delete();
                this.reminders = this.reminders.filter(r => r.id !== id);
                this.showToast('Reminder deleted');
            } catch (e) {
                console.error('Error deleting reminder:', e);
                this.showToast('Error deleting reminder', 'error');
            }
        },

        async addView() {
            if (!this.newView.title.trim()) return;
            try {
                const docRef = await db.collection('shepherding_views').add({
                    title: this.newView.title.trim(),
                    filterTags: [...this.newView.filterTags],
                    filterMode: this.newView.filterMode,
                    createdBy: this.currentUser.uid,
                    createdByName: this.currentUserName,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                });
                this.newView = { title: '', filterTags: [], filterMode: 'any' };
                this.showViewModal = false;
                await this.loadViews();
                this.selectedViewId = docRef.id;
                this.showToast('Filtered view created');
            } catch (e) {
                console.error('Error adding view:', e);
                this.showToast('Error creating view', 'error');
            }
        },

        openEditView(view) {
            this.editingViewId = view.id;
            this.newView = {
                title: view.title,
                filterTags: [...(view.filterTags || [])],
                filterMode: view.filterMode || 'any'
            };
            this.showViewModal = true;
        },

        async updateView() {
            if (!this.editingViewId || !this.newView.title.trim()) return;
            try {
                await db.collection('shepherding_views').doc(this.editingViewId).update({
                    title: this.newView.title.trim(),
                    filterTags: [...this.newView.filterTags],
                    filterMode: this.newView.filterMode,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                });
                this.newView = { title: '', filterTags: [], filterMode: 'any' };
                this.showViewModal = false;
                const updatedId = this.editingViewId;
                this.editingViewId = null;
                await this.loadViews();
                this.selectedViewId = updatedId;
                this.showToast('View updated');
            } catch (e) {
                console.error('Error updating view:', e);
                this.showToast('Error updating view', 'error');
            }
        },

        async deleteView(id) {
            if (!confirm('Are you sure you want to delete this view?')) return;
            try {
                await db.collection('shepherding_views').doc(id).delete();
                const idx = this.views.findIndex(v => v.id === id);
                this.views = this.views.filter(v => v.id !== id);
                if (this.selectedViewId === id) {
                    this.selectedViewId = this.views.length > 0 ? this.views[Math.max(0, idx - 1)].id : null;
                }
                this.showToast('View deleted');
            } catch (e) {
                console.error('Error deleting view:', e);
                this.showToast('Error deleting view', 'error');
            }
        },

        async addTag() {
            const name = this.newTagName.trim();
            if (!name) return;
            if (this.shepherdingTags.find(t => t.name.toLowerCase() === name.toLowerCase())) {
                this.showToast('Tag already exists', 'error');
                return;
            }
            try {
                await db.collection('people_tags').doc(name).set({
                    name,
                    hiddenFromOthers: false,
                    hidePeople: false,
                });
                this.shepherdingTags.push({ id: name, name, hiddenFromOthers: false, hidePeople: false });
                this.shepherdingTags.sort((a, b) => a.name.localeCompare(b.name));
                this.newTagName = '';
                this.showToast(`Tag "${name}" created`);
            } catch (e) {
                console.error('Error adding tag:', e);
                this.showToast('Error creating tag', 'error');
            }
        },

        async deleteTag(id, name) {
            if (!confirm(`Delete tag "${name}"? It will be removed from all people.`)) return;
            const tag = this.shepherdingTags.find(t => t.id === id);
            try {
                const peopleWithTag = await db.collection('people')
                    .where('tags', 'array-contains', id)
                    .get();
                const otherHidePeopleTagIds = this.shepherdingTags
                    .filter(t => t.id !== id && t.hidePeople)
                    .map(t => t.id);
                const batch = db.batch();
                peopleWithTag.docs.forEach(doc => {
                    const update = { tags: firebase.firestore.FieldValue.arrayRemove(id) };
                    if (tag?.hidePeople) {
                        const remaining = (doc.data().tags || []).filter(t => t !== id);
                        update.shepherdingHidden = remaining.some(tid => otherHidePeopleTagIds.includes(tid));
                    }
                    batch.update(doc.ref, update);
                });
                batch.delete(db.collection('people_tags').doc(id));
                await batch.commit();
                this.shepherdingTags = this.shepherdingTags.filter(t => t.id !== id);
                await this.loadPeople();
                this.showToast(`Tag "${name}" deleted`);
            } catch (e) {
                console.error('Error deleting tag:', e);
                this.showToast('Error deleting tag', 'error');
            }
        },

        async toggleTagFlag(id, field) {
            const idx = this.shepherdingTags.findIndex(t => t.id === id);
            if (idx === -1) return;
            const tag = this.shepherdingTags[idx];
            const newVal = !tag[field];
            try {
                await db.collection('people_tags').doc(id).update({ [field]: newVal });
                this.shepherdingTags = this.shepherdingTags.map((t, i) =>
                    i === idx ? { ...t, [field]: newVal } : t
                );
                if (field === 'hidePeople') {
                    const peopleWithTag = await db.collection('people')
                        .where('tags', 'array-contains', id)
                        .get();
                    if (peopleWithTag.size > 0) {
                        const otherHidePeopleTagIds = this.shepherdingTags
                            .filter(t => t.id !== id && t.hidePeople)
                            .map(t => t.id);
                        const batch = db.batch();
                        peopleWithTag.docs.forEach(doc => {
                            if (newVal) {
                                batch.update(doc.ref, { shepherdingHidden: true });
                            } else {
                                const personTags = doc.data().shepherding_tags || [];
                                batch.update(doc.ref, {
                                    shepherdingHidden: personTags.some(tid => otherHidePeopleTagIds.includes(tid))
                                });
                            }
                        });
                        await batch.commit();
                    }
                }
                this.showToast('Tag updated');
            } catch (e) {
                console.error(`Error toggling tag ${field}:`, e);
                this.showToast('Error updating tag', 'error');
            }
        },

        getPeopleForView(view) {
            if (!view.filterTags || view.filterTags.length === 0) {
                return this.people.filter(p => p.membership?.status !== 'inactive');
            }
            return this.people.filter(p => {
                const personTags = p.tags || [];
                if (view.filterMode === 'all') {
                    return view.filterTags.every(t => personTags.includes(t));
                }
                return view.filterTags.some(t => personTags.includes(t));
            });
        },

        getTagName(tagId) {
            const tag = this.shepherdingTags.find(t => t.id === tagId);
            return tag ? tag.name : tagId;
        },

        toggleViewTag(tagId) {
            const idx = this.newView.filterTags.indexOf(tagId);
            if (idx === -1) {
                this.newView.filterTags.push(tagId);
            } else {
                this.newView.filterTags.splice(idx, 1);
            }
        },

        formatDatetime(timestamp) {
            if (!timestamp) return '';
            const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
            return date.toLocaleString('en-US', {
                month: 'short', day: 'numeric', year: 'numeric',
                hour: 'numeric', minute: '2-digit'
            });
        },

        showToast(message, type = 'success') {
            this.toast = { show: true, message, type };
            setTimeout(() => { this.toast.show = false; }, 3000);
        },
    }));
});
