// Calendar — every Event you're allowed to see (MS-153).
//
// The front door. Most people opening this are answering "what's coming up and
// am I in it", not administering — so the month grid answers "what's on", and
// the *You in July* rail and the **Only mine** filter answer "am I in it"
// without hunting.
//
// Sundays appear here alongside everything else, but a Sunday chip is a
// CROSS-LINK, never an editor: the liturgy is still edited on the Services page,
// which is what keeps the printed booklet safe.
//
// ⚠ The queries live in events-store.js, and they are constrained there. An
// unconstrained visibility query does not return fewer rows — it errors
// outright, and the error looks exactly like "this church has no events".

(function () {
    'use strict';

    const Core = window.EventsOccurrenceCore;
    const Store = window.EventsStore;
    const View = window.CalendarView;

    const todayStr = () => window.DateUtils.todayStr();

    const monthOf = dateStr => String(dateStr).slice(0, 7);

    // First and last day of a month, as YYYY-MM-DD.
    function monthRange(month) {
        const [y, m] = month.split('-').map(Number);
        const last = new Date(y, m, 0).getDate();
        return { from: month + '-01', to: month + '-' + String(last).padStart(2, '0') };
    }

    function shiftMonth(month, by) {
        const [y, m] = month.split('-').map(Number);
        const d = new Date(y, m - 1 + by, 1);
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    }

    function monthLabel(month) {
        const [y, m] = month.split('-').map(Number);
        return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    }

    // Say what actually happened. Every one of these renders as an empty
    // calendar if you let it, and "this church has no events" is exactly what a
    // real failure looks like from the outside — which is how it ships
    // unnoticed. So each cause gets its own sentence.
    function describeLoadFailure(e) {
        const code = e && e.code;

        if (code === 'permission-denied') {
            return 'The calendar could not be read. This is a permissions problem, not an ' +
                'empty month — please tell an admin rather than assuming there is nothing on.';
        }
        // Firestore raises this while a composite index is still building, which
        // happens for a few minutes after a deploy. It fixes itself.
        if (code === 'failed-precondition') {
            return 'The calendar is still being set up — an index it needs is being built. ' +
                'That usually takes a minute or two, and then this will work.';
        }
        if (code === 'unavailable') {
            return 'The calendar could not be reached. Check your connection and try again.';
        }
        return 'The calendar could not be loaded just now.';
    }

    window.calendarPage = function calendarPage() {
        return {
            loading: true,
            error: '',
            retryable: false,

            // Who is looking. Both drive what the queries ask for, so a wrong
            // value here is an empty calendar, not a partial one.
            rank: null,
            personId: null,

            view: 'month',          // 'month' | 'list'
            onlyMine: false,
            month: monthOf(todayStr()),
            today: todayStr(),

            occurrences: [],
            people: [],
            hiddenSeries: [],       // series unticked in the "Show" filters

            // ── Loading ──────────────────────────────────────────────────────

            async init() {
                // Wait for auth to settle before querying: a query built with the
                // wrong rank either over-asks (and errors) or under-asks (and
                // quietly hides somebody's own commitments).
                this.rank = await this.resolveRank();
                await this.load();
            },

            async resolveRank() {
                return new Promise(resolve => {
                    auth.onAuthStateChanged(async user => {
                        if (!user) { this.personId = null; return resolve(null); }
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

            async load() {
                this.loading = true;
                this.error = '';
                try {
                    const range = monthRange(this.month);
                    const rows = await Store.loadCalendar(db, {
                        rank: this.rank,
                        personId: this.personId,
                        from: range.from,
                        to: range.to,
                    });

                    // Each row is annotated once, here, so no template ever has
                    // to work out what kind of thing it is looking at.
                    this.occurrences = rows.map(o => Object.assign({}, o, {
                        isPast: o.date < this.today,
                        isSunday: o.seriesId === Core.SUNDAY_SERVICE_ID,
                        mine: this.myRoleOn(o),
                        needsAttention: Core.needsAttention(o),
                    }));

                    if (!this.people.length) await this.loadPeople();
                } catch (e) {
                    console.error('Calendar load failed:', e);
                    this.error = describeLoadFailure(e);
                    // A building index fixes itself, so the page offers to try
                    // again rather than making somebody reload by hand.
                    this.retryable = !!(e && e.code === 'failed-precondition');
                    this.occurrences = [];
                } finally {
                    this.loading = false;
                }
            },

            async loadPeople() {
                try {
                    const snap = await db.collection('people').get();
                    this.people = snap.docs.map(d => ({ id: d.id, name: (d.data() || {}).name || '' }));
                } catch (e) {
                    this.people = [];
                }
            },

            // ── What the viewer is looking at ────────────────────────────────

            // The Role this person holds here, if any. Read off the event itself
            // rather than a parallel list, so "Only mine" can never disagree with
            // what the event says.
            myRoleOn(occurrence) {
                if (!this.personId) return null;
                const mine = ((occurrence && occurrence.assignments) || [])
                    .find(a => a.personId === this.personId);
                if (!mine) return null;
                return {
                    label: mine.label || mine.roleSlug,
                    state: mine.state || Core.STATES.PENDING,
                    stateLabel: Core.stateLabel(mine),
                    tone: Core.stateTone(mine),
                };
            },

            get visible() {
                return this.occurrences.filter(o => {
                    if (this.onlyMine && !o.mine) return false;
                    if (o.seriesId && this.hiddenSeries.indexOf(o.seriesId) !== -1) return false;
                    return true;
                });
            },

            get cells() { return View.monthGrid(this.month, this.visible, this.today); },
            get groups() { return View.weekGroups(this.visible, this.today); },
            get monthLabel() { return monthLabel(this.month); },

            // The dot-strip the phone shows instead of the grid: one row per
            // week, each day a number over up to a few dots.
            get dotStrip() {
                return this.cells.map(cell => Object.assign({}, cell, {
                    dots: cell.events.slice(0, 3).map(o => (
                        o.needsAttention ? 'error' : (o.mine ? 'mine' : 'other')
                    )),
                }));
            },

            // ── The right rail ───────────────────────────────────────────────

            get myCommitments() { return View.myCommitments(this.visible, this.personId); },
            get mySentence() {
                return View.myCommitmentsSentence(this.myCommitments, this.monthLabel.split(' ')[0]);
            },
            get needsSorting() { return View.needsSorting(this.visible, this.people); },

            // One row per series, with a count, for the "Show" filters.
            get seriesFilters() {
                const counts = new Map();
                this.occurrences.forEach(o => {
                    const key = o.seriesId || o.id;
                    const name = o.name || o.seriesName || 'Event';
                    if (!counts.has(key)) counts.set(key, { id: key, name: name, count: 0 });
                    counts.get(key).count++;
                });
                return Array.from(counts.values()).sort((a, b) => a.name.localeCompare(b.name));
            },

            toggleSeries(seriesId) {
                const at = this.hiddenSeries.indexOf(seriesId);
                if (at === -1) this.hiddenSeries.push(seriesId);
                else this.hiddenSeries.splice(at, 1);
            },

            isShown(seriesId) { return this.hiddenSeries.indexOf(seriesId) === -1; },

            // ── Navigation ───────────────────────────────────────────────────

            async goToMonth(month) {
                this.month = month;
                await this.load();
            },
            prevMonth() { return this.goToMonth(shiftMonth(this.month, -1)); },
            nextMonth() { return this.goToMonth(shiftMonth(this.month, 1)); },
            goToToday() { return this.goToMonth(monthOf(todayStr())); },

            // A Sunday NEVER opens the Event editor. Its liturgy is a different
            // model with a different surface — the Order of Service editor — and
            // keeping the two apart is what keeps the printed booklet safe.
            //
            // It goes straight to that editor rather than to the Services list,
            // because you already said which Sunday by clicking it; making
            // somebody find the same date again is a step for nothing. The
            // builder gates its own editing controls, so a member landing there
            // reads the order of service without being able to change it.
            open(occurrence) {
                if (!occurrence) return;
                window.location.href = occurrence.isSunday
                    ? 'service-builder.html?date=' + encodeURIComponent(occurrence.date)
                    : 'calendar-event.html?id=' + encodeURIComponent(occurrence.id);
            },

            get canCreate() {
                return ['editor', 'admin', 'elder', 'super_admin'].indexOf(this.rank) !== -1;
            },

            // ── Display passthroughs ─────────────────────────────────────────

            initials(name) { return View.initials(name); },
            formatTime(t) { return View.formatTime(t); },
            // "15 Jul" — short enough to sit inside a rail sentence on one line.
            formatDayMonthShort(dateStr) {
                return window.DateUtils.parseDateStr(dateStr)
                    .toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
            },
            dayNumber(dateStr) { return window.DateUtils.parseDateStr(dateStr).getDate(); },
            weekdayShort(dateStr) {
                return window.DateUtils.parseDateStr(dateStr)
                    .toLocaleDateString('en-GB', { weekday: 'short' }).toUpperCase();
            },
            personName(personId) {
                const p = this.people.find(x => x.id === personId);
                return (p && p.name) || 'Someone';
            },

            // The chip's colour family, so the template does not branch on four
            // things at once.
            chipKind(occurrence) {
                if (occurrence.needsAttention) return 'declined';
                if (occurrence.mine) return 'mine';
                if (occurrence.isSunday) return 'sunday';
                return 'other';
            },
        };
    };
})();
