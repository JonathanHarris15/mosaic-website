// Families tab of the Relations viewer (MS-709).
//
// A Family is a tree of Households. This mixin is folded into relationsManage
// alongside the Relationships tab. The People page does not load this file.

// Families (MS-709). Getters must stay live, same reason as Relationships.
window.FamiliesTab = () => ({
    hhFamilies: [],
    hhPeople: [],
    famSelectedId: null,
    hhSelectedId: null,
    hhNew: false,
    hhQuery: '',
    hhError: '',

        async loadFamiliesTab() {
            try {
                const [familiesSnap, peopleSnap] = await Promise.all([
                    db.collection('families').get(),
                    db.collection('people').orderBy('name', 'asc').get(),
                ]);
                this.hhFamilies = familiesSnap.docs.map(d => ({ id: d.id, childIds: [], ...d.data() }));
                this.hhPeople = peopleSnap.docs.map(d => ({ id: d.id, name: d.data().name || d.id, sex: d.data().sex || null }));
                this.hhError = '';
            } catch (e) {
                console.error('Error loading households:', e);
                this.hhError = 'Families could not load.';
            }
        },


        // One entry per Family (a tree of Households, FamilyCore.familyTrees).
        get famTrees() {
            return FamilyCore.familyTrees(this.hhFamilies, this.hhPeople);
        },

        get famList() {
            const q = this.hhQuery.trim().toLowerCase();
            const nameOf = id => (this.hhPeople.find(p => p.id === id) || {}).name || '';
            return this.famTrees
                .filter(t => !q || t.name.toLowerCase().includes(q) || t.peopleIds.some(id => nameOf(id).toLowerCase().includes(q)))
                .map(t => ({
                    id: t.id,
                    name: t.name,
                    sub: (t.households.length === 1 ? '1 Household' : t.households.length + ' Households') +
                        ' · ' + (t.peopleIds.length === 1 ? '1 person' : t.peopleIds.length + ' people'),
                }));
        },

        get famSelected() {
            return this.famTrees.find(t => t.id === this.famSelectedId) || null;
        },

        get famHouseholds() {
            const t = this.famSelected;
            if (!t) return [];
            return t.households.map(h => ({
                id: h.familyId,
                depth: h.depth,
                name: FamilyCore.familyGroupName(this.hhFamilies.find(f => f.id === h.familyId) || {}, this.hhPeople),
            }));
        },

        selectFamily(id) {
            this.famSelectedId = id;
            this.hhSelectedId = id;
            this.hhNew = false;
        },

        selectHousehold(id) {
            this.hhSelectedId = id;
            this.hhNew = false;
        },

        newFamily() {
            this.famSelectedId = null;
            this.hhSelectedId = null;
            this.hhNew = true;
        },

        renderFamilyTree(el) {
            if (!this.famSelectedId) return;
            HouseholdEditor.renderTree(el, {
                families: this.hhFamilies, people: this.hhPeople,
                familyId: this.famSelectedId,
                personHref: id => 'shepherding-profile.html?id=' + encodeURIComponent(id),
            });
        },

        renderHouseholdPane(el) {
            if (!this.hhSelectedId && !this.hhNew) return;
            HouseholdEditor.render(el, {
                db, families: this.hhFamilies, people: this.hhPeople,
                familyId: this.hhSelectedId,
                canEdit: !!this.canWriteEditor,
                headingLevel: 3,
                personHref: id => 'shepherding-profile.html?id=' + encodeURIComponent(id),
                // An edit can move a Household to another Family (a father's
                // parents recorded) or end one (its top Household emptied), so
                // the Family is found again from the Household just written.
                onChange: (next, info) => {
                    this.hhFamilies = next;
                    this.hhNew = false;
                    const trees = FamilyCore.familyTrees(next, this.hhPeople);
                    const holds = (t, id) => t.households.some(h => h.familyId === id);
                    const current = trees.find(t => t.id === this.famSelectedId) || null;
                    if (info.familyId) {
                        this.hhSelectedId = info.familyId;
                        if (!current || !holds(current, info.familyId)) {
                            const home = trees.find(t => holds(t, info.familyId));
                            this.famSelectedId = home ? home.id : null;
                        }
                    } else {
                        this.famSelectedId = current ? current.id : null;
                        this.hhSelectedId = this.famSelectedId;
                    }
                },
                toast: (message, kind) => this.showToast(message, kind),
            });
        },
});

window.withFamiliesTab = (component) =>
    Object.defineProperties(component, Object.getOwnPropertyDescriptors(window.FamiliesTab()));

document.addEventListener('alpine:init', () => {
    // The People page loads this file for the tag mixin and does not load the
    // Relationships tab. The viewer loads both, and that is the only page that
    // mounts this component.
    if (!window.withRelationshipsTab || !window.Alpine) return;
    Alpine.data('relationsManage', () => window.withFamiliesTab(window.withRelationshipsTab({
        ...AccessCore.pageFlags(null),
        activeTab: 'relationships',
        loading: true,
        toast: { show: false, message: '', type: 'success' },

        async init() {
            auth.onAuthStateChanged(async (user) => {
                if (!user) return;
                const userData = await getUserData(user.uid);
                Object.assign(this, AccessCore.pageFlags(userData));
                if (!this.canReadElder) return;
                try {
                    await Promise.all([this.loadRelationshipsTab(), this.loadFamiliesTab()]);
                    this.openFromUrl();
                } finally {
                    this.loading = false;
                }
            });
        },

        // ?tab=families&household=<id> opens that Household's Family.
        // Tags are not a tab here; the People panel owns them.
        openFromUrl() {
            const params = new URLSearchParams(window.location.search);
            const tab = params.get('tab');
            if (tab === 'relationships' || tab === 'families') this.activeTab = tab;
            const householdId = params.get('household');
            if (!householdId) return;
            const home = this.famTrees.find(t => t.households.some(h => h.familyId === householdId));
            if (!home) return;
            this.activeTab = 'families';
            this.selectFamily(home.id);
            this.selectHousehold(householdId);
        },

        showToast(message, type = 'success') {
            this.toast = { show: true, message, type };
            setTimeout(() => { this.toast.show = false; }, 3000);
        },
    })));
});
