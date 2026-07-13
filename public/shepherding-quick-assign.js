// Profile quick-assign (MS-104, ADR-0014 s3/s4).
//
// The Shepherding Profile's relationship card used to be where a Relationship Type
// was BORN — an elder free-typed a name and a direction and a type appeared. Once a
// type became a real kind × priority structure, a text box could no longer express
// one, and minting vocabulary from every profile made it impossible to curate. So
// the card is demoted: it now only APPLIES what the manager has already defined.
//
// It can:
//   • slot this Person into an existing Pairwise type, choosing which side they hold
//   • join them to an existing Relationship Group, as a member or as its leader
//     (only when the type is Prioritized and the leader seat is vacant)
//   • add a Family relation — spouse, parent, child — by WRITE-THROUGH to the
//     `families` collection, never as an edge in `relationships`
//   • remove any of this Person's own relationships
//
// It cannot create a Relationship Type or a named Relationship Group. That lives in
// Manage Tags and Relationships, and only there.
//
// Mixed into the shepherdingProfile Alpine component. Compose with
// withQuickAssign, NOT object spread — spread evaluates getters and would freeze
// them at their page-load values.

window.withQuickAssign = (component) =>
    Object.defineProperties(component, Object.getOwnPropertyDescriptors(window.QuickAssign()));

window.QuickAssign = () => ({

    relGroups: [],  // Relationship Groups (ADR-0014) — loaded alongside the edges.

    // The card opens onto one of three sources of vocabulary. Nothing is created.
    qaMode: null,   // null | 'pairwise' | 'group' | 'family'
    qaForm: {
        typeId: '',      // pairwise: which type
        side: 'holder',  // pairwise: which side THIS Person holds
        groupId: '',     // group: which named group to join
        asLeader: false, // group: take the vacant leader seat
        familyKind: 'spouse',
        otherId: '',
        otherName: '',
    },

    // ── The vocabulary this card may apply (defined elsewhere, never here) ────

    get qaPairwiseTypes() {
        return this.relationshipTypes
            .map(t => RelationshipCore.normalizeType(t))
            .filter(t => t.kind === 'pairwise')
            .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    },

    // Groups this Person is not already in — you cannot join twice.
    get qaJoinableGroups() {
        return this.relGroups
            .filter(g => !RelationshipGroupCore.belongsTo(g, this.personId))
            .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    },

    get qaSelectedType() {
        return this.qaPairwiseTypes.find(t => t.id === this.qaForm.typeId) || null;
    },

    get qaSelectedGroup() {
        return this.relGroups.find(g => g.id === this.qaForm.groupId) || null;
    },

    // The leader seat can only be taken on a Prioritized group that has none.
    get qaLeaderSeatOpen() {
        const g = this.qaSelectedGroup;
        if (!g) return false;
        const type = this.relTypeById(g.typeId);
        return !!(type && RelationshipCore.normalizeType(type).priority && !g.leaderId);
    },

    // How the pairwise relationship being built will read, live.
    get qaPreview() {
        const type = this.qaSelectedType;
        if (!type) return '';
        const me = (this.person && this.person.name) || 'This person';
        const them = this.qaForm.otherName.trim() || 'the other person';
        if (!type.priority) return `${me} ↔ ${them} — ${RelationshipCore.labelForSide(type, 'peer')}`;
        // fromId is always the priority holder, so the sentence orders by side.
        return this.qaForm.side === 'holder'
            ? RelationshipCore.orientedSentence(type, me, them)
            : RelationshipCore.orientedSentence(type, them, me);
    },

    // ── The rows on the card ──────────────────────────────────────────────────
    // Family (projected from `families`), Pairwise edges, and Group memberships.
    // Every row except a sibling can be removed from here.

    get qaGroupRows() {
        return RelationshipGroupCore.groupsForPerson(this.relGroups, this.personId).map(g => {
            const type = RelationshipCore.normalizeType(this.relTypeById(g.typeId));
            const leading = RelationshipGroupCore.isLeader(g, this.personId);
            return {
                key: 'grp:' + g.id,
                group: g,
                groupName: g.name,
                typeName: type ? type.name : '(type)',
                roleLabel: RelationshipCore.labelForSide(type, leading ? 'leader' : 'member') || (leading ? 'Leader' : 'Member'),
                leading,
                size: RelationshipGroupCore.rosterIds(g).length,
            };
        });
    },

    // Every relationship on this profile, from this Person's viewpoint. Three
    // sources share the panel (ADR-0014):
    //
    //   family   — Projected from `families`. Still derived at render time, never
    //              stored as an edge — but since MS-104 it is AUTHORABLE here by
    //              write-through, so spouse/parent/child rows now carry a remove.
    //              Siblings remain read-only: they are emergent from the roster,
    //              not a link this Person holds.
    //   pairwise — the elder-authored `relationships` edges.
    //   group    — this Person's Relationship Group memberships.
    get personRelationships() {
        const family = FamilyCore.familyRelations(this.families, this.personId, id => this.relPersonSex(id))
            .filter(r => !!this.allPeople.find(p => p.id === r.otherId))
            .map(r => ({
                key: 'fam:' + r.kind + ':' + r.otherId,
                source: 'family',
                familyKind: r.kind,
                otherId: r.otherId,
                typeName: r.label,
                label: r.label,
                prioritized: false,
                sentence: null,
                // A sibling is emergent from the family roster, not a link this
                // Person holds — there is nothing here to remove.
                removable: r.kind !== 'sibling',
            }));

        const pairwise = RelationshipCore.edgesForPerson(this.relationships, this.personId).map(edge => {
            const type = this.relTypeById(edge.typeId);
            const desc = RelationshipCore.describeRelationship(edge, type, this.personId, id => this.relPersonName(id));
            return { key: 'rel:' + edge.id, source: 'pairwise', edge, ...desc, removable: true };
        }).filter(Boolean);

        const groups = this.qaGroupRows.map(g => ({
            key: g.key,
            source: 'group',
            group: g.group,
            groupName: g.groupName,
            typeName: g.typeName,
            roleLabel: g.roleLabel,
            leading: g.leading,
            size: g.size,
            removable: true,
        }));

        return family.concat(pairwise, groups);
    },

    // ── Applying existing vocabulary ──────────────────────────────────────────

    qaOpen(mode) {
        this.qaMode = mode;
        this.qaForm = {
            typeId: '', side: 'holder', groupId: '', asLeader: false,
            familyKind: 'spouse', otherId: '', otherName: '',
        };
    },

    qaClose() { this.qaMode = null; },

    get qaCandidates() {
        const q = (this.qaForm.otherName || '').toLowerCase().trim();
        return this.allPeople
            .filter(p => p.id !== this.personId && (!q || p.name.toLowerCase().includes(q)))
            .slice(0, 8);
    },

    qaPickPerson(p) {
        this.qaForm.otherId = p.id;
        this.qaForm.otherName = p.name;
    },

    // Apply an existing Pairwise type. `fromId` is the priority holder (ADR-0014
    // s2), so the chosen side decides which end this Person occupies.
    async qaAddPairwise() {
        const type = this.qaSelectedType;
        const otherId = this.qaForm.otherId;
        if (!type || !otherId) {
            this.showToast('Pick a relationship type and a person', 'error');
            return;
        }
        const iAmHolder = !type.priority || this.qaForm.side === 'holder';
        const fromId = iAmHolder ? this.personId : otherId;
        const toId = iAmHolder ? otherId : this.personId;

        const duplicate = this.relationships.some(r =>
            r.typeId === type.id && (
                (r.fromId === fromId && r.toId === toId) ||
                (!type.priority && r.fromId === toId && r.toId === fromId)
            ));
        if (duplicate) {
            this.showToast('That relationship already exists', 'error');
            return;
        }

        try {
            const edge = { fromId, toId, typeId: type.id, createdAt: firebase.firestore.FieldValue.serverTimestamp() };
            const ref = await db.collection('relationships').add(edge);
            this.relationships.push({ id: ref.id, ...edge });
            this.qaClose();
            this.showToast('Relationship added');
        } catch (e) {
            console.error('Error adding relationship:', e);
            this.showToast('Error adding relationship', 'error');
        }
    },

    // Join an existing Relationship Group. Never creates one.
    async qaJoinGroup() {
        const group = this.qaSelectedGroup;
        if (!group) {
            this.showToast('Pick a group to join', 'error');
            return;
        }
        const takeLeader = this.qaForm.asLeader && this.qaLeaderSeatOpen;
        const next = takeLeader
            ? RelationshipGroupCore.setLeader(group, this.personId)
            : RelationshipGroupCore.addMember(group, this.personId);
        try {
            await db.collection('relationship_groups').doc(group.id).update({
                leaderId: next.leaderId, memberIds: next.memberIds,
            });
            this.relGroups = this.relGroups.map(g => g.id === group.id ? next : g);
            this.qaClose();
            this.showToast(`Joined "${group.name}"`);
        } catch (e) {
            console.error('Error joining group:', e);
            this.showToast('Error joining group', 'error');
        }
    },

    async qaLeaveGroup(row) {
        if (!confirm(`Remove ${this.person.name} from "${row.groupName}"?`)) return;
        const next = row.leading
            ? RelationshipGroupCore.clearLeader(row.group)
            : RelationshipGroupCore.removeMember(row.group, this.personId);
        try {
            await db.collection('relationship_groups').doc(row.group.id).update({
                leaderId: next.leaderId, memberIds: next.memberIds,
            });
            this.relGroups = this.relGroups.map(g => g.id === row.group.id ? next : g);
            this.showToast('Removed from group');
        } catch (e) {
            console.error('Error leaving group:', e);
            this.showToast('Error leaving group', 'error');
        }
    },

    // ── Family, by write-through (ADR-0014 s4) ────────────────────────────────
    // Adding or removing Family here changes the `families` record — the single
    // source of truth — and never writes a parallel edge. So the Family rows on
    // this card stay a projection of `families`, exactly as before; they are just
    // authorable now.

    async qaAddFamily() {
        const { familyKind, otherId } = this.qaForm;
        if (!otherId) {
            this.showToast('Pick a person', 'error');
            return;
        }
        const plan = FamilyCore.planAddFamilyRelation(
            this.families, this.personId, familyKind, otherId,
            id => this.allPeople.find(p => p.id === id) || null);

        if (!plan.valid) {
            this.showToast(plan.errors[0], 'error');
            return;
        }
        try {
            if (plan.action === 'create') {
                const ref = await db.collection('families').add(plan.changes);
                this.families.push({ id: ref.id, childIds: [], ...plan.changes });
            } else {
                await db.collection('families').doc(plan.familyId).update(plan.changes);
                this.families = this.families.map(f =>
                    f.id === plan.familyId ? { ...f, ...plan.changes } : f);
            }
            this.qaClose();
            this.showToast('Family updated');
        } catch (e) {
            console.error('Error updating family:', e);
            this.showToast('Error updating family', 'error');
        }
    },

    // A Family removal is scoped to one individual's membership. Spouse ends the
    // pairing for both (it is one mutual field). Removing a PARENT pulls this
    // Person out of their family of origin — which necessarily costs them the other
    // parent and their siblings too, since a Family seats exactly one father and one
    // mother. That collateral is spelled out before anything is written.
    async qaRemoveFamily(row) {
        const plan = FamilyCore.planRemoveFamilyRelation(
            this.families, this.personId, row.familyKind, row.otherId);

        if (!plan.valid) {
            this.showToast(plan.errors[0], 'error');
            return;
        }

        let message = `Remove ${this.relPersonName(row.otherId)} as ${this.person.name}'s ${row.label.toLowerCase()}?`;
        if (row.familyKind === 'spouse') {
            message += ' This ends the marriage record for both of them.';
        }
        if (row.familyKind === 'parent') {
            const also = plan.alsoDetaches || { parentIds: [], siblingIds: [] };
            const lost = also.parentIds.filter(id => id !== row.otherId).map(id => this.relPersonName(id))
                .concat(also.siblingIds.map(id => this.relPersonName(id)));
            message = `Remove ${this.person.name} from that family?`;
            if (lost.length) {
                message += ` A family has one father and one mother, so ${this.person.name} leaves it entirely — they will also no longer show ${lost.join(', ')}. Everyone else keeps their place.`;
            }
        }
        if (!confirm(message)) return;

        try {
            await db.collection('families').doc(plan.familyId).update(plan.changes);
            this.families = this.families.map(f =>
                f.id === plan.familyId ? { ...f, ...plan.changes } : f);
            this.showToast('Family updated');
        } catch (e) {
            console.error('Error updating family:', e);
            this.showToast('Error updating family', 'error');
        }
    },
});
