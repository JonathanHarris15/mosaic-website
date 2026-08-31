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
// Rota, Roles & rules and Who can see it, and still lands on Rota by default.
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
    const Dates = window.DateUtils;

    const EDITOR_RANKS = ['editor', 'admin', 'elder', 'super_admin'];

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
        return {
            loading: true,
            error: '',
            rank: null,
            personId: null,

            series: [],
            seriesId: '',

            people: [],
            roleDefinitions: [],

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
            // meant losing sight of the Sunday's rota. It is four tabs of one
            // pane now, and the tab survives changing series: an editor
            // comparing who can see what across three events should not have to
            // find that tab again for each of them.
            tab: 'rota',

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
            groupTypesDenied: false,
            newPairKind: 'notSameGroup',
            newPairTypeId: '',
            newPairRoleA: '',
            newPairRoleB: '',
            savingPairRule: false,

            // ── Loading ──────────────────────────────────────────────────────

            async init() {
                this.rank = await this.resolveRank();
                if (!this.rank) { this.loading = false; return; }

                // Editors still land on Rota (unchanged); a member's old
                // effective default was "Coming up", which is Dates now.
                this.tab = this.isEditor ? 'rota' : 'dates';

                try {
                    // The directory is the GRID's ingredient — names for the
                    // cards, definitions for the rows — and the browse lane draws
                    // neither. Reading the whole church to list some dates would
                    // be a page-load spent on nothing.
                    await Promise.all([
                        this.loadSeries(),
                        this.isEditor ? this.loadDirectory() : Promise.resolve(),
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
                            this.personId = (data && data.personId) || null;
                            resolve((data && (data.permissionLevel || data.role)) || 'viewer');
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
                this.roleDefinitions = roles.docs.map(d => Object.assign({ id: d.id }, d.data()));
                await this.loadGroupTypes();
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
                    this.sharedGroupTypes = snap.docs
                        .map(d => Object.assign({ id: d.id }, d.data()))
                        .filter(t => t.kind === 'group' && t.sharedWithEditors === true);
                } catch (e) {
                    console.error('Could not read the relationship types:', e);
                    this.sharedGroupTypes = [];
                    this.groupTypesDenied = true;
                }
            },

            // ── Who is looking ───────────────────────────────────────────────

            get isEditor() { return EDITOR_RANKS.indexOf(this.rank) !== -1; },
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
                // The Rota's own grid is an editor-only read (MS-287) — a
                // member never opens that tab, so there is nothing there for
                // them to wait on. The Dates tab is everyone's, and reads its
                // own fixed window regardless of role.
                await Promise.all([
                    this.isEditor ? this.loadWindow() : Promise.resolve(),
                    this.loadUpcomingWindow(),
                ]);

                // Opening the Sunday Service is also the moment it gets
                // repaired if it has drifted, or created if it never existed.
                // Safe to run every time: it writes only when something is
                // actually wrong. It used to happen on the way into the second
                // page, which no longer exists.
                if (this.isEditor && id === Core.SUNDAY_SERVICE_ID) await this.reconcileSunday();
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
                    { id: 'rota', label: 'Rota', editorOnly: true },
                    { id: 'roles', label: 'Roles & rules', editorOnly: true },
                    { id: 'who', label: 'Who can see it', editorOnly: true },
                ];
                return this.isEditor ? all : all.filter(t => !t.editorOnly);
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

            // ── Cross-Role Rules (MS-221) ────────────────────────────────────
            //
            // A Role's own rules are written in the Roles Manager, because they
            // are facts about that Role wherever it runs. A rule about a PAIR of
            // Roles is not — it is a fact about this Event, the only thing that
            // knows the two run together — so it is written here.

            get pairRules() {
                return Series.crossRoleRulesOf(this.chosen);
            },

            // Family and Marriage come from the Membership Directory and need no
            // elder to share them; anything else an elder has shared joins them.
            get pairTypeOptions() {
                return Roles.DIRECTORY_GROUP_TYPES.concat(this.sharedGroupTypes);
            },

            // Both pickers offer every Role on this Event. Liturgical ones are
            // included on purpose: "the preacher and the service leader must not
            // be married" is the same rule, and the roster judge sees liturgy.
            get pairRoleOptions() {
                return ((this.chosen && this.chosen.roleSlugs) || []).map(slug => ({
                    slug: slug,
                    name: this.roleName(slug),
                }));
            },

            roleName(slug) {
                const def = this.roleDefinitions.find(d => d.slug === slug);
                if (def && def.name) return def.name;
                const liturgical = Roles.LITURGICAL_ROLES.find(r => r.slug === slug);
                return (liturgical && liturgical.name) || slug;
            },

            typeName(typeId) {
                const type = this.pairTypeOptions.find(t => t.id === typeId);
                return (type && type.name) || null;
            },

            // A rule the editor can check by reading it, in the same words the
            // Roles Manager uses for the one-Role version.
            pairRuleSentence(rule) {
                const type = this.typeName(rule && rule.typeId);
                const pair = ((rule && rule.roleSlugs) || []).map(slug => this.roleName(slug));
                if (!type) {
                    return 'This rule is unavailable — an elder is no longer sharing the relationship '
                        + 'type it uses with editors. Remove it, or ask an elder to share that type again.';
                }
                return rule.kind === Roles.RESTRICTIONS.SAME_GROUP
                    ? `${pair[0]} and ${pair[1]} must be from the same "${type}"`
                    : `${pair[0]} and ${pair[1]} cannot be from the same "${type}"`;
            },

            pairRuleAvailable(rule) {
                return Roles.validateCrossRoleRule(
                    rule, this.sharedGroupTypes, null
                ).valid;
            },

            get pairRuleErrors() {
                if (!this.newPairTypeId || !this.newPairRoleA || !this.newPairRoleB) return [];
                return Roles.validateCrossRoleRule({
                    kind: this.newPairKind,
                    typeId: this.newPairTypeId,
                    roleSlugs: [this.newPairRoleA, this.newPairRoleB],
                }, this.sharedGroupTypes, (this.chosen && this.chosen.roleSlugs) || []).errors;
            },

            async addPairRule() {
                if (!this.chosen || this.savingPairRule) return;
                const rule = {
                    kind: this.newPairKind,
                    typeId: this.newPairTypeId,
                    roleSlugs: [this.newPairRoleA, this.newPairRoleB],
                };
                const check = Roles.validateCrossRoleRule(
                    rule, this.sharedGroupTypes, (this.chosen && this.chosen.roleSlugs) || []
                );
                if (!check.valid) {
                    this.error = check.errors[0];
                    return;
                }
                // The same pair, the same type, the same polarity, twice, is one
                // rule written twice — it would refuse the same person twice.
                const already = this.pairRules.some(r => (
                    r.kind === rule.kind && r.typeId === rule.typeId &&
                    r.roleSlugs.slice().sort().join() === rule.roleSlugs.slice().sort().join()
                ));
                if (already) {
                    this.error = 'That rule is already on this event.';
                    return;
                }
                await this.savePairRules(Series.addCrossRoleRule(this.chosen, rule));
                this.newPairTypeId = '';
                this.newPairRoleA = '';
                this.newPairRoleB = '';
            },

            async removePairRule(index) {
                if (!this.chosen || this.savingPairRule) return;
                await this.savePairRules(Series.removeCrossRoleRule(this.chosen, index));
            },

            // One writer for both, so the list on screen and the list in
            // Firestore can never be two different lists.
            async savePairRules(nextSeries) {
                this.savingPairRule = true;
                this.error = '';
                try {
                    const saved = await Store.setSeriesCrossRoleRules(
                        db, this.seriesId, Series.crossRoleRulesOf(nextSeries)
                    );
                    this.series = this.series.map(s => (
                        s.id === this.seriesId ? Object.assign({}, s, { crossRoleRules: saved }) : s
                    ));
                } catch (e) {
                    console.error('Could not save the cross-Role rule:', e);
                    this.error = 'That rule could not be saved — nothing was changed.';
                } finally {
                    this.savingPairRule = false;
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

            // What pressing it will actually do. The button is in the same place
            // either way, so the label is the only thing that can say whether
            // the ticked columns are coming with you.
            get draftLabel() {
                const range = this.range;
                if (!range) return 'Auto-assign';
                return 'Auto-assign ' + range.spans
                    + (range.spans === 1 ? ' date' : ' dates');
            },

            // ── The other door into the same room ────────────────────────────
            //
            // The same dates, opened on a blank grid. An editor who already
            // knows who they want does not want a draft to argue with, and the
            // long way round to a blank grid was: draft eight dates, then take
            // everybody off them one at a time.
            //
            // Beside the auto-assign button rather than inside the draft room,
            // because the choice is which picture you want drawn FIRST, and by
            // the time you are looking at the wrong one it has been drawn.
            get byHandHref() {
                return Grid.draftRoomHref(this.seriesId, this.range, { byHand: true });
            },

            // Worded to sit alongside its neighbour and carry the same count —
            // both buttons open the same dates, so a count on one of them would
            // read as the difference between them.
            get byHandLabel() {
                const range = this.range;
                if (!range) return 'By hand';
                return 'By hand, ' + range.spans
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
            },

            get seriesDetailsChanged() {
                const s = this.chosen || {};
                return ['name', 'location', 'description'].some(
                    f => String(this.seriesDraft[f] || '') !== String(s[f] || '')
                );
            },

            get seriesDetailsValid() { return !!String(this.seriesDraft.name || '').trim(); },

            async saveSeriesDetails() {
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

            // ── The Roles it carries ─────────────────────────────────────────
            //
            // Liturgical ones are SHOWN and locked: an editor needs to see the
            // whole shape of a Sunday, but those are filled in the order of
            // service and print in the booklet, so this screen can never drop
            // one. They are also never a row on the grid — a row for a Role
            // nobody assigns here would sit empty and read as "nobody is
            // preaching".

            get seriesRoles() {
                const slugs = (this.chosen && this.chosen.roleSlugs) || [];
                const locked = (this.chosen && this.chosen.lockedRoleSlugs) || [];
                return slugs.map(slug => {
                    const def = this.roleDefinitions.find(d => d.slug === slug);
                    const slots = (def && def.slots) || [];
                    return {
                        slug: slug,
                        name: this.roleName(slug),
                        slots: slots,
                        // What an editor is deciding is how many people have to
                        // be there on the day. "Places" is the model's word for
                        // it, and the model is not who is reading this.
                        needed: slots.length
                            ? 'Needs ' + slots.length + (slots.length === 1 ? ' person' : ' people')
                            : 'Nobody needed yet',
                        locked: locked.indexOf(slug) !== -1
                            || Roles.LITURGICAL_SLUGS.indexOf(slug) !== -1,
                    };
                });
            },

            get liturgicalRoles() { return this.seriesRoles.filter(r => r.locked); },
            get servantRoles() { return this.seriesRoles.filter(r => !r.locked); },

            get seriesRolesAvailable() {
                const on = (this.chosen && this.chosen.roleSlugs) || [];
                return this.roleDefinitions
                    .filter(d => Roles.LITURGICAL_SLUGS.indexOf(d.slug) === -1)
                    .filter(d => on.indexOf(d.slug) === -1);
            },

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
                let usage = [];
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

            addSeriesRole(slug) {
                if (!slug || !this.chosen) return;
                return this.setSeriesRoles(((this.chosen.roleSlugs) || []).concat([slug]));
            },

            // Dropping a Role from an Event drops the Cross-Role Rules naming
            // it — `withoutRulesNaming` is the model's own words for why.
            async removeSeriesRole(slug) {
                if (!this.chosen) return;
                const before = this.pairRules.length;
                await this.setSeriesRoles(((this.chosen.roleSlugs) || []).filter(s => s !== slug));

                const next = Series.withoutRulesNaming(this.chosen, slug);
                if (Series.crossRoleRulesOf(next).length !== before) await this.savePairRules(next);
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
        };
    };
})();
