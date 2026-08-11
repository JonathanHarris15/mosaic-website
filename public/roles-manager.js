// Roles Manager (MS-120, ADR-0016) — the authoring home for Role Definitions.
//
// This page is the SURFACE, not the model. RolesCore owns what a Role
// Definition is, what a slot is, which restriction rules exist, what validates,
// and which Roles are locked. Everything here reads or persists that; no rule
// about Roles is restated in this file.
//
// The one roles list (ADR-0016, Option A): liturgical and servant Roles render
// together, because the user's question is "who is serving", not "which storage
// is this Role in". Liturgical Roles are code-defined and locked, so they are
// listed with no edit or delete control at all — absent, not disabled.
//
// ⚠ The shepherding boundary (ADR-0017). A relationship rule may only name a
// Relationship Type an elder has marked Shared with Editors. The query for them
// MUST carry `where('sharedWithEditors', '==', true)`: Firestore evaluates read
// rules per returned document and fails the whole list query if any document
// would fail, so an unconstrained query does not return fewer rows — it errors,
// and the error looks exactly like "this church has no relationship types".
// That is also why a failure here says so out loud instead of rendering empty.
//
// Tags cross the same boundary, by a different road. /people_tags IS readable
// by everyone, so nothing stops the query — the filter is ours to apply, and
// loadShepherdingTags applies it once for the whole page. A tag an elder has
// marked hidden is never offered as a rule and never named in one.
//
// Loaded as a classic <script> and registered with Alpine; the factory is
// exposed on window so the page's decisions can be tested without a browser.

window.RolesManager = () => ({

    currentUser: null,
    currentPermissionLevel: null,

    // The stored Servant Role Definitions, as `{ id, ...definition }`.
    roleDefinitions: [],
    // Stored definitions that would take a liturgical slug. They cannot be shown
    // in the list — allRoles rightly refuses to mix two Roles' serve history —
    // but /roles is editor-writable, so one can arrive by hand. Held aside and
    // reported rather than left to throw on every render.
    conflictingDefinitions: [],

    // Only the tags this account may see. The ids of the rest are held apart in
    // hiddenTagIds — an existing rule can say it is unavailable without the name
    // that was the point of hiding it.
    shepherdingTags: [],
    hiddenTagIds: [],
    sharedRelationshipTypes: [],
    relationshipTypesDenied: false,

    // The Role Definition being edited: a working copy, so cancel is free and
    // nothing partial is ever written. `draftId` is the document it came from.
    draft: null,
    draftId: null,
    saveAttempted: false,

    // The rule being composed, before it is added to the draft. One pair of
    // pickers, not one per kind: the kind decides what the second list offers,
    // so the two read as a sentence — "Cannot serve together if | Marriage".
    newRuleKind: 'requireTag',
    newRuleValue: '',

    // The allowlist picker's own state: people are chosen one at a time into a
    // pending list, so the rule is built whole rather than a rule per person.
    people: [],
    peopleDenied: false,
    newAllowlist: [],
    newAllowlistPick: '',

    // The Sunday Service series document — where liturgical intensity lives.
    series: null,
    savingIntensity: '',
    newRoleName: '',

    loading: true,
    toast: { show: false, message: '', type: 'success' },

    // ── Who may be here ──────────────────────────────────────────────────────

    // Editor and above. The card is hidden from everyone else, but a URL can
    // always be typed, so the page gates itself as well.
    mayManageRoles(permissionLevel) {
        return ['editor', 'elder', 'admin', 'super_admin'].indexOf(permissionLevel) !== -1;
    },

    // ── Where "away from here" is ────────────────────────────────────────────
    //
    // Inside the phone shell this page is running in the app's WebView, and
    // login.html and index.html are both OUTSIDE the app — a refusal that
    // dumps you onto the website is a refusal you can't come back from. Both
    // gates below fire before anything renders, so they have to know.

    get inShell() {
        return typeof window !== 'undefined' && window.MOSAIC_SHELL === 'mobile';
    },

    get signInHref() {
        return this.inShell ? 'mobile.html#/login' : 'login.html';
    },

    get homeHref() {
        return this.inShell ? 'mobile.html#/home' : 'index.html';
    },

    async init() {
        this.listenForShellBack();
        auth.onAuthStateChanged(async (user) => {
            if (!user) {
                window.location.href = this.signInHref;
                return;
            }
            const userData = await getUserData(user.uid);
            this.currentPermissionLevel = (userData && (userData.permissionLevel || userData.role)) || 'viewer';
            if (!this.mayManageRoles(this.currentPermissionLevel)) {
                window.location.href = this.homeHref;
                return;
            }
            this.currentUser = user;
            try {
                await this.loadEverything();
            } finally {
                this.loading = false;
            }
        });
    },

    // Kept for any shell header that DOES draw a back arrow. This page's no
    // longer does — it is a drawer destination, so it carries a hamburger, and
    // leaving a Role is the editor's own arrow. Harmless where nothing fires it,
    // and still correct if that ever changes.
    listenForShellBack() {
        if (typeof document === 'undefined' || !document.addEventListener) return;
        document.addEventListener('mobile-header:back', () => {
            if (this.draft) {
                this.cancelEdit();
                return;
            }
            window.location.href = this.homeHref;
        });
    },

    // Each load owns its own errors: one failing source must not brick the page
    // or leave it stuck on its spinner.
    async loadEverything() {
        await Promise.all([
            this.loadRoleDefinitions(),
            this.loadShepherdingTags(),
            this.loadSharedRelationshipTypes(),
            this.loadPeople(),
            this.loadSeries(),
        ]);
    },

    // For the allowlist picker and the non-servers list. Names, so a rule reads
    // as people rather than as ids — an id nobody can resolve is shown as
    // missing rather than quietly dropped, the same treatment an unshared
    // Relationship Type gets.
    async loadPeople() {
        try {
            const snap = await db.collection('people').orderBy('name').get();
            this.people = snap.docs.map(d => ({
                id: d.id,
                name: (d.data() || {}).name || '',
                doesNotServe: (d.data() || {}).doesNotServe === true,
            }));
        } catch (e) {
            console.error('Could not read people:', e);
            this.people = [];
            this.peopleDenied = true;
        }
    },

    // The Sunday Service series, which is where liturgical intensity lives —
    // never in /roles, because that collection is editor-writable and a document
    // there would make a locked Role editable (ADR-0016).
    async loadSeries() {
        try {
            const doc = await db.collection('events').doc(EventsCore.SUNDAY_SERVICE_ID).get();
            this.series = doc.exists ? Object.assign({ id: doc.id }, doc.data()) : null;
        } catch (e) {
            console.error('Could not read the Sunday Service:', e);
            this.series = null;
        }
    },

    // ── Loading ──────────────────────────────────────────────────────────────

    async loadRoleDefinitions() {
        try {
            const snap = await db.collection('roles').orderBy('name', 'asc').get();
            const all = snap.docs.map(doc => Object.assign({ id: doc.id }, doc.data()));
            const takesLiturgicalSlug = def =>
                RolesCore.LITURGICAL_SLUGS.indexOf(def.slug || RolesCore.slugify(def.name)) !== -1;
            this.conflictingDefinitions = all.filter(takesLiturgicalSlug)
                .map(def => Object.assign({}, def, { slug: def.slug || RolesCore.slugify(def.name) }));
            this.roleDefinitions = all.filter(def => !takesLiturgicalSlug(def))
                .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        } catch (e) {
            console.error('Error loading Role Definitions:', e);
            this.showToast('Could not load Roles', 'error');
        }
    },

    // ⚠ Hidden tags are filtered HERE, once, and nowhere else. `shepherdingTags`
    // is what the picker offers, what addTagRule checks against, and what
    // ruleSentence names a rule from — so a tag an elder has marked hidden is
    // out of all three by being out of this list. `hiddenTagIds` keeps the ids
    // (never the names) so a rule already built on one can say it is
    // unavailable rather than pretend the tag was deleted.
    //
    // The filter is in memory, not in the query: /people_tags is readable by
    // everyone, because the tag list is how the Peoples page draws its filters.
    // Hiding is what the app does with them, not what Firestore refuses.
    async loadShepherdingTags() {
        try {
            const snap = await db.collection('people_tags').orderBy('name', 'asc').get();
            const all = snap.docs.map(doc => ({
                id: doc.id,
                name: doc.data().name || doc.id,
                hiddenFromOthers: doc.data().hiddenFromOthers === true,
            }));
            this.shepherdingTags = RolesCore.visibleTags(all, this.currentPermissionLevel)
                .map(tag => ({ id: tag.id, name: tag.name }));
            const visible = this.shepherdingTags.map(tag => tag.id);
            this.hiddenTagIds = all.map(tag => tag.id).filter(id => visible.indexOf(id) === -1);
        } catch (e) {
            console.error('Error loading Shepherding Tags:', e);
            this.shepherdingTags = [];
            this.hiddenTagIds = [];
        }
    },

    // Shared Relationship Types only — see the boundary note at the top of this
    // file before touching this query.
    async loadSharedRelationshipTypes() {
        try {
            const snap = await db.collection('relationship_types')
                .where('sharedWithEditors', '==', true)
                .get();
            this.sharedRelationshipTypes = snap.docs
                .map(doc => RelationshipCore.normalizeType(Object.assign({ id: doc.id }, doc.data())))
                // The rules and the in-memory filter are a pair: fail closed here
                // too, so a document that somehow arrives unshared is dropped.
                .filter(RelationshipCore.isSharedWithEditors)
                .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
            this.relationshipTypesDenied = false;
        } catch (e) {
            console.error('Error loading Shared Relationship Types:', e);
            this.sharedRelationshipTypes = [];
            this.relationshipTypesDenied = true;
        }
    },

    // ── The one roles list ───────────────────────────────────────────────────

    get roles() {
        return RolesCore.allRoles(this.roleDefinitions);
    },

    get servantRoles() {
        return this.roles.filter(role => !RolesCore.isLocked(role));
    },

    get liturgicalRoles() {
        return this.roles.filter(role => RolesCore.isLocked(role));
    },

    get hasServantRoles() {
        return this.servantRoles.length > 0;
    },

    peopleNeeded(role) {
        return RolesCore.slotCount(role);
    },

    // ── What a row in the list says ──────────────────────────────────────────
    //
    // The row is the edit control now, so it has to say enough at a glance that
    // you know which Role to open without opening any of them.

    peopleNeededLabel(role) {
        const needed = this.peopleNeeded(role);
        return needed === 1 ? 'Needs 1 person' : `Needs ${needed} people`;
    },

    restrictionCount(role) {
        return ((role && role.restrictions) || []).length;
    },

    ruleCountLabel(role) {
        const count = this.restrictionCount(role);
        return count === 1 ? '1 rule' : `${count} rules`;
    },

    // Servant Roles only — the liturgical ones are counted nowhere, because
    // they live in their own locked card and are not part of this list.
    get roleCountLabel() {
        const count = this.servantRoles.length;
        return count === 1 ? '1 role' : `${count} roles`;
    },

    isSelected(role) {
        return !!role && this.draftId === role.id;
    },

    // ── Create, rename, delete ───────────────────────────────────────────────

    async createRole(name) {
        const trimmed = String(name || '').trim();
        if (!trimmed) {
            this.showToast('A Role needs a name', 'error');
            return;
        }
        const definition = RolesCore.newDefinition(trimmed);

        // The slug is fixed at creation and Involvement is written under it, so a
        // collision is refused before the write rather than discovered later as
        // two Roles sharing one serve history.
        if (RolesCore.LITURGICAL_SLUGS.indexOf(definition.slug) !== -1) {
            this.showToast(
                `"${trimmed}" is a liturgical Role. Those are built in and cannot be recreated here — pick another name.`,
                'error'
            );
            return;
        }
        if (this.roleDefinitions.some(def => def.slug === definition.slug)) {
            this.showToast(`A Role called "${trimmed}" already exists`, 'error');
            return;
        }

        const check = RolesCore.validateDefinition(definition);
        if (!check.valid) {
            this.showToast(check.errors.join(' '), 'error');
            return;
        }

        try {
            const ref = await db.collection('roles').add(definition);
            this.roleDefinitions = this.roleDefinitions
                .concat([Object.assign({ id: ref.id }, definition)])
                .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
            this.newRoleName = '';
            this.startEdit(this.roleDefinitions.find(def => def.id === ref.id));
            this.showToast(`Role "${trimmed}" created`);
        } catch (e) {
            console.error('Error creating Role:', e);
            this.showToast('Error creating Role', 'error');
            await this.loadRoleDefinitions();
        }
    },

    // The draft is a deep copy: every RolesCore helper returns a new definition,
    // so nothing the editor does touches the stored one until they save.
    startEdit(role) {
        if (RolesCore.isLocked(role)) {
            this.showToast('Liturgical Roles are built in and cannot be edited', 'error');
            return;
        }
        // Defaults are filled in on open rather than left absent, so the form
        // shows the editor what a Role they have never configured actually does
        // — exclusive, one week's rest — instead of two empty controls.
        this.draft = Object.assign(JSON.parse(JSON.stringify(role)), {
            intensity: RolesCore.intensityOf(role),
            allowsAnotherRole: RolesCore.allowsAnotherRole(role),
        });
        this.draftId = role.id;
        this.saveAttempted = false;
        this.resetRuleForm();
        // On a narrow screen the editor replaces the list rather than sitting
        // beside it, so the view has to move with it — otherwise opening a Role
        // lands you halfway down a screen that has just changed underneath you.
        if (typeof window !== 'undefined' && typeof window.scrollTo === 'function') {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    },

    // The stored definition the draft came from. Delete acts on that, not on the
    // draft, so the confirmation names the Role as it is saved rather than
    // whatever half-finished name is currently in the box.
    get draftRole() {
        return this.roleDefinitions.find(def => def.id === this.draftId) || null;
    },

    cancelEdit() {
        this.draft = null;
        this.draftId = null;
        this.saveAttempted = false;
        this.resetRuleForm();
    },

    resetRuleForm() {
        this.newRuleKind = RolesCore.RESTRICTIONS.REQUIRE_TAG;
        this.newRuleValue = '';
        this.newAllowlist = [];
        this.newAllowlistPick = '';
    },

    async deleteRole(role) {
        if (!role) return;
        if (RolesCore.isLocked(role)) {
            this.showToast('Liturgical Roles are built in and cannot be deleted', 'error');
            return;
        }
        const confirmed = confirm(
            `Delete the Role "${role.name}"?\n\n` +
            'Past serving is kept — everyone who has served in this Role keeps that on their record. ' +
            'Only the Role and its rules are removed, so it can no longer be assigned.'
        );
        if (!confirmed) return;
        try {
            await db.collection('roles').doc(role.id).delete();
            this.roleDefinitions = this.roleDefinitions.filter(def => def.id !== role.id);
            if (this.draftId === role.id) this.cancelEdit();
            this.showToast(`Role "${role.name}" deleted`);
        } catch (e) {
            console.error('Error deleting Role:', e);
            this.showToast('Error deleting Role', 'error');
            await this.loadRoleDefinitions();
        }
    },

    // ── Slots ────────────────────────────────────────────────────────────────
    //
    // Every slot operation goes through RolesCore, which returns a new
    // definition rather than mutating — that is what makes cancel clean and slot
    // ids stable. Three people needed means three slots.

    addSlot(requirement) {
        if (!this.draft) return;
        this.draft = RolesCore.addSlot(this.draft, requirement || RolesCore.REQUIREMENTS.EITHER);
    },

    removeSlot(slotId) {
        if (!this.draft) return;
        if (RolesCore.slotCount(this.draft) <= 1) {
            this.showToast('A Role needs at least one slot — delete the Role instead', 'error');
            return;
        }
        this.draft = RolesCore.removeSlot(this.draft, slotId);
    },

    setSlotRequirement(slotId, requirement) {
        if (!this.draft) return;
        this.draft = RolesCore.setSlotRequirement(this.draft, slotId, requirement);
    },

    moveSlot(from, to) {
        if (!this.draft) return;
        this.draft = RolesCore.reorderSlots(this.draft, from, to);
    },

    get draftPeopleNeeded() {
        return RolesCore.slotCount(this.draft);
    },

    get draftPeopleNeededLabel() {
        return this.peopleNeededLabel(this.draft);
    },

    // The choices a slot offers, in the model's own order.
    get requirementOptions() {
        return RolesCore.REQUIREMENT_VALUES;
    },

    requirementLabel(requirement) {
        return {
            [RolesCore.REQUIREMENTS.MALE]: 'A man',
            [RolesCore.REQUIREMENTS.FEMALE]: 'A woman',
            [RolesCore.REQUIREMENTS.EITHER]: 'Anyone',
        }[requirement] || 'Anyone';
    },

    // ── Restriction rules ────────────────────────────────────────────────────

    get draftRestrictions() {
        return (this.draft && this.draft.restrictions) || [];
    },

    // A Shared Type is one kind or the other, and each kind builds a different
    // rule: "these two may not serve together" is about a pair, "no two from one
    // house group" is about a roster. RolesCore treats the mismatch as an error
    // rather than a no-op, so the two lists are kept apart here.
    get relationshipRuleOptions() {
        return this.sharedRelationshipTypes.filter(type => type.kind === 'pairwise');
    },

    get customGroupTypes() {
        return this.sharedRelationshipTypes.filter(type => type.kind === 'group');
    },

    // ⚠ EVERY type lookup goes through here. The two the Membership Directory
    // answers are not in `sharedRelationshipTypes` and never will be, so a
    // `.find` over that list alone reports a perfectly good Family rule as
    // "unavailable — an elder is no longer sharing this type", which is both
    // wrong and unfixable by the person reading it.
    get knownRelationshipTypes() {
        return RolesCore.DIRECTORY_GROUP_TYPES.concat(this.sharedRelationshipTypes);
    },

    relationshipTypeById(typeId) {
        return this.knownRelationshipTypes.find(t => t && t.id === typeId) || null;
    },

    // The two the Membership Directory answers come FIRST and are always there.
    // They need no elder to share them: a Family is a household an editor
    // already keeps, not an arbitrary grouping somebody has to invent, and
    // making the commonest rule in a church wait on a setup step nobody knows
    // about is how it never gets written.
    get directoryGroupTypes() {
        return RolesCore.DIRECTORY_GROUP_TYPES;
    },

    get groupRuleOptions() {
        return this.directoryGroupTypes.concat(this.customGroupTypes);
    },

    // Said out loud, because an empty picker and a denied query look identical
    // from the outside and mean opposite things. Both kinds count: a church that
    // has shared one Group Type has shared something, and must not be told
    // otherwise.
    get relationshipTypesNotice() {
        if (this.relationshipTypesDenied) {
            return 'We couldn\'t load relationship types — this account may not have permission to read them. ' +
                'Nothing is missing from your Roles; ask an elder or admin to check.';
        }
        // Family and Marriage are always on offer, so "nothing to build from"
        // is now only ever true of the PAIRWISE side.
        if (this.relationshipRuleOptions.length === 0 && this.customGroupTypes.length === 0) {
            return 'Family and Marriage come from the Membership Directory and are always available. ' +
                'For anything else — a house group, a book study — an elder can share a relationship ' +
                'type in Manage Tags and Relationships.';
        }
        return '';
    },

    // The kinds of rule on offer, as sentence openers. A relationship rule is
    // offered only when there is a Shared Type to build one from — a choice
    // whose second picker is always empty is a dead end, and the notice below
    // the form already explains why it isn't there.
    get ruleKindOptions() {
        const options = [
            { value: RolesCore.RESTRICTIONS.REQUIRE_TAG, label: 'Must be tagged' },
            { value: RolesCore.RESTRICTIONS.EXCLUDE_TAG, label: 'Cannot be tagged' },
        ];
        if (this.relationshipRuleOptions.length) {
            options.push({ value: RolesCore.RESTRICTIONS.NOT_TOGETHER, label: 'Cannot serve together if' });
        }
        if (this.groupRuleOptions.length) {
            options.push({ value: RolesCore.RESTRICTIONS.NOT_SAME_GROUP, label: 'No two people from the same' });
            options.push({ value: RolesCore.RESTRICTIONS.SAME_GROUP, label: 'Everyone from the same' });
        }
        // Last, because it is the blunt one: naming people directly is right for
        // the four who serve communion, and wrong for anything a tag could say.
        options.push({ value: RolesCore.RESTRICTIONS.ALLOWLIST, label: 'Only these people' });
        return options;
    },

    // The cap the model enforces, so the box and the refusal agree (MS-222).
    get descriptionLimit() { return RolesCore.MAX_DESCRIPTION; },

    get descriptionLeft() {
        const written = ((this.draft && this.draft.description) || '').trim().length;
        return RolesCore.MAX_DESCRIPTION - written;
    },

    get composingAllowlist() {
        return this.newRuleKind === RolesCore.RESTRICTIONS.ALLOWLIST;
    },

    personName(personId) {
        const person = this.people.find(p => p.id === personId);
        return (person && person.name) || null;
    },

    // Everyone not already picked, so the same person cannot be added twice.
    get allowlistOptions() {
        return this.people.filter(p => this.newAllowlist.indexOf(p.id) === -1);
    },

    // ── Who does not serve ───────────────────────────────────────────────────
    //
    // ⚠ A FACT ABOUT THE PERSON, so it is a field on their record rather than a
    // list kept here. A Role's allowlist answers "who may do THIS"; this answers
    // "who does none of it", and the moment that answer is copied onto each Role
    // it starts going out of step with the next Role somebody adds.
    //
    // It is not a privacy setting and it does not hide anybody: the name is
    // still everywhere it was. It is only never OFFERED for a Role.

    nonServerSearch: '',
    savingNonServer: '',

    get nonServers() {
        return this.people.filter(p => p.doesNotServe);
    },

    // A search rather than a dropdown of the whole church, because the list this
    // adds to is short and the church is not.
    get nonServerMatches() {
        const q = this.nonServerSearch.trim().toLowerCase();
        if (!q) return [];
        return this.people
            .filter(p => !p.doesNotServe && String(p.name || '').toLowerCase().indexOf(q) !== -1)
            .slice(0, 8);
    },

    async setDoesNotServe(personId, value) {
        if (!personId || this.savingNonServer) return;
        this.savingNonServer = personId;

        try {
            await db.collection('people').doc(personId).update({ doesNotServe: value });
            this.people = this.people.map(p => (
                p.id === personId ? Object.assign({}, p, { doesNotServe: value }) : p
            ));
            this.nonServerSearch = '';
        } catch (e) {
            console.error('Could not save that:', e);
            this.showToast('Could not save that — nothing was changed', 'error');
        } finally {
            this.savingNonServer = '';
        }
    },

    get newAllowlistNames() {
        return this.newAllowlist.map(id => this.personName(id) || 'Someone no longer in the directory');
    },

    addToNewAllowlist() {
        const id = this.newAllowlistPick;
        if (!id || this.newAllowlist.indexOf(id) !== -1) return;
        this.newAllowlist = this.newAllowlist.concat([id]);
        this.newAllowlistPick = '';
    },

    removeFromNewAllowlist(personId) {
        this.newAllowlist = this.newAllowlist.filter(id => id !== personId);
    },

    // Written as ONE rule holding everyone, not a rule per person: an allowlist
    // is a single statement about the Role, and roles-core refuses an empty one
    // rather than letting it become a Role nobody can ever fill.
    addAllowlistRule() {
        if (!this.draft) return;
        if (!this.newAllowlist.length) {
            this.showToast('Add at least one person, or the Role could never be filled', 'error');
            return;
        }
        const existing = this.draftRestrictions
            .filter(rule => rule.kind !== RolesCore.RESTRICTIONS.ALLOWLIST);
        this.draft = Object.assign({}, this.draft, {
            restrictions: existing.concat([{
                kind: RolesCore.RESTRICTIONS.ALLOWLIST,
                personIds: this.newAllowlist.slice(),
            }]),
        });
        this.newAllowlist = [];
        this.newAllowlistPick = '';
    },

    // ── Editing the list that is already on the Role ─────────────────────────
    //
    // An allowlist is the one rule made of MANY things, so it is the one rule
    // that can be half-wrong later. Every other rule names a single tag or type
    // — if it is wrong you remove it and add the right one. A list of eleven
    // people with one person missing is not a rule to replace, it is a rule to
    // amend, and rebuilding it from memory is how the twelfth name gets left
    // off and somebody quietly stops being offered the Role.
    //
    // So the list is edited where it sits, in the rules list, rather than in
    // the composer above it. The composer still writes a NEW list (and still
    // replaces any existing one, which is the "start over" route).

    // The names on a rule's list, in order, for the chips. A person who has
    // left the directory is SAID rather than dropped — same reasoning as
    // ruleSentence, and now they can be cleared off.
    allowlistNames(rule) {
        return ((rule && rule.personIds) || [])
            .map(id => this.personName(id) || 'Someone no longer in the directory');
    },

    // Everyone not already on THIS list. Per-rule, not the composer's picker:
    // the two lists are being built at once when a Role already has one.
    allowlistOptionsFor(rule) {
        const on = (rule && rule.personIds) || [];
        return this.people.filter(person => on.indexOf(person.id) === -1);
    },

    // The rule at `index`, but only if it really is an allowlist. The index
    // comes from the rendered list, and a stale one must not turn a tag rule
    // into a list of people.
    allowlistRuleAt(index) {
        const rule = this.draftRestrictions[index];
        return (rule && rule.kind === RolesCore.RESTRICTIONS.ALLOWLIST) ? rule : null;
    },

    // Replace the rule at `index` with one holding `personIds`. Immutable, like
    // every other edit here, so cancel stays free.
    replaceAllowlistAt(index, personIds) {
        this.draft = Object.assign({}, this.draft, {
            restrictions: this.draftRestrictions.map((rule, i) => (
                i === index ? Object.assign({}, rule, { personIds: personIds }) : rule
            )),
        });
    },

    addToAllowlistRule(index, personId) {
        if (!this.draft || !personId) return;
        const rule = this.allowlistRuleAt(index);
        if (!rule) return;
        const on = rule.personIds || [];
        if (on.indexOf(personId) !== -1) return;
        this.replaceAllowlistAt(index, on.concat([personId]));
    },

    removeFromAllowlistRule(index, personId) {
        if (!this.draft) return;
        const rule = this.allowlistRuleAt(index);
        if (!rule) return;
        const left = (rule.personIds || []).filter(id => id !== personId);
        // An empty list is a Role nobody can ever fill. "Anyone" is said by
        // removing the RULE, and that control is on the same row — so point at
        // it rather than leaving behind a Role that cannot be saved.
        if (!left.length) {
            this.showToast('A list needs at least one person — remove the rule to let anyone fill this Role', 'error');
            return;
        }
        this.replaceAllowlistAt(index, left);
    },

    // The picker is a <select> that fires on change; it has to fall back to its
    // placeholder or the same person cannot be re-picked after being removed.
    pickIntoAllowlistRule(index, event) {
        const id = event && event.target && event.target.value;
        this.addToAllowlistRule(index, id);
        if (event && event.target) event.target.value = '';
    },

    get composingRelationshipRule() {
        return this.newRuleKind === RolesCore.RESTRICTIONS.NOT_TOGETHER;
    },

    get composingGroupRule() {
        return [RolesCore.RESTRICTIONS.SAME_GROUP, RolesCore.RESTRICTIONS.NOT_SAME_GROUP]
            .indexOf(this.newRuleKind) !== -1;
    },

    get ruleValueOptions() {
        let source = this.shepherdingTags;
        if (this.composingGroupRule) source = this.groupRuleOptions;
        else if (this.composingRelationshipRule) source = this.relationshipRuleOptions;
        return source.map(item => ({ id: item.id, name: item.name }));
    },

    get ruleValuePlaceholder() {
        if (this.composingGroupRule) return 'Choose a group type…';
        if (this.composingRelationshipRule) return 'Choose a relationship…';
        return 'Choose a tag…';
    },

    // The form's one action. The kind decides which rule is actually being
    // built; both routes below still do their own checking, because the form is
    // a convenience and they are the boundary.
    addComposedRule() {
        if (this.composingAllowlist) {
            this.addAllowlistRule();
            return;
        }
        if (!this.newRuleValue) {
            if (this.composingGroupRule) this.showToast('Pick a group type from the list', 'error');
            else if (this.composingRelationshipRule) this.showToast('Pick a relationship type from the list', 'error');
            else this.showToast('Pick a tag from the list', 'error');
            return;
        }
        if (this.composingGroupRule) {
            this.addGroupRule(this.newRuleKind, this.newRuleValue);
        } else if (this.composingRelationshipRule) {
            this.addRelationshipRule(this.newRuleValue);
        } else {
            this.addTagRule(this.newRuleKind, this.newRuleValue);
        }
    },

    hasRule(kind, key, value) {
        return this.draftRestrictions.some(rule => rule.kind === kind && rule[key] === value);
    },

    addTagRule(kind, tagId) {
        if (!this.draft) return;
        if ([RolesCore.RESTRICTIONS.REQUIRE_TAG, RolesCore.RESTRICTIONS.EXCLUDE_TAG].indexOf(kind) === -1) return;
        // Chosen from the church's own Tags — a typo'd tag id is a rule that
        // silently matches nobody.
        if (!this.shepherdingTags.some(tag => tag.id === tagId)) {
            this.showToast('Pick a tag from the list', 'error');
            return;
        }
        if (this.hasRule(kind, 'tagId', tagId)) return;
        this.draft = Object.assign({}, this.draft, {
            restrictions: this.draftRestrictions.concat([{ kind: kind, tagId: tagId }]),
        });
        this.newRuleValue = '';
    },

    addRelationshipRule(typeId) {
        if (!this.draft) return;
        // Only what is on offer — building a rule against a Type this page
        // cannot read would produce a Role that can never be filled, with no
        // clue why.
        if (!this.relationshipRuleOptions.some(type => type.id === typeId)) {
            this.showToast('Pick a shared relationship type from the list', 'error');
            return;
        }
        const kind = RolesCore.RESTRICTIONS.NOT_TOGETHER;
        if (this.hasRule(kind, 'typeId', typeId)) return;
        this.draft = Object.assign({}, this.draft, {
            restrictions: this.draftRestrictions.concat([{ kind: kind, typeId: typeId }]),
        });
        this.newRuleValue = '';
    },

    // "No two people from one house group", and its opposite. Both are rules
    // about a roster, so only a Group-kind Shared Type will do — RolesCore calls
    // the mismatch a mistake, not a no-op, and the picker never offers one.
    addGroupRule(kind, typeId) {
        if (!this.draft) return;
        if ([RolesCore.RESTRICTIONS.SAME_GROUP, RolesCore.RESTRICTIONS.NOT_SAME_GROUP].indexOf(kind) === -1) return;
        if (!this.groupRuleOptions.some(type => type.id === typeId)) {
            this.showToast('Pick a shared group type from the list', 'error');
            return;
        }
        if (this.hasRule(kind, 'typeId', typeId)) return;
        this.draft = Object.assign({}, this.draft, {
            restrictions: this.draftRestrictions.concat([{ kind: kind, typeId: typeId }]),
        });
        this.newRuleValue = '';
    },

    removeRule(index) {
        if (!this.draft) return;
        this.draft = Object.assign({}, this.draft, {
            restrictions: this.draftRestrictions.filter((_, i) => i !== index),
        });
    },

    isRuleAvailable(rule) {
        return RolesCore.validateRestriction(rule, this.knownRelationshipTypes).valid;
    },

    // ── Liturgical intensity ─────────────────────────────────────────────────
    //
    // The ONE thing about a liturgical Role an editor may change, and it is not
    // part of the Role's definition — it is a fairness weight. Preparing a
    // sermon and reading a prayer are not the same work, and fairness has to be
    // able to know that.
    //
    // Written to the Sunday Service series, NEVER to /roles: that collection is
    // editor-writable, so a document there would make a locked Role editable —
    // the exact invariant that makes these Roles locked (ADR-0016). RolesCore
    // refuses such a document and this page quarantines it.

    liturgicalIntensity(slug) {
        return EventsCore.roleIntensity(this.series, slug);
    },

    async setLiturgicalIntensity(slug, raw) {
        const value = Number(raw);
        if (!Number.isFinite(value) || value < 0) {
            this.showToast('Rest between turns has to be zero or more weeks', 'error');
            return;
        }
        const map = Object.assign({}, (this.series && this.series.liturgicalIntensity) || {});
        map[slug] = value;

        this.savingIntensity = slug;
        try {
            await db.collection('events').doc(EventsCore.SUNDAY_SERVICE_ID)
                .set({ liturgicalIntensity: map }, { merge: true });
            this.series = Object.assign({}, this.series || {}, { liturgicalIntensity: map });
        } catch (e) {
            console.error('Could not save the intensity:', e);
            this.showToast('Could not save that — nothing was changed', 'error');
            await this.loadSeries();
        } finally {
            this.savingIntensity = '';
        }
    },

    tagName(tagId) {
        const tag = this.shepherdingTags.find(t => t.id === tagId);
        return tag ? tag.name : null;
    },

    // A glyph per kind, so a list of rules can be scanned before it is read —
    // a required tag must never look like an excluded one.
    ruleIcon(rule) {
        const kind = rule && rule.kind;
        if (kind === RolesCore.RESTRICTIONS.REQUIRE_TAG) return 'sell';
        if (kind === RolesCore.RESTRICTIONS.EXCLUDE_TAG) return 'block';
        if (kind === RolesCore.RESTRICTIONS.SAME_GROUP) return 'groups';
        if (kind === RolesCore.RESTRICTIONS.NOT_SAME_GROUP) return 'group_remove';
        if (kind === RolesCore.RESTRICTIONS.ALLOWLIST) return 'how_to_reg';
        return 'hub';
    },

    // A rule the user can check by reading it. Never a data structure, and never
    // the name of a Relationship Type this page was not given — a rule whose
    // Type has been unshared says only that it is unavailable.
    ruleSentence(rule) {
        const kind = rule && rule.kind;
        if (kind === RolesCore.RESTRICTIONS.REQUIRE_TAG || kind === RolesCore.RESTRICTIONS.EXCLUDE_TAG) {
            // A hidden tag is not a missing one, and must not be reported as
            // one: "no longer exists" reads as a dead rule to clear out, and
            // the editor would be deleting a rule an elder still means.
            if (this.hiddenTagIds.indexOf(rule.tagId) !== -1) {
                return 'This rule uses a tag an elder keeps private. It still applies — ask an elder if it needs changing.';
            }
            const name = this.tagName(rule.tagId);
            if (kind === RolesCore.RESTRICTIONS.REQUIRE_TAG) {
                return name
                    ? `Must be tagged "${name}"`
                    : 'Must carry a tag that no longer exists — remove this rule';
            }
            return name
                ? `Cannot be tagged "${name}"`
                : 'Excludes a tag that no longer exists — remove this rule';
        }
        // The one rule whose sentence does NOT carry its own contents: the list
        // is rendered under it as chips, each removable, so naming everybody
        // here as well would print the same eleven names twice. The chips are
        // where "names, never ids" now lives (allowlistNames), including saying
        // a person who has left rather than dropping them — a shorter list than
        // the editor believes they have is how a Role stops being fillable.
        if (kind === RolesCore.RESTRICTIONS.ALLOWLIST) {
            const ids = rule.personIds || [];
            if (!ids.length) return 'This list is empty, so nobody could ever fill this Role — remove it or add someone';
            return ids.length === 1
                ? 'Only this person can fill this Role'
                : 'Only these people can fill this Role';
        }

        const type = this.relationshipTypeById(rule.typeId);
        if (!type) {
            return 'This rule is unavailable — an elder is no longer sharing the relationship type it uses ' +
                'with editors. Remove it, or ask an elder to share that type again.';
        }
        if (kind === RolesCore.RESTRICTIONS.NOT_TOGETHER) {
            return `Two people connected by "${type.name}" cannot serve in this Role together`;
        }
        if (kind === RolesCore.RESTRICTIONS.NOT_SAME_GROUP) {
            return `No two people from the same "${type.name}" group can serve in this Role together`;
        }
        if (kind === RolesCore.RESTRICTIONS.SAME_GROUP) {
            return `Everyone in this Role must be from one "${type.name}" group`;
        }
        return 'This rule is unavailable — remove it.';
    },

    // ── Saving ───────────────────────────────────────────────────────────────

    // Every problem at once, so the editor fixes them together rather than one
    // save at a time.
    // What the editor typed, in the shape the model reads. A number input hands
    // back a string, and `intensity` is read strictly on purpose — a STORED
    // string is genuinely bad data. Coercing at the boundary keeps both true:
    // the box can never lock the Role, and the strict read stays strict.
    get normalisedDraft() {
        if (!this.draft) return null;
        const raw = this.draft.intensity;

        // ⚠ ONLY a value that really is a number is coerced. An EMPTY box must
        // stay rejected: Number('') is 0, a real intensity meaning the job costs
        // nothing, and saving that silently would empty the rest budget of
        // whoever does it. Absent is fine — it reads as one week — but blank is
        // a question the editor has not answered.
        if (typeof raw !== 'string' || raw.trim() === '') return this.draft;
        const parsed = Number(raw);
        if (!Number.isFinite(parsed)) return this.draft;

        return Object.assign({}, this.draft, { intensity: parsed });
    },

    get draftErrors() {
        if (!this.draft) return [];
        const errors = RolesCore.validateDefinition(this.normalisedDraft).errors.slice();
        this.draftRestrictions.forEach((rule, i) => {
            RolesCore.validateRestriction(rule, this.knownRelationshipTypes).errors
                .forEach(message => errors.push(`Rule ${i + 1}: ${message}`));
        });
        return errors;
    },

    async saveDraft() {
        if (!this.draft || !this.draftId) return;
        this.saveAttempted = true;
        if (this.draftErrors.length) {
            this.showToast('This Role can\'t be saved yet — see the problems listed', 'error');
            return;
        }

        // Written whole, not merged: a rule the editor removed has to disappear
        // from the stored document too. The slug is carried across untouched —
        // renaming must never move a Role's serve history.
        const definition = {
            name: this.draft.name.trim(),
            // Carried across, never recomputed. Only a definition that somehow
            // stored none falls back to deriving one — which is what every read
            // path already does for it, so nothing moves.
            slug: this.draft.slug || RolesCore.slugify(this.draft.name),
            family: RolesCore.FAMILIES.SERVANT,
            slots: this.draft.slots,
            restrictions: this.draftRestrictions,
            // Typed into a number input, which hands back a string when the box
            // is cleared. Normalised once here so what is stored is always the
            // number every read path expects.
            intensity: RolesCore.intensityOf({ intensity: Number(this.draft.intensity) }),
            allowsAnotherRole: this.draft.allowsAnotherRole === true,
        };

        try {
            await db.collection('roles').doc(this.draftId).set(definition);
            this.roleDefinitions = this.roleDefinitions
                .map(def => (def.id === this.draftId ? Object.assign({ id: def.id }, definition) : def))
                .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
            this.cancelEdit();
            this.showToast(`Role "${definition.name}" saved`);
        } catch (e) {
            console.error('Error saving Role:', e);
            this.showToast('Error saving Role — nothing was changed', 'error');
            // The screen must match what is actually stored, not what was typed.
            await this.loadRoleDefinitions();
        }
    },

    showToast(message, type = 'success') {
        this.toast = { show: true, message, type };
        setTimeout(() => { this.toast.show = false; }, 3000);
    },
});

if (typeof document !== 'undefined') {
    document.addEventListener('alpine:init', () => {
        Alpine.data('rolesManager', () => window.RolesManager());
    });
}
