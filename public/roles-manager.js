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

    shepherdingTags: [],
    sharedRelationshipTypes: [],
    relationshipTypesDenied: false,

    // The Role Definition being edited: a working copy, so cancel is free and
    // nothing partial is ever written. `draftId` is the document it came from.
    draft: null,
    draftId: null,
    saveAttempted: false,

    // The rule being composed, before it is added to the draft.
    newRuleTagKind: 'requireTag',
    newRuleTagId: '',
    newRuleTypeId: '',
    newRoleName: '',

    loading: true,
    toast: { show: false, message: '', type: 'success' },

    // ── Who may be here ──────────────────────────────────────────────────────

    // Editor and above. The card is hidden from everyone else, but a URL can
    // always be typed, so the page gates itself as well.
    mayManageRoles(permissionLevel) {
        return ['editor', 'elder', 'admin', 'super_admin'].indexOf(permissionLevel) !== -1;
    },

    async init() {
        auth.onAuthStateChanged(async (user) => {
            if (!user) {
                window.location.href = 'login.html';
                return;
            }
            const userData = await getUserData(user.uid);
            this.currentPermissionLevel = (userData && (userData.permissionLevel || userData.role)) || 'viewer';
            if (!this.mayManageRoles(this.currentPermissionLevel)) {
                window.location.href = 'index.html';
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

    // Each load owns its own errors: one failing source must not brick the page
    // or leave it stuck on its spinner.
    async loadEverything() {
        await Promise.all([
            this.loadRoleDefinitions(),
            this.loadShepherdingTags(),
            this.loadSharedRelationshipTypes(),
        ]);
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

    async loadShepherdingTags() {
        try {
            const snap = await db.collection('people_tags').orderBy('name', 'asc').get();
            this.shepherdingTags = snap.docs.map(doc => ({ id: doc.id, name: doc.data().name || doc.id }));
        } catch (e) {
            console.error('Error loading Shepherding Tags:', e);
            this.shepherdingTags = [];
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
        this.draft = JSON.parse(JSON.stringify(role));
        this.draftId = role.id;
        this.saveAttempted = false;
        this.resetRuleForm();
    },

    cancelEdit() {
        this.draft = null;
        this.draftId = null;
        this.saveAttempted = false;
        this.resetRuleForm();
    },

    resetRuleForm() {
        this.newRuleTagKind = RolesCore.RESTRICTIONS.REQUIRE_TAG;
        this.newRuleTagId = '';
        this.newRuleTypeId = '';
    },

    async deleteRole(role) {
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

    // Only Shared Relationship Types, and only the pairwise ones: "these two may
    // not serve together" is a rule about a pair. (Group rules are MS-141.)
    get relationshipRuleOptions() {
        return this.sharedRelationshipTypes.filter(type => type.kind === 'pairwise');
    },

    // Said out loud, because an empty picker and a denied query look identical
    // from the outside and mean opposite things.
    get relationshipTypesNotice() {
        if (this.relationshipTypesDenied) {
            return 'We couldn\'t load relationship types — this account may not have permission to read them. ' +
                'Nothing is missing from your Roles; ask an elder or admin to check.';
        }
        if (this.relationshipRuleOptions.length === 0) {
            return 'No relationship types have been shared with editors yet, so there is nothing to build a ' +
                '"may not serve together" rule from. An elder can share one in Manage Tags and Relationships.';
        }
        return '';
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
        this.newRuleTagId = '';
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
        this.newRuleTypeId = '';
    },

    removeRule(index) {
        if (!this.draft) return;
        this.draft = Object.assign({}, this.draft, {
            restrictions: this.draftRestrictions.filter((_, i) => i !== index),
        });
    },

    isRuleAvailable(rule) {
        return RolesCore.validateRestriction(rule, this.sharedRelationshipTypes).valid;
    },

    tagName(tagId) {
        const tag = this.shepherdingTags.find(t => t.id === tagId);
        return tag ? tag.name : null;
    },

    // A rule the user can check by reading it. Never a data structure, and never
    // the name of a Relationship Type this page was not given — a rule whose
    // Type has been unshared says only that it is unavailable.
    ruleSentence(rule) {
        const kind = rule && rule.kind;
        if (kind === RolesCore.RESTRICTIONS.REQUIRE_TAG) {
            const name = this.tagName(rule.tagId);
            return name
                ? `Must be tagged "${name}"`
                : 'Must carry a tag that no longer exists — remove this rule';
        }
        if (kind === RolesCore.RESTRICTIONS.EXCLUDE_TAG) {
            const name = this.tagName(rule.tagId);
            return name
                ? `Cannot be tagged "${name}"`
                : 'Excludes a tag that no longer exists — remove this rule';
        }
        const type = this.sharedRelationshipTypes.find(t => t.id === rule.typeId);
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
    get draftErrors() {
        if (!this.draft) return [];
        const errors = RolesCore.validateDefinition(this.draft).errors.slice();
        this.draftRestrictions.forEach((rule, i) => {
            RolesCore.validateRestriction(rule, this.sharedRelationshipTypes).errors
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
