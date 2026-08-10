// Your Commitments — the page a member answers on (MS-20, MS-205).
//
// A **Commitment** is the member's word for their own Assignment: what you are
// down for on the dates ahead. `commitments-core.js` assembles the list; this
// is the screen, and the one place a member acts.
//
// ⚠ THE DESIGN IS "ANSWER FIRST" (variant A). Anything still wanting an answer
// is HOISTED OUT OF DATE ORDER into its own block at the top; everything
// settled drops into a quiet list below. Spotting what needs you costs no
// reading at all — which is the entire job of the page.
//
// ⚠ CONFIRM AND DECLINE ARE DELIBERATELY IDENTICAL. Same border, same size,
// same weight, side by side, neither filled. A screen that makes yes prettier
// than no collects agreements people cannot keep, and an agreement somebody
// cannot keep is worse for the rota than a straight refusal in August.
//
// ⚠ A LITURGICAL ROLE IS READ-ONLY AND SAYS NOTHING ABOUT IT. Preaching and
// leading are fields on the Service, not Assignments, and carry no state at all
// (ADR-0018 §2) — being on the printed booklet IS the commitment (ADR-0019).
// It was decided the page gets NO explanatory copy for this, so the row has to
// read as settled through presentation alone: a serif italic, a quieter ground,
// no controls, and the chip reading "On the booklet" rather than a state.
//
// The member cannot write any of this from the browser: answering changes the
// roster row AND the occurrence's derived fields together, and the occurrence
// is editor-only to write. It goes through the `answerAssignment` callable.

(function () {
    'use strict';

    const Core = window.EventsOccurrenceCore;
    const Commitments = window.CommitmentsCore;
    const Trades = window.TradesStore;
    const TradeView = window.TradesView;
    const TradeCore = window.TradeCore;

    const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'];
    const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday',
        'Friday', 'Saturday'];

    // Local time, never UTC — a date key built from toISOString() lands a day
    // early for anyone west of GMT in the evening. Same rule as date-utils.js.
    function todayStr() {
        const d = new Date();
        return d.getFullYear() + '-' +
            String(d.getMonth() + 1).padStart(2, '0') + '-' +
            String(d.getDate()).padStart(2, '0');
    }

    function addMonths(dateStr, n) {
        const p = String(dateStr).split('-').map(Number);
        const d = new Date(p[0], (p[1] - 1) + n, p[2]);
        return d.getFullYear() + '-' +
            String(d.getMonth() + 1).padStart(2, '0') + '-' +
            String(d.getDate()).padStart(2, '0');
    }

    const partsOf = dateStr => new Date(dateStr + 'T12:00:00');

    function friendlyError(e) {
        const code = (e && e.code) || '';
        if (code === 'permission-denied' || code === 'functions/permission-denied') {
            return 'That place is not yours to answer for.';
        }
        if (code === 'functions/failed-precondition') {
            return (e && e.message) || 'That can no longer be answered.';
        }
        if (code === 'functions/not-found') {
            return 'That place is no longer on the Event.';
        }
        return 'Something went wrong. Try again in a moment.';
    }

    window.commitmentsPage = function commitmentsPage() {
        return {
            loading: true,
            error: '',
            busy: null,          // the key currently being written, so one row
                                 // can show it is working without freezing all
            toast: '',

            rank: null,
            personId: null,
            today: todayStr(),

            rows: [],
            roleDefinitions: [],

            // ── Swaps (MS-190) ───────────────────────────────────────────────
            //
            // ⚠ ONE PAGE, AND THE SPLIT IS WHOSE MOVE IT IS. Who opened a
            // conversation is a fact about the past; what a reader needs is
            // "does this need me today". So an invitation somebody sent me and
            // an offer somebody made me sit together, even though I began
            // neither, and the things I am waiting on sit lower down.
            trades: [],
            people: [],
            hidingTags: [],
            // Which occurrences can reach the open cover list at all. The
            // quiet-or-open choice is only offered where it means something.
            coverable: {},

            // One modal at a time, named by what it is asking.
            asking: null,     // invite: who shall I ask?
            replying: null,   // reply: what shall I put up?
            choosing: null,   // accept: which of theirs?
            declining: null,  // decline: quietly, or ask the church?
            picked: [],

            // ── Boot ─────────────────────────────────────────────────────────

            async init() {
                this.rank = await this.resolveRank();
                await this.load();
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
                            const r = (data && (data.permissionLevel || data.role)) || 'viewer';
                            if (Cache) {
                                Cache.writeIdentity(user.uid, {
                                    personId: this.personId, permissionLevel: r,
                                });
                            }
                            resolve(r);
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
                if (!this.personId) { this.loading = false; return; }
                try {
                    // A year ahead. The page is "the dates ahead", not a window
                    // — somebody down for Christmas in August should see it.
                    const from = this.today;
                    const to = addMonths(this.today, 12);

                    await this.loadRoleDefinitions();
                    const [occurrences, services] = await Promise.all([
                        window.EventsStore.loadCalendar(db, {
                            from: from, to: to,
                            rank: this.rank, personId: this.personId,
                        }),
                        this.loadServices(from, to),
                    ]);

                    // Whether each Event can reach the open list. A place on a
                    // participant-rung Event never can, so the choice is not
                    // offered there rather than being offered and ignored.
                    this.coverable = {};
                    occurrences.forEach(o => {
                        this.coverable[o.id] = Core.canBeCovered(o);
                    });

                    this.rows = Commitments.commitmentsFor({
                        personId: this.personId,
                        occurrences: occurrences,
                        services: services,
                        today: this.today,
                    }).map(r => this.decorate(r));

                    await this.loadTrades();
                } catch (e) {
                    console.error('Commitments load failed:', e);
                    this.error = friendlyError(e);
                } finally {
                    this.loading = false;
                }
            },

            // A place must read "Setup & Teardown", not `setup_teardown`.
            //
            // ⚠ THE COLLECTION IS `roles`. RolesCore.roleBySlug is the one thing
            // that turns a slug into a name, and it needs the STORED Role
            // Definitions handed to it — on its own it knows only the liturgical
            // ones, so every Servant Role falls through to its raw slug.
            async loadRoleDefinitions() {
                try {
                    const snap = await db.collection('roles').get();
                    this.roleDefinitions = snap.docs.map(d =>
                        Object.assign({ id: d.id }, d.data()));
                } catch (e) {
                    // Names are decoration. A failure here must not empty the
                    // page — the slug is a poor label, but it is a true one.
                    console.warn('Role definitions unavailable:', e);
                    this.roleDefinitions = [];
                }
            },

            roleNameFor(slug) {
                const def = window.RolesCore &&
                    window.RolesCore.roleBySlug(slug, this.roleDefinitions);
                return (def && def.name) || slug || 'A role';
            },

            // A date somebody can read. Trades and offered places carry the raw
            // YYYY-MM-DD, and putting that on screen beside prose is the same
            // failure as printing a slug.
            longDateOf(date) {
                if (!date) return '';
                const dt = partsOf(date);
                return dt.getDate() + ' ' + MONTHS[dt.getMonth()];
            },

            async loadServices(from, to) {
                const snap = await db.collection('services')
                    .where(firebase.firestore.FieldPath.documentId(), '>=', from)
                    .where(firebase.firestore.FieldPath.documentId(), '<=', to)
                    .get();
                return snap.docs.map(d => Object.assign({ date: d.id }, d.data()));
            },

            // ── Shaping one row ──────────────────────────────────────────────

            decorate(r) {
                const dt = partsOf(r.date);
                const answerable = r.answerable === true;
                const state = r.state;

                return Object.assign({}, r, {
                    key: [r.occurrenceId || r.date, r.roleSlug, r.slotId || 'x'].join('__'),
                    roleName: r.label || this.roleNameFor(r.roleSlug),
                    mon: MONTHS[dt.getMonth()].slice(0, 3).toUpperCase(),
                    dayNum: dt.getDate(),
                    weekday: DAYS[dt.getDay()],
                    longDate: dt.getDate() + ' ' + MONTHS[dt.getMonth()],
                    isUnanswered: answerable && state === Core.STATES.PENDING,
                    isDeclined: answerable && state === Core.STATES.DECLINED,
                    isLiturgical: !answerable,
                    // "Looking for cover" rather than "Declined": once a member
                    // can decline, the interesting fact is not that they said no
                    // but that the place is now going somewhere.
                    chipLabel: !answerable ? 'On the booklet'
                        : state === Core.STATES.CONFIRMED ? 'Confirmed'
                            : state === Core.STATES.DECLINED ? 'Looking for cover'
                                : 'Unconfirmed',
                    chipClass: !answerable
                        ? 'text-on-surface-variant border border-outline-variant font-headline-lg'
                        : state === Core.STATES.CONFIRMED
                            ? 'text-success bg-success/10'
                            : state === Core.STATES.DECLINED
                                ? 'text-error bg-error-container'
                                : 'text-warning bg-warning/10',
                });
            },

            // ── What the page is made of ─────────────────────────────────────

            get unanswered() { return this.rows.filter(r => r.isUnanswered); },
            get settled() { return this.rows.filter(r => !r.isUnanswered); },
            get isEmpty() { return !this.loading && !this.rows.length; },
            get hasUnanswered() { return this.unanswered.length > 0; },
            get hasSettled() { return this.settled.length > 0; },

            get headline() {
                const n = this.unanswered.length;
                if (!this.rows.length) return '';
                if (n === 0) return 'Everything ahead has an answer.';
                if (n === 1) return 'One still wants an answer from you.';
                return n + ' still want an answer from you.';
            },


            // ── Swaps ────────────────────────────────────────────────────────

            async loadTrades() {
                try {
                    const mine = await Trades.loadMine(db, {
                        personId: this.personId, today: this.today,
                    });
                    this.trades = mine.all;
                } catch (e) {
                    // A swap failing to load must not empty the page. The
                    // commitments above it are the primary thing.
                    console.warn('Swaps unavailable:', e);
                    this.trades = [];
                }
            },

            async loadPeople() {
                if (this.people.length) return;
                try {
                    const [people, tags] = await Promise.all([
                        db.collection('people').get(),
                        db.collection('people_tags').where('hidePeople', '==', true).get(),
                    ]);
                    this.people = people.docs.map(d =>
                        Object.assign({ id: d.id }, d.data()));
                    this.hidingTags = tags.docs.map(d => d.id);
                } catch (e) {
                    console.warn('People unavailable:', e);
                    this.people = [];
                }
            },

            // ⚠ A PERSON'S NAME IS ONE FIELD, `name`. There is no firstName /
            // lastName pair on a Person — reaching for one returns undefined
            // for everybody and the whole picker reads "Somebody", which is
            // exactly what it did.
            nameOf(personId) {
                const p = this.people.find(x => x.id === personId);
                return (p && p.name) || 'Somebody';
            },

            get swapRows() {
                return TradeView.rowsFor(this.trades, {
                    personId: this.personId,
                    today: this.today,
                    nameOf: id => this.nameOf(id),
                });
            },
            get needsYou() { return this.swapRows.yours; },
            get waitingOnThem() { return this.swapRows.theirs; },
            get hasSwaps() { return this.swapRows.all.length > 0; },

            // Every conversation going on about one of my places, so a declined
            // row can say who has been asked without a second query.
            swapsOn(row) {
                return this.swapRows.all.filter(t =>
                    t.assignment &&
                    t.assignment.occurrenceId === row.occurrenceId &&
                    t.assignment.roleSlug === row.roleSlug);
            },

            invitesLeft(row) {
                return TradeView.invitesLeft(this.trades, {
                    occurrenceId: row.occurrenceId,
                    roleSlug: row.roleSlug,
                    slotId: row.slotId || null,
                }, this.today);
            },

            // ── Asking somebody ──────────────────────────────────────────────

            async openAsk(row) {
                await this.loadPeople();
                this.asking = row;
                this.search = '';
            },

            search: '',

            get askable() {
                if (!this.asking) return [];
                const asked = TradeView.alreadyAsked(this.trades, {
                    occurrenceId: this.asking.occurrenceId,
                    roleSlug: this.asking.roleSlug,
                    slotId: this.asking.slotId || null,
                }, this.today);

                const term = (this.search || '').trim().toLowerCase();
                return TradeView.askableFrom(this.people, {
                    rank: this.rank,
                    hidingTags: this.hidingTags,
                    personId: this.personId,
                    alreadyAsked: asked,
                }).filter(p => !term ||
                    this.nameOf(p.id).toLowerCase().indexOf(term) !== -1)
                    .slice(0, 60);
            },

            // ⚠ SOMEBODY WITH NO ACCOUNT IS OFFERED ANYWAY, and warned about.
            // They cannot answer in the app today, but MS-189 will text exactly
            // these people, and a picker that hid them would have to be
            // unpicked. Withdraw is what makes an unanswerable ask harmless.
            unreachable(person) { return !person || !person.userId; },

            async ask(person) {
                if (this.busy) return;
                this.busy = 'ask';
                try {
                    const call = firebase.functions().httpsCallable('inviteToTrade');
                    await call({
                        occurrenceId: this.asking.occurrenceId,
                        roleSlug: this.asking.roleSlug,
                        slotId: this.asking.slotId || null,
                        counterpartyId: person.id,
                    });
                    await this.loadTrades();
                    this.say('Asked ' + this.nameOf(person.id) + '.');
                    if (this.invitesLeft(this.asking) <= 0) this.asking = null;
                } catch (e) {
                    this.say(friendlyError(e));
                } finally {
                    this.busy = null;
                }
            },

            // ── Answering an invitation ──────────────────────────────────────

            openReply(swap) {
                this.replying = swap;
                this.picked = [];
            },

            // What I could put up: my own answerable places, minus the one being
            // discussed. Selecting from the same list the page is made of is the
            // fiddly bit — so it happens in its own sheet rather than by turning
            // the page itself into a set of checkboxes.
            get offerable() {
                return this.rows.filter(r =>
                    !r.isLiturgical &&
                    !r.isDeclined &&
                    !(this.replying &&
                      r.occurrenceId === this.replying.assignment.occurrenceId &&
                      r.roleSlug === this.replying.assignment.roleSlug));
            },

            togglePick(row) {
                this.picked = this.picked.includes(row.key)
                    ? this.picked.filter(k => k !== row.key)
                    : this.picked.concat([row.key]);
            },

            refFor(row) {
                return {
                    occurrenceId: row.occurrenceId,
                    roleSlug: row.roleSlug,
                    slotId: row.slotId || null,
                };
            },

            // ⚠ "JUST TAKE IT" IS ITS OWN BUTTON, not an empty selection. It
            // SETTLES THERE AND THEN — no waiting, no acceptance — and hiding an
            // instant, irreversible act behind "submit with nothing ticked" is a
            // trap. It reads as what it is.
            async sendOffer(swap, take) {
                if (this.busy) return;
                this.busy = 'offer';
                try {
                    const offered = take ? [] : this.offerable
                        .filter(r => this.picked.includes(r.key))
                        .map(r => this.refFor(r));

                    const call = firebase.functions().httpsCallable('offerTrade');
                    const res = await call({
                        tradeId: swap.id,
                        offered: offered,
                    });
                    this.replying = null;
                    await this.reload();
                    this.say(res.data && res.data.settled
                        ? 'Done — it is yours now.'
                        : 'Offered. They will pick one.');
                } catch (e) {
                    this.say(friendlyError(e));
                } finally {
                    this.busy = null;
                }
            },

            // ── Answering an offer ───────────────────────────────────────────

            openChoose(swap) {
                this.choosing = swap;
            },

            async take(swap, ref) {
                if (this.busy) return;
                this.busy = 'accept';
                try {
                    const call = firebase.functions().httpsCallable('acceptTrade');
                    await call({ tradeId: swap.id, chosen: ref });
                    this.choosing = null;
                    await this.reload();
                    this.say('Swapped. Both are confirmed.');
                } catch (e) {
                    this.say(friendlyError(e));
                } finally {
                    this.busy = null;
                }
            },

            // ── Saying no, and taking it back ────────────────────────────────

            async refuseSwap(swap) {
                await this.move('refuseTrade', swap, 'Told them no.');
            },

            async withdrawSwap(swap) {
                await this.move('withdrawTrade', swap, 'Taken back.');
            },

            async move(name, swap, said) {
                if (this.busy) return;
                this.busy = swap.id;
                try {
                    const call = firebase.functions().httpsCallable(name);
                    await call({ tradeId: swap.id });
                    await this.loadTrades();
                    this.say(said);
                } catch (e) {
                    this.say(friendlyError(e));
                } finally {
                    this.busy = null;
                }
            },

            // ── Who can see it ───────────────────────────────────────────────

            async setReach(row, quiet) {
                if (this.busy) return;
                this.busy = row.key;
                try {
                    const call = firebase.functions().httpsCallable('setCoverReach');
                    await call(Object.assign(this.refFor(row), { quiet: quiet }));
                    row.quiet = quiet;
                    this.say(quiet
                        ? 'Off the open list. Only people you ask can see it.'
                        : 'On the open list. Anybody who can help now sees it.');
                } catch (e) {
                    this.say(friendlyError(e));
                } finally {
                    this.busy = null;
                }
            },

            async reload() {
                await this.load();
            },

            // ── Answering ────────────────────────────────────────────────────
            //
            // Optimistic on the row, because the whole point is that saying yes
            // costs nothing — but reverted on failure, since the server is the
            // one that decides and a screen that lies about a rota is worse than
            // a slow one.

            async answer(row, state, quiet) {
                if (this.busy) return;
                const before = row.state;
                this.busy = row.key;
                this.setRowState(row.key, state);
                try {
                    const call = firebase.functions().httpsCallable('answerAssignment');
                    await call({
                        occurrenceId: row.occurrenceId,
                        roleSlug: row.roleSlug,
                        slotId: row.slotId || null,
                        state: state,
                        quiet: quiet === true,
                    });
                    this.say(state === Core.STATES.CONFIRMED
                        ? 'Confirmed. Thank you.'
                        : quiet
                            ? 'Declined. Now ask somebody who could take it.'
                            : 'Declined. It is looking for cover.');
                } catch (e) {
                    this.setRowState(row.key, before);
                    this.say(friendlyError(e));
                } finally {
                    this.busy = null;
                }
            },

            setRowState(key, state) {
                this.rows = this.rows.map(r => (r.key === key
                    ? this.decorate(Object.assign({}, r, { state: state }))
                    : r));
            },

            confirm(row) { return this.answer(row, Core.STATES.CONFIRMED); },

            // ⚠ THE CHOICE IS ASKED AT THE MOMENT OF DECLINING, because that is
            // the only moment somebody is thinking about it. Asked later it is a
            // setting nobody visits; asked here it is the obvious next question:
            // "who should know?"
            //
            // On an Event that can reach nobody outside it, there is no choice
            // to make and none is offered — a dialog whose options do the same
            // thing teaches people to stop reading dialogs.
            decline(row) {
                if (this.coverable[row.occurrenceId] === false) {
                    return this.answer(row, Core.STATES.DECLINED, true);
                }
                this.declining = row;
            },

            async declineWith(row, quiet) {
                this.declining = null;
                await this.answer(row, Core.STATES.DECLINED, quiet);
            },

            // Changing your mind puts the row back among the unanswered, which
            // is the honest place for it: it is a thing wanting an answer again.
            change(row) {
                this.setRowState(row.key, Core.STATES.PENDING);
            },

            say(message) {
                this.toast = message;
                setTimeout(() => { this.toast = ''; }, 3600);
            },
        };
    };
}());
