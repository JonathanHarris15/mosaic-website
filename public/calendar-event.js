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

    const params = new URLSearchParams(window.location.search);

    window.eventDetailPage = function eventDetailPage() {
        return {
            loading: true,
            error: '',
            saving: false,

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
            picker: { open: false, roleSlug: null, slotId: null, query: '', hideBlocked: false, picked: null },
            pattern: { open: false, rule: null, orphans: [], choices: {} },
            tidyUp: { open: false, ticks: {} },
            oneOffDraft: '',

            // ── Loading ──────────────────────────────────────────────────────

            async init() {
                await this.resolveViewer();
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
                    const id = params.get('id');

                    // No id means this is a new Event, not a broken link.
                    if (!id) {
                        if (!this.isEditor) {
                            this.error = 'Only an editor can create an event.';
                            return;
                        }
                        this.creating = true;
                        this.draft.date = window.DateUtils.todayStr();
                        return;
                    }

                    const loaded = await Store.loadOccurrence(db, id);
                    if (!loaded) { this.error = 'That event could not be found.'; return; }

                    this.occurrence = loaded;
                    this.assignments = loaded.assignments || [];

                    if (loaded.seriesId) {
                        const s = await db.collection('events').doc(loaded.seriesId).get();
                        if (s.exists) this.series = Object.assign({ id: s.id }, s.data());
                    }

                    if (this.isEditor) await this.loadEditorData();
                    else await this.loadPeople();
                } catch (e) {
                    console.error('Event load failed:', e);
                    this.error = (e && e.code === 'permission-denied')
                        ? 'You are not able to see this event.'
                        : 'That event could not be loaded just now.';
                } finally {
                    this.loading = false;
                }
            },

            async loadPeople() {
                const snap = await db.collection('people').get();
                this.people = snap.docs
                    .map(d => Object.assign({ id: d.id }, d.data()))
                    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
            },

            async loadEditorData() {
                await this.loadPeople();
                const [roles, rels, groups] = await Promise.all([
                    db.collection('roles').get(),
                    // Serving rules may only name a Relationship Type an elder has
                    // shared with editors, so the query is constrained the same way
                    // the Roles Manager constrains it. Unconstrained it would error.
                    db.collection('relationships').where('sharedWithEditors', '==', true).get().catch(() => ({ docs: [] })),
                    db.collection('relationship_groups').where('sharedWithEditors', '==', true).get().catch(() => ({ docs: [] })),
                ]);
                this.roleDefinitions = roles.docs.map(d => Object.assign({ id: d.id }, d.data()));
                this.relationships = rels.docs.map(d => d.data());
                this.groups = groups.docs.map(d => Object.assign({ id: d.id }, d.data()));
            },

            // ── Who is looking ───────────────────────────────────────────────

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

            get managedRoles() {
                return ((this.occurrence && this.occurrence.occurrenceRoleSlugs) || [])
                    .map(slug => this.roleDefinitions.find(d => d.slug === slug))
                    .filter(Boolean)
                    .map(def => ({
                        def: def,
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

            // Roles from the Roles Manager not yet on this Event. Liturgical
            // Roles are NOT offered — they stay wired to the Service exactly as
            // they are today, which is what keeps the printed booklet safe.
            get availableRoles() {
                const on = (this.occurrence && this.occurrence.occurrenceRoleSlugs) || [];
                return this.roleDefinitions
                    .filter(d => Roles.LITURGICAL_SLUGS.indexOf(d.slug) === -1)
                    .map(d => Object.assign({}, d, { alreadyOn: on.indexOf(d.slug) !== -1 }));
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

            async addManagedRole(def) {
                const slugs = ((this.occurrence.occurrenceRoleSlugs) || []).slice();
                if (slugs.indexOf(def.slug) !== -1) return;
                slugs.push(def.slug);
                this.occurrence.occurrenceRoleSlugs = slugs;
                await this.persist();
            },

            async removeManagedRole(slug) {
                this.occurrence.occurrenceRoleSlugs = ((this.occurrence.occurrenceRoleSlugs) || []).filter(s => s !== slug);
                // Its assignments go with it — leaving them behind would keep
                // people as participants of a Role the Event no longer has.
                this.assignments = this.assignments.filter(a => a.roleSlug !== slug);
                await this.persist();
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

            openPicker(roleSlug, slotId) {
                this.picker = { open: true, roleSlug, slotId, query: '', hideBlocked: false, picked: null };
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

            // Every candidate, eligible or not, each carrying a subtitle: a
            // reason when blocked, a fairness note when not. Same slot either
            // way, which is also where an auto-assign suggestion will sit later.
            get candidates() {
                const def = this.pickerRole;
                const slot = this.pickerSlot;
                if (!def || !slot) return [];

                const seated = this.assignments
                    .filter(a => a.roleSlug === def.slug && !a.oneOffId)
                    .map(a => ({ slotId: a.slotId, personId: a.personId }));

                const judged = Roles.candidatesFor(def, slot, {
                    people: this.people,
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
                            .map(a => a.label || this.roleName(a.roleSlug));
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
                if (!this.visibilityEditable || !this.series) return;
                this.saving = true;
                try {
                    // Restamps EVERY occurrence, past ones included — otherwise
                    // making something private leaves its history public.
                    await Store.restampSeriesVisibility(
                        db, this.series.id, level, this.occurrence.rosterShared === true
                    );
                    this.occurrence.visibility = level;
                } catch (e) {
                    console.error('Visibility change failed:', e);
                    this.error = e.message || 'The visibility could not be changed.';
                } finally {
                    this.saving = false;
                }
            },

            async setRosterShared(shared) {
                if (!this.visibilityEditable || !this.series) return;
                await Store.restampSeriesVisibility(db, this.series.id, this.visibility, shared);
                this.occurrence.rosterShared = shared;
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

            get servicesHref() {
                return 'service-calendar.html#' + (this.occurrence ? this.occurrence.date : '');
            },
        };
    };
})();
