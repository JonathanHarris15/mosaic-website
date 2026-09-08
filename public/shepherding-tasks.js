// The Tasks & Reminders page (MS-79).
//
// ⚠ IT DECIDES NOTHING. Every rule about a Task — when one is overdue, which
// dates a repeat produces, what an occurrence may override, which of them
// belong on the dashboard panel — lives in `tasks-core.js`, and every write
// goes through the `shepherdingTask` callable so the page and the assistant
// obey one set of rules rather than two. This file reads, draws, and asks.
//
// ⚠ ONE-OFFS ARE NOT WINDOWED. A repeat's dates are computed inside a range; a
// one-off is a stored row and is already the answer. Windowing it would hide an
// overdue Task from six weeks ago, which is the exact failure this feature
// exists to stop.

const TASKS_COLLECTION = 'shepherding_tasks';
const OCCURRENCES_COLLECTION = 'shepherding_task_occurrences';

// How far either side of today a repeat is resolved. Wide enough for a look
// back over the year and a season ahead; bounded, because a rule with no end
// would otherwise be asked for infinity.
const LOOK_BACK_DAYS = 365;
const LOOK_AHEAD_DAYS = 180;

const ELDER_TAG = 'Elder';

document.addEventListener('alpine:init', () => {
    Alpine.data('shepherdingTasks', () => ({
        loading: true,
        isElder: false,
        currentUser: null,
        currentPersonId: null,

        tasks: [],
        elders: [],
        // The resolved list drops the raw records, so the recurrence a row came
        // from is looked up here when the editor or a label needs it.
        seriesById: {},

        assigneeFilter: 'all',
        showDone: false,
        doneWindowDays: TasksCore.COMPLETED_WINDOW_DAYS,

        showModal: false,
        editingId: null,
        editingDate: null,
        // The day the Task had when the editor opened, so a save only nudges
        // it when somebody actually changed the date.
        originalDueDate: null,
        saving: false,
        error: '',
        toast: '',
        bodyEditor: null,

        form: {
            title: '', dueDate: '', dueTime: '', assigneeIds: [],
            repeats: false, freq: 'monthly', endsKind: 'never', endsDate: '', endsCount: 12,
        },

        async init() {
            auth.onAuthStateChanged(async (user) => {
                if (!user) { window.location.href = 'login.html'; return; }

                // ⚠ THE READ OF WHO YOU ARE IS INSIDE THE GUARD. If it throws,
                // the page has to say so and stop; a boot that fails silently
                // leaves the spinner turning forever, which reads as the app
                // being broken rather than the network being slow.
                try {
                    const userData = await getUserData(user.uid);
                    const level = (userData && (userData.permissionLevel || userData.role)) || 'viewer';
                    this.isElder = ['elder', 'super_admin'].includes(level);
                    if (!this.isElder) { window.location.href = 'index.html'; return; }

                    this.currentUser = user;
                    // Which Person this elder IS, so "mine" can mean anything.
                    // An elder with no linked Person simply has no tasks of
                    // their own, which is honest rather than an error.
                    this.currentPersonId = (userData && userData.personId) || null;

                    await Promise.all([this.loadTasks(), this.loadElders()]);
                } catch (e) {
                    console.error('Loading tasks:', e);
                    this.say('Could not load the tasks.');
                } finally {
                    // Never leave the page on its spinner: an empty list is
                    // readable, a spinner that never stops is not.
                    this.loading = false;
                }
            });
        },

        // ── Reading ──────────────────────────────────────────────────────────

        async loadTasks() {
            const db = firebase.firestore();
            const [taskSnap, occSnap] = await Promise.all([
                db.collection(TASKS_COLLECTION).get(),
                db.collection(OCCURRENCES_COLLECTION).get(),
            ]);

            const rows = taskSnap.docs.map(d => Object.assign({ id: d.id }, d.data()));
            const now = Date.now();
            this.tasks = TasksCore.resolve({
                tasks: rows.filter(t => !t.recurrence),
                series: rows.filter(t => t.recurrence),
                occurrences: occSnap.docs.map(d => Object.assign({ id: d.id }, d.data())),
                now: now,
                from: TasksCore.dayOf(now - LOOK_BACK_DAYS * 86400000),
                to: TasksCore.dayOf(now + LOOK_AHEAD_DAYS * 86400000),
            });

            const byId = {};
            rows.filter(t => t.recurrence).forEach(s => { byId[s.id] = s; });
            this.seriesById = byId;
        },

        // Only Elders can be given a Task (ADR-0059), and the Elder Tag is
        // already the canonical answer to who they are.
        async loadElders() {
            const snap = await firebase.firestore().collection('people')
                .where('tags', 'array-contains', ELDER_TAG).get();
            this.elders = snap.docs
                .map(d => ({ id: d.id, name: (d.data() || {}).name || 'Unnamed' }))
                .sort((a, b) => a.name.localeCompare(b.name));
        },

        // ── The three lists ──────────────────────────────────────────────────

        matchesFilter(task) {
            if (this.assigneeFilter === 'all') return true;
            if (this.assigneeFilter === 'unassigned') return task.isUnassigned;
            if (this.assigneeFilter === 'mine') {
                return this.currentPersonId && task.assigneeIds.includes(this.currentPersonId);
            }
            return task.assigneeIds.includes(this.assigneeFilter);
        },

        get overdue() {
            return this.tasks.filter(t => t.state === TasksCore.STATES.OVERDUE && this.matchesFilter(t));
        },

        get upcoming() {
            return this.tasks.filter(t => t.state === TasksCore.STATES.OPEN && this.matchesFilter(t));
        },

        get done() {
            const since = this.doneWindowDays
                ? TasksCore.completedWindowStart(Date.now(), this.doneWindowDays)
                : null;
            return TasksCore.completed(this.tasks, since ? { since } : null)
                .filter(t => this.matchesFilter(t));
        },

        // ── Labels ───────────────────────────────────────────────────────────

        rowClass(task) {
            return 'task flex items-start gap-3 p-md rounded-lg bg-surface-container-lowest ' +
                'border border-outline-variant cursor-default ' +
                (task.state === TasksCore.STATES.OVERDUE ? 'task--overdue ' : '') +
                (task.state === TasksCore.STATES.DONE ? 'task--done ' : '') +
                (task.state === TasksCore.STATES.SKIPPED ? 'task--skipped ' : '');
        },

        dueLabel(task) {
            const date = new Date(task.dueDate + 'T12:00:00');
            const day = date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
            const when = task.dueTime ? day + ', ' + task.dueTime : day;
            return task.state === TasksCore.STATES.OVERDUE ? when + ' — overdue' : when;
        },

        doneLabel(task) {
            if (!task.completedOn) return '';
            const date = new Date(task.completedOn + 'T12:00:00');
            return 'Done ' + date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
        },

        repeatLabel(task) {
            const series = this.seriesById && this.seriesById[task.seriesId];
            const freq = series && series.recurrence && series.recurrence.freq;
            return freq || 'repeats';
        },

        whoLabel(task) {
            if (task.isUnassigned) return 'Nobody has picked this up';
            const names = task.assigneeIds
                .map(id => (this.elders.find(e => e.id === id) || {}).name || 'Someone')
                .join(', ');
            return names;
        },

        // ── The editor ───────────────────────────────────────────────────────

        get previewDates() {
            if (!this.form.repeats || !this.form.dueDate) return [];
            try {
                return EventsOccurrenceCore.datesBetween(
                    this.recurrenceFromForm(),
                    this.form.dueDate,
                    TasksCore.dayOf(Date.now() + LOOK_AHEAD_DAYS * 86400000)
                ).slice(0, 4);
            } catch (e) { return []; }
        },

        recurrenceFromForm() {
            const ends = this.form.endsKind === 'onDate'
                ? { kind: 'onDate', date: this.form.endsDate }
                : this.form.endsKind === 'afterCount'
                    ? { kind: 'afterCount', count: Number(this.form.endsCount) || 1 }
                    : { kind: 'never' };
            return { freq: this.form.freq, startDate: this.form.dueDate, ends: ends };
        },

        openNew() {
            this.editingId = null;
            this.editingDate = null;
            this.originalDueDate = null;
            this.error = '';
            this.form = {
                title: '', dueDate: TasksCore.dayOf(Date.now()), dueTime: '', assigneeIds: [],
                repeats: false, freq: 'monthly', endsKind: 'never', endsDate: '', endsCount: 12,
            };
            this.showModal = true;
            this.$nextTick(() => this.mountEditor(''));
        },

        openEdit(task) {
            const series = this.seriesById && this.seriesById[task.seriesId];
            this.editingId = task.seriesId || task.id;
            // ⚠ A DATE IS EDITED AS A DATE. With one, the write lands on that
            // occurrence alone; without one it changes the whole commitment.
            this.editingDate = task.seriesId ? task.dueDate : null;
            this.originalDueDate = task.dueDate;
            this.error = '';
            this.form = {
                title: task.title,
                dueDate: task.dueDate,
                dueTime: task.dueTime || '',
                assigneeIds: task.assigneeIds.slice(),
                // The pattern belongs to the commitment and is edited there, so
                // opening one date does not offer to change it.
                repeats: false,
                freq: (series && series.recurrence && series.recurrence.freq) || 'monthly',
                endsKind: 'never', endsDate: '', endsCount: 12,
            };
            this.showModal = true;
            this.$nextTick(() => this.mountEditor(task.body || ''));
        },

        async mountEditor(content) {
            try {
                await TiptapEditorLoader.ensureTipTap();
                const T = window._TipTap;
                if (!T || !this.$refs.bodyEditor) return;
                if (this.bodyEditor) { this.bodyEditor.destroy(); this.bodyEditor = null; }
                this.bodyEditor = new T.Editor({
                    element: this.$refs.bodyEditor,
                    extensions: [T.StarterKit, T.Underline, T.Link.configure({ openOnClick: false, autolink: true })],
                    content: content || '',
                });
            } catch (e) {
                // The editor is a nicety; the Task is not. A page that will not
                // open because a bundle failed is worse than a plain box.
                console.error('Task body editor:', e);
            }
        },

        closeModal() {
            if (this.bodyEditor) { this.bodyEditor.destroy(); this.bodyEditor = null; }
            this.showModal = false;
        },

        toggleAssignee(personId) {
            const at = this.form.assigneeIds.indexOf(personId);
            if (at >= 0) this.form.assigneeIds.splice(at, 1);
            else this.form.assigneeIds.push(personId);
        },

        // ── Writing — every one through the one door ─────────────────────────

        call(op, args) {
            return firebase.functions().httpsCallable('shepherdingTask')(
                Object.assign({ op: op }, args)).then(r => r.data);
        },

        async save() {
            this.saving = true;
            this.error = '';
            const body = this.bodyEditor ? this.bodyEditor.getHTML() : '';
            try {
                if (this.editingId) {
                    await this.call('edit', {
                        taskId: this.editingId,
                        date: this.editingDate || undefined,
                        title: this.form.title,
                        body: body,
                        dueTime: this.form.dueTime || null,
                        assigneeIds: this.form.assigneeIds,
                    });
                    // ⚠ ONLY WHEN THE DAY ACTUALLY CHANGED. A nudge is its own
                    // write, and on a repeat it stores a record against that
                    // date — so calling it every save would mint a record for
                    // every date anybody merely opened, and the sparse rule
                    // that makes a missed month computable would be gone.
                    if (this.form.dueDate !== this.originalDueDate) {
                        await this.call('move', {
                            taskId: this.editingId,
                            date: this.editingDate || undefined,
                            to: this.form.dueDate,
                        });
                    }
                } else {
                    await this.call('create', {
                        title: this.form.title,
                        body: body,
                        due: this.form.dueDate,
                        dueTime: this.form.dueTime || null,
                        assigneeIds: this.form.assigneeIds,
                        recurrence: this.form.repeats ? this.recurrenceFromForm() : undefined,
                    });
                }
                this.closeModal();
                await this.loadTasks();
                this.say('Saved');
            } catch (e) {
                // A refusal from the server is a sentence written for a person
                // to read, so it is shown rather than replaced.
                this.error = (e && e.message) || 'That did not save.';
            } finally {
                this.saving = false;
            }
        },

        async tick(task) {
            try {
                await this.call('complete', { taskId: task.seriesId || task.id, date: task.seriesId ? task.dueDate : undefined });
                await this.loadTasks();
                this.say('Done');
            } catch (e) { this.say((e && e.message) || 'That did not save.'); }
        },

        async untick(task) {
            try {
                await this.call('reopen', { taskId: task.seriesId || task.id, date: task.seriesId ? task.dueDate : undefined });
                await this.loadTasks();
                this.say('Put back');
            } catch (e) { this.say((e && e.message) || 'That did not save.'); }
        },

        async skip(task) {
            if (!confirm('Skip this one without marking it done?')) return;
            try {
                await this.call('skip', { taskId: task.seriesId, date: task.dueDate });
                await this.loadTasks();
                this.say('Skipped');
            } catch (e) { this.say((e && e.message) || 'That did not save.'); }
        },

        async remove(task) {
            const isSeries = !!task.seriesId;
            const question = isSeries
                ? 'Stop this repeating task? What has already been done is kept.'
                : 'Delete this task?';
            if (!confirm(question)) return;
            try {
                const out = await this.call('delete', { taskId: task.seriesId || task.id });
                await this.loadTasks();
                this.say(out && out.stopped ? 'Stopped — what was done is kept' : 'Deleted');
            } catch (e) { this.say((e && e.message) || 'That did not save.'); }
        },

        say(message) {
            this.toast = message;
            setTimeout(() => { this.toast = ''; }, 2500);
        },
    }));
});
