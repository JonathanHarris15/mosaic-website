// Away — the screen where a Person says which whole days they will not be here
// (MS-188). Reached from the Calendar, on a desktop and on a phone.
//
// THE GRID IS THE INPUT, ON EVERY SIZE. No date fields anywhere: first tap sets
// the first day, second tap the last, a tap before the first day starts again
// from there. Quick choices ("this weekend", "a week") were designed and
// dropped — they competed with the grid for the same tap and made the common
// case look like a form.
//
// TWO LAYOUTS, ONE STATE. The desktop shows two months side by side with a rail
// beside them; the phone runs several months on in one scroll with the summary
// pinned to the bottom, so a range crossing a month boundary is one flick rather
// than a page turn that loses the half-made selection. Swapped on the shell
// rather than on a media query — the same 390px window on a desktop still has a
// mouse — which is the Calendar's own rule.
//
// NOTHING HERE IS A REQUEST. There is no submit, no pending, no approval. The
// person says it and it is true, which is why the button reads "I'm away these
// days" and why nothing on the screen ever says "unavailable".

(function () {
    'use strict';

    const Core = window.AwayCore;
    const Store = window.AwayStore;

    const todayStr = () => window.DateUtils.todayStr();

    // How many months the grid offers at once. The desktop pair pages a month at
    // a time; the phone's scroll is long enough to cover most of a plan without
    // reaching for more, and extends when you reach the end.
    const DESKTOP_MONTHS = 2;
    const PHONE_MONTHS = 4;

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
            saving: false,
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

            selection: Object.assign({}, Core.EMPTY_SELECTION),
            anchor: null,           // { year, monthIndex } — the first month shown
            monthsShown: window.MOSAIC_SHELL === 'mobile' ? PHONE_MONTHS : DESKTOP_MONTHS,
            showPast: false,

            weekdays: Core.WEEKDAYS,

            // ── Loading ──────────────────────────────────────────────────────

            async init() {
                this.anchor = monthPartsOf(this.today);
                this.rank = await this.resolveRank();
                // Your own days, always, until you say otherwise.
                this.subjectId = this.personId;
                await this.load();
                if (this.isEditor) this.loadPeople();
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

            // Switching whose days are on screen throws the half-made selection
            // away on purpose: a range tapped out against Sarah's calendar is not
            // a range anybody meant against Bob's.
            async setSubject(personId) {
                if (!personId || personId === this.subjectId) return;
                this.subjectId = personId;
                this.clearSelection();
                this.showPast = false;
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

            get lastMonth() {
                const total = this.anchor.monthIndex + this.monthsShown - 1;
                return {
                    year: this.anchor.year + Math.floor(total / 12),
                    monthIndex: ((total % 12) + 12) % 12,
                };
            },

            get months() {
                return Core.monthsFrom(
                    this.anchor.year, this.anchor.monthIndex, this.monthsShown,
                    {
                        selection: this.selection,
                        stretches: this.stretches,
                        places: this.places,
                        today: this.today,
                    }
                );
            },

            get prompt() { return Core.prompt(this.selection); },
            get sentence() { return Core.sentence(this.selection); },

            // ⚠ CHECKED THE MOMENT IT CAN BE SAVED, not once the range is
            // settled. A single day is addable one tap in — the sentence even
            // offers it — so gating the clash on a *finished* range meant
            // somebody could tap one day, press the button, and never be told
            // they were serving on it. That defeats the point of the screen:
            // being told while you are still thinking about it is the whole
            // reason the message exists.
            get clashes() {
                if (!this.selectionMade) return [];
                return Core.clashesIn(this.places, this.selection.start, this.selection.end);
            },

            get hasClash() { return this.clashes.length > 0; },
            get clashHeading() { return Core.clashHeading(this.clashes.length); },

            // WARN EARLY, REASSURE LATE — and the asymmetry is deliberate. A
            // clash shows as soon as the selection could be saved, because it is
            // the thing they need to know. The all-clear still waits for a
            // settled range: said one tap into an intended fortnight it would
            // answer a question about a single day nobody meant, and then flip
            // the moment the range closed. Silence is honest; premature
            // reassurance that later reverses is not.
            get allClear() { return this.rangeReady && !this.hasClash; },

            get rangeReady() {
                return !!this.selection.start && !!this.selection.end
                    && this.selection.awaiting === 'start';
            },

            // A selection exists as soon as one day has been tapped — the first
            // tap sets both ends. `canAdd` and the clash check MUST agree on
            // this: anything the button will save has to have been checked.
            get selectionMade() { return !!this.selection.start && !!this.selection.end; },

            // The single day is offerable one tap in: "away Saturday" should not
            // need the same day tapped twice.
            get canAdd() { return this.selectionMade; },

            // Lives here rather than in the markup because the desktop and the
            // phone both draw this button, and a promise made in two places is a
            // promise that eventually gets made two different ways. It is not
            // "Submit" and never becomes "Requested".
            get addLabel() { return this.addLabelFor; },

            get upcomingStretches() {
                return Core.upcoming(this.stretches, this.today)
                    .map(s => Core.stretchRow(s, this.places))
                    .filter(Boolean);
            },

            get pastStretches() {
                return Core.past(this.stretches, this.today)
                    .map(s => Core.stretchRow(s, this.places))
                    .filter(Boolean);
            },

            get recordCount() {
                const n = this.upcomingStretches.length;
                if (!n) return 'None yet';
                return n === 1 ? 'One' : Core.inWords(n);
            },

            get pastLabel() {
                const n = this.pastStretches.length;
                if (!n) return '';
                return (this.showPast ? 'Hide' : 'Show') + ' ' +
                    (n === 1 ? 'one that has passed' : Core.inWords(n).toLowerCase() + ' that have passed');
            },

            // ── Choosing ─────────────────────────────────────────────────────

            tap(iso) {
                if (!iso) return;
                this.selection = Core.nextSelection(this.selection, iso);
            },

            clearSelection() {
                this.selection = Object.assign({}, Core.EMPTY_SELECTION);
            },

            async prevMonths() {
                this.anchor = this.stepAnchor(-1);
                await this.loadPlaces();
            },

            async nextMonths() {
                this.anchor = this.stepAnchor(1);
                await this.loadPlaces();
            },

            stepAnchor(by) {
                const total = this.anchor.monthIndex + by;
                return {
                    year: this.anchor.year + Math.floor(total / 12),
                    monthIndex: ((total % 12) + 12) % 12,
                };
            },

            // The phone reaches further by growing its scroll rather than paging
            // — the whole point of that layout is that a range never spans a
            // page turn. Nothing is capped: an Away can be a year out.
            async showMoreMonths() {
                this.monthsShown += PHONE_MONTHS;
                await this.loadPlaces();
            },

            togglePast() { this.showPast = !this.showPast; },

            // ── Saying it ────────────────────────────────────────────────────

            async add() {
                if (!this.canAdd || this.saving) return;
                this.saving = true;
                this.error = '';
                try {
                    this.stretches = await Store.addStretch(
                        db,
                        this.subjectId,
                        { start: this.selection.start, end: this.selection.end },
                        // The AUTHOR, never the subject. Entering somebody else's
                        // days stamps the editor, so it reads "Ann marked Sarah
                        // away" rather than putting a claim in Sarah's mouth.
                        { personId: this.personId, uid: (auth.currentUser || {}).uid, name: this.personName }
                    );
                    this.clearSelection();
                    // The days just claimed may reach past what was read for,
                    // and the rows underneath report what is inside each one.
                    await this.loadPlaces();
                } catch (e) {
                    console.error('Away save failed:', e);
                    this.error = friendlyError(e);
                } finally {
                    this.saving = false;
                }
            },

            async remove(id) {
                if (this.saving) return;
                this.saving = true;
                this.error = '';
                try {
                    // An editor may remove anybody's, including one the person
                    // entered themselves — somebody whose plans changed will tell
                    // whoever they told the first time.
                    await Store.removeStretch(db, this.subjectId, id);
                    this.stretches = Core.removeStretch(this.stretches, id);
                } catch (e) {
                    console.error('Away removal failed:', e);
                    this.error = friendlyError(e);
                } finally {
                    this.saving = false;
                }
            },

            // ── Drawing a day ────────────────────────────────────────────────
            //
            // One place decides what a cell looks like, so the two layouts cannot
            // drift. Tailwind classes rather than the design file's raw CSS vars,
            // matching every other page here.

            cellClass(c) {
                if (!c.inMonth) return 'invisible';
                if (c.isStart || c.isEnd) return 'bg-primary text-on-primary font-bold';
                if (c.inRange) return 'bg-surface-container-high text-on-surface';
                if (c.onRecord) return 'bg-secondary-container text-on-secondary-container font-semibold';
                return 'text-on-surface hover:bg-surface-container-low';
            },

            // Square the middle of a range so it reads as one block rather than a
            // row of separate days.
            cellRadius(c) {
                if (c.isStart && c.isEnd) return 'rounded-[10px]';
                if (c.isStart) return 'rounded-l-[10px]';
                if (c.isEnd) return 'rounded-r-[10px]';
                if (c.inRange) return 'rounded-none';
                return 'rounded-[10px]';
            },

            // Sand for a place you hold; amber once it is inside the range you
            // are choosing — the same dot, saying "this one is now your problem".
            dotClass(c) {
                if (c.dotTone === 'warning') return 'bg-warning';
                if (c.dotTone === 'sand') return 'bg-sand';
                return 'hidden';
            },

            // ── Whose days ───────────────────────────────────────────────────

            get isEditor() {
                return ['editor', 'admin', 'elder', 'super_admin'].indexOf(this.rank) !== -1;
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
                    ? "Whole days you won't be here. Nothing is put on you on these days. "
                        + "Nobody approves it — you say it and it's true."
                    : 'Whole days ' + this.subjectName + " won't be here. Nothing is put on them on "
                        + 'these days. Recorded in your name, so it reads as you saying it for them.';
            },

            get addLabelFor() {
                if (this.saving) return 'Saving…';
                return this.isMine ? "I'm away these days" : this.subjectName + ' is away these days';
            },

            get clashLead() {
                return this.isMine
                    ? "These days are still yours — saying you're away doesn't take them off you. "
                        + 'Find someone to swap with before you go.'
                    : 'These places are still theirs — recording this does not take them off '
                        + this.subjectName + '. Somebody has to hand them on.';
            },

            get allClearLine() {
                return this.isMine
                    ? 'Nothing of yours falls in these dates.'
                    : 'Nothing of theirs falls in these dates.';
            },

            get emptyLine() {
                return this.isMine
                    ? "You haven't told the church about any days yet. Tap the first day you're away on the calendar."
                    : 'Nothing on record for ' + this.subjectName + ' yet.';
            },

            get calendarHref() {
                return this.phone ? 'calendar.html?shell=mobile' : 'calendar.html';
            },
        };
    };
}());
