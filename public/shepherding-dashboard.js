// How far either side of today the panel resolves a repeat. The panel only ever
// draws a handful of rows, but a missed occurrence is COMPUTED (ADR-0060), so
// the window has to reach back far enough to find the ones nobody did.
const DASH_TASK_LOOK_BACK_DAYS = 365;
const DASH_TASK_LOOK_AHEAD_DAYS = 180;

document.addEventListener('alpine:init', () => {
    Alpine.data('shepherdingDashboard', () => ({
        // Closed until auth answers. An undeclared flag is a ReferenceError in
        // every x-show that names it, not a false.
        ...AccessCore.pageFlags(null),
        currentUser: null,
        currentPermissionLevel: null,
        currentUserName: '',

        // Tasks & Reminders (MS-79). The ledger is a GLANCE — yours, the
        // unassigned, and anything late. Writing at length, filtering and the
        // completed list live on shepherding-tasks.html. Saved views of people
        // live on the People page.
        panelTasks: [],
        currentPersonId: null,

        loading: true,
        toast: { show: false, message: '', type: 'success' },

        async init() {
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

                // Dev-only privacy screen (shepherding-blur.js).
                ShepherdingBlur.configure({
                    permissionLevel: this.currentPermissionLevel,
                    pastoralAssistant: this.pastoralAssistant,
                    uid: user.uid,
                    personId: userData && userData.personId,
                });
                this.currentPersonId = (userData && userData.personId) || null;

                await this.loadPanelTasks();
                this.loading = false;
            });
        },

        // ⚠ THE PANEL DECIDES NOTHING. Which Tasks belong here is
        // TasksCore.panelFor, the same answer the phone's Shepherd screen gets,
        // so the two cannot disagree about what "yours" means.
        async loadPanelTasks() {
            try {
                const [taskSnap, occSnap] = await Promise.all([
                    db.collection('shepherding_tasks').get(),
                    db.collection('shepherding_task_occurrences').get(),
                ]);
                const rows = taskSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                const now = Date.now();
                const all = TasksCore.resolve({
                    tasks: rows.filter(t => !t.recurrence),
                    series: rows.filter(t => t.recurrence),
                    occurrences: occSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })),
                    now,
                    from: TasksCore.dayOf(now - DASH_TASK_LOOK_BACK_DAYS * 86400000),
                    to: TasksCore.dayOf(now + DASH_TASK_LOOK_AHEAD_DAYS * 86400000),
                });
                this.panelTasks = TasksCore.panelFor(all, this.currentPersonId, now);
            } catch (e) {
                console.error('Error loading tasks:', e);
            }
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
                await this.loadPanelTasks();
                this.showToast('Done');
            } catch (e) {
                console.error('Error completing task:', e);
                this.showToast((e && e.message) || 'Error completing task', 'error');
            }
        },

        showToast(message, type = 'success') {
            this.toast = { show: true, message, type };
            setTimeout(() => { this.toast.show = false; }, 3000);
        },
    }));
});
