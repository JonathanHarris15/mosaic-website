// Auto-assign — staff a stretch of dates at once (MS-18, ADR-0020).
//
// Its own screen, reached from the Calendar, because it is the one serving
// surface whose subject is a RUN of dates rather than one of them. The Roles
// Manager authors Role Definitions and knows nothing about dates; the Roles tab
// staffs a single date by hand. This starts from an Event and a stretch.
//
// ── What it produces is a DRAFT ──────────────────────────────────────────────
//
// Proposed, not committed. Nothing in it is an Assignment until the editor
// accepts (ADR-0018 fixed that state machine at three states and it gains no
// fourth), so nobody is assigned, nobody is told, and no serve history moves.
//
// ── Desktop only ─────────────────────────────────────────────────────────────
//
// Unlike the Roles Manager this does not open in the phone shell. It is a wide
// grid of dates against Roles and there is no honest phone reading of it, so a
// phone is told so rather than handed a broken table.
//
// This file is the page's behaviour. The stepping itself belongs to
// auto-assign-core, and the fairness to fairness-core — neither is re-stated
// here, and this screen holds no opinion about who may serve.

(function () {
    'use strict';

    const Core = window.EventsOccurrenceCore;
    const Store = window.EventsStore;
    const Roles = window.RolesCore;
    const Events = window.EventsCore;
    const Fairness = window.FairnessCore;
    const Loop = window.AutoAssignCore;
    const Grid = window.AutoAssignGridCore;
    const Edit = window.AutoAssignEditCore;
    const Panel = window.AutoAssignPanelCore;
    const Saved = window.AutoAssignSavedCore;
    const Families = window.FamilyCore;
    const View = window.CalendarView;
    const Dates = window.DateUtils;

    const EDITOR_RANKS = ['editor', 'admin', 'elder', 'super_admin'];

    // Four, eight and twelve occurrences — a month, half a term, a term. Named
    // in OCCURRENCES rather than weeks, because a fortnightly Event's twelve is
    // six months of calendar and the number that means anything is its own.
    const PRESETS = [4, 8, 12];

    function addDays(dateStr, n) {
        return Dates.addDays(dateStr, n);
    }

    window.autoAssignPage = function () {
        return {
            // ── Who is looking ───────────────────────────────────────────────
            rank: null,
            personId: null,
            loading: true,
            error: '',

            // Something the editor should know that is not a reason to stop —
            // a cold start, or a history read that came back empty-handed.
            notice: '',

            // 'setup' → 'draft'. There is no third: accepting leaves the page.
            view: 'setup',

            // ── Setup ────────────────────────────────────────────────────────
            series: [],
            seriesId: '',
            fromDate: '',
            toDate: '',
            preset: 8,

            // What to do with places on dates in the range that already have
            // somebody in them. Defaults to keeping them: an assignment exists
            // because a person put it there, and the recovery from a bad default
            // is wildly lopsided — if you kept work you wanted redrawn you drag
            // a few cards, if you blew away work you wanted kept it is gone and
            // you may not notice which dates it was on.
            choice: Loop.CHOICES.KEEP,
            occupied: [],           // dates in the range that already have people

            // ── Everything the solve needs ───────────────────────────────────
            people: [],
            roleDefinitions: [],
            relationships: [],
            groups: [],
            hidingTags: [],
            tagNames: {},           // tagId → name, so a rule can name itself
            history: [],
            existing: {},           // date → assignments already there
            occurrences: {},        // date → the occurrence, for its one-off jobs
            liturgical: {},         // date → [{ personId, roleSlug }]
            drafting: false,

            draft: null,

            // The draft, transposed for the screen. Rebuilt only when the draft
            // is, never on a render — the numbers on it cost a pass over the
            // whole serve history and Alpine would ask for them constantly.
            grid: null,
            focused: 0,             // which date the range strip is pointing at

            // Where the grid is scrolled to, as a fraction of the whole range.
            // The strip draws a window from these, so the overview shows you
            // not just what is wrong but whereabouts you are standing.
            viewLeft: 0,
            viewWidth: 1,

            // What is in the hand, and who got knocked out. A displaced person
            // is a thing the screen has to show: they were on the rota a second
            // ago and vanishing them makes the editor rebuild it from memory.
            dragging: null,         // { personId, from: place|null, source }
            over: null,             // the place key under the pointer
            displaced: [],          // [{ personId, date }]

            // ── The panel ────────────────────────────────────────────────────
            // Two jobs, one at a time: search the church, or explain a
            // placement. Closing the explanation returns to the directory.
            search: '',
            selected: null,         // { date, roleSlug, slotId, personId }
            seedRole: '',
            seedDate: '',
            seeding: false,
            seedNote: '',

            // ── Staleness (MS-181) ───────────────────────────────────────────
            // Each date was drafted reading the dates before it as history, so
            // editing the 5th leaves every later column balanced against a
            // Sunday that no longer exists. Nothing re-solves on its own — a
            // table that rearranges itself while it is being reviewed cannot be
            // reviewed (ADR-0020 §6) — so the drift is NAMED instead.
            staleFrom: null,        // index of the earliest column now out of date
            edited: {},             // date → the editor has touched it by hand

            // ── Kept in the browser (MS-184) ─────────────────────────────────
            offered: null,          // a stored draft waiting to be resumed
            offerStale: [],

            // Liturgy is three names a date and is READ-ONLY here, so it is the
            // first thing worth folding away when the grid runs out of room.
            // Folded, not hidden: it still says who is tied up, because that is
            // WHY somebody is missing from every row below.
            liturgyOpen: true,

            // The directory drawer. Open by default — the first thing most
            // editors do to a draft is put somebody in it by hand — but 320px
            // is a column and a half of grid, and reading a wide range does
            // not need the directory at all.
            panelOpen: true,

            // ── Loading ──────────────────────────────────────────────────────

            async init() {
                this.rank = await this.resolveRank();
                if (!this.isEditor) { this.loading = false; return; }

                try {
                    await this.loadSeries();
                } catch (e) {
                    console.error('Could not read the events:', e);
                    this.error = 'The list of events could not be read. That is a permissions ' +
                        'problem rather than an empty church — please tell an admin.';
                }

                this.restoreLiturgyFold();
                this.restorePanelDrawer();

                const today = Dates.todayStr();
                this.fromDate = addDays(today, 1);
                this.applyPreset(this.preset);
                this.loading = false;
            },

            // The setup step already re-reads what is on the range when it
            // changes; a saved draft is checked at the same moment, so the
            // offer appears beside the range it belongs to rather than at load
            // time against whatever range happened to be default.
            onRangeSettled() {
                this.onRangeChanged();
                this.offerStored();
            },

            async resolveRank() {
                return new Promise(resolve => {
                    auth.onAuthStateChanged(async user => {
                        if (!user) { this.personId = null; return resolve(null); }
                        const Cache = window.MosaicLocalCache;
                        const known = Cache && Cache.readIdentity(user.uid);
                        if (known && known.permissionLevel) {
                            this.personId = known.personId || null;
                            return resolve(known.permissionLevel);
                        }
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

            // Only a SERIES can be drafted. A one-off Event belongs to no series,
            // so it has no run of past occurrences to be fair across — there is
            // nothing to balance and nothing to balance it against.
            async loadSeries() {
                const all = await Store.loadVisibleSeries(db, {
                    rank: this.rank, personId: this.personId,
                });
                this.series = all
                    .filter(s => s && (s.recurrence || s.id === Core.SUNDAY_SERVICE_ID))
                    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
                if (this.series.length) this.seriesId = this.series[0].id;
            },

            // ── Who is looking ───────────────────────────────────────────────

            get isEditor() { return EDITOR_RANKS.indexOf(this.rank) !== -1; },
            get signedOut() { return !this.loading && !this.rank; },
            get refused() { return !this.loading && !!this.rank && !this.isEditor; },

            // ── The chosen series ────────────────────────────────────────────

            get chosen() {
                return this.series.filter(s => s.id === this.seriesId)[0] || null;
            },

            get rule() {
                const s = this.chosen;
                if (!s) return null;
                return s.recurrence || (s.id === Core.SUNDAY_SERVICE_ID ? Store.SUNDAY_RULE : null);
            },

            get occurrenceUnit() {
                return this.seriesId === Core.SUNDAY_SERVICE_ID ? 'Sunday' : 'date';
            },

            // ── The range ────────────────────────────────────────────────────

            get presets() { return PRESETS; },

            // A preset is a number of OCCURRENCES, not of weeks, so it has to be
            // resolved through the recurrence rule rather than by adding days.
            // Reaches forward generously and takes the first N the rule produces.
            applyPreset(n) {
                this.preset = n;
                const rule = this.rule;
                if (!rule || !this.fromDate) return;
                const far = addDays(this.fromDate, Math.ceil(n * 31) + 31);
                const dates = Core.datesBetween(rule, this.fromDate, far);
                this.toDate = dates.length ? dates[Math.min(n, dates.length) - 1] : far;
                this.onRangeSettled();
            },

            get resolvedDates() {
                const rule = this.rule;
                if (!rule || !this.fromDate || !this.toDate) return [];
                if (this.toDate < this.fromDate) return [];
                return Core.datesBetween(rule, this.fromDate, this.toDate);
            },

            get resolvedLine() {
                const dates = this.resolvedDates;
                if (!this.chosen) return 'Pick an event to start.';
                if (!dates.length) return 'No dates of this event fall in that range.';
                const unit = this.occurrenceUnit + (dates.length === 1 ? '' : 's');
                return dates.length + ' ' + unit + ', ' +
                    Core.dayMonth(dates[0]) + ' – ' + Core.dayMonth(dates[dates.length - 1]);
            },

            // No cap and no warning past the fairness window. A draft that far
            // out is a sketch, and re-draft-from-here is how it gets refreshed
            // as the dates come close — so there is nothing to refuse.
            get canDraft() {
                return !!this.chosen && this.resolvedDates.length > 0 && !this.drafting;
            },

            // ── What is already on those dates ───────────────────────────────

            rangeToken: 0,

            onRangeChanged() {
                const token = ++this.rangeToken;
                const dates = this.resolvedDates;
                if (!dates.length) { this.occupied = []; return; }

                Store.loadVisibleOccurrences(db, {
                    rank: this.rank,
                    personId: this.personId,
                    from: dates[0],
                    to: dates[dates.length - 1],
                })
                    .then(occs => Store.attachRosters(db, occs, {
                        rank: this.rank, personId: this.personId, staffingFrom: dates[0],
                    }))
                    .then(occs => {
                        if (token !== this.rangeToken) return;   // a later range won
                        const inRange = {};
                        dates.forEach(d => { inRange[d] = true; });
                        this.existing = {};
                        this.occurrences = {};
                        occs.forEach(o => {
                            if (!inRange[o.date]) return;
                            this.occurrences[o.date] = o;
                            const roster = (o.assignments || []).filter(a => a && a.personId);
                            if (roster.length) this.existing[o.date] = roster;
                        });
                        this.occupied = Object.keys(this.existing).sort();
                    })
                    .catch(e => {
                        console.error('Could not check what is already on these dates:', e);
                        if (token === this.rangeToken) {
                            this.existing = {}; this.occurrences = {}; this.occupied = [];
                        }
                    });
            },

            get hasOccupied() { return this.occupied.length > 0; },

            get occupiedLine() {
                const n = this.occupied.length;
                const unit = this.occurrenceUnit.toLowerCase() + (n === 1 ? '' : 's');
                return n === 1
                    ? 'One of these dates already has people on it'
                    : n + ' of these ' + unit + ' already have people on them';
            },

            get choices() {
                return [
                    {
                        id: Loop.CHOICES.KEEP, icon: 'shield', label: 'Keep them',
                        desc: 'Fill around what is already there.',
                    },
                    {
                        id: Loop.CHOICES.REPLACE, icon: 'autorenew', label: 'Replace them',
                        desc: 'Draw those places again from scratch.',
                    },
                    {
                        id: Loop.CHOICES.LEAVE_OUT, icon: 'block', label: 'Leave out',
                        desc: 'Do not touch those dates at all.',
                    },
                ];
            },

            // Whatever the choice, a Confirmed assignment is never touched and a
            // Declined one always reads as an empty place. Said out loud,
            // because all three options otherwise look more destructive than
            // they are.
            get choiceFootnote() {
                return 'Anyone who has already said yes stays put, whichever you pick. ' +
                    'Anyone who said no has their place offered to somebody else.';
            },

            // ── Drafting ─────────────────────────────────────────────────────

            async runDraft() {
                if (!this.canDraft) return;
                this.drafting = true;
                this.error = '';
                this.notice = '';

                try {
                    await this.loadForDraft();
                    this.draft = Loop.draft(this.draftOptions());
                    this.displaced = [];
                    this.staleFrom = null;
                    this.edited = {};
                    this.seenProblems = false;
                    this.accepted = null;
                    this.buildGrid();
                    this.remember();
                    this.focused = 0;
                    this.showDraft();
                } catch (e) {
                    console.error('Could not draft the roster:', e);
                    this.error = 'The roster could not be drafted. ' +
                        (e && e.message ? e.message : 'Something went wrong reading the data it needs.');
                } finally {
                    this.drafting = false;
                }
            },

            // Everything the solve asks for, read once. The relationship and tag
            // reads are constrained the same way the Roles Manager constrains
            // them — a serving rule may only name a Type an elder shared with
            // editors, and an unconstrained query errors rather than returning
            // less (ADR-0017, MS-128).
            async loadForDraft() {
                const dates = this.resolvedDates;

                const [people, roles, rels, groups, families] = await Promise.all([
                    db.collection('people').get(),
                    db.collection('roles').get(),
                    db.collection('relationships').where('sharedWithEditors', '==', true).get()
                        .catch(() => ({ docs: [] })),
                    db.collection('relationship_groups').where('sharedWithEditors', '==', true).get()
                        .catch(() => ({ docs: [] })),
                    // Family and Marriage come from the Membership Directory,
                    // not from a hand-rostered group — so they need no sharing,
                    // and they arrive in the shape the rules already read.
                    db.collection('families').get().catch(() => ({ docs: [] })),
                ]);

                this.people = people.docs.map(d => Object.assign({ id: d.id }, d.data()));
                this.roleDefinitions = roles.docs.map(d => Object.assign({ id: d.id }, d.data()));
                this.relationships = rels.docs.map(d => d.data());
                this.groups = groups.docs
                    .map(d => Object.assign({ id: d.id }, d.data()))
                    .concat(Families.servingGroups(
                        families.docs.map(d => Object.assign({ id: d.id }, d.data())),
                        this.people
                    ));

                await this.loadHidingTags();
                await Promise.all([this.loadHistory(dates), this.loadLiturgy(dates)]);
            },

            // A refused read leaves this EMPTY, which offers everyone — the
            // wrong direction for a privacy rule, so it is said out loud rather
            // than quietly drafting people a tag exists to hide.
            async loadHidingTags() {
                try {
                    const snap = await db.collection('people_tags').get();
                    this.hidingTags = snap.docs
                        .filter(d => (d.data() || {}).hidePeople === true)
                        .map(d => d.id);
                    this.tagNames = {};
                    snap.docs.forEach(d => { this.tagNames[d.id] = (d.data() || {}).name || ''; });
                } catch (e) {
                    console.error('Could not read which tags hide people:', e);
                    this.hidingTags = [];
                    this.error = 'The privacy tags could not be read, so anybody hidden by ' +
                        'one may be drafted. Check the names before you accept.';
                }
            },

            // ⚠ THE WINDOW COMES FROM THE RECURRENCE RULE, NOT THE SERVE LOG.
            // Three quiet Sundays still happened; a window built from the dates
            // that appear in the log would skip them and quietly stretch "the
            // last twelve" over a longer run of calendar than it claims.
            get pastDates() {
                const rule = this.rule;
                const dates = this.resolvedDates;
                if (!rule || !dates.length) return [];
                const size = this.windowSize;
                const from = addDays(dates[0], -Math.ceil(size * 31));
                return Core.datesBetween(rule, from, addDays(dates[0], -1))
                    .reverse()
                    .slice(0, size);
            },

            get windowSize() { return Events.fairnessWindowOf(this.chosen); },

            // ⚠ NO HISTORY IS A LEGITIMATE STATE, NOT A FAILURE. A managed Role
            // launches cold, and its first draft has nothing to be fair across —
            // everybody starts level and the run itself lays down the record the
            // next draft reads. So this never blocks a draft. It only says which
            // of the two silences it is: nothing served yet, or nothing readable.
            async loadHistory(dates) {
                this.history = [];
                this.notice = '';
                const past = this.pastDates;
                if (!past.length) return;
                const earliest = past[past.length - 1];

                try {
                    // The orderBy is NOT cosmetic. An inequality with no order
                    // implies ASCENDING, and the deployed composite index is
                    // (seriesId ASC, serviceDate DESC) — which cannot serve it.
                    // Naming the descending order is what makes the query match.
                    const snap = await db.collectionGroup('involvement')
                        .where('seriesId', '==', this.seriesId)
                        .where('serviceDate', '>=', earliest)
                        .orderBy('serviceDate', 'desc')
                        .get();
                    this.history = snap.docs.map(d => {
                        const data = d.data() || {};
                        return {
                            personId: d.ref.parent.parent.id,
                            type: data.type,
                            serviceDate: data.serviceDate,
                            seriesId: Events.seriesIdOf(data),
                            metadata: data.metadata || null,
                        };
                    });
                    if (!this.history.length) {
                        this.notice = 'Nobody has served this event in the last ' +
                            past.length + ' ' + this.occurrenceUnit.toLowerCase() +
                            (past.length === 1 ? '' : 's') +
                            ', so everybody starts level and the draft spreads the work evenly.';
                    }
                } catch (e) {
                    // Everybody reads as equally fresh, which is a draft that
                    // looks fine and is not. Say so, and let it through anyway —
                    // a roster the editor can fix beats no roster at all.
                    console.error('Could not read the serve history:', e);
                    this.notice = 'The serve history could not be read, so everybody counts ' +
                        'as fresh. The draft will still be sensible, but it cannot know who ' +
                        'has carried this lately — check the names before you accept.';
                }
            },

            // Liturgy is fields on the Service document rather than Assignments,
            // so it cannot come back with the roster and has to be read per date.
            // Only a Sunday has any.
            async loadLiturgy(dates) {
                this.liturgical = {};
                if (this.seriesId !== Core.SUNDAY_SERVICE_ID) return;

                const holders = await Promise.all(dates.map(date =>
                    Store.loadLiturgicalHolders(db, date).catch(() => [])
                ));
                dates.forEach((date, i) => { this.liturgical[date] = holders[i] || []; });
            },

            // ── Wiring the loop ──────────────────────────────────────────────

            // The MANAGED Roles this series carries, minus the liturgical ones —
            // those are never drawn as fillable places (ADR-0018 §2), and a
            // one-off Role has no definition for a solve to reason about.
            get draftableRoles() {
                const carried = (this.chosen && this.chosen.roleSlugs) || [];
                return carried
                    .filter(slug => Roles.LITURGICAL_SLUGS.indexOf(slug) === -1)
                    .map(slug => this.roleDefinitions.filter(d => d.slug === slug)[0])
                    .filter(Boolean);
            },

            get assignablePeople() {
                return Roles.assignablePeople(this.people, {
                    rank: this.rank,
                    hidingTags: this.hidingTags,
                });
            },

            // Intensity has three homes and every one-off Role shares the one
            // reserved slug, so this has to be a function of the RECORD rather
            // than a map keyed by slug — no map could tell two one-offs apart.
            intensityForRecord(record) {
                return Events.roleIntensity(this.chosen, record.type, {
                    definition: this.roleDefinitions.filter(d => d.slug === record.type)[0] || null,
                    oneOff: (record.metadata && record.metadata.oneOffId)
                        ? { id: record.metadata.oneOffId }
                        : null,
                });
            },

            draftOptions() {
                return {
                    dates: this.resolvedDates,
                    pastDates: this.pastDates,
                    history: this.history,
                    existing: this.existing,
                    choice: this.choice,
                    roles: this.draftableRoles,
                    people: this.assignablePeople,
                    windowSize: this.windowSize,
                    seriesId: this.seriesId,
                    solve: Fairness.solve,
                    candidatesFor: Roles.candidatesFor,
                    intensityOf: record => this.intensityForRecord(record),
                    liturgicalSlugs: Roles.LITURGICAL_SLUGS,
                    liturgicalHoldersFor: date => (this.liturgical[date] || []).map(h => h.personId),
                    relationships: this.relationships,
                    groups: this.groups,
                };
            },

            // ── The draft, transposed for the screen ─────────────────────────

            // ⚠ EVERY NUMBER ON A CARD IS READ AS OF ITS OWN DATE.
            //
            // Load and recency both move as the loop walks the range — that is
            // the entire point of the carry-forward — so a single figure for
            // the whole range would contradict the draft it is describing:
            // somebody the solver correctly seated on week one would show as
            // over budget because of the work week four gave them.
            //
            // So this walks the range again, rebuilding the history each date
            // saw at the moment it was staffed. The same pile, in the same
            // order, as `AutoAssignCore.run`.
            buildGrid() {
                if (!this.draft) { this.grid = null; return; }

                const dates = this.resolvedDates;
                const roles = this.draftableRoles;
                const size = this.windowSize;
                const intensity = record => this.intensityForRecord(record);

                const loads = {};
                const recencies = {};
                const warnings = {};
                let history = this.history.slice();

                this.draft.dates.forEach((day, index) => {
                    const window = Fairness.windowDates(
                        Loop.windowFor(dates, index, this.pastDates), size
                    );

                    loads[day.date] = Fairness.loadOf(history, window, intensity);

                    const perRole = {};
                    roles.forEach(role => {
                        perRole[role.slug] = Fairness.recencyOf(history, window, role.slug);
                    });
                    recencies[day.date] = perRole;

                    // The same judgment the Roles tab makes, on the same rules
                    // (ADR-0021). A drafted roster gets no easier a ride than a
                    // hand-made one.
                    warnings[day.date] = Roles.warningsFor(day.seats, {
                        roles: roles,
                        people: this.people,
                        relationships: this.relationships,
                        groups: this.groups,
                        liturgicalHolders: this.liturgical[day.date] || [],
                    });

                    history = history.concat(
                        Loop.historyFrom(day.seats, day.date, this.seriesId)
                    );
                });

                // Kept, because the panel asks the same questions of people who
                // are NOT on the grid — everyone in the directory needs a load
                // reading, and it has to be the same one the cards use.
                this.loadsByDate = loads;

                this.grid = Grid.gridFrom({
                    dates: this.draft.dates,
                    roles: roles,
                    windowSize: size,
                    nameOf: id => this.personName(id),
                    roleNameOf: slug => this.roleName(slug),
                    labelOf: date => Core.dayMonth(date),
                    loadAt: (date, personId) => (loads[date] || {})[personId] || 0,
                    // ⚠ ABSENT IS NOT UNKNOWN. Somebody with no record of this
                    // Role has not held it inside the window, which fairness
                    // reads as a full window's rest — so the card has to read
                    // it the same way, or a brand-new volunteer would be the
                    // one person on the grid with a blank where everybody else
                    // has a number. A one-off job has no window at all, and
                    // that IS unknown.
                    recencyAt: (date, roleSlug, personId) => {
                        const map = (recencies[date] || {})[roleSlug];
                        if (!map) return null;
                        return Fairness.recencyFor(map, personId, size);
                    },
                    warningAt: (date, roleSlug, slotId) => (
                        (warnings[date] || []).filter(w => (
                            w.roleSlug === roleSlug && w.slotId === slotId
                        ))[0] || null
                    ),
                    liturgicalAt: date => this.liturgical[date] || [],
                    oneOffsAt: date => ((this.occurrences[date] || {}).oneOffRoles) || [],
                    oneOffPeopleAt: date => (this.existing[date] || []).filter(a => a.oneOffId),
                    reasonText: (detail, ctx) => this.reasonWords(detail, ctx),
                });
            },

            // One phrasing of "why not", shared with the Roles tab. `blockReason`
            // is where those sentences live, and a second set written here would
            // drift from it the first time one was reworded.
            reasonWords(detail, context) {
                if (!detail || !detail.reason) return null;
                const ctx = context || {};
                const other = (this.existing[ctx.date] || [])
                    .filter(a => a.personId === detail.personId && a.roleSlug !== ctx.roleSlug)
                    .map(a => this.roleName(a.roleSlug));

                return View.blockReason(
                    Object.assign({ eligible: false }, detail),
                    {
                        people: this.people,
                        // ⚠ THE REQUIREMENT IS NOT ON THE WARNING. It belongs
                        // to the SLOT, and without looking it up every sex
                        // mismatch falls to the default and tells a woman in a
                        // woman's place that the place needs a man.
                        requirement: this.requirementAt(ctx.roleSlug, ctx.slotId),
                        tagName: this.tagNames[detail.tagId] || '',
                        groupName: detail.groupName || '',
                        otherRoles: other.concat(
                            detail.heldRoleSlug ? [this.roleName(detail.heldRoleSlug)] : []
                        ),
                    }
                );
            },

            requirementAt(roleSlug, slotId) {
                const def = this.roleDefinitions.filter(d => d.slug === roleSlug)[0];
                const slot = ((def && def.slots) || []).filter(s => s.id === slotId)[0];
                return (slot && slot.requirement) || null;
            },

            // ── The range strip ──────────────────────────────────────────────

            get columns() { return (this.grid && this.grid.columns) || []; },
            get rows() { return (this.grid && this.grid.rows) || []; },

            // Alpine cannot bind x-ref dynamically, so the column is found by
            // attribute. `block: 'nearest'` keeps the vertical scroll where the
            // editor left it — jumping to a date should not also lose the Role
            // they were looking at.
            focusDate(index) {
                this.focused = index;
                if (typeof document === 'undefined' || !document.querySelector) return;
                const el = document.querySelector('.aa-grid [data-col="' + index + '"]');
                if (el && el.scrollIntoView) {
                    el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
                }
            },

            // ── The window that follows the scroll ───────────────────────────
            //
            // Read off the grid rather than counted in dates: a column is 220px
            // and the viewport is whatever the editor's window is, so the
            // fraction is the only honest answer. Both ends of this are live —
            // scrolling moves the window, dragging the window scrolls.

            onGridScroll(el) {
                if (!el || !el.scrollWidth) return;
                this.viewLeft = el.scrollLeft / el.scrollWidth;
                this.viewWidth = Math.min(1, el.clientWidth / el.scrollWidth);
                this.focused = this.nearestColumn();
            },

            // ⚠ A HIDDEN GRID HAS NO WIDTH. The scroller's own `x-init` runs
            // while the setup step is still showing, so what it measures is
            // zero by zero — and the untouched starting value says the grid
            // fits entirely. That draws the window across the whole strip and
            // leaves it dead in the hand, which is exactly the two symptoms
            // together: too wide, and it will not drag.
            //
            // So the measurement is taken when the grid is ON SCREEN, and
            // again whenever the room it has to sit in changes.
            measureGrid() {
                const attempt = (left) => {
                    const el = this.$refs && this.$refs.scroller;
                    if (el && el.scrollWidth) { this.onGridScroll(el); return; }
                    // The rows are drawn a moment after the view flips. Worth
                    // a couple of frames rather than one and a wrong answer.
                    if (left > 0) this.afterPaint(() => attempt(left - 1));
                };
                this.afterPaint(() => attempt(3));
            },

            afterPaint(fn) {
                const raf = typeof window !== 'undefined' && window.requestAnimationFrame;
                if (raf) raf.call(window, fn); else fn();
            },

            showDraft() {
                this.view = 'draft';
                this.measureGrid();
            },

            // The LEFTMOST visible date, not the middle of the window. A grid is
            // read left to right, so where you are is where it starts — and the
            // middle of a window covering everything is date three of five,
            // which is nowhere anybody is looking.
            nearestColumn() {
                const n = this.columns.length;
                if (!n) return 0;
                return Math.max(0, Math.min(n - 1, Math.floor(this.viewLeft * n)));
            },

            // ── The strip IS the horizontal scrollbar ────────────────────────
            //
            // So the window behaves like a thumb: you grab it WHERE YOU GRABBED
            // IT and it follows one-to-one. Centring it on the pointer instead
            // means the grid lurches sideways the moment you take hold, which
            // is the difference between dragging a scrollbar and being thrown
            // by one.
            //
            // A press on the empty track still jumps — that is what a scrollbar
            // track does, and it is how the far end of a long range stays one
            // click away.

            scrubbing: false,
            grabbedAt: 0,           // where in the thumb the pointer took hold

            fractionAt(event, strip) {
                const box = strip.getBoundingClientRect();
                if (!box.width) return null;
                return (event.clientX - box.left) / box.width;
            },

            // Nothing to scroll means nothing to drag, and a grab cursor over a
            // control that does nothing is a small lie.
            get canScrub() { return this.viewWidth < 1; },

            startScrub(event, strip) {
                if (!this.canScrub) return;
                const at = this.fractionAt(event, strip);
                if (at === null) return;

                const onThumb = at >= this.viewLeft && at <= this.viewLeft + this.viewWidth;
                this.grabbedAt = onThumb ? (at - this.viewLeft) : this.viewWidth / 2;
                this.scrubbing = true;
                this.scrubTo(event, strip);
            },

            scrubTo(event, strip) {
                const scroller = this.$refs.scroller;
                if (!scroller || !strip) return;
                const at = this.fractionAt(event, strip);
                if (at === null) return;

                const left = at - this.grabbedAt;
                const room = Math.max(0, 1 - this.viewWidth);
                scroller.scrollLeft = Math.max(0, Math.min(room, left)) * scroller.scrollWidth;
            },

            moveScrub(event, strip) {
                if (this.scrubbing) this.scrubTo(event, strip);
            },

            endScrub() { this.scrubbing = false; },

            // ── Dragging people about ────────────────────────────────────────

            placeKey(place) {
                return String(place.roleSlug) + '|' + String(place.slotId);
            },

            cellKey(date, place) {
                return date + '|' + this.placeKey(place);
            },

            // From a card already on the grid. `from` is what makes it a MOVE
            // rather than a copy — without it the person stays where they were
            // as well as arriving where they went.
            startDrag(event, personId, from, source) {
                this.dragging = { personId: personId, from: from || null, source: source || 'grid' };
                if (event && event.dataTransfer) {
                    event.dataTransfer.effectAllowed = 'move';
                    // Firefox refuses to start a drag with nothing on the
                    // clipboard, however little the payload is used.
                    try { event.dataTransfer.setData('text/plain', personId); } catch (e) { /* ignore */ }
                }
            },

            endDrag() {
                this.dragging = null;
                this.over = null;
                this.stopEdgeScroll();
            },

            dragOver(key) { if (this.dragging) this.over = key; },

            // ── Dragging to the edge scrolls the grid ────────────────────────
            //
            // A drag holds the pointer captive: the editor cannot reach the
            // range strip with the hand that is already carrying somebody.
            //
            // ⚠ DRIVEN BY A FRAME LOOP, NOT BY `dragover`. A pointer held
            // still at the edge stops firing dragover in some browsers, and
            // "it scrolls only while I wiggle" is worse than not scrolling at
            // all. So dragover just records WHERE the pointer is; the loop
            // reads that spot every frame until the drag ends.

            edgeAim: null,          // last pointer position, in screen pixels
            edgeFrame: null,

            edgeScrollAt(event) {
                if (!this.dragging || !event) return;
                this.edgeAim = { x: event.clientX, y: event.clientY };
                this.runEdgeScroll();
            },

            runEdgeScroll() {
                if (this.edgeFrame !== null) return;
                const raf = typeof window !== 'undefined' && window.requestAnimationFrame;
                if (!raf) return;

                const step = () => {
                    this.edgeFrame = null;
                    if (!this.dragging || !this.edgeAim) return;
                    this.pullGrid();
                    this.edgeFrame = raf.call(window, step);
                };
                this.edgeFrame = raf.call(window, step);
            },

            // One tick of the pull. Separated so a test can drive it without a
            // browser's frame clock.
            pullGrid() {
                const scroller = this.$refs && this.$refs.scroller;
                // The CLIP is what you can see; the scroller hangs 18px below
                // it so its own scrollbar falls off the bottom.
                const box = (this.$refs && this.$refs.clip) || scroller;
                if (!scroller || !box || !box.getBoundingClientRect) return;

                const by = Grid.edgeScroll(box.getBoundingClientRect(), this.edgeAim);
                if (!by.x && !by.y) return;

                if (by.x) scroller.scrollLeft = Math.max(0, scroller.scrollLeft + by.x);
                if (by.y) scroller.scrollTop = Math.max(0, scroller.scrollTop + by.y);
                this.onGridScroll(scroller);
            },

            stopEdgeScroll() {
                this.edgeAim = null;
                if (this.edgeFrame === null) return;
                const cancel = typeof window !== 'undefined' && window.cancelAnimationFrame;
                if (cancel) cancel.call(window, this.edgeFrame);
                this.edgeFrame = null;
            },

            dropOn(date, place) {
                const held = this.dragging;
                this.over = null;
                if (!held || !this.draft) return;
                this.dragging = null;

                const result = Edit.place(this.draft, {
                    personId: held.personId,
                    from: held.from,
                    to: {
                        date: date,
                        roleSlug: place.roleSlug,
                        slotId: place.slotId,
                        oneOffId: place.oneOffId || null,
                    },
                });

                this.draft = result.draft;
                if (result.displaced) {
                    this.displaced = Edit.addDisplaced(this.displaced,
                        Object.assign({ roleSlug: place.roleSlug }, result.displaced));
                }
                // Whoever was waiting has now been placed.
                this.displaced = Edit.removeDisplaced(this.displaced, {
                    personId: held.personId,
                    date: (held.source === 'rail' && held.from) ? held.from.date : date,
                });
                this.buildGrid();
                // Both ends of a move drift the dates after them.
                if (held.from && held.from.date) this.markStaleAfter(held.from.date);
                this.markStaleAfter(date);
                this.remember();
            },

            // Onto the rail: taken off the rota, still on screen. An emptied
            // place and a person with nowhere to go are different things, and
            // the editor needs to see both.
            dropOnRail() {
                const held = this.dragging;
                this.over = null;
                if (!held || !held.from || !this.draft) { this.dragging = null; return; }
                this.dragging = null;

                const out = Edit.clear(this.draft, held.from);
                this.draft = out.draft;
                if (out.removed) {
                    this.displaced = Edit.addDisplaced(this.displaced,
                        Object.assign({ roleSlug: held.from.roleSlug }, out.removed));
                }
                this.buildGrid();
                this.markStaleAfter(held.from.date);
                this.remember();
            },

            // Off the rail entirely — they are not being placed and they are
            // not waiting. The only way a name leaves the screen on purpose.
            dismiss(person) {
                this.displaced = Edit.removeDisplaced(this.displaced, person);
            },

            // ── The panel ────────────────────────────────────────────────────

            // Load for the directory is read at the START of the range: it is a
            // fact about the season so far, not about a date. Every row is
            // measured the same way, which is what makes the ordering mean
            // something.
            loadForDirectory(personId) {
                const first = (this.grid && this.grid.columns[0]) || null;
                if (!first) return 0;
                return this.gridLoadAt(first.date, personId);
            },

            gridLoadAt(date, personId) {
                return (this.loadsByDate[date] || {})[personId] || 0;
            },

            loadsByDate: {},

            get directory() {
                return Panel.directory({
                    people: this.assignablePeople,
                    windowSize: this.windowSize,
                    query: this.search,
                    loadAt: id => this.loadForDirectory(id),
                    servingCount: id => this.servingCount(id),
                });
            },

            servingCount(personId) {
                let n = 0;
                ((this.draft && this.draft.dates) || []).forEach(day => {
                    (day.seats || []).forEach(seat => {
                        if (seat.personId === personId) n++;
                    });
                });
                return n;
            },

            selectPlace(date, place) {
                if (!place.filled) { this.selected = null; return; }
                this.selected = {
                    date: date,
                    roleSlug: place.roleSlug,
                    slotId: place.slotId,
                    personId: place.card.personId,
                };
                this.seedRole = place.roleSlug;
                this.seedNote = '';
                // Asking why is asking for the panel. A shut drawer would
                // swallow the answer and look like the click did nothing.
                this.panelOpen = true;
            },

            closePanel() { this.selected = null; this.seedNote = ''; },

            get isSelected() {
                return (date, place) => !!this.selected
                    && this.selected.date === date
                    && this.selected.roleSlug === place.roleSlug
                    && String(this.selected.slotId) === String(place.slotId);
            },

            // Everything the panel says about one placement, rebuilt on read
            // because the roster underneath it keeps moving.
            get placement() {
                const s = this.selected;
                if (!s || !this.grid) return null;

                const row = this.grid.roleRows.filter(r => r.slug === s.roleSlug)[0];
                const col = this.columns.filter(c => c.date === s.date)[0];
                const cell = (row && col) ? row.cells[col.index] : null;
                const place = cell
                    ? cell.places.filter(p => String(p.slotId) === String(s.slotId))[0]
                    : null;

                const window = Fairness.windowDates(
                    Loop.windowFor(this.resolvedDates, col ? col.index : 0, this.pastDates),
                    this.windowSize
                );

                return {
                    personId: s.personId,
                    name: this.personName(s.personId),
                    initials: Panel.initialsOf(this.personName(s.personId)),
                    roleName: this.roleName(s.roleSlug),
                    dateLabel: Core.dayMonth(s.date),
                    card: place ? place.card : null,
                    wants: place ? place.wants : '',
                    load: this.gridLoadAt(s.date, s.personId),
                    budget: this.windowSize,
                    serves: Panel.servesInWindow({
                        personId: s.personId,
                        history: this.history,
                        windowDates: window,
                        intensityOf: record => this.intensityForRecord(record),
                        roleNameOf: slug => this.roleName(slug),
                        labelOf: date => Core.dayMonth(date),
                    }),
                    across: Panel.acrossRange({
                        personId: s.personId,
                        dates: (this.draft && this.draft.dates) || [],
                        selected: s,
                        roleNameOf: slug => this.roleName(slug),
                        labelOf: date => Core.dayMonth(date),
                    }),
                    considered: this.consideredFor(s),
                };
            },

            // Nothing records the runners-up, so this asks eligibility again for
            // the place, against the roster AS IT STANDS. Which is what keeps it
            // true after the editor has moved things about.
            consideredFor(s) {
                const def = this.roleDefinitions.filter(d => d.slug === s.roleSlug)[0];
                const slot = ((def && def.slots) || []).filter(x => x.id === s.slotId)[0];
                if (!def || !slot) return [];

                const day = ((this.draft && this.draft.dates) || [])
                    .filter(d => d.date === s.date)[0] || { seats: [] };
                const seats = day.seats || [];

                const assigned = seats.filter(x => (
                    x.roleSlug === s.roleSlug && String(x.slotId) !== String(s.slotId)
                ));
                const elsewhere = seats
                    .filter(x => x.roleSlug !== s.roleSlug)
                    .map(x => ({
                        personId: x.personId,
                        roleSlug: x.roleSlug,
                        allowsAnotherRole: Roles.allowsAnotherRole(
                            this.roleDefinitions.filter(d => d.slug === x.roleSlug)[0]
                        ),
                    }))
                    .concat((this.liturgical[s.date] || []).map(h => ({
                        personId: h.personId, roleSlug: h.roleSlug, allowsAnotherRole: false,
                    })));

                const candidates = Roles.candidatesFor(def, slot, {
                    people: this.assignablePeople,
                    assigned: assigned,
                    assignedElsewhere: elsewhere,
                    relationships: this.relationships,
                    groups: this.groups,
                });

                return Panel.considered({
                    candidates: candidates,
                    seatedPersonId: s.personId,
                    nameOf: id => this.personName(id),
                    loadAt: id => this.gridLoadAt(s.date, id),
                    reasonText: c => this.reasonWords(c, {
                        date: s.date, roleSlug: s.roleSlug, slotId: s.slotId,
                    }),
                });
            },

            // ── Seeding a serve ──────────────────────────────────────────────
            //
            // ⚠ THE ONE THING ON THIS SCREEN THAT SAVES AS YOU GO. A serve is a
            // claim about the past, and a past that only exists if you later
            // accept a rota would be a strange thing indeed.

            get seedDates() {
                const s = this.selected;
                if (!s) return [];
                const col = this.columns.filter(c => c.date === s.date)[0];
                return Fairness.windowDates(
                    Loop.windowFor(this.resolvedDates, col ? col.index : 0, this.pastDates),
                    this.windowSize
                ).filter(d => d < this.resolvedDates[0]);
            },

            get canSeed() {
                return !!this.selected && !!this.seedRole && !!this.seedDate && !this.seeding;
            },

            async addServe() {
                if (!this.canSeed) return;
                this.seeding = true;
                this.seedNote = '';
                const personId = this.selected.personId;

                try {
                    const record = await Store.seedServe(db, {
                        personId: personId,
                        roleSlug: this.seedRole,
                        date: this.seedDate,
                        seriesId: this.seriesId,
                    });
                    this.history = this.history.concat([{
                        id: record.id,
                        personId: personId,
                        type: record.type,
                        serviceDate: record.serviceDate,
                        seriesId: record.seriesId,
                        metadata: record.metadata || null,
                        seeded: true,
                    }]);
                    this.seedDate = '';
                    // The dates already drafted were balanced against the old
                    // picture and they still say so. Re-draft is how the editor
                    // acts on this (MS-181) — nothing re-solves on its own. A
                    // serve is history, so EVERY column drifted, not just the
                    // ones after a date.
                    this.staleFrom = 0;
                    this.buildGrid();
                    this.seedNote = 'Saved. The draft was not redrawn — re-draft to use it.';
                } catch (e) {
                    console.error('Could not record the serve:', e);
                    this.seedNote = 'That could not be saved. Nothing was recorded.';
                } finally {
                    this.seeding = false;
                }
            },

            async dropServe(serve) {
                if (!this.selected || !serve.id || this.seeding) return;
                this.seeding = true;
                this.seedNote = '';
                const personId = this.selected.personId;

                try {
                    await Store.removeServe(db, personId, serve.id);
                    this.history = this.history.filter(r => r.id !== serve.id);
                    this.staleFrom = 0;
                    this.buildGrid();
                    this.seedNote = 'Removed. The draft was not redrawn.';
                } catch (e) {
                    console.error('Could not remove the serve:', e);
                    this.seedNote = 'That could not be removed. Nothing changed.';
                } finally {
                    this.seeding = false;
                }
            },

            // ── Staleness, and re-draft from here (MS-181) ───────────────────

            // Everything AFTER the edited date drifts; the edited date itself
            // does not. It was balanced against what came before it, and that
            // has not moved.
            markStaleAfter(date) {
                this.edited[date] = true;
                const col = this.columns.filter(c => c.date === date)[0];
                if (!col) return;
                const from = col.index + 1;
                if (from >= this.columns.length) return;
                this.staleFrom = (this.staleFrom === null)
                    ? from
                    : Math.min(this.staleFrom, from);
            },

            isStale(index) {
                return this.staleFrom !== null && index >= this.staleFrom;
            },

            get staleCount() {
                if (this.staleFrom === null) return 0;
                return Math.max(0, this.columns.length - this.staleFrom);
            },

            // Keep this date and everything before it exactly as they stand;
            // draw the rest again, reading the kept dates as history. Also the
            // natural way to work down a long range — settle the first Sunday,
            // refresh the rest, move on.
            redraftFrom(index) {
                if (!this.draft) return;

                // Edits made to the later dates are about to go. Say so — this
                // is the one action on the screen that throws away work. Read
                // off what the editor ACTUALLY touched, not guessed at from the
                // seats: a hand-placed card and a solved one look alike.
                const losing = ((this.draft.dates || []).slice(index + 1))
                    .some(day => this.edited[day.date]);
                if (losing && typeof confirm === 'function') {
                    const ok = confirm(
                        'Redrawing from here throws away the changes you made to the later dates. Carry on?'
                    );
                    if (!ok) return;
                }

                this.draft = Loop.redraftFrom(this.draft, index, this.draftOptions());
                (this.draft.dates || []).slice(index + 1)
                    .forEach(day => { delete this.edited[day.date]; });
                // Everything from here on has just been balanced against the
                // current picture, so nothing after it is stale any more.
                this.staleFrom = (this.staleFrom !== null && this.staleFrom <= index)
                    ? this.staleFrom
                    : null;
                if (this.staleFrom !== null && this.staleFrom > index) this.staleFrom = null;
                this.selected = null;
                this.buildGrid();
                this.remember();
            },

            // ── Kept in the browser (MS-184) ─────────────────────────────────

            get storage() {
                try { return window.localStorage || null; } catch (e) { return null; }
            },

            // Remembered across visits: an editor who folded it away to see the
            // grid does not want it back every time they draft.
            LITURGY_KEY: 'mosaic.autoAssign.liturgyOpen',

            restoreLiturgyFold() {
                const kept = Saved.read(this.storage, this.LITURGY_KEY);
                if (kept && typeof kept.open === 'boolean') this.liturgyOpen = kept.open;
            },

            toggleLiturgy() {
                this.liturgyOpen = !this.liturgyOpen;
                Saved.save(this.storage, this.LITURGY_KEY, { open: this.liturgyOpen });
            },

            PANEL_KEY: 'mosaic.autoAssign.panelOpen',

            restorePanelDrawer() {
                const kept = Saved.read(this.storage, this.PANEL_KEY);
                if (kept && typeof kept.open === 'boolean') this.panelOpen = kept.open;
            },

            // Only a deliberate toggle is remembered. Picking a card opens the
            // drawer because the answer is in there, but that is this draft's
            // business — it should not quietly overwrite what the editor chose.
            togglePanel() {
                this.panelOpen = !this.panelOpen;
                Saved.save(this.storage, this.PANEL_KEY, { open: this.panelOpen });
                // The drawer hands 320px to the grid or takes it away, which
                // is most of a column — the window has to be re-measured or it
                // says the grid is wider or narrower than it is. Once now (for
                // a browser told not to animate) and once the slide has
                // finished, from the panel's own transitionend.
                this.measureGrid();
            },

            // What a folded cell says. Names, not a count: "3 on liturgy" tells
            // the editor nothing they can act on, and the whole reason this row
            // is here is to explain an absence below it.
            liturgyLine(cell) {
                const names = (cell.holders || []).map(h => h.name);
                if (!names.length) return '';
                if (names.length <= 2) return names.join(', ');
                return names[0] + ', ' + names[1] + ' +' + (names.length - 2);
            },

            get savedKey() {
                return Saved.keyFor(this.seriesId, this.resolvedDates);
            },

            savedContext() {
                return {
                    seriesId: this.seriesId,
                    dates: this.resolvedDates,
                    roles: this.draftableRoles,
                    people: this.assignablePeople,
                    choice: this.choice,
                    displaced: this.displaced,
                    savedAt: new Date().toISOString(),
                };
            },

            remember() {
                if (!this.draft) return;
                Saved.save(this.storage, this.savedKey,
                    Saved.pack(this.draft, this.savedContext()));
            },

            forgetDraft() {
                Saved.forget(this.storage, this.savedKey);
            },

            // ⚠ RE-CHECKED BEFORE IT IS SHOWN. People leave, Roles change,
            // dates get cancelled — and a stale draft looks completely normal,
            // which is what makes it dangerous.
            async offerStored() {
                this.offered = null;
                this.offerStale = [];
                const stored = Saved.read(this.storage, this.savedKey);
                if (!stored || !stored.draft) return;

                // The re-check needs the same data a draft does, so it costs the
                // same read. Worth it: the alternative is showing a picture of a
                // church that has moved on.
                try {
                    await this.loadForDraft();
                } catch (e) {
                    console.error('Could not check the saved draft:', e);
                    return;
                }

                this.offerStale = Saved.staleReasons(stored, this.savedContext());
                this.offered = stored;
            },

            resumeDraft() {
                if (!this.offered || this.offerStale.length) return;
                this.draft = this.offered.draft;
                this.displaced = this.offered.displaced || [];
                this.offered = null;
                this.selected = null;
                this.seenProblems = false;
                this.staleFrom = null;
                this.edited = {};
                this.buildGrid();
                this.focused = 0;
                this.showDraft();
            },

            dismissStored() {
                this.offered = null;
                this.offerStale = [];
                this.forgetDraft();
            },

            get displacedCards() {
                return this.displaced.map(d => ({
                    personId: d.personId,
                    date: d.date,
                    name: this.personName(d.personId),
                    initials: Grid.initialsOf(this.personName(d.personId)),
                    // Where they came from, both halves. "Was on 4 October" is
                    // not enough to put somebody back — you need to know what
                    // they were doing.
                    roleName: d.roleSlug ? this.roleName(d.roleSlug) : 'Displaced',
                    dateLabel: Core.dayMonth(d.date),
                }));
            },

            // ── The draft, at a glance ───────────────────────────────────────
            //
            // The tally the bottom bar reads, which is also what tells the
            // editor whether the draft is finished.

            // ⚠ COUNTED OFF THE GRID, NOT OFF THE DRAFT. The solve's `gaps` list
            // is a snapshot of what IT could not fill; the moment the editor
            // moves a card, that list stops describing the screen. The grid
            // rebuilds every place from the Role's own slots, so it is the only
            // thing that still knows how many there are.
            get tally() {
                const cols = this.columns;
                let places = 0;
                let empty = 0;

                (this.grid ? this.grid.rows : []).forEach(row => {
                    if (row.kind === 'liturgy') return;
                    row.cells.forEach(cell => {
                        if (!cell.applicable) return;
                        places += cell.places.length;
                    });
                });
                cols.forEach(col => { empty += col.empty; });

                return { dates: cols.length, places: places, empty: empty };
            },

            // ── Warnings, and getting to them ────────────────────────────────
            //
            // Problems are a way IN, not a wall. A count with no route to it is
            // just a scold — the editor still has to hunt down which of forty
            // cards it meant.

            get problemCount() {
                return this.columns.reduce((n, col) => n + col.problems, 0);
            },

            get firstProblem() {
                let found = null;
                (this.grid ? this.grid.roleRows : []).forEach(row => {
                    row.cells.forEach(cell => {
                        cell.places.forEach(place => {
                            if (found || !place.filled || !place.card.warning) return;
                            found = { date: cell.date, place: place };
                        });
                    });
                });
                return found;
            },

            // Looking at the problems is what unlocks "accept anyway". Not a
            // gate on the decision — the editor is the final word (ADR-0021) —
            // a gate on deciding it BLIND.
            seenProblems: false,

            goToProblems() {
                const first = this.firstProblem;
                if (!first) return;
                const col = this.columns.filter(c => c.date === first.date)[0];
                if (col) this.focusDate(col.index);
                this.selectPlace(first.date, first.place);
                this.seenProblems = true;
            },

            get acceptLabel() {
                return this.problemCount ? 'Accept anyway' : 'Accept the roster';
            },

            get mustLookFirst() {
                return this.problemCount > 0 && !this.seenProblems;
            },

            // ── Accepting ────────────────────────────────────────────────────

            accepting: false,
            accepted: null,         // { dates, occurrences, assignments }
            acceptError: '',

            // The draft owns the managed Roles it drew, AND the one-off jobs on
            // the dates in range — without those the accept would keep the old
            // one-off rows and add the drafted ones beside them.
            get ownedSlugs() {
                const slugs = this.draftableRoles.map(r => r.slug);
                this.resolvedDates.forEach(date => {
                    (((this.occurrences[date] || {}).oneOffRoles) || []).forEach(job => {
                        if (job && job.id && slugs.indexOf(job.id) === -1) slugs.push(job.id);
                    });
                });
                return slugs;
            },

            async acceptRoster() {
                if (!this.draft || this.accepting || this.mustLookFirst) return;
                this.accepting = true;
                this.acceptError = '';

                try {
                    const out = await Store.acceptDraft(db, this.draft, {
                        seriesId: this.seriesId,
                        roleSlugs: this.ownedSlugs,
                        actor: { actorUid: (auth.currentUser && auth.currentUser.uid) || null },
                    });
                    this.accepted = out;
                    this.forgetDraft();
                } catch (e) {
                    console.error('Could not accept the roster:', e);
                    // ⚠ A long range is written date by date, so a failure part
                    // way through HAS really written the dates before it. Saying
                    // "nothing was saved" here would be a lie the editor would
                    // discover on the calendar.
                    this.acceptError = 'The roster could not be finished. Some dates may already ' +
                        'have been written — check the Calendar before trying again.';
                } finally {
                    this.accepting = false;
                }
            },

            discard() {
                this.forgetDraft();
                this.displaced = [];
                this.selected = null;
                this.backToSetup();
            },

            // The blunt version of the per-column redraw: the whole range again,
            // from the history as it stands now.
            redraftAll() {
                if (!this.draft) return;
                this.draft = Loop.draft(this.draftOptions());
                this.displaced = [];
                this.selected = null;
                this.seenProblems = false;
                this.staleFrom = null;
                this.edited = {};
                this.buildGrid();
                this.remember();
            },

            get draftSubtitle() {
                const name = (this.chosen && this.chosen.name) || 'Event';
                return name + ' · ' + this.resolvedLine;
            },

            backToSetup() {
                this.draft = null;
                this.grid = null;
                this.view = 'setup';
            },

            personName(personId) {
                const p = this.people.filter(x => x.id === personId)[0];
                return (p && p.name) || 'Someone';
            },

            roleName(slug) {
                const def = this.roleDefinitions.filter(d => d.slug === slug)[0];
                if (def && def.name) return def.name;
                const known = Roles.roleBySlug(slug, this.roleDefinitions);
                return (known && known.name) || slug;
            },

            pretty(date) { return Core.dayMonth(date); },
        };
    };
})();
