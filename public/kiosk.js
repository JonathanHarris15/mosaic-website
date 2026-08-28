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
        event: null,
        marking: false,
        marked: false,
        printing: false,
        printNote: '',
        lastLabels: [],
        creating: false,
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

        startAttendance(o) {
            this.event = o;
            this.query = '';
            this.matches = [];
            this.selected = null;
            this.checked = {};
            this.marked = false;
            this.printNote = '';
            this.lastLabels = [];
            this.view = 'search';
        },
        runSearch() {
            this.matches = Household.searchHouseholds(this.households, this.query);
        },
        openHousehold(h) {
            this.selected = h;
            this.checked = {};
            this.marked = false;
            this.printNote = '';
            this.lastLabels = [];
            this.view = 'present';
        },
        toggle(personId) {
            this.checked[personId] = !this.checked[personId];
        },

        startCreate() {
            const seed = this.query.trim();
            this.draft = {
                name: Household.suggestedHouseholdName([], seed),
                people: [Object.assign(Household.emptyCreatePerson(), { name: seed })],
            };
            this.view = 'create';
        },
        addDraftPerson() {
            this.draft.people.push(Household.emptyCreatePerson());
        },
        removeDraftPerson(i) {
            this.draft.people.splice(i, 1);
            if (!this.draft.people.length) this.draft.people.push(Household.emptyCreatePerson());
        },
        async submitCreate() {
            const fault = Household.createFault(this.draft.people);
            if (fault) { this.error = fault; return; }
            this.creating = true;
            this.error = '';
            try {
                const created = await HouseStore.createHousehold(db, this.draft);
                await this.reloadHouseholds();
                const fresh = this.households.find(h => h.id === created.id) || created;
                this.openHousehold(fresh);
            } catch (e) {
                console.error(e);
                this.error = 'Could not create that household.';
            }
            this.creating = false;
        },

        checkedMembers() {
            if (!this.selected) return [];
            return (this.selected.members || []).filter(m => this.checked[m.personId]);
        },

        async submitPresent() {
            const members = this.checkedMembers();
            if (!members.length || !this.event) return;
            this.marking = true;
            this.error = '';
            this.printNote = '';
            try {
                const ids = members.map(m => m.personId);
                const extras = {};
                if (this.needsNameTags) {
                    const existing = await Store.loadAttendance(db, this.event.id);
                    const pickup = Nametag.assignPickupCodes(members, existing.map(function (row) {
                        return { personId: row.personId, pickupCode: row.pickupCode };
                    }));
                    Object.keys(pickup).forEach(function (id) {
                        extras[id] = { pickupCode: pickup[id] };
                    });
                    this.lastLabels = Nametag.labelsFor(members, {
                        eventName: this.titleOf(this.event),
                        date: this.dateOf(this.event),
                    }, pickup);
                } else {
                    this.lastLabels = [];
                }
                await Store.markPresent(db, this.event.id, ids, new Date().toISOString(), extras);
                this.marked = true;
                if (this.lastLabels.length) this.printNow();
            } catch (e) {
                console.error(e);
                this.error = 'Could not mark them present.';
            }
            this.marking = false;
        },

        printNow() {
            if (!this.lastLabels.length) return;
            this.printing = true;
            Nametag.printLabels(this.lastLabels, document);
            this.printNote = 'If a tag did not come out, print again. Attendance is already saved.';
            this.printing = false;
        },
    };
}
