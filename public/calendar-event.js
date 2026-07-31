// Event detail — one Event, one screen, two very different readers
// (MS-154 / MS-155 / MS-156 / MS-157).
//
// An editor sees the Roles, the picker, the state controls, the recurrence
// pattern and the visibility ladder. A member sees their own part, and the
// roster only if the editor chose to share it.
//
// Four things this screen is careful about:
//
//   • A slot holds ONE current Assignment. Assigning a replacement overwrites
//     it — which is what clears a decline and drops the decliner from the
//     participant list in a single write.
//   • A one-off Role stays structurally light. No slots, no rules, no counts.
//   • Changing a recurrence pattern NEVER migrates silently. The orphans are
//     computed, shown with who is on them, and acted on per-date.
//   • "Did they serve?" is scaffolding, so it is one row — never a banner, never
//     a modal, and never when there is nothing to ask.

(function () {
    'use strict';

    const Core = window.EventsOccurrenceCore;
    const Store = window.EventsStore;
    const View = window.CalendarView;
    const Roles = window.RolesCore;

    // A slot id no real slot uses, so somebody blocked because they are down for
    // the liturgy can never be mistaken for somebody sitting in a place here.
    const LITURGICAL_SLOT = '__liturgical__';

    const params = new URLSearchParams(window.location.search);

    // This component is the Event detail SCREEN, and it is also the behaviour
    // behind the Roles panel wherever that is mounted (MS-16). The service page
    // mounts it for one Sunday, beside the order of service, so that staffing a
    // Sunday and building a Sunday are not two different pages.
    //
    // `config` is how a host says which occurrence and how much of it:
    //
    //   occurrenceId  the occurrence to open, instead of reading ?id= from the
    //                 address bar. A host that is already about one date knows
    //                 it without being told twice.
    //   rolesOnly     the host shows the Roles panel and nothing else, so the
    //                 controls that change WHICH Roles the Event carries are
    //                 absent. That is a property of the Event, decided on the
    //                 Event — changing it from inside one Sunday is how somebody
    //                 changes every Sunday by accident.
    window.eventDetailPage = function eventDetailPage(config) {
        const cfg = config || {};

        return {
            loading: true,
            error: '',
            saving: false,

            // Filling Roles is always on offer; deciding which Roles exist is not.
            canEditRoleSet: !cfg.rolesOnly,

            rank: null,
            personId: null,
            uid: null,

            occurrence: null,
            series: null,
            assignments: [],
            people: [],
            roleDefinitions: [],
            relationships: [],
            groups: [],

            // The screens that sit over this one.
            picker: { open: false, roleSlug: null, slotId: null, query: '', hideBlocked: false, picked: null, loading: false },
            pattern: { open: false, rule: null, orphans: [], choices: {} },
            tidyUp: { open: false, ticks: {} },
            // Set only when a Role being taken off would drop somebody.
            pendingRemoval: null,
            oneOffDraft: '',

            // ── Loading ──────────────────────────────────────────────────────

            async init() {
                await this.resolveViewer();
                await this.load();
            },

            // A dropped read is not a broken page, it is a read that did not come
            // back — and the difference matters, because trying again usually
            // works. Without this the only way out of "could not be loaded" is a
            // full page reload, which on the service page means losing whatever
            // is unsaved in the order of service.
            async retry() {
                if (this.loading) return;
                this.error = '';
                this.loading = true;
                await this.load();
            },

            resolveViewer() {
                return new Promise(resolve => {
                    auth.onAuthStateChanged(async user => {
                        if (!user) { this.rank = null; return resolve(); }
                        this.uid = user.uid;
                        try {
                            const data = await getUserData(user.uid);
                            this.personId = (data && data.personId) || null;
                            this.rank = (data && (data.permissionLevel || data.role)) || 'viewer';
                        } catch (e) {
                            this.rank = 'viewer';
                        }
                        resolve();
                    });
                });
            },

            // ── Creating ─────────────────────────────────────────────────────
            //
            // A one-off Event is a single occurrence document. A repeating one is
            // a SERIES carrying a rule and NO occurrence documents — its dates
            // are computed, and a document appears the first time something lands
            // on one.

            creating: false,
            draft: {
                name: '', date: '', time: '', location: '', description: '',
                visibility: 'member', rosterShared: false,
                recurrence: { freq: 'once', startDate: '', weekday: null, time: '', ends: { kind: 'never' } },
            },

            get draftSentence() {
                const rule = Object.assign({}, this.draft.recurrence, {
                    startDate: this.draft.date, time: this.draft.time,
                });
                return View.recurrenceSentence(rule);
            },

            get draftDates() {
                if (!this.draft.date) return [];
                const rule = Object.assign({}, this.draft.recurrence, { startDate: this.draft.date });
                if (rule.freq === 'once') return [this.draft.date];
                return View.nextDates(rule, this.draft.date, 6);
            },

            get draftValid() {
                return !!(String(this.draft.name).trim() && this.draft.date);
            },

            async createEvent() {
                if (!this.draftValid || this.saving) return;
                this.saving = true;
                this.error = '';
                try {
                    const rule = Object.assign({}, this.draft.recurrence, {
                        startDate: this.draft.date,
                        time: this.draft.time || null,
                    });
                    if (rule.freq !== 'once' && !Number.isInteger(rule.weekday)) {
                        // Derive the weekday from the start date rather than
                        // making the editor state it twice.
                        rule.weekday = window.DateUtils.parseDateStr(this.draft.date).getDay();
                    }

                    const made = await Store.createEvent(db, {
                        name: this.draft.name,
                        date: this.draft.date,
                        time: this.draft.time,
                        location: this.draft.location,
                        description: this.draft.description,
                        visibility: this.draft.visibility,
                        rosterShared: this.draft.rosterShared,
                        recurrence: rule,
                    });

                    // A one-off has a document to open. A series does not yet —
                    // nothing has landed on any of its dates — so the Calendar is
                    // where you see it.
                    window.location.href = made.kind === 'occurrence'
                        ? 'calendar-event.html?id=' + encodeURIComponent(made.id)
                        : 'calendar.html';
                } catch (e) {
                    console.error('Create failed:', e);
                    this.error = e.message || 'That event could not be created.';
                    this.saving = false;
                }
            },

            // Cancel one date without disturbing the rest of the series.
            async skipThisOne() {
                if (!this.series || !this.occurrence) return;
                this.saving = true;
                try {
                    await Store.cancelOccurrence(
                        db, this.series.id, this.occurrence.date, !this.occurrence.cancelled
                    );
                    this.occurrence.cancelled = !this.occurrence.cancelled;
                } catch (e) {
                    console.error('Cancel failed:', e);
                    this.error = 'That date could not be changed.';
                } finally {
                    this.saving = false;
                }
            },

            async load() {
                this.loading = true;
                this.error = '';
                try {
                    // Managing the EVENT rather than one date of it: its time,
                    // and which Roles every date of it carries. This is the only
                    // way into the Sunday Service as an Event — the liturgy is
                    // still edited per-Sunday in the order of service, and that
                    // separation is what keeps the printed booklet safe.
                    const seriesId = cfg.occurrenceId ? null : params.get('series');
                    if (seriesId) return await this.loadSeriesMode(seriesId);

                    // A host that mounted this for one date said so; otherwise the
                    // address bar names it.
                    const id = cfg.occurrenceId || params.get('id');

                    // No id means this is a new Event, not a broken link.
                    if (!id) {
                        if (!this.isEditor) {
                            this.error = 'Only an editor can create an event.';
                            return;
                        }
                        this.creating = true;
                        // The Calendar's day menu puts the day you clicked in the
                        // link, so the form opens already on it. Today is only the
                        // fallback for "New event" pressed from the toolbar, where
                        // no day was named.
                        this.draft.date = params.get('date') || window.DateUtils.todayStr();
                        return;
                    }

                    const loaded = await Store.loadOccurrence(db, id);
                    if (!loaded) { this.error = 'That event could not be found.'; return; }

                    this.occurrence = loaded;
                    this.assignments = loaded.assignments || [];
                    this.startOccurrenceDraft();

                    // The rest in one wave. None of these three needs anything
                    // from the others — they were only sequential because they
                    // were written in the order somebody thought of them, and
                    // each `await` is a whole round trip.
                    //
                    // allSettled, NOT all. Reads on this transport get dropped —
                    // that is what the deadline in local-cache.js exists for —
                    // and with `all` a dropped read of the SERIES blanked the
                    // whole screen, roster and all, over a document the roster
                    // never needed. Only the people and the Role definitions are
                    // worth failing for, because without them there is nothing
                    // to draw.
                    const [series, core, liturgy] = await Promise.allSettled([
                        loaded.seriesId
                            ? db.collection('events').doc(loaded.seriesId).get()
                            : Promise.resolve(null),

                        this.isEditor ? this.loadEditorData() : this.loadPeople(),

                        // A Sunday's liturgy lives on the Service document, not
                        // in assignments, and the picker has to see it to know
                        // who is already busy.
                        this.isSunday
                            ? Store.loadLiturgicalHolders(db, loaded.date)
                            : Promise.resolve([]),
                    ]);

                    if (core.status === 'rejected') throw core.reason;

                    if (series.status === 'fulfilled' && series.value && series.value.exists) {
                        this.series = Object.assign({ id: series.value.id }, series.value.data());
                    } else if (series.status === 'rejected') {
                        // Survivable: the series carries the recurrence and the
                        // colour, so the roster reads fine without it.
                        console.warn('Could not read the event series:', series.reason);
                    }

                    if (liturgy.status === 'fulfilled') {
                        this.liturgicalHolders = liturgy.value || [];
                    } else {
                        // Already degrades to nobody by design — worth saying out
                        // loud, because the cost is that somebody preaching stays
                        // assignable rather than showing as busy.
                        console.warn('Could not read who is leading this Sunday:', liturgy.reason);
                    }
                } catch (e) {
                    console.error('Event load failed:', e);
                    this.error = (e && e.code === 'permission-denied')
                        ? 'You are not able to see this event.'
                        : 'That event could not be loaded just now.';
                } finally {
                    this.loading = false;
                }
            },

            // A host that has already read the directory hands it over rather
            // than making this read it again. The service page had loaded all 74
            // People into its own registry before the Roles tab was ever opened,
            // and this fetched the identical collection a second time — on a
            // transport where a dropped read is the failure mode, the cheapest
            // read is the one not issued.
            //
            // Empty means the host has not got there yet, which is not the same
            // as "no people", so that falls through and reads.
            async loadPeople() {
                if (cfg.people && cfg.people.length) {
                    this.people = cfg.people.slice()
                        .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
                    return;
                }

                const snap = await db.collection('people').get();
                this.people = snap.docs
                    .map(d => Object.assign({ id: d.id }, d.data()))
                    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
            },

            // What the SCREEN needs: the people, to put a name against whoever is
            // in a slot, and the Role Definitions, to draw the cards at all.
            //
            // Relationships, groups and privacy tags are NOT here. They answer
            // "who may take this place", which is a question nobody has asked
            // until they open the picker — and three collections is three reads
            // and three chances of a dropped one, paid by every editor who only
            // came to look at the roster.
            async loadEditorData() {
                const [, roles] = await Promise.all([
                    this.loadPeople(),
                    db.collection('roles').get(),
                ]);
                this.roleDefinitions = roles.docs.map(d => Object.assign({ id: d.id }, d.data()));
            },

            // Loaded once, the first time somebody opens the picker, and kept.
            pickerDataLoaded: false,

            async ensurePickerData() {
                if (this.pickerDataLoaded) return;

                const [rels, groups] = await Promise.all([
                    // Serving rules may only name a Relationship Type an elder has
                    // shared with editors, so the query is constrained the same way
                    // the Roles Manager constrains it. Unconstrained it would error.
                    db.collection('relationships').where('sharedWithEditors', '==', true).get().catch(() => ({ docs: [] })),
                    db.collection('relationship_groups').where('sharedWithEditors', '==', true).get().catch(() => ({ docs: [] })),
                ]);
                this.relationships = rels.docs.map(d => d.data());
                this.groups = groups.docs.map(d => Object.assign({ id: d.id }, d.data()));
                await this.loadHidingTags();

                this.pickerDataLoaded = true;
            },

            // What time this date happens at. Read through the model rather than
            // off the document, because a date OF A SERIES takes its time from
            // the rule — a copy on the occurrence is a stale stamp, not a
            // deliberate per-date time, and letting it win is what made the top
            // of this screen say 4:30 am while the bottom said 4:30 pm.
            get eventTime() {
                return Core.timeOf(this.occurrence, this.series && this.series.recurrence);
            },

            // ── Who is looking ───────────────────────────────────────────────

            // Nobody is signed in. Worth saying, because a signed-out Event page
            // is not an error — it is the public reading of it, with the Roles
            // and every control simply absent. That looks like the feature is
            // missing rather than like you are.
            get signedOut() { return !this.loading && !this.rank; },

            get signInHref() {
                return window.MOSAIC_SHELL === 'mobile' ? 'mobile.html#/login' : 'login.html';
            },

            get isEditor() {
                return ['editor', 'admin', 'elder', 'super_admin'].indexOf(this.rank) !== -1;
            },

            get isSunday() {
                return this.occurrence && this.occurrence.seriesId === Core.SUNDAY_SERVICE_ID;
            },

            get isPast() {
                return this.occurrence && this.occurrence.date < window.DateUtils.todayStr();
            },

            // A member sees the roster only if the editor chose to share it. Your
            // OWN part is always yours to see.
            get canSeeRoster() {
                if (this.isEditor) return true;
                return !!(this.occurrence && this.occurrence.rosterShared);
            },

            get myAssignment() {
                if (!this.personId) return null;
                return this.assignments.find(a => a.personId === this.personId) || null;
            },

            get needsAttention() { return Core.needsAttention({ assignments: this.assignments }); },

            get declined() {
                return this.assignments.filter(a => (a.state || Core.STATES.PENDING) === Core.STATES.DECLINED);
            },

            // ── Roles on this Event ──────────────────────────────────────────
            //
            // Managed Roles come from the Roles Manager and arrive WITH their
            // slots and restriction rules. One-off Roles are a label and some
            // people, and nothing more — no slots, no rules, no count.
            //
            // NOTE THE FIELD NAME. `occurrenceRoleSlugs` lives on the OCCURRENCE
            // and says which Roles THIS DATE needs. The series has its own
            // `roleSlugs` (EventsCore) saying which Roles the series carries.
            // They are different lists at different levels, and giving them the
            // same name — as an earlier pass did — reads as one field to anybody
            // holding CONTEXT.md's Event series entry in their head.

            // The Roles the whole Event carries, minus the liturgical ones. Those
            // are filled in the order of service and print in the booklet — a
            // fillable card here would be a second, silent way to set one.
            get seriesRoleSlugsHere() {
                return (((this.series && this.series.roleSlugs) || []))
                    .filter(slug => Roles.LITURGICAL_SLUGS.indexOf(slug) === -1);
            },

            // Both lists, the Event's first. Adding "Sound desk" to the Sunday
            // Service has to mean every Sunday HAS a sound desk to fill —
            // otherwise the series screen is a list that does nothing.
            get roleSlugsHere() {
                const fromSeries = this.seriesRoleSlugsHere;
                const fromDate = ((this.occurrence && this.occurrence.occurrenceRoleSlugs) || [])
                    .filter(slug => fromSeries.indexOf(slug) === -1);
                return fromSeries.concat(fromDate);
            },

            get managedRoles() {
                const fromSeries = this.seriesRoleSlugsHere;
                return this.roleSlugsHere
                    .map(slug => this.roleDefinitions.find(d => d.slug === slug))
                    .filter(Boolean)
                    .map(def => ({
                        def: def,
                        // Where it came from, so the card knows whether taking it
                        // off this date is a thing that can be meant.
                        fromSeries: fromSeries.indexOf(def.slug) !== -1,
                        slots: (def.slots || []).map((slot, i) => ({
                            index: i + 1,
                            slot: slot,
                            requirementLabel: this.requirementLabel(slot.requirement),
                            assignment: this.assignmentAt(def.slug, slot.id),
                        })),
                        needsAttention: (def.slots || []).some(slot => {
                            const a = this.assignmentAt(def.slug, slot.id);
                            return a && (a.state || Core.STATES.PENDING) === Core.STATES.DECLINED;
                        }),
                        filled: (def.slots || []).filter(slot => this.assignmentAt(def.slug, slot.id)).length,
                    }));
            },

            get oneOffRoles() {
                return ((this.occurrence && this.occurrence.oneOffRoles) || []).map(job => ({
                    id: job.id,
                    label: job.label,
                    people: this.assignments.filter(a => a.oneOffId === job.id),
                }));
            },

            assignmentAt(roleSlug, slotId) {
                return this.assignments.find(a => a.roleSlug === roleSlug && a.slotId === slotId && !a.oneOffId) || null;
            },

            requirementLabel(requirement) {
                if (requirement === Roles.REQUIREMENTS.MALE) return 'A man';
                if (requirement === Roles.REQUIREMENTS.FEMALE) return 'A woman';
                return 'Either';
            },

            // ── Writing ──────────────────────────────────────────────────────

            actor() { return { actorUid: this.uid, at: new Date().toISOString() }; },

            async persist() {
                this.saving = true;
                try {
                    await Store.saveOccurrence(db, Object.assign({}, this.occurrence, {
                        assignments: this.assignments,
                    }));
                    // Keep the derived fields in step locally too, so the banner
                    // and the flag do not wait for a reload to agree.
                    this.occurrence.participantIds = Core.participantIds(this.assignments);
                } catch (e) {
                    console.error('Save failed:', e);
                    this.error = 'That change could not be saved.';
                } finally {
                    this.saving = false;
                }
            },

            // ── Moving THIS ONE, without touching the pattern ────────────────
            //
            // "First Sunday of the month, except in August when it is the
            // fifteenth." Editing the pattern for that would be wrong twice over:
            // it would move every other month too, and it would raise the orphan
            // confrontation over a change nobody meant to make.

            move: { open: false, toDate: '' },

            // Whether the pattern of this Event is one date's business at all.
            // Never a Sunday's: it is every Sunday BY DEFINITION, so there is no
            // pattern to change — and skipping one here would mark the Event off
            // while its order of service sat untouched under its own date, so one
            // Sunday would say two different things.
            get patternEditable() {
                return this.isEditor && !!this.series && !this.isSunday;
            },

            // The Event above this date. A one-off has none — it IS the Event.
            get eventHref() {
                const seriesId = this.occurrence && this.occurrence.seriesId;
                return seriesId
                    ? 'calendar-event.html?series=' + encodeURIComponent(seriesId)
                    : null;
            },

            get canMove() {
                // A one-off has no pattern to leave alone — you just change its
                // date. The Sunday Service keeps its order of service under its
                // own date, so moving the Event would split one Sunday in two.
                return this.isEditor
                    && !!this.series
                    && !this.isSunday
                    && !!(this.series.recurrence || {}).freq
                    && this.series.recurrence.freq !== 'once';
            },

            openMove() {
                // Starts on the date it is already on, so the field reads as
                // "change this" rather than as an empty question.
                this.move = { open: true, toDate: (this.occurrence && this.occurrence.date) || '' };
            },

            get moveValid() {
                const to = this.move.toDate;
                return !!to && !!this.occurrence && to !== this.occurrence.date;
            },

            get moveSentence() {
                if (!this.moveValid) return '';
                return 'This one moves to ' + this.longDate(this.move.toDate) +
                    '. Every other date stays where it is.';
            },

            async saveMove() {
                if (!this.moveValid || this.saving) return;
                this.saving = true;
                this.error = '';
                try {
                    const to = this.move.toDate;
                    await Store.moveOccurrence(db, this.series.id, this.occurrence.date, to, {
                        series: this.series,
                    });
                    // The id is derived from the date, so the moved instance is a
                    // different document — the page has to follow it there.
                    window.location.href = 'calendar-event.html?id=' +
                        encodeURIComponent(Core.occurrenceId(this.series.id, to));
                } catch (e) {
                    console.error('Move failed:', e);
                    this.error = (e && e.message) || 'That date could not be changed.';
                    this.saving = false;
                }
            },

            get movedNote() { return Core.movedNote(this.occurrence); },

            // ── Who is already down for the liturgy ──────────────────────────
            //
            // A Sunday's liturgical Roles are FIELDS on the Service document, not
            // Assignments — the ones the printed booklet reads. So nothing in the
            // Assignment model knows about them, and without this the picker for
            // the sound desk cheerfully offers you the preacher.
            //
            // Loaded on a Sunday only. There is no Service document for a
            // Wednesday, and asking for one would be a question about the wrong
            // kind of day.
            liturgicalHolders: [],

            get liturgicalBlocks() {
                return this.isSunday ? (this.liturgicalHolders || []) : [];
            },

            // ── Managing the Event itself, not one date of it ────────────────
            //
            // The Sunday Service has always been a real series document carrying
            // real Roles (MS-13), and until now nothing could open it. So this is
            // where its time is set and where an editor says which Servant Roles
            // every Sunday needs — welcome team, sound desk — alongside the
            // liturgical Roles, which are shown but never editable here.

            managingSeries: false,

            async loadSeriesMode(seriesId) {
                if (!this.isEditor) {
                    this.error = 'Only an editor can manage an event.';
                    return;
                }
                this.managingSeries = true;

                // Opening the Sunday Service is also the moment it gets repaired
                // if it has drifted, or created if it has never existed. Safe to
                // run every time: it writes only when something is actually wrong.
                this.series = (seriesId === Core.SUNDAY_SERVICE_ID)
                    ? (await Store.ensureSundayService(db, Roles.LITURGICAL_SLUGS)).series
                    : await Store.loadSeries(db, seriesId);

                if (!this.series) { this.error = 'That event could not be found.'; return; }

                this.occurrence = { seriesId: seriesId, name: this.series.name };
                this.startSeriesDraft();
                await this.loadEditorData();
            },

            get isSundaySeries() {
                return !!this.series && this.series.id === Core.SUNDAY_SERVICE_ID;
            },

            // The details of a repeating Event live on the SERIES — they are true
            // of every date of it — so this is where they are edited. Held in a
            // draft rather than written per keystroke: a name is half-typed for
            // most of the time somebody is typing it.
            seriesDraft: { name: '', location: '', description: '' },

            startSeriesDraft() {
                const s = this.series || {};
                this.seriesDraft = {
                    name: s.name || '',
                    location: s.location || '',
                    description: s.description || '',
                };
            },

            get seriesDetailsChanged() {
                const s = this.series || {};
                return ['name', 'location', 'description'].some(
                    f => String(this.seriesDraft[f] || '') !== String(s[f] || '')
                );
            },

            get seriesDetailsValid() { return !!String(this.seriesDraft.name || '').trim(); },

            async saveSeriesDetails() {
                if (!this.seriesDetailsValid || !this.seriesDetailsChanged || this.saving) return;
                this.saving = true;
                this.error = '';
                try {
                    const saved = await Store.saveSeriesDetails(db, this.series.id, this.seriesDraft);
                    Object.keys(saved).forEach(f => { this.series[f] = saved[f]; });
                    this.startSeriesDraft();
                } catch (e) {
                    console.error('Series details failed:', e);
                    this.error = (e && e.message) || 'Those details could not be saved.';
                } finally {
                    this.saving = false;
                }
            },

            // Who can see it. Restamped onto every occurrence, PAST ONES
            // INCLUDED — a security rule reads visibility off the document and
            // cannot go and look at the series.
            get seriesVisibility() {
                return (this.series && this.series.visibility) || 'member';
            },

            async setSeriesVisibility(level) {
                if (this.saving || this.isSundaySeries) return;
                this.saving = true;
                this.error = '';
                try {
                    await Store.restampSeriesVisibility(
                        db, this.series.id, level, this.series.rosterShared === true
                    );
                    this.series.visibility = level;
                } catch (e) {
                    console.error('Series visibility failed:', e);
                    this.error = (e && e.message) || 'That could not be saved.';
                } finally {
                    this.saving = false;
                }
            },

            async setSeriesRosterShared(shared) {
                if (this.saving || this.isSundaySeries) return;
                this.saving = true;
                try {
                    await Store.restampSeriesVisibility(
                        db, this.series.id, this.seriesVisibility, shared === true
                    );
                    this.series.rosterShared = shared === true;
                } catch (e) {
                    console.error('Roster sharing failed:', e);
                    this.error = 'That could not be saved.';
                } finally {
                    this.saving = false;
                }
            },

            get seriesTime() {
                const rule = this.series && this.series.recurrence;
                return (rule && rule.time) || '';
            },

            get seriesPattern() {
                if (!this.series) return '';
                const rule = this.series.recurrence
                    || (this.isSundaySeries ? Store.SUNDAY_RULE : null);
                return rule ? View.recurrenceSentence(rule) : 'No pattern set.';
            },

            // The Roles this Event carries, every date of it. Liturgical ones
            // come first and are locked — they are assigned through the order of
            // service and print in the booklet, so this screen SHOWS them (an
            // editor needs to see the whole shape of a Sunday) and never lets one
            // be dropped.
            get seriesRoles() {
                const slugs = (this.series && this.series.roleSlugs) || [];
                const locked = (this.series && this.series.lockedRoleSlugs) || [];
                return slugs.map(slug => {
                    const def = this.roleDefinitions.find(d => d.slug === slug);
                    const slots = (def && def.slots) || [];
                    return {
                        slug: slug,
                        // `roleName` searches the code-defined liturgical Roles as
                        // well as the stored ones. A lookup over stored definitions
                        // alone falls through to the slug, and the screen reads
                        // "worship_helper" at somebody.
                        name: this.roleName(slug),
                        slots: slots,
                        // What an editor is deciding is how many people have to be
                        // there on the day. "Places" is the model's word for it,
                        // and the model is not who is reading this.
                        needed: slots.length
                            ? 'Needs ' + slots.length + (slots.length === 1 ? ' person' : ' people')
                            : 'Nobody needed yet',
                        locked: locked.indexOf(slug) !== -1
                            || Roles.LITURGICAL_SLUGS.indexOf(slug) !== -1,
                    };
                });
            },

            get liturgicalRoles() { return this.seriesRoles.filter(r => r.locked); },
            get servantRoles() { return this.seriesRoles.filter(r => !r.locked); },

            // Servant Roles from the Roles Manager not yet on this Event.
            get seriesRolesAvailable() {
                const on = (this.series && this.series.roleSlugs) || [];
                return this.roleDefinitions
                    .filter(d => Roles.LITURGICAL_SLUGS.indexOf(d.slug) === -1)
                    .filter(d => on.indexOf(d.slug) === -1);
            },

            // Which dates of this Event have people in a Role, and who. Read the
            // same way `openPattern` reads its orphans — constrained to the
            // viewer's OWN rungs, because asking for a rung they cannot read
            // fails the whole query and looks exactly like "nobody is on it".
            async seriesRoleUsage(slug) {
                const snap = await db.collection('event_occurrences')
                    .where('visibility', 'in', Core.visibilityQueryFor(this.rank).rungs)
                    .where('seriesId', '==', this.series.id)
                    .get();

                const rows = await Promise.all(snap.docs.map(async d => {
                    const roster = await d.ref.collection('roster').get().catch(() => ({ docs: [] }));
                    const personIds = roster.docs
                        .map(r => r.data())
                        .filter(a => a.roleSlug === slug && !a.oneOffId)
                        .map(a => a.personId);
                    return { date: (d.data() || {}).date, personIds: personIds };
                }));

                return rows.filter(r => r.personIds.length);
            },

            // Taking a Role off the EVENT drops everybody in it on EVERY date.
            // That is a bigger thing than the per-date removal this guard used to
            // cover, not a smaller one — so the question moved with the control
            // rather than being left behind on a screen that no longer has it.
            async askRemoveSeriesRole(slug) {
                if (this.saving) return;
                const def = this.roleDefinitions.find(d => d.slug === slug);
                const name = (def && def.name) || slug;

                this.saving = true;
                let usage = [];
                try {
                    usage = await this.seriesRoleUsage(slug);
                } catch (e) {
                    console.error('Could not check who is on that role:', e);
                    // Could not check is not the same as nobody, so it still asks
                    // — and says that the count is the part it could not read.
                    this.saving = false;
                    this.pendingRemoval = {
                        kind: 'seriesRole', key: slug, name: name, count: 0,
                        sentence: 'We could not check who is down for this on other dates. ' +
                            'Anyone who is loses their place.',
                    };
                    return;
                }
                this.saving = false;

                if (!usage.length) return this.removeSeriesRole(slug);

                const names = [];
                usage.forEach(u => u.personIds.forEach(id => {
                    const n = this.personName(id);
                    if (names.indexOf(n) === -1) names.push(n);
                }));

                this.pendingRemoval = {
                    kind: 'seriesRole',
                    key: slug,
                    name: name,
                    count: usage.length,
                    sentence: View.listSentence(names) +
                        (names.length === 1 ? ' loses their place' : ' lose their places') +
                        ' across ' + usage.length + (usage.length === 1 ? ' date.' : ' dates.'),
                };
            },

            async setSeriesRoles(slugs) {
                if (this.saving) return;
                this.saving = true;
                this.error = '';
                try {
                    await Store.setSeriesRoles(db, this.series.id, slugs);
                    this.series.roleSlugs = slugs;
                } catch (e) {
                    console.error('Series roles failed:', e);
                    this.error = (e && e.message) || 'That change could not be saved.';
                } finally {
                    this.saving = false;
                }
            },

            addSeriesRole(slug) {
                const slugs = ((this.series.roleSlugs) || []).concat([slug]);
                return this.setSeriesRoles(slugs);
            },

            removeSeriesRole(slug) {
                const slugs = ((this.series.roleSlugs) || []).filter(s => s !== slug);
                return this.setSeriesRoles(slugs);
            },

            async saveSeriesTime(time) {
                if (this.saving) return;
                this.saving = true;
                this.error = '';
                try {
                    const rule = await Store.setSeriesTime(db, this.series.id, time);
                    this.series.recurrence = rule;
                } catch (e) {
                    console.error('Series time failed:', e);
                    this.error = (e && e.message) || 'That time could not be saved.';
                } finally {
                    this.saving = false;
                }
            },

            // The next few dates, so an editor can jump straight to a Sunday's
            // order of service — which is where a liturgical Role actually gets
            // somebody's name against it.
            get seriesNextDates() {
                const rule = this.series && (this.series.recurrence
                    || (this.isSundaySeries ? Store.SUNDAY_RULE : null));
                if (!rule) return [];
                return View.nextDates(rule, window.DateUtils.todayStr(), 4);
            },

            // Two different jobs on a Sunday, so two different links. Filling the
            // sound desk and building the order of service are not the same act,
            // and one screen pretending to be both is how the liturgy ends up
            // editable from the Event model.
            dateHref(date) {
                return 'calendar-event.html?id=' + encodeURIComponent(
                    Core.occurrenceId(this.series.id, date));
            },

            orderOfServiceHref(date) {
                return 'service-builder.html?date=' + encodeURIComponent(date);
            },

            // ── The colour it shows up as ────────────────────────────────────
            //
            // A recurring Event keeps this on the SERIES, so every date matches
            // and one change moves them all. A one-off Event has no series — its
            // occurrence IS the whole Event — so it carries its own.

            get colours() { return View.EVENT_COLOURS; },

            // Only where it decides one thing. On a repeating Event the colour is
            // the SERIES' — a swatch on one date would restyle every other date
            // from a screen that looks like it is about one of them.
            get colourEditable() {
                return this.managingSeries || this.isOneOff;
            },

            get colour() {
                return View.colourOf({
                    seriesId: this.occurrence && this.occurrence.seriesId,
                    colour: this.occurrence && this.occurrence.colour,
                    seriesColour: this.series && this.series.colour,
                });
            },

            async setColour(slug) {
                if (this.saving || this.colour.slug === slug) return;
                this.saving = true;
                this.error = '';
                try {
                    if (this.series) {
                        await Store.setSeriesColour(db, this.series.id, slug);
                        this.series.colour = slug;
                    } else {
                        this.occurrence.colour = slug;
                        await Store.saveOccurrence(db, Object.assign({}, this.occurrence, {
                            assignments: this.assignments,
                        }));
                    }
                } catch (e) {
                    console.error('Colour change failed:', e);
                    this.error = 'That colour could not be saved.';
                } finally {
                    this.saving = false;
                }
            },

            // ── Taking a Role off ────────────────────────────────────────────
            //
            // Removing a Role deletes every Assignment on it. That is right —
            // people left behind would still count as participants of a Role the
            // Event no longer has, which is also what lets them SEE a restricted
            // Event. But it is a silent deletion behind one small button, so it
            // asks first. Only when there is somebody to lose: an empty Role
            // comes off on the click, because there is nothing to be sure about.

            async askRemoveOneOffRole(id) {
                const on = this.assignments.filter(a => a.oneOffId === id);
                if (!on.length) return this.removeOneOffRole(id);
                const job = ((this.occurrence.oneOffRoles) || []).find(j => j.id === id);
                this.pendingRemoval = this.removalQuestion('oneOff', id, (job && job.label) || 'this job', on);
            },

            // Names them. "Are you sure?" on its own is a question nobody can
            // answer well — you answer it by knowing who you are about to drop.
            removalQuestion(kind, key, name, on) {
                const names = on.map(a => this.personName(a.personId));
                return {
                    kind: kind,
                    key: key,
                    name: name,
                    count: on.length,
                    sentence: View.listSentence(names) +
                        (names.length === 1 ? ' loses their place.' : ' lose their places.'),
                };
            },

            cancelRemoval() { this.pendingRemoval = null; },

            async confirmRemoval() {
                const ask = this.pendingRemoval;
                if (!ask) return;
                this.pendingRemoval = null;
                if (ask.kind === 'seriesRole') await this.removeSeriesRole(ask.key);
                else await this.removeOneOffRole(ask.key);
            },

            // Deliberately cheap: a label, and that is the whole interaction.
            async addOneOffRole() {
                const label = String(this.oneOffDraft || '').trim();
                if (!label) return;
                const jobs = ((this.occurrence.oneOffRoles) || []).slice();
                jobs.push({ id: 'o' + (jobs.length + 1) + '_' + Date.now().toString(36), label: label });
                this.occurrence.oneOffRoles = jobs;
                this.oneOffDraft = '';
                await this.persist();
            },

            async removeOneOffRole(id) {
                this.occurrence.oneOffRoles = ((this.occurrence.oneOffRoles) || []).filter(j => j.id !== id);
                this.assignments = this.assignments.filter(a => a.oneOffId !== id);
                await this.persist();
            },

            async addToOneOff(job, personId) {
                this.assignments = Core.assignToOneOff(
                    this.assignments,
                    { oneOffId: job.id, label: job.label, personId: personId },
                    this.actor()
                );
                await this.persist();
            },

            async removeFromOneOff(jobId, personId) {
                this.assignments = Core.removeFromOneOff(this.assignments, jobId, personId);
                await this.persist();
            },

            // ── The three states ─────────────────────────────────────────────
            //
            // Only an editor ever sets one. Members confirming for themselves is
            // MS-20, and this is the record that will carry it.

            async setState(assignment, state) {
                this.assignments = assignment.oneOffId
                    ? Core.setOneOffState(this.assignments, assignment.oneOffId, assignment.personId, state, this.actor())
                    : Core.setStateAt(this.assignments, assignment.roleSlug, assignment.slotId, state, this.actor());
                await this.persist();
            },

            async clearSlot(roleSlug, slotId) {
                // Removal is instant and total — their sight of a restricted
                // Event goes with it.
                this.assignments = Core.clearSlot(this.assignments, roleSlug, slotId);
                await this.persist();
            },

            // ── The picker ───────────────────────────────────────────────────
            //
            // EVERYONE is listed. Somebody who cannot fill the slot is shown
            // greyed out WITH THE REASON, never silently omitted — the point is
            // that an editor can see who was passed over and why.

            // The list stays hidden until the privacy tags are in.
            //
            // `hidingTags` empty means "no tag hides anybody", which OFFERS
            // everyone — the wrong direction for a rule an elder set precisely
            // so nobody below them sees who is behind it. Rendering the
            // candidates while the read is still in flight would print those
            // names for as long as it took, which is the one failure this list
            // must never have.
            async openPicker(roleSlug, slotId) {
                this.picker = {
                    open: true, roleSlug, slotId,
                    query: '', hideBlocked: false, picked: null,
                    loading: !this.pickerDataLoaded,
                };
                await this.ensurePickerData();
                this.picker.loading = false;
            },

            closePicker() { this.picker.open = false; },

            get pickerRole() {
                return this.roleDefinitions.find(d => d.slug === this.picker.roleSlug) || null;
            },

            get pickerSlot() {
                const def = this.pickerRole;
                if (!def) return null;
                return (def.slots || []).find(s => s.id === this.picker.slotId) || null;
            },

            get pickerTitle() {
                const def = this.pickerRole;
                const def_slots = (def && def.slots) || [];
                const at = def_slots.findIndex(s => s.id === this.picker.slotId);
                if (!def) return '';
                return def.name + ' · place ' + (at + 1) + ' of ' + def_slots.length;
            },

            // Tags whose `people_tags` document says they hide the people
            // carrying them. An elder set those tags precisely so nobody below
            // them sees who is behind one, and a picker is nobody's exception.
            //
            // A refused read leaves the list EMPTY, which offers everyone. That
            // is the wrong direction for a privacy rule, so it is not silent:
            // the page says it could not check, rather than quietly showing
            // people it should not.
            hidingTags: [],

            async loadHidingTags() {
                try {
                    const snap = await db.collection('people_tags').get();
                    this.hidingTags = snap.docs
                        .filter(d => (d.data() || {}).hidePeople === true)
                        .map(d => d.id);
                } catch (e) {
                    console.error('Could not read which tags hide people:', e);
                    this.hidingTags = [];
                    this.error = 'Some people may be missing from the list — the privacy ' +
                        'tags could not be read, so nobody hidden by one is being offered.';
                }
            },

            // Who may be offered AT ALL — which is a different question from who
            // is eligible. Somebody who has left, or whom this viewer may not see,
            // is not a candidate who lost; they are not a candidate. Showing them
            // blocked would answer a question nobody asked, and for a hidden
            // Person it would print the name the tag exists to hide.
            get assignablePeople() {
                return Roles.assignablePeople(this.people, {
                    rank: this.rank,
                    hidingTags: this.hidingTags,
                });
            },

            // Every candidate, eligible or not, each carrying a subtitle: a
            // reason when blocked, a fairness note when not. Same slot either
            // way, which is also where an auto-assign suggestion will sit later.
            get candidates() {
                const def = this.pickerRole;
                const slot = this.pickerSlot;
                if (!def || !slot) return [];

                const seated = this.assignments
                    .filter(a => a.roleSlug === def.slug && !a.oneOffId)
                    .map(a => ({ slotId: a.slotId, personId: a.personId }))
                    // Somebody already down for the liturgy cannot also do this.
                    // They are fed in as though seated in a slot that is not this
                    // one, which is exactly what they are: busy elsewhere on the
                    // same Sunday. The slot id is a name no real slot uses, so it
                    // can never be mistaken for a place in this Role.
                    .concat(this.liturgicalBlocks.map(h => ({
                        slotId: LITURGICAL_SLOT, personId: h.personId,
                    })));

                const judged = Roles.candidatesFor(def, slot, {
                    people: this.assignablePeople,
                    relationships: this.relationships,
                    groups: this.groups,
                    assigned: seated,
                });

                const q = String(this.picker.query || '').trim().toLowerCase();

                return judged
                    .map(c => {
                        const person = this.people.find(p => p.id === c.personId) || {};
                        const otherRoles = this.assignments
                            .filter(a => a.personId === c.personId && a.roleSlug !== def.slug)
                            .map(a => a.label || this.roleName(a.roleSlug))
                            // Named, not just counted. "Already serving here"
                            // alone leaves the editor hunting for where, and
                            // hunting is the thing showing blocked people avoids.
                            .concat(this.liturgicalBlocks
                                .filter(h => h.personId === c.personId)
                                .map(h => this.roleName(h.roleSlug)));
                        return Object.assign({}, c, {
                            name: person.name || 'Someone',
                            subtitle: c.eligible
                                ? View.fairnessNote(c, { groupName: this.groupNameFor(c.personId) })
                                : View.blockReason(c, {
                                    people: this.people,
                                    requirement: slot.requirement,
                                    otherRoles: otherRoles,
                                    groupName: this.groupNameFor(c.personId),
                                }),
                        });
                    })
                    .filter(c => !q || c.name.toLowerCase().indexOf(q) !== -1)
                    // Off by DEFAULT. Seeing who was passed over is the feature.
                    .filter(c => !this.picker.hideBlocked || c.eligible);
            },

            get eligibleCount() { return this.candidates.filter(c => c.eligible).length; },
            get blockedCount() { return this.candidates.filter(c => !c.eligible).length; },

            get pickerConsequence() {
                if (!this.picker.picked) return '';
                const person = this.people.find(p => p.id === this.picker.picked);
                return ((person && person.name) || 'They') +
                    ' will go in as Pending until you hear from them.';
            },

            pick(candidate) {
                // A blocked row does nothing at all. It is there to be read.
                if (!candidate.eligible) return;
                this.picker.picked = candidate.personId;
            },

            async confirmPick() {
                if (!this.picker.picked) return;
                // One write. Assigning a replacement overwrites whatever was in
                // the slot — so a decline clears and the decliner leaves the
                // participant list in the same action.
                this.assignments = Core.assignToSlot(
                    this.assignments,
                    { personId: this.picker.picked, roleSlug: this.picker.roleSlug, slotId: this.picker.slotId },
                    this.actor()
                );
                this.closePicker();
                await this.persist();
            },

            groupNameFor(personId) {
                const g = this.groups.find(group => Roles.inGroup(group, personId));
                return g ? g.name : null;
            },

            roleName(slug) {
                const def = this.roleDefinitions.find(d => d.slug === slug);
                if (def) return def.name;
                const built = Roles.roleBySlug(slug, this.roleDefinitions);
                return (built && built.name) || slug;
            },

            // ── Changing the pattern ─────────────────────────────────────────
            //
            // A question in gold, not an error in red. Nothing is migrated or
            // deleted without the editor's per-date choice.

            async openPattern() {
                if (!this.series) return;
                const rule = Object.assign({}, this.series.recurrence || {});
                // The viewer's OWN rungs, not all five. Asking for a rung this
                // viewer cannot read fails the whole query, and the failure looks
                // exactly like "this series has no dates".
                const snap = await db.collection('event_occurrences')
                    .where('visibility', 'in', Core.visibilityQueryFor(this.rank).rungs)
                    .where('seriesId', '==', this.series.id)
                    .get();
                const stored = await Promise.all(snap.docs.map(async d => {
                    const roster = await d.ref.collection('roster').get();
                    return Object.assign({ id: d.id }, d.data(), { assignments: roster.docs.map(r => r.data()) });
                }));
                this.pattern = { open: true, rule: rule, stored: stored, orphans: [], choices: {} };
            },

            // Recomputed as the editor edits the pattern, so the confrontation
            // is always about the pattern actually being proposed.
            recomputeOrphans() {
                const stored = this.pattern.stored || [];
                if (!stored.length) { this.pattern.orphans = []; return; }
                const dates = stored.map(o => o.date).sort();
                const orphans = Core.orphanedOccurrences(
                    this.pattern.rule, stored, dates[0], dates[dates.length - 1]
                );
                this.pattern.orphans = orphans;
                // Move is the default. Nothing else is pre-decided.
                orphans.forEach(o => {
                    if (!this.pattern.choices[o.date]) this.pattern.choices[o.date] = 'move';
                });
            },

            get patternSentence() { return View.recurrenceSentence(this.pattern.rule || {}); },
            get patternDates() { return View.nextDates(this.pattern.rule || {}, null, 6); },
            get orphanSummary() { return View.orphanSummary(this.pattern.orphans, this.pattern.choices); },
            orphanOutcome(o) { return View.orphanOutcome(o, this.pattern.choices[o.date]); },

            setAllOrphans(choice) {
                this.pattern.orphans.forEach(o => { this.pattern.choices[o.date] = choice; });
            },

            async applyPattern() {
                this.saving = true;
                try {
                    const rule = this.pattern.rule;
                    const stored = this.pattern.stored || [];
                    const dates = stored.map(o => o.date).sort();
                    const free = Core.datesBetween(rule, dates[0] || rule.startDate, dates[dates.length - 1] || rule.startDate)
                        .filter(d => !stored.some(o => o.date === d));

                    await Store.applyOrphanChoices(
                        db, this.series.id, this.pattern.orphans, this.pattern.choices, free
                    );
                    await db.collection('events').doc(this.series.id).update({ recurrence: rule });
                    this.pattern.open = false;
                    await this.load();
                } catch (e) {
                    console.error('Pattern change failed:', e);
                    this.error = 'The pattern could not be changed.';
                } finally {
                    this.saving = false;
                }
            },

            // ── Visibility ───────────────────────────────────────────────────

            get visibilityLadder() { return View.visibilityLadder(); },
            get visibility() { return Core.visibilityOf(this.occurrence); },
            get visibilityEditable() { return Core.isVisibilityEditable(this.occurrence) && this.isEditor; },
            rosterToggleApplies(level) { return View.rosterToggleApplies(level); },

            async setVisibility(level) {
                if (!this.visibilityEditable) return;
                this.saving = true;
                try {
                    if (this.series) {
                        // Restamps EVERY occurrence, past ones included —
                        // otherwise making something private leaves its history
                        // public.
                        await Store.restampSeriesVisibility(
                            db, this.series.id, level, this.occurrence.rosterShared === true
                        );
                    } else {
                        // A one-off has no series to restamp. This control used
                        // to return early here and do NOTHING — it rendered, it
                        // took the click, and the Event stayed exactly as visible
                        // as it had been.
                        await Store.saveOccurrenceDetails(db, this.occurrence.id, {
                            visibility: level,
                            rosterShared: this.occurrence.rosterShared === true,
                        });
                    }
                    this.occurrence.visibility = level;
                } catch (e) {
                    console.error('Visibility change failed:', e);
                    this.error = e.message || 'The visibility could not be changed.';
                } finally {
                    this.saving = false;
                }
            },

            async setRosterShared(shared) {
                if (!this.visibilityEditable) return;
                if (this.series) {
                    await Store.restampSeriesVisibility(db, this.series.id, this.visibility, shared);
                } else {
                    await Store.saveOccurrenceDetails(db, this.occurrence.id, {
                        visibility: this.visibility, rosterShared: shared === true,
                    });
                }
                this.occurrence.rosterShared = shared;
            },

            // ── Editing a one-off Event ──────────────────────────────────────
            //
            // A one-off has no series, so everything true of it is true of this
            // one occurrence — including its date, which can simply be changed,
            // because a one-off's id is an auto-id rather than the date. (One
            // date OF A SERIES is a different operation: see "Move this one".)
            //
            // It was creatable and then frozen. Wrong time, wrong hall, wrong
            // name, and no way back to any of it.

            occurrenceDraft: { name: '', date: '', time: '', location: '', description: '' },

            get isOneOff() { return !!this.occurrence && !this.occurrence.seriesId; },

            startOccurrenceDraft() {
                const o = this.occurrence || {};
                this.occurrenceDraft = {
                    name: o.name || '',
                    date: o.date || '',
                    time: o.time || '',
                    location: o.location || '',
                    description: o.description || '',
                };
            },

            get occurrenceDetailsChanged() {
                const o = this.occurrence || {};
                return ['name', 'date', 'time', 'location', 'description'].some(
                    f => String(this.occurrenceDraft[f] || '') !== String(o[f] || '')
                );
            },

            get occurrenceDetailsValid() {
                return !!String(this.occurrenceDraft.name || '').trim()
                    && !!this.occurrenceDraft.date;
            },

            async saveOccurrenceDetails() {
                if (!this.occurrenceDetailsValid || !this.occurrenceDetailsChanged || this.saving) return;
                this.saving = true;
                this.error = '';
                try {
                    const saved = await Store.saveOccurrenceDetails(
                        db, this.occurrence.id, this.occurrenceDraft
                    );
                    Object.keys(saved).forEach(f => { this.occurrence[f] = saved[f]; });
                    this.startOccurrenceDraft();
                } catch (e) {
                    console.error('Event details failed:', e);
                    this.error = (e && e.message) || 'Those details could not be saved.';
                } finally {
                    this.saving = false;
                }
            },

            // ── "Did they serve?" ────────────────────────────────────────────
            //
            // Scaffolding — it disappears once members can confirm for
            // themselves — so it is one row, and nothing when there is nothing
            // to ask.

            get unconfirmedPrompt() {
                if (!this.isPast || !this.isEditor) return null;
                return View.unconfirmedPrompt({ assignments: this.assignments });
            },

            get openQuestions() {
                return Core.conversion({ assignments: this.assignments }).questions
                    .map(q => Object.assign({}, q, { name: this.personName(q.personId) }));
            },

            openTidyUp() {
                this.tidyUp = { open: true, ticks: {} };
            },

            get tidyUpSummary() { return View.serveTickSummary(this.openQuestions, this.tidyUp.ticks); },

            tickAll(on) {
                const ticks = {};
                if (on) this.openQuestions.forEach(q => { ticks[q.personId] = true; });
                this.tidyUp.ticks = ticks;
            },

            // Ticking writes the serve record. Whatever is left stays
            // unanswered, permanently, and never counts.
            async saveTidyUp() {
                this.saving = true;
                try {
                    const batch = db.batch();
                    let wrote = 0;
                    this.openQuestions.forEach(q => {
                        if (!this.tidyUp.ticks[q.personId]) return;
                        const record = Core.serveRecordFor(this.occurrence, q.assignment);
                        // The same deterministic id the scheduled job uses, so
                        // answering twice writes one record rather than two.
                        batch.set(
                            db.collection('people').doc(record.personId)
                                .collection('involvement').doc(record.involvementId),
                            {
                                serviceDate: record.serviceDate,
                                type: record.type,
                                seriesId: record.seriesId,
                                metadata: record.metadata || null,
                                resolvedBy: this.uid,
                            },
                            { merge: true }
                        );
                        wrote++;
                    });
                    if (wrote) await batch.commit();
                    this.tidyUp.open = false;
                } catch (e) {
                    console.error('Resolving failed:', e);
                    this.error = 'Those answers could not be saved.';
                } finally {
                    this.saving = false;
                }
            },

            // ── Display passthroughs ─────────────────────────────────────────

            initials(name) { return View.initials(name); },
            formatTime(t) { return View.formatTime(t); },
            stateLabel(a) { return Core.stateLabel(a); },
            stateTone(a) { return Core.stateTone(a); },
            visibilityLabel(l) { return View.visibilityLabel(l); },
            visibilityIcon(l) { return View.visibilityIcon(l); },
            visibilityWho(l) { return View.visibilityWho(l); },
            recurrenceSentence(r) { return View.recurrenceSentence(r); },

            personName(personId) {
                const p = this.people.find(x => x.id === personId);
                return (p && p.name) || 'Someone';
            },

            longDate(dateStr) {
                return dateStr ? window.DateUtils.formatDateLong(dateStr, 'en-GB') : '';
            },

            // Straight to the Order of Service editor for this exact date — the
            // Sunday's own surface, and the one that keeps the printed booklet
            // safe by staying separate from the Event model.
            get servicesHref() {
                return 'service-builder.html?date=' +
                    encodeURIComponent(this.occurrence ? this.occurrence.date : '');
            },
        };
    };
})();
