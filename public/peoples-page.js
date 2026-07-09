/**
 * @fileoverview Administrative logic for managing people and their involvement.
 */

document.addEventListener('alpine:init', () => {
    const db = firebase.firestore();

    Alpine.data('peoplesPage', () => ({
        people: [],
        isSubmitting: false,
        searchTerm: '',
        // Membership Directory tab: 'members' (carries Member tag) | 'non_members'.
        activeTab: 'members',
        // Edit Mode (ADR-0012): the directory is read-only until an editor turns
        // this on, which reveals the inline People-management affordances. Off by
        // default; a plain member never sees the toggle (gated by canEdit).
        editMode: false,
        sortKey: 'totalInvolvements', // 'name' or 'totalInvolvements'
        sortDirection: 'desc',
        
        // Form data for adding a person
        newPerson: {
            name: '',
            email: '',
            phone: '',
            address: '',
            birthday: '',
            sex: '' // '' or 'male' or 'female'
        },
        
        // Involvement tracking
        selectedPerson: null,
        involvement: [],
        newInvolvement: {
            serviceDate: '',
            type: '',
            prayerType: 'praise',
            prayerText: ''
        },
        
        // UI State
        showAddPersonModal: false,
        showInvolvementModal: false,
        showMergeModal: false,
        mergeSource: null, // The person being retired
        mergeTarget: null, // The person surviving
        allTags: [],
        tagMetadata: {}, // { tagName: { hiddenFromOthers: bool, hidePeople: bool } }
        selectedTags: [],
        currentUserRole: 'viewer',
        // Super-admin debug: when true, the page behaves as if the user were a plain
        // member (see effectiveRole). Never affects what a non-super-admin sees.
        viewAsMember: false,
        // Page content stays hidden until the role check passes, so a viewer who
        // navigates straight to the URL never sees the directory shell flash before
        // the redirect. Only member-or-higher ever flips this true.
        authorized: false,

        async init() {
            auth.onAuthStateChanged(async (user) => {
                if (!user) {
                    window.location.href = 'login.html';
                    return;
                }
                const userData = await getUserData(user.uid);
                this.currentUserRole = (userData && userData.role) || 'viewer';
                this.currentUserUid = user.uid;
                this.currentUserName = (userData && (userData.displayName || userData.name)) || user.email || '';
                if (!['member', 'editor', 'elder', 'admin', 'super_admin'].includes(this.currentUserRole)) {
                    alert('Permission denied.');
                    window.location.href = 'index.html';
                    return;
                }
                this.authorized = true;
                this.loadPeople();
                this.loadTags();
                this.loadFamilies();
            });
        },

        // The real account role — used only to decide who gets the debug toggle.
        // All page gating goes through effectiveRole so "View as Member" is honoured.
        get isSuperAdmin() {
            return this.currentUserRole === 'super_admin';
        },

        // The role the page should behave as. A super admin previewing as a member
        // collapses to 'member'; everyone else is just their real role.
        get effectiveRole() {
            return (this.isSuperAdmin && this.viewAsMember) ? 'member' : this.currentUserRole;
        },

        get isAdmin() {
            return ['elder', 'super_admin'].includes(this.effectiveRole);
        },

        // Members get a read-only view of the directory; editors and above can modify
        // records and see the Tags Manager.
        get canEdit() {
            return ['editor', 'elder', 'admin', 'super_admin'].includes(this.effectiveRole);
        },

        // Super-admin only: flip the page between the real super-admin view and a
        // preview of what a plain member sees. Reloads tags so hidden-from-others
        // visibility matches the previewed role.
        toggleViewAsMember() {
            if (!this.isSuperAdmin) return;
            this.viewAsMember = !this.viewAsMember;
            this.loadTags();
        },

        async loadTags() {
            try {
                const snap = await db.collection('people_tags').get();
                const metadata = {};
                const tags = [];
                
                snap.forEach(doc => {
                    const data = doc.data();
                    const tagName = doc.id;
                    metadata[tagName] = {
                        hiddenFromOthers: data.hiddenFromOthers || false,
                        hidePeople: data.hidePeople || false
                    };
                    
                    if (this.isAdmin || !data.hiddenFromOthers) {
                        tags.push(tagName);
                    }
                });
                
                this.allTags = tags.sort();
                this.tagMetadata = metadata;
            } catch (e) {
                console.error("Error loading tags:", e);
            }
        },

        async toggleTagVisibility(tagName) {
            if (!this.isAdmin) return;
            const current = this.tagMetadata[tagName]?.hiddenFromOthers || false;
            try {
                await db.collection('people_tags').doc(tagName).update({
                    hiddenFromOthers: !current,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                });
                this.tagMetadata[tagName].hiddenFromOthers = !current;
                this.showToast(`Tag "${tagName}" is now ${!current ? 'hidden from others' : 'visible to all'}`);
                await this.loadTags(); // Refresh list to respect visibility for others
            } catch (e) {
                console.error("Error toggling tag visibility:", e);
            }
        },

        async togglePeopleVisibility(tagName) {
            if (!this.isAdmin) return;
            const current = this.tagMetadata[tagName]?.hidePeople || false;
            try {
                await db.collection('people_tags').doc(tagName).update({
                    hidePeople: !current,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                });
                this.tagMetadata[tagName].hidePeople = !current;
                this.showToast(`People with tag "${tagName}" are now ${!current ? 'hidden from directory' : 'visible in directory'}`);
            } catch (e) {
                console.error("Error toggling people visibility:", e);
            }
        },

        async createNewTag(tagName) {
            tagName = tagName.trim();
            if (!tagName) return;
            if (this.allTags.find(t => t.toLowerCase() === tagName.toLowerCase())) {
                this.showToast('Tag already exists', 'error');
                return;
            }

            try {
                await db.collection('people_tags').doc(tagName).set({ name: tagName });
                this.allTags.push(tagName);
                this.allTags.sort();
                this.showToast(`Tag "${tagName}" created`);
            } catch (e) {
                console.error("Error creating tag:", e);
                this.showToast('Error creating tag', 'error');
            }
        },

        toggleTagFilter(tag) {
            if (this.selectedTags.includes(tag)) {
                this.selectedTags = this.selectedTags.filter(t => t !== tag);
            } else {
                this.selectedTags.push(tag);
            }
        },

        async loadPeople() {
            try {
                // We'll fetch all and sort client-side for flexibility with searches and counts
                const snap = await db.collection('people').get();
                this.people = snap.docs.map(doc => ({ 
                    id: doc.id, 
                    totalInvolvements: 0, 
                    contact: {},
                    membership: {},
                    tags: [],
                    ...doc.data() 
                }));
            } catch (error) {
                console.error("Error loading people:", error);
                this.showToast('Error loading people list', 'error');
            }
        },

        // ── Families (ADR-0012, MS-88) ───────────────────────────────────────
        families: [],
        familyChildQuery: '',
        familySpouseQuery: '',

        async loadFamilies() {
            try {
                const snap = await db.collection('families').get();
                this.families = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            } catch (e) {
                console.error('Error loading families:', e);
            }
        },

        personName(id) {
            const p = this.people.find(x => x.id === id);
            return p ? p.name : '(unknown)';
        },

        personSex(id) {
            const p = this.people.find(x => x.id === id);
            return p ? p.sex : null;
        },

        // The resolved relations (ids) for a Person from the family graph.
        relationsFor(person) {
            if (!person) return { spouseId: null, childIds: [], parentIds: [] };
            return FamilyCore.resolveRelations(this.families, person.id);
        },

        // The Family the selected Person is a spouse in (for the modal editor).
        get selectedFamily() {
            if (!this.selectedPerson) return null;
            return FamilyCore.familyOfSpouse(this.families, this.selectedPerson.id);
        },

        // The role the selected Person plays as a spouse, from their sex.
        get selectedSpouseRole() {
            const sex = this.selectedPerson && this.selectedPerson.sex;
            return sex === 'male' ? 'husband' : sex === 'female' ? 'wife' : null;
        },

        // People eligible to be the selected Person's spouse: the opposite sex,
        // not the person themselves, not already a spouse in another family.
        get spouseCandidates() {
            if (!this.selectedPerson || !this.selectedSpouseRole) return [];
            const otherRole = this.selectedSpouseRole === 'husband' ? 'wife' : 'husband';
            const needSex = otherRole === 'husband' ? 'male' : 'female';
            const q = (this.familySpouseQuery || '').toLowerCase();
            return this.people.filter(p =>
                p.id !== this.selectedPerson.id &&
                p.sex === needSex &&
                (!q || p.name.toLowerCase().includes(q)) &&
                !FamilyCore.familyOfSpouse(this.families, p.id)
            ).slice(0, 8);
        },

        get childCandidates() {
            if (!this.selectedPerson) return [];
            const fam = this.selectedFamily;
            const existing = fam ? (fam.childIds || []) : [];
            const q = (this.familyChildQuery || '').toLowerCase();
            return this.people.filter(p =>
                p.id !== this.selectedPerson.id &&
                existing.indexOf(p.id) === -1 &&
                (!q || p.name.toLowerCase().includes(q))
            ).slice(0, 8);
        },

        // Write a change to the selected Person's Family, creating one if needed.
        // The selected Person is anchored into their spousal role by sex.
        async saveFamily(patch) {
            const person = this.selectedPerson;
            if (!person) return;
            if (!this.selectedSpouseRole) {
                this.showToast('Set this person’s sex before building a family', 'error');
                return;
            }
            try {
                let fam = this.selectedFamily;
                if (!fam) {
                    // Create a new family anchoring the selected person in their role.
                    const base = { husbandId: null, wifeId: null, childIds: [], anniversary: null };
                    base[this.selectedSpouseRole === 'husband' ? 'husbandId' : 'wifeId'] = person.id;
                    Object.assign(base, patch);
                    const ref = await db.collection('families').add(base);
                    this.families.push({ id: ref.id, ...base });
                } else {
                    await db.collection('families').doc(fam.id).update(patch);
                    Object.assign(fam, patch);
                }
                this.showToast('Family updated');
            } catch (e) {
                console.error('Error saving family:', e);
                this.showToast('Error saving family', 'error');
            }
        },

        async setSpouse(spouseId) {
            const spouse = this.people.find(p => p.id === spouseId);
            const spouseRole = this.selectedSpouseRole === 'husband' ? 'wife' : 'husband';
            if (!FamilyCore.spouseSexOk(spouse, spouseRole)) {
                this.showToast('Spouse must be the opposite sex', 'error');
                return;
            }
            await this.saveFamily({ [spouseRole === 'husband' ? 'husbandId' : 'wifeId']: spouseId });
            this.familySpouseQuery = '';
        },

        async addChild(childId) {
            const fam = this.selectedFamily;
            const childIds = fam ? [...(fam.childIds || [])] : [];
            if (childIds.indexOf(childId) === -1) childIds.push(childId);
            await this.saveFamily({ childIds });
            this.familyChildQuery = '';
        },

        async removeChild(childId) {
            const fam = this.selectedFamily;
            if (!fam) return;
            const childIds = (fam.childIds || []).filter(c => c !== childId);
            await this.saveFamily({ childIds });
        },

        async setAnniversary(value) {
            await this.saveFamily({ anniversary: value || null });
        },

        // ── Membership Track (ADR-0012) ──────────────────────────────────────
        // The stage slider and Inactive toggle in the person modal. The stage is
        // the source of truth; ShepherdingCore re-projects the Membership Tags and
        // logs one Membership Change per move (silent tag swap). Editors only.

        get membershipStages() { return ShepherdingCore.MEMBERSHIP_STAGES; },

        // The slider index for a Person: their stage's position on the Track, or 0
        // when unset so the thumb has a home. Read alongside membershipInactive.
        membershipIndex(person) {
            const stage = person && person.membership && person.membership.stage;
            const i = ShepherdingCore.MEMBERSHIP_STAGES.indexOf(stage);
            return i === -1 ? 0 : i;
        },

        membershipStageLabel(person) {
            if (person && person.membership && person.membership.inactive) return 'Inactive';
            const stage = person && person.membership && person.membership.stage;
            return ShepherdingCore.MEMBERSHIP_STAGE_LABEL[stage] || 'Not on the Track';
        },

        // Move the selected Person to the stage at the slider index. Never fired
        // while Inactive (the slider is disabled then).
        async setMembershipStageByIndex(index) {
            const stage = ShepherdingCore.MEMBERSHIP_STAGES[Number(index)];
            if (!stage) return;
            await this.commitMembership({ stage, inactive: false });
        },

        // Toggle Inactive: keep the retained stage, flip the flag. Clearing it
        // restores the stage (its tags come back via the projection).
        async toggleMembershipInactive() {
            const m = (this.selectedPerson && this.selectedPerson.membership) || {};
            await this.commitMembership({ stage: m.stage || null, inactive: !m.inactive });
        },

        async commitMembership(next) {
            const person = this.selectedPerson;
            if (!person) return;
            const previous = {
                stage: (person.membership && person.membership.stage) || null,
                inactive: !!(person.membership && person.membership.inactive),
            };
            if (previous.stage === next.stage && previous.inactive === next.inactive) return;
            try {
                await ShepherdingCore.commitMembershipChange(db, person.id, {
                    currentTags: person.tags || [],
                    previous,
                    next,
                    authorUid: this.currentUserUid,
                    authorName: this.currentUserName,
                    source: 'people_list',
                });
                // Reflect the field + re-projected tags locally (clone and list).
                const newTags = ShepherdingCore.applyMembershipTags(person.tags || [], next);
                person.membership = { ...(person.membership || {}), stage: next.stage, inactive: next.inactive };
                person.tags = newTags;
                const idx = this.people.findIndex(p => p.id === person.id);
                if (idx !== -1) {
                    this.people[idx] = { ...this.people[idx], membership: person.membership, tags: newTags };
                }
                this.showToast(ShepherdingCore.describeMembershipChange(
                    ShepherdingCore.buildMembershipChange({ previous, next })
                ));
            } catch (e) {
                console.error('Error updating membership:', e);
                this.showToast('Error updating membership', 'error');
            }
        },

        async addTag(person, tagName) {
            tagName = tagName.trim();
            if (!tagName) return;
            // Membership Tags are code-defined (ADR-0012) — they follow the Track
            // slider, never hand-editing. Guard the person-modal tag editor too.
            if (ShepherdingCore.isMembershipTagId(this.allTags.find(t => t.toLowerCase() === tagName.toLowerCase()) || tagName)) {
                this.showToast('Membership Tags follow the Membership Track, not manual tagging', 'error');
                return;
            }

            // Find match or use original (case-insensitive check)
            const existingTag = this.allTags.find(t => t.toLowerCase() === tagName.toLowerCase());
            const finalTagName = existingTag || tagName;

            const tags = person.tags || [];
            if (tags.includes(finalTagName)) {
                this.showToast(`Person already has tag "${finalTagName}"`, 'error');
                return;
            }

            try {
                const batch = db.batch();
                
                // If it's a new tag, add it to the global people_tags collection
                if (!existingTag) {
                    batch.set(db.collection('people_tags').doc(finalTagName), { name: finalTagName });
                    this.allTags.push(finalTagName);
                    this.allTags.sort();
                }

                const newTags = [...tags, finalTagName];
                batch.update(db.collection('people').doc(person.id), {
                    tags: newTags,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                });

                await batch.commit();
                person.tags = newTags;
                
                // Sync local list if editing a clone
                const localIdx = this.people.findIndex(p => p.id === person.id);
                if (localIdx !== -1) {
                    this.people[localIdx].tags = newTags;
                }

                this.showToast(`Tag "${finalTagName}" added successfully`);
            } catch (e) {
                console.error("Error adding tag:", e);
                this.showToast('Error adding tag', 'error');
            }
        },

        async removeTag(person, tag) {
            if (ShepherdingCore.isMembershipTagId(tag)) {
                this.showToast('Membership Tags follow the Membership Track, not manual tagging', 'error');
                return;
            }
            const tags = person.tags || [];
            const newTags = tags.filter(t => t !== tag);

            try {
                await db.collection('people').doc(person.id).update({
                    tags: newTags,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                });
                person.tags = newTags;

                // Sync local list if editing a clone
                const localIdx = this.people.findIndex(p => p.id === person.id);
                if (localIdx !== -1) {
                    this.people[localIdx].tags = newTags;
                }

                this.showToast(`Tag "${tag}" removed successfully`);
            } catch (e) {
                console.error("Error removing tag:", e);
                this.showToast('Error removing tag', 'error');
            }
        },

        initiateMerge(person) {
            if (!this.mergeSource) {
                this.mergeSource = person;
                this.showToast(`Selected "${person.name}" as duplicate to merge. Now click "Merge Into" on the surviving record.`);
            } else if (this.mergeSource.id === person.id) {
                this.mergeSource = null;
                this.showToast('Merge selection cleared.');
            } else {
                this.mergeTarget = person;
                this.showMergeModal = true;
            }
        },

        async executeMerge() {
            if (!this.mergeSource || !this.mergeTarget) return;
            this.isSubmitting = true;
            
            try {
                const sourceId = this.mergeSource.id;
                const targetId = this.mergeTarget.id;
                const sourceRef = db.collection('people').doc(sourceId);
                const targetRef = db.collection('people').doc(targetId);

                // 1. Merge core fields (Fill-in-the-blanks)
                const updates = {};
                if (!this.mergeTarget.contact?.email && this.mergeSource.contact?.email) {
                    updates['contact.email'] = this.mergeSource.contact.email;
                }
                if (!this.mergeTarget.contact?.phone && this.mergeSource.contact?.phone) {
                    updates['contact.phone'] = this.mergeSource.contact.phone;
                }
                if (!this.mergeTarget.contact?.address && this.mergeSource.contact?.address) {
                    updates['contact.address'] = this.mergeSource.contact.address;
                }
                if (!this.mergeTarget.birthday && this.mergeSource.birthday) {
                    updates.birthday = this.mergeSource.birthday;
                }
                if (!this.mergeTarget.sex && this.mergeSource.sex) {
                    updates.sex = this.mergeSource.sex;
                }

                // 2. Union Tags
                const sourceTags = this.mergeSource.tags || [];
                const targetTags = this.mergeTarget.tags || [];
                const combinedTags = [...new Set([...sourceTags, ...targetTags])];
                if (combinedTags.length !== targetTags.length) {
                    updates.tags = combinedTags;
                }

                // 3. Migrate Sub-collections
                const migrateSub = async (collName) => {
                    const sourceSnap = await sourceRef.collection(collName).get();
                    const targetSnap = await targetRef.collection(collName).get();
                    
                    const existingKeys = new Set(targetSnap.docs.map(doc => {
                        const d = doc.data();
                        return `${d.serviceDate}_${d.type || ''}`;
                    }));

                    const batch = db.batch();
                    for (const doc of sourceSnap.docs) {
                        const data = doc.data();
                        const key = `${data.serviceDate}_${data.type || ''}`;
                        if (!existingKeys.has(key)) {
                            batch.set(targetRef.collection(collName).doc(), data);
                        }
                        batch.delete(doc.ref);
                    }
                    await batch.commit();
                };

                await migrateSub('involvement');
                await migrateSub('pastoral_prayer_history');

                // 4. Update Target Metadata
                const finalInvSnap = await targetRef.collection('involvement').get();
                const finalPrayerSnap = await targetRef.collection('pastoral_prayer_history').get();
                
                const pastoralPrayers = finalPrayerSnap.docs
                    .map(doc => doc.data().serviceDate)
                    .sort();
                const lastDate = pastoralPrayers.length > 0 ? pastoralPrayers[pastoralPrayers.length - 1] : (this.mergeTarget.lastPastoralPrayerDate || null);

                updates.totalInvolvements = finalInvSnap.size;
                updates.lastPastoralPrayerDate = lastDate;
                updates.updatedAt = firebase.firestore.FieldValue.serverTimestamp();

                await targetRef.update(updates);

                // 5. Delete Source
                await sourceRef.delete();

                this.showToast(`Successfully merged "${this.mergeSource.name}" into "${this.mergeTarget.name}"`);
                this.showMergeModal = false;
                this.mergeSource = null;
                this.mergeTarget = null;
                await this.loadPeople();
            } catch (e) {
                console.error("Merge failed:", e);
                this.showToast('Merge operation failed', 'error');
            } finally {
                this.isSubmitting = false;
            }
        },

        toggleSort(key) {
            if (this.sortKey === key) {
                this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
            } else {
                this.sortKey = key;
                this.sortDirection = key === 'totalInvolvements' ? 'desc' : 'asc';
            }
        },

        async addPerson() {
            const name = this.newPerson.name.trim();
            if (!name) return;
            
            this.isSubmitting = true;
            try {
                const now = firebase.firestore.FieldValue.serverTimestamp();
                await db.collection('people').add({
                    name: name,
                    totalInvolvements: 0,
                    contact: {
                        email: (this.newPerson.email || '').trim(),
                        phone: (this.newPerson.phone || '').trim(),
                        address: (this.newPerson.address || '').trim()
                    },
                    birthday: this.newPerson.birthday || null,
                    sex: this.newPerson.sex || null,
                    lastPastoralPrayerDate: null,
                    tags: [],
                    createdAt: now,
                    updatedAt: now
                });
                this.newPerson = { name: '', email: '', phone: '', address: '', birthday: '', sex: '' };
                await this.loadPeople();
                this.showAddPersonModal = false;
                this.showToast('Person added successfully');
            } catch (e) {
                console.error(e);
                this.showToast('Error adding person', 'error');
            } finally {
                this.isSubmitting = false;
            }
        },

        async deletePerson(id) {
            if (!confirm('Are you sure you want to delete this person? Involvement records will remain but will be unlinked.')) return;
            try {
                await db.collection('people').doc(id).delete();
                await this.loadPeople();
                this.showToast('Person removed');
            } catch (e) {
                console.error(e);
                this.showToast('Error deleting person', 'error');
            }
        },

        async editPerson(person) {
            this.selectedPerson = JSON.parse(JSON.stringify(person)); // Deep clone for editing
            // Ensure contact object exists so x-model doesn't fail
            if (!this.selectedPerson.contact) {
                this.selectedPerson.contact = {};
            }
            this.showInvolvementModal = true;
            this.loadInvolvement(person.id);
        },

        async updatePerson() {
            if (!this.selectedPerson) return;
            this.isSubmitting = true;
            try {
                const personRef = db.collection('people').doc(this.selectedPerson.id);
                const updates = {
                    name: this.selectedPerson.name.trim(),
                    'contact.email': (this.selectedPerson.contact?.email || '').trim(),
                    'contact.phone': (this.selectedPerson.contact?.phone || '').trim(),
                    'contact.address': (this.selectedPerson.contact?.address || '').trim(),
                    birthday: this.selectedPerson.birthday || null,
                    sex: this.selectedPerson.sex || null,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                };

                await personRef.update(updates);
                
                // Update local list
                const idx = this.people.findIndex(p => p.id === this.selectedPerson.id);
                if (idx !== -1) {
                    this.people[idx] = { ...this.people[idx], ...this.selectedPerson };
                }

                this.showToast('Person updated successfully');
            } catch (e) {
                console.error("Error updating person:", e);
                this.showToast('Error updating person', 'error');
            } finally {
                this.isSubmitting = false;
            }
        },

        async loadInvolvement(personId) {
            try {
                const snap = await db.collection('people').doc(personId)
                    .collection('involvement')
                    .orderBy('serviceDate', 'desc')
                    .get();
                this.involvement = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            } catch (error) {
                console.error("Error loading involvement:", error);
            }
        },

        async addInvolvement() {
            if (!this.selectedPerson || !this.newInvolvement.serviceDate || !this.newInvolvement.type) {
                this.showToast('Please fill in Date and Role', 'error');
                return;
            }
            
            this.isSubmitting = true;
            try {
                const personRef = db.collection('people').doc(this.selectedPerson.id);
                const involvementRef = personRef.collection('involvement');
                
                const data = {
                    serviceDate: this.newInvolvement.serviceDate,
                    type: this.newInvolvement.type,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                };
                
                if (this.newInvolvement.type === 'prayer') {
                    data.metadata = {
                        prayer_type: this.newInvolvement.prayerType,
                        prayer_text: this.newInvolvement.prayerText
                    };
                }
                
                const batch = db.batch();
                batch.set(involvementRef.doc(), data);
                batch.update(personRef, {
                    totalInvolvements: firebase.firestore.FieldValue.increment(1)
                });
                
                await batch.commit();
                
                // Update local counts
                this.selectedPerson.totalInvolvements = (this.selectedPerson.totalInvolvements || 0) + 1;

                // Reset form but keep the date for potential batch entries
                const lastDate = this.newInvolvement.serviceDate;
                this.newInvolvement = { 
                    serviceDate: lastDate, 
                    type: '', 
                    prayerType: 'praise', 
                    prayerText: '' 
                };
                
                await this.loadInvolvement(this.selectedPerson.id);
                this.showToast('Involvement logged successfully');
            } catch (e) {
                console.error(e);
                this.showToast('Error logging involvement', 'error');
            } finally {
                this.isSubmitting = false;
            }
        },

        async deleteInvolvement(involvementId) {
            if (!confirm('Remove this involvement record?')) return;
            try {
                const personRef = db.collection('people').doc(this.selectedPerson.id);
                
                const batch = db.batch();
                batch.delete(personRef.collection('involvement').doc(involvementId));
                batch.update(personRef, {
                    totalInvolvements: firebase.firestore.FieldValue.increment(-1)
                });
                
                await batch.commit();

                // Update local counts
                this.selectedPerson.totalInvolvements = Math.max(0, (this.selectedPerson.totalInvolvements || 0) - 1);

                await this.loadInvolvement(this.selectedPerson.id);
                this.showToast('Record removed');
            } catch (e) {
                console.error(e);
            }
        },

        get filteredPeople() {
            let list = [...this.people];
            
            // Filter out people with tags marked as hidePeople: true for non-admins,
            // or explicitly hidden by the shepherding system
            if (!this.isAdmin) {
                list = list.filter(p => {
                    const personTags = p.tags || [];
                    return !personTags.some(tag => this.tagMetadata[tag]?.hidePeople) && !p.shepherdingHidden;
                });
            }

            // The Membership Directory (ADR-0012): the whole congregation browses
            // two tabs — Members (carries the Member tag) and Non-members (active,
            // no Member tag). Inactive People are hidden from non-editors on both.
            list = list.filter(p => ShepherdingCore.personMatchesDirectoryTab(p, this.activeTab, this.canEdit));

            if (this.searchTerm) {
                const term = this.searchTerm.toLowerCase();
                list = list.filter(p => p.name.toLowerCase().includes(term));
            }

            if (this.selectedTags.length > 0) {
                list = list.filter(p => {
                    const personTags = p.tags || [];
                    return this.selectedTags.every(t => personTags.includes(t));
                });
            }

            list.sort((a, b) => {
                let valA = a[this.sortKey];
                let valB = b[this.sortKey];

                if (typeof valA === 'string') {
                    valA = valA.toLowerCase();
                    valB = valB.toLowerCase();
                }

                if (valA < valB) return this.sortDirection === 'asc' ? -1 : 1;
                if (valA > valB) return this.sortDirection === 'asc' ? 1 : -1;
                return 0;
            });

            return list;
        },

        formatRole(role) {
            return role.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
        },

        showToast(message, type = 'success') {
            const toast = document.createElement('div');
            toast.className = `fixed bottom-4 right-4 px-6 py-3 rounded shadow-lg text-white z-50 ${type === 'success' ? 'bg-green-600' : 'bg-red-600'}`;
            toast.textContent = message;
            document.body.appendChild(toast);
            setTimeout(() => toast.remove(), 3000);
        }
    }));
});
