// Shepherding Status value model — single source of truth in shepherding-core.js.
const DASH_URGENCY_LEVELS = ShepherdingCore.URGENCY_LEVELS;
const DASH_IMPORTANCE_LEVELS = ShepherdingCore.IMPORTANCE_LEVELS;
const dashZoneKey = ShepherdingCore.statusZoneKey;

// How far either side of today the panel resolves a repeat. The panel only ever
// draws a handful of rows, but a missed occurrence is COMPUTED (ADR-0060), so
// the window has to reach back far enough to find the ones nobody did.
const DASH_TASK_LOOK_BACK_DAYS = 365;
const DASH_TASK_LOOK_AHEAD_DAYS = 180;

// The live reads this page holds open (MS-494), stopped when it goes. Outside
// Alpine: nothing here is drawn.
const _dashWatches = [];
const _dashRows = { tasks: null, occurrences: null, activity: null, holdsWatched: false };
function stopDashWatches() {
    _dashWatches.splice(0).forEach(stop => { try { stop(); } catch (e) {} });
    _dashRows.holdsWatched = false;
}

document.addEventListener('alpine:init', () => {
    Alpine.data('shepherdingDashboard', () => ({
        currentUser: null,
        currentPermissionLevel: null,
        currentUserName: '',

        // Tasks & Reminders (MS-79). The panel is a GLANCE — yours, the
        // unassigned, and anything late. Writing at length, filtering and the
        // completed list live on shepherding-tasks.html.
        panelTasks: [],
        currentPersonId: null,

        views: [],
        selectedViewId: null,
        editingViewId: null,
        showViewModal: false,
        // tagHoldFilters: per-tag hold threshold in days, keyed by tagId (0 = any).
        // tagHoldCmp: per-tag direction, 'gte' (held at least, default) or 'lt'
        // (held less than). Each selected filter tag carries its own slider + toggle.
        newView: { title: '', filterTags: [], filterMode: 'any', statusZoneFilters: [], tagHoldFilters: {}, tagHoldCmp: {} },

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
                this.currentPermissionLevel = (userData && (userData.permissionLevel || userData.role)) || 'viewer';
                if (!['elder', 'super_admin'].includes(this.currentPermissionLevel)) {
                    window.location.href = 'index.html';
                    return;
                }
                this.currentUser = user;
                this.currentUserName = (userData && userData.email)
                    ? userData.email.split('@')[0]
                    : 'Elder';

                // Dev-only privacy screen (shepherding-blur.js).
                ShepherdingBlur.configure({
                    permissionLevel: this.currentPermissionLevel,
                    uid: user.uid,
                    personId: userData && userData.personId,
                });
                this.currentPersonId = (userData && userData.personId) || null;

                await this.watchDashboard();
                this.loading = false;
            });
            window.addEventListener('pagehide', stopDashWatches);
        },

        // ── Live (MS-494) ────────────────────────────────────────────────────
        //
        // Tasks, Filtered Views, People and tags are followed while the page is
        // open, so a status, tag, view or Task another elder changes shows here
        // without reloading. Through live-read.js: a listener on the web, and on
        // the phone a listener that falls back to re-reading. Resolves once the
        // People and the Filtered Views have first arrived, which is the load.
        //
        // ⚠ NOTHING RE-READS AFTER A SAVE ANY MORE. The page still shows its
        // own change at once; the next delivery brings the server's copy.
        watchDashboard() {
            const Live = MosaicLiveRead;
            const failed = what => e => console.warn('Could not keep ' + what + ' current:', e);
            const every = Live.ROSTER_EVERY_MS;
            let people = false, views = false;
            return new Promise(resolve => {
                const ready = () => { if (people && views) resolve(); };
                _dashWatches.push(Live.watch(db.collection('people'), snap => {
                    this.people = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                    this.deriveTagHolds();
                    people = true; ready();
                }, { fallbackEveryMs: every, onError: e => { failed('people')(e); people = true; ready(); } }));
                _dashWatches.push(Live.watch(db.collection('shepherding_views').orderBy('createdAt', 'asc'), snap => {
                    this.adoptViews(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
                    views = true; ready();
                }, { fallbackEveryMs: every, onError: e => { failed('the Filtered Views')(e); views = true; ready(); } }));
                _dashWatches.push(Live.watch(db.collection('people_tags').orderBy('name', 'asc'), snap => {
                    this.shepherdingTags = snap.docs.map(doc => ({
                        id: doc.id,
                        name: doc.data().name || doc.id,
                        hiddenFromOthers: doc.data().hiddenFromOthers || false,
                        hidePeople: doc.data().hidePeople || false,
                    }));
                }, { fallbackEveryMs: every, onError: failed('the tags') }));
                _dashWatches.push(Live.watch(db.collection('shepherding_tasks'), snap => {
                    _dashRows.tasks = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                    this.resolvePanelTasks();
                }, { fallbackEveryMs: every, onError: failed('the Tasks') }));
                _dashWatches.push(Live.watch(db.collection('shepherding_task_occurrences'), snap => {
                    _dashRows.occurrences = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                    this.resolvePanelTasks();
                }, { fallbackEveryMs: every, onError: failed('the Task dates') }));
            });
        },

        // A new list of Filtered Views. The one being edited stays open unless
        // it was deleted; the one selected moves only if it went.
        adoptViews(views) {
            this.views = views;
            if (this.editingViewId && !views.some(v => v.id === this.editingViewId)) {
                this.editingViewId = null;
                this.showViewModal = false;
                this.newView = this.blankView();
                this.showToast('The view you were editing was just deleted by somebody else.', 'error');
            }
            if (this.selectedViewId && !views.some(v => v.id === this.selectedViewId)) {
                this.selectedViewId = views.length ? views[0].id : null;
            }
            // Tag Hold history is only needed to satisfy a Hold-Duration filter —
            // followed only once a view uses one, not on every dashboard (ADR-0011).
            if (!_dashRows.holdsWatched && views.some(v => this.viewHasHoldFilter(v))) this.watchTagHolds();
        },

        // ⚠ THE PANEL DECIDES NOTHING. Which Tasks belong here is
        // TasksCore.panelFor, the same answer the phone's Shepherd screen gets,
        // so the two cannot disagree about what "yours" means.
        resolvePanelTasks() {
            if (!_dashRows.tasks || !_dashRows.occurrences) return;
            const rows = _dashRows.tasks;
            const now = Date.now();
            const all = TasksCore.resolve({
                tasks: rows.filter(t => !t.recurrence),
                series: rows.filter(t => t.recurrence),
                occurrences: _dashRows.occurrences,
                now,
                from: TasksCore.dayOf(now - DASH_TASK_LOOK_BACK_DAYS * 86400000),
                to: TasksCore.dayOf(now + DASH_TASK_LOOK_AHEAD_DAYS * 86400000),
            });
            this.panelTasks = TasksCore.panelFor(all, this.currentPersonId, now);
        },

        taskDueLabel(task) {
            const date = new Date(task.dueDate + 'T12:00:00');
            const day = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            const when = task.dueTime ? day + ', ' + task.dueTime : day;
            return task.state === 'overdue' ? when + ' — overdue' : when;
        },

        // Ticking from the panel goes through the same door the Tasks page and
        // the assistant use, so the rules exist once (MS-79).
        async completeTask(task) {
            try {
                await firebase.functions().httpsCallable('shepherdingTask')({
                    op: 'complete',
                    taskId: task.seriesId || task.id,
                    date: task.seriesId ? task.dueDate : undefined,
                });
                // Off the panel at once; the next delivery brings the truth.
                this.panelTasks = this.panelTasks.filter(t => t !== task);
                this.showToast('Done');
            } catch (e) {
                console.error('Error completing task:', e);
                this.showToast((e && e.message) || 'Error completing task', 'error');
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
                    tagHoldFilters: this.cleanHoldFilters(),
                    tagHoldCmp: this.cleanHoldCmp(),
                    sortBy: 'name',
                    createdBy: this.currentUser.uid,
                    createdByName: this.currentUserName,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                });
                this.newView = this.blankView();
                this.showViewModal = false;
                this.selectedViewId = docRef.id;
                this.showToast('Filtered view created');
            } catch (e) {
                console.error('Error adding view:', e);
                this.showToast('Error creating view', 'error');
            }
        },

        blankView() {
            return { title: '', filterTags: [], filterMode: 'any', statusZoneFilters: [], tagHoldFilters: {}, tagHoldCmp: {} };
        },

        // Does a saved view use any Hold-Duration threshold? Falls back to the old
        // single minHoldDays field so views saved before per-tag sliders still work.
        viewHasHoldFilter(view) {
            if (view.minHoldDays > 0) return true;
            const f = view.tagHoldFilters;
            return !!f && Object.values(f).some(d => d > 0);
        },

        // The threshold (days) a view requires for one of its filter tags, honouring
        // the legacy single minHoldDays as a fallback for every tag.
        viewTagHoldDays(view, tagId) {
            if (view.tagHoldFilters && view.tagHoldFilters[tagId] != null) return view.tagHoldFilters[tagId];
            return view.minHoldDays || 0;
        },

        // The direction a view requires for a filter tag ('gte' default | 'lt').
        viewTagCmp(view, tagId) {
            return (view.tagHoldCmp && view.tagHoldCmp[tagId]) || 'gte';
        },

        // How a saved view's card summarises one tag's Hold-Duration filter, e.g.
        // ' · older 3mo'. Reads its direction word from the same helper the editor
        // uses, so the card and the dialog behind it cannot say different things.
        viewTagHoldSummary(view, tagId) {
            return ' · ' + ShepherdingCore.holdDirectionWord(this.viewTagCmp(view, tagId))
                + ' ' + ShepherdingCore.formatHoldShort(this.viewTagHoldDays(view, tagId));
        },

        // Drop zero entries so a view stores only the tags that actually constrain.
        cleanHoldFilters() {
            const out = {};
            for (const [tagId, days] of Object.entries(this.newView.tagHoldFilters || {})) {
                if (days > 0 && this.newView.filterTags.includes(tagId)) out[tagId] = days;
            }
            return out;
        },

        // Keep only the directions of tags that actually constrain (days > 0).
        cleanHoldCmp() {
            const days = this.cleanHoldFilters();
            const out = {};
            for (const tagId of Object.keys(days)) {
                if (this.newView.tagHoldCmp[tagId] === 'lt') out[tagId] = 'lt';
            }
            return out;
        },

        openEditView(view) {
            this.editingViewId = view.id;
            // Seed per-tag sliders, expanding a legacy single minHoldDays across
            // all of the view's filter tags.
            const seeded = {};
            const seededCmp = {};
            (view.filterTags || []).forEach(t => {
                const days = this.viewTagHoldDays(view, t);
                if (days > 0) {
                    seeded[t] = days;
                    if (this.viewTagCmp(view, t) === 'lt') seededCmp[t] = 'lt';
                }
            });
            this.newView = {
                title: view.title,
                filterTags: [...(view.filterTags || [])],
                filterMode: view.filterMode || 'any',
                statusZoneFilters: [...(view.statusZoneFilters || [])],
                tagHoldFilters: seeded,
                tagHoldCmp: seededCmp,
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
                    tagHoldFilters: this.cleanHoldFilters(),
                    tagHoldCmp: this.cleanHoldCmp(),
                    minHoldDays: firebase.firestore.FieldValue.delete(),
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                });
                this.newView = this.blankView();
                this.showViewModal = false;
                const updatedId = this.editingViewId;
                this.editingViewId = null;
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

        // Tag Hold history for the Hold-Duration filter: the tag_change entries,
        // followed live once a view needs them, grouped by person and derived
        // through the core whenever they or the People change.
        watchTagHolds() {
            _dashRows.holdsWatched = true;
            _dashWatches.push(MosaicLiveRead.watch(
                db.collectionGroup('shepherding_activity').where('kind', '==', 'tag_change'),
                snap => {
                    const byPerson = {};
                    snap.docs.forEach(doc => {
                        const personId = doc.ref.parent.parent && doc.ref.parent.parent.id;
                        if (!personId) return;
                        (byPerson[personId] || (byPerson[personId] = [])).push(doc.data());
                    });
                    _dashRows.activity = byPerson;
                    this.deriveTagHolds();
                },
                { fallbackEveryMs: MosaicLiveRead.ROSTER_EVERY_MS,
                    onError: e => console.warn('Could not keep tag holds current:', e) }));
        },

        deriveTagHolds() {
            if (!_dashRows.activity) return;
            const now = Date.now();
            const holds = {};
            this.people.forEach(p => {
                holds[p.id] = ShepherdingCore.deriveTagHolds(_dashRows.activity[p.id] || [], p.tags || [], now);
            });
            this.tagHolds = holds;
        },

        getPeopleForView(view) {
            let result = this.people.filter(p => !ShepherdingCore.isInactiveMembership(p.membership));

            if (view.filterTags && view.filterTags.length > 0) {
                // A person "matches" a filter tag when they carry it AND (if that
                // tag's slider is above 0) have held it at least that long. The
                // view's any/all mode then combines the per-tag matches. Unknown
                // holds never qualify (ADR-0011).
                const matches = (p, t) => {
                    if (!(p.tags || []).includes(t)) return false;
                    const min = this.viewTagHoldDays(view, t);
                    if (min <= 0) return true;
                    const h = (this.tagHolds[p.id] || {})[t];
                    return ShepherdingCore.holdSatisfies(h && h.durationMs, min, this.viewTagCmp(view, t));
                };
                result = result.filter(p => view.filterMode === 'all'
                    ? view.filterTags.every(t => matches(p, t))
                    : view.filterTags.some(t => matches(p, t)));
            }

            if (view.statusZoneFilters && view.statusZoneFilters.length > 0) {
                result = result.filter(p => {
                    if (!p.shepherdingStatus) return false;
                    return view.statusZoneFilters.includes(
                        dashZoneKey(p.shepherdingStatus.urgency, p.shepherdingStatus.importance)
                    );
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
                // Deselecting a tag drops its Hold-Duration slider and direction.
                if (tagId in this.newView.tagHoldFilters) {
                    delete this.newView.tagHoldFilters[tagId];
                }
                if (tagId in this.newView.tagHoldCmp) {
                    delete this.newView.tagHoldCmp[tagId];
                }
            }
        },

        // ── Per-tag Hold-Duration slider (edit modal) ─────────────────────────
        holdStops() { return ShepherdingCore.HOLD_FILTER_STOPS; },
        viewTagHoldStopIndex(tagId) { return ShepherdingCore.holdStopIndex(this.newView.tagHoldFilters[tagId] || 0); },
        setViewTagHoldStop(tagId, idx) {
            const days = ShepherdingCore.HOLD_FILTER_STOPS[Number(idx)] || 0;
            this.newView.tagHoldFilters = { ...this.newView.tagHoldFilters, [tagId]: days };
        },
        viewTagHoldShort(tagId) { return ShepherdingCore.formatHoldShort(this.newView.tagHoldFilters[tagId] || 0); },
        // Direction, in words — the same wording the People list filter shows,
        // decided in one place so the two copies of this widget cannot drift
        // apart again (MS-279).
        viewNewDirectionWord(tagId) { return ShepherdingCore.holdDirectionWord(this.newView.tagHoldCmp[tagId]); },
        viewNewDirectionHint(tagId) { return ShepherdingCore.holdDirectionHint(this.newView.tagHoldCmp[tagId]); },
        viewNewScrubberLabel(tagId) {
            return ShepherdingCore.holdScrubberLabel(this.newView.tagHoldCmp[tagId], this.viewTagHoldShort(tagId));
        },
        toggleViewNewCmp(tagId) {
            const next = this.newView.tagHoldCmp[tagId] === 'lt' ? 'gte' : 'lt';
            this.newView.tagHoldCmp = { ...this.newView.tagHoldCmp, [tagId]: next };
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
