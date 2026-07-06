// Shepherding Status value model — single source of truth in shepherding-core.js.
const DASH_URGENCY_LEVELS = ShepherdingCore.URGENCY_LEVELS;
const DASH_IMPORTANCE_LEVELS = ShepherdingCore.IMPORTANCE_LEVELS;
const dashZoneKey = ShepherdingCore.statusZoneKey;

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
        // minHoldDays is the persisted Hold-Duration threshold; minHoldValue/Unit
        // are the UI's split of it (e.g. 3 + 'months' → 90 days).
        newView: { title: '', filterTags: [], filterMode: 'any', statusZoneFilters: [], minHoldDays: 0, minHoldValue: 0, minHoldUnit: 'days' },

        people: [],

        shepherdingTags: [],
        // Tag Hold per person, keyed personId → { tagId: { heldSinceMs, durationMs } }.
        // Loaded from Tag Change history only when a view uses the Hold-Duration filter.
        // Tag CRUD itself now lives on the Manage Tags page (shepherding-tags.js).
        tagHolds: {},

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
                // Tag Hold history is only needed to satisfy a Hold-Duration
                // filter — fetch it lazily, not on every dashboard load (ADR-0011).
                if (this.views.some(v => v.minHoldDays > 0)) {
                    await this.loadTagHolds();
                }
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
                    statusZoneFilters: [...this.newView.statusZoneFilters],
                    minHoldDays: Number(this.newView.minHoldDays) || 0,
                    sortBy: 'name',
                    createdBy: this.currentUser.uid,
                    createdByName: this.currentUserName,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                });
                this.newView = this.blankView();
                this.showViewModal = false;
                await this.loadViews();
                if (this.views.some(v => v.minHoldDays > 0)) await this.loadTagHolds();
                this.selectedViewId = docRef.id;
                this.showToast('Filtered view created');
            } catch (e) {
                console.error('Error adding view:', e);
                this.showToast('Error creating view', 'error');
            }
        },

        blankView() {
            return { title: '', filterTags: [], filterMode: 'any', statusZoneFilters: [], minHoldDays: 0, minHoldValue: 0, minHoldUnit: 'days' };
        },

        // Split a stored day count back into the largest whole UI unit for editing.
        holdValueUnit(days) {
            if (days > 0 && days % 365 === 0) return { value: days / 365, unit: 'years' };
            if (days > 0 && days % 30 === 0) return { value: days / 30, unit: 'months' };
            return { value: days || 0, unit: 'days' };
        },

        openEditView(view) {
            this.editingViewId = view.id;
            const hold = this.holdValueUnit(view.minHoldDays || 0);
            this.newView = {
                title: view.title,
                filterTags: [...(view.filterTags || [])],
                filterMode: view.filterMode || 'any',
                statusZoneFilters: [...(view.statusZoneFilters || [])],
                minHoldDays: view.minHoldDays || 0,
                minHoldValue: hold.value,
                minHoldUnit: hold.unit,
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
                    statusZoneFilters: [...this.newView.statusZoneFilters],
                    minHoldDays: Number(this.newView.minHoldDays) || 0,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                });
                this.newView = this.blankView();
                this.showViewModal = false;
                const updatedId = this.editingViewId;
                this.editingViewId = null;
                await this.loadViews();
                if (this.views.some(v => v.minHoldDays > 0)) await this.loadTagHolds();
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

        // Load Tag Hold history for the Hold-Duration filter: one collection-group
        // pass over tag_change entries, grouped by person, derived via the core.
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
            } catch (e) {
                console.error('Error loading tag holds:', e);
            }
        },

        getPeopleForView(view) {
            let result = this.people.filter(p => p.membership?.status !== 'inactive');

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
                    return view.statusZoneFilters.includes(
                        dashZoneKey(p.shepherdingStatus.urgency, p.shepherdingStatus.importance)
                    );
                });
            }

            // Hold-Duration filter (ADR-0011): keep only Persons who have held the
            // view's filter tag(s) for at least minHoldDays. An unknown hold never
            // qualifies. Applies to the same tags as the tag filter, so it needs
            // filterTags to have something to measure against.
            if (view.minHoldDays > 0 && view.filterTags && view.filterTags.length > 0) {
                result = result.filter(p => {
                    const holds = this.tagHolds[p.id] || {};
                    const held = t => ShepherdingCore.holdMeetsMinimum(holds[t] && holds[t].durationMs, view.minHoldDays);
                    return view.filterMode === 'all'
                        ? view.filterTags.every(held)
                        : view.filterTags.some(held);
                });
            }

            return result;
        },

        toggleViewStatusZone(urg, imp) {
            const key = dashZoneKey(urg, imp);
            const idx = this.newView.statusZoneFilters.indexOf(key);
            if (idx === -1) {
                this.newView.statusZoneFilters = [...this.newView.statusZoneFilters, key];
            } else {
                this.newView.statusZoneFilters = this.newView.statusZoneFilters.filter(z => z !== key);
            }
        },

        isViewZoneSelected(urg, imp) {
            return this.newView.statusZoneFilters.includes(dashZoneKey(urg, imp));
        },

        viewStatusCellColor(urg, imp) {
            return ShepherdingCore.statusCellColor(urg, imp);
        },

        getTagName(tagId) {
            const tag = this.shepherdingTags.find(t => t.id === tagId);
            return tag ? tag.name : tagId;
        },

        formatHoldDuration(ms) {
            return ShepherdingCore.formatHoldDuration(ms);
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
