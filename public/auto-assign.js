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
            history: [],
            existing: {},           // date → assignments already there
            liturgical: {},         // date → [{ personId, roleSlug }]
            drafting: false,

            draft: null,

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

                const today = Dates.todayStr();
                this.fromDate = addDays(today, 1);
                this.applyPreset(this.preset);
                this.loading = false;
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
                this.onRangeChanged();
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
                        occs.forEach(o => {
                            if (!inRange[o.date]) return;
                            const roster = (o.assignments || []).filter(a => a && a.personId);
                            if (roster.length) this.existing[o.date] = roster;
                        });
                        this.occupied = Object.keys(this.existing).sort();
                    })
                    .catch(e => {
                        console.error('Could not check what is already on these dates:', e);
                        if (token === this.rangeToken) { this.existing = {}; this.occupied = []; }
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
                    this.view = 'draft';
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

                const [people, roles, rels, groups] = await Promise.all([
                    db.collection('people').get(),
                    db.collection('roles').get(),
                    db.collection('relationships').where('sharedWithEditors', '==', true).get()
                        .catch(() => ({ docs: [] })),
                    db.collection('relationship_groups').where('sharedWithEditors', '==', true).get()
                        .catch(() => ({ docs: [] })),
                ]);

                this.people = people.docs.map(d => Object.assign({ id: d.id }, d.data()));
                this.roleDefinitions = roles.docs.map(d => Object.assign({ id: d.id }, d.data()));
                this.relationships = rels.docs.map(d => d.data());
                this.groups = groups.docs.map(d => Object.assign({ id: d.id }, d.data()));

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

            // ── The draft, at a glance ───────────────────────────────────────
            //
            // The grid itself is MS-179. What this carries is the tally the
            // bottom bar reads, which is also what tells the editor whether the
            // draft is finished.

            get tally() {
                const days = (this.draft && this.draft.dates) || [];
                let places = 0;
                let empty = 0;
                days.forEach(day => {
                    places += day.seats.length + day.gaps.length;
                    empty += day.gaps.length;
                });
                return { dates: days.length, places: places, empty: empty };
            },

            get draftSubtitle() {
                const name = (this.chosen && this.chosen.name) || 'Event';
                return name + ' · ' + this.resolvedLine;
            },

            backToSetup() {
                this.draft = null;
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
