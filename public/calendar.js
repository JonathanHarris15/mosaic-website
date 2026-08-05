// Calendar — every Event you're allowed to see (MS-153).
//
// The front door. Most people opening this are answering "what's coming up and
// am I in it", not administering — so the month grid answers "what's on", and
// the *Upcoming* card and the **Only mine** filter answer "am I in it"
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

    // Months drawn at once, and where the month on screen sits among them after
    // a re-centre. Five, so there is always one either side already drawn and
    // already loaded — a month you can slide to but not see the contents of is
    // the swap this replaced, one frame later.
    const RAIL_MONTHS = 5;
    const RAIL_CENTRE = 2;

    // How far a finger travels before it counts as a page turn, and how much
    // more sideways than up-and-down. Well past the browser's own tap slop, so
    // a swipe never also lands on the day it started on.
    const SWIPE_MIN = 45;
    const SWIPE_BIAS = 1.4;

    // Run something once the browser has drawn what was just asked for.
    //
    // Two frames, not one: a frame callback runs BEFORE that frame is drawn, so
    // the first is still too early. Off a browser — in a test — there is nothing
    // to wait for and it simply runs.
    function afterPaint(fn) {
        if (typeof requestAnimationFrame !== 'function') return fn();
        requestAnimationFrame(() => requestAnimationFrame(fn));
    }

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

    // How many months from a to b, signed. The rail's whole arithmetic.
    function monthsBetween(a, b) {
        const [ay, am] = String(a).split('-').map(Number);
        const [by, bm] = String(b).split('-').map(Number);
        return (by - ay) * 12 + (bm - am);
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

            // 'month' | 'list'. Seven columns across a 390px screen gives about
            // 50px a day, which fits a number and nothing else — so the phone
            // starts on the list, which was already built and reads well one
            // finger-width at a time. Month is still one tap away.
            view: window.MOSAIC_SHELL === 'mobile' ? 'list' : 'month',
            phone: window.MOSAIC_SHELL === 'mobile',
            onlyMine: false,
            month: monthOf(todayStr()),
            today: todayStr(),

            occurrences: [],
            people: [],
            hiddenSeries: [],       // series unticked in the "Show" filters

            // ── The rail ────────────────────────────────────────────────────
            //
            // Five months laid out in one row with the month on screen a window
            // onto it, so paging SLIDES rather than swapping one grid for
            // another. The same rail the Away screen runs on, and for the same
            // reason: a person choosing a date across a month boundary needs to
            // see where they came from.
            //
            // ⚠ THE LOAD FOLLOWS THE RAIL, NOT THE MONTH. Every month on the
            // rail is drawn, so every month on the rail needs its events —
            // sliding to an empty grid that fills in a moment later is worse
            // than not sliding. One query covers all five, and the happy
            // consequence is that paging inside the rail needs no read at all.
            railAnchor: null,       // the month the rail starts on
            railShift: 0,           // how far it has slid, in pixels the browser measured
            railSnap: false,        // suppress the easing for one frame — see recentreRail
            loadedRange: { from: '', to: '' },
            swipe: null,            // where a finger went down, while it is still down

            // The Roles and their slots, so the grid can count the places still
            // to fill. Editors only — nobody else is shown that count, and
            // nobody else is allowed to read the definitions.
            roleDefinitions: [],

            // The day tapped in the phone's strip. Null means "today, or the
            // first of whichever month is up" — the strip always has a day
            // selected, because the list underneath it is that day.
            focusDate: null,

            // ── Loading ──────────────────────────────────────────────────────

            async init() {
                // Wait for auth to settle before querying: a query built with the
                // wrong rank either over-asks (and errors) or under-asks (and
                // quietly hides somebody's own commitments).
                this.rank = await this.resolveRank();
                // The grid first — it is the page. The Role definitions behind
                // the warnings follow on their own, so they cannot hold the
                // calendar up.
                this.railAnchor = shiftMonth(this.month, -RAIL_CENTRE);
                await this.load();
                // ⚠ THE RAIL DOES NOT START WHERE IT LOOKS LIKE IT SHOULD. This
                // month is the THIRD of the five drawn, so a rail left at zero
                // shows the month two back — the heading said August over a grid
                // of June, and nothing on the page contradicted it. Every other
                // way onto a month slides; opening the page has to as well.
                //
                // It waits for a drawn frame because until `loading` clears
                // there is no grid laid out to measure, and it goes through
                // `recentreRail` because arriving is not a move — the calendar
                // should be ON this month, not glide onto it from two months
                // back every time the page opens.
                afterPaint(() => this.recentreRail());
                this.loadRoleDefinitions();
            },

            async resolveRank() {
                return new Promise(resolve => {
                    auth.onAuthStateChanged(async user => {
                        if (!user) { this.personId = null; return resolve(null); }

                        // In the phone app your rank was remembered when you
                        // signed in, so the page starts its real query now
                        // instead of spending a round trip re-asking Firestore
                        // something that changes about once a year. The web has
                        // no cache and takes the trip, exactly as before.
                        const Cache = window.MosaicLocalCache;
                        const known = Cache && Cache.readIdentity(user.uid);
                        if (known && known.permissionLevel) {
                            this.personId = known.personId || null;
                            return resolve(known.permissionLevel);
                        }

                        try {
                            const data = await getUserData(user.uid);
                            this.personId = (data && data.personId) || null;
                            const rank = (data && (data.permissionLevel || data.role)) || 'viewer';
                            if (Cache) Cache.writeIdentity(user.uid, { personId: this.personId, permissionLevel: rank });
                            resolve(rank);
                        } catch (e) {
                            this.personId = null;
                            resolve('viewer');
                        }
                    });
                });
            },

            // ⚠ A QUIET LOAD DOES NOT TOUCH `loading`, AND THAT IS THE WHOLE
            // POINT OF THE FLAG. `loading` hides the entire page behind a
            // spinner, which is right the first time and wrong every time
            // after: the rail tops itself up as it grows, and every other press
            // was blanking the calendar mid-slide and putting it back. It read
            // as the page reloading itself for no reason.
            //
            // Quiet is safe here because what is on screen is already in hand.
            // The read is only fetching the months the rail has just grown
            // into, and nobody is looking at those yet.
            async load(options) {
                const quiet = !!(options && options.quiet);
                if (!quiet) this.loading = true;
                this.error = '';
                try {
                    // The whole rail, not just the month on screen. See the
                    // note on `railAnchor`.
                    const range = this.railRange;
                    this.loadedRange = range;
                    const rows = await Store.loadCalendar(db, {
                        rank: this.rank,
                        personId: this.personId,
                        from: range.from,
                        to: range.to,
                        // An editor is shown the places still to fill, and that
                        // cannot be answered from the occurrence document — so
                        // the dates from today on that already have somebody on
                        // them bring their rosters with them. Dates nobody is on
                        // need no read: every place on them is open already.
                        staffingFrom: this.isEditor ? this.today : null,
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
                    // A quiet read that fails keeps what it already had. The
                    // five months in hand are not wrong, they are just no longer
                    // growing — and emptying the calendar somebody is reading
                    // because the month after next could not be fetched would
                    // be a far worse answer than the sentence above.
                    if (!quiet) this.occurrences = [];
                } finally {
                    if (!quiet) this.loading = false;
                }
            },

            // Which Roles exist and how many places each one has. Without this
            // the grid cannot tell a date with nobody on it from a date that
            // needs nobody, so a viewer who is not an editor — who never sees
            // the count — never pays for the read.
            async loadRoleDefinitions() {
                if (!this.isEditor) { this.roleDefinitions = []; return; }
                try {
                    const snap = await db.collection('roles').get();
                    this.roleDefinitions = snap.docs.map(d => Object.assign({ id: d.id }, d.data()));
                } catch (e) {
                    this.roleDefinitions = [];
                }
            },

            async loadPeople() {
                try {
                    // The same `people` read the app warms at launch, so on a
                    // phone this is answered from the device.
                    const Cache = window.MosaicLocalCache;
                    const q = db.collection('people');
                    const snap = await (Cache ? Cache.read(q) : q.get());
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

            // Everything loaded, filtered by what the Show ticks and Only mine
            // say. Spans the whole rail, so it is what the GRIDS are built from
            // — each one takes the dates it wants.
            get visible() {
                return this.occurrences.filter(o => {
                    if (this.onlyMine && !o.mine) return false;
                    if (o.seriesId && this.hiddenSeries.indexOf(o.seriesId) !== -1) return false;
                    return true;
                });
            },

            // ⚠ THE MONTH ON SCREEN, not everything in hand. Since the rail
            // load, `occurrences` holds five months — so anything that means
            // "this month" has to say so, or the list shows five of them and
            // "You in August" answers for the summer.
            get monthRows() {
                return this.visible.filter(o => monthOf(o.date) === this.month);
            },

            get cells() { return View.monthGrid(this.month, this.visible, this.today); },

            // ── The rail ─────────────────────────────────────────────────────

            get railRange() {
                const anchor = this.railAnchor || shiftMonth(this.month, -RAIL_CENTRE);
                return {
                    from: monthRange(anchor).from,
                    to: monthRange(shiftMonth(anchor, RAIL_MONTHS - 1)).to,
                };
            },

            // Every month drawn, each with its own grid. Built from `visible`,
            // which spans the whole rail, so a month waiting off to the side
            // already has its dots on it before you reach it.
            get railMonths() {
                const anchor = this.railAnchor || shiftMonth(this.month, -RAIL_CENTRE);
                const out = [];
                for (let i = 0; i < RAIL_MONTHS; i++) {
                    const month = shiftMonth(anchor, i);
                    out.push({
                        month: month,
                        label: monthLabel(month),
                        cells: View.monthGrid(month, this.visible, this.today),
                    });
                }
                return out;
            },

            get railIndex() {
                return monthsBetween(this.railAnchor || this.month, this.month);
            },

            // Whether a month is the one being looked at. Everything else on the
            // rail is drawn but inert, or a keyboard would tab through five
            // months of days nobody can see.
            onRail(index) { return index === this.railIndex; },

            // ⚠ THE TWO LAYOUTS BOTH CARRY A RAIL AND BOTH ARE ALWAYS IN THE
            // DOM — they are swapped by a CSS class, not by `x-if`. So they
            // cannot share a ref name: `$refs` keeps whichever registered last,
            // which was the desktop's, and inside a display:none block every
            // offset reads zero. The rail simply never moved.
            get rail() {
                return this.phone ? this.$refs.monthRail : this.$refs.monthRailWide;
            },

            get railStyle() {
                return 'transform: translateX(' + (-this.railShift) + 'px)';
            },

            // Slide so the month on screen sits at the left edge.
            //
            // ⚠ MEASURED OFF THE DOM. A month is a percentage of the container
            // wide; the one thing that knows what that is in pixels is the
            // browser, and a number worked out here would drift the moment the
            // window changed width. `offsetLeft` is a layout position, so a
            // transform does not move it and measuring mid-slide still answers.
            slideRail() {
                this.$nextTick(() => {
                    const rail = this.rail;
                    if (!rail) return;
                    // ⚠ A HIDDEN RAIL MEASURES ZERO, AND ZERO IS A REAL ANSWER
                    // — it is the first month on the rail, two months back from
                    // the one you are on. The arrows sit in the header row and
                    // work in List, where the grid is not drawn, so paging
                    // there used to leave the rail parked on the wrong month
                    // and you found out on switching to Month.
                    //
                    // So a rail that is not laid out is not measured. `setView`
                    // slides it the moment it appears.
                    if (!rail.offsetParent || !rail.offsetWidth) return;
                    const month = rail.querySelectorAll('[data-rail-month]')[this.railIndex];
                    if (!month) return;
                    this.railShift = month.offsetLeft;
                });
            },

            // Month and List. The grid is only laid out in Month, so this is
            // where the rail catches up with any paging done while it was away.
            setView(next) {
                this.view = next;
                if (next === 'month') this.slideRail();
            },

            // Put the month on screen back in the middle of the rail, without
            // it appearing to move.
            //
            // ⚠ THE EASING HAS TO BE OFF FOR THIS. Re-anchoring shifts every
            // month along by two places, so the SAME month ends up at a
            // different offset — the picture is identical but the number is
            // not, and eased, the rail would glide sideways for no reason.
            // `railSnap` turns the transition off for exactly one frame.
            //
            // ⚠ AND THE FRAME HAS TO BE A REAL ONE. Turning the easing off and
            // on again inside microtasks does nothing at all: the browser only
            // decides what to animate when it comes to draw, and by then it has
            // seen the class arrive and leave and both moves collapse into one.
            // What it then eases is the sum — a step forward minus a re-anchor
            // of two months back, which is a step BACKWARDS. That was the rail
            // sliding the wrong way on every other press.
            //
            // So the release waits on two animation frames. The first paints
            // the re-anchored position with the easing off; the second is the
            // earliest moment the browser can be sure of having drawn it.
            //
            // It happens BEFORE the move that needs it rather than after the
            // one that caused it: there is nothing to wait for, no transition
            // to listen for, and nothing to go wrong if the easing was never
            // running because somebody asked for less movement.
            // `centreOn` is the month about to be moved TO, not the one on
            // screen: anchoring on where you are heading leaves two months
            // spare on both sides, so the rail re-centres every other press
            // rather than every one.
            recentreRail(centreOn) {
                this.railSnap = true;
                this.railAnchor = shiftMonth(centreOn || this.month, -RAIL_CENTRE);
                return new Promise(resolve => {
                    this.$nextTick(() => {
                        const rail = this.rail;
                        const month = rail && rail.offsetParent && rail.offsetWidth
                            && rail.querySelectorAll('[data-rail-month]')[this.railIndex];
                        if (month) this.railShift = month.offsetLeft;
                        afterPaint(() => {
                            this.railSnap = false;
                            resolve();
                        });
                    });
                });
            },

            // ── Swiping (MS-188's gesture, on the Calendar's grid) ───────────
            //
            // Decided on RELEASE rather than dragging the rail under the finger.
            // A drag fights the page's own vertical scroll for every pixel, and
            // a calendar that stutters up and down while you move it sideways is
            // worse than one that simply answers. Nothing is prevented, so a
            // vertical gesture scrolls the page exactly as before.
            swipeFrom(event) {
                const touch = event && event.changedTouches && event.changedTouches[0];
                this.swipe = touch ? { x: touch.clientX, y: touch.clientY } : null;
            },

            swipeTo(event) {
                const from = this.swipe;
                const touch = event && event.changedTouches && event.changedTouches[0];
                this.swipe = null;
                if (!from || !touch) return;

                const dx = touch.clientX - from.x;
                const dy = touch.clientY - from.y;
                if (Math.abs(dx) < SWIPE_MIN) return;
                if (Math.abs(dx) < Math.abs(dy) * SWIPE_BIAS) return;

                // Dragged left, the next month comes from the right — the way
                // the paper would move, not the way the finger went.
                return dx < 0 ? this.nextMonth() : this.prevMonth();
            },
            get groups() { return View.weekGroups(this.monthRows, this.today); },
            get monthLabel() { return monthLabel(this.month); },

            // ── The right rail ───────────────────────────────────────────────

            // Upcoming reads its own rows, and deliberately ignores "Only mine"
            // and the "Show" ticks. Those govern the grid — a month's worth of
            // series with counts beside them — and a serve of your own is not
            // something a display filter over a different stretch of time should
            // be able to hide from you.
            get myCommitments() {
                return View.myCommitments(
                    this.occurrences.filter(o => monthOf(o.date) === this.month), this.personId);
            },
            get mySentence() { return View.myCommitmentsSentence(this.myCommitments); },

            // "You in August", and it means it. This block used to be an
            // Upcoming card at the top of the page reading its own window of
            // days — today through a fortnight, whatever the grid was showing —
            // and it was a separate query for that reason.
            //
            // It now answers for THE MONTH ON SCREEN, which is why it can be
            // read straight off the rows the grid already has. Two reads became
            // one, and the two can no longer disagree about the same Sunday.
            //
            // The old objection to this — that paging back to April changed
            // what you were down for — was really an objection to the card
            // sitting at the TOP of the page, where nothing said which month it
            // meant. Underneath the grid, with the month in its own heading, the
            // question and the answer are next to each other.
            //
            // `myCommitments` drops anything already past, so this month runs
            // from today and a month ahead runs whole — with no arithmetic here
            // to get that wrong.
            get myMonthHeading() { return 'You in ' + this.monthLabel; },

            get needsSorting() { return View.needsSorting(this.monthRows, this.people); },

            // ── Places still to fill ─────────────────────────────────────────
            //
            // Editors only, and only on the days ahead. Somebody who cannot fill
            // a place is being told about weather; a place on a date already
            // gone cannot be filled by anybody.
            placesToFill(occurrence) {
                if (!this.isEditor) return 0;
                return View.openPlaces(occurrence, this.roleDefinitions);
            },

            placesToFillLabel(occurrence) {
                return View.placesToFillLabel(this.placesToFill(occurrence));
            },

            // The navy dot that says you are serving. It reads off `mine`, so an
            // amber chip does not swallow it — but it stays off the chips that
            // are shouting or struck through, where it was never drawn.
            showsYou(occurrence) {
                if (!occurrence || !occurrence.mine) return false;
                const kind = this.chipKind(occurrence);
                return kind === 'mine' || kind === 'unfilled';
            },

            // ── The phone ────────────────────────────────────────────────────
            //
            // The desktop grid is seven columns across 390px — about 50px a day,
            // which fits a number and nothing else. So the phone gets its own
            // month: a strip of dots, and the day you tapped underneath it.
            //
            // The two views share the card, so a phone never has a second copy
            // of a row to drift from the first. Month is the strip and the day
            // you tapped on it; List is the whole month grouped by week, and no
            // strip — a list is a list.

            get focusedDate() {
                if (this.focusDate) return this.focusDate;
                // Today, but only while today is in the month being shown —
                // otherwise the strip would highlight a day that is not on it.
                return monthOf(this.today) === this.month ? this.today : this.month + '-01';
            },

            get focusedEvents() {
                return this.monthRows.filter(o => o.date === this.focusedDate);
            },

            // "Wednesday 29 July" — the heading over the one day.
            get focusedLabel() {
                return window.DateUtils.parseDateStr(this.focusedDate)
                    .toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
            },

            // One body for both phone views, so the card is written once.
            get phoneGroups() {
                if (this.view !== 'month') return this.groups;
                const events = this.focusedEvents;
                return events.length
                    ? [{ weekStart: this.focusedDate, label: this.focusedLabel, events: events }]
                    : [];
            },

            // An empty day and an empty month are different facts, and saying
            // "nothing on this month" over one quiet Tuesday would be wrong.
            get phoneEmptyLine() {
                return this.view === 'month' ? 'Nothing on this day.' : 'Nothing on this month.';
            },

            async focusDay(cell) {
                if (!cell || !cell.date) return;
                this.view = 'month';
                // The strip's corners belong to the neighbouring months, which
                // are not loaded. Drawing "nothing on this day" for one of those
                // would be a lie rather than an empty day, so tapping it goes
                // there. goToMonth clears the focus, so it is set after.
                if (!cell.inMonth) await this.goToMonth(monthOf(cell.date));
                this.focusDate = cell.date;
            },

            // The dots under a day number. At most three: a fourth 5px dot in a
            // ~46px cell has nowhere to go, and the strip is a glance — the
            // count lives in the list underneath it.
            stripDots(cell) {
                return ((cell && cell.events) || []).slice(0, 3).map(ev => {
                    const kind = this.chipKind(ev);
                    // Same order as the chip, so the strip and the card can
                    // never disagree about what a day looks like.
                    if (kind === 'off') return '#DAD0C0';                 // outline-variant
                    if (kind === 'declined') return View.ATTENTION_COLOUR;
                    if (kind === 'unfilled') return View.WARNING_COLOUR;
                    if (kind === 'mine') return '#182F57';                // primary
                    return View.colourOf(ev).bar;
                });
            },

            // One row per series, with a count, for the "Show" filters.
            get seriesFilters() {
                const counts = new Map();
                this.occurrences.filter(o => monthOf(o.date) === this.month).forEach(o => {
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

            // Moving a month is a SLIDE ALONG THE RAIL when the month is one
            // already drawn, and only then a read. Five months are in hand, so
            // most presses cost nothing at all — which is the second thing the
            // rail bought, after the animation.
            //
            // A month off the rail entirely — "Today" from six months away, or a
            // corner date tapped in a neighbouring month — cannot be slid to,
            // because there is nothing between here and there to slide past. It
            // rebuilds around the target and lands.
            async goToMonth(month) {
                if (month === this.month) return;

                const jump = Math.abs(monthsBetween(this.month, month)) > 1;

                // A day tapped in July means nothing in August, and leaving it
                // set would highlight a day the strip is no longer showing.
                this.focusDate = null;

                if (jump) {
                    this.month = month;
                    await this.recentreRail();
                    // Loud: this one lands on a month nothing has been read for,
                    // so there really is nothing to show until it arrives.
                    await this.load();
                    return;
                }

                // Keep one month spare on the side we are heading for, so the
                // one being slid to is drawn AND loaded before it appears.
                const at = monthsBetween(this.railAnchor || month, month);
                if (at < 1 || at > RAIL_MONTHS - 2) await this.recentreRail(month);

                this.month = month;
                this.slideRail();

                // The read is only for the months the rail has just grown into.
                // What is on screen is already in hand, so nothing waits on it.
                const have = this.railRange;
                if (have.from !== this.loadedRange.from || have.to !== this.loadedRange.to) {
                    await this.load({ quiet: true });
                }
            },
            prevMonth() { return this.goToMonth(shiftMonth(this.month, -1)); },
            nextMonth() { return this.goToMonth(shiftMonth(this.month, 1)); },
            goToToday() { return this.goToMonth(monthOf(todayStr())); },

            // ── Creating something on a day you clicked ──────────────────────
            //
            // The grid is where you already are when you decide something needs
            // to go on a date, so the date comes from the click. Making somebody
            // go to "New event" and then type the day they just pointed at is a
            // step for nothing.

            dayMenu: null,
            // Overridable so the size and the edges can be tested without a
            // browser; in a browser both come from the window.
            viewport: null,

            get menuBox() {
                const v = this.viewport || {
                    width: window.innerWidth || 1024,
                    height: window.innerHeight || 768,
                };
                return { width: 236, height: 46, viewport: v };
            },

            openDayMenu(cell, event) {
                // Not offered to somebody who would only be refused on the next
                // screen. A menu that leads nowhere is worse than no menu.
                if (!this.canCreate || !cell || !cell.date) return;

                const box = this.menuBox;
                const pad = 8;
                this.dayMenu = {
                    date: cell.date,
                    width: box.width,
                    height: box.height,
                    // Clamped back inside, or a click near the bottom-right
                    // renders the menu where nobody can reach it.
                    x: Math.max(pad, Math.min(
                        (event && event.clientX) || 0, box.viewport.width - box.width - pad)),
                    y: Math.max(pad, Math.min(
                        (event && event.clientY) || 0, box.viewport.height - box.height - pad)),
                };
            },

            closeDayMenu() { this.dayMenu = null; },

            // The date travels in the link, so the form opens already on it.
            newEventHref(date) {
                return 'calendar-event.html?new=1&date=' + encodeURIComponent(date);
            },

            // EVERY chip opens the same page, Sundays included.
            //
            // This used to send a Sunday straight to the Order of Service editor,
            // on the grounds that a Sunday's liturgy is a different model with a
            // different surface. That reasoning was about the LITURGY, and it
            // still holds — the Event page never draws a liturgical Role as a
            // fillable card, so the booklet is as safe as it ever was.
            //
            // What it got wrong was the click. A Sunday now carries Servant Roles
            // like any other date — welcome team, sound desk — and sending the
            // chip to the liturgy meant the one date with the MOST people on it
            // was the only one you could not open to see who they were. The Event
            // page carries a link to the order of service, so the liturgy is one
            // step away rather than the only thing there.
            open(occurrence) {
                if (!occurrence) return;
                window.location.href = 'calendar-event.html?id=' +
                    encodeURIComponent(occurrence.id);
            },

            get isEditor() {
                return ['editor', 'admin', 'elder', 'super_admin'].indexOf(this.rank) !== -1;
            },

            get canCreate() { return this.isEditor; },

            // Nobody is signed in — which is NOT the same as an empty month, and
            // the difference is invisible unless the page says it.
            //
            // A signed-out Calendar still draws: the Sunday Service is fetched by
            // id regardless of who is asking, while every other Event is filtered
            // by the rungs your rank may see. So it renders as a church that
            // holds a service on Sunday and does nothing else all week — which is
            // exactly what somebody's own church looks like to them after their
            // session quietly lapses.
            get signedOut() { return !this.loading && !this.rank; },

            get signInHref() {
                return window.MOSAIC_SHELL === 'mobile' ? 'mobile.html#/login' : 'login.html';
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
            // No `monthShort` any more. It stamped the month onto a row that
            // had run past the end of this one, which the old Upcoming window
            // usually did. Every row now belongs to the month in the heading.
            weekdayShort(dateStr) {
                return window.DateUtils.parseDateStr(dateStr)
                    .toLocaleDateString('en-GB', { weekday: 'short' }).toUpperCase();
            },
            personName(personId) {
                const p = this.people.find(x => x.id === personId);
                return (p && p.name) || 'Someone';
            },

            // The chip's left bar. This is where a chosen colour actually lands.
            //
            // Needs-sorting OVERRIDES it, always. That red is the end of an
            // escalation that runs through four surfaces, and it has to keep
            // meaning one thing — so a chosen colour decorates the calendar
            // without ever being able to shout, or to stop something else
            // shouting.
            chipBar(occurrence) {
                // A date nothing is happening on has nothing to chase, so it
                // never shouts — a red chip for a gathering that was called off
                // sends somebody looking for a problem that no longer exists.
                if (Core.notHappening(occurrence)) return View.colourOf(occurrence).bar;
                if (occurrence && occurrence.needsAttention) return View.ATTENTION_COLOUR;
                return View.colourOf(occurrence).bar;
            },

            // "Moved to 15 August", not just "not happening". Somebody looking at
            // the first Sunday needs to know where the gathering went, or they
            // turn up to an empty hall.
            movedNote(occurrence) { return Core.movedNote(occurrence); },

            // The chip's colour family, so the template does not branch on four
            // things at once.
            //
            // In order of how loud each one is. `unfilled` sits under the red
            // and over everything else: a date still short of people is the
            // editor's job for the week, but somebody having said no is the one
            // that cannot wait. Being in it yourself is neither — and the "you"
            // dot reads off `mine` rather than off this, so an amber chip you
            // are serving on still says so.
            chipKind(occurrence) {
                // Skipped or moved away. First, because everything below it
                // describes a gathering that is taking place.
                if (Core.notHappening(occurrence)) return 'off';
                if (occurrence.needsAttention) return 'declined';
                if (this.placesToFill(occurrence)) return 'unfilled';
                if (occurrence.mine) return 'mine';
                if (occurrence.isSunday) return 'sunday';
                return 'other';
            },
        };
    };
})();
