function kioskPage() {
    const Store = window.EventsStore;
    const Kiosk = window.KioskCore;
    const Household = window.HouseholdCore;

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

        get eventTitle() {
            return this.event ? this.titleOf(this.event) : '';
        },
        get checkedCount() {
            return Object.keys(this.checked).filter(id => this.checked[id]).length;
        },
        get footerLabel() {
            return Kiosk.presentCountLabel(this.checkedCount);
        },

        async init() {
            auth.onAuthStateChanged(async user => {
                if (!user || user.isAnonymous) {
                    window.location.href = 'login.html';
                    return;
                }
                const data = await getUserData(user.uid);
                if (!Kiosk.isKioskAccount(data)) {
                    window.location.href = 'index.html';
                    return;
                }
                try {
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
            const [peopleSnap, familiesSnap] = await Promise.all([
                db.collection('people').get(),
                db.collection('families').get(),
            ]);
            const people = peopleSnap.docs.map(d => Object.assign({ id: d.id }, d.data()));
            const families = familiesSnap.docs.map(d => Object.assign({ id: d.id }, d.data()));
            this.households = Household.householdsFromDirectory(people, families);
            this.loading = false;
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
            this.view = 'search';
        },
        runSearch() {
            this.matches = Household.searchHouseholds(this.households, this.query);
        },
        openHousehold(h) {
            this.selected = h;
            this.checked = {};
            this.marked = false;
            this.view = 'present';
        },
        toggle(personId) {
            this.checked[personId] = !this.checked[personId];
        },
        async submitPresent() {
            const ids = Object.keys(this.checked).filter(id => this.checked[id]);
            if (!ids.length || !this.event) return;
            this.marking = true;
            this.error = '';
            try {
                await Store.markPresent(db, this.event.id, ids, new Date().toISOString());
                this.marked = true;
            } catch (e) {
                console.error(e);
                this.error = 'Could not mark them present.';
            }
            this.marking = false;
        },
    };
}
