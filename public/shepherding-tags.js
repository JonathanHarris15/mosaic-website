// Manage Tags and Relationships — the full-page home for the elder-only
// vocabulary. Two tabs (MS-103, ADR-0014):
//
//   Tags          — create, rename, merge, delete and flag Shepherding Tags.
//                   Unchanged from when this page was just "Manage Tags".
//   Relationships — define Relationship Types and manage who holds them.
//                   Lives in shepherding-relationships.js, mixed in below.
//
// The dashboard still reads tags (for Filtered View filters and display); this
// page owns every write. Tag identity is a stable auto-id independent of the name
// (ADR-0011), so a Rename touches only the name field and a Merge re-points
// carriers and their Tag Changes onto the survivor.

// A read whose RESULT DECIDES A WRITE — a merge, a re-point, a batch of
// deletes. In the phone app ordinary reads are answered from the device
// (local-cache.js); these must not be. Stale input to a write does not show
// you old data, it destroys new data: a merge planned from a people list a
// minute old silently drops whoever was added in that minute. Ignored on the
// web, where reads were always live.
var FRESH_READ = { source: 'server' };
document.addEventListener('alpine:init', () => {
    // withRelationshipsTab, not object spread: the Relationships tab exposes getters
    // (selectedType, pickerOptions) and spreading would freeze them at their
    // page-load values. See shepherding-relationships.js.
    Alpine.data('shepherdingTags', () => window.withRelationshipsTab({

        currentUser: null,
        currentPermissionLevel: null,

        activeTab: 'tags', // 'tags' | 'relationships'

        shepherdingTags: [],
        newTagName: '',
        // Inline Rename and directional Tag Merge.
        editingTagId: null,
        editingTagName: '',
        mergingTagId: null,

        loading: true,
        toast: { show: false, message: '', type: 'success' },

        async init() {
            auth.onAuthStateChanged(async (user) => {
                if (!user) {
                    window.location.href = 'login.html';
                    return;
                }
                const userData = await getUserData(user.uid);
                this.currentPermissionLevel = (userData && (userData.permissionLevel || userData.role)) || 'viewer';
                if (!['elder', 'super_admin'].includes(this.currentPermissionLevel)) {
                    window.location.href = 'index.html';
                    return;
                }
                this.currentUser = user;
                // Dev-only privacy screen (shepherding-blur.js). This page shows only
                // tag vocabulary (no person associations), so nothing is blurred here;
                // configure keeps the toggle available for consistency.
                ShepherdingBlur.configure({
                    permissionLevel: this.currentPermissionLevel,
                    uid: user.uid,
                    personId: userData && userData.personId,
                });
                // The two tabs load independently. A failure in one must not brick
                // the other, and must not leave the page stuck on its spinner —
                // each load owns its own errors, and `loading` clears regardless.
                try {
                    await Promise.all([this.loadTags(), this.loadRelationshipsTab()]);
                } finally {
                    this.loading = false;
                }
            });
        },

        async loadTags() {
            try {
                const snap = await db.collection('people_tags').orderBy('name', 'asc').get();
                this.shepherdingTags = snap.docs.map(doc => ({
                    id: doc.id,
                    name: doc.data().name || doc.id,
                    hiddenFromOthers: doc.data().hiddenFromOthers || false,
                    hidePeople: doc.data().hidePeople || false,
                    // Projected Tags are code-defined and immutable (ADR-0012,
                    // ADR-0013): Membership Tags AND the Elder Tag. The UI locks
                    // rename/delete/merge/hide on them; they still appear in the
                    // list so elders can see the vocabulary.
                    locked: ShepherdingCore.isProjectedTagId(doc.id),
                }));
            } catch (e) {
                console.error('Error loading tags:', e);
            }
        },

        async addTag() {
            const name = this.newTagName.trim();
            if (!name) return;
            if (this.shepherdingTags.find(t => t.name.toLowerCase() === name.toLowerCase())) {
                this.showToast('Tag already exists', 'error');
                return;
            }
            try {
                // A tag's identity is a stable auto-id, independent of its name
                // (ADR-0011) — so it can later be renamed without touching carriers.
                const ref = await db.collection('people_tags').add({
                    name,
                    hiddenFromOthers: false,
                    hidePeople: false,
                });
                this.shepherdingTags.push({ id: ref.id, name, hiddenFromOthers: false, hidePeople: false });
                this.shepherdingTags.sort((a, b) => a.name.localeCompare(b.name));
                this.newTagName = '';
                this.showToast(`Tag "${name}" created`);
            } catch (e) {
                console.error('Error adding tag:', e);
                this.showToast('Error creating tag', 'error');
            }
        },

        // ── Rename (ADR-0011) — changes only the display name; identity is stable,
        // so every carrier, view, and Tag Change keeps referring to this tag.
        // A Projected Tag (ADR-0012 Membership Tags, ADR-0013 Elder Tag) is
        // code-defined and cannot be renamed, deleted, merged into, or hidden.
        // Every mutation entry point checks this so the immutable subset holds
        // even if a control is somehow reachable.
        rejectIfMembershipTag(id) {
            if (ShepherdingCore.isProjectedTagId(id)) {
                this.showToast('This tag is managed by the system and cannot be changed', 'error');
                return true;
            }
            return false;
        },

        startRenameTag(tag) {
            if (this.rejectIfMembershipTag(tag.id)) return;
            this.editingTagId = tag.id;
            this.editingTagName = tag.name;
            this.mergingTagId = null;
        },

        cancelRenameTag() {
            this.editingTagId = null;
            this.editingTagName = '';
        },

        async renameTag(id) {
            if (this.rejectIfMembershipTag(id)) { this.cancelRenameTag(); return; }
            const name = this.editingTagName.trim();
            const tag = this.shepherdingTags.find(t => t.id === id);
            if (!tag) { this.cancelRenameTag(); return; }
            if (!name || name === tag.name) { this.cancelRenameTag(); return; }
            if (this.shepherdingTags.find(t => t.id !== id && t.name.toLowerCase() === name.toLowerCase())) {
                this.showToast('A tag with that name already exists', 'error');
                return;
            }
            try {
                await db.collection('people_tags').doc(id).update({ name });
                this.shepherdingTags = this.shepherdingTags
                    .map(t => t.id === id ? { ...t, name } : t)
                    .sort((a, b) => a.name.localeCompare(b.name));
                this.cancelRenameTag();
                this.showToast(`Tag renamed to "${name}"`);
            } catch (e) {
                console.error('Error renaming tag:', e);
                this.showToast('Error renaming tag', 'error');
            }
        },

        // ── Tag Merge (ADR-0011) — fold this tag into a surviving tag. Directional:
        // the row's tag is the merged one; the elder picks the survivor.
        startMergeTag(tag) {
            if (this.rejectIfMembershipTag(tag.id)) return;
            this.mergingTagId = tag.id;
            this.editingTagId = null;
        },

        cancelMergeTag() {
            this.mergingTagId = null;
        },

        async mergeTagInto(survivorId) {
            const sourceId = this.mergingTagId;
            if (!sourceId || !survivorId || sourceId === survivorId) { this.cancelMergeTag(); return; }
            // Neither side may be a Membership Tag: not as the merged source, and
            // not as the survivor (which would fold ordinary carriers into a
            // code-defined stage tag).
            if (this.rejectIfMembershipTag(sourceId) || this.rejectIfMembershipTag(survivorId)) { this.cancelMergeTag(); return; }
            const source = this.shepherdingTags.find(t => t.id === sourceId);
            const survivor = this.shepherdingTags.find(t => t.id === survivorId);
            if (!source || !survivor) { this.cancelMergeTag(); return; }
            if (!confirm(`Merge "${source.name}" into "${survivor.name}"? Everyone tagged "${source.name}" will be tagged "${survivor.name}" instead, and "${source.name}" will be deleted.`)) return;
            try {
                const carriers = await db.collection('people')
                    .where('tags', 'array-contains', sourceId)
                    .get(FRESH_READ);
                // Gather each carrier's Tag Changes for the merged tag so they can be
                // re-pointed at the survivor (which then inherits the earlier hold).
                const people = await Promise.all(carriers.docs.map(async doc => {
                    const actSnap = await doc.ref.collection('shepherding_activity')
                        .where('tagId', '==', sourceId)
                        .get(FRESH_READ);
                    return {
                        id: doc.id,
                        tags: doc.data().tags || [],
                        activity: actSnap.docs.map(a => ({ id: a.id, tagId: a.data().tagId, action: a.data().action })),
                    };
                }));

                const plan = ShepherdingCore.planTagMerge({
                    people,
                    mergedTagIds: [sourceId],
                    survivorTagId: survivorId,
                });

                // Which tags still hide their carriers, once the merged tag is gone.
                const hidePeopleTagIds = this.shepherdingTags
                    .filter(t => t.id !== sourceId && t.hidePeople)
                    .map(t => t.id);
                const refById = Object.fromEntries(carriers.docs.map(d => [d.id, d.ref]));

                // Firestore caps a batch at 500 writes; chunk the whole plan.
                const ops = [];
                plan.personUpdates.forEach(u => ops.push(batch => {
                    batch.update(refById[u.personId], {
                        tags: u.newTags,
                        shepherdingHidden: u.newTags.some(t => hidePeopleTagIds.includes(t)),
                    });
                }));
                plan.activityRewrites.forEach(r => ops.push(batch => {
                    batch.update(refById[r.personId].collection('shepherding_activity').doc(r.activityId), {
                        tagId: survivorId,
                        tagName: survivor.name,
                    });
                }));

                await this.commitInChunks(ops);
                await db.collection('people_tags').doc(sourceId).delete();

                this.shepherdingTags = this.shepherdingTags.filter(t => t.id !== sourceId);
                this.cancelMergeTag();
                this.showToast(`Merged "${source.name}" into "${survivor.name}"`);
            } catch (e) {
                console.error('Error merging tags:', e);
                this.showToast('Error merging tags', 'error');
            }
        },

        // Apply a list of (batch) => void ops in chunks that respect Firestore's
        // 500-write-per-batch limit.
        async commitInChunks(ops, size = 450) {
            for (let i = 0; i < ops.length; i += size) {
                const batch = db.batch();
                ops.slice(i, i + size).forEach(op => op(batch));
                await batch.commit();
            }
        },

        async deleteTag(id, name) {
            if (this.rejectIfMembershipTag(id)) return;
            if (!confirm(`Delete tag "${name}"? It will be removed from all people.`)) return;
            const tag = this.shepherdingTags.find(t => t.id === id);
            try {
                const peopleWithTag = await db.collection('people')
                    .where('tags', 'array-contains', id)
                    .get(FRESH_READ);
                const otherHidePeopleTagIds = this.shepherdingTags
                    .filter(t => t.id !== id && t.hidePeople)
                    .map(t => t.id);
                const batch = db.batch();
                peopleWithTag.docs.forEach(doc => {
                    const update = { tags: firebase.firestore.FieldValue.arrayRemove(id) };
                    if (tag?.hidePeople) {
                        const remaining = (doc.data().tags || []).filter(t => t !== id);
                        update.shepherdingHidden = remaining.some(tid => otherHidePeopleTagIds.includes(tid));
                    }
                    batch.update(doc.ref, update);
                });
                batch.delete(db.collection('people_tags').doc(id));
                await batch.commit();
                this.shepherdingTags = this.shepherdingTags.filter(t => t.id !== id);
                this.showToast(`Tag "${name}" deleted`);
            } catch (e) {
                console.error('Error deleting tag:', e);
                this.showToast('Error deleting tag', 'error');
            }
        },

        async toggleTagFlag(id, field) {
            if (this.rejectIfMembershipTag(id)) return;
            const idx = this.shepherdingTags.findIndex(t => t.id === id);
            if (idx === -1) return;
            const tag = this.shepherdingTags[idx];
            const newVal = !tag[field];
            try {
                await db.collection('people_tags').doc(id).update({ [field]: newVal });
                this.shepherdingTags = this.shepherdingTags.map((t, i) =>
                    i === idx ? { ...t, [field]: newVal } : t
                );
                if (field === 'hidePeople') {
                    const peopleWithTag = await db.collection('people')
                        .where('tags', 'array-contains', id)
                        .get(FRESH_READ);
                    if (peopleWithTag.size > 0) {
                        const otherHidePeopleTagIds = this.shepherdingTags
                            .filter(t => t.id !== id && t.hidePeople)
                            .map(t => t.id);
                        const batch = db.batch();
                        peopleWithTag.docs.forEach(doc => {
                            if (newVal) {
                                batch.update(doc.ref, { shepherdingHidden: true });
                            } else {
                                const personTags = doc.data().tags || [];
                                batch.update(doc.ref, {
                                    shepherdingHidden: personTags.some(tid => otherHidePeopleTagIds.includes(tid))
                                });
                            }
                        });
                        await batch.commit();
                    }
                }
                this.showToast('Tag updated');
            } catch (e) {
                console.error(`Error toggling tag ${field}:`, e);
                this.showToast('Error updating tag', 'error');
            }
        },

        showToast(message, type = 'success') {
            this.toast = { show: true, message, type };
            setTimeout(() => { this.toast.show = false; }, 3000);
        },
    }));
});

