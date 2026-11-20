// Recurring Events — every repeating Event, and what its rota actually looks
// like across the next stretch of dates.
//
// The Calendar used to carry a single button marked "Sunday Service", which was
// the only door to the one series anybody had. It is not the only series any
// more, and a button per Event does not scale past two. So this is the room the
// series live in: pick one, read its rota as a grid, and change the event
// itself without going anywhere.
//
// ONE SCREEN, NOT TWO (MS-229). The event's own record — its pattern, time,
// place, colour, who may see it, and which Roles it carries every date — used
// to be a second page at `calendar-event.html?series=…`, reached by a link that
// left this one. So changing the Sunday's start time meant losing sight of the
// Sunday's rota, and coming back meant finding the event in the list again.
// They are tabs of one pane now:
//
//   DATES              upcoming occurrences as cards, one per date — EVERYONE'S
//   THE EVENT          name, time, place, pattern, colour — EVERYONE'S, read-only
//                      for a member, editable for an editor
//   ROTA               the grid, and the dates you tick on it — editor-only
//   ROLES & RULES      which Roles it carries, and the rules across two — editor-only
//   WHO CAN SEE IT     the five rungs, and whether the roster is shared — editor-only
//
// Two doors still lead off it, both editor-only —
//
//   the DRAFT ROOM        redraw the dates you ticked (auto-assign.html)
//   one DATE              who is on that one, and change a single person
//
// Almost read-only, deliberately. Everything on this grid already has a screen
// that owns it, and a fourth surface that half-edits a roster is how two of them
// start disagreeing about the same Sunday.
//
// The one exception is EMPTYING the ticked dates. It earns its place because it
// is the only change that reads across a run rather than down a single date, and
// because the alternative was drafting a rota through auto-assign purely in
// order to throw the result away. It cannot half-edit anything: it takes
// everybody off, or it does nothing.
//
// ONE PANE, TWO ROLES (MS-287, was two lanes drawing two panes).
//
// A member and an editor now open the SAME tabbed pane — the fork used to be
// two lanes at the top of this file, an editor's four-tab pane and a member's
// separate flat "Coming up" list that said the same thing the editor's own
// "next few" card said, on a different screen. `tabs` filters by role instead:
// a member gets Dates and a read-only Event; an editor gets those two plus
// Rota, Roles & rules and Who can see it. Both land on Dates by default —
// "what's next" needs no grid read first.
//
// Each role still only ever sees the events its own rank may see — the series
// read is constrained by visibility like every other, so a member's list simply
// does not contain the elders' meeting.

(function () {
    'use strict';

    const Core = window.EventsOccurrenceCore;
    // The SERIES model, which is a different module from the occurrence one
    // above. Cross-Role Rules belong to a series (MS-221).
    const Series = window.EventsCore;
    const Store = window.EventsStore;
    const View = window.CalendarView;
    const Roles = window.RolesCore;
    const Grid = window.RecurringRosterCore;
    const RoleRules = window.RoleRulesCore;
    const Dates = window.DateUtils;


    // How much calendar to compute dates across. Arithmetic, not a read, so it
    // costs nothing — but it is bounded, because "every date this series has
    // ever had" grows without limit and the answer nobody needs is the one from
    // three years ago.
    const REACH_BACK_DAYS = 366;
    const REACH_ON_DAYS = 550;

    // Dates across at once. Eight is the draft room's middle preset, and the
    // same number means the same thing on both screens.
    const WINDOW = 8;

    window.recurringEventsPage = function recurringEventsPage() {
        return Object.assign({
            loading: true,
            error: '',
            rank: null,
            personId: null,

            series: [],
            seriesId: '',

            people: [],
            // The Roles as stored; read them through `roleDefinitions`, which is
            // the open Event's version of each (EventsCore.effectiveRole).
            /** @type {Array<Record<string, *>>} */
            storedRoleDefinitions: [],

            // date → the occurrence document, with its roster attached. Sparse:
            // a date nobody has touched is simply absent, which is the answer
            // rather than a gap in the data (ADR-0018 §3).
            occurrences: {},

            // Every date the rule produces across the reach, and the slice of it
            // on screen. Paging moves the anchor, never the reach.
            allDates: [],
            anchor: '',
            windowSize: WINDOW,

            selected: [],
            gridLoading: false,
            clearing: false,

            // ── Dates (MS-287) ───────────────────────────────────────────────
            //
            // date → occurrence, for the fixed "today forward" window the
            // Dates tab reads. Deliberately its OWN cache, separate from
            // `occurrences` above — that one moves with the Rota tab's own
            // paging (`anchor`), and the Dates tab must not move with it.
            upcomingOccurrences: {},
            upcomingLoading: false,

            // ── The pane (MS-229) ────────────────────────────────────────────
            //
            // Everything about the chosen series used to be a second page at
            // `calendar-event.html?series=…`, so changing a Sunday's start time
            // meant losing sight of the Sunday's rota. It is tabs of one pane
            // now, and the tab survives changing series: an editor comparing
            // who can see what across three events should not have to find
            // that tab again for each of them.
            tab: 'dates',

            // The phone is TWO SCREENS, not two columns: at 390px a 320px panel
            // beside anything is a panel and nothing else. So the list is a
            // screen, the event you picked replaces it, and the shell's arrow
            // comes back here before it leaves the page.
            phonePane: false,

            // Writes from the pane. The rota's own write (`clearing`) is
            // separate on purpose — one of them empties a run of dates and the
            // other saves a name, and a single flag would grey out both.
            saving: false,

            // Details are held in a draft rather than written per keystroke: a
            // name is half-typed for most of the time somebody is typing it.
            seriesDraft: { name: '', location: '', description: '' },

            // Printables linked to this series. The link is true of every
            // date, so it lives here rather than on one Sunday's files.
            linkedPrintables: [],
            linkingPrintable: false,
            libraryLoading: false,
            libraryPrintables: [],
            libraryFolders: [],
            printableError: '',

            // Changing the pattern, and the confrontation it raises over dates
            // that already have people on them.
            pattern: { open: false, rule: null, stored: [], orphans: [], choices: {} },

            // Taking a Role off the EVENT drops everybody in it on EVERY date,
            // so it asks first — and only when there is somebody to lose.
            pendingRemoval: null,

            // ── Cross-Role Rules (MS-221) ────────────────────────────────────
            //
            // Rules about a PAIR of Roles — "the Kids Leader and the Kids Helper
            // must not be married to each other". They belong to neither Role,
            // so they belong to the Event that runs both, which is this page.
            sharedGroupTypes: [],
            // Person-to-person types an elder has shared ("cannot serve
            // together if..."), for the team rules.
            /** @type {Array<Record<string, *>>} */
            sharedPairwiseTypes: [],
            groupTypesDenied: false,
            // The tags a rule can name, as this viewer may see them.
            /** @type {Array<{ id: string, name: string }>} */
            ruleTags: [],

            // ── The Roles & rules table ──────────────────────────────────────
            // Which Role row is open, and the form behind each row
            // (RoleRulesCore). Keyed by series and Role, so switching events
            // never shows one Event's rules under another's name.
            /** @type {?string} */
            openRole: null,
            /** @type {Record<string, *>} */
            roleForms: {},
            /** @type {Array<*>} */
            crossForms: [],
            /** @type {?string} */
            crossFormsFor: null,
            savingRole: '',
            /** @type {*} */
            nonServingOpts: null,
            /** @type {Record<string, boolean>} */
            saveAgain: {},
            savingCross: false,
            crossAgain: false,

            // ── Loading ──────────────────────────────────────────────────────

            async init() {
                this.rank = await this.resolveRank();
                if (!this.rank) { this.loading = false; return; }

                // Everyone lands on Dates — an editor's old default was Rota,
                // but Dates is the tab both roles share and the one that
                // answers "what's next" without a grid to read first.
                this.tab = 'dates';
                const askedTab = new URLSearchParams(window.location.search).get('tab');
                if (askedTab === 'announcements' || askedTab === 'printables') this.tab = askedTab;

                try {
                    // The directory is the GRID's ingredient — names for the
                    // cards, definitions for the rows — and the browse lane draws
                    // neither. Reading the whole church to list some dates would
                    // be a page-load spent on nothing.
                    await Promise.all([
                        this.loadSeries(),
                        this.editorLanes ? this.loadDirectory() : Promise.resolve(),
                    ]);
                } catch (e) {
                    console.error('Could not read the recurring events:', e);
                    this.error = 'The recurring events could not be read. That is a permissions '
                        + 'problem rather than an empty church — please tell an admin.';
                    this.loading = false;
                    return;
                }

                // Opened for a particular series — which is how the Event page
                // sends you back here, so you land on the one you just left.
                const asked = new URLSearchParams(window.location.search).get('series');
                const named = this.series.some(s => s.id === asked) ? asked : '';

                // BOTH lanes open on something now. The pane sits beside the
                // list rather than under a row (MS-229), and an empty right-hand
                // half beside five events teaches nobody anything — it reads as
                // a panel that failed to load. There is no "nothing selected".
                const opening = named || (this.series[0] && this.series[0].id) || '';

                // Arriving at a named series means arriving AT it, so the phone
                // opens on the pane. Arriving at the page means the list.
                this.phonePane = !!named;

                this.loading = false;
                if (opening) await this.choose(opening);

                // The Roles page sends you here to change who a Role needs, its
                // rules or its rest — so arrive on that tab with its row open.
                const params = new URLSearchParams(window.location.search);
                const role = params.get('role');
                if (this.editorLanes && (role || params.get('tab') === 'roles')) {
                    this.tab = 'roles';
                    this.buildRoleForms();
                    if (role && this.tableRoles.indexOf(role) !== -1) this.openRole = role;
                }

                // The shell's arrow has to mean "out of this event" before it
                // means "out of this page" — only the page knows which of the
                // two screens is showing.
                document.addEventListener('mobile-header:back', () => {
                    if (this.phonePane) { this.phonePane = false; return; }
                    window.location.href = 'calendar.html';
                });
            },

            resolveRank() {
                return new Promise(resolve => {
                    auth.onAuthStateChanged(async user => {
                        if (!user) return resolve(null);
                        try {
                            const data = await getUserData(user.uid);
                            this.account = data || null;
                            this.personId = (data && data.personId) || null;
                            resolve((window.AccessCore ? AccessCore.permissionLevelOf(data) : 'viewer'));
                        } catch (e) {
                            this.personId = null;
                            resolve('viewer');
                        }
                    });
                });
            },

            // Only a SERIES belongs here. A one-off Event has no pattern to show
            // and no run of dates to lay out — it is one date, and the Calendar
            // is where you meet it.
            async loadSeries() {
                const all = await Store.loadVisibleSeries(db, {
                    rank: this.rank, personId: this.personId,
                });
                this.series = all
                    .filter(s => s && (s.recurrence || s.id === Core.SUNDAY_SERVICE_ID))
                    .sort((a, b) => {
                        // The Sunday Service first, always. It is the one every
                        // week turns on, and alphabetical order buries it under
                        // whatever somebody called their coffee morning.
                        if (a.id === Core.SUNDAY_SERVICE_ID) return -1;
                        if (b.id === Core.SUNDAY_SERVICE_ID) return 1;
                        return String(a.name || '').localeCompare(String(b.name || ''));
                    });
            },

            // Names for the cards, and the Role definitions the grid's rows are
            // built from. Both are needed before a single cell can be drawn, so
            // they load with the series rather than per selection.
            async loadDirectory() {
                const [people, roles] = await Promise.all([
                    db.collection('people').get(),
                    db.collection('roles').get(),
                ]);
                this.people = people.docs.map(d => Object.assign({ id: d.id }, d.data()));
                this.storedRoleDefinitions = roles.docs.map(d => Object.assign({ id: d.id }, d.data()));
                await Promise.all([this.loadGroupTypes(), this.loadRuleTags()]);
                if (window.NonServing) this.nonServingOpts = await window.NonServing.load(db);
            },

            // The tags a rule can name. /people_tags is readable by everyone;
            // hiding some from this viewer is the app's job (RolesCore.visibleTags),
            // the same as on the Roles Manager.
            async loadRuleTags() {
                try {
                    const snap = await db.collection('people_tags').orderBy('name', 'asc').get();
                    const all = snap.docs.map(d => ({
                        id: d.id,
                        name: d.data().name || d.id,
                        hiddenFromOthers: d.data().hiddenFromOthers === true,
                    }));
                    this.ruleTags = Roles.visibleTags(all, this.account || this.rank)
                        .map(t => ({ id: t.id, name: t.name }));
                } catch (e) {
                    console.error('Could not read the tags:', e);
                    this.ruleTags = [];
                }
            },

            // The Group Types a Cross-Role Rule can be written against (MS-221).
            //
            // ⚠ The query MUST carry `where('sharedWithEditors', '==', true)` —
            // the same trap the Roles Manager documents at the top of its file.
            // Firestore evaluates read rules per returned document and fails the
            // WHOLE query if one would fail, so an unconstrained query does not
            // return fewer rows, it errors, and the error looks exactly like
            // "this church has no relationship types".
            async loadGroupTypes() {
                try {
                    const snap = await db.collection('relationship_types')
                        .where('sharedWithEditors', '==', true)
                        .get();
                    const shared = snap.docs
                        .map(d => Object.assign({ id: d.id }, d.data()))
                        .filter(t => t.sharedWithEditors === true);
                    this.sharedGroupTypes = shared.filter(t => t.kind === 'group');
                    this.sharedPairwiseTypes = shared.filter(t => t.kind === 'pairwise');
                } catch (e) {
                    console.error('Could not read the relationship types:', e);
                    this.sharedGroupTypes = [];
                    this.sharedPairwiseTypes = [];
                    this.groupTypesDenied = true;
                }
            },

            // ── Who is looking ───────────────────────────────────────────────

            // MS-721 (ADR 0081): the page's writes are the Event's — series,
            // dates and their rosters, all behind editsWith('calendar.events.edit')
            // in firestore.rules — so editor mode asks AccessCore.canEditEvents,
            // the same key the rule names (lead call: a Member level holding
            // only calendar.events.edit is offered editing).
            get isEditor() {
                if (!this.rank) return false;
                return AccessCore.canEditEvents(this.account || this.rank);
            },
            // The lanes that also need the editor READS (the directory, the
            // rota grid, roles & rules, who can see it) stay on the ladder too.
            get editorLanes() {
                if (!this.isEditor) return false;
                return AccessCore.readsAsEditor(this.account || this.rank);
            },
            get canEditPrintables() {
                return !!this.rank && AccessCore.hasPermission(this.account || this.rank, 'printables.edit');
            },
            get signedOut() { return !this.loading && !this.rank; },

            // Signed in, no rank to change anything. Not a refusal — the list is
            // the same list, minus every control that writes.
            get browsing() { return !this.loading && !!this.rank && !this.isEditor; },

            get signInHref() {
                return window.MOSAIC_SHELL === 'mobile' ? 'mobile.html#/login' : 'login.html';
            },

            // ── The chosen series ────────────────────────────────────────────

            get chosen() {
                return this.series.filter(s => s.id === this.seriesId)[0] || null;
            },

            get rule() {
                const s = this.chosen;
                if (!s) return null;
                return s.recurrence || (s.id === Core.SUNDAY_SERVICE_ID ? Store.SUNDAY_RULE : null);
            },

            get isSundaySeries() {
                return this.seriesId === Core.SUNDAY_SERVICE_ID;
            },

            // Choosing a series starts its window at today, not wherever the
            // last one was left. The dates of two series line up only by
            // accident, and inheriting a scroll position across them shows a
            // stretch nobody asked for.
            async choose(id) {
                if (this.gridLoading) return;
                this.seriesId = id;
                this.selected = [];
                this.anchor = Dates.todayStr();
                // The draft belongs to the series it was taken from. Left
                // alone, switching events would show one event's half-typed
                // name over another event's record and offer to save it there.
                this.startSeriesDraft();
                this.recomputeDates();
                this.openRole = null;
                this.buildRoleForms();
                // The Rota's own grid is an editor-only read (MS-287) — a
                // member never opens that tab, so there is nothing there for
                // them to wait on. The Dates tab is everyone's, and reads its
                // own fixed window regardless of role.
                await Promise.all([
                    this.editorLanes ? this.loadWindow() : Promise.resolve(),
                    this.loadUpcomingWindow(),
                ]);

                // Opening the Sunday Service is also the moment it gets
                // repaired if it has drifted, or created if it never existed.
                // Safe to run every time: it writes only when something is
                // actually wrong. It used to happen on the way into the second
                // page, which no longer exists.
                if (this.editorLanes && id === Core.SUNDAY_SERVICE_ID) await this.reconcileSunday();
                await this.loadAnnouncements();
                await this.loadLinkedPrintables();
            },

            async loadLinkedPrintables() {
                this.printableError = '';
                if (typeof PrintableStore === 'undefined') { this.linkedPrintables = []; return; }
                const ids = (this.chosen && Array.isArray(this.chosen.printables)) ? this.chosen.printables : [];
                if (!ids.length) { this.linkedPrintables = []; return; }
                try {
                    this.linkedPrintables = await PrintableStore.loadLinked(db, ids);
                } catch (e) {
                    this.linkedPrintables = [];
                    this.printableError = 'The linked printables could not be read.';
                }
            },

            async startLinkPrintable() {
                if (!this.isEditor || !this.chosen) return;
                this.linkingPrintable = true;
                this.libraryLoading = true;
                this.printableError = '';
                try {
                    const [printables, folders] = await Promise.all([
                        PrintableStore.listPrintables(db),
                        PrintableStore.listFolders(db).catch(() => []),
                    ]);
                    this.libraryPrintables = printables;
                    this.libraryFolders = folders;
                } catch (e) {
                    this.printableError = 'The library did not load. Try again.';
                    this.linkingPrintable = false;
                } finally {
                    this.libraryLoading = false;
                }
            },

            printablePath(p) {
                const crumbs = FilingCore.breadcrumbFor(this.libraryFolders, p && p.folderId);
                return crumbs.length ? crumbs.map(c => c.name).join(' / ') : 'Printables';
            },

            get linkablePrintables() {
                const linked = new Set((this.linkedPrintables || []).map(p => p.id));
                return (this.libraryPrintables || []).filter(p => p.template && !linked.has(p.id));
            },

            printableOpenHref(p) {
                const page = this.canEditPrintables ? 'printable-editor.html?id=' : 'printable-view.html?id=';
                return page + encodeURIComponent(p.id);
            },

            async linkSeriesPrintable(p) {
                if (!this.isEditor || !this.chosen || !p) return;
                const ids = PrintableCore.linkPrintable(this.chosen.printables || [], p.id);
                try {
                    await PrintableStore.linkToSeries(db, this.chosen.id, ids);
                    this.patchSeries({ printables: ids });
                    this.linkingPrintable = false;
                    await this.loadLinkedPrintables();
                } catch (e) {
                    this.printableError = 'That link did not save. Try again.';
                }
            },

            async unlinkSeriesPrintable(p) {
                if (!this.isEditor || !this.chosen || !p) return;
                const ids = PrintableCore.unlinkPrintable(this.chosen.printables || [], p.id);
                try {
                    await PrintableStore.linkToSeries(db, this.chosen.id, ids);
                    this.patchSeries({ printables: ids });
                    this.linkedPrintables = this.linkedPrintables.filter(x => x.id !== p.id);
                } catch (e) {
                    this.printableError = 'That change did not save. Try again.';
                }
            },

            async setSeriesPrintableMembers(p, on) {
                if (!this.canEditPrintables || !p) return;
                try {
                    await PrintableStore.setMemberVisible(db, firebase, firebase.auth().currentUser, p.id, on);
                    p.memberVisible = on === true;
                } catch (e) {
                    this.printableError = 'That change did not save. Try again.';
                }
            },

            // Never fatal. A church whose Sunday drifted still gets to read the
            // rota, and a repair that cannot be written is an admin's problem
            // rather than a reason to show nothing.
            async reconcileSunday() {
                try {
                    const made = await Store.ensureSundayService(db, Roles.LITURGICAL_SLUGS);
                    if (made && made.series) this.replaceSeries(made.series);
                    this.startSeriesDraft();
                } catch (e) {
                    console.error('Could not reconcile the Sunday Service:', e);
                }
            },

            // One writer for the list, so the row on the left and the pane on
            // the right can never be two different readings of one event.
            replaceSeries(next) {
                if (!next || !next.id) return;
                this.series = this.series.map(s => (
                    s.id === next.id ? Object.assign({}, s, next) : s
                ));
            },

            // A field of the chosen series, changed and written back through
            // `replaceSeries` so nothing mutates a row in place.
            patchSeries(fields) {
                const s = this.chosen;
                if (!s) return;
                this.replaceSeries(Object.assign({ id: s.id }, fields));
            },

            // Picking one from the list. `choose` is the load; this is the
            // gesture, and on a phone it is also a navigation — the pane is a
            // screen there rather than a column, so picking a row means going
            // into it.
            async pickSeries(id) {
                if (this.gridLoading) return;
                this.phonePane = true;
                await this.choose(id);
            },

            // The sides of one event. Held here rather than in the markup so
            // the tab bar and the panels under it cannot come to disagree
            // about how many there are — and, since MS-287, so the two lanes
            // sharing one pane cannot come to disagree about which of them a
            // member may open. Rota, Roles & rules and Who can see it stay
            // editor-only; Dates and The event are everyone's.
            get tabs() {
                const all = [
                    { id: 'dates', label: 'Dates', editorOnly: false },
                    { id: 'event', label: 'The event', editorOnly: false },
                    { id: 'printables', label: 'Printables', editorOnly: false },
                    { id: 'announcements', label: 'Announcements', editorOnly: false },
                    { id: 'rota', label: 'Rota', editorOnly: true },
                    { id: 'roles', label: 'Roles & rules', editorOnly: true },
                    { id: 'who', label: 'Who can see it', editorOnly: true },
                ];
                return this.editorLanes ? all : all.filter(t => !t.editorOnly);
            },

            // The rung the pane's badge says, in the ladder's own words.
            get visibilityRung() {
                const level = this.seriesVisibility;
                return this.visibilityLadder.find(r => r.level === level)
                    || { level: level, label: 'Not set', icon: 'lock' };
            },

            // When it next falls, and which of those dates are yours. Fixed to
            // "today forward" (`upcomingDates`), not the Rota tab's own paged
            // window — the Dates tab must read the same stretch whichever tab
            // an editor last paged the grid to.
            get upcoming() {
                if (!this.chosen) return [];
                return Grid.upcoming({
                    dates: this.upcomingDates,
                    from: Dates.todayStr(),
                    personId: this.personId,
                    occurrenceAt: date => this.upcomingOccurrences[date] || null,
                });
            },

            // A pattern that has run out. Said in words, because a row that opens
            // onto nothing looks like a read that failed.
            get finished() {
                return !!this.chosen && !this.upcomingLoading && !this.upcoming.length;
            },

            // ── The Dates tab (MS-287) ────────────────────────────────────────
            //
            // The same WINDOW the Rota tab pages in, but anchored to today and
            // never moved — the scope this tab promises is "upcoming dates
            // only, no earlier/later paging", which the Rota tab's own anchor
            // cannot be trusted to hold once an editor has paged it elsewhere.
            get upcomingDates() {
                const today = Dates.todayStr();
                return this.allDates.filter(d => d >= today).slice(0, WINDOW);
            },

            async loadUpcomingWindow() {
                const dates = this.upcomingDates;
                if (!dates.length) { this.upcomingOccurrences = {}; return; }

                this.upcomingLoading = true;
                try {
                    this.upcomingOccurrences = await Store.loadSeriesWindow(db, this.seriesId, {
                        rank: this.rank,
                        personId: this.personId,
                        from: dates[0],
                        to: dates[dates.length - 1],
                    });
                } catch (e) {
                    console.error('Could not read the upcoming dates:', e);
                    this.upcomingOccurrences = {};
                    this.error = 'The upcoming dates could not be read.';
                } finally {
                    this.upcomingLoading = false;
                }
            },

            recomputeDates() {
                const rule = this.rule;
                if (!rule) { this.allDates = []; return; }
                const today = Dates.todayStr();
                this.allDates = Core.datesBetween(
                    rule,
                    Dates.addDays(today, -REACH_BACK_DAYS),
                    Dates.addDays(today, REACH_ON_DAYS)
                );
            },

            get dates() {
                return Grid.windowOf(this.allDates, this.anchor, this.windowSize);
            },

            // ── Reading what is on those dates ───────────────────────────────

            async loadWindow() {
                const dates = this.dates;
                if (!dates.length) { this.occurrences = {}; return; }

                this.gridLoading = true;
                this.error = '';
                try {
                    this.occurrences = await Store.loadSeriesWindow(db, this.seriesId, {
                        rank: this.rank,
                        personId: this.personId,
                        from: dates[0],
                        to: dates[dates.length - 1],
                    });
                } catch (e) {
                    console.error('Could not read this rota:', e);
                    // The dates are still real and still worth drawing — the
                    // grid degrades to empty columns rather than to nothing,
                    // and says which part failed.
                    this.occurrences = {};
                    this.error = 'The rota for these dates could not be read. The dates are right; '
                        + 'who is on them is missing.';
                } finally {
                    this.gridLoading = false;
                }
            },

            // ── Paging ───────────────────────────────────────────────────────

            get hasEarlier() {
                return Grid.previousAnchor(this.allDates, this.anchor, this.windowSize) !== null;
            },

            get hasLater() {
                return Grid.nextAnchor(this.allDates, this.anchor, this.windowSize) !== null;
            },

            async earlier() {
                const at = Grid.previousAnchor(this.allDates, this.anchor, this.windowSize);
                if (at === null) return;
                this.anchor = at;
                await this.loadWindow();
            },

            async later() {
                const at = Grid.nextAnchor(this.allDates, this.anchor, this.windowSize);
                if (at === null) return;
                this.anchor = at;
                await this.loadWindow();
            },

            async backToToday() {
                this.anchor = Dates.todayStr();
                await this.loadWindow();
            },

            // ── The grid ─────────────────────────────────────────────────────

            // The Roles this series carries, minus the liturgical ones. Those
            // are not in the roster at all — they are fields on the Service
            // document, filled in the order of service — so a row for them here
            // would sit empty and read as "nobody is preaching".
            // Who a Role needs, its rules and its rest belong to the Event that
            // runs it, so this page reads the open Event's version of each.
            get roleDefinitions() {
                return Series.rolesFor(this.chosen, this.storedRoleDefinitions);
            },
            // Setting the list sets the Roles as stored.
            set roleDefinitions(defs) {
                this.storedRoleDefinitions = defs || [];
            },

            get gridRoles() {
                const slugs = ((this.chosen && this.chosen.roleSlugs) || [])
                    .filter(slug => Roles.LITURGICAL_SLUGS.indexOf(slug) === -1);
                return slugs
                    .map(slug => this.roleDefinitions.find(d => d.slug === slug))
                    .filter(Boolean)
                    .map(def => ({
                        slug: def.slug,
                        name: def.name || def.slug,
                        slots: def.slots || [],
                    }));
            },

            get hasLiturgy() {
                return ((this.chosen && this.chosen.roleSlugs) || [])
                    .some(slug => Roles.LITURGICAL_SLUGS.indexOf(slug) !== -1);
            },

            get grid() {
                if (!this.chosen) return null;
                return Grid.rosterGrid({
                    dates: this.dates,
                    roles: this.gridRoles,
                    nameOf: id => this.personName(id),
                    cancelledAt: date => !!(this.occurrences[date] || {}).cancelled,
                    oneOffsAt: date => (this.occurrences[date] || {}).oneOffRoles || [],
                    assignmentsAt: date => (this.occurrences[date] || {}).assignments || [],
                });
            },

            // A series carrying no Roles has nothing to lay out, and an empty
            // table with date headings reads as a failed load rather than as a
            // thing nobody has set up yet.
            get hasRoles() { return this.gridRoles.length > 0; },

            // ── Roles & rules (the table) ────────────────────────────────────
            //
            // Who a Role needs, who may fill it, its rest and whether it uses up
            // the morning are this Event's to say (EventsCore.effectiveRole):
            // Setup needs two men on a Sunday and one of anybody on a Wednesday.
            // Every Role on the Event is one row; opening it shows who can do
            // it, the team's rules, and what those rules allow. Rules across
            // Roles sit under the table. RoleRulesCore is the model; this is the
            // wiring. Every change saves itself (ADR 0032), once it is whole.

            get pairTypeOptions() {
                return Roles.DIRECTORY_GROUP_TYPES.concat(this.sharedGroupTypes);
            },

            get allRuleTypes() {
                return this.pairTypeOptions.concat(this.sharedPairwiseTypes);
            },

            /** @param {string} slug */
            roleName(slug) {
                const def = this.roleDefinitions.find((/** @type {*} */ d) => d.slug === slug);
                if (def && def.name) return def.name;
                const liturgical = Roles.LITURGICAL_ROLES.find((/** @type {*} */ r) => r.slug === slug);
                return (liturgical && liturgical.name) || slug;
            },

            /** @param {string} typeId */
            typeName(typeId) {
                const type = this.allRuleTypes.find((/** @type {*} */ t) => t.id === typeId);
                return (type && type.name) || null;
            },

            /** @param {string} tagId */
            tagName(tagId) {
                const tag = this.ruleTags.find((/** @type {*} */ t) => t.id === tagId);
                return (tag && tag.name) || null;
            },

            get ruleNames() {
                return {
                    tag: id => this.tagName(id),
                    type: id => this.typeName(id),
                    role: slug => this.roleName(slug),
                    person: id => this.personName(id),
                };
            },

            // The Servant Roles on this Event, in its own order. Liturgical ones
            // are rows of their own below: they are filled in the order of
            // service, and the only thing an Event says about them is rest.
            get tableRoles() {
                return ((this.chosen && this.chosen.roleSlugs) || [])
                    .filter(slug => Roles.LITURGICAL_SLUGS.indexOf(slug) === -1)
                    .filter(slug => this.roleDefinitions.some((/** @type {*} */ d) => d.slug === slug));
            },

            get liturgicalRows() {
                return ((this.chosen && this.chosen.roleSlugs) || [])
                    .filter(slug => Roles.LITURGICAL_SLUGS.indexOf(slug) !== -1)
                    .map(slug => ({
                        slug: slug,
                        name: this.roleName(slug),
                        rest: Series.roleIntensity(this.chosen, slug),
                    }));
            },

            get rolesAvailable() {
                const on = (this.chosen && this.chosen.roleSlugs) || [];
                return this.roleDefinitions
                    .filter((/** @type {*} */ d) => Roles.LITURGICAL_SLUGS.indexOf(d.slug) === -1)
                    .filter((/** @type {*} */ d) => on.indexOf(d.slug) === -1);
            },

            // Built when the tab opens and whenever the Event changes, never
            // inside a getter: a form made while drawing would be thrown away
            // on the next draw, and with it whatever was being typed.
            buildRoleForms() {
                if (!this.chosen) return;
                const forms = Object.assign({}, this.roleForms);
                this.tableRoles.forEach(slug => {
                    const key = this.seriesId + ':' + slug;
                    if (!forms[key]) {
                        forms[key] = RoleRules.formFrom(this.roleDefinitions.find((/** @type {*} */ d) => d.slug === slug) || {});
                    }
                });
                this.roleForms = forms;
                if (this.crossFormsFor !== this.seriesId) {
                    this.crossForms = RoleRules.crossFormsFrom(Series.crossRoleRulesOf(this.chosen));
                    this.crossFormsFor = this.seriesId;
                }
            },

            /** @param {string} slug */
            formFor(slug) {
                return this.roleForms[this.seriesId + ':' + slug] || null;
            },

            /** @param {string} slug */
            toggleRole(slug) {
                this.openRole = this.openRole === slug ? null : slug;
            },

            // How many people a Role needs here, one more or one fewer.
            /** @param {string} slug @param {number} delta */
            stepCount(slug, delta) {
                const form = this.formFor(slug);
                if (!form) return;
                const next = Math.max(1, (Number(form.count) || 1) + delta);
                if (next === form.count) return;
                form.count = next;
                this.saveRole(slug);
            },

            // The three rule lists drawn by the one shared template: what it
            // lists, what kind of rules they are, and where they save.
            /** @param {string} slug */
            whoBlock(slug) {
                const form = this.formFor(slug);
                return { scope: 'who', slug: slug, rules: form ? [form.who] : [] };
            },
            /** @param {string} slug */
            teamBlock(slug) {
                const form = this.formFor(slug);
                return { scope: 'team', slug: slug, rules: form ? form.team : [] };
            },
            get acrossBlock() {
                return { scope: 'across', slug: null, rules: this.crossForms };
            },
            /** @param {*} block */
            saveBlock(block) {
                return block.scope === 'across' ? this.saveCross() : this.saveRole(block.slug);
            },

            // ── Building rules ───────────────────────────────────────────────

            /** @param {string} scope */
            conditionKinds(scope) {
                if (scope === 'who') {
                    return [
                        { value: 'requireTag', label: 'Tagged' },
                        { value: 'excludeTag', label: 'Not tagged' },
                        { value: 'sex', label: 'A man / a woman' },
                        { value: 'allowlist', label: 'One of these people' },
                    ];
                }
                const kinds = [
                    { value: 'lineup', label: 'Line-up' },
                    { value: 'atLeastTagged', label: 'At least … tagged' },
                    { value: 'notSameGroup', label: scope === 'across' ? 'Not from the same' : 'No two from the same' },
                    { value: 'sameGroup', label: scope === 'across' ? 'From the same' : 'All from the same' },
                ];
                if (scope === 'team' && this.sharedPairwiseTypes.length) {
                    kinds.push({ value: 'notTogether', label: 'Cannot serve together if' });
                }
                return kinds;
            },

            /** @param {string} slug */
            countOf(slug) {
                const form = this.formFor(slug);
                return form ? Math.max(1, Number(form.count) || 1) : 1;
            },

            // A new condition, filled in enough to be whole: a rule that names
            // no Tag would refuse everybody, so it starts on the first one.
            /** @param {string} scope @param {string} slug */
            freshCondition(scope, slug) {
                const roleSlug = scope === 'across' ? (this.tableRoles[0] || '') : null;
                const c = RoleRules.newCondition(scope, this.countOf(scope === 'across' ? roleSlug : slug), roleSlug);
                if (scope === 'who') c.tagId = (this.ruleTags[0] && this.ruleTags[0].id) || '';
                return c;
            },

            // The kind changed: give the condition what that kind needs.
            /** @param {*} c @param {string} scope @param {string} slug */
            reshapeCondition(c, scope, slug) {
                const keep = { id: c.id, kind: c.kind };
                if (scope === 'across' && c.roleSlug) keep.roleSlug = c.roleSlug;
                Object.keys(c).forEach((/** @type {*} */ k) => { delete c[k]; });
                Object.assign(c, keep);
                const firstTag = (this.ruleTags[0] && this.ruleTags[0].id) || '';
                const firstGroup = (this.pairTypeOptions[0] && this.pairTypeOptions[0].id) || 'family';
                if (c.kind === 'requireTag' || c.kind === 'excludeTag') c.tagId = firstTag;
                if (c.kind === 'sex') c.sex = 'male';
                if (c.kind === 'allowlist') c.personIds = [];
                if (c.kind === 'lineup') {
                    if (scope === 'across' && !c.roleSlug) c.roleSlug = this.tableRoles[0] || '';
                    c.sexes = Array(this.countOf(scope === 'across' ? c.roleSlug : slug)).fill('either');
                }
                if (c.kind === 'atLeastTagged') {
                    c.tagId = firstTag;
                    c.atLeast = 1;
                    if (scope === 'across') delete c.roleSlug;
                }
                if (c.kind === 'notSameGroup' || c.kind === 'sameGroup') {
                    c.typeId = firstGroup;
                    if (scope === 'across') {
                        delete c.roleSlug;
                        c.roleSlugs = [this.tableRoles[0] || '', this.tableRoles[1] || ''];
                    }
                }
                if (c.kind === 'notTogether') {
                    c.typeId = (this.sharedPairwiseTypes[0] && this.sharedPairwiseTypes[0].id) || '';
                }
            },

            // A line-up across Roles now about a different Role: as many marks
            // as that Role needs, all "either" until somebody says otherwise.
            /** @param {*} c */
            fitLineup(c) {
                if (c.kind === 'lineup') c.sexes = Array(this.countOf(c.roleSlug)).fill('either');
            },

            /** @param {*} c @param {*} block */
            lineupFewer(c, block) {
                if (c.sexes.length <= 1) return;
                c.sexes.pop();
                this.saveBlock(block);
            },

            /** @param {*} c @param {string} personId @param {*} block */
            addPerson(c, personId, block) {
                if (!personId || c.personIds.indexOf(personId) !== -1) return;
                c.personIds.push(personId);
                this.saveBlock(block);
            },

            /** @param {string} mark */
            nextMark(mark) {
                return mark === 'male' ? 'female' : mark === 'female' ? 'either' : 'male';
            },

            /** @param {string} mark */
            markLabel(mark) {
                return mark === 'male' ? 'M' : mark === 'female' ? 'W' : 'Any';
            },

            /** @param {*} makeup */
            makeupMarks(makeup) {
                return Array(makeup.men).fill('male').concat(Array(makeup.women).fill('female'));
            },

            /** @param {*} makeup */
            makeupWords(makeup) {
                return RoleRules.makeupWords(makeup);
            },

            /** @param {*} rule @param {string} scope @param {string} slug */
            addOption(rule, scope, slug) {
                rule.options.push({ id: RoleRules.newOption(scope).id, conditions: [this.freshCondition(scope, slug)] });
            },

            /** @param {*} rules @param {string} scope @param {string} slug */
            addRule(rules, scope, slug) {
                const rule = RoleRules.newRule(scope);
                rule.options[0].conditions = [this.freshCondition(scope, slug)];
                rules.push(rule);
            },

            // Removing the last condition of an option removes the option; the
            // last option of a team or cross rule removes the rule.
            /** @param {*} rules @param {number} ruleIndex @param {number} optionIndex @param {number} condIndex @param {string} scope */
            removeCondition(rules, ruleIndex, optionIndex, condIndex, scope) {
                const rule = rules[ruleIndex];
                const option = rule.options[optionIndex];
                option.conditions.splice(condIndex, 1);
                if (!option.conditions.length) rule.options.splice(optionIndex, 1);
                if (!rule.options.length && scope !== 'who') rules.splice(ruleIndex, 1);
            },

            /** @param {*} rule @param {string} scope */
            sentence(rule, scope) {
                return RoleRules.sentence(rule, scope, this.ruleNames);
            },

            // ── What a Role's rules allow ────────────────────────────────────

            /** @param {string} slug */
            settingsFor(slug) {
                const def = this.roleDefinitions.find((/** @type {*} */ d) => d.slug === slug) || {};
                return RoleRules.settingsFrom(this.formFor(slug), def);
            },

            // Everything wrong with a Role's form, in words. A form with any of
            // these is not saved: half a rule is worse than none, because a rule
            // that names no Tag refuses everybody.
            /** @param {string} slug */
            roleProblems(slug) {
                const form = this.formFor(slug);
                if (!form) return [];
                const settings = this.settingsFor(slug);
                /** @type {string[]} */
                const out = [];
                settings.restrictions.forEach(rule => {
                    Roles.validateRestriction(rule, this.allRuleTypes, { count: settings.slots.length }).errors
                        .forEach((/** @type {*} */ e) => { if (out.indexOf(e) === -1) out.push(e); });
                });
                return out;
            },

            get assignable() {
                return Roles.assignablePeople(this.people, Object.assign(
                    { rank: this.rank, account: this.account }, this.nonServingOpts || {}));
            },

            // Who can do it, judged on "who can do it" alone — the team's rules
            // depend on who else is on it, which no date has decided yet.
            /** @param {string} slug */
            eligibleFor(slug) {
                const settings = this.settingsFor(slug);
                const def = Object.assign({}, this.roleDefinitions.find((/** @type {*} */ d) => d.slug === slug) || {}, settings, {
                    restrictions: settings.restrictions.filter((/** @type {*} */ r) => r.scope === 'person'),
                });
                const people = this.assignable;
                const ok = {};
                Roles.candidatesFor(def, settings.slots[0], { people: people })
                    .forEach((/** @type {*} */ r) => { if (r.eligible) ok[r.personId] = true; });
                return people.filter((/** @type {*} */ p) => ok[p.id]);
            },

            /** @param {string} slug */
            eligibleSentence(slug) {
                const e = this.eligibleFor(slug);
                const men = e.filter((/** @type {*} */ p) => p.sex === 'male').length;
                const women = e.filter((/** @type {*} */ p) => p.sex === 'female').length;
                return e.length + ' of ' + this.assignable.length + ' people can do it — '
                    + (men === 1 ? '1 man' : men + ' men') + ', ' + (women === 1 ? '1 woman' : women + ' women') + '.';
            },

            /** @param {string} slug */
            baseMakeups(slug) {
                const form = this.formFor(slug);
                if (!form) return [];
                return RoleRules.makeups(this.countOf(slug), this.eligibleFor(slug), form.team);
            },

            get combos() {
                const roles = this.tableRoles.map(slug => ({ slug: slug, makeups: this.baseMakeups(slug) }));
                return RoleRules.combos(roles, this.crossForms);
            },

            get linkedRoles() {
                return RoleRules.linkedSlugs(this.crossForms, this.tableRoles);
            },

            /** @param {string} slug */
            allowedMakeups(slug) {
                const base = this.baseMakeups(slug);
                if (this.linkedRoles.indexOf(slug) === -1) return base;
                const combos = this.combos;
                return base.filter((/** @type {*} */ m) => combos.some((/** @type {*} */ c) => c[slug] && c[slug].men === m.men));
            },

            /** @param {string} slug */
            narrowedAcross(slug) {
                return this.allowedMakeups(slug).length < this.baseMakeups(slug).length;
            },

            /** @param {string} slug */
            anyMix(slug) {
                const count = this.countOf(slug);
                return count > 1 && this.allowedMakeups(slug).length === count + 1;
            },

            /** @param {string} slug */
            ruleCount(slug) {
                const form = this.formFor(slug);
                if (!form) return 0;
                const across = this.crossForms.filter(rule => (rule.options || []).some((/** @type {*} */ o) => (o.conditions || []).some(
                    c => c.roleSlug === slug || ((c.roleSlugs || []).indexOf(slug) !== -1)
                ))).length;
                return (form.who.options.length ? 1 : 0) + form.team.length + across;
            },

            /** @param {string} slug */
            tryRules(slug) {
                const form = this.formFor(slug);
                return form ? form.team.filter((/** @type {*} */ r) => r.strength === 'try') : [];
            },

            // ── Saving ───────────────────────────────────────────────────────

            // ⚠ ONE SAVE AT A TIME. Clicking through a line-up is several
            // changes a second, and two writes in flight can land in either
            // order — the older one last would undo the newer. So a change made
            // while a save is out waits, and the form as it stands then is what
            // goes next.
            /** @param {string} slug */
            async saveRole(slug) {
                if (!this.chosen || !this.formFor(slug)) return;
                if (this.roleProblems(slug).length) return;
                if (this.savingRole) {
                    this.saveAgain = Object.assign({}, this.saveAgain, { [slug]: true });
                    return;
                }
                this.savingRole = slug;
                this.error = '';
                try {
                    const map = await Store.setSeriesRoleSettings(db, this.seriesId, slug, this.settingsFor(slug));
                    this.patchSeries({ roleSettings: map });
                } catch (e) {
                    console.error('Could not save the role on this event:', e);
                    this.error = (e && e.message) || 'That change could not be saved — nothing was changed.';
                } finally {
                    this.savingRole = '';
                }
                const waiting = Object.keys(this.saveAgain || {});
                this.saveAgain = {};
                for (const next of waiting) await this.saveRole(next);
            },

            crossProblems() {
                /** @type {string[]} */
                const out = [];
                const slugs = (this.chosen && this.chosen.roleSlugs) || [];
                this.crossForms.forEach(rule => (rule.options || []).forEach((/** @type {*} */ o) => (o.conditions || []).forEach((/** @type {*} */ c) => {
                    if (c.kind === 'lineup') {
                        Roles.validateRestriction({ kind: 'lineup', sexes: c.sexes }, [], { count: this.countOf(c.roleSlug) }).errors
                            .forEach((/** @type {*} */ e) => out.push(e));
                        if (slugs.indexOf(c.roleSlug) === -1) out.push('Choose a Role for each line-up.');
                    }
                    if (c.kind === 'notSameGroup' || c.kind === 'sameGroup') {
                        const pair = c.roleSlugs || [];
                        if (pair.length !== 2 || !pair[0] || !pair[1] || pair[0] === pair[1]) {
                            out.push('A rule between Roles names two different Roles.');
                        }
                        if (!this.typeName(c.typeId)) out.push('Choose a relationship for each rule between Roles.');
                    }
                })));
                return out.filter((/** @type {*} */ e, /** @type {*} */ i) => out.indexOf(e) === i);
            },

            async saveCross() {
                if (!this.chosen || this.crossProblems().length) return;
                // The same one-at-a-time rule as saveRole.
                if (this.savingCross) { this.crossAgain = true; return; }
                this.savingCross = true;
                this.error = '';
                try {
                    const saved = await Store.setSeriesCrossRoleRules(db, this.seriesId, RoleRules.crossRulesFrom(this.crossForms));
                    this.patchSeries({ crossRoleRules: saved });
                } catch (e) {
                    console.error('Could not save the rule across roles:', e);
                    this.error = (e && e.message) || 'That rule could not be saved — nothing was changed.';
                } finally {
                    this.savingCross = false;
                }
                if (this.crossAgain) {
                    this.crossAgain = false;
                    await this.saveCross();
                }
            },

            // The order of service Roles have no definition, so their rest is
            // the one thing this Event says about them (EventsCore.roleIntensity).
            /** @param {string} slug @param {*} raw */
            async setLiturgicalRest(slug, raw) {
                const value = Number(raw);
                if (!this.chosen || !Number.isFinite(value) || value < 0) {
                    this.error = 'Rest between turns has to be zero or more weeks.';
                    return;
                }
                const map = Object.assign({}, this.chosen.liturgicalIntensity || {});
                map[slug] = value;
                this.error = '';
                try {
                    await db.collection('events').doc(this.seriesId).set({ liturgicalIntensity: map }, { merge: true });
                    this.patchSeries({ liturgicalIntensity: map });
                } catch (e) {
                    console.error('Could not save the rest:', e);
                    this.error = 'That rest could not be saved — nothing was changed.';
                }
            },

            // ── Ticking columns ──────────────────────────────────────────────

            isSelected(date) { return this.selected.indexOf(date) !== -1; },

            toggle(date) {
                this.selected = this.isSelected(date)
                    ? this.selected.filter(d => d !== date)
                    : this.selected.concat([date]);
            },

            get allShown() {
                const shown = this.dates;
                return shown.length > 0 && shown.every(d => this.isSelected(d));
            },

            toggleAllShown() {
                const shown = this.dates;
                if (this.allShown) {
                    this.selected = this.selected.filter(d => shown.indexOf(d) === -1);
                    return;
                }
                const add = shown.filter(d => !this.isSelected(d));
                this.selected = this.selected.concat(add);
            },

            clearSelection() { this.selected = []; },

            get range() { return Grid.rangeFor(this.selected, this.allDates); },

            // The draft room, for the series that is open. With columns ticked
            // it carries that range; without, the draft room applies its own
            // default and drafts the next stretch.
            //
            // ONE door, not two. Auto-assign used to live on the Calendar, which
            // could not know which series you meant — so it opened on whichever
            // sorted first and made you choose again from a dropdown, against
            // dates you could no longer see. Here the series is already the
            // thing you are looking at.
            get draftHref() { return Grid.draftRoomHref(this.seriesId, this.range); },

            // What pressing it will actually do. ONE button: it opens the draft
            // room's setup step, where the editor chooses to draft the rota or
            // fill it in by hand with the range in front of them. So the label
            // names neither — only whether the ticked columns are coming along.
            get draftLabel() {
                const range = this.range;
                if (!range) return 'Fill the rota';
                return 'Fill ' + range.spans
                    + (range.spans === 1 ? ' date' : ' dates');
            },

            // Said before the trip, not discovered after it. The draft room
            // works in ranges, so a scattered selection brings the dates in
            // between along with it — and redrawing a Sunday nobody chose is
            // exactly the surprise this sentence exists to prevent.
            // ── Taking everybody off the ticked dates ────────────────────────
            //
            // The one write on this screen. It is here rather than in the draft
            // room because emptying a stretch is not a rota you are proposing —
            // there is nothing to weigh up, nothing to balance, and making an
            // editor draft eight dates in order to throw the result away is a
            // long way round to a blank grid.
            //
            // It works on the SET that was ticked, not the range. The button
            // next to it sweeps the dates in between; this one must not, and
            // the two sitting side by side is exactly why that has to hold.

            get wipe() {
                return Grid.wipeFor(this.selected, {
                    today: Dates.todayStr(),
                    assignmentsAt: date => (this.occurrences[date] || {}).assignments || [],
                });
            },

            get canWipe() {
                return !!this.wipe && this.wipe.any && !this.gridLoading && !this.clearing;
            },

            // No count on it, unlike the button beside it. Auto-assign has to
            // carry one because the range it opens can be wider than the tick;
            // this touches the ticked dates or fewer, the panel is already
            // saying how many are ticked an inch to the left, and a third long
            // uppercase label wraps the row on a narrow desktop. Where the
            // number really does differ, `wipeNote` says so in words.
            //
            // A getter rather than markup so the two places this button could
            // ever be drawn cannot word it differently — and so the word "clear"
            // can be kept out of it by a test. The button above unticks; this
            // one deletes a rota, and they sit an inch apart.
            get wipeLabel() { return 'Take everybody off'; },

            // Why the button is dead, when it is — and when it is alive, which
            // of the ticked dates it is quietly not going to touch. A control
            // that correctly does nothing and says nothing cannot be told from a
            // broken one, and one that silently does less than you ticked is
            // worse.
            get wipeNote() {
                const wipe = this.wipe;
                if (!wipe) return '';

                const pastNote = wipe.past.length === 1
                    ? 'The date you ticked in the past is left alone — its rota is the record of who served.'
                    : 'The ' + wipe.past.length + ' dates you ticked in the past are left alone — '
                        + 'their rotas are the record of who served.';

                if (!wipe.any) {
                    if (wipe.past.length && !wipe.alreadyEmpty.length) return pastNote;
                    return 'There is nobody on the dates you ticked.';
                }

                // Silent when the button will do exactly what the ticks say. A
                // line that repeats the count above it is noise, and noise is
                // what an editor learns to read past on the day it matters.
                if (!wipe.past.length && !wipe.alreadyEmpty.length) return '';

                const parts = ['Taking everybody off would empty '
                    + (wipe.dates.length === 1 ? '1 date' : wipe.dates.length + ' dates')
                    + ' — ' + View.listSentence(wipe.dates.map(d => this.shortDate(d))) + '.'];
                if (wipe.past.length) parts.push(pastNote);
                if (wipe.alreadyEmpty.length) {
                    parts.push('There is nobody on the '
                        + (wipe.alreadyEmpty.length === 1 ? 'other one' : 'other '
                            + wipe.alreadyEmpty.length) + '.');
                }
                return parts.join(' ');
            },

            // Said before, not discovered after. Two things an editor cannot see
            // from the grid: that a yes is about to be un-said, and that the
            // past columns they ticked are not coming.
            get wipeWarning() {
                const wipe = this.wipe;
                if (!wipe || !wipe.any) return '';

                const parts = [];
                if (wipe.confirmed) {
                    parts.push(wipe.confirmed === 1
                        ? 'One of them has already said yes.'
                        : wipe.confirmed + ' of them have already said yes.');
                }
                if (wipe.past.length) {
                    parts.push('The ' + (wipe.past.length === 1 ? 'date' : wipe.past.length + ' dates')
                        + ' you ticked in the past ' + (wipe.past.length === 1 ? 'is' : 'are')
                        + ' left alone — that rota is the record of who served.');
                }
                return parts.join(' ');
            },

            // The whole of what is about to happen, in one breath, because this
            // is the only thing on the screen that throws work away.
            get wipeQuestion() {
                const wipe = this.wipe;
                if (!wipe || !wipe.any) return '';

                const n = wipe.people.length;
                const lead = 'Take ' + (n === 1 ? 'one person' : n + ' people')
                    + ' off ' + (wipe.dates.length === 1 ? 'one date' : wipe.dates.length + ' dates')
                    + ' — ' + View.listSentence(wipe.dates.map(d => this.shortDate(d))) + '?';

                const tail = 'The dates themselves stay, along with anything else on them. '
                    + 'This cannot be undone.';

                return [lead, this.wipeWarning, tail].filter(Boolean).join('\n\n');
            },

            async takeEverybodyOff() {
                const wipe = this.wipe;
                if (!wipe || !wipe.any || this.clearing) return;

                if (typeof confirm === 'function' && !confirm(this.wipeQuestion)) return;

                this.clearing = true;
                this.error = '';
                let failure = '';
                try {
                    await Store.clearRosters(db, this.seriesId, wipe.dates);
                } catch (e) {
                    console.error('Could not empty those dates:', e);
                    // The write goes date by date, so a failure half way through
                    // has really emptied half. "That did not work" would be a
                    // lie about the ones that did.
                    failure = 'Some of those dates could not be emptied. The grid below is '
                        + 'what is really stored — read it before trying again.';
                } finally {
                    this.clearing = false;
                }

                // The ticks go with the rota they were pointing at. Leaving them
                // would arm the same button over dates that are now blank.
                this.selected = [];
                await this.loadWindow();

                // ⚠ AFTER the reload, not before. `loadWindow` starts by
                // clearing the error — rightly, since it is about to say what it
                // found — and announcing the failure first would have it wiped
                // by the very read sent to prove it.
                if (failure) this.error = failure;
            },

            get sweepNote() {
                const range = this.range;
                if (!range || range.contiguous) return '';
                const n = range.swept.length;
                return 'The draft room works in a run of dates, so '
                    + n + (n === 1 ? ' date' : ' dates')
                    + ' in between will come too — ' + View.listSentence(range.swept.map(d => this.shortDate(d)))
                    + '. What is already on them is kept unless you say otherwise.';
            },

            // ── The other doors ──────────────────────────────────────────────
            //
            // ⚠ There is no longer a door to "the Event itself". Its pattern,
            // time, place, colour, Roles and visibility are the pane's own
            // tabs (MS-229), so `calendar-event.html?series=` is not a page any
            // more and nothing here may link to it.

            dateHref(date) {
                return 'calendar-event.html?id=' + encodeURIComponent(
                    Core.occurrenceId(this.seriesId, date));
            },

            // A new Event that REPEATS. The create form defaults to "just once",
            // which is the right default from the Calendar and the wrong one
            // from a page that is entirely about the ones that do not.
            get newEventHref() { return 'calendar-event.html?new=1&repeats=1'; },

            // ── Words ────────────────────────────────────────────────────────

            patternOf(s) {
                const rule = s.recurrence
                    || (s.id === Core.SUNDAY_SERVICE_ID ? Store.SUNDAY_RULE : null);
                return rule ? View.recurrenceSentence(rule) : 'No pattern set.';
            },

            nextDateOf(s) {
                const rule = s.recurrence
                    || (s.id === Core.SUNDAY_SERVICE_ID ? Store.SUNDAY_RULE : null);
                if (!rule) return '';
                const next = View.nextDates(rule, Dates.todayStr(), 1);
                return next.length ? this.shortDate(next[0]) : 'Nothing coming up';
            },

            roleCountOf(s) {
                const slugs = (s.roleSlugs || [])
                    .filter(slug => Roles.LITURGICAL_SLUGS.indexOf(slug) === -1);
                if (!slugs.length) return 'No roles yet';
                return slugs.length + (slugs.length === 1 ? ' role' : ' roles');
            },

            // The row's third line, composed in one place.
            //
            // ⚠ It cannot be `roleCountOf(s) + ' · next ' + nextDateOf(s)`.
            // `nextDateOf` answers with a SENTENCE when the pattern has run
            // out, so gluing "next " in front of it read "4 roles · next
            // Nothing coming up" on exactly the series a reader most needs a
            // straight answer about. The word "next" belongs to the branch
            // that actually has one.
            listLineOf(s) {
                const roles = this.roleCountOf(s);
                const next = this.nextDateOf(s);
                if (!next) return roles;
                return roles + (next === 'Nothing coming up'
                    ? ' · nothing coming up'
                    : ' · next ' + next);
            },

            colourOf(s) {
                return View.colourFor(s.colour);
            },

            personName(personId) {
                const p = this.people.find(x => x.id === personId);
                return (p && p.name) || 'Someone';
            },

            shortDate(dateStr) {
                return dateStr ? View.formatDayMonth(dateStr) : '';
            },

            weekday(dateStr) {
                return dateStr ? View.weekdayName(dateStr) : '';
            },

            longDate(dateStr) {
                return dateStr ? Dates.formatDateLong(dateStr, 'en-GB') : '';
            },

            // The date badge on a Dates-tab card (MS-287) — three letters and a
            // number, the same shape the Services page's List View uses.
            weekdayShort(dateStr) {
                return this.weekday(dateStr).slice(0, 3);
            },

            dayNumber(dateStr) {
                return dateStr ? Number(dateStr.slice(8, 10)) : '';
            },

            // What the window covers, in one line, so paging has something to
            // land on other than the columns themselves changing.
            get windowLabel() {
                const dates = this.dates;
                if (!dates.length) return 'No dates';
                if (dates.length === 1) return this.longDate(dates[0]);
                return this.shortDate(dates[0]) + ' – ' + this.shortDate(dates[dates.length - 1]);
            },

            // ═══ THE EVENT ITSELF (MS-229) ═══════════════════════════════════
            //
            // Everything below was `calendar-event.html?series=<id>` — a second
            // page reached by a link that left this one. It is the same
            // behaviour, moved rather than rebuilt, now reading `chosen` where
            // it used to read a single loaded `series`.
            //
            // ⚠ `series` here is the LIST. The one being managed is `chosen`,
            // and every write goes back through `patchSeries` rather than
            // mutating a row, so the list on the left and the pane on the right
            // cannot come apart.

            // ── Details ──────────────────────────────────────────────────────

            startSeriesDraft() {
                const s = this.chosen || {};
                this.seriesDraft = {
                    name: s.name || '',
                    location: s.location || '',
                    description: s.description || '',
                };
                this.startLiveSeries();
            },

            // ── Details are live (MS-721, ADR 0081) ─────────────────────────
            //
            // No Save button: typing saves 1.5 s later, blur and Enter at
            // once, Escape puts back what was stored. The chip says where it
            // is; a refused save says Not saved with a Retry, and the next
            // edit retries. Another editor's change lands in any box this
            // editor is not changing (events/{id} is watched).

            liveSeries: null,
            stopSeriesWatch: null,
            seriesChip: 'saved',
            seriesError: '',

            seriesChipText(status) {
                return window.LiveFields ? window.LiveFields.chipText(status) : '';
            },

            startLiveSeries() {
                if (this.liveSeries) { this.liveSeries.dispose(); this.liveSeries = null; }
                if (this.stopSeriesWatch) { this.stopSeriesWatch(); this.stopSeriesWatch = null; }
                this.seriesChip = 'saved';
                this.seriesError = '';
                const LF = window.LiveFields;
                const s = this.chosen;
                if (!LF || !s || !s.id || !this.isEditor) return;
                const id = s.id;
                const fields = this.isSundaySeries
                    ? ['location', 'description']
                    : ['name', 'location', 'description'];
                const initial = {};
                fields.forEach(f => { initial[f] = this.seriesDraft[f]; });
                this.liveSeries = LF.create({
                    fields,
                    initial,
                    validate: (d) => (fields.indexOf('name') !== -1 && !String(d.name || '').trim()
                        ? { name: 'An event needs a name.' } : null),
                    save: async (patch) => {
                        const saved = await Store.saveSeriesDetails(db, id, patch);
                        if (this.chosen && this.chosen.id === id) this.patchSeries(saved);
                        return saved;
                    },
                    onChange: (st) => {
                        Object.keys(st.draft).forEach(f => {
                            if (this.seriesDraft[f] !== st.draft[f]) this.seriesDraft[f] = st.draft[f];
                        });
                        this.seriesChip = st.status;
                        this.seriesError = st.error;
                    },
                });
                const Live = window.MosaicLiveRead;
                if (Live && db && typeof db.collection === 'function') {
                    try {
                        this.stopSeriesWatch = Live.watch(db.collection('events').doc(id), (snap) => {
                            if (!snap || !snap.exists || !this.liveSeries) return;
                            const data = snap.data() || {};
                            const pending = !!(snap.metadata && snap.metadata.hasPendingWrites);
                            this.liveSeries.remote(data, { pendingWrites: pending });
                            if (!pending && this.chosen && this.chosen.id === id) {
                                const patch = {};
                                fields.forEach(f => { if (f in data) patch[f] = data[f]; });
                                this.patchSeries(patch);
                            }
                        }, { onError: (e) => console.warn('Event details are not live:', e) });
                    } catch (e) {
                        console.warn('Event details are not live:', e);
                    }
                }
            },

            editSeries(field, value) {
                this.seriesDraft[field] = value;
                if (this.liveSeries) this.liveSeries.edit(field, value);
            },

            revertSeries(field) {
                if (this.liveSeries) this.liveSeries.revert(field);
                else this.startSeriesDraft();
            },

            get seriesDetailsChanged() {
                const s = this.chosen || {};
                return ['name', 'location', 'description'].some(
                    f => String(this.seriesDraft[f] || '') !== String(s[f] || '')
                );
            },

            get seriesDetailsValid() { return !!String(this.seriesDraft.name || '').trim(); },

            async saveSeriesDetails() {
                // Live: blur, Enter and Retry — save now.
                if (this.liveSeries) return this.liveSeries.flush();
                if (!this.seriesDetailsValid || !this.seriesDetailsChanged || this.saving) return;
                this.saving = true;
                this.error = '';
                try {
                    const saved = await Store.saveSeriesDetails(db, this.seriesId, this.seriesDraft);
                    this.patchSeries(saved);
                    this.startSeriesDraft();
                } catch (e) {
                    console.error('Series details failed:', e);
                    this.error = (e && e.message) || 'Those details could not be saved.';
                } finally {
                    this.saving = false;
                }
            },

            // The time is on the recurrence rule — one home for one fact — and
            // saves on change, unlike the typed fields beside it.
            get seriesTime() {
                const rule = this.chosen && this.chosen.recurrence;
                return (rule && rule.time) || '';
            },

            async saveSeriesTime(time) {
                if (this.saving) return;
                this.saving = true;
                this.error = '';
                try {
                    const rule = await Store.setSeriesTime(db, this.seriesId, time);
                    this.patchSeries({ recurrence: rule });
                    this.recomputeDates();
                } catch (e) {
                    console.error('Series time failed:', e);
                    this.error = (e && e.message) || 'That time could not be saved.';
                } finally {
                    this.saving = false;
                }
            },

            // ── Name tags at the kiosk ───────────────────────────────────────
            //
            // A setting of the EVENT, so it is set here once rather than on one
            // date at a time forever. The kiosk asks the date first and falls
            // back to the Event, so turning it on here covers every Sunday.
            //
            // ⚠ THIS WRITES THE SERIES ONLY, NOT THE DATES. The date page writes
            // both, because from a single date "every date of this event" is
            // what an editor means. From here the Event is already the thing
            // being edited, and rewriting every occurrence document to say what
            // the Event now says would be a batch across years of history to
            // record a fact that is already recorded.
            //
            // The consequence, said plainly rather than discovered later: a date
            // somebody switched ON by hand stays on when this is switched off,
            // because the kiosk ORs the two. That is the same rule the Calendar
            // has always applied, and the hint under the checkbox says a single
            // date can be set on its own.
            get needsNameTagsOn() {
                return !!(this.chosen && this.chosen.needsNameTags);
            },

            async setNeedsNameTags(value) {
                if (this.saving || !this.chosen) return;
                const on = value === true;
                this.saving = true;
                this.error = '';
                try {
                    await Store.setNeedsNameTags(db, {
                        seriesId: this.seriesId,
                        value: on,
                    });
                    this.patchSeries({ needsNameTags: on });
                } catch (e) {
                    console.error('Name tag setting failed:', e);
                    this.error = 'That could not be saved.';
                } finally {
                    this.saving = false;
                }
            },

            // ── The Roles it carries ─────────────────────────────────────────
            //
            // Liturgical ones are SHOWN and locked: an editor needs to see the
            // whole shape of a Sunday, but those are filled in the order of
            // service and print in the booklet, so this screen can never drop
            // one. They are also never a row on the grid — a row for a Role
            // nobody assigns here would sit empty and read as "nobody is
            // preaching".

            // Which dates of this Event have people in a Role, and who.
            //
            // ⚠ Constrained to the viewer's OWN rungs. Asking for a rung they
            // cannot read fails the whole query and looks exactly like "nobody
            // is on it" — which would drop a Role silently.
            async seriesRoleUsage(slug) {
                const snap = await db.collection('event_occurrences')
                    .where('visibility', 'in', Core.visibilityQueryFor(this.rank).rungs)
                    .where('seriesId', '==', this.seriesId)
                    .get();

                const rows = await Promise.all(snap.docs.map(async d => {
                    const roster = await d.ref.collection('roster').get().catch(() => ({ docs: [] }));
                    const personIds = roster.docs
                        .map(r => r.data())
                        .filter(a => a.roleSlug === slug && !a.oneOffId)
                        .map(a => a.personId);
                    return { date: (d.data() || {}).date, personIds: personIds };
                }));

                return rows.filter(r => r.personIds.length);
            },

            async askRemoveSeriesRole(slug) {
                if (this.saving) return;
                const def = this.roleDefinitions.find(d => d.slug === slug);
                const name = (def && def.name) || slug;

                this.saving = true;
                let usage;
                try {
                    usage = await this.seriesRoleUsage(slug);
                } catch (e) {
                    console.error('Could not check who is on that role:', e);
                    // Could not check is not the same as nobody, so it still
                    // asks — and says that the count is the part it could not
                    // read.
                    this.saving = false;
                    this.pendingRemoval = {
                        key: slug, name: name, count: 0,
                        sentence: 'We could not check who is down for this on other dates. '
                            + 'Anyone who is loses their place.',
                    };
                    return;
                }
                this.saving = false;

                // An empty Role comes off on the click. There is nothing to be
                // sure about.
                if (!usage.length) return this.removeSeriesRole(slug);

                const names = [];
                usage.forEach(u => u.personIds.forEach(id => {
                    const n = this.personName(id);
                    if (names.indexOf(n) === -1) names.push(n);
                }));

                this.pendingRemoval = {
                    key: slug,
                    name: name,
                    count: usage.length,
                    sentence: View.listSentence(names)
                        + (names.length === 1 ? ' loses their place' : ' lose their places')
                        + ' across ' + usage.length + (usage.length === 1 ? ' date.' : ' dates.'),
                };
            },

            cancelRemoval() { this.pendingRemoval = null; },

            async confirmRemoval() {
                const ask = this.pendingRemoval;
                if (!ask) return;
                this.pendingRemoval = null;
                await this.removeSeriesRole(ask.key);
            },

            async setSeriesRoles(slugs) {
                if (this.saving) return;
                this.saving = true;
                this.error = '';
                try {
                    await Store.setSeriesRoles(db, this.seriesId, slugs);
                    this.patchSeries({ roleSlugs: slugs });
                } catch (e) {
                    console.error('Series roles failed:', e);
                    this.error = (e && e.message) || 'That change could not be saved.';
                } finally {
                    this.saving = false;
                }
            },

            // A Role added here gets this Event's own settings at once — one
            // person, anyone, a week's rest unless the Role still carries older
            // values — because a Role is only its name and what it involves
            // (ADR 0085), and an Event reading it with no settings would have
            // no places to fill.
            async addSeriesRole(slug) {
                if (!slug || !this.chosen) return;
                await this.setSeriesRoles(((this.chosen.roleSlugs) || []).concat([slug]));
                this.buildRoleForms();
                this.openRole = slug;
                await this.saveRole(slug);
            },

            // Dropping a Role from an Event drops the rules naming it and its
            // own settings here — the store writes both, and the page's copy
            // follows (EventsCore.withoutRulesNaming says why).
            async removeSeriesRole(slug) {
                if (!this.chosen) return;
                await this.setSeriesRoles(((this.chosen.roleSlugs) || []).filter(s => s !== slug));
                const next = Series.withoutRoleSettings(Series.withoutRulesNaming(this.chosen, slug), slug);
                this.patchSeries({
                    crossRoleRules: Series.crossRoleRulesOf(next),
                    roleSettings: next.roleSettings || {},
                });
                this.crossForms = RoleRules.crossFormsFrom(Series.crossRoleRulesOf(next));
                if (this.openRole === slug) this.openRole = null;
            },

            // ── Colour ───────────────────────────────────────────────────────
            //
            // On the SERIES, so one change moves every date. Decoration only —
            // the red that means "needs sorting" is not in the palette and
            // always overrides it.

            get colours() { return View.EVENT_COLOURS; },

            get colour() {
                return View.colourOf({
                    seriesId: this.seriesId,
                    seriesColour: this.chosen && this.chosen.colour,
                });
            },

            async setColour(slug) {
                if (this.saving || !this.chosen || this.colour.slug === slug) return;
                this.saving = true;
                this.error = '';
                try {
                    await Store.setSeriesColour(db, this.seriesId, slug);
                    this.patchSeries({ colour: slug });
                } catch (e) {
                    console.error('Colour change failed:', e);
                    this.error = 'That colour could not be saved.';
                } finally {
                    this.saving = false;
                }
            },

            // ── Who can see it ───────────────────────────────────────────────
            //
            // Restamped onto EVERY occurrence, past ones included: a security
            // rule reads visibility off the document and cannot go and look at
            // the series. Making something private has to reach its history.

            get visibilityLadder() { return View.visibilityLadder(); },
            rosterToggleApplies(level) { return View.rosterToggleApplies(level); },

            get seriesVisibility() {
                return (this.chosen && this.chosen.visibility) || 'member';
            },

            async setSeriesVisibility(level) {
                if (this.saving || this.isSundaySeries) return;
                this.saving = true;
                this.error = '';
                try {
                    await Store.restampSeriesVisibility(
                        db, this.seriesId, level, this.chosen.rosterShared === true,
                        { rank: this.rank }
                    );
                    this.patchSeries({ visibility: level });
                } catch (e) {
                    console.error('Series visibility failed:', e);
                    this.error = (e && e.message) || 'That could not be saved.';
                } finally {
                    this.saving = false;
                }
            },

            async setSeriesRosterShared(shared) {
                if (this.saving || this.isSundaySeries) return;
                this.saving = true;
                this.error = '';
                try {
                    await Store.restampSeriesVisibility(
                        db, this.seriesId, this.seriesVisibility, shared === true,
                        { rank: this.rank }
                    );
                    this.patchSeries({ rosterShared: shared === true });
                } catch (e) {
                    console.error('Roster sharing failed:', e);
                    this.error = 'That could not be saved.';
                } finally {
                    this.saving = false;
                }
            },

            // ── The order of service ─────────────────────────────────────────
            //
            // A Sunday's liturgy is built there, one date at a time — kept as
            // its own link (MS-287 removed "The next few" card that used to
            // draw it, but the URL it built is still what a Sunday's own Event
            // page reaches for).

            orderOfServiceHref(date) {
                return 'service-builder.html?date=' + encodeURIComponent(date);
            },

            // ── Changing the pattern ─────────────────────────────────────────
            //
            // Dates that already have people on them and do not fit the new
            // pattern are ORPHANS, and the editor says what happens to each.
            // Never guessed: a pattern change that silently deleted a rota
            // would be the most expensive undo in the app.

            get patternEditable() { return this.isEditor && !this.isSundaySeries; },

            async openPattern() {
                if (!this.chosen) return;
                const rule = Object.assign({}, this.chosen.recurrence || {});
                // The viewer's OWN rungs, for the same reason as above.
                const snap = await db.collection('event_occurrences')
                    .where('visibility', 'in', Core.visibilityQueryFor(this.rank).rungs)
                    .where('seriesId', '==', this.seriesId)
                    .get();
                const stored = await Promise.all(snap.docs.map(async d => {
                    const roster = await d.ref.collection('roster').get();
                    return Object.assign({ id: d.id }, d.data(), {
                        assignments: roster.docs.map(r => r.data()),
                    });
                }));
                this.pattern = { open: true, rule: rule, stored: stored, orphans: [], choices: {} };
            },

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
                if (this.saving) return;
                this.saving = true;
                this.error = '';
                try {
                    const rule = this.pattern.rule;
                    const stored = this.pattern.stored || [];
                    const dates = stored.map(o => o.date).sort();
                    const free = Core.datesBetween(
                        rule, dates[0] || rule.startDate, dates[dates.length - 1] || rule.startDate
                    ).filter(d => !stored.some(o => o.date === d));

                    await Store.applyOrphanChoices(
                        db, this.seriesId, this.pattern.orphans, this.pattern.choices, free
                    );
                    await db.collection('events').doc(this.seriesId).update({ recurrence: rule });
                    this.patchSeries({ recurrence: rule });
                    this.pattern.open = false;

                    // The dates on the rota came from the OLD rule. Re-derive
                    // them before reading, or the grid draws a window of dates
                    // this event no longer has.
                    this.selected = [];
                    this.anchor = Dates.todayStr();
                    this.recomputeDates();
                    await this.loadWindow();
                } catch (e) {
                    console.error('Pattern change failed:', e);
                    this.error = 'The pattern could not be changed.';
                } finally {
                    this.saving = false;
                }
            },
        }, EventAnnouncementPanel.bindings());
    };
})();
