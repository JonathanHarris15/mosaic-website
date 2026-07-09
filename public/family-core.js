// Family Core — the pure model for Families (ADR-0012, MS-88).
//
// A Family is a first-class household entity `{ husbandId?, wifeId?, childIds[],
// anniversary? }` (its own `families` collection). Husband is one male Person,
// Wife one female Person; every field is optional, so partial families (a widow
// and kids, a childless couple) are allowed.
//
// Multiple generations are EMERGENT, not a stored tree: a Person is a spouse in
// at most one Family (their marriage) and a child in at most one Family (their
// family of origin). Walking child → their-family-as-spouse → that family's
// children traverses any number of generations. These pure resolvers own that
// walk so the UIs stay dumb.
//
// Loaded as a classic <script> (window.FamilyCore) and exported for Node tests.

(function (global) {
    'use strict';

    // The Family in which `personId` is a spouse (husband or wife), or null.
    function familyOfSpouse(families, personId) {
        if (!personId) return null;
        return (families || []).find(f => f.husbandId === personId || f.wifeId === personId) || null;
    }

    // The Family of origin: the Family whose childIds include `personId`, or null.
    function familyOfChild(families, personId) {
        if (!personId) return null;
        return (families || []).find(f => (f.childIds || []).indexOf(personId) !== -1) || null;
    }

    // The other spouse in a Family, given one spouse's id (null if none / unknown).
    function spouseOf(family, personId) {
        if (!family) return null;
        if (family.husbandId === personId) return family.wifeId || null;
        if (family.wifeId === personId) return family.husbandId || null;
        return null;
    }

    // Resolve a Person's immediate relations from the family graph:
    //   { spouseId, childIds, parentIds } — parentIds are the (husband, wife) of
    // the family of origin (each may be absent). All emergent from the two
    // lookups, so a child who marries yields both their parents AND their own kids.
    function resolveRelations(families, personId) {
        const asSpouse = familyOfSpouse(families, personId);
        const asChild = familyOfChild(families, personId);
        const parentIds = asChild
            ? [asChild.husbandId, asChild.wifeId].filter(Boolean)
            : [];
        return {
            familyId: asSpouse ? asSpouse.id : null,
            originFamilyId: asChild ? asChild.id : null,
            spouseId: spouseOf(asSpouse, personId),
            childIds: asSpouse ? (asSpouse.childIds || []).slice() : [],
            parentIds,
        };
    }

    // Does a Person qualify for a spousal role? Husband must be male, wife female.
    // A missing sex fails closed (the editor must set it first). `person` is the
    // Person record; `role` is 'husband' | 'wife'.
    function spouseSexOk(person, role) {
        if (!person) return false;
        if (role === 'husband') return person.sex === 'male';
        if (role === 'wife') return person.sex === 'female';
        return false;
    }

    const FamilyCore = {
        familyOfSpouse,
        familyOfChild,
        spouseOf,
        resolveRelations,
        spouseSexOk,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = FamilyCore;
    }
    if (global) {
        global.FamilyCore = FamilyCore;
    }
})(typeof window !== 'undefined' ? window : null);
