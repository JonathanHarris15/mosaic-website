// The Tasks & Reminders page (MS-79) — and the Tasks tab on a Shepherding
// Profile (ADR-0061), which is the same component in a smaller room:
//
//   • the whole page          → shepherdingTasks
//   • a Person's profile tab  → shepherdingTasks({ aboutPersonId: <id>, embedded: true })
//
// The same trade `documentLibrary` makes for the Document Library and the
// profile's Documents tab: one component, two scopes, so a rule about ticking
// or overdue cannot come to mean two things depending on which screen you are
// standing on. The difference is what the scope DOES — a profile document is
// private to that profile until it is opted into the Library, while a Task with
// a Subject is on the page as well, always. Tasks are not filed away.
//
// ⚠ IT DECIDES NOTHING. Every rule about a Task — when one is overdue, which
// dates a repeat produces, what an occurrence may override, which of them
// belong on the dashboard panel or on one person's profile — lives in
// `tasks-core.js`, and every write goes through the `shepherdingTask` callable
// so the page and the assistant obey one set of rules rather than two. This
// file reads, draws, and asks.
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

// How long the tick is allowed to be enjoyed before the row folds up. Both
// numbers match the animations in the page's own stylesheet — change one and
// the card either goes while the sparks are still flying or sits there after
// they have finished.
const CELEBRATE_MS = 620;
const LEAVE_MS = 300;

// The live watches the component holds (MS-490). Kept outside Alpine so they are
// not proxied, and stopped when the page goes or the profile tab is taken down.
let _taskWatches = [];
function stopTaskWatches() {
    _taskWatches.forEach(stop => { try { stop(); } catch (e) {} });
    _taskWatches = [];
}

document.addEventListener('alpine:init', () => {
    // The Person Picker's behaviour is folded in over the component, so "who
    // it's for" is chosen the way a Person is chosen everywhere else. Composed
    // with descriptors, never spread — see person-picker.js.
    Alpine.data('shepherdingTasks', (config = {}) => Object.defineProperties({
        loading: true,
        isElder: false,
        currentUser: null,
        currentPersonId: null,

        // ── Scope ────────────────────────────────────────────────────────────
        // Empty on the page, a Person id on a profile. Everything the scope
        // changes is downstream of these two: which Tasks are shown, and who a
        // new one is for by default.
        aboutPersonId: config.aboutPersonId || null,
        embedded: !!config.embedded,

        tasks: [],
        people: [],
        elders: [],
        // The resolved list drops the raw records, so the recurrence a row came
        // from is looked up here when the editor or a label needs it.
        seriesById: {},

        assigneeFilter: 'all',
        showDone: false,
        doneWindowDays: TasksCore.COMPLETED_WINDOW_DAYS,

        // Which rows are mid-celebration, and how far through: 'finishing' while
        // the tick is being enjoyed, 'leaving' while the card folds up. Keyed by
        // row, not by task id — a repeat wears the same id on every date it
        // produces, so ticking September must not set August off too.
        finishing: {},

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

        // ── Presence (MS-491) ───────────────────────────────────────────────
        // A Task editor is a box: a Task held on the profile is held here, and
        // the other way round, because the box names the Task, not the page.
        presenceEntries: [],
        presenceTick: 0,
        // The editor's box was taken by somebody else while it was open.
        taskLost: false,
        // The row as it was when the editor opened.
        taskOpenedWith: null,

        form: {
            title: '', dueDate: '', dueTime: '', assigneeIds: [], aboutPersonId: '',
            repeats: false, freq: 'monthly', endsKind: 'never', endsDate: '', endsCount: 12,
        },

        async init() {
            auth.onAuthStateChanged(async (user) => {
                // ⚠ A TAB DOES NOT NAVIGATE ITS HOST. On the page, a signed-out
                // visitor is sent to log in; inside a profile the surrounding
                // page has already answered that question, and a second redirect
                // from a tab would fight it.
                if (!user) {
                    if (!this.embedded) window.location.href = 'login.html';
                    this.loading = false;
                    return;
                }

                // ⚠ THE READ OF WHO YOU ARE IS INSIDE THE GUARD. If it throws,
                // the page has to say so and stop; a boot that fails silently
                // leaves the spinner turning forever, which reads as the app
                // being broken rather than the network being slow.
                try {
                    const userData = await getUserData(user.uid);
                    Object.assign(this, AccessCore.pageFlags(userData));
                    this.isElder = this.canReadElder;
                    if (!this.isElder) {
                        if (!this.embedded) window.location.href = 'index.html';
                        this.loading = false;
                        return;
                    }

                    this.currentUser = user;
                    // Which Person this elder IS, so "mine" can mean anything.
                    // An elder with no linked Person simply has no tasks of
                    // their own, which is honest rather than an error.
                    this.currentPersonId = (userData && userData.personId) || null;

                    await this.watchTasks();
                    this.startPresence(user);
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
        //
        // Live (MS-490): a Task another elder adds, ticks, skips or deletes
        // arrives without a reload — on the page and on a profile's Tasks tab,
        // because they are this one component. Read through live-read.js, so
        // inside the phone app a silent stream falls back to re-reading.

        // The raw rows as they last arrived. Resolving them into dated rows is
        // TasksCore's job and happens in applyTasks.
        taskRows: [],
        occurrenceRows: [],

        watchTasks() {
            const Live = window.MosaicLiveRead;
            const db = firebase.firestore();
            const rows = snap => snap.docs.map(d => Object.assign({ id: d.id }, d.data()));

            return new Promise(resolve => {
                let tasksIn = false;
                let occurrencesIn = false;
                const arrived = () => {
                    if (!tasksIn || !occurrencesIn) return;
                    this.applyTasks();
                    resolve();
                };
                const failed = (what, flag) => e => {
                    console.error('Could not keep ' + what + ' current:', e);
                    flag();
                    arrived();
                };

                _taskWatches.push(Live.watch(db.collection(TASKS_COLLECTION), snap => {
                    this.taskRows = rows(snap);
                    tasksIn = true;
                    arrived();
                }, { fallbackEveryMs: Live.PERSON_EVERY_MS, onError: failed('tasks', () => { tasksIn = true; }) }));

                _taskWatches.push(Live.watch(db.collection(OCCURRENCES_COLLECTION), snap => {
                    this.occurrenceRows = rows(snap);
                    occurrencesIn = true;
                    arrived();
                }, { fallbackEveryMs: Live.PERSON_EVERY_MS, onError: failed('task dates', () => { occurrencesIn = true; }) }));

                // The directory, and both lists cut from it.
                //
                // The whole of it, because a Task's Subject can be anybody — the
                // care is toward them and they never open the page. Only Elders
                // can be GIVEN one (ADR-0059 still stands on that), and the Elder
                // Tag is the canonical answer to who they are, so they are
                // filtered out of the same read rather than fetched again.
                _taskWatches.push(Live.watch(db.collection('people'), snap => {
                    this.people = snap.docs
                        .map(d => ({
                            id: d.id,
                            name: (d.data() || {}).name || 'Unnamed',
                            tags: (d.data() || {}).tags || [],
                        }))
                        .sort((a, b) => a.name.localeCompare(b.name));
                    this.elders = this.people.filter(p => (p.tags || []).indexOf(ELDER_TAG) >= 0);
                }, { fallbackEveryMs: Live.ROSTER_EVERY_MS, onError: e => console.error('Could not keep the directory current:', e) }));

                window.addEventListener('pagehide', stopTaskWatches);
            });
        },

        // Resolve the last rows that arrived into the page's dated list.
        //
        // ⚠ NOT WHILE A CARD IS FOLDING UP. A tick's own write comes back live
        // part-way through its little celebration, and redrawing then would
        // pull the row out from under the animation. The arrival is held, and
        // the tick applies it once the card has gone.
        applyTasks() {
            if (Object.keys(this.finishing).length) {
                this.tasksHeld = true;
                return;
            }
            this.tasksHeld = false;
            const rows = this.taskRows;
            const now = Date.now();
            this.tasks = TasksCore.resolve({
                tasks: rows.filter(t => !t.recurrence),
                series: rows.filter(t => t.recurrence),
                occurrences: this.occurrenceRows,
                now: now,
                from: TasksCore.dayOf(now - LOOK_BACK_DAYS * 86400000),
                to: TasksCore.dayOf(now + LOOK_AHEAD_DAYS * 86400000),
            });

            const byId = {};
            rows.filter(t => t.recurrence).forEach(s => { byId[s.id] = s; });
            this.seriesById = byId;
        },
        tasksHeld: false,

        // One fresh read, for the one moment a watch may not have caught up yet:
        // the end of a tick, where the row must not flash back at full size.
        async loadTasks() {
            const db = firebase.firestore();
            const [taskSnap, occSnap] = await Promise.all([
                db.collection(TASKS_COLLECTION).get(),
                db.collection(OCCURRENCES_COLLECTION).get(),
            ]);
            this.taskRows = taskSnap.docs.map(d => Object.assign({ id: d.id }, d.data()));
            this.occurrenceRows = occSnap.docs.map(d => Object.assign({ id: d.id }, d.data()));
        },

        // After one of our own writes. The writes go through a callable, so the
        // server makes them and nothing is applied on this device first — the
        // watch would bring the change back, but a beat later. One fresh read
        // makes your own change show at once, as it always did.
        async refreshAfterWrite() {
            await this.loadTasks();
            this.applyTasks();
        },

        // A profile tab that is closed stops listening.
        destroy() {
            stopTaskWatches();
        },

        // ── Presence and the Box lock (MS-491, ADR-0035, ADR-0062) ──────────
        //
        // One store per page (shepherding-presence.js). On a profile, the page
        // has started it already and this tab only listens; on its own page,
        // this component starts it.
        //
        // ⚠ PRESENCE MAY REMOVE A LOCK, NEVER AN EDITOR. It cannot throw here,
        // and while it is not running every Task opens.
        startPresence(user) {
            try {
                // Both kept, so a profile tab that is taken down stops listening
                // and stops ticking rather than piling up one of each per visit.
                _taskWatches.push(ShepherdingPresence.subscribe(entries => { this.presenceEntries = entries; }));
                const ticker = setInterval(() => { this.presenceTick++; }, PresenceCore.HEARTBEAT_MS);
                _taskWatches.push(() => clearInterval(ticker));
                if (this.embedded) return;
                const db = firebase.firestore();
                MosaicIdentity.me({ db, getUserData, uid: user.uid }).then(identity => {
                    ShepherdingPresence.start({
                        db,
                        uid: user.uid,
                        identity,
                        surface: 'shepherding-tasks',
                        pageKey: null,
                        stamp: () => firebase.firestore.FieldValue.serverTimestamp(),
                    });
                }).catch(e => console.warn('Presence could not work out who you are:', e));
                const leave = () => ShepherdingPresence.leave();
                window.addEventListener('beforeunload', leave);
                window.addEventListener('pagehide', leave);
            } catch (e) {
                console.warn('Presence could not start for Tasks; carrying on without it:', e);
            }
        },

        // A repeat is one commitment, so its box is the series whichever date
        // was opened.
        taskBox(task) {
            return ShepherdingPresence.box.task(task.seriesId || task.id);
        },

        taskHolder(task) {
            this.presenceTick; // read, so a quiet hold is redrawn as free
            if (!task || !this.currentUser) return null;
            return ShepherdingPresence.holderIn(
                this.presenceEntries, this.currentUser.uid, this.taskBox(task), Date.now());
        },

        holderLabel(holder) { return PresenceCore.holderLabel(holder); },
        holderTitle(holder) { return PresenceCore.holderTitle(holder); },

        // Every keystroke and change in an open editor.
        touchTask() {
            if (this.showModal && this.editingId && !ShepherdingPresence.touch()) this.taskLost = true;
        },

        // The row the editor was opened on, as it is now — or null if it is gone.
        get taskUnderEditor() {
            if (!this.taskOpenedWith) return null;
            const opened = this.taskOpenedWith;
            return this.tasks.find(t => opened.seriesId
                ? t.seriesId === opened.seriesId && t.dueDate === opened.dueDate
                : !t.seriesId && t.id === opened.id) || null;
        },

        get taskEditorState() {
            if (!this.showModal || !this.editingId || this.saving) return { state: 'unchanged' };
            return ShepherdingCore.editorState({
                kind: 'task', openedWith: this.taskOpenedWith, current: this.taskUnderEditor,
                holder: this.taskHolder(this.taskOpenedWith), lost: this.taskLost,
            });
        },

        get taskSaveBlocked() { return this.taskEditorState.state !== 'unchanged'; },

        get taskWarning() { return ShepherdingCore.editorWarning(this.taskEditorState, 'task'); },

        // ── The three lists ──────────────────────────────────────────────────

        // On a profile, only the Tasks that are FOR this person (ADR-0061) —
        // never the ones merely assigned to them, which are their work rather
        // than care toward them. On the page, everything.
        scoped(list) {
            return this.aboutPersonId ? TasksCore.forPerson(list, this.aboutPersonId) : list;
        },

        matchesFilter(task) {
            if (this.assigneeFilter === 'all') return true;
            if (this.assigneeFilter === 'unassigned') return task.isUnassigned;
            if (this.assigneeFilter === 'mine') {
                return this.currentPersonId && task.assigneeIds.includes(this.currentPersonId);
            }
            return task.assigneeIds.includes(this.assigneeFilter);
        },

        get overdue() {
            return this.scoped(this.tasks)
                .filter(t => t.state === TasksCore.STATES.OVERDUE && this.matchesFilter(t));
        },

        get upcoming() {
            return this.scoped(this.tasks)
                .filter(t => t.state === TasksCore.STATES.OPEN && this.matchesFilter(t));
        },

        get done() {
            const since = this.doneWindowDays
                ? TasksCore.completedWindowStart(Date.now(), this.doneWindowDays)
                : null;
            return TasksCore.completed(this.scoped(this.tasks), since ? { since } : null)
                .filter(t => this.matchesFilter(t));
        },

        // ── Labels ───────────────────────────────────────────────────────────

        // A row's identity on the page — the date included, because a repeat
        // wears one id across every date it produces. Same pair the x-for keys
        // are built from, so a row keeps its element, and therefore its running
        // animation, across a re-render.
        keyOf(task) {
            return String(task.id) + '|' + String(task.dueDate);
        },

        rowClass(task) {
            const stage = this.finishing[this.keyOf(task)];
            return 'task flex items-start gap-3 p-md rounded-lg bg-surface-container-lowest ' +
                'border border-outline-variant cursor-default ' +
                (task.state === TasksCore.STATES.OVERDUE ? 'task--overdue ' : '') +
                (task.state === TasksCore.STATES.DONE ? 'task--done ' : '') +
                (task.state === TasksCore.STATES.SKIPPED ? 'task--skipped ' : '') +
                (stage ? 'task--finishing ' : '') +
                (stage === 'leaving' ? 'task--leaving ' : '');
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

        // Who the Task is FOR. Empty when it is about nobody in particular,
        // which is most of them — and empty draws nothing rather than "none".
        aboutLabel(task) {
            if (!task.aboutPersonId) return '';
            const person = this.people.find(p => p.id === task.aboutPersonId);
            return (person && person.name) || 'Someone';
        },

        aboutHref(task) {
            return 'shepherding-profile.html?id=' + encodeURIComponent(task.aboutPersonId || '');
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
                // On a profile the answer is already known, and asking it again
                // is how a Task ends up on the page but not on the tab it was
                // written from.
                aboutPersonId: this.aboutPersonId || '',
                repeats: false, freq: 'monthly', endsKind: 'never', endsDate: '', endsCount: 12,
            };
            this.showModal = true;
            this.$nextTick(() => this.mountEditor(''));
        },

        openEdit(task) {
            // A Task somebody else has open does not open (ADR-0035).
            if (!ShepherdingPresence.claimBox(this.taskBox(task))) {
                this.say(this.holderTitle(this.taskHolder(task)) || 'Someone is editing this');
                return;
            }
            this.taskLost = false;
            this.taskOpenedWith = task;
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
                aboutPersonId: task.aboutPersonId || '',
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
                    onUpdate: () => this.touchTask(),
                });
            } catch (e) {
                // The editor is a nicety; the Task is not. A page that will not
                // open because a bundle failed is worse than a plain box.
                console.error('Task body editor:', e);
            }
        },

        closeModal() {
            if (this.bodyEditor) { this.bodyEditor.destroy(); this.bodyEditor = null; }
            if (this.editingId) ShepherdingPresence.release();
            this.showModal = false;
            this.taskLost = false;
            this.taskOpenedWith = null;
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
            // Never over somebody else's work; the warning says why.
            this.touchTask();
            if (this.taskSaveBlocked) return;
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
                        // ⚠ ONLY WHEN THE WHOLE COMMITMENT IS BEING EDITED. Who
                        // a Task is for is true of every date of it, and the
                        // server refuses it on one date rather than letting
                        // March be about somebody else.
                        aboutPersonId: this.editingDate ? undefined : (this.form.aboutPersonId || null),
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
                        aboutPersonId: this.form.aboutPersonId || undefined,
                        recurrence: this.form.repeats ? this.recurrenceFromForm() : undefined,
                    });
                }
                this.closeModal();
                await this.refreshAfterWrite();
                this.say('Saved');
            } catch (e) {
                // A refusal from the server is a sentence written for a person
                // to read, so it is shown rather than replaced.
                this.error = (e && e.message) || 'That did not save.';
            } finally {
                this.saving = false;
            }
        },

        // Finishing something is the point of the whole page, so it gets a
        // moment. The box fills, sparks go, the title strikes through, the card
        // folds up — and only then does the list redraw without it.
        //
        // ⚠ THE WRITE GOES FIRST AND DOES NOT WAIT FOR THE SHOW. The animation
        // plays OVER the round trip rather than after it, so the celebration
        // costs nothing: by the time the card has folded up, the server has
        // usually already answered. If it refused, the reload puts the Task
        // straight back and the toast says why.
        async tick(task) {
            const key = this.keyOf(task);
            if (this.finishing[key]) return;        // one tick per card

            const saved = this.call('complete', {
                taskId: task.seriesId || task.id,
                date: task.seriesId ? task.dueDate : undefined,
            }).then(() => null, e => e || new Error('That did not save.'));

            this.finishing[key] = 'finishing';
            await this.pause(CELEBRATE_MS);
            this.finishing[key] = 'leaving';
            await this.pause(LEAVE_MS);

            const failure = await saved;
            try {
                await this.refreshAfterWrite();
            } finally {
                // Cleared, and the list redrawn, in one step, so the row cannot
                // flash back into view at full size on its way out.
                delete this.finishing[key];
                this.applyTasks();
            }
            this.say(failure ? (failure.message || 'That did not save.') : 'Done');
        },

        // Nothing is animating for somebody who asked for stillness, so there
        // is nothing for them to wait on either.
        pause(ms) {
            const still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            return new Promise(resolve => setTimeout(resolve, still ? 0 : ms));
        },

        async untick(task) {
            try {
                await this.call('reopen', { taskId: task.seriesId || task.id, date: task.seriesId ? task.dueDate : undefined });
                await this.refreshAfterWrite();
                this.say('Put back');
            } catch (e) { this.say((e && e.message) || 'That did not save.'); }
        },

        async skip(task) {
            if (!confirm('Skip this one without marking it done?')) return;
            try {
                await this.call('skip', { taskId: task.seriesId, date: task.dueDate });
                await this.refreshAfterWrite();
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
                await this.refreshAfterWrite();
                this.say(out && out.stopped ? 'Stopped — what was done is kept' : 'Deleted');
            } catch (e) { this.say((e && e.message) || 'That did not save.'); }
        },

        say(message) {
            this.toast = message;
            setTimeout(() => { this.toast = ''; }, 2500);
        },

        // ── The Person Picker's half of the contract ─────────────────────────
        //
        // The picker knows how to search, highlight and choose; it knows
        // nothing about Tasks. These three say what it is choosing from, what is
        // chosen, and where the answer goes.

        get ppPeople() { return this.people; },

        get ppSelectedId() { return this.form.aboutPersonId; },

        ppSelect(person) { this.form.aboutPersonId = person ? person.id : ''; },
    }, Object.getOwnPropertyDescriptors(PersonPicker.mixin())));
});
