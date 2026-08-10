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
            roleNames: {},

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

                    await this.loadRoleNames();
                    const [occurrences, services] = await Promise.all([
                        window.EventsStore.loadCalendar(db, {
                            from: from, to: to,
                            rank: this.rank, personId: this.personId,
                        }),
                        this.loadServices(from, to),
                    ]);

                    this.rows = Commitments.commitmentsFor({
                        personId: this.personId,
                        occurrences: occurrences,
                        services: services,
                        today: this.today,
                    }).map(r => this.decorate(r));
                } catch (e) {
                    console.error('Commitments load failed:', e);
                    this.error = friendlyError(e);
                } finally {
                    this.loading = false;
                }
            },

            // A place must read "Kids Team", not `kids`. RolesCore.roleBySlug is
            // the one thing that turns a slug into a name, which is also why the
            // server never accepts one from the caller.
            async loadRoleNames() {
                const names = {};
                (window.RolesCore.allRoles ? window.RolesCore.allRoles() : [])
                    .forEach(r => { if (r && r.slug) names[r.slug] = r.name; });
                try {
                    const snap = await db.collection('role_definitions').get();
                    snap.docs.forEach(d => {
                        const r = d.data();
                        if (r && r.slug) names[r.slug] = r.name;
                    });
                } catch (e) {
                    // Names are decoration. A failure here must not empty the
                    // page — the slug is a poor label, but it is a true one.
                    console.warn('Role names unavailable:', e);
                }
                this.roleNames = names;
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
                    roleName: r.label || this.roleNames[r.roleSlug] || r.roleSlug,
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

            // ── Answering ────────────────────────────────────────────────────
            //
            // Optimistic on the row, because the whole point is that saying yes
            // costs nothing — but reverted on failure, since the server is the
            // one that decides and a screen that lies about a rota is worse than
            // a slow one.

            async answer(row, state) {
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
                    });
                    this.say(state === Core.STATES.CONFIRMED
                        ? 'Confirmed. Thank you.'
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
            decline(row) { return this.answer(row, Core.STATES.DECLINED); },

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
