// Household Store — Firestore adapter for stored Households (MS-319, MS-321).
//
// The kiosk may create People and a Household in one batch, and may ADD people
// to a Household that already exists. It cannot rename one, remove anybody from
// one, or edit a Person who is already in the directory — the rules pin that,
// not just this file. Editors tidy the rest.
//
// A projected Household (a Family, or a Person on their own) is minted into a
// real document the first time somebody uses it, under the projection's own id
// so that minting twice writes the same doc twice rather than two docs
// (ADR-0044).

(function (global) {
    'use strict';

    const Core = (typeof require !== 'undefined')
        ? require('./household-core.js')
        : global.HouseholdCore;

    const HOUSEHOLDS = 'households';
    const PEOPLE = 'people';

    async function loadHouseholds(db) {
        const snap = await db.collection(HOUSEHOLDS).get();
        return snap.docs.map(d => Object.assign({ id: d.id }, d.data()));
    }

    // A stored doc keeps the createdAt it already has; only a mint stamps one.
    function patchFor(plan, stored, now) {
        if (!stored) return plan.doc;
        const patch = Object.assign({}, plan.doc, { updatedAt: now });
        delete patch.createdAt;
        return patch;
    }

    function draftRows(people) {
        const fault = Core.createFault(people);
        if (fault) throw new Error(fault);
        return (people || []).filter(p => p && String(p.name || '').trim());
    }

    function personRefs(db, batch, rows, now) {
        return rows.map(function (row) {
            const ref = db.collection(PEOPLE).doc();
            batch.set(ref, Core.personWrite(row, now));
            return { personId: ref.id, kid: !!row.kid, name: String(row.name).trim() };
        });
    }

    async function createHousehold(db, draft) {
        const rows = draftRows((draft && draft.people) || []);
        const name = (draft && draft.name && String(draft.name).trim())
            || Core.suggestedHouseholdName(rows);
        const now = (draft && draft.now) || new Date().toISOString();
        const batch = db.batch();
        const members = personRefs(db, batch, rows, now);
        const houseRef = db.collection(HOUSEHOLDS).doc();
        batch.set(houseRef, Core.householdWrite(name, members, now));
        await batch.commit();
        return { id: houseRef.id, name: name, members: members, stored: true };
    }

    // Turn a projection into a stored Household, unchanged. Idempotent: the doc
    // id is the projection id, so a second mint overwrites the first.
    async function mintHousehold(db, household, now) {
        if (!household || !household.id) throw new Error('No household to mint.');
        if (household.stored) return household;
        const stamp = now || new Date().toISOString();
        const plan = Core.mintWrite(household, [], stamp);
        await db.collection(HOUSEHOLDS).doc(household.id).set(plan.doc);
        return { id: household.id, name: plan.doc.name, members: plan.members, stored: true };
    }

    // Add brand-new People to a Household. A projection is minted on the way
    // through, so "add my brother to the Harris household" is one write of one
    // document rather than a second Harris household beside the first.
    async function addPeopleToHousehold(db, household, draft) {
        if (!household || !household.id) throw new Error('No household to add to.');
        const rows = draftRows((draft && draft.people) || []);
        const now = (draft && draft.now) || new Date().toISOString();
        const batch = db.batch();
        const added = personRefs(db, batch, rows, now);
        const plan = Core.mintWrite(household, added, now);
        const ref = db.collection(HOUSEHOLDS).doc(household.id);
        batch.set(ref, patchFor(plan, !!household.stored, now), { merge: true });
        await batch.commit();
        return {
            id: household.id,
            name: plan.doc.name,
            members: plan.members,
            stored: true,
            added: added,
        };
    }

    const HouseholdStore = {
        HOUSEHOLDS,
        loadHouseholds,
        createHousehold,
        mintHousehold,
        addPeopleToHousehold,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = HouseholdStore;
    }
    if (global) {
        global.HouseholdStore = HouseholdStore;
    }
})(typeof window !== 'undefined' ? window : null);
