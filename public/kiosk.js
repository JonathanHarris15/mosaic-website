// Where the greeter's choice of print route is remembered, so a kiosk that
// gets reloaded mid-morning does not lose it. See togglePlainPrint().
const PLAIN_PRINT_KEY = 'mosaic.kiosk.plainPrint';

function kioskPage() {
    const Store = window.EventsStore;
    const Kiosk = window.KioskCore;
    const Household = window.HouseholdCore;
    const HouseStore = window.HouseholdStore;
    const Nametag = window.NametagCore;
    const PersonName = window.PersonName;

    return {
        loading: true,
        error: '',
        view: 'events',
        occurrences: [],
        seriesById: {},
        query: '',
        // The directory as read, kept so the edit view can hand the Household
        // editor the same records the groups were projected from.
        people: [],
        families: [],
        households: [],
        matches: [],
        selected: null,
        checked: {},
        // Who this Event has already seen, by Person id (MS-321). Attendance is
        // the record; this is the copy the screen reads, so a returning greeter
        // is told rather than made to remember.
        attendance: {},
        event: null,
        marking: false,
        printing: false,
        printNote: '',
        // What the last mark printed, kept alive on the search screen so a
        // jammed label can be sent again without hunting the household down.
        lastLabels: [],
        saving: false,
        // The person form is one form with two jobs: a brand-new Household, or
        // more people for one that already exists. draftTarget says which.
        draftTarget: null,
        draft: { people: [] },
        // The edit view (MS-709): the names of the people in `selected`, as
        // blanks, and the Person the view follows when the record under it is
        // rewritten or emptied.
        editNames: [],
        editAnchor: null,
        editNote: '',

        get eventTitle() {
            return this.event ? this.titleOf(this.event) : '';
        },
        get checkedCount() {
            return Object.keys(this.checked).filter(id => this.checked[id]).length;
        },
        get footerLabel() {
            return Kiosk.presentCountLabel(this.checkedCount);
        },
        get needsNameTags() {
            if (!this.event) return false;
            if (this.event.needsNameTags) return true;
            const series = this.seriesById[this.event.seriesId];
            return !!(series && series.needsNameTags);
        },
        get addingToHousehold() {
            return !!this.draftTarget;
        },
        get draftTitle() {
            return this.draftTarget ? ('Add to ' + this.draftTarget.name) : 'Create household';
        },
        // Not typed: a Household is named for its people, the way every other
        // screen names it.
        get draftHouseholdName() {
            if (this.draftTarget) return this.draftTarget.name;
            return Household.householdNameFromMembers(this.draft.people);
        },
        // A Household already called this. Almost always the same household
        // being typed a second time, so it is offered rather than forbidden.
        get twinHousehold() {
            if (this.draftTarget) return null;
            if (!this.draft.people.some(p => PersonName.lastNameOf(p))) return null;
            return Household.duplicateOf(this.households, this.draftHouseholdName, null);
        },
        // Somebody in this Household is already called that.
        get repeatedNames() {
            if (!this.draftTarget) return [];
            return Household.repeatedNames(this.draftTarget, this.draft.people);
        },
        get everyoneHere() {
            const members = (this.selected && this.selected.members) || [];
            return members.length > 0 && !Kiosk.arrivals(members, this.attendance).length;
        },

        async init() {
            this.loadPrintPreference();
            auth.onAuthStateChanged(async user => {
                if (!user || user.isAnonymous) {
                    window.location.href = 'login.html';
                    return;
                }
                try {
                    const data = await getUserData(user.uid);
                    if (!Kiosk.isKioskAccount(data)) {
                        window.location.href = 'index.html';
                        return;
                    }
                    await this.load();
                } catch (e) {
                    console.error(e);
                    this.error = 'Could not load events.';
                    this.loading = false;
                }
            });
        },

        async load() {
            const today = window.DateUtils.todayStr();
            const [rows, series] = await Promise.all([
                Store.loadKioskOccurrences(db),
                Store.loadKioskSeries(db),
            ]);
            this.seriesById = {};
            (series || []).forEach(s => { this.seriesById[s.id] = s; });
            this.occurrences = Kiosk.sortOccurrencesForKiosk(rows, today);
            await this.reloadHouseholds();
            this.loading = false;
        },

        async reloadHouseholds() {
            const [peopleSnap, familiesSnap] = await Promise.all([
                db.collection('people').get(),
                db.collection('families').get(),
            ]);
            this.people = peopleSnap.docs.map(d => Object.assign({ id: d.id }, d.data()));
            this.families = familiesSnap.docs.map(d => Object.assign({ id: d.id }, d.data()));
            this.households = Household.householdsFromDirectory(this.people, this.families);
        },

        async reloadAttendance() {
            if (!this.event) { this.attendance = {}; return; }
            const rows = await Store.loadAttendance(db, this.event.id);
            this.attendance = Kiosk.attendanceIndex(rows);
        },

        titleOf(o) {
            if (!o) return '';
            if (o.name) return o.name;
            const series = this.seriesById[o.seriesId];
            return (series && series.name) || 'Event';
        },
        dateOf(o) {
            if (!o || !o.date) return '';
            return window.DateUtils.formatDateLong(o.date);
        },
        memberNames(h) {
            return (h.members || []).map(m => m.name).filter(Boolean).join(', ');
        },
        isPresent(personId) {
            return Kiosk.isPresent(this.attendance, personId);
        },
        // How many of a Household are already in the room — the line a search
        // result carries, so a greeter knows before they open it.
        presentCount(h) {
            const members = (h && h.members) || [];
            return members.length - Kiosk.arrivals(members, this.attendance).length;
        },

        async startAttendance(o) {
            this.event = o;
            this.lastLabels = [];
            this.toSearch();
            try {
                await this.reloadAttendance();
            } catch (e) {
                console.error(e);
                this.error = 'Could not read who is already here.';
            }
        },
        // The bare screen a greeter comes back to between households.
        toSearch() {
            this.query = '';
            this.matches = [];
            this.selected = null;
            this.checked = {};
            this.printNote = '';
            this.error = '';
            this.view = 'search';
        },
        // Back is one control in one corner, so it has to know what it means
        // on each screen rather than each screen carrying its own button.
        get backLabel() {
            if (this.view === 'present') return 'Search';
            if (this.view === 'create') return this.addingToHousehold ? 'Household' : 'Search';
            if (this.view === 'edit') return 'Household';
            return 'Events';
        },
        goBack() {
            if (this.view === 'present') { this.toSearch(); return; }
            if (this.view === 'create') { this.cancelDraft(); return; }
            if (this.view === 'edit') { this.openHousehold(this.selected); return; }
            this.query = '';
            this.matches = [];
            this.view = 'events';
        },
        runSearch() {
            this.matches = Household.searchHouseholds(this.households, this.query);
        },
        openHousehold(h) {
            this.selected = h;
            this.checked = {};
            this.printNote = '';
            this.error = '';
            this.view = 'present';
        },
        toggle(personId) {
            // Already here. A second tick would be a second tag.
            if (this.isPresent(personId)) return;
            this.checked[personId] = !this.checked[personId];
        },
        // Everybody in this household who is not already here. A family of
        // seven arriving together is the normal case at a foyer desk, and
        // seven taps is six too many.
        arrivalsHere() {
            const members = (this.selected && this.selected.members) || [];
            return Kiosk.arrivals(members, this.attendance);
        },
        get allChecked() {
            const arrivals = this.arrivalsHere();
            return arrivals.length > 0 && arrivals.every(m => this.checked[m.personId]);
        },
        toggleAll() {
            const on = !this.allChecked;
            this.arrivalsHere().forEach(m => { this.checked[m.personId] = on; });
        },
        // ── The person form ──────────────────────────────────────────────────
        startCreate() {
            // A search that found nobody is a first name, not a last name.
            // The household name follows once a last name is typed.
            const seed = this.query.trim();
            this.draftTarget = null;
            this.draft = { people: [Object.assign(Household.emptyCreatePerson(), { firstName: seed })] };
            this.error = '';
            this.view = 'create';
        },
        startAddPeople() {
            if (!this.selected) return;
            this.draftTarget = this.selected;
            this.draft = { people: [this.newDraftPerson()] };
            this.error = '';
            this.view = 'create';
        },
        // Somebody joining a Household that already has its parents is most
        // likely a child of it; somebody joining a Person on their own, a spouse.
        newDraftPerson() {
            const p = Household.emptyCreatePerson();
            if (this.draftTarget && this.draftTarget.familyId) p.role = 'child';
            return p;
        },
        kidChanged(p) {
            if (p.kid) p.role = 'child';
        },
        cancelDraft() {
            if (this.draftTarget) {
                const back = this.draftTarget;
                this.draftTarget = null;
                this.openHousehold(back);
                return;
            }
            this.view = 'search';
        },
        addDraftPerson() {
            this.draft.people.push(this.newDraftPerson());
        },
        removeDraftPerson(i) {
            this.draft.people.splice(i, 1);
            if (!this.draft.people.length) this.draft.people.push(this.newDraftPerson());
        },
        openTwin() {
            const twin = this.twinHousehold;
            if (!twin) return;
            this.draftTarget = null;
            this.openHousehold(twin);
        },
        async submitDraft() {
            const target = this.draftTarget;
            const fault = Household.createFault(this.draft.people)
                || Household.draftRecordFault(target, this.draft.people, this.families);
            if (fault) { this.error = fault; return; }
            this.saving = true;
            this.error = '';
            try {
                const saved = await HouseStore.saveDraft(db, target, this.draft, this.families);
                this.draftTarget = null;
                await this.reloadHouseholds();
                const fresh = this.households.find(h => h.id === saved.id);
                if (fresh) this.openHousehold(fresh); else this.toSearch();
            } catch (e) {
                console.error(e);
                // A Firestore failure carries a code; anything else is the
                // planner refusing, and says why in words.
                this.error = e && !e.code && e.message ? e.message : (target
                    ? 'Could not add them to that household.'
                    : 'Could not create that household.');
            }
            this.saving = false;
        },

        checkedMembers() {
            if (!this.selected) return [];
            return (this.selected.members || []).filter(m => this.checked[m.personId]);
        },

        // ── Marking present ──────────────────────────────────────────────────
        // Attendance is written first; printing is the fallible second step
        // (ADR-0042). Only ARRIVALS are written and only arrivals get a tag, so
        // reopening a household to catch a latecomer no longer reprints the
        // whole family. Then the screen goes back to the bare search, ready for
        // whoever is next through the door.
        async submitPresent() {
            const members = Kiosk.arrivals(this.checkedMembers(), this.attendance);
            if (!members.length || !this.event) return;
            this.marking = true;
            this.error = '';
            this.printNote = '';
            try {
                const ids = members.map(m => m.personId);
                const extras = {};
                let labels = [];
                if (this.needsNameTags) {
                    const existing = await Store.loadAttendance(db, this.event.id);
                    const pickup = Nametag.assignPickupCodes(members, existing.map(function (row) {
                        return { personId: row.personId, pickupCode: row.pickupCode };
                    }));
                    Object.keys(pickup).forEach(function (id) {
                        extras[id] = { pickupCode: pickup[id] };
                    });
                    labels = Nametag.labelsFor(members, {
                        eventName: this.titleOf(this.event),
                        date: this.dateOf(this.event),
                    }, pickup);
                }
                await Store.markPresent(db, this.event.id, ids, new Date().toISOString(), extras);
                await this.reloadAttendance();
                this.lastLabels = labels;
                if (labels.length) this.printNow();
                this.toSearch();
            } catch (e) {
                console.error(e);
                this.error = 'Could not mark them present.';
            }
            this.marking = false;
        },

        // ── Editing a Household (MS-709) ─────────────────────────────────────
        // A full edit at the desk: fix anybody's name, and add or take people
        // out with the same Household card the directory uses. Adding someone
        // brand new stays on "Add someone".
        startEdit() {
            if (!this.selected) return;
            this.editAnchor = (this.selected.members[0] || {}).personId || null;
            this.editNames = [];
            this.syncEditNames();
            this.editNote = '';
            this.error = '';
            this.view = 'edit';
        },
        personById(id) {
            return this.people.find(p => p.id === id) || null;
        },
        // One row of blanks per person in the Household, keeping whatever was
        // already typed. Somebody taken out during this edit keeps their row,
        // marked `away`, so a wrong × can be put back from the card.
        syncEditNames() {
            const typed = {};
            this.editNames.forEach(n => { typed[n.personId] = n; });
            const members = ((this.selected && this.selected.members) || []).map(m => m.personId);
            const here = members.map(id =>
                Object.assign(typed[id] || Object.assign({ personId: id }, PersonName.blanksFor(this.personById(id))), { away: false }));
            const away = this.editNames.filter(n => members.indexOf(n.personId) === -1)
                .map(n => Object.assign(n, { away: true }));
            this.editNames = here.concat(away);
        },
        // The record under the view was just written. Find the Household again
        // by that record, else by the Person the view started from.
        refollow(familyId) {
            this.households = Household.householdsFromDirectory(this.people, this.families);
            const next = (familyId && this.households.find(h => h.familyId === familyId))
                || this.households.find(h => h.members.some(m => m.personId === this.editAnchor))
                || null;
            if (next) {
                this.selected = next;
                if (!next.members.some(m => m.personId === this.editAnchor)) this.editAnchor = next.members[0].personId;
            }
            this.syncEditNames();
        },
        renderHouseholdCard(el) {
            const h = this.selected;
            if (!el || !h || this.view !== 'edit') return;
            HouseholdEditor.render(el, {
                db,
                families: this.families,
                people: this.people,
                familyId: h.familyId || null,
                personId: h.familyId ? null : h.personId,
                canEdit: true,
                headingLevel: 3,
                // A shared foyer screen searches the list above, never the directory.
                pickFrom: this.editNames.map(n => n.personId),
                onChange: (next, info) => {
                    this.families = next;
                    this.refollow(info.familyId);
                },
            });
        },
        async finishEdit() {
            this.saving = true;
            this.error = '';
            try {
                const edits = this.editNames.map(n => ({ person: this.personById(n.personId), entry: n }))
                    .filter(e => e.person);
                const changed = await HouseStore.renamePeople(db, edits);
                if (changed) {
                    await this.reloadHouseholds();
                    this.refollow(this.selected && this.selected.familyId);
                }
                this.openHousehold(this.selected);
            } catch (e) {
                console.error(e);
                this.error = e && !e.code && e.message ? e.message : 'Could not save those names.';
            }
            this.saving = false;
        },

        // Hand the labels to the browser's own print dialog. It stays open until
        // somebody answers it — the page does not wait, and does not pretend to
        // know whether a label came out (ADR-0042, MS-317).
        //
        // Two ways to do it, and the switch between them is the greeter's, not
        // ours — see `plainPrint`.
        printNow() {
            if (!this.lastLabels.length) return;
            this.printing = true;

            if (this.plainPrint) {
                Nametag.openPrintWindow(this.lastLabels, window, opened => {
                    this.printing = false;
                    this.printNote = opened
                        ? 'The labels are in a new tab. If the dialog did not open, press Ctrl+P there. Attendance is already saved.'
                        : 'The browser blocked the new tab. Allow pop-ups for this site, or turn the switch off. Attendance is already saved.';
                });
                return;
            }

            Nametag.printLabels(this.lastLabels, document, () => {
                this.printing = false;
                this.printNote = 'If a tag did not come out, print again. Attendance is already saved.';
            });
        },

        // ── The escape hatch (MS-317 follow-up) ──────────────────────────────
        //
        // ⚠ NOTHING HERE EVER SKIPPED THE PRINT DIALOG, and the switch is
        // labelled as though it did. That is deliberate. The person who reaches
        // for it is a greeter with a queue at the door who has pressed print and
        // seen nothing happen, and "don't skip print dialog" is what they will
        // be looking for. Being right about our internals is worth less this
        // morning than being findable.
        //
        // What it actually does: stop using the hidden frame, and put the labels
        // in a window that can be seen. If even that window's dialog is refused,
        // the labels are still sitting in it and Ctrl+P prints them — which is
        // the one thing we know works on that machine.
        //
        // ⚠ IT IS REMEMBERED ON THE MACHINE, not in the session. A kiosk gets
        // reloaded, and a greeter who found this once must not have to find it
        // again mid-morning. localStorage can throw outright in a locked-down
        // browser, so every touch of it is wrapped: a switch that cannot be
        // remembered is still a switch that works today.
        plainPrint: false,

        loadPrintPreference() {
            try {
                this.plainPrint = localStorage.getItem(PLAIN_PRINT_KEY) === 'yes';
            } catch (e) {
                this.plainPrint = false;
            }
        },

        togglePlainPrint() {
            this.plainPrint = !this.plainPrint;
            this.printNote = '';
            try {
                localStorage.setItem(PLAIN_PRINT_KEY, this.plainPrint ? 'yes' : 'no');
            } catch (e) {
                console.warn('Could not remember the print setting', e);
            }
        },

        // Taken off the list entirely (MS-321). A wrong tap is not a fact about
        // the morning, so it is deleted rather than corrected — and their tag is
        // already printed, which nothing here can undo. The row goes back to
        // being tickable, so the greeter can put the right person in.
        async unmark(member) {
            if (!member || !this.event) return;
            this.error = '';
            try {
                await Store.unmarkPresent(db, this.event.id, [member.personId]);
                await this.reloadAttendance();
                this.checked[member.personId] = false;
            } catch (e) {
                console.error(e);
                this.error = 'Could not take them back off the list.';
            }
        },

        // ── Reprint (MS-321) ─────────────────────────────────────────────────
        // One person, on purpose. A Kid gets both labels again — their tag and
        // the guardian stub — carrying the pickup number they were given the
        // first time, because a stub that does not match the tag is worse than
        // no stub at all. Attendance is untouched; only a missing code is
        // written back, and it keeps the original markedAt.
        async reprint(member) {
            if (!member || !this.event) return;
            this.error = '';
            try {
                let codes = Kiosk.pickupCodesFrom(this.attendance, [member]);
                if (member.kid && !codes[member.personId]) {
                    const taken = Object.keys(this.attendance).map(id => ({
                        personId: id, pickupCode: this.attendance[id].pickupCode,
                    }));
                    codes = Nametag.assignPickupCodes([member], taken);
                    const row = this.attendance[member.personId] || {};
                    const extras = {};
                    extras[member.personId] = { pickupCode: codes[member.personId] };
                    await Store.markPresent(db, this.event.id, [member.personId],
                        row.markedAt || new Date().toISOString(), extras);
                    await this.reloadAttendance();
                }
                this.lastLabels = Nametag.labelsFor([member], {
                    eventName: this.titleOf(this.event),
                    date: this.dateOf(this.event),
                }, codes);
                this.printNow();
            } catch (e) {
                console.error(e);
                this.error = 'Could not reprint that tag.';
            }
        },
    };
}
