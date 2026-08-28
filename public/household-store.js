// Household Store — Firestore adapter for stored Households (MS-319).
//
// The kiosk may create People and a Household in one batch. It cannot edit or
// delete a Person who already exists. Editors tidy duplicates later.

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

    async function createHousehold(db, draft) {
        const people = (draft && draft.people) || [];
        const fault = Core.createFault(people);
        if (fault) throw new Error(fault);
        const rows = people.filter(p => p && String(p.name || '').trim());
        const name = (draft && draft.name && String(draft.name).trim())
            || Core.suggestedHouseholdName(rows);
        const now = (draft && draft.now) || new Date().toISOString();
        const batch = db.batch();
        const members = [];
        rows.forEach(function (row) {
            const ref = db.collection(PEOPLE).doc();
            batch.set(ref, Core.personWrite(row, now));
            members.push({ personId: ref.id, kid: !!row.kid, name: String(row.name).trim() });
        });
        const houseRef = db.collection(HOUSEHOLDS).doc();
        batch.set(houseRef, Core.householdWrite(name, members, now));
        await batch.commit();
        return {
            id: houseRef.id,
            name: name,
            members: members,
            stored: true,
        };
    }

    const HouseholdStore = {
        HOUSEHOLDS,
        loadHouseholds,
        createHousehold,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = HouseholdStore;
    }
    if (global) {
        global.HouseholdStore = HouseholdStore;
    }
})(typeof window !== 'undefined' ? window : null);
