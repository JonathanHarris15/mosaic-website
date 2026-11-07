// Away — the screen where a Person says which whole days they will not be here
// (MS-188). Reached from the Calendar, on a desktop and on a phone.
//
// THE GRID IS THE INPUT, ON EVERY SIZE, AND IT WORKS IN DAYS. Tap a day to mark
// it away, tap it again to clear it. Press and drag across days to mark (or
// clear) the whole run — what the drag does is set by the day it starts on.
// Each change saves the moment the finger lifts; there is no "add" button and
// no list of ranges to manage, because the calendar itself is the record.
//
// It used to be "first tap the first day, second tap the last, then press the
// button", with every saved range listed back underneath. That made a person
// manage a collection of ranges when all they meant was "these are the days".
//
// Quick choices ("this weekend", "a week") were designed and dropped — they
// competed with the grid for the same tap and made the common case look like a
// form.
//
// TWO LAYOUTS, ONE STATE, ONE RAIL. The desktop shows two months side by side
// with a summary rail beside them; the phone shows one month with the summary
// pinned to the bottom. Both page along the SAME rail of months — arrows on
// either, and a swipe on the phone. Swapped on the shell rather than on a media
// query, since the same 390px window on a desktop still has a mouse, which is
// the Calendar's own rule.
//
// The phone used to run four months on in one vertical scroll. It made a range
// crossing a month boundary one flick — but it also put the calendar in a
// scroll inside a scroll, and a month you wanted was a hunt rather than a tap.
// One month that answers to a thumb beats four you have to go looking through.
//
// NOTHING HERE IS A REQUEST. There is no submit, no pending, no approval. The
// person colours the day in and it is true, which is why nothing on the screen
// ever says "unavailable".

(function () {
    'use strict';

    const Core = window.AwayCore;
    const Store = window.AwayStore;

    const todayStr = () => window.DateUtils.todayStr();

    // How many months the grid offers at once. Both layouts page along the same
    // rail, a month at a time — the phone shows one of them, the desktop two.
    const DESKTOP_MONTHS = 2;
    const PHONE_MONTHS = 1;

    // How far a finger has to travel across the rail before it counts as a page
    // turn, and how much more sideways than up-and-down it has to be. Well past
    // the browser's own tap slop, so a swipe never also lands on a day.
    const SWIPE_MIN = 45;
    const SWIPE_BIAS = 1.4;

    // How much of the desktop's rail is drawn to begin with, and how much more
    // it grows by on reaching the end. Generous, because the drawing is what
    // makes the slide possible — a month that is not there yet cannot be scrolled
    // to — and cheap, because a month is forty-two cells of arithmetic.
    const RAIL_MONTHS = 12;
    const RAIL_STEP = 6;

    function monthPartsOf(iso) {
        const parts = String(iso).split('-');
        return { year: Number(parts[0]), monthIndex: Number(parts[1]) - 1 };
    }

    function endOfMonth(year, monthIndex) {
        const last = new Date(Date.UTC(year, monthIndex + 1, 0));
        return Core.isoOf(last.getUTCFullYear(), last.getUTCMonth(), last.getUTCDate());
    }

    function friendlyError(e) {
        const code = (e && e.code) || '';
        if (code === 'permission-denied') {
            return 'These days could not be reached. If you have just signed in, give it a moment and try again.';
        }
        if (code === 'unavailable') {
            return 'No connection just now. What you have already said is safe.';
        }
        return 'That could not be saved just now.';
    }

    window.awayPage = function awayPage() {
        return {
            loading: true,
            error: '',

            // WHO IS LOOKING, and WHOSE DAYS ARE ON SCREEN. Almost always the
            // same person — but an editor may switch to somebody else, because
            // most of this information still arrives the way it always has:
            // somebody mentions it after the service, to whoever is doing the
            // rota (MS-196).
            //
            // They are kept apart deliberately. `subjectId` decides what is read
            // and written; `personId` decides who the write is ATTRIBUTED to. One
            // field doing both would stamp an editor's entry as the person's own
            // word, and the attribution is the whole safeguard on a soft block.
            rank: null,
            personId: null,
            personName: '',
            subjectId: null,
            people: [],

            phone: window.MOSAIC_SHELL === 'mobile',
            today: todayStr(),

            stretches: [],
            places: [],
            roleDefinitions: [],

            // The press in hand: { from, to, on }. `on` is whether it marks or
            // clears, settled by the day it started on. Null when no finger or
            // mouse button is down on the calendar.
            drag: null,
            // Paints still being written, in order. Each waits for the one
            // before it, so two quick taps cannot land out of order.
            queue: Promise.resolve(),
            inFlight: 0,
            anchor: null,          // { year, monthIndex } — the first month shown
            monthsShown: window.MOSAIC_SHELL === 'mobile' ? PHONE_MONTHS : DESKTOP_MONTHS,
            // How much rail the desktop has drawn to slide along. Grown, never
            // shortened, and never grown backwards.
            railLength: RAIL_MONTHS,
            // How far the rail has been slid, in pixels the browser measured.
            railShift: 0,
            // Where a finger went down on the rail, while it is still down.
            swipe: null,

            weekdays: Core.WEEKDAYS,

            // ── Loading ──────────────────────────────────────────────────────

            async init() {
                this.anchor = monthPartsOf(this.today);
                this.rank = await this.resolveRank();
                // Your own days, always, until you say otherwise.
                this.subjectId = this.personId;
                await this.load();
                if (this.canReadOthersAway) this.loadPeople();

                // The rail is held in pixels the browser measured, so a window
                // that changes width leaves it holding an old month's worth of
                // them — and the pair on show slides half out of the frame.
                // Re-measuring is cheap and the answer is always right.
                if (!this.phone && typeof window.addEventListener === 'function') {
                    window.addEventListener('resize', () => this.slide());
                }
            },

            async resolveRank() {
                return new Promise(resolve => {
                    auth.onAuthStateChanged(async user => {
                        if (!user) { this.personId = null; return resolve(null); }
                        const Cache = window.MosaicLocalCache;
                        const known = Cache && Cache.readIdentity(user.uid);
                        if (known && (known.permissions || known.accountLevelId)) {
                            this.personId = known.personId || null;
                            this.account = {
                                accountLevelId: known.accountLevelId || null,
                                permissions: known.permissions || null,
                            };
                            return resolve(AccessCore.permissionLevelOf(this.account));
                        }
                        try {
                            const data = await getUserData(user.uid);
                            this.personId = (data && data.personId) || null;
                            const flags = AccessCore.pageFlags(data);
                            this.account = flags.account;
                            if (Cache) Cache.writeIdentity(user.uid, {
                                personId: this.personId,
                                permissionLevel: flags.currentPermissionLevel,
                                accountLevelId: flags.account.accountLevelId,
                                permissions: flags.account.permissions,
                            });
                            resolve(flags.currentPermissionLevel);
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
                if (!this.subjectId) { this.loading = false; return; }
                try {
                    // The Role definitions first, so a place reads "Sound desk"
                    // rather than `sound_desk`. World-readable, like the other
                    // config collections.
                    await this.loadRoleDefinitions();
                    this.stretches = await Store.loadStretches(db, this.subjectId);
                    await this.loadPlaces();
                } catch (e) {
                    console.error('Away load failed:', e);
                    this.error = friendlyError(e);
                } finally {
                    this.loading = false;
                }
            },

            // Editors only, and only to fill the switcher. The directory is
            // world-readable, so this costs no new permission.
            async loadPeople() {
                try {
                    const snap = await db.collection('people').orderBy('name').get();
                    this.people = snap.docs
                        .map(d => ({ id: d.id, name: (d.data() || {}).name || '(Unnamed)' }))
                        // Not yourself: "Mine" is already the first option, and
                        // two options carrying the same id makes the browser
                        // select the second — so the control read as somebody
                        // else's name while showing your own days.
                        .filter(p => p.id !== this.personId);
                } catch (e) {
                    // Without the list an editor can still manage their own days,
                    // which is the common case.
                    this.people = [];
                }
            },

            // Switching whose days are on screen drops any drag in hand: a run
            // started against Sarah's calendar is not one anybody meant against
            // Bob's. Paints already let go of still land on Sarah — each one
            // carries the person it was made against.
            async setSubject(personId) {
                if (!personId || personId === this.subjectId) return;
                this.subjectId = personId;
                this.cancelDrag();
                await this.load();
            },

            async loadRoleDefinitions() {
                try {
                    const snap = await db.collection('roles').get();
                    this.roleDefinitions = snap.docs.map(d => Object.assign({ id: d.id }, d.data()));
                } catch (e) {
                    // A slug is a poor label but it is not a reason to fail the
                    // screen — the dates are what the person came for.
                    this.roleDefinitions = [];
                }
            },

            // The places a clash is measured against. Read across the whole
            // stretch of time the screen can currently reach — the months on
            // show AND anything already on record, since a stretch entered last
            // month may run past the end of the grid.
            async loadPlaces() {
                if (!this.subjectId) { this.places = []; return; }
                const last = this.stretches.reduce(
                    (max, s) => (s && s.end > max ? s.end : max),
                    endOfMonth(this.lastMonth.year, this.lastMonth.monthIndex)
                );
                try {
                    this.places = await Store.loadPlaces(db, {
                        personId: this.subjectId,
                        rank: this.rank,
                        from: this.today,
                        to: last,
                        roleName: slug => this.roleName(slug),
                    });
                } catch (e) {
                    console.error('Away places load failed:', e);
                    this.places = [];
                }
            },

            roleName(slug) {
                const def = window.RolesCore && window.RolesCore.roleBySlug(slug, this.roleDefinitions);
                return (def && def.name) || slug || 'A role';
            },

            // ── What is on screen ────────────────────────────────────────────

            // The furthest month the screen can reach, which is what
            // `loadPlaces` measures a clash against. The end of the RAIL, not
            // the end of what is on show — the months waiting off to the right
            // are already drawn, and a serving dot that only appears once you
            // page to it is a dot you cannot plan around.
            get lastMonth() {
                const total = this.firstMonth.monthIndex + this.railLength - 1;
                return {
                    year: this.firstMonth.year + Math.floor(total / 12),
                    monthIndex: ((total % 12) + 12) % 12,
                };
            },

            gridOptions() {
                return {
                    drag: this.drag,
                    stretches: this.shownStretches,
                    places: this.places,
                    today: this.today,
                };
            },

            // ── The rail ─────────────────────────────────────────────────────
            //
            // Every month the screen can reach, laid out in one row, with the
            // arrows sliding a window along it — two months wide on a desktop,
            // one on a phone. What is on show is a VIEW of the rail rather than
            // slots whose contents get swapped, which is the whole of why it can
            // slide: nothing is rebuilt, so there is something continuous to
            // move.
            //
            // ⚠ ONE RAIL EXISTS AT A TIME. The two layouts are `x-if`, not
            // `x-show`, so only the live one is in the DOM. Two would both
            // answer to `$refs.rail` and the slide would end up measuring the
            // hidden one, where every offset is zero.
            //
            // It starts at THIS month and never runs back past it. Away is a
            // thing you say before (ADR-0023 §4), so a month that has been holds
            // nothing left to choose, and the rail growing only forwards is what
            // keeps its measurements honest — appending never shifts what is
            // already drawn.

            get firstMonth() { return monthPartsOf(this.today); },

            get railMonths() {
                return Core.monthsFrom(
                    this.firstMonth.year, this.firstMonth.monthIndex,
                    this.railLength, this.gridOptions()
                );
            },

            // How far along the rail the leftmost month on show sits.
            get railIndex() {
                return (this.anchor.year - this.firstMonth.year) * 12
                    + (this.anchor.monthIndex - this.firstMonth.monthIndex);
            },

            get canGoBack() { return this.railIndex > 0; },

            // Whether a month is one of the ones being looked at. Everything
            // else on the rail is drawn but inert — see the note in the markup.
            onRail(index) {
                return index >= this.railIndex && index < this.railIndex + this.monthsShown;
            },

            get prompt() { return Core.prompt(this.drag); },
            get sentence() { return Core.sentence(this.shownStretches, this.today, this.drag); },

            // The diary as it is about to be: what is stored, with the drag in
            // hand already painted on. The grid, the clash and the sentence all
            // read this, so the calendar answers the finger while it moves and
            // a clash shows BEFORE it is let go — being told while you are still
            // choosing is the whole reason the message exists.
            get shownStretches() {
                if (!this.drag) return this.stretches;
                return Core.paintDays(this.stretches, this.drag.from, this.drag.to, this.drag.on).stretches;
            },

            // ⚠ NOT GATED ON A DRAG. A conflict saved a fortnight ago is still
            // theirs to sort out, and a screen that only mentions it while they
            // happen to be touching the calendar is a screen that lets them
            // forget it. It stands until one side of it moves.
            get conflicts() { return Core.conflictsIn(this.places, this.shownStretches); },

            get hasClash() { return this.conflicts.length > 0; },
            get clashHeading() { return Core.conflictHeading(this.conflicts.length); },

            // REASSURE ONLY ONCE THE FINGER IS UP. Mid-drag the run is still
            // changing, and an all-clear that flips as it grows is noise.
            get allClear() {
                return !this.drag && !this.hasClash && Core.daysAhead(this.stretches, this.today) > 0;
            },

            get allClearLine() {
                return this.isMine
                    ? "Nothing of yours falls on a day you're away."
                    : "Nothing of theirs falls on a day they're away.";
            },

            get saving() { return this.inFlight > 0; },

            // ── Painting ─────────────────────────────────────────────────────
            //
            // press → dragTo → release is the whole gesture, in days. The DOM
            // handlers below only translate pointer events into these, so the
            // behaviour can be tested without a browser.

            // ⚠ NOTHING BEFORE TODAY. Away is a thing you say before
            // (ADR-0023 §4). The rail starts at this month, so its first days
            // are already behind you — and a day marked there showed on the
            // calendar while the sentence, counting from today, said "No days
            // marked yet". A press there does nothing, and a drag that runs
            // back into them stops at today.
            press(iso) {
                if (!iso || !this.subjectId || iso < this.today) return;
                this.drag = { from: iso, to: iso, on: !Core.isAwayOn(this.stretches, iso) };
            },

            dragTo(iso) {
                if (!this.drag || !iso) return;
                const to = iso < this.today ? this.today : iso;
                if (to === this.drag.to) return;
                this.drag = Object.assign({}, this.drag, { to: to });
            },

            release() {
                const d = this.drag;
                if (!d) return;
                this.drag = null;
                return this.paint(d.from, d.to, d.on);
            },

            cancelDrag() { this.drag = null; },

            // A tap with nothing dragged is still a press and a release — the
            // same path, a run of one day.
            toggle(iso) {
                this.press(iso);
                return this.release();
            },

            // ── Pointer and keyboard ─────────────────────────────────────────
            //
            // POINTER EVENTS, NOT CLICKS, so a mouse and a finger behave the same
            // way. The press is taken on the day; the move and the lift are
            // listened for on the window, and the day under the pointer is found
            // by position. A finger's events keep going to the day it went down
            // on however far it travels, so the target of a move says nothing
            // about where the finger now is.
            //
            // The day grid carries `touch-action: none`, so on a phone a drag
            // across days paints rather than scrolling the page. Swiping months
            // still works from the month name and the weekday row, and the
            // arrows are always there.

            pointerDown(event, iso) {
                if (event && event.button !== undefined && event.button !== 0) return;
                // Keep the lift coming back here even if the mouse leaves the
                // window mid-drag; without it the drag is left hanging open.
                try {
                    if (event && event.target && event.target.setPointerCapture) {
                        event.target.setPointerCapture(event.pointerId);
                    }
                } catch (e) { /* not every browser lets you, and nothing needs it to */ }
                this.press(iso);
            },

            pointerMove(event) {
                if (!this.drag || !event || typeof document.elementFromPoint !== 'function') return;
                const el = document.elementFromPoint(event.clientX, event.clientY);
                const day = el && el.closest && el.closest('[data-day]');
                if (day) this.dragTo(day.getAttribute('data-day'));
            },

            // A pointer press already did the work, and its click follows it.
            // Only a click from the KEYBOARD (Enter or Space on a focused day,
            // which reports no clicks counted) toggles here.
            keyed(event, iso) {
                if (event && event.detail === 0) return this.toggle(iso);
            },

            // Mark or clear a run, now on screen and then in the database.
            // Drawn first, so the calendar never waits on the network; written
            // in order behind anything still going.
            paint(from, to, on) {
                const subjectId = this.subjectId;
                if (!subjectId) return;
                // The AUTHOR, never the subject. Marking somebody else's days
                // stamps the editor, so it reads "Ann marked Sarah away" rather
                // than putting a claim in Sarah's mouth.
                const author = { personId: this.personId, uid: (auth.currentUser || {}).uid, name: this.personName };

                const plan = Core.paintDays(this.stretches, from, to, on, author);
                if (!plan.set.length && !plan.remove.length) return;
                this.stretches = plan.stretches;
                this.error = '';
                this.inFlight += 1;

                this.queue = this.queue.then(async () => {
                    try {
                        const saved = await Store.paintDays(db, subjectId, { from: from, to: to, on: on }, author);
                        // Only once nothing else is queued: an earlier answer
                        // would redraw over a later tap that is still on its way.
                        if (this.inFlight === 1 && this.subjectId === subjectId) this.stretches = saved;
                    } catch (e) {
                        console.error('Away save failed:', e);
                        this.error = friendlyError(e);
                        // Show what is really stored rather than what was hoped.
                        try {
                            if (this.subjectId === subjectId) this.stretches = await Store.loadStretches(db, subjectId);
                        } catch (_) { /* the error already says so */ }
                    } finally {
                        this.inFlight -= 1;
                    }
                });
                return this.queue;
            },

            async prevMonths() {
                if (!this.canGoBack) return;
                this.anchor = this.stepAnchor(-1);
                this.slide();
            },

            async nextMonths() {
                // Grow the rail before moving onto it, so the month being slid
                // to is already drawn. Growing APPENDS, which cannot shift what
                // is on screen — that is why the rail only ever runs forwards.
                if (this.railIndex + this.monthsShown + 1 > this.railLength) {
                    this.railLength += RAIL_STEP;
                    await this.loadPlaces();
                }
                this.anchor = this.stepAnchor(1);
                this.slide();
            },

            // Slide the rail so the anchor month sits at the left edge.
            //
            // ⚠ MEASURED OFF THE DOM, NOT COMPUTED. A month is a percentage of
            // the container wide and the gap between them is in rem, so the one
            // thing that knows what a month is worth in pixels is the browser. A
            // number worked out here would drift the moment the window changed
            // width, and drift on a calendar reads as the dates being wrong
            // rather than the arithmetic.
            //
            // `offsetLeft` is a layout position and a transform does not move it,
            // so measuring mid-slide still gives the right answer.
            //
            // The easing itself is CSS, which is also where the person who asked
            // for less movement is answered — see the rail's styles.
            slide() {
                this.$nextTick(() => {
                    const rail = this.$refs.rail;
                    if (!rail) return;
                    const month = rail.querySelectorAll('[data-rail-month]')[this.railIndex];
                    if (!month) return;
                    this.railShift = month.offsetLeft;
                });
            },

            get railStyle() {
                return 'transform: translateX(' + (-this.railShift) + 'px)';
            },

            stepAnchor(by) {
                const total = this.anchor.monthIndex + by;
                return {
                    year: this.anchor.year + Math.floor(total / 12),
                    monthIndex: ((total % 12) + 12) % 12,
                };
            },

            // ── Swiping the rail ─────────────────────────────────────────────
            //
            // The arrows are small and a calendar on a phone is a thing you
            // push about with a thumb. Same rail, same easing — a swipe just
            // reaches `prevMonths`/`nextMonths` by another road.
            //
            // It DECIDES ON RELEASE rather than dragging the rail under the
            // finger. A drag has to fight the page's own vertical scroll for
            // every pixel, and a calendar that stutters up and down while you
            // try to move it sideways is worse than one that simply answers.
            //
            // Nothing is prevented, so a diagonal or vertical gesture scrolls
            // the page exactly as before. `SWIPE_MIN` is well past the browser's
            // own tap slop, so a swipe never also lands on the day it started on.

            swipeFrom(event) {
                // A finger that went down on a day is painting, not paging.
                // The press lands first, so the drag is already set by now.
                if (this.drag) { this.swipe = null; return; }
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

                // Dragged left, the months come from the right — the direction
                // the paper would move, not the direction of travel.
                if (dx < 0) this.nextMonths(); else this.prevMonths();
            },

            // ── Drawing a day ────────────────────────────────────────────────
            //
            // One place decides what a cell looks like, so the two layouts cannot
            // drift. Tailwind classes rather than the design file's raw CSS vars,
            // matching every other page here.
            //
            // Away is solid navy. A day the drag in hand is marking shows a shade
            // lighter until the finger lifts; a day it is clearing shows struck
            // through, so a run being cleared is still visible as one.

            cellClass(c) {
                if (!c.inMonth) return 'invisible';
                // Gone: faded, and still showing whether you were away.
                if (c.past) return c.away ? 'bg-primary/30 text-on-primary' : 'text-outline opacity-50';
                if (c.pending === 'on') return 'bg-primary/75 text-on-primary font-bold';
                if (c.pending === 'off') return 'bg-surface-container-high text-outline line-through';
                if (c.away) return 'bg-primary text-on-primary font-bold';
                return 'text-on-surface hover:bg-surface-container-low';
            },

            // Square the inside of a run so it reads as one block rather than a
            // row of separate days.
            cellRadius(c) {
                if (!c.away) return 'rounded-[10px]';
                if (c.runStart && c.runEnd) return 'rounded-[10px]';
                if (c.runStart) return 'rounded-l-[10px] rounded-r-none';
                if (c.runEnd) return 'rounded-r-[10px] rounded-l-none';
                return 'rounded-none';
            },

            // Sand for a place you hold; amber on a day you are away — the same
            // dot, saying "this one is now your problem".
            dotClass(c) {
                if (c.dotTone === 'warning') return 'bg-warning';
                if (c.dotTone === 'sand') return 'bg-sand';
                return 'hidden';
            },

            // ── Whose days ───────────────────────────────────────────────────

            get isEditor() {
                return AccessCore.writesAsEditor(this.account || this.rank);
            },
            get canReadOthersAway() {
                return AccessCore.readsAsEditor(this.account || this.rank);
            },

            get isMine() { return this.subjectId === this.personId; },

            get subjectName() {
                if (this.isMine) return 'you';
                const person = this.people.find(p => p.id === this.subjectId);
                return (person && person.name) || 'them';
            },

            // The screen says whose diary it is, in the heading and in the button,
            // because an editor who forgets they are on Sarah's screen will record
            // their own holiday against her name.
            get title() { return this.isMine ? 'Away' : this.subjectName; },

            get intro() {
                return this.isMine
                    ? "Tap the days you won't be here — tap again to clear one, or drag across several. "
                        + "Nothing is put on you on these days. Nobody approves it — you say it and it's true."
                    : 'Tap the days ' + this.subjectName + " won't be here — tap again to clear one, or drag "
                        + 'across several. Recorded in your name, so it reads as you saying it for them.';
            },

            // Whether the last change is stored yet. Quiet, because saving is
            // not something the person did — it is something that happens.
            get saveState() {
                if (this.saving) return 'Saving…';
                return '';
            },

            get clashLead() {
                return this.isMine
                    ? "These days are still yours — saying you're away doesn't take them off you. "
                        + 'Find someone to swap with before you go.'
                    : 'These places are still theirs — recording this does not take them off '
                        + this.subjectName + '. Somebody has to hand them on.';
            },

            get calendarHref() {
                return this.phone ? 'calendar.html?shell=mobile' : 'calendar.html';
            },
        };
    };
}());
