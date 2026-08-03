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

    // ── Projected Relationships (ADR-0013, MS-93) ────────────────────────────
    // Family relationships surface on the Shepherding Profile as *derived*,
    // read-only rows alongside the freeform Custom Relationships — never written
    // to the `relationships` collection. Siblings are the one addition the panel
    // needs beyond resolveRelations: the other children of the family of origin.

    // The Person's siblings: the other children of their family of origin (self
    // excluded). Empty when they have no recorded family of origin.
    function siblingIds(families, personId) {
        const origin = familyOfChild(families, personId);
        if (!origin) return [];
        return (origin.childIds || []).filter(id => id !== personId);
    }

    // The gendered relationship label for a family role, by the OTHER Person's
    // sex, with a neutral fallback when sex is unset (ADR-0013): spouse →
    // Husband/Wife/Spouse, parent → Father/Mother/Parent, child →
    // Son/Daughter/Child, sibling → Brother/Sister/Sibling.
    function familyRoleLabel(kind, sex) {
        switch (kind) {
            case 'spouse':  return sex === 'male' ? 'Husband' : sex === 'female' ? 'Wife' : 'Spouse';
            case 'parent':  return sex === 'male' ? 'Father'  : sex === 'female' ? 'Mother' : 'Parent';
            case 'child':   return sex === 'male' ? 'Son'     : sex === 'female' ? 'Daughter' : 'Child';
            case 'sibling': return sex === 'male' ? 'Brother' : sex === 'female' ? 'Sister' : 'Sibling';
            default:        return 'Family';
        }
    }

    // The full set of a Person's family-derived relationships for the panel, as
    // ordered rows `{ otherId, kind, label }` — spouse, then parents, children,
    // siblings. `sexOf(id)` resolves the other Person's sex for the gendered
    // label (unset → neutral fallback). Pure; the panel merges these read-only
    // rows with the deletable Custom Relationships.
    function familyRelations(families, personId, sexOf) {
        const rel = resolveRelations(families, personId);
        const sx = typeof sexOf === 'function' ? sexOf : function () { return null; };
        const out = [];
        if (rel.spouseId) out.push({ otherId: rel.spouseId, kind: 'spouse', label: familyRoleLabel('spouse', sx(rel.spouseId)) });
        rel.parentIds.forEach(function (id) { out.push({ otherId: id, kind: 'parent', label: familyRoleLabel('parent', sx(id)) }); });
        rel.childIds.forEach(function (id) { out.push({ otherId: id, kind: 'child', label: familyRoleLabel('child', sx(id)) }); });
        siblingIds(families, personId).forEach(function (id) { out.push({ otherId: id, kind: 'sibling', label: familyRoleLabel('sibling', sx(id)) }); });
        return out;
    }

    // ── Family write-through (ADR-0014 s4, MS-104) ───────────────────────────
    // The Shepherding Profile's quick-assign card can now AUTHOR Family, not just
    // display it. It writes straight to `families` — find-or-create the Family, seat
    // a spouse, append or pull a child — and never mints a parallel edge in
    // `relationships`. So `families` stays the single source of truth and Family
    // remains a Projected Relationship for display. (Supersedes ADR-0013, which made
    // Family editable only in the Membership Directory.)
    //
    // These are pure PLANNERS: they return the single write to make, and a browser
    // writer applies it — the same shape as ShepherdingCore.planTagMerge.
    //
    //   { valid, errors, collection: 'families', action: 'create'|'update',
    //     familyId?, changes }
    //
    // `changes` is the field patch for an update, or the whole doc for a create.

    const KINDS = ['spouse', 'parent', 'child'];

    function refuse(errors) {
        return { valid: false, errors, collection: 'families', action: null, familyId: null, changes: null };
    }

    // Which seat a Person takes in a Family. Husband is male, wife female; an unset
    // sex fails closed rather than guessing (ADR-0012).
    function seatFor(person) {
        if (!person) return null;
        if (person.sex === 'male') return 'husbandId';
        if (person.sex === 'female') return 'wifeId';
        return null;
    }

    function seatWord(seat) {
        return seat === 'husbandId' ? 'father' : 'mother';
    }

    // Add a Family relation between `personId` and `otherId`.
    //
    //   spouse — seat them together (their marriage). Find-or-create.
    //   child  — append `otherId` to the children of the Family personId is married
    //            into. Find-or-create that Family.
    //   parent — seat `otherId` as a parent in personId's family of origin.
    //            Find-or-create that Family.
    function planAddFamilyRelation(families, personId, kind, otherId, personById) {
        if (KINDS.indexOf(kind) === -1) return refuse([`"${kind}" is not a Family relation`]);
        if (!personId || !otherId) return refuse(['two People are required']);
        if (personId === otherId) return refuse(['a Person cannot be their own ' + kind]);

        const byId = typeof personById === 'function' ? personById : function () { return null; };
        const self = byId(personId);
        const other = byId(otherId);

        if (kind === 'spouse') {
            const selfSeat = seatFor(self);
            const otherSeat = seatFor(other);
            if (!selfSeat || !otherSeat) {
                return refuse(['both People need a recorded sex before they can be seated as husband and wife']);
            }
            if (selfSeat === otherSeat) {
                return refuse(['a Family seats one husband and one wife']);
            }
            const mine = familyOfSpouse(families, personId);
            if (mine && spouseOf(mine, personId)) return refuse(['this Person already has a spouse']);
            const theirs = familyOfSpouse(families, otherId);
            if (theirs && spouseOf(theirs, otherId)) return refuse(['that Person already has a spouse']);

            if (mine) {
                return { valid: true, errors: [], collection: 'families', action: 'update', familyId: mine.id, changes: { [otherSeat]: otherId } };
            }
            return {
                valid: true, errors: [], collection: 'families', action: 'create', familyId: null,
                changes: { [selfSeat]: personId, [otherSeat]: otherId, childIds: [] },
            };
        }

        if (kind === 'child') {
            // A Person is a child in at most one Family — that is what keeps the
            // generational walk unambiguous.
            if (familyOfChild(families, otherId)) {
                return refuse(['that Person is already a child in another Family (they have a family of origin)']);
            }
            const mine = familyOfSpouse(families, personId);
            if (mine) {
                const kids = (mine.childIds || []).slice();
                if (kids.indexOf(otherId) !== -1) return refuse(['that Person is already a child of this Family']);
                kids.push(otherId);
                return { valid: true, errors: [], collection: 'families', action: 'update', familyId: mine.id, changes: { childIds: kids } };
            }
            const selfSeat = seatFor(self);
            if (!selfSeat) return refuse(['this Person needs a recorded sex before a Family can be created for them']);
            return {
                valid: true, errors: [], collection: 'families', action: 'create', familyId: null,
                changes: { [selfSeat]: personId, childIds: [otherId] },
            };
        }

        // kind === 'parent'
        const otherSeat = seatFor(other);
        if (!otherSeat) return refuse(['that Person needs a recorded sex before they can be seated as a parent']);

        const origin = familyOfChild(families, personId);
        if (origin) {
            if (origin[otherSeat]) return refuse([`this Person already has a ${seatWord(otherSeat)}`]);
            return { valid: true, errors: [], collection: 'families', action: 'update', familyId: origin.id, changes: { [otherSeat]: otherId } };
        }
        return {
            valid: true, errors: [], collection: 'families', action: 'create', familyId: null,
            changes: { [otherSeat]: otherId, childIds: [personId] },
        };
    }

    // Remove a Family relation. Removal is scoped to ONE individual's membership —
    // no other Person's place in the Family changes.
    //
    //   spouse — vacate the OTHER spouse's seat. A spouse link is one mutual field,
    //            so ending it necessarily ends it for both.
    //   child  — pull `otherId` from the children. Their siblings stay put.
    //   parent — pull `personId` from their family of origin. The Family itself is
    //            untouched, so the siblings keep both parents and the parents keep
    //            their other children. Because a Family seats exactly one father and
    //            one mother, a parent cannot be removed from one child without
    //            removing them from every sibling — so the individual leaves instead.
    //            `alsoDetaches` reports what else this Person loses, for the confirm.
    function planRemoveFamilyRelation(families, personId, kind, otherId) {
        if (KINDS.indexOf(kind) === -1) return refuse([`"${kind}" is not a removable Family relation`]);
        if (!personId || !otherId) return refuse(['two People are required']);

        if (kind === 'spouse') {
            const family = familyOfSpouse(families, personId);
            if (!family || spouseOf(family, personId) !== otherId) {
                return refuse(['those two are not recorded as spouses']);
            }
            const theirSeat = family.husbandId === otherId ? 'husbandId' : 'wifeId';
            return { valid: true, errors: [], collection: 'families', action: 'update', familyId: family.id, changes: { [theirSeat]: null } };
        }

        if (kind === 'child') {
            const family = familyOfSpouse(families, personId);
            if (!family || (family.childIds || []).indexOf(otherId) === -1) {
                return refuse(['that Person is not recorded as a child of this Family']);
            }
            return {
                valid: true, errors: [], collection: 'families', action: 'update', familyId: family.id,
                changes: { childIds: (family.childIds || []).filter(id => id !== otherId) },
            };
        }

        // kind === 'parent'
        const origin = familyOfChild(families, personId);
        if (!origin || (origin.husbandId !== otherId && origin.wifeId !== otherId)) {
            return refuse(['that Person is not recorded as a parent of this Person']);
        }
        return {
            valid: true, errors: [], collection: 'families', action: 'update', familyId: origin.id,
            changes: { childIds: (origin.childIds || []).filter(id => id !== personId) },
            // Leaving the family of origin costs this Person the other parent and
            // every sibling too. The card warns with this before it writes.
            alsoDetaches: {
                parentIds: [origin.husbandId, origin.wifeId].filter(Boolean),
                siblingIds: (origin.childIds || []).filter(id => id !== personId),
            },
        };
    }

    // ── Families as serving groups (ADR-0012, MS-18) ─────────────────────────
    //
    // A serving Role can say "no two people from the same Family" or "…the same
    // Marriage". Both are questions about the MEMBERSHIP DIRECTORY, so both are
    // answered from the `families` collection — the household record an editor
    // already keeps — and never from a hand-rostered Relationship Group.
    //
    // ⚠ WHY NOT A RELATIONSHIP GROUP TYPE. Manage Tags and Relationships defines
    // ARBITRARY groupings; a Family is a specific one the app already models and
    // already maintains. A second, hand-built Family roster would be the same
    // fact recorded twice, and the copy nobody remembers to update is the one
    // the rota would quietly trust.
    //
    // These two ids are RESERVED. A custom Relationship Type may not use them,
    // or a rule naming "family" would find two different answers.
    const SERVING_GROUP_TYPES = Object.freeze({ FAMILY: 'family', MARRIAGE: 'marriage' });

    const nameIn = (people, personId) => {
        const found = (people || []).find(p => p && p.id === personId);
        return (found && found.name) || null;
    };

    // A household reads by its people, because "Family 7QxK" tells an editor
    // nothing. Falls back through whoever is actually on the record.
    function familyGroupName(family, people) {
        const spouses = [family.husbandId, family.wifeId]
            .map(id => nameIn(people, id))
            .filter(Boolean);
        if (spouses.length === 2) return spouses.join(' and ');
        if (spouses.length === 1) return spouses[0] + '’s family';
        const first = (family.childIds || []).map(id => nameIn(people, id)).filter(Boolean)[0];
        return first ? first + '’s family' : 'A family';
    }

    // Every Family and every Marriage, in the shape the restriction rules
    // already read: `{ id, typeId, name, memberIds }`. Nothing in roles-core
    // changes — it cannot tell these apart from a Relationship Group, which is
    // the point.
    //
    // A Family with one person in it is left out of both: a group of one can
    // never put two people in a Role together, and drawing it would only pad
    // the list an editor reads.
    function servingGroups(families, people) {
        const groups = [];

        (families || []).forEach(family => {
            if (!family || !family.id) return;

            const household = [family.husbandId, family.wifeId]
                .concat(family.childIds || [])
                .filter(Boolean);
            if (household.length > 1) {
                groups.push({
                    id: 'family:' + family.id,
                    typeId: SERVING_GROUP_TYPES.FAMILY,
                    name: familyGroupName(family, people),
                    memberIds: household,
                });
            }

            // A marriage is the two spouses and nobody else — the narrower rule,
            // for the Role where a couple serving together is the problem but
            // their teenager helping is not.
            if (family.husbandId && family.wifeId) {
                groups.push({
                    id: 'marriage:' + family.id,
                    typeId: SERVING_GROUP_TYPES.MARRIAGE,
                    name: familyGroupName(family, people),
                    memberIds: [family.husbandId, family.wifeId],
                });
            }
        });

        return groups;
    }

    const FamilyCore = {
        SERVING_GROUP_TYPES,
        servingGroups,
        familyGroupName,
        familyOfSpouse,
        familyOfChild,
        spouseOf,
        resolveRelations,
        spouseSexOk,
        siblingIds,
        familyRoleLabel,
        familyRelations,
        // write-through (ADR-0014 s4)
        planAddFamilyRelation,
        planRemoveFamilyRelation,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = FamilyCore;
    }
    if (global) {
        global.FamilyCore = FamilyCore;
    }
})(typeof window !== 'undefined' ? window : null);
