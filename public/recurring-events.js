// Recurring Events — every repeating Event, and what its rota actually looks
// like across the next stretch of dates.
//
// The Calendar used to carry a single button marked "Sunday Service", which was
// the only door to the one series anybody had. It is not the only series any
// more, and a button per Event does not scale past two. So this is the room the
// series live in: pick one, read its rota as a grid, and leave through whichever
// door the thing you noticed calls for —
//
//   the EVENT itself      its pattern, time, place, and which Roles it carries
//                         every date (calendar-event.html?series=…)
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
// TWO LANES, not one door and one wall.
//
// An editor gets all of the above. Everybody else gets the same list of events
// and nothing that writes: tap one and it opens to show when it next falls, and
// which of those dates they are on. No rota, no auto-assign, no emptying, no
// door to the Event itself.
//
// This used to be an editors-only page that told a member "this one is for
// editors" — but "when does the Core Seminar run until?" is an ordinary question
// for anybody in the church, and the Calendar answers it a month at a time,
// which is the wrong shape for a thing defined by its pattern. The list of what
// repeats is not privileged; changing it is.
//
// Each lane still only ever sees the events its own rank may see — the series
// read is constrained by visibility like every other, so a member's list simply
// does not contain the elders' meeting.

(function () {
    'use strict';

    const Core = window.EventsOccurrenceCore;
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

            // ── Loading ──────────────────────────────────────────────────────

            async init() {
                this.rank = await this.resolveRank();
                if (!this.rank) { this.loading = false; return; }

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

                // The editor lane opens on something, because an empty right-hand
                // column beside a list of events reads as a grid that failed to
                // load. The browse lane opens on NOTHING unless it was sent to
                // one: it is a list of closed rows, and every row springing open
                // at once is not a list any more.
                const opening = named || (this.isEditor
                    ? (this.series[0] && this.series[0].id) || ''
                    : '');

                this.loading = false;
                if (opening) await this.choose(opening);
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
                this.recomputeDates();
                await this.loadWindow();
            },

            // ── Opening one, in the browse lane ──────────────────────────────
            //
            // An accordion, not a selection: the row you tap opens under itself,
            // and tapping it again shuts it. `choose` cannot do this on its own —
            // it is the editor lane's "load the grid for this one", where landing
            // on nothing selected would be a bug rather than a closed row.
            async toggleSeries(id) {
                if (this.gridLoading) return;
                if (this.seriesId === id) { this.seriesId = ''; return; }
                await this.choose(id);
            },

            isOpen(id) { return this.seriesId === id; },

            // When it next falls, and which of those dates are yours. `dates` is
            // already the window from today forward, so this is the next stretch
            // of it rather than a history.
            get upcoming() {
                if (!this.chosen) return [];
                return Grid.upcoming({
                    dates: this.dates,
                    from: Dates.todayStr(),
                    personId: this.personId,
                    occurrenceAt: date => this.occurrences[date] || null,
                });
            },

            // A pattern that has run out. Said in words, because a row that opens
            // onto nothing looks like a read that failed.
            get finished() {
                return !!this.chosen && !this.gridLoading && !this.upcoming.length;
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

            // The Event itself — its pattern, time, place, and which Roles it
            // carries every date. Built here rather than in the markup so the
            // list row and the header above the grid cannot drift into naming
            // the same door two different ways.
            seriesHref(id) {
                return id ? 'calendar-event.html?series=' + encodeURIComponent(id) : null;
            },

            get eventHref() { return this.seriesHref(this.seriesId); },

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

            // What the window covers, in one line, so paging has something to
            // land on other than the columns themselves changing.
            get windowLabel() {
                const dates = this.dates;
                if (!dates.length) return 'No dates';
                if (dates.length === 1) return this.longDate(dates[0]);
                return this.shortDate(dates[0]) + ' – ' + this.shortDate(dates[dates.length - 1]);
            },
        };
    };
})();
