// Household Store — the kiosk's writes (MS-319, MS-321, MS-709).
//
// A kiosk Household is a Household record in `families` (ADR-0075), so every
// write lands there: new People and the record that seats them go in one
// batch, and a Person fixed at the desk has only their name rewritten. The
// rules pin both — a kiosk may write a record's seats and children and a
// Person's name, and nothing else of either.

(function (global) {
    'use strict';

    const Core = (typeof require !== 'undefined')
        ? require('./household-core.js')
        : global.HouseholdCore;

    const FAMILIES = 'families';
    const PEOPLE = 'people';

    function draftRows(people) {
        const fault = Core.createFault(people);
        if (fault) throw new Error(fault);
        return (people || []).filter(function (p) {
            return p && Core.personWrite(p, 'x').name;
        });
    }

    function personRefs(db, batch, rows, now) {
        return rows.map(function (row) {
            const ref = db.collection(PEOPLE).doc();
            const written = Core.personWrite(row, now);
            batch.set(ref, written);
            return { personId: ref.id, kid: !!row.kid, name: written.name, sex: row.sex, role: Core.roleOf(row) };
        });
    }

    // New People, into `target` (a kiosk Household) or into a Household of
    // their own when target is null. Returns the kiosk id of the Household
    // they are now in, so the screen can open it.
    async function saveDraft(db, target, draft, families) {
        const rows = draftRows((draft && draft.people) || []);
        const now = (draft && draft.now) || new Date().toISOString();
        const batch = db.batch();
        const added = personRefs(db, batch, rows, now);
        const plan = Core.householdRecordFor(target || null, added, families);
        if (plan.fault) throw new Error(plan.fault);
        let familyId = target && target.familyId ? target.familyId : null;
        if (plan.action === 'create') {
            const ref = db.collection(FAMILIES).doc();
            batch.set(ref, plan.changes);
            familyId = ref.id;
        } else if (plan.action === 'update') {
            batch.update(db.collection(FAMILIES).doc(plan.familyId), plan.changes);
        }
        await batch.commit();
        const id = familyId ? 'family:' + familyId : 'person:' + ((target && target.personId) || added[0].personId);
        return { id: id, added: added };
    }

    // Rewrite the names that changed. Every fault is found before anything is
    // written, so a half-saved list never happens.
    async function renamePeople(db, edits, now) {
        const stamp = now || new Date().toISOString();
        const writes = [];
        for (const e of edits || []) {
            const plan = Core.renameWrite(e.person, e.entry, stamp);
            if (plan.fault) throw new Error(plan.fault);
            if (plan.patch) writes.push({ id: e.person.id, patch: plan.patch });
        }
        if (!writes.length) return 0;
        const batch = db.batch();
        writes.forEach(function (w) { batch.update(db.collection(PEOPLE).doc(w.id), w.patch); });
        await batch.commit();
        return writes.length;
    }

    const HouseholdStore = {
        saveDraft,
        renamePeople,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = HouseholdStore;
    }
    if (global) {
        global.HouseholdStore = HouseholdStore;
    }
})(typeof window !== 'undefined' ? window : null);
