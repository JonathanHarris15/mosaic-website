// Needing Somebody — the cover list (MS-20, MS-206, ADR-0030).
//
// Every Assignment currently needing a taker, soonest first, and a way to take
// one. `cover-store.js` reads the list; `cover-core.js` decides whether you may
// take a given place; this renders what they say and decides nothing.
//
// ⚠ REFUSALS SIT LEVEL WITH EVERYTHING ELSE. A place you cannot take is the
// same row, the same weight, in the same order — the reason simply replaces the
// button. No red, no dimming, no strikethrough.
//
// That is deliberate and it is the hardest call on this page. The list shows
// what you cannot take because hiding it would make the list understate how
// much the church actually needs (ADR-0030 §2) — but a list that then
// DRAMATISES half its own rows as failures reads as a wall of no, and the
// reader stops before the row they could have taken. Level, quiet, and the
// reason stated once is the whole treatment.
//
// ⚠ THE CLIENT'S VERDICT IS A COURTESY; THE SERVER'S IS THE WALL. Judging a
// place properly needs that Event's whole roster — who else is seated, who is
// serving elsewhere that morning — and reading every roster on the list is both
// slow and something the rules would refuse. So the page checks what it can see
// (the rung, your tags, the slot's requirement, the allowlist, your own Away)
// and `takeAssignment` re-checks everything with the full picture. A "Take it"
// the server then refuses is not a bug: it is the one place that could know
// telling you so.

(function () {
    'use strict';

    const Cover = window.CoverCore;
    const Store = window.CoverStore;

    const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'];
    const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday',
        'Friday', 'Saturday'];

    // How a refusal reads to the person refused. RolesCore returns a machine
    // reason; these are the sentences. Written as what the ROLE asks rather
    // than as what you lack — "this Role asks for X" not "you do not have X".
    const REASONS = {
        notVisible: 'This one is not open to you.',
        inactive: 'Your record is not active.',
        sexMismatch: 'This place is set aside for somebody else.',
        sexUnknown: 'This place asks for a man or a woman, and your record does not say.',
        missingRequiredTag: 'This Role asks for something your record does not carry yet.',
        excludedByTag: 'This Role is not one you are offered.',
        notOnAllowlist: 'Only people on this Role’s list may take it.',
        alreadyAssigned: 'You are already standing in this Role that day.',
        servingElsewhere: 'You are already down for something else that morning.',
        relationshipConflict: 'This Role asks that certain people do not serve in it together.',
        sameGroupConflict: 'Somebody from your group is already on this one.',
        notInRequiredGroup: 'This Role is staffed from one group.',
    };

    function todayStr() {
        const d = new Date();
        return d.getFullYear() + '-' +
            String(d.getMonth() + 1).padStart(2, '0') + '-' +
            String(d.getDate()).padStart(2, '0');
    }

    const partsOf = s => new Date(s + 'T12:00:00');

    // How far off it is, in the words somebody would actually use. Urgency is
    // carried here rather than by colouring the row, so a list sorted
    // soonest-first does not also shout at its own top.
    function whenOf(date, today) {
        const days = Math.round((partsOf(date) - partsOf(today)) / 86400000);
        if (days <= 0) return 'today';
        if (days === 1) return 'tomorrow';
        if (days <= 13) return 'in ' + days + ' days';
        if (days <= 60) return 'in ' + Math.round(days / 7) + ' weeks';
        return 'in ' + Math.round(days / 30) + ' months';
    }

    function friendlyError(e) {
        const code = (e && e.code) || '';
        if (code === 'functions/aborted') {
            return 'Somebody got there first — it has left the list.';
        }
        if (code === 'functions/failed-precondition') {
            return (e && e.message) || 'That one is not yours to take.';
        }
        if (code === 'functions/not-found') return 'That place has gone.';
        return 'Something went wrong. Try again in a moment.';
    }

    window.coverPage = function coverPage() {
        return {
            loading: true,
            error: '',
            taking: null,
            toast: '',
            // The Away confirmation. Your own Away never refuses you — it warns
            // (ADR-0030 §3) — so this asks rather than blocks.
            confirming: null,

            rank: null,
            personId: null,
            person: null,
            today: todayStr(),

            rows: [],
            roleDefinitions: [],
            awayStretches: [],

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
                try {
                    const [entries] = await Promise.all([
                        Store.loadCoverList(db, { rank: this.rank, from: this.today }),
                        this.loadRoleDefinitions(),
                        this.loadMe(),
                    ]);
                    this.rows = entries.map(e => this.decorate(e));
                } catch (e) {
                    console.error('Cover list load failed:', e);
                    this.error = friendlyError(e);
                } finally {
                    this.loading = false;
                }
            },

            async loadRoleDefinitions() {
                try {
                    const snap = await db.collection('roles').get();
                    this.roleDefinitions = snap.docs.map(d =>
                        Object.assign({ id: d.id }, d.data()));
                } catch (e) {
                    this.roleDefinitions = [];
                }
            },

            async loadMe() {
                if (!this.personId) return;
                try {
                    const [me, away] = await Promise.all([
                        db.collection('people').doc(this.personId).get(),
                        db.collection('people').doc(this.personId)
                            .collection('away').get(),
                    ]);
                    this.person = me.exists
                        ? Object.assign({ id: me.id }, me.data()) : null;
                    this.awayStretches = away.docs.map(d => d.data());
                } catch (e) {
                    this.person = null;
                    this.awayStretches = [];
                }
            },

            decorate(entry) {
                const dt = partsOf(entry.date);
                const def = window.RolesCore.roleBySlug(
                    entry.roleSlug, this.roleDefinitions);
                const slot = (def && (def.slots || [])
                    .find(s => s.id === entry.slotId)) || null;

                // The entry carries its own stamped rung, which is all `canSee`
                // needs — the occurrence itself is not read here, and may not be
                // readable at all.
                const occurrence = {
                    id: entry.occurrenceId,
                    seriesId: entry.seriesId,
                    date: entry.date,
                    visibility: entry.visibility,
                    participantIds: [],
                };

                const isAway = window.AwayCore &&
                    window.AwayCore.isAwayOn(this.awayStretches, entry.date);

                const verdict = this.person ? Cover.verdictFor({
                    rank: this.rank,
                    person: this.person,
                    occurrence: occurrence,
                    roleDef: def,
                    slot: slot,
                    context: {
                        people: [this.person],
                        awayPersonIds: isAway ? [this.personId] : [],
                        // Not known here — see the note at the top of this file.
                        // The server checks these with the full roster.
                        assigned: [], assignedElsewhere: [],
                        relationships: [], groups: [],
                    },
                }) : { permitted: false, reason: 'notVisible', warning: null };

                return Object.assign({}, entry, {
                    key: entry.id,
                    roleName: (def && def.name) || entry.roleName || entry.roleSlug,
                    dayNum: String(dt.getDate()).padStart(2, '0'),
                    mon: MONTHS[dt.getMonth()].slice(0, 3).toUpperCase(),
                    weekday: DAYS[dt.getDay()],
                    when: whenOf(entry.date, this.today),
                    soon: Math.round((dt - partsOf(this.today)) / 86400000) <= 9,
                    permitted: verdict.permitted === true,
                    warning: verdict.warning || null,
                    reason: verdict.permitted
                        ? null
                        : (REASONS[verdict.reason] || 'This one is not yours to take.'),
                });
            },

            get takeableCount() { return this.rows.filter(r => r.permitted).length; },
            get isEmpty() { return !this.loading && !this.rows.length; },
            get headline() {
                const n = this.rows.length;
                if (!n) return '';
                return n + (n === 1 ? ' place needs' : ' places need') + ' somebody. ' +
                    'You can take ' + this.takeableCount + ' of them.';
            },

            // ── Taking one ───────────────────────────────────────────────────

            take(row) {
                if (this.taking) return;
                // Your own Away asks rather than refuses. Overruling what you
                // said about your own life is changing your mind, not the app
                // disbelieving you — but you should be told you are doing it.
                if (row.warning === 'away') { this.confirming = row; return; }
                return this.commit(row);
            },

            async commit(row) {
                this.confirming = null;
                this.taking = row.key;
                try {
                    const call = firebase.functions().httpsCallable('takeAssignment');
                    await call({
                        occurrenceId: row.occurrenceId,
                        roleSlug: row.roleSlug,
                        slotId: row.slotId || null,
                    });
                    // It leaves the list because it is no longer needing anybody.
                    this.rows = this.rows.filter(r => r.key !== row.key);
                    this.say('Taken, and confirmed — ' + row.roleName +
                        ', ' + row.dayNum + ' ' + row.mon + '.');
                } catch (e) {
                    // Losing the race is an answer, not a failure. The row goes,
                    // because somebody else really is standing in it now.
                    if ((e && e.code) === 'functions/aborted') {
                        this.rows = this.rows.filter(r => r.key !== row.key);
                    }
                    this.say(friendlyError(e));
                } finally {
                    this.taking = null;
                }
            },

            say(message) {
                this.toast = message;
                setTimeout(() => { this.toast = ''; }, 3600);
            },
        };
    };
}());
