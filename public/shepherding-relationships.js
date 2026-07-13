// The Relationships tab of "Manage Tags and Relationships" (MS-103, ADR-0014).
//
// This is the ONE home where relationship vocabulary is defined. An elder creates
// Relationship Types here — the kind x priority structures — and manages who holds
// them: the pairs of a Pairwise type, or the named Relationship Groups of a Group
// type, with their leaders and rosters. The Shepherding Profile's quick-assign card
// can only apply what is defined here; it can never mint a new type or a new group.
//
// Mixed into the shepherdingTags Alpine component (the two tabs share a page), so
// this file exposes a factory rather than registering its own component. All the
// model logic lives in RelationshipCore / RelationshipGroupCore — this layer only
// loads, writes, and confirms.

// Fold this tab into the Tags component that owns the page.
//
// This must NOT be done with object spread. `{ ...RelationshipsTab() }` *evaluates*
// every getter and copies the resulting value — so `selectedType` and
// `pickerOptions` would be frozen at whatever they returned on page load (null and
// []), and never recompute. Copying the property descriptors keeps them live.
window.withRelationshipsTab = (component) =>
    Object.defineProperties(component, Object.getOwnPropertyDescriptors(window.RelationshipsTab()));

window.RelationshipsTab = () => ({
    // Vocabulary and instances.
    relTypes: [],
    relPairs: [],   // Pairwise Relationships: { id, fromId, toId, typeId }
    relGroups: [],  // Relationship Groups:   { id, typeId, name, leaderId, memberIds }
    relPeople: [],  // Person roster, for the pickers.

    selectedTypeId: null,

    // The New Relationship Type form. `kind` is fixed at creation (ADR-0014 s1),
    // so it is only editable here.
    typeForm: {
        name: '', kind: 'pairwise', priority: false,
        holderLabel: '', counterpartLabel: '',
        leaderLabel: '', memberLabel: '',
        label: '',
    },
    showTypeForm: false,
    editingTypeId: null,

    pairForm: { holderId: null, holderName: '', counterpartId: null, counterpartName: '' },
    groupForm: { name: '' },

    // One person picker is open at a time. `open` names the slot it is filling:
    // 'holder' | 'counterpart' for the pair-add row, or a group id for a roster.
    // `index` is the keyboard-highlighted option.
    picker: { open: null, query: '', index: 0 },

    relError: '',

    async loadRelationshipsTab() {
        // This tab owns its own failures. It is one half of a shared page, and a
        // Firestore error here (most likely `relationship_groups` before its rule
        // is deployed) must not take the Tags tab down with it.
        try {
            const [typesSnap, pairsSnap, groupsSnap, peopleSnap] = await Promise.all([
                db.collection('relationship_types').get(),
                db.collection('relationships').get(),
                db.collection('relationship_groups').get(),
                db.collection('people').orderBy('name', 'asc').get(),
            ]);
            // Legacy `directional` docs are normalized on read, so the tab works
            // before the MS-102 backfill has run (ADR-0014 s6).
            this.relTypes = typesSnap.docs
                .map(d => RelationshipCore.normalizeType({ id: d.id, ...d.data() }))
                .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
            this.relPairs = pairsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
            this.relGroups = groupsSnap.docs.map(d => ({
                id: d.id, leaderId: null, memberIds: [], ...d.data(),
            }));
            this.relPeople = peopleSnap.docs.map(d => ({ id: d.id, name: d.data().name || d.id }));
            this.relError = '';
        } catch (e) {
            console.error('Error loading relationships:', e);
            this.relError = (e && e.code === 'permission-denied')
                ? 'Relationships could not load: this account lacks permission, or the relationship_groups rule has not been deployed yet.'
                : 'Relationships could not load.';
        }
    },

    // ── Reading the model ─────────────────────────────────────────────────────

    personName(id) {
        const p = this.relPeople.find(p => p.id === id);
        return p ? p.name : '(unknown)';
    },

    get selectedType() {
        return this.relTypes.find(t => t.id === this.selectedTypeId) || null;
    },

    // The label a Person on `side` of this type reads as — "Discipler", "Leader",
    // or the single symmetric Label. Used to name the form slots and roster chips.
    labelFor(type, side) {
        return RelationshipCore.labelForSide(type, side) || 'Person';
    },

    // ── Display helpers (pure formatting; no behaviour) ───────────────────────

    kindLabel(type) { return type && type.kind === 'group' ? 'Group' : 'Pairwise'; },
    kindIcon(type) { return type && type.kind === 'group' ? 'groups' : 'swap_horiz'; },

    // "Symmetric" is the reader-facing word for Non-Prioritized — shorter, and it
    // says what the elder sees rather than what the field is called.
    priorityLabel(type) { return type && type.priority ? 'Prioritized' : 'Symmetric'; },
    priorityIcon(type) { return type && type.priority ? 'trending_flat' : 'sync_alt'; },

    // The uppercase caption naming a slot in the pair-add row.
    roleLabel(type, side) { return this.labelFor(type, side); },

    initials(name) {
        const parts = (name || '').trim().split(/\s+/).filter(Boolean);
        if (!parts.length) return '?';
        return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
    },

    // The live "Reads as" line under the type form. Driven off `typeForm` — the
    // shape being built right now — not off saved data, so it updates as you type.
    previewSentence(form) {
        const holder = this.labelFor(form, 'holder');
        const counterpart = this.labelFor(form, 'counterpart');
        const one = form.label || 'Label';

        if (form.kind === 'group') {
            const members = 'Dana, Ruth and James';
            if (!form.priority) return `${members} — ${form.label || 'Member label'}`;
            return `Stephen (${form.leaderLabel || 'Leader label'}) leads ${members} (${form.memberLabel || 'Member label'})`;
        }
        if (!form.priority) return `Alice ↔ Bob — ${one}`;
        return `Alice (${form.holderLabel || 'Holder label'}) → Bob (${form.counterpartLabel || 'Counterpart label'})`;
    },

    // What the two segmented controls mean, spelled out under them.
    kindHint(form) {
        return form.kind === 'group'
            ? 'A roster of many people around one shared thing — a Bible study, a prayer circle.'
            : 'A connection between exactly two people.';
    },
    priorityHint(form) {
        if (form.kind === 'group') {
            return form.priority
                ? 'One person leads; the rest are members. The leader slot may sit empty.'
                : 'A flat roster. Nobody leads it.';
        }
        return form.priority
            ? 'One side holds priority, and each side gets its own name (Discipler / Disciplee).'
            : 'Both sides are equal and share one name (Friend).';
    },

    // Just the role names, for the serif line under a type row. Kind and priority
    // are already carried by the badges beside it, so this must not repeat them
    // (typeSummary, which does say all three, still backs the detail header).
    labelsSummary(type) {
        if (!type.priority) return type.label || '—';
        const [a, b] = RelationshipCore.sidesForType(type);
        return `${this.labelFor(type, a)} / ${this.labelFor(type, b)}`;
    },

    // How many people hold a type — the count under each row in the list.
    countLabel(type) {
        const n = this.instanceCount(type.id);
        if (type.kind === 'group') return `${n} group${n === 1 ? '' : 's'}`;
        return `${n} pair${n === 1 ? '' : 's'}`;
    },

    // ── The person picker (one open at a time, keyboard-navigable) ────────────

    openPicker(which) {
        this.picker = { open: which, query: '', index: 0 };
    },

    closePicker() {
        this.picker = { open: null, query: '', index: 0 };
    },

    // The options for whichever picker is currently open. Each slot excludes the
    // people who cannot legally fill it — the other end of the pair, or anyone who
    // already holds a slot in the group.
    get pickerOptions() {
        const which = this.picker.open;
        if (!which) return [];
        if (which === 'holder') return this.personCandidates(this.picker.query, [this.pairForm.counterpartId]);
        if (which === 'counterpart') return this.personCandidates(this.picker.query, [this.pairForm.holderId]);
        const group = this.relGroups.find(g => g.id === which);
        if (!group) return [];
        return this.personCandidates(this.picker.query, [group.leaderId, ...group.memberIds]);
    },

    pickerMove(delta) {
        const n = this.pickerOptions.length;
        if (!n) return;
        this.picker.index = (this.picker.index + delta + n) % n;
    },

    // Enter takes the highlighted option.
    pickerChooseHighlighted() {
        const opt = this.pickerOptions[this.picker.index];
        if (opt) this.choosePerson(opt);
    },

    // Route the chosen Person to whichever slot asked for them.
    choosePerson(person) {
        const which = this.picker.open;
        if (which === 'holder' || which === 'counterpart') {
            this.pickPairPerson(which, person);
            this.closePicker();
            return;
        }
        const group = this.relGroups.find(g => g.id === which);
        this.closePicker();
        if (group) this.addGroupMember(group, person);
    },

    dismissError() { this.relError = ''; },

    // "Pairwise · Prioritized (Discipler / Disciplee)"
    typeSummary(type) {
        const kind = type.kind === 'group' ? 'Group' : 'Pairwise';
        if (!type.priority) return `${kind} · Non-Prioritized (${type.label || '—'})`;
        const [a, b] = RelationshipCore.sidesForType(type);
        return `${kind} · Prioritized (${RelationshipCore.labelForSide(type, a)} / ${RelationshipCore.labelForSide(type, b)})`;
    },

    pairsForType(typeId) {
        return this.relPairs.filter(r => r.typeId === typeId);
    },

    groupsForType(typeId) {
        return this.relGroups.filter(g => g.typeId === typeId);
    },

    // How many instances a type carries — the count shown before a cascading delete.
    instanceCount(typeId) {
        return this.pairsForType(typeId).length + this.groupsForType(typeId).length;
    },

    // Candidates for a person picker, excluding anyone already ruled out. The picker
    // is a popover that opens onto a browsable roster, so an empty query offers
    // everyone rather than nobody; typing narrows it.
    personCandidates(query, excludeIds = []) {
        const q = (query || '').toLowerCase().trim();
        return this.relPeople
            .filter(p => !excludeIds.includes(p.id) && (!q || p.name.toLowerCase().includes(q)))
            .slice(0, 50);
    },

    // ── Relationship Types ────────────────────────────────────────────────────

    resetTypeForm() {
        this.typeForm = {
            name: '', kind: 'pairwise', priority: false,
            holderLabel: '', counterpartLabel: '',
            leaderLabel: '', memberLabel: '',
            label: '',
        };
        this.editingTypeId = null;
        this.showTypeForm = false;
    },

    startNewType() {
        this.resetTypeForm();
        this.showTypeForm = true;
    },

    startEditType(type) {
        this.typeForm = {
            name: type.name || '',
            kind: type.kind,
            priority: !!type.priority,
            holderLabel: type.holderLabel || '',
            counterpartLabel: type.counterpartLabel || '',
            leaderLabel: type.leaderLabel || '',
            memberLabel: type.memberLabel || '',
            label: type.label || '',
        };
        this.editingTypeId = type.id;
        this.showTypeForm = true;
    },

    async saveType() {
        const existing = this.editingTypeId ? this.relTypes.find(t => t.id === this.editingTypeId) : null;
        // An edit may not change the kind — flipping it would orphan every instance.
        const check = existing
            ? RelationshipCore.validateEdit(existing, this.typeForm)
            : RelationshipCore.validateType(this.typeForm);
        if (!check.valid) {
            this.showToast(check.errors[0], 'error');
            return;
        }
        // Store only the label fields this shape uses, so a Prioritized type edited
        // down to Non-Prioritized doesn't leave its old role labels lying in the doc.
        const doc = RelationshipCore.canonicalType({ ...(existing || {}), ...this.typeForm });
        delete doc.id;

        try {
            if (existing) {
                await db.collection('relationship_types').doc(existing.id).set(doc);
                this.relTypes = this.relTypes
                    .map(t => t.id === existing.id ? { id: existing.id, ...doc } : t)
                    .sort((a, b) => a.name.localeCompare(b.name));
                this.showToast(`Relationship Type "${doc.name}" updated`);
            } else {
                const ref = await db.collection('relationship_types').add(doc);
                this.relTypes = this.relTypes
                    .concat([{ id: ref.id, ...doc }])
                    .sort((a, b) => a.name.localeCompare(b.name));
                this.showToast(`Relationship Type "${doc.name}" created`);
            }
            this.resetTypeForm();
        } catch (e) {
            console.error('Error saving Relationship Type:', e);
            this.showToast('Error saving Relationship Type', 'error');
        }
    },

    // Deleting a type in use cascades — so it says how much it will take with it
    // before the elder confirms (ADR-0014 s7).
    async deleteType(type) {
        const pairs = this.pairsForType(type.id);
        const groups = this.groupsForType(type.id);
        const parts = [];
        if (pairs.length) parts.push(`${pairs.length} relationship${pairs.length === 1 ? '' : 's'}`);
        if (groups.length) parts.push(`${groups.length} group${groups.length === 1 ? '' : 's'}`);
        const tail = parts.length ? ` This also removes ${parts.join(' and ')}.` : '';
        if (!confirm(`Delete the Relationship Type "${type.name}"?${tail}`)) return;

        try {
            const batch = db.batch();
            pairs.forEach(p => batch.delete(db.collection('relationships').doc(p.id)));
            groups.forEach(g => batch.delete(db.collection('relationship_groups').doc(g.id)));
            batch.delete(db.collection('relationship_types').doc(type.id));
            await batch.commit();

            this.relPairs = this.relPairs.filter(p => p.typeId !== type.id);
            this.relGroups = this.relGroups.filter(g => g.typeId !== type.id);
            this.relTypes = this.relTypes.filter(t => t.id !== type.id);
            if (this.selectedTypeId === type.id) this.selectedTypeId = null;
            this.showToast(`Relationship Type "${type.name}" deleted`);
        } catch (e) {
            console.error('Error deleting Relationship Type:', e);
            this.showToast('Error deleting Relationship Type', 'error');
        }
    },

    selectType(type) {
        this.selectedTypeId = this.selectedTypeId === type.id ? null : type.id;
        this.showTypeForm = false; // the detail pane and the form share the right column
        this.pairForm = { holderId: null, holderName: '', counterpartId: null, counterpartName: '' };
        this.groupForm = { name: '' };
        this.closePicker();
    },

    // ── Pairwise Relationships ────────────────────────────────────────────────

    // For a Prioritized type, fromId is the priority holder (ADR-0014 s2) — the
    // form's two slots are Holder and Counterpart. For a Non-Prioritized type the
    // two sides are peers and the order carries no meaning.
    pickPairPerson(slot, person) {
        if (slot === 'holder') {
            this.pairForm.holderId = person.id;
            this.pairForm.holderName = person.name;
        } else {
            this.pairForm.counterpartId = person.id;
            this.pairForm.counterpartName = person.name;
        }
    },

    async addPair() {
        const type = this.selectedType;
        const { holderId, counterpartId } = this.pairForm;
        if (!type || !holderId || !counterpartId) return;
        if (holderId === counterpartId) {
            this.showToast('A relationship needs two different people', 'error');
            return;
        }
        const duplicate = this.pairsForType(type.id).some(p =>
            (p.fromId === holderId && p.toId === counterpartId) ||
            (!type.priority && p.fromId === counterpartId && p.toId === holderId)
        );
        if (duplicate) {
            this.showToast('That relationship already exists', 'error');
            return;
        }
        try {
            const edge = { fromId: holderId, toId: counterpartId, typeId: type.id };
            const ref = await db.collection('relationships').add(edge);
            this.relPairs = this.relPairs.concat([{ id: ref.id, ...edge }]);
            this.pairForm = { holderId: null, holderName: '', counterpartId: null, counterpartName: '' };
            this.showToast('Relationship added');
        } catch (e) {
            console.error('Error adding relationship:', e);
            this.showToast('Error adding relationship', 'error');
        }
    },

    async removePair(pair) {
        if (!confirm(`Remove ${this.personName(pair.fromId)} — ${this.personName(pair.toId)}?`)) return;
        try {
            await db.collection('relationships').doc(pair.id).delete();
            this.relPairs = this.relPairs.filter(p => p.id !== pair.id);
            this.showToast('Relationship removed');
        } catch (e) {
            console.error('Error removing relationship:', e);
            this.showToast('Error removing relationship', 'error');
        }
    },

    // How a pair reads in the list, from the holder's side out.
    pairSentence(pair, type) {
        return RelationshipCore.orientedSentence(type, this.personName(pair.fromId), this.personName(pair.toId))
            || `${this.personName(pair.fromId)} — ${this.personName(pair.toId)}`;
    },

    // ── Relationship Groups ───────────────────────────────────────────────────

    async createGroup() {
        const type = this.selectedType;
        const name = (this.groupForm.name || '').trim();
        if (!type || !name) return;
        // A freshly created group is leaderless and empty — both valid (ADR-0014 s2).
        const group = { typeId: type.id, name, leaderId: null, memberIds: [] };
        const check = RelationshipGroupCore.validateGroup(group, type);
        if (!check.valid) {
            this.showToast(check.errors[0], 'error');
            return;
        }
        try {
            const ref = await db.collection('relationship_groups').add(group);
            this.relGroups = this.relGroups.concat([{ id: ref.id, ...group }]);
            this.groupForm = { name: '' };
            this.showToast(`Group "${name}" created`);
        } catch (e) {
            console.error('Error creating group:', e);
            this.showToast('Error creating group', 'error');
        }
    },

    // Every roster change goes through RelationshipGroupCore, then persists the
    // group it returns — so the leader/member invariants hold in one place.
    async writeGroup(next) {
        try {
            await db.collection('relationship_groups').doc(next.id).update({
                leaderId: next.leaderId,
                memberIds: next.memberIds,
            });
            this.relGroups = this.relGroups.map(g => g.id === next.id ? next : g);
        } catch (e) {
            console.error('Error updating group:', e);
            this.showToast('Error updating group', 'error');
        }
    },

    async addGroupMember(group, person) {
        await this.writeGroup(RelationshipGroupCore.addMember(group, person.id));
        this.closePicker();
    },

    async removeGroupMember(group, personId) {
        await this.writeGroup(RelationshipGroupCore.removeMember(group, personId));
    },

    async setGroupLeader(group, personId) {
        await this.writeGroup(RelationshipGroupCore.setLeader(group, personId));
    },

    async clearGroupLeader(group) {
        await this.writeGroup(RelationshipGroupCore.clearLeader(group));
    },

    async deleteGroup(group) {
        if (!confirm(`Delete the group "${group.name}"? Its roster is cleared, but nobody is removed from anything else.`)) return;
        try {
            await db.collection('relationship_groups').doc(group.id).delete();
            this.relGroups = this.relGroups.filter(g => g.id !== group.id);
            this.showToast(`Group "${group.name}" deleted`);
        } catch (e) {
            console.error('Error deleting group:', e);
            this.showToast('Error deleting group', 'error');
        }
    },
});
