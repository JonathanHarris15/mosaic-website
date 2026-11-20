// Roles Manager (MS-120, ADR-0016) — the home of what each Servant Role IS.
//
// A Role is its name and what it involves. Who it needs, who may fill it, how
// much rest it owes and whether it uses up the morning belong to each EVENT that
// runs it (EventsCore.effectiveRole), and are set on that event's Roles & rules
// tab. So this page is a ledger: every Role one row — name, description, the
// events it runs in (each a way through to them) — and beside it the two things
// that are true across the whole church: the built-in Sunday Roles, and who
// does not serve.
//
// The row being written in is the open Role, and it saves itself through
// RoleEditorCore's session exactly as the open Role always has (MS-721).
// RolesCore owns what a Role is; nothing about Roles is restated here.
//
// ⚠ The shepherding boundary (ADR-0017). "Doesn't serve" offers only the tags
// this account may see and the groups an elder has shared with editors; the
// group query MUST carry `where('sharedWithEditors', '==', true)`, or Firestore
// fails the whole query rather than returning less.
//
// Loaded as a classic <script> and registered with Alpine; the factory is
// exposed on window so the page's decisions can be tested without a browser.

window.RolesManager = () => ({

    currentUser: null,
    currentPermissionLevel: null,

    // The stored Servant Role Definitions, as `{ id, ...definition }`.
    /** @type {Array<Record<string, *>>} */
    roleDefinitions: [],
    // Stored definitions that would take a liturgical slug. They cannot be shown
    // in the list — allRoles rightly refuses to mix two Roles' serve history —
    // but /roles is editor-writable, so one can arrive by hand. Held aside and
    // reported rather than left to throw on every render.
    conflictingDefinitions: [],
    // Stored Roles that read as one slug: shown, but not takeable anywhere
    // until one is deleted (RolesCore.registry refuses to guess between them).
    /** @type {Array<{ slug: string, names: string[] }>} */
    sharedSlugs: [],

    // The Role Definition being edited: the working copy the row binds to.
    // `draftId` is the document it came from. Only the open Role's session
    // (RoleEditorCore) writes it, and only the fields that changed.
    draft: null,
    draftId: null,
    saveAttempted: false,

    // Names for "Doesn't serve".
    people: [],
    peopleDenied: false,

    // Every event series, so a Role's row can say where it runs. Who a Role
    // needs, its rules and its rest belong to those events now
    // (EventsCore.effectiveRole), and each one is a way through to them.
    allSeries: [],
    newRoleName: '',

    loading: true,
    toast: { show: false, message: '', type: 'success' },

    // ── Who may be here ──────────────────────────────────────────────────────

    // Editor and above. The card is hidden from everyone else, but a URL can
    // always be typed, so the page gates itself as well.
    // Writing a Role is roles.manager.edit (firestore.rules
    // editsWith('roles.manager.edit'), MS-722) — asked through AccessCore,
    // which answers for legacy level strings from their preset.
    mayManageRoles(permissionLevel) {
        return AccessCore.hasPermission(permissionLevel, 'roles.manager.edit');
    },

    get canManageRoles() {
        return this.mayManageRoles(this.account || this.currentPermissionLevel);
    },

    get canSetDoesNotServe() {
        const who = this.account || this.currentPermissionLevel;
        return AccessCore.EDITOR_WRITE_LEVELS.indexOf(AccessCore.permissionLevelOf(who)) !== -1
            || AccessCore.isPastoralAssistant(who);
    },
    mayOpenRoles(account) {
        return AccessCore.readsAsEditor(account);
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
        // Alpine: every change to the Role being edited feeds the live
        // editor (MS-721). Deep, so a slot or rule change counts.
        if (typeof this.$watch === 'function') this.$watch('draft', () => this.syncLiveRole());
        auth.onAuthStateChanged(async (user) => {
            if (!user) {
                window.location.href = this.signInHref;
                return;
            }
            const userData = await getUserData(user.uid);
            Object.assign(this, AccessCore.pageFlags(userData));
            if (!this.canReadEditor) {
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
                this.closeRole();
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
            this.loadPeople(),
            this.loadAllSeries(),
            this.loadNonServing(),
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
                // For counting who a tag that does not serve covers.
                tags: Array.isArray((d.data() || {}).tags) ? d.data().tags : [],
            }));
        } catch (e) {
            console.error('Could not read people:', e);
            this.people = [];
            this.peopleDenied = true;
        }
    },


    // Every event series. Failing to read them costs the "Runs in" column,
    // never the page.
    async loadAllSeries() {
        try {
            const snap = await db.collection('events').get();
            this.allSeries = snap.docs.map(d => Object.assign({ id: d.id }, d.data()))
                .filter(s => Array.isArray(s.roleSlugs));
        } catch (e) {
            console.error('Could not read the events:', e);
            this.allSeries = [];
        }
    },

    // Where a Role runs: each event carrying it, and how many people that
    // event needs on it (its own answer, or the Role's old one until it has
    // given one).
    usesOf(slug) {
        const def = this.roleDefinitions.find(d => d.slug === slug) || { slug: slug };
        return this.allSeries
            .filter(s => s.roleSlugs.indexOf(slug) !== -1)
            .map(s => {
                const role = EventsCore.effectiveRole(s, def);
                const count = RolesCore.slotCount(role);
                return { id: s.id, name: s.name || s.id, count: count === 1 ? '1 person' : count + ' people' };
            })
            .sort((a, b) => (a.id === EventsCore.SUNDAY_SERVICE_ID ? -1 : b.id === EventsCore.SUNDAY_SERVICE_ID ? 1
                : String(a.name).localeCompare(String(b.name))));
    },

    // ── Loading ──────────────────────────────────────────────────────────────

    async readStoredDefinitions() {
        const snap = await db.collection('roles').orderBy('name', 'asc').get();
        return snap.docs.map(doc => Object.assign({ id: doc.id }, doc.data()));
    },

    async loadRoleDefinitions() {
        try {
            const split = RoleEditorCore.partition(await this.readStoredDefinitions());
            this.conflictingDefinitions = split.conflicting;
            this.sharedSlugs = split.sharedSlugs;
            this.roleDefinitions = split.definitions;
        } catch (e) {
            console.error('Error loading Role Definitions:', e);
            this.showToast('Could not load Roles', 'error');
        }
    },


    /** @param {{ names: string[] }} shared */
    sharedSlugSentence(shared) {
        const names = ((shared && shared.names) || []).map(n => `“${n}”`).join(' and ');
        return `${names} are saved under the same short name, so places in them cannot be taken or swapped. `;
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
        if (!this.canManageRoles) return;
        const proposal = RoleEditorCore.proposeNew(name, this.roleDefinitions);
        if (!proposal.ok) {
            this.showToast(proposal.error, 'error');
            return;
        }
        const definition = proposal.definition;
        try {
            // ⚠ The list on screen is the one loaded when the page opened. A
            // Role another editor (or another tab) has created since is not
            // in it, so the slug is asked about again, now, before the write.
            const fresh = await this.readStoredDefinitions();
            const recheck = RoleEditorCore.proposeNew(name, fresh);
            if (!recheck.ok) {
                this.showToast(recheck.error, 'error');
                await this.loadRoleDefinitions();
                return;
            }
            const ref = await db.collection('roles').add(definition);
            this.roleDefinitions = RoleEditorCore.withStored(
                this.roleDefinitions.concat([Object.assign({ id: ref.id }, definition)]), ref.id, {});
            this.newRoleName = '';
            this.startEdit(this.roleDefinitions.find(def => def.id === ref.id));
            this.showToast(`Role "${definition.name}" created`);
        } catch (e) {
            console.error('Error creating Role:', e);
            this.showToast('Error creating Role', 'error');
            await this.loadRoleDefinitions();
        }
    },

    // Opening a Role. The draft is the working copy the form binds to; every
    // slot and rule helper replaces it with a new object, so nothing touches
    // the stored Role except the session that is opened with it.
    startEdit(role) {
        if (!role) return;
        if (RolesCore.isLocked(role)) {
            this.showToast('Liturgical Roles are built in and cannot be edited', 'error');
            return;
        }
        // ⚠ The Role being left is closed FIRST — while the draft is still
        // its own — so its last keystrokes are handed to its own session and
        // sent. Swapping the draft first is what used to write the next
        // Role's name, slots and rules over the one being left.
        this.endSession();
        // ⚠ The STORED document, not the row it was clicked from. A row in
        // `servantRoles` has been through allRoles, which fills in a slug for
        // a Role stored without one — so the session would believe the slug
        // was stored and never write it, and the Role's slug would go on
        // following its name.
        const stored = this.roleDefinitions.find(def => def.id === role.id) || role;
        this.draft = RoleEditorCore.draftFrom(stored);
        this.draftId = stored.id;
        this.openSession(stored);
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

    // Leaving the open Role: what was waiting is sent, then the pane is empty.
    closeRole() {
        const sent = this.endSession();
        this.draft = null;
        this.draftId = null;
        return sent;
    },

    // ── A Role saves itself (MS-721, ADR 0081) ──────────────────────────────
    //
    // No Save or Cancel. Every change — name, description, rest, doubling up,
    // a slot, a rule — saves 1.5 s after the last one (blur and Enter at
    // once), only the fields that changed, with update(). The chip says where
    // it is; an invalid Role does not save and lists its problems; a refused
    // save says Not saved with a Retry, and the next change retries. Another
    // editor's change lands in any field this editor is not changing.
    //
    // What is saved, when, and from which values is RoleEditorCore's session.
    // This page only opens one per Role, hands it the draft, and draws what it
    // says. `liveSerial` names the session that is current: a callback from
    // one that has been left (a save landing late, a snapshot in flight)
    // checks it and does nothing to the Role on screen.

    liveRole: null,
    liveSerial: 0,
    // The values last handed to the session, so a field the form has changed
    // since is never overwritten by what the session hands back.
    liveHanded: null,
    stopRoleWatch: null,
    roleChip: 'saved',
    roleError: '',

    roleChipText(status) {
        return window.LiveFields ? window.LiveFields.chipText(status) : '';
    },

    openSession(role) {
        if (!this.canManageRoles || !role || !role.id) return;
        const serial = ++this.liveSerial;
        const id = role.id;
        const current = () => this.liveSerial === serial;
        this.liveHanded = JSON.parse(JSON.stringify(this.draft));
        this.liveRole = RoleEditorCore.openSession({
            role,
            store: { update: (docId, patch) => db.collection('roles').doc(docId).update(patch) },
            onState: (st) => { if (current()) this.showSessionState(st); },
            // Keyed by id, so a save that lands after its Role was left still
            // puts the list right — and only that Role's row.
            onSaved: (docId, write) => {
                this.roleDefinitions = RoleEditorCore.withStored(this.roleDefinitions, docId, write);
            },
            onFailed: (docId, e) => {
                const why = (e && e.message) || 'that change could not be saved';
                const left = (this.roleDefinitions.find(d => d.id === docId) || {}).name;
                this.showToast(current() || !left ? 'Not saved — ' + why : `"${left}" was not saved — ${why}`, 'error');
            },
        });
        const Live = window.MosaicLiveRead;
        if (Live && typeof db !== 'undefined' && db && typeof db.collection === 'function') {
            try {
                this.stopRoleWatch = Live.watch(db.collection('roles').doc(id), (snap) => {
                    if (!current() || !this.liveRole || !snap || !snap.exists) return;
                    const data = snap.data() || {};
                    const pending = !!(snap.metadata && snap.metadata.hasPendingWrites);
                    if (!pending) this.roleDefinitions = RoleEditorCore.withStored(this.roleDefinitions, id, data);
                    this.liveRole.remote(data, { pendingWrites: pending });
                }, { onError: (e) => console.warn('This Role is not live:', e) });
            } catch (e) {
                console.warn('This Role is not live:', e);
            }
        }
    },

    // The session's word on the open Role. A field the session settled
    // differently (a save trimmed it, another editor changed it) is taken
    // into the form — unless the form has changed that field since it last
    // handed it over, in which case the form is newer and wins.
    showSessionState(st) {
        if (this.draft && this.draftId === st.id) {
            const handed = this.liveHanded || {};
            const text = v => JSON.stringify(v === undefined ? null : v);
            Object.keys(st.values).forEach(f => {
                if (text(this.draft[f]) !== text(handed[f])) return;
                if (text(this.draft[f]) === text(st.values[f])) return;
                const v = st.values[f];
                this.draft[f] = v == null || typeof v !== 'object' ? v : JSON.parse(JSON.stringify(v));
                handed[f] = this.draft[f];
            });
        }
        this.roleChip = st.status;
        this.roleError = st.error;
        this.saveAttempted = st.showProblems;
    },

    // Called by the Alpine $watch on `draft` and before any flush, so a change
    // made by a slot or rule helper (which replace `draft`) is seen too.
    syncLiveRole() {
        if (!this.liveRole || !this.draft) return;
        const values = JSON.parse(JSON.stringify(this.draft));
        this.liveHanded = values;
        this.liveRole.edit(this.draftId, JSON.parse(JSON.stringify(values)));
    },

    revertRole(field) {
        if (this.liveRole) this.liveRole.revert(field);
    },

    // Ends the open Role's session: sends what is waiting (or, with
    // `discard`, drops it), stops the listener, and resets the chip. Returns
    // the send, so a caller that needs it landed can wait for it.
    endSession({ discard = false } = {}) {
        this.liveSerial++;
        if (this.stopRoleWatch) { this.stopRoleWatch(); this.stopRoleWatch = null; }
        let sent = Promise.resolve(true);
        if (this.liveRole) {
            if (discard) {
                this.liveRole.discard();
            } else {
                this.syncLiveRole();
                sent = this.liveRole.close();
            }
            this.liveRole = null;
        }
        this.liveHanded = null;
        this.roleChip = 'saved';
        this.roleError = '';
        this.saveAttempted = false;
        return sent;
    },


    async deleteRole(role) {
        if (!role || !this.canManageRoles) return;
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
        // A Role being deleted drops what it was waiting to save: sent after
        // the delete, it would fail on a document that is gone and say so.
        const wasOpen = this.draftId === role.id;
        if (wasOpen) this.endSession({ discard: true });
        try {
            await db.collection('roles').doc(role.id).delete();
            this.roleDefinitions = this.roleDefinitions.filter(def => def.id !== role.id);
            if (wasOpen) this.closeRole();
            this.showToast(`Role "${role.name}" deleted`);
        } catch (e) {
            console.error('Error deleting Role:', e);
            this.showToast('Error deleting Role', 'error');
            await this.loadRoleDefinitions();
            // Still there, so open it again as it is stored.
            const still = wasOpen && this.roleDefinitions.find(def => def.id === role.id);
            if (still) this.startEdit(still);
        }
    },



    // The cap the model enforces, so the box and the refusal agree (MS-222).
    get descriptionLimit() { return RolesCore.MAX_DESCRIPTION; },

    get descriptionLeft() {
        const written = ((this.draft && this.draft.description) || '').trim().length;
        return RolesCore.MAX_DESCRIPTION - written;
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

    // ── Doesn't serve, for a whole tag or group (ADR 0086) ──────────────────
    //
    // Editors may mark a whole tag or group, but only from the tags they can
    // see and the groups an elder has shared with editors: the pickers offer
    // nothing else, so marking one never names something hidden from them.

    nsKind: 'person',
    nonServing: { tagIds: [], groupIds: [] },
    servingTags: [],
    servingGroups: [],
    savingNonServing: false,

    async loadNonServing() {
        const where = RolesCore.NON_SERVING_DOC;
        try {
            const [doc, tags, groups] = await Promise.all([
                db.collection(where.collection).doc(where.id).get(),
                db.collection('people_tags').orderBy('name', 'asc').get(),
                db.collection('relationship_groups').where('sharedWithEditors', '==', true).get()
                    .catch(() => ({ docs: [] })),
            ]);
            this.nonServing = RolesCore.nonServingSetting(doc.exists ? doc.data() : null);
            const all = tags.docs.map(d => ({
                id: d.id, name: d.data().name || d.id, hiddenFromOthers: d.data().hiddenFromOthers === true,
            }));
            this.servingTags = RolesCore.visibleTags(all, this.account || this.currentPermissionLevel)
                .map(t => ({ id: t.id, name: t.name }));
            this.servingGroups = groups.docs.map(d => Object.assign({ id: d.id }, d.data()));
        } catch (e) {
            console.error('Could not read who does not serve:', e);
        }
    },

    // The tags and groups marked, as rows. One the viewer cannot see (hidden
    // since, or a group no longer shared) still shows — unnamed — so it can be
    // taken off rather than lingering unseen.
    get nonServingEntries() {
        const tags = this.nonServing.tagIds.map(id => {
            const tag = this.servingTags.find(t => t.id === id);
            return { kind: 'tag', id: id, name: tag ? tag.name : 'A tag you cannot see' };
        });
        const groups = this.nonServing.groupIds.map(id => {
            const group = this.servingGroups.find(g => g.id === id);
            return { kind: 'group', id: id, name: group ? (group.name || 'A group') : 'A group you cannot see' };
        });
        return tags.concat(groups).map(entry => Object.assign(entry, {
            count: RolesCore.coveredByNonServing(this.people, entry, this.servingGroups).length,
        }));
    },

    // Everybody no rota offers, once each: their own mark, a tag, or a group.
    get nonServingCount() {
        const ids = RolesCore.nonServingIds(this.people, this.nonServing, this.servingGroups);
        this.nonServers.forEach(p => ids.add(p.id));
        return ids.size;
    },

    get nsOptions() {
        if (this.nsKind === 'tag') return this.servingTags.filter(t => this.nonServing.tagIds.indexOf(t.id) === -1);
        if (this.nsKind === 'group') {
            return this.servingGroups.filter(g => this.nonServing.groupIds.indexOf(g.id) === -1)
                .map(g => ({ id: g.id, name: g.name || g.id }));
        }
        return [];
    },

    async setNonServing(kind, id, on) {
        if (!id || this.savingNonServing || !this.canSetDoesNotServe) return;
        const field = kind === 'group' ? 'groupIds' : 'tagIds';
        const list = this.nonServing[field].filter(x => x !== id).concat(on ? [id] : []);
        const next = Object.assign({}, this.nonServing, { [field]: list });
        const where = RolesCore.NON_SERVING_DOC;
        this.savingNonServing = true;
        try {
            await db.collection(where.collection).doc(where.id).set({
                doesNotServeTagIds: next.tagIds,
                doesNotServeGroupIds: next.groupIds,
            }, { merge: true });
            this.nonServing = next;
            if (window.NonServing) window.NonServing.forget();
        } catch (e) {
            console.error('Could not save that:', e);
            this.showToast('Could not save that — nothing was changed', 'error');
        } finally {
            this.savingNonServing = false;
        }
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
        if (!personId || this.savingNonServer || !this.canSetDoesNotServe) return;
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


    // ── What is wrong with the draft ─────────────────────────────────────────

    // Every problem at once, so the editor fixes them together rather than one
    // save at a time. The same check the session refuses a save by.
    get draftErrors() {
        return RoleEditorCore.errorsFor(this.draft);
    },

    // Retry, and blur/Enter: send what is waiting now.
    saveDraft() {
        if (!this.liveRole || !this.canManageRoles) return Promise.resolve(false);
        this.syncLiveRole();
        return this.liveRole.flush();
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
