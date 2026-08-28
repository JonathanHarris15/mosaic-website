function kioskPage() {
    const Store = window.EventsStore;
    const Kiosk = window.KioskCore;
    const Household = window.HouseholdCore;
    const HouseStore = window.HouseholdStore;
    const Nametag = window.NametagCore;

    return {
        loading: true,
        error: '',
        view: 'events',
        occurrences: [],
        seriesById: {},
        query: '',
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
        draft: { name: '', people: [] },

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
        // A Household already called this. Almost always the same household
        // being typed a second time, so it is offered rather than forbidden.
        get twinHousehold() {
            if (this.draftTarget) return null;
            return Household.duplicateOf(this.households, this.draft.name, null);
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
            const [peopleSnap, familiesSnap, stored] = await Promise.all([
                db.collection('people').get(),
                db.collection('families').get(),
                HouseStore.loadHouseholds(db),
            ]);
            const people = peopleSnap.docs.map(d => Object.assign({ id: d.id }, d.data()));
            const families = familiesSnap.docs.map(d => Object.assign({ id: d.id }, d.data()));
            this.households = Household.householdsFromDirectory(people, families, stored);
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
            return 'Events';
        },
        goBack() {
            if (this.view === 'present') { this.toSearch(); return; }
            if (this.view === 'create') { this.cancelDraft(); return; }
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
            const seed = this.query.trim();
            this.draftTarget = null;
            this.draft = {
                name: Household.suggestedHouseholdName([], seed),
                people: [Object.assign(Household.emptyCreatePerson(), { name: seed })],
            };
            this.error = '';
            this.view = 'create';
        },
        startAddPeople() {
            if (!this.selected) return;
            this.draftTarget = this.selected;
            this.draft = { name: this.selected.name, people: [Household.emptyCreatePerson()] };
            this.error = '';
            this.view = 'create';
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
            this.draft.people.push(Household.emptyCreatePerson());
        },
        removeDraftPerson(i) {
            this.draft.people.splice(i, 1);
            if (!this.draft.people.length) this.draft.people.push(Household.emptyCreatePerson());
        },
        openTwin() {
            const twin = this.twinHousehold;
            if (!twin) return;
            this.draftTarget = null;
            this.openHousehold(twin);
        },
        async submitDraft() {
            const fault = Household.createFault(this.draft.people);
            if (fault) { this.error = fault; return; }
            this.saving = true;
            this.error = '';
            const target = this.draftTarget;
            try {
                const saved = target
                    ? await HouseStore.addPeopleToHousehold(db, target, this.draft)
                    : await HouseStore.createHousehold(db, this.draft);
                this.draftTarget = null;
                await this.reloadHouseholds();
                const fresh = this.households.find(h => h.id === saved.id) || saved;
                this.openHousehold(fresh);
            } catch (e) {
                console.error(e);
                this.error = target
                    ? 'Could not add them to that household.'
                    : 'Could not create that household.';
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
            const household = this.selected;
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
                // A Household somebody has actually used is a fact, not a guess,
                // so the projection is written down (ADR-0044). This runs after
                // the attendance write and can never undo it.
                await this.mintIfProjected(household);
                this.toSearch();
            } catch (e) {
                console.error(e);
                this.error = 'Could not mark them present.';
            }
            this.marking = false;
        },

        async mintIfProjected(household) {
            if (!household || household.stored) return;
            try {
                await HouseStore.mintHousehold(db, household);
                await this.reloadHouseholds();
            } catch (e) {
                console.error('Could not mint the household', e);
            }
        },

        // Hand the labels to the browser's own print dialog. It stays open until
        // somebody answers it — the page does not wait, and does not pretend to
        // know whether a label came out (ADR-0042, MS-317).
        printNow() {
            if (!this.lastLabels.length) return;
            this.printing = true;
            Nametag.printLabels(this.lastLabels, document, () => {
                this.printing = false;
                this.printNote = 'If a tag did not come out, print again. Attendance is already saved.';
            });
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
