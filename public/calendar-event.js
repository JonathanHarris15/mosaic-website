// Event detail — one Event, one screen, two very different readers
// (MS-154 / MS-155 / MS-156 / MS-157).
//
// An editor sees the Roles, the picker, the state controls, the recurrence
// pattern and the visibility ladder. A member sees their own part, and the
// roster only if the editor chose to share it.
//
// Four things this screen is careful about:
//
//   • A slot holds ONE current Assignment. Assigning a replacement overwrites
//     it — which is what clears a decline and drops the decliner from the
//     participant list in a single write.
//   • A one-off Role stays structurally light. No slots, no rules, no counts.
//   • Changing a recurrence pattern NEVER migrates silently. The orphans are
//     computed, shown with who is on them, and acted on per-date.
//   • "Did they serve?" is scaffolding, so it is one row — never a banner, never
//     a modal, and never when there is nothing to ask.

(function () {
    'use strict';

    const Core = window.EventsOccurrenceCore;
    const Store = window.EventsStore;
    const View = window.CalendarView;
    const Roles = window.RolesCore;
    const Events = window.EventsCore;
    const Fairness = window.FairnessCore;
    const FamilyCore = window.FamilyCore;

    const params = new URLSearchParams(window.location.search);

    // ── Where "back" goes ────────────────────────────────────────────────────
    //
    // A SERIES is only ever reached from the Recurring Events list — the Calendar
    // draws dates, and a pattern is not a date, so it has no chip to come from.
    // Sending it back to the Calendar therefore ended the journey somewhere that
    // could not show the thing just left, and the way back to the list was to
    // find it again from the Calendar's header.
    //
    // One date still belongs to the Calendar. That is where a date is met.
    //
    // Read from the address bar rather than from loaded state, so the header is
    // right on the first paint rather than after the read that fills it in.
    const BACK = (function () {
        const seriesId = params.get('series');
        if (seriesId) {
            return {
                href: 'recurring-events.html?series=' + encodeURIComponent(seriesId),
                label: 'Recurring events',
                sentence: 'Back to recurring events',
            };
        }
        // Creating an event that REPEATS is a journey that starts on the
        // Recurring Events page — `?repeats=1` is that page's own doing.
        if (params.get('new') === '1' && params.get('repeats') === '1') {
            return {
                href: 'recurring-events.html',
                label: 'Recurring events',
                sentence: 'Back to recurring events',
            };
        }
        return {
            href: 'calendar.html',
            label: 'Calendar',
            sentence: 'Back to the calendar',
        };
    })();

    // This component is the Event detail SCREEN, and it is also the behaviour
    // behind the Roles panel wherever that is mounted (MS-16). The service page
    // mounts it for one Sunday, beside the order of service, so that staffing a
    // Sunday and building a Sunday are not two different pages.
    //
    // `config` is how a host says which occurrence and how much of it:
    //
    //   occurrenceId  the occurrence to open, instead of reading ?id= from the
    //                 address bar. A host that is already about one date knows
    //                 it without being told twice.
    //   rolesOnly     the host shows the Roles panel and nothing else, so the
    //                 controls that change WHICH Roles the Event carries are
    //                 absent. That is a property of the Event, decided on the
    //                 Event — changing it from inside one Sunday is how somebody
    //                 changes every Sunday by accident.
    window.eventDetailPage = function eventDetailPage(config) {
        const cfg = config || {};

        return {
            loading: true,
            error: '',
            saving: false,

            // Filling Roles is always on offer; deciding which Roles exist is not.
            canEditRoleSet: !cfg.rolesOnly,

            // The one way out, said the same way everywhere it is drawn — the
            // header arrow, the button beside the title, and the create form's
            // Cancel. Three copies of a literal is three chances for one of them
            // to keep pointing at the Calendar.
            backHref: BACK.href,
            backLabel: BACK.label,
            backSentence: BACK.sentence,

            rank: null,
            personId: null,
            uid: null,

            occurrence: null,
            series: null,
            assignments: [],
            attendance: [],
            // Which pane of the Event page is open. Editors get a second one —
            // who was actually here — so it starts on the Event either way.
            tab: 'event',
            people: [],
            roleDefinitions: [],
            relationships: [],
            groups: [],

            // Who said they would not be here on THIS date, and the stretch each
            // of them said it in (MS-188). Editors only — the collection-group
            // rule closes it to everyone else, and a member does not need it:
            // nobody else's picker is theirs to open.
            awayPersonIds: [],
            awayStretchBy: {},

            // What fairness knows about this occurrence: the serve history for
            // this series inside the window, and the window's own dates. Loaded
            // once per occurrence rather than per Role — load is per person per
            // date, and only recency changes from one Role to the next.
            serveHistory: [],
            fairnessWindow: [],

            // The screens that sit over this one.
            picker: { open: false, roleSlug: null, slotId: null, query: '', hideBlocked: false, picked: null, loading: false },
            pattern: { open: false, rule: null, orphans: [], choices: {} },
            tidyUp: { open: false, ticks: {} },
            // Set only when a Role being taken off would drop somebody.
            pendingRemoval: null,
            oneOffDraft: '',

            // ── Loading ──────────────────────────────────────────────────────

            async init() {
                await this.resolveViewer();
                await this.load();
                // After the page, never before it. A picker cannot be opened
                // until the Event is drawn, so this read has no business
                // holding the Event up — and a refusal here must cost a reason
                // on a row, not the whole screen.
                this.loadAway();
            },

            // A dropped read is not a broken page, it is a read that did not come
            // back — and the difference matters, because trying again usually
            // works. Without this the only way out of "could not be loaded" is a
            // full page reload, which on the service page means losing whatever
            // is unsaved in the order of service.
            async retry() {
                if (this.loading) return;
                this.error = '';
                this.loading = true;
                await this.load();
            },

            resolveViewer() {
                return new Promise(resolve => {
                    auth.onAuthStateChanged(async user => {
                        if (!user) { this.rank = null; return resolve(); }
                        this.uid = user.uid;
                        try {
                            const data = await getUserData(user.uid);
                            this.personId = (data && data.personId) || null;
                            this.rank = (data && (data.permissionLevel || data.role)) || 'viewer';
                        } catch (e) {
                            this.rank = 'viewer';
                        }
                        resolve();
                    });
                });
            },

            // ── Who is away on this date ─────────────────────────────────────

            async loadAway() {
                this.awayPersonIds = [];
                this.awayStretchBy = {};
                if (!this.isEditor || !this.occurrence || !this.occurrence.date) return;
                if (typeof window.AwayStore === 'undefined') return;
                try {
                    const date = this.occurrence.date;
                    const stretches = await window.AwayStore.loadStretchesOn(db, date);
                    stretches.forEach(s => { this.awayStretchBy[s.personId] = s; });
                    this.awayPersonIds = stretches.map(s => s.personId);
                } catch (e) {
                    // A picker that cannot say "Sarah is away" is worse than one
                    // that can, but it is not a broken Event page.
                    console.error('Away load failed:', e);
                }
            },

            // Their own words, or the editor's if an editor entered it. The
            // attribution is the safeguard: overruling a rule is judgement,
            // overruling somebody's own word is disbelief, and the sentence has
            // to make the difference visible.
            awayNoteFor(personId) {
                const stretch = this.awayStretchBy[personId];
                if (!stretch) return null;
                const subject = this.people.find(p => p && p.id === personId) || null;
                const author = stretch.authorPersonId
                    ? this.people.find(p => p && p.id === stretch.authorPersonId) || null
                    : null;
                return window.AwayCore.awayNote(stretch, subject, author);
            },

            // ── Creating ─────────────────────────────────────────────────────
            //
            // A one-off Event is a single occurrence document. A repeating one is
            // a SERIES carrying a rule and NO occurrence documents — its dates
            // are computed, and a document appears the first time something lands
            // on one.

            creating: false,
            draft: {
                name: '', date: '', time: '', location: '', description: '',
                // The last day, for something that runs over several — a
                // half-term, a conference, a week away. Blank means one day,
                // which is nearly everything.
                endDate: '',
                visibility: 'member', rosterShared: false,
                recurrence: { freq: 'once', startDate: '', weekday: null, time: '', ends: { kind: 'never' } },
            },

            // What is wrong with the run of days, in a sentence, or empty. Shown
            // as it is typed rather than saved and rejected — "the last day is
            // before the first" is worth knowing before pressing the button.
            get draftSpanError() {
                if (this.draft.recurrence.freq !== 'once') return '';
                return Core.spanError({ date: this.draft.date, endDate: this.draft.endDate }) || '';
            },

            get draftSpanSentence() {
                return View.spanSentence({ date: this.draft.date, endDate: this.draft.endDate });
            },

            get draftSentence() {
                const rule = Object.assign({}, this.draft.recurrence, {
                    startDate: this.draft.date, time: this.draft.time,
                });
                // A run of days is not a pattern, so it does not belong in
                // `recurrenceSentence` — but it IS the thing the editor most
                // needs read back to them, because "once, on Monday" is a
                // truthful sentence about a five-day conference and a useless
                // one. So it replaces the sentence rather than trailing it.
                const span = View.spanSentence({ date: this.draft.date, endDate: this.draft.endDate });
                if (span) {
                    const days = View.spanLengthSentence({ date: this.draft.date, endDate: this.draft.endDate });
                    const at = this.draft.time ? ', from ' + View.formatTime(this.draft.time) : '';
                    return span + at + ' — ' + days + '.';
                }
                return View.recurrenceSentence(rule);
            },

            get draftDates() {
                if (!this.draft.date) return [];
                const rule = Object.assign({}, this.draft.recurrence, { startDate: this.draft.date });
                if (rule.freq === 'once') return [this.draft.date];
                return View.nextDates(rule, this.draft.date, 6);
            },

            get draftValid() {
                return !!(String(this.draft.name).trim() && this.draft.date) && !this.draftSpanError;
            },

            async createEvent() {
                if (!this.draftValid || this.saving) return;
                this.saving = true;
                this.error = '';
                try {
                    const rule = Object.assign({}, this.draft.recurrence, {
                        startDate: this.draft.date,
                        time: this.draft.time || null,
                    });
                    if (rule.freq !== 'once' && !Number.isInteger(rule.weekday)) {
                        // Derive the weekday from the start date rather than
                        // making the editor state it twice.
                        rule.weekday = window.DateUtils.parseDateStr(this.draft.date).getDay();
                    }

                    const made = await Store.createEvent(db, {
                        name: this.draft.name,
                        date: this.draft.date,
                        // Only a one-off can run over several days — a pattern
                        // says how often, not how long, and the store refuses
                        // the combination rather than half-honouring it.
                        endDate: this.draft.recurrence.freq === 'once' ? (this.draft.endDate || null) : null,
                        time: this.draft.time,
                        location: this.draft.location,
                        description: this.draft.description,
                        visibility: this.draft.visibility,
                        rosterShared: this.draft.rosterShared,
                        recurrence: rule,
                    });

                    // A one-off has a document to open. A series does not yet —
                    // nothing has landed on any of its dates — so it goes to the
                    // list of what repeats, opened on the one just made. The
                    // Calendar used to be the answer for both, which meant making
                    // a recurring event and then hunting the calendar for a date
                    // of it in order to see it had worked.
                    window.location.href = made.kind === 'occurrence'
                        ? 'calendar-event.html?id=' + encodeURIComponent(made.id)
                        : 'recurring-events.html?series=' + encodeURIComponent(made.id);
                } catch (e) {
                    console.error('Create failed:', e);
                    this.error = e.message || 'That event could not be created.';
                    this.saving = false;
                }
            },

            // Cancel one date without disturbing the rest of the series. The
            // series goes with it because this write is usually the one that
            // CREATES the date's document, and it has to stamp the series'
            // visibility onto it — handing over the series we already hold saves
            // a read, and saves being refused one we may not read.
            async skipThisOne() {
                if (!this.series || !this.occurrence) return;
                this.saving = true;
                try {
                    await Store.cancelOccurrence(
                        db, this.series.id, this.occurrence.date, !this.occurrence.cancelled,
                        { series: this.series }
                    );
                    this.occurrence.cancelled = !this.occurrence.cancelled;
                    this.occurrence.stored = true;
                } catch (e) {
                    console.error('Cancel failed:', e);
                    this.error = 'That date could not be changed.';
                } finally {
                    this.saving = false;
                }
            },

            // ── Deleting a one-off ───────────────────────────────────────────
            //
            // Only a one-off. One date of a repeating Event is skipped or moved,
            // never deleted: the pattern still produces the date, so deleting the
            // document only removes the note saying it is off, and the Calendar
            // draws the event straight back.
            pendingDelete: false,

            get canDelete() { return this.isEditor && this.isOneOff && !cfg.rolesOnly; },

            // Named, and honest about the two things people ask when they hover
            // over a delete: does anyone find out, and what happens to the
            // serving already on the books.
            get deleteSentence() {
                const n = (this.assignments || []).length;
                if (!n) return 'Nobody is on it, so nothing else goes with it.';
                return n === 1
                    ? 'One person is on it. They are dropped, and nobody is told.'
                    : n + ' people are on it. They are dropped, and nobody is told.';
            },

            async deleteThisEvent() {
                if (!this.canDelete || this.saving) return;
                this.saving = true;
                try {
                    await Store.deleteOccurrence(db, this.occurrence.id);
                    // Nothing left to be on, so leave rather than showing the
                    // page for something that is gone.
                    window.location.href = 'calendar.html';
                } catch (e) {
                    console.error('Delete failed:', e);
                    this.error = (e && e.message) || 'That event could not be deleted.';
                    this.pendingDelete = false;
                    this.saving = false;
                }
            },

            async load() {
                this.loading = true;
                this.error = '';
                try {
                    // ⚠ Managing the EVENT itself moved out of this page in
                    // MS-229. Its time, pattern, colour, visibility and which
                    // Roles it carries are now tabs beside the rota on
                    // Recurring Events, because reading the rota and changing
                    // the thing the rota is of were two screens and one job.
                    //
                    // The route stays, as a redirect rather than as a page. A
                    // bookmark from before the merge is somebody trying to get
                    // to a real place, and the real place still exists.
                    const seriesId = cfg.occurrenceId ? null : params.get('series');
                    if (seriesId) {
                        window.location.replace(
                            'recurring-events.html?series=' + encodeURIComponent(seriesId)
                        );
                        return;
                    }

                    // A host that mounted this for one date said so; otherwise the
                    // address bar names it.
                    const id = cfg.occurrenceId || params.get('id');

                    // No id means this is a new Event, not a broken link.
                    if (!id) {
                        if (!this.isEditor) {
                            this.error = 'Only an editor can create an event.';
                            return;
                        }
                        this.creating = true;
                        // The Calendar's day menu puts the day you clicked in the
                        // link, so the form opens already on it. Today is only the
                        // fallback for "New event" pressed from the toolbar, where
                        // no day was named.
                        this.draft.date = params.get('date') || window.DateUtils.todayStr();
                        // Arrived from the Recurring Events page, which is
                        // entirely about the ones that come round. "Just once" is
                        // the right default from the Calendar and the wrong one
                        // from there — it makes the first act on that page
                        // creating something that will never appear on it.
                        if (params.get('repeats')) this.draft.recurrence.freq = 'weekly';
                        return;
                    }

                    const loaded = await Store.loadOccurrence(db, id);
                    if (!loaded) { this.error = 'That event could not be found.'; return; }

                    this.occurrence = loaded;
                    this.assignments = loaded.assignments || [];
                    this.startOccurrenceDraft();
                    if (this.isEditor) {
                        try {
                            this.attendance = await Store.loadAttendance(db, loaded.id);
                        } catch (e) {
                            this.attendance = [];
                        }
                    }

                    // The rest in one wave. None of these three needs anything
                    // from the others — they were only sequential because they
                    // were written in the order somebody thought of them, and
                    // each `await` is a whole round trip.
                    //
                    // allSettled, NOT all. Reads on this transport get dropped —
                    // that is what the deadline in local-cache.js exists for —
                    // and with `all` a dropped read of the SERIES blanked the
                    // whole screen, roster and all, over a document the roster
                    // never needed. Only the people and the Role definitions are
                    // worth failing for, because without them there is nothing
                    // to draw.
                    const [series, core, liturgy] = await Promise.allSettled([
                        loaded.seriesId
                            ? db.collection('events').doc(loaded.seriesId).get()
                            : Promise.resolve(null),

                        // ⚠ NOTHING FOR A STRANGER TO READ HERE, AND ASKING
                        // WOULD BREAK THE PAGE. This page draws signed out (see
                        // `signedOut`), and since MS-197 the directory needs an
                        // account (ADR-0031). A refusal lands in `core`, which
                        // is the one result worth throwing for — so an
                        // unguarded read would turn a public Event into an
                        // error screen. A signed-out visitor sees no roster
                        // anyway: those rows are editors-or-your-own.
                        !this.rank ? Promise.resolve()
                            : this.isEditor ? this.loadEditorData() : this.loadPeople(),

                        // A Sunday's liturgy lives on the Service document, not
                        // in assignments, and the picker has to see it to know
                        // who is already busy.
                        this.isSunday
                            ? Store.loadLiturgicalHolders(db, loaded.date)
                            : Promise.resolve([]),
                    ]);

                    if (core.status === 'rejected') throw core.reason;

                    if (series.status === 'fulfilled' && series.value && series.value.exists) {
                        this.series = Object.assign({ id: series.value.id }, series.value.data());
                    } else if (series.status === 'rejected') {
                        // Survivable: the series carries the recurrence and the
                        // colour, so the roster reads fine without it.
                        console.warn('Could not read the event series:', series.reason);
                    }

                    if (liturgy.status === 'fulfilled') {
                        this.liturgicalHolders = liturgy.value || [];
                    } else {
                        // Already degrades to nobody by design — worth saying out
                        // loud, because the cost is that somebody preaching stays
                        // assignable rather than showing as busy.
                        console.warn('Could not read who is leading this Sunday:', liturgy.reason);
                    }

                    // Last, and only for an editor: it needs the series and the
                    // Role definitions above it, and a member never sees the
                    // picker the note is written for. Failing here costs a
                    // subtitle, never the roster.
                    if (this.isEditor) await this.loadFairness();
                } catch (e) {
                    console.error('Event load failed:', e);
                    this.error = (e && e.code === 'permission-denied')
                        ? 'You are not able to see this event.'
                        : 'That event could not be loaded just now.';
                } finally {
                    this.loading = false;
                }
            },

            // A host that has already read the directory hands it over rather
            // than making this read it again. The service page had loaded all 74
            // People into its own registry before the Roles tab was ever opened,
            // and this fetched the identical collection a second time — on a
            // transport where a dropped read is the failure mode, the cheapest
            // read is the one not issued.
            //
            // Empty means the host has not got there yet, which is not the same
            // as "no people", so that falls through and reads.
            async loadPeople() {
                if (cfg.people && cfg.people.length) {
                    this.people = cfg.people.slice()
                        .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
                    return;
                }

                const snap = await db.collection('people').get();
                this.people = snap.docs
                    .map(d => Object.assign({ id: d.id }, d.data()))
                    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
            },

            // What the SCREEN needs: the people, to put a name against whoever is
            // in a slot, and the Role Definitions, to draw the cards at all.
            //
            // Relationships, groups and privacy tags are NOT here. They answer
            // "who may take this place", which is a question nobody has asked
            // until they open the picker — and three collections is three reads
            // and three chances of a dropped one, paid by every editor who only
            // came to look at the roster.
            async loadEditorData() {
                const [, roles] = await Promise.all([
                    this.loadPeople(),
                    db.collection('roles').get(),
                ]);
                this.roleDefinitions = roles.docs.map(d => Object.assign({ id: d.id }, d.data()));
            },

            // Loaded once, the first time somebody opens the picker, and kept.
            pickerDataLoaded: false,

            async ensurePickerData() {
                if (this.pickerDataLoaded) return;

                const [rels, groups, families] = await Promise.all([
                    // Serving rules may only name a Relationship Type an elder has
                    // shared with editors, so the query is constrained the same way
                    // the Roles Manager constrains it. Unconstrained it would error.
                    db.collection('relationships').where('sharedWithEditors', '==', true).get().catch(() => ({ docs: [] })),
                    db.collection('relationship_groups').where('sharedWithEditors', '==', true).get().catch(() => ({ docs: [] })),
                    // Family and Marriage are answered from the Membership
                    // Directory, not from a hand-rostered group, so they need no
                    // sharing and arrive in the same shape as a real group.
                    db.collection('families').get().catch(() => ({ docs: [] })),
                ]);
                this.relationships = rels.docs.map(d => d.data());
                this.groups = groups.docs
                    .map(d => Object.assign({ id: d.id }, d.data()))
                    .concat(FamilyCore.servingGroups(
                        families.docs.map(d => Object.assign({ id: d.id }, d.data())),
                        this.people
                    ));
                await this.loadHidingTags();

                this.pickerDataLoaded = true;
            },

            // What time this date happens at. Read through the model rather than
            // off the document, because a date OF A SERIES takes its time from
            // the rule — a copy on the occurrence is a stale stamp, not a
            // deliberate per-date time, and letting it win is what made the top
            // of this screen say 4:30 am while the bottom said 4:30 pm.
            get eventTime() {
                return Core.timeOf(this.occurrence, this.series && this.series.recurrence);
            },

            // Where this date happens. Read through the model, because a
            // repeating Event's place is typed on the EVENT — a date of it has
            // nothing of its own, and reading the document alone left the
            // header saying nowhere while the Event said "the hall".
            get eventLocation() {
                return Core.locationOf(this.occurrence, this.series);
            },

            // What the EVENT is for. Read through for the same reason as the
            // place: a repeating Event's description is typed on the EVENT, and
            // reading the document alone showed nothing on every date of it
            // while the Event page one screen away had the words filled in.
            // Edited on the recurring Events page, never here — it is true of
            // every date, and this screen is about one of them.
            get eventDescription() {
                return Core.eventDescriptionOf(this.occurrence, this.series);
            },

            // What is different about THIS DATE — the other description, which
            // adds to the Event's rather than replacing it. Only this
            // screen edits it, and only a date of a series has one.
            get dateDescription() {
                return Core.dateDescriptionOf(this.occurrence);
            },

            // "to Friday 27 November · 5 days" — empty for a single-day Event,
            // so the header shows nothing rather than a range of one.
            get eventSpan() {
                const end = Core.endDateOf(this.occurrence);
                if (!end) return '';
                return 'to ' + this.longDate(end) + ' · ' + View.spanLengthSentence(this.occurrence);
            },

            // ── Who is looking ───────────────────────────────────────────────

            // Nobody is signed in. Worth saying, because a signed-out Event page
            // is not an error — it is the public reading of it, with the Roles
            // and every control simply absent. That looks like the feature is
            // missing rather than like you are.
            get signedOut() { return !this.loading && !this.rank; },

            get signInHref() {
                return window.MOSAIC_SHELL === 'mobile' ? 'mobile.html#/login' : 'login.html';
            },

            get isEditor() {
                return ['editor', 'admin', 'elder', 'super_admin'].indexOf(this.rank) !== -1;
            },

            get isSunday() {
                return this.occurrence && this.occurrence.seriesId === Core.SUNDAY_SERVICE_ID;
            },

            get isPast() {
                return this.occurrence && this.occurrence.date < window.DateUtils.todayStr();
            },

            // A member sees the roster only if the editor chose to share it. Your
            // OWN part is always yours to see.
            get canSeeRoster() {
                if (this.isEditor) return true;
                return !!(this.occurrence && this.occurrence.rosterShared);
            },

            get myAssignment() {
                if (!this.personId) return null;
                return this.assignments.find(a => a.personId === this.personId) || null;
            },

            get needsAttention() { return Core.needsAttention({ assignments: this.assignments }); },

            // The same declined places, split by whether they are the editor's
            // to fill today or already in front of the whole church (MS-207).
            // The Event's rung decides it, so this needs the occurrence itself
            // and not just its Assignments.
            get withAssignments() {
                return Object.assign({}, this.occurrence || {},
                    { assignments: this.assignments });
            },
            get outForCover() { return Core.outForCover(this.withAssignments); },
            get needsEditor() { return Core.needsEditor(this.withAssignments); },

            get declined() {
                return this.assignments.filter(a => (a.state || Core.STATES.PENDING) === Core.STATES.DECLINED);
            },

            // ── Roles on this Event ──────────────────────────────────────────
            //
            // Managed Roles come from the Roles Manager and arrive WITH their
            // slots and restriction rules. One-off Roles are a label and some
            // people, and nothing more — no slots, no rules, no count.
            //
            // NOTE THE FIELD NAME. `occurrenceRoleSlugs` lives on the OCCURRENCE
            // and says which Roles THIS DATE needs. The series has its own
            // `roleSlugs` (EventsCore) saying which Roles the series carries.
            // They are different lists at different levels, and giving them the
            // same name — as an earlier pass did — reads as one field to anybody
            // holding CONTEXT.md's Event series entry in their head.

            // The Roles the whole Event carries, minus the liturgical ones. Those
            // are filled in the order of service and print in the booklet — a
            // fillable card here would be a second, silent way to set one.
            get seriesRoleSlugsHere() {
                return (((this.series && this.series.roleSlugs) || []))
                    .filter(slug => Roles.LITURGICAL_SLUGS.indexOf(slug) === -1);
            },

            // Rules about a PAIR of Roles (MS-221), written on the recurring
            // events page and stored on the series. A ONE-OFF Event has no
            // series and therefore no cross-Role rules — which is right: the
            // rule is a standing arrangement, not a decision about one date.
            get crossRoleRules() {
                return Events.crossRoleRulesOf(this.series);
            },

            // Both lists, the Event's first. Adding "Sound desk" to the Sunday
            // Service has to mean every Sunday HAS a sound desk to fill —
            // otherwise the series screen is a list that does nothing.
            get roleSlugsHere() {
                const fromSeries = this.seriesRoleSlugsHere;
                const fromDate = ((this.occurrence && this.occurrence.occurrenceRoleSlugs) || [])
                    .filter(slug => fromSeries.indexOf(slug) === -1);
                return fromSeries.concat(fromDate);
            },

            get managedRoles() {
                const fromSeries = this.seriesRoleSlugsHere;
                return this.roleSlugsHere
                    .map(slug => this.roleDefinitions.find(d => d.slug === slug))
                    .filter(Boolean)
                    .map(def => ({
                        def: def,
                        // Where it came from, so the card knows whether taking it
                        // off this date is a thing that can be meant.
                        fromSeries: fromSeries.indexOf(def.slug) !== -1,
                        slots: (def.slots || []).map((slot, i) => ({
                            index: i + 1,
                            slot: slot,
                            requirementLabel: this.requirementLabel(slot.requirement),
                            assignment: this.assignmentAt(def.slug, slot.id),
                            warning: this.warningAt(def.slug, slot.id),
                        })),
                        needsAttention: (def.slots || []).some(slot => {
                            const a = this.assignmentAt(def.slug, slot.id);
                            return a && (a.state || Core.STATES.PENDING) === Core.STATES.DECLINED;
                        }),
                        filled: (def.slots || []).filter(slot => this.assignmentAt(def.slug, slot.id)).length,
                    }));
            },

            // ⚠ Carries the fairness fields, not just the label. This projection
            // used to drop them, which meant `allowsAnotherRole` read as absent
            // for every one-off no matter what was stored — a toggle that
            // silently did nothing.
            get oneOffRoles() {
                return ((this.occurrence && this.occurrence.oneOffRoles) || []).map(job => ({
                    id: job.id,
                    label: job.label,
                    intensity: Roles.intensityOf(job),
                    allowsAnotherRole: Roles.allowsAnotherRole(job),
                    people: this.assignments.filter(a => a.oneOffId === job.id),
                }));
            },

            assignmentAt(roleSlug, slotId) {
                return this.assignments.find(a => a.roleSlug === roleSlug && a.slotId === slotId && !a.oneOffId) || null;
            },

            requirementLabel(requirement) {
                if (requirement === Roles.REQUIREMENTS.MALE) return 'A man';
                if (requirement === Roles.REQUIREMENTS.FEMALE) return 'A woman';
                return 'Either';
            },

            // ── Writing ──────────────────────────────────────────────────────

            actor() { return { actorUid: this.uid, at: new Date().toISOString() }; },

            async persist() {
                this.saving = true;
                try {
                    await Store.saveOccurrence(db, Object.assign({}, this.occurrence, {
                        assignments: this.assignments,
                    }));
                    // Keep the derived fields in step locally too, so the banner
                    // and the flag do not wait for a reload to agree.
                    this.occurrence.participantIds = Core.participantIds(this.assignments);
                } catch (e) {
                    console.error('Save failed:', e);
                    this.error = 'That change could not be saved.';
                } finally {
                    this.saving = false;
                }
            },

            // ── Moving THIS ONE, without touching the pattern ────────────────
            //
            // "First Sunday of the month, except in August when it is the
            // fifteenth." Editing the pattern for that would be wrong twice over:
            // it would move every other month too, and it would raise the orphan
            // confrontation over a change nobody meant to make.

            move: { open: false, toDate: '' },

            // Whether the pattern of this Event is one date's business at all.
            // Never a Sunday's: it is every Sunday BY DEFINITION, so there is no
            // pattern to change — and skipping one here would mark the Event off
            // while its order of service sat untouched under its own date, so one
            // Sunday would say two different things.
            get patternEditable() {
                return this.isEditor && !!this.series && !this.isSunday;
            },

            // The Event above this date. A one-off has none — it IS the Event.
            //
            // Recurring Events, not this page with a different query (MS-229):
            // the Event's own controls are tabs beside its rota now.
            get eventHref() {
                const seriesId = this.occurrence && this.occurrence.seriesId;
                return seriesId
                    ? 'recurring-events.html?series=' + encodeURIComponent(seriesId)
                    : null;
            },

            get canMove() {
                // A one-off has no pattern to leave alone — you just change its
                // date. The Sunday Service keeps its order of service under its
                // own date, so moving the Event would split one Sunday in two.
                return this.isEditor
                    && !!this.series
                    && !this.isSunday
                    && !!(this.series.recurrence || {}).freq
                    && this.series.recurrence.freq !== 'once';
            },

            openMove() {
                // Starts on the date it is already on, so the field reads as
                // "change this" rather than as an empty question.
                this.move = { open: true, toDate: (this.occurrence && this.occurrence.date) || '' };
            },

            get moveValid() {
                const to = this.move.toDate;
                return !!to && !!this.occurrence && to !== this.occurrence.date;
            },

            get moveSentence() {
                if (!this.moveValid) return '';
                return 'This one moves to ' + this.longDate(this.move.toDate) +
                    '. Every other date stays where it is.';
            },

            async saveMove() {
                if (!this.moveValid || this.saving) return;
                this.saving = true;
                this.error = '';
                try {
                    const to = this.move.toDate;
                    await Store.moveOccurrence(db, this.series.id, this.occurrence.date, to, {
                        series: this.series,
                    });
                    // The id is derived from the date, so the moved instance is a
                    // different document — the page has to follow it there.
                    window.location.href = 'calendar-event.html?id=' +
                        encodeURIComponent(Core.occurrenceId(this.series.id, to));
                } catch (e) {
                    console.error('Move failed:', e);
                    this.error = (e && e.message) || 'That date could not be changed.';
                    this.saving = false;
                }
            },

            get movedNote() { return Core.movedNote(this.occurrence); },

            // ── Who is already down for the liturgy ──────────────────────────
            //
            // A Sunday's liturgical Roles are FIELDS on the Service document, not
            // Assignments — the ones the printed booklet reads. So nothing in the
            // Assignment model knows about them, and without this the picker for
            // the sound desk cheerfully offers you the preacher.
            //
            // Loaded on a Sunday only. There is no Service document for a
            // Wednesday, and asking for one would be a question about the wrong
            // kind of day.
            liturgicalHolders: [],

            get liturgicalBlocks() {
                return this.isSunday ? (this.liturgicalHolders || []) : [];
            },

            // ── The Event above this date ────────────────────────────────────
            //
            // ⚠ Managing the Event ITSELF — its details, pattern, colour,
            // visibility and which Roles it carries — left this page in MS-229.
            // Those are four tabs beside the rota on Recurring Events now,
            // because reading a rota and changing the thing the rota is OF were
            // two screens and one job. `?series=` here is a redirect, not a page.
            //
            // This one getter stays. A DATE still has to know whether it is a
            // Sunday's — for the recurrence rule it falls back to, and for the
            // word it counts in ("3 Sundays ago", never "3 times ago").
            get isSundaySeries() {
                return !!this.series && this.series.id === Core.SUNDAY_SERVICE_ID;
            },

            // ── The colour it shows up as ────────────────────────────────────
            //
            // A recurring Event keeps this on the SERIES, so every date matches
            // and one change moves them all. A one-off Event has no series — its
            // occurrence IS the whole Event — so it carries its own.

            get colours() { return View.EVENT_COLOURS; },

            // Only where it decides one thing. On a repeating Event the colour is
            // the SERIES' — a swatch on one date would restyle every other date
            // from a screen that looks like it is about one of them, so it is set
            // beside that event's rota (MS-229) and this screen has none.
            get colourEditable() { return this.isOneOff; },

            get colour() {
                return View.colourOf({
                    seriesId: this.occurrence && this.occurrence.seriesId,
                    colour: this.occurrence && this.occurrence.colour,
                    seriesColour: this.series && this.series.colour,
                });
            },

            async setColour(slug) {
                if (this.saving || this.colour.slug === slug) return;
                this.saving = true;
                this.error = '';
                try {
                    if (this.series) {
                        await Store.setSeriesColour(db, this.series.id, slug);
                        this.series.colour = slug;
                    } else {
                        this.occurrence.colour = slug;
                        await Store.saveOccurrence(db, Object.assign({}, this.occurrence, {
                            assignments: this.assignments,
                        }));
                    }
                } catch (e) {
                    console.error('Colour change failed:', e);
                    this.error = 'That colour could not be saved.';
                } finally {
                    this.saving = false;
                }
            },

            // ── Taking a Role off ────────────────────────────────────────────
            //
            // Removing a Role deletes every Assignment on it. That is right —
            // people left behind would still count as participants of a Role the
            // Event no longer has, which is also what lets them SEE a restricted
            // Event. But it is a silent deletion behind one small button, so it
            // asks first. Only when there is somebody to lose: an empty Role
            // comes off on the click, because there is nothing to be sure about.

            async askRemoveOneOffRole(id) {
                const on = this.assignments.filter(a => a.oneOffId === id);
                if (!on.length) return this.removeOneOffRole(id);
                const job = ((this.occurrence.oneOffRoles) || []).find(j => j.id === id);
                this.pendingRemoval = this.removalQuestion('oneOff', id, (job && job.label) || 'this job', on);
            },

            // Names them. "Are you sure?" on its own is a question nobody can
            // answer well — you answer it by knowing who you are about to drop.
            removalQuestion(kind, key, name, on) {
                const names = on.map(a => this.personName(a.personId));
                return {
                    kind: kind,
                    key: key,
                    name: name,
                    count: on.length,
                    sentence: View.listSentence(names) +
                        (names.length === 1 ? ' loses their place.' : ' lose their places.'),
                };
            },

            cancelRemoval() { this.pendingRemoval = null; },

            // Only a one-off job now. Taking a Role off the EVENT is the same
            // question about a bigger thing, and it moved with the control that
            // asks it (MS-229).
            async confirmRemoval() {
                const ask = this.pendingRemoval;
                if (!ask) return;
                this.pendingRemoval = null;
                await this.removeOneOffRole(ask.key);
            },

            // Deliberately cheap: a label, and that is the whole interaction.
            async addOneOffRole() {
                const label = String(this.oneOffDraft || '').trim();
                if (!label) return;
                const jobs = ((this.occurrence.oneOffRoles) || []).slice();
                jobs.push({ id: 'o' + (jobs.length + 1) + '_' + Date.now().toString(36), label: label });
                this.occurrence.oneOffRoles = jobs;
                this.oneOffDraft = '';
                await this.persist();
            },

            // ── A one-off job's own fairness settings ────────────────────────
            //
            // A one-off Role has no stored definition, so intensity and
            // exclusivity live on the Event itself. They sit behind a disclosure
            // because the whole point of a one-off is that it is CHEAP — adding
            // "someone to unlock the hall" has to stay a sentence and a return
            // key, and both defaults are already right almost every time.
            //
            // But they have to exist: without them the person who unlocks the
            // hall every week reads as doing free work and quietly absorbs three
            // more jobs the same morning.
            oneOffOptionsFor: null,

            toggleOneOffOptions(id) {
                this.oneOffOptionsFor = this.oneOffOptionsFor === id ? null : id;
            },

            async setOneOffField(id, patch) {
                const jobs = ((this.occurrence.oneOffRoles) || []).map(job => (
                    job.id === id ? Object.assign({}, job, patch) : job
                ));
                this.occurrence.oneOffRoles = jobs;
                await this.persist();
            },

            async setOneOffIntensity(id, raw) {
                const value = Number(raw);
                if (!Number.isFinite(value) || value < 0) {
                    this.error = 'Rest between turns has to be zero or more weeks.';
                    return;
                }
                await this.setOneOffField(id, { intensity: value });
            },

            async setOneOffExclusive(id, allowsAnother) {
                await this.setOneOffField(id, { allowsAnotherRole: allowsAnother === true });
            },

            async removeOneOffRole(id) {
                this.occurrence.oneOffRoles = ((this.occurrence.oneOffRoles) || []).filter(j => j.id !== id);
                this.assignments = this.assignments.filter(a => a.oneOffId !== id);
                await this.persist();
            },

            async addToOneOff(job, personId) {
                this.assignments = Core.assignToOneOff(
                    this.assignments,
                    { oneOffId: job.id, label: job.label, personId: personId },
                    this.actor()
                );
                await this.persist();
            },

            async removeFromOneOff(jobId, personId) {
                this.assignments = Core.removeFromOneOff(this.assignments, jobId, personId);
                await this.persist();
            },

            // ── The three states ─────────────────────────────────────────────
            //
            // Only an editor ever sets one. Members confirming for themselves is
            // MS-20, and this is the record that will carry it.

            async setState(assignment, state) {
                this.assignments = assignment.oneOffId
                    ? Core.setOneOffState(this.assignments, assignment.oneOffId, assignment.personId, state, this.actor())
                    : Core.setStateAt(this.assignments, assignment.roleSlug, assignment.slotId, state, this.actor());
                await this.persist();
            },

            async clearSlot(roleSlug, slotId) {
                // Removal is instant and total — their sight of a restricted
                // Event goes with it.
                this.assignments = Core.clearSlot(this.assignments, roleSlug, slotId);
                await this.persist();
            },

            // ── The picker ───────────────────────────────────────────────────
            //
            // EVERYONE is listed. Somebody who cannot fill the slot is shown
            // greyed out WITH THE REASON, never silently omitted — the point is
            // that an editor can see who was passed over and why.

            // The list stays hidden until the privacy tags are in.
            //
            // `hidingTags` empty means "no tag hides anybody", which OFFERS
            // everyone — the wrong direction for a rule an elder set precisely
            // so nobody below them sees who is behind it. Rendering the
            // candidates while the read is still in flight would print those
            // names for as long as it took, which is the one failure this list
            // must never have.
            async openPicker(roleSlug, slotId) {
                this.picker = {
                    open: true, roleSlug, slotId,
                    query: '', hideBlocked: false, picked: null,
                    loading: !this.pickerDataLoaded,
                };
                await this.ensurePickerData();
                this.picker.loading = false;
            },

            closePicker() { this.picker.open = false; },

            get pickerRole() {
                return this.roleDefinitions.find(d => d.slug === this.picker.roleSlug) || null;
            },

            get pickerSlot() {
                const def = this.pickerRole;
                if (!def) return null;
                return (def.slots || []).find(s => s.id === this.picker.slotId) || null;
            },

            get pickerTitle() {
                const def = this.pickerRole;
                const def_slots = (def && def.slots) || [];
                const at = def_slots.findIndex(s => s.id === this.picker.slotId);
                if (!def) return '';
                return def.name + ' · place ' + (at + 1) + ' of ' + def_slots.length;
            },

            // Tags whose `people_tags` document says they hide the people
            // carrying them. An elder set those tags precisely so nobody below
            // them sees who is behind one, and a picker is nobody's exception.
            //
            // A refused read leaves the list EMPTY, which offers everyone. That
            // is the wrong direction for a privacy rule, so it is not silent:
            // the page says it could not check, rather than quietly showing
            // people it should not.
            hidingTags: [],

            async loadHidingTags() {
                try {
                    const snap = await db.collection('people_tags').get();
                    this.hidingTags = snap.docs
                        .filter(d => (d.data() || {}).hidePeople === true)
                        .map(d => d.id);
                } catch (e) {
                    console.error('Could not read which tags hide people:', e);
                    this.hidingTags = [];
                    this.error = 'Some people may be missing from the list — the privacy ' +
                        'tags could not be read, so nobody hidden by one is being offered.';
                }
            },

            // ── What fairness knows ──────────────────────────────────────────
            //
            // Read once per occurrence, so the picker can explain a suggestion
            // instead of just making one.
            //
            // ⚠ THE WINDOW COMES FROM THE RECURRENCE RULE, NOT THE SERVE LOG.
            // Three quiet Sundays still happened; a window built from the dates
            // that appear in the log would skip them and quietly stretch "the
            // last 12 Sundays" over a longer run of calendar than it claims.
            async loadFairness() {
                this.serveHistory = [];
                this.fairnessWindow = [];

                const seriesId = this.occurrence && this.occurrence.seriesId;
                const date = this.occurrence && this.occurrence.date;
                const rule = this.series && (this.series.recurrence
                    || (this.isSundaySeries ? Store.SUNDAY_RULE : null));
                // A one-off Event is not a series, so there is no run of past
                // occurrences to be fair across. Nothing to say, so say nothing.
                if (!seriesId || !date || !rule) return;

                const size = Events.fairnessWindowOf(this.series);
                // Reach back generously and take the last `size` dates before
                // this one — enough calendar for a monthly Event to fill its
                // window, and cheap because it is arithmetic, not a read.
                const from = window.DateUtils.addDays(date, -Math.ceil(size * 31));
                const before = window.DateUtils.addDays(date, -1);
                const past = Core.datesBetween(rule, from, before).reverse();

                this.fairnessWindow = Fairness.windowDates(past, size);
                if (!this.fairnessWindow.length) return;

                const earliest = this.fairnessWindow[this.fairnessWindow.length - 1];
                try {
                    // Constrained by series AND date: the composite index for
                    // exactly this landed with MS-13. Records written before
                    // `seriesId` existed do not match — a Firestore query cannot
                    // apply the read-time fallback — which is what
                    // scripts/backfill-involvement-series.js is for.
                    //
                    // ⚠ The orderBy is load-bearing. That index is
                    // (seriesId ASC, serviceDate DESC); an inequality with no
                    // stated order implies ASCENDING, which the index cannot
                    // serve — so without this line every read fails and the
                    // catch below swallows it, silently.
                    const snap = await db.collectionGroup('involvement')
                        .where('seriesId', '==', seriesId)
                        .where('serviceDate', '>=', earliest)
                        .orderBy('serviceDate', 'desc')
                        .get();
                    this.serveHistory = snap.docs.map(d => {
                        const data = d.data() || {};
                        return {
                            personId: d.ref.parent.parent.id,
                            type: data.type,
                            serviceDate: data.serviceDate,
                            seriesId: Events.seriesIdOf(data),
                            metadata: data.metadata || null,
                        };
                    });
                } catch (e) {
                    // A missing note is a smaller failure than a broken picker,
                    // so this never blocks assigning somebody.
                    console.error('Could not read the serve history:', e);
                }
            },

            // What one turn of this Event is called, so a note can say "3 Sundays
            // ago" rather than "3 occurrences ago".
            get occurrenceUnit() {
                return this.isSundaySeries ? 'Sunday' : 'time';
            },

            // Intensity, resolved across its three homes for a serve record.
            intensityForRecord(record) {
                const oneOffId = record.metadata && record.metadata.oneOffId;
                return Events.roleIntensity(this.series, record.type, {
                    definition: this.roleDefinitions.find(d => d.slug === record.type) || null,
                    oneOff: oneOffId
                        ? ((this.occurrence.oneOffRoles || []).find(j => j.id === oneOffId) || { id: oneOffId })
                        : null,
                });
            },

            // Per person per date, so it is computed once for the occurrence and
            // read by every Role's picker.
            get fairnessLoad() {
                if (!this.fairnessWindow.length) return {};
                return Fairness.loadOf(
                    this.serveHistory, this.fairnessWindow, r => this.intensityForRecord(r)
                );
            },

            // Who may be offered AT ALL — which is a different question from who
            // is eligible. Somebody who has left, or whom this viewer may not see,
            // is not a candidate who lost; they are not a candidate. Showing them
            // blocked would answer a question nobody asked, and for a hidden
            // Person it would print the name the tag exists to hide.
            get assignablePeople() {
                return Roles.assignablePeople(this.people, {
                    rank: this.rank,
                    hidingTags: this.hidingTags,
                });
            },

            // Every candidate, eligible or not, each carrying a subtitle: a
            // reason when blocked, a fairness note when not. Same slot either
            // way, which is also where an auto-assign suggestion will sit later.
            get candidates() {
                const def = this.pickerRole;
                const slot = this.pickerSlot;
                if (!def || !slot) return [];

                // This Role's own seats, and nothing else. `assigned` is what the
                // RELATIONSHIP rules read — "no married couple in Kids" — so
                // anyone in it is treated as being in this Role.
                const mine = a => a.roleSlug === def.slug && !a.oneOffId;
                const seated = this.assignments
                    .filter(mine)
                    .map(a => ({ slotId: a.slotId, personId: a.personId }));

                // Busy elsewhere this morning — which now has a mechanism of its
                // own (ADR-0020) instead of being faked as a seat in this Role.
                //
                // ⚠ The fake seat was a real bug, not just untidy: on a Sunday
                // where Dave preaches it made a notTogether rule block Dave's
                // wife from Kids for being married to someone "already in this
                // Role", and made a sameGroup Role demand everyone share a group
                // with Dave — usually emptying the rota. Liturgy belongs here,
                // where it blocks the person and nobody else.
                //
                // Exclusive is the default, so a Role nobody has configured
                // blocks; liturgical Roles are always exclusive.
                const elsewhere = this.assignments
                    .filter(a => a.personId && !mine(a))
                    .map(a => ({
                        personId: a.personId,
                        roleSlug: a.oneOffId || a.roleSlug,
                        allowsAnotherRole: Roles.allowsAnotherRole(
                            a.oneOffId
                                ? this.oneOffRoles.find(j => j.id === a.oneOffId)
                                : this.roleDefinitions.find(d => d.slug === a.roleSlug)
                        ),
                    }))
                    .concat(this.liturgicalBlocks.map(h => ({
                        personId: h.personId,
                        roleSlug: h.roleSlug,
                        allowsAnotherRole: false,
                    })));

                const judged = Roles.candidatesFor(def, slot, {
                    people: this.assignablePeople,
                    relationships: this.relationships,
                    groups: this.groups,
                    assigned: seated,
                    assignedElsewhere: elsewhere,
                    // Rules about a PAIR of Roles, which belong to the Event
                    // rather than to either Role (MS-221). `elsewhere` above is
                    // already everyone in the other Roles, so this is the only
                    // ingredient the rule needs that the picker did not have.
                    crossRoleRules: this.crossRoleRules,
                    // Who said they would not be here on THIS date (MS-188).
                    // Shown, with their own words, and still placeable — the
                    // editor keeps the final say. It is the solve that treats
                    // this as absolute, not the person reading the screen.
                    awayPersonIds: this.awayPersonIds,
                });

                const q = String(this.picker.query || '').trim().toLowerCase();

                // Recency is per Role, so it is computed once for the whole
                // picker rather than once per candidate.
                const size = this.fairnessWindow.length;
                const recency = size
                    ? Fairness.recencyOf(this.serveHistory, this.fairnessWindow, def.slug)
                    : null;
                const load = this.fairnessLoad;

                return judged
                    .map(c => {
                        const person = this.people.find(p => p.id === c.personId) || {};
                        const otherRoles = this.assignments
                            .filter(a => a.personId === c.personId && a.roleSlug !== def.slug)
                            .map(a => a.label || this.roleName(a.roleSlug))
                            // Named, not just counted. "Already serving here"
                            // alone leaves the editor hunting for where, and
                            // hunting is the thing showing blocked people avoids.
                            .concat(this.liturgicalBlocks
                                .filter(h => h.personId === c.personId)
                                .map(h => this.roleName(h.roleSlug)));
                        return Object.assign({}, c, {
                            name: person.name || 'Someone',
                            subtitle: c.eligible
                                ? View.fairnessNote(c, {
                                    groupName: this.groupNameFor(c.personId),
                                    // Both numbers, never a single score — one
                                    // nobody can decompose is one nobody trusts.
                                    recency: recency
                                        ? Fairness.recencyFor(recency, c.personId, size)
                                        : null,
                                    neverServed: !!recency && recency[c.personId] === undefined,
                                    unit: this.occurrenceUnit,
                                    spent: Fairness.isSpent(load[c.personId] || 0, size),
                                    otherJobs: this.serveHistory.filter(r => (
                                        r.personId === c.personId && r.type !== def.slug
                                    )).length,
                                })
                                : View.blockReason(c, {
                                    people: this.people,
                                    requirement: slot.requirement,
                                    otherRoles: otherRoles,
                                    groupName: this.groupNameFor(c.personId),
                                    awayNote: this.awayNoteFor(c.personId),
                                    // The other half of a cross-Role pair
                                    // (MS-221), so the sentence can name it.
                                    pairedRoleName: c.pairedRoleSlug
                                        ? this.roleName(c.pairedRoleSlug) : '',
                                }),
                        });
                    })
                    .filter(c => !q || c.name.toLowerCase().indexOf(q) !== -1)
                    // Off by DEFAULT. Seeing who was passed over is the feature.
                    .filter(c => !this.picker.hideBlocked || c.eligible);
            },

            get eligibleCount() { return this.candidates.filter(c => c.eligible).length; },
            get blockedCount() { return this.candidates.filter(c => !c.eligible).length; },

            get pickerConsequence() {
                if (!this.picker.picked) return '';
                const person = this.people.find(p => p.id === this.picker.picked);
                const who = (person && person.name) || 'They';

                // Say what it breaks BEFORE the write, not only after. The rule
                // does not refuse (ADR-0021), so this line is the whole of the
                // warning the editor gets while they can still change their mind.
                const chosen = this.candidates.filter(c => c.personId === this.picker.picked)[0];
                if (chosen && !chosen.eligible) {
                    return who + ' breaks a rule here — ' + chosen.subtitle +
                        ' Going ahead is fine; the place will be flagged.';
                }

                return who + ' will go in as Pending until you hear from them.';
            },

            // ── What is wrong with the roster as it stands ────────────────────
            //
            // ADR-0021: eligibility ADVISES. A rule about the roster no longer
            // refuses, because a tool that will not record the rota the church
            // is actually going to run is a tool the rota leaves. What it owes
            // the editor instead is to say so, here and on Auto-assign, from the
            // same pass — which is what stops the two surfaces disagreeing.
            //
            // Derived on every read. Never stored, never dismissed.
            get rosterWarnings() {
                return Roles.warningsFor(this.assignments, {
                    roles: this.roleDefinitions,
                    people: this.people,
                    relationships: this.relationships,
                    groups: this.groups,
                    liturgicalHolders: this.liturgicalBlocks,
                    crossRoleRules: this.crossRoleRules,
                });
            },

            warningAt(roleSlug, slotId) {
                const found = this.rosterWarnings.filter(w => (
                    w.roleSlug === roleSlug && w.slotId === slotId
                ))[0];
                if (!found) return null;
                return {
                    reason: found.reason,
                    text: View.blockReason(found, {
                        people: this.people,
                        requirement: (this.slotAt(roleSlug, slotId) || {}).requirement,
                        otherRoles: found.heldRoleSlug ? [this.roleName(found.heldRoleSlug)] : [],
                        groupName: this.groupNameFor(found.personId),
                        pairedRoleName: found.pairedRoleSlug
                            ? this.roleName(found.pairedRoleSlug) : '',
                    }),
                };
            },

            slotAt(roleSlug, slotId) {
                const def = this.roleDefinitions.find(d => d.slug === roleSlug);
                return ((def && def.slots) || []).find(s => s.id === slotId) || null;
            },

            pick(candidate) {
                // A blocked row is pickable. Placing somebody against a Role's
                // own rules is the editor's call to make (ADR-0021) — the panel
                // says what it breaks, before and after.
                this.picker.picked = candidate.personId;
            },

            async confirmPick() {
                if (!this.picker.picked) return;
                // One write. Assigning a replacement overwrites whatever was in
                // the slot — so a decline clears and the decliner leaves the
                // participant list in the same action.
                this.assignments = Core.assignToSlot(
                    this.assignments,
                    { personId: this.picker.picked, roleSlug: this.picker.roleSlug, slotId: this.picker.slotId },
                    this.actor()
                );
                this.closePicker();
                await this.persist();
            },

            groupNameFor(personId) {
                const g = this.groups.find(group => Roles.inGroup(group, personId));
                return g ? g.name : null;
            },

            roleName(slug) {
                const def = this.roleDefinitions.find(d => d.slug === slug);
                if (def) return def.name;
                const built = Roles.roleBySlug(slug, this.roleDefinitions);
                return (built && built.name) || slug;
            },

            // ── Changing the pattern ─────────────────────────────────────────
            //
            // A question in gold, not an error in red. Nothing is migrated or
            // deleted without the editor's per-date choice.

            async openPattern() {
                if (!this.series) return;
                const rule = Object.assign({}, this.series.recurrence || {});
                // The viewer's OWN rungs, not all five. Asking for a rung this
                // viewer cannot read fails the whole query, and the failure looks
                // exactly like "this series has no dates".
                const snap = await db.collection('event_occurrences')
                    .where('visibility', 'in', Core.visibilityQueryFor(this.rank).rungs)
                    .where('seriesId', '==', this.series.id)
                    .get();
                const stored = await Promise.all(snap.docs.map(async d => {
                    const roster = await d.ref.collection('roster').get();
                    return Object.assign({ id: d.id }, d.data(), { assignments: roster.docs.map(r => r.data()) });
                }));
                this.pattern = { open: true, rule: rule, stored: stored, orphans: [], choices: {} };
            },

            // Recomputed as the editor edits the pattern, so the confrontation
            // is always about the pattern actually being proposed.
            recomputeOrphans() {
                const stored = this.pattern.stored || [];
                if (!stored.length) { this.pattern.orphans = []; return; }
                const dates = stored.map(o => o.date).sort();
                const orphans = Core.orphanedOccurrences(
                    this.pattern.rule, stored, dates[0], dates[dates.length - 1]
                );
                this.pattern.orphans = orphans;
                // Move is the default. Nothing else is pre-decided.
                orphans.forEach(o => {
                    if (!this.pattern.choices[o.date]) this.pattern.choices[o.date] = 'move';
                });
            },

            get patternSentence() { return View.recurrenceSentence(this.pattern.rule || {}); },
            get patternDates() { return View.nextDates(this.pattern.rule || {}, null, 6); },
            get orphanSummary() { return View.orphanSummary(this.pattern.orphans, this.pattern.choices); },
            orphanOutcome(o) { return View.orphanOutcome(o, this.pattern.choices[o.date]); },

            setAllOrphans(choice) {
                this.pattern.orphans.forEach(o => { this.pattern.choices[o.date] = choice; });
            },

            async applyPattern() {
                this.saving = true;
                try {
                    const rule = this.pattern.rule;
                    const stored = this.pattern.stored || [];
                    const dates = stored.map(o => o.date).sort();
                    const free = Core.datesBetween(rule, dates[0] || rule.startDate, dates[dates.length - 1] || rule.startDate)
                        .filter(d => !stored.some(o => o.date === d));

                    await Store.applyOrphanChoices(
                        db, this.series.id, this.pattern.orphans, this.pattern.choices, free
                    );
                    await db.collection('events').doc(this.series.id).update({ recurrence: rule });
                    this.pattern.open = false;
                    await this.load();
                } catch (e) {
                    console.error('Pattern change failed:', e);
                    this.error = 'The pattern could not be changed.';
                } finally {
                    this.saving = false;
                }
            },

            // ── Visibility ───────────────────────────────────────────────────

            get visibilityLadder() { return View.visibilityLadder(); },
            get visibility() { return Core.visibilityOf(this.occurrence); },
            get visibilityEditable() { return Core.isVisibilityEditable(this.occurrence) && this.isEditor; },
            rosterToggleApplies(level) { return View.rosterToggleApplies(level); },

            async setVisibility(level) {
                if (!this.visibilityEditable) return;
                this.saving = true;
                try {
                    if (this.series) {
                        // Restamps EVERY occurrence, past ones included —
                        // otherwise making something private leaves its history
                        // public.
                        await Store.restampSeriesVisibility(
                            db, this.series.id, level, this.occurrence.rosterShared === true,
                            { rank: this.rank }
                        );
                    } else {
                        // A one-off has no series to restamp. This control used
                        // to return early here and do NOTHING — it rendered, it
                        // took the click, and the Event stayed exactly as visible
                        // as it had been.
                        await Store.saveOccurrenceDetails(db, this.occurrence.id, {
                            visibility: level,
                            rosterShared: this.occurrence.rosterShared === true,
                        });
                    }
                    this.occurrence.visibility = level;
                } catch (e) {
                    console.error('Visibility change failed:', e);
                    this.error = e.message || 'The visibility could not be changed.';
                } finally {
                    this.saving = false;
                }
            },

            async setRosterShared(shared) {
                if (!this.visibilityEditable) return;
                if (this.series) {
                    await Store.restampSeriesVisibility(
                        db, this.series.id, this.visibility, shared, { rank: this.rank }
                    );
                } else {
                    await Store.saveOccurrenceDetails(db, this.occurrence.id, {
                        visibility: this.visibility, rosterShared: shared === true,
                    });
                }
                this.occurrence.rosterShared = shared;
            },

            async setNeedsNameTags(value) {
                if (!this.isEditor || !this.occurrence) return;
                const on = value === true;
                await Store.setNeedsNameTags(db, {
                    occurrenceId: this.occurrence.id,
                    seriesId: this.occurrence.seriesId || (this.series && this.series.id) || null,
                    value: on,
                });
                this.occurrence.needsNameTags = on;
                if (this.series) this.series.needsNameTags = on;
            },

            // ── Editing a one-off Event ──────────────────────────────────────
            //
            // A one-off has no series, so everything true of it is true of this
            // one occurrence — including its date, which can simply be changed,
            // because a one-off's id is an auto-id rather than the date. (One
            // date OF A SERIES is a different operation: see "Move this one".)
            //
            // It was creatable and then frozen. Wrong time, wrong hall, wrong
            // name, and no way back to any of it.

            occurrenceDraft: { name: '', date: '', endDate: '', time: '', location: '', description: '' },

            get isOneOff() { return !!this.occurrence && !this.occurrence.seriesId; },

            startOccurrenceDraft() {
                const o = this.occurrence || {};
                this.occurrenceDraft = {
                    name: o.name || '',
                    date: o.date || '',
                    endDate: o.endDate || '',
                    time: o.time || '',
                    location: o.location || '',
                    description: o.description || '',
                };
            },

            // WHICH FIELDS THIS DATE ACTUALLY OWNS.
            //
            // A one-off's occurrence IS the whole Event, so the panel edits all
            // of it. ONE DATE OF A SERIES owns its description and nothing else
            // (MS-288): the name, place and time are true of every date and are
            // typed once on the Event, and the date itself the store refuses
            // outright — its id is derived from it, so sending one back would
            // throw "use Move this one" every time somebody saved a note.
            get occurrenceOwnFields() {
                return this.isDateOfSeries
                    ? ['description']
                    : ['name', 'date', 'endDate', 'time', 'location', 'description'];
            },

            // NOT `!isOneOff`. Nothing loaded yet is neither, and answering
            // "date of a series" for an empty page would hand it the wrong
            // rules before it knows what it is showing.
            get isDateOfSeries() { return !!(this.occurrence && this.occurrence.seriesId); },

            get occurrenceDetailsChanged() {
                const o = this.occurrence || {};
                // Trimmed on both sides, because the store trims before it
                // writes. Three spaces typed into an empty box is not a change,
                // and treating it as one would write a whole document — stamp,
                // date and all — to store a description of null.
                return this.occurrenceOwnFields.some(
                    f => String(this.occurrenceDraft[f] || '').trim() !== String(o[f] || '').trim()
                );
            },

            get occurrenceDetailsValid() {
                // A date of a series has no name or date of its own to be
                // missing — it borrows both from the Event.
                if (this.isDateOfSeries) return true;
                return !!String(this.occurrenceDraft.name || '').trim()
                    && !!this.occurrenceDraft.date
                    && !this.occurrenceSpanError;
            },

            // Same check the create form runs, against the draft being edited.
            get occurrenceSpanError() {
                return Core.spanError({
                    date: this.occurrenceDraft.date,
                    endDate: this.occurrenceDraft.endDate,
                }) || '';
            },

            get occurrenceSpanSentence() {
                return View.spanSentence({
                    date: this.occurrenceDraft.date,
                    endDate: this.occurrenceDraft.endDate,
                });
            },

            async saveOccurrenceDetails() {
                if (!this.occurrenceDetailsValid || !this.occurrenceDetailsChanged || this.saving) return;
                this.saving = true;
                this.error = '';
                try {
                    // Only what this date owns. A patch carrying fields the
                    // panel never showed is how a screen clears something it
                    // does not know about.
                    const patch = {};
                    this.occurrenceOwnFields.forEach(f => { patch[f] = this.occurrenceDraft[f]; });

                    const saved = await Store.saveOccurrenceDetails(
                        db, this.occurrence.id, patch
                    );
                    Object.keys(saved).forEach(f => { this.occurrence[f] = saved[f]; });
                    this.startOccurrenceDraft();
                } catch (e) {
                    console.error('Event details failed:', e);
                    this.error = (e && e.message) || 'Those details could not be saved.';
                } finally {
                    this.saving = false;
                }
            },

            // ── "Did they serve?" ────────────────────────────────────────────
            //
            // Scaffolding — it disappears once members can confirm for
            // themselves — so it is one row, and nothing when there is nothing
            // to ask.

            get unconfirmedPrompt() {
                if (!this.isPast || !this.isEditor) return null;
                return View.unconfirmedPrompt({ assignments: this.assignments });
            },

            get openQuestions() {
                return Core.conversion({ assignments: this.assignments }).questions
                    .map(q => Object.assign({}, q, { name: this.personName(q.personId) }));
            },

            openTidyUp() {
                this.tidyUp = { open: true, ticks: {} };
            },

            get tidyUpSummary() { return View.serveTickSummary(this.openQuestions, this.tidyUp.ticks); },

            tickAll(on) {
                const ticks = {};
                if (on) this.openQuestions.forEach(q => { ticks[q.personId] = true; });
                this.tidyUp.ticks = ticks;
            },

            // Ticking writes the serve record. Whatever is left stays
            // unanswered, permanently, and never counts.
            async saveTidyUp() {
                this.saving = true;
                try {
                    const batch = db.batch();
                    let wrote = 0;
                    this.openQuestions.forEach(q => {
                        if (!this.tidyUp.ticks[q.personId]) return;
                        const record = Core.serveRecordFor(this.occurrence, q.assignment);
                        // The same deterministic id the scheduled job uses, so
                        // answering twice writes one record rather than two.
                        batch.set(
                            db.collection('people').doc(record.personId)
                                .collection('involvement').doc(record.involvementId),
                            {
                                serviceDate: record.serviceDate,
                                type: record.type,
                                seriesId: record.seriesId,
                                metadata: record.metadata || null,
                                resolvedBy: this.uid,
                            },
                            { merge: true }
                        );
                        wrote++;
                    });
                    if (wrote) await batch.commit();
                    this.tidyUp.open = false;
                } catch (e) {
                    console.error('Resolving failed:', e);
                    this.error = 'Those answers could not be saved.';
                } finally {
                    this.saving = false;
                }
            },

            // ── Display passthroughs ─────────────────────────────────────────

            initials(name) { return View.initials(name); },
            formatTime(t) { return View.formatTime(t); },

            // Attendance, in the order a person reads a list of names. The row
            // carries its own name and time so the shared panel stays dumb.
            get attendanceRows() {
                return (this.attendance || []).map(row => ({
                    personId: row.personId,
                    name: this.personName(row.personId),
                    pickupCode: row.pickupCode || '',
                    markedAtLabel: this.markedAtLabel(row.markedAt),
                })).sort((a, b) => a.name.localeCompare(b.name));
            },
            // The clock time they were marked. The date is the Event's own, so
            // repeating it on every row would say nothing.
            markedAtLabel(markedAt) {
                if (!markedAt) return '';
                const at = new Date(markedAt);
                if (isNaN(at.getTime())) return '';
                return at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
            },
            stateLabel(a) { return Core.stateLabel(a); },
            stateTone(a) { return Core.stateTone(a); },
            visibilityLabel(l) { return View.visibilityLabel(l); },
            visibilityIcon(l) { return View.visibilityIcon(l); },
            visibilityWho(l) { return View.visibilityWho(l); },
            recurrenceSentence(r) { return View.recurrenceSentence(r); },

            personName(personId) {
                const p = this.people.find(x => x.id === personId);
                return (p && p.name) || 'Someone';
            },

            // A person's avatar contents: their Directory Photo when they have
            // one, their initials otherwise (ADR-0029). `fallbackName` is for the
            // one caller that already holds a name and no reliable id.
            avatarInner(personId, fallbackName) {
                const person = personId && this.people.find(x => x.id === personId);
                if (person && person.photoUrl) {
                    const url = String(person.photoUrl).replace(/"/g, '&quot;');
                    return `<img src="${url}" alt="" style="width:100%;height:100%;` +
                        `${PersonPhotoCore.frameStyle(person.photoCrop)}">`;
                }
                const name = (person && person.name) || fallbackName || this.personName(personId);
                return PersonPhotoCore.initialsOf(name)
                    .replace(/&/g, '&amp;').replace(/</g, '&lt;');
            },

            longDate(dateStr) {
                return dateStr ? window.DateUtils.formatDateLong(dateStr, 'en-GB') : '';
            },

            // Straight to the Order of Service editor for this exact date — the
            // Sunday's own surface, and the one that keeps the printed booklet
            // safe by staying separate from the Event model.
            get servicesHref() {
                return 'service-builder.html?date=' +
                    encodeURIComponent(this.occurrence ? this.occurrence.date : '');
            },
        };
    };
})();
