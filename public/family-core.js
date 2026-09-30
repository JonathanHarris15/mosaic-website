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
    //   parent — seat `otherId` as a parent in personId's family of origin; when
    //            there is none, put the child in the parent's OWN household (their
    //            marriage) rather than minting a second one for the same couple.
    //
    // Find-or-create always asks "whose household is this already?" first. A Person
    // is a spouse in at most one Family, so no plan may ever seat somebody in a
    // second — that invariant is what stops one couple being recorded many times.
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
            // Both already head a household of their own (each with children, say).
            // Seating one into the other's would leave them a spouse in two, so
            // this refuses rather than quietly recording the couple twice; joining
            // two households is a restructure, not a link.
            if (mine && theirs && mine.id !== theirs.id) {
                return refuse(['both People already head a Family of their own — those two households have to be joined in the directory first']);
            }

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
                if (spouseOf(mine, personId) === otherId) return refuse(['that Person is this Person’s spouse, not their child']);
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

        // A parent's household is their marriage, if they have one. Everything
        // below hangs on that: a child joins the Family their parent is already
        // seated in rather than getting one of their own. Without this, naming
        // both parents of each child in turn minted a fresh Family per child —
        // the same couple recorded five times over, and five spouse links
        // between them in the Relations Viewer.
        const theirs = familyOfSpouse(families, otherId);
        const origin = familyOfChild(families, personId);
        if (origin) {
            if (origin[otherSeat] === otherId) return refuse([`that Person is already this Person's ${seatWord(otherSeat)}`]);
            if (origin[otherSeat]) return refuse([`this Person already has a ${seatWord(otherSeat)}`]);
            // Seating them here would leave them a spouse in two households, and
            // a Person is a spouse in at most one. Joining the two Families is a
            // bigger move than this card makes, so it says so instead.
            if (theirs && theirs.id !== origin.id) {
                return refuse(['that Person is already seated in another Family — record the parents’ marriage first, then add the child to it']);
            }
            return { valid: true, errors: [], collection: 'families', action: 'update', familyId: origin.id, changes: { [otherSeat]: otherId } };
        }
        if (theirs) {
            const kids = (theirs.childIds || []).slice();
            kids.push(personId);
            return { valid: true, errors: [], collection: 'families', action: 'update', familyId: theirs.id, changes: { childIds: kids } };
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

    // ── The Household editor (MS-709) ────────────────────────────────────────
    //
    // A Household is a `families` record read as the people who live together:
    // the husband and wife (either may be empty — a single parent) and their
    // unmarried children. A child who is a husband or wife in another record
    // has left for their own Household; they stay in `childIds`, because that
    // is what places them in the Family tree. So "at home" and "their own
    // Household" are never stored, only read off marriage.
    //
    // The editor seats parents and children. It never sets a person's parents
    // or siblings: those are the same fact read from the other end.

    // The Household a Person lives in: their marriage, else the one they grew up in.
    // Were they left seated in two records (see householdDuplicates), the one
    // with both parents and then the most children is the Household they live in.
    function householdOf(families, personId) {
        const seated = (families || []).filter(f => personId && (f.husbandId === personId || f.wifeId === personId));
        if (!seated.length) return familyOfChild(families, personId);
        const weight = f => (f.husbandId ? 1 : 0) + (f.wifeId ? 1 : 0);
        return seated.reduce((best, f) =>
            weight(f) > weight(best) || (weight(f) === weight(best) && (f.childIds || []).length > (best.childIds || []).length) ? f : best);
    }

    function householdView(families, family) {
        if (!family) return null;
        const atHome = [];
        const ownHousehold = [];
        (family.childIds || []).forEach(id => {
            const own = familyOfSpouse(families, id);
            if (own && own.id !== family.id) ownHousehold.push({ personId: id, familyId: own.id });
            else atHome.push(id);
        });
        return {
            familyId: family.id || null,
            husbandId: family.husbandId || null,
            wifeId: family.wifeId || null,
            atHome,
            ownHousehold,
            anniversary: family.anniversary || null,
        };
    }

    const SEATS = ['husbandId', 'wifeId'];

    // Who may fill a slot of `family` (null for a Household not yet written).
    // `slot` is 'husbandId' | 'wifeId' | 'child'. A husband is male and a wife
    // female; nobody is a husband or wife in two records, or a child in two.
    function householdCandidates(families, people, family, slot) {
        const fam = family || {};
        const inIt = [fam.husbandId, fam.wifeId].concat(fam.childIds || []).filter(Boolean);
        return (people || []).filter(p => {
            if (!p || !p.id || inIt.indexOf(p.id) !== -1) return false;
            if (slot === 'child') return !familyOfChild(families, p.id);
            if (seatFor(p) !== slot) return false;
            return !familyOfSpouse(families, p.id);
        });
    }

    function isEmptyFamily(f) {
        return !f.husbandId && !f.wifeId && !(f.childIds || []).length;
    }

    function findFamily(families, familyId) {
        return familyId ? (families || []).find(f => f.id === familyId) || null : null;
    }

    function planned(action, familyId, changes) {
        return { valid: true, errors: [], collection: 'families', action, familyId: familyId || null, changes };
    }

    // An update that would leave the record with nobody in it deletes it instead.
    function updateOrDelete(family, changes) {
        return isEmptyFamily({ ...family, ...changes })
            ? planned('delete', family.id, null)
            : planned('update', family.id, changes);
    }

    // Seat `personId` as husband or wife, or empty the seat when personId is null.
    // With no familyId the Household is created by its first parent.
    function planSetParent(families, familyId, seat, personId, personById) {
        if (SEATS.indexOf(seat) === -1) return refuse([`"${seat}" is not a parent seat`]);
        const family = findFamily(families, familyId);
        if (familyId && !family) return refuse(['that Household no longer exists']);

        if (!personId) {
            if (!family) return refuse(['there is no Household to change']);
            return updateOrDelete(family, { [seat]: null });
        }

        const byId = typeof personById === 'function' ? personById : function () { return null; };
        const person = byId(personId);
        if (seatFor(person) !== seat) {
            return refuse([seat === 'husbandId'
                ? 'a husband must be recorded as male — set sex in Member Details first'
                : 'a wife must be recorded as female — set sex in Member Details first']);
        }
        const elsewhere = familyOfSpouse(families, personId);
        if (elsewhere && (!family || elsewhere.id !== family.id)) {
            return refuse(['that Person is already a husband or wife in another Household']);
        }
        if (family && (family.childIds || []).indexOf(personId) !== -1) {
            return refuse(['that Person is a child of this Household']);
        }
        if (!family) return planned('create', null, { [seat]: personId, childIds: [] });
        return planned('update', family.id, { [seat]: personId });
    }

    function planAddChild(families, familyId, childId) {
        const family = findFamily(families, familyId);
        if (!family) return refuse(['add a parent before adding children']);
        if (!childId) return refuse(['choose a child']);
        if (family.husbandId === childId || family.wifeId === childId) {
            return refuse(['that Person is a parent of this Household']);
        }
        if ((family.childIds || []).indexOf(childId) !== -1) return refuse(['that Person is already a child of this Household']);
        if (familyOfChild(families, childId)) return refuse(['that Person is already a child in another Household']);
        return planned('update', family.id, { childIds: (family.childIds || []).concat(childId) });
    }

    function planRemoveChild(families, familyId, childId) {
        const family = findFamily(families, familyId);
        if (!family || (family.childIds || []).indexOf(childId) === -1) {
            return refuse(['that Person is not a child of this Household']);
        }
        return updateOrDelete(family, { childIds: family.childIds.filter(id => id !== childId) });
    }

    function planSetAnniversary(families, familyId, value) {
        const family = findFamily(families, familyId);
        if (!family) return refuse(['there is no Household to change']);
        return planned('update', family.id, { anniversary: value || null });
    }

    // Other records that seat one of this Household's parents in the same seat.
    // Nobody may be a husband or wife in two records, but older edits left some
    // behind: a mother recorded alone with one child, and again with her husband
    // and the rest. Each of those children is then drawn under her only.
    // `mergeable` is false when the other record names a different spouse — a
    // second marriage, which is not the same Household recorded twice.
    function householdDuplicates(families, family) {
        if (!family) return [];
        return (families || [])
            .filter(f => f.id !== family.id && SEATS.some(s => family[s] && f[s] === family[s]))
            .map(f => ({
                familyId: f.id,
                sharedIds: SEATS.filter(s => family[s] && f[s] === family[s]).map(s => family[s]),
                childIds: (f.childIds || []).slice(),
                mergeable: SEATS.every(s => !f[s] || !family[s] || f[s] === family[s]),
            }));
    }

    // Fold `dropId` into `keepId`: one record with both records' parents and
    // children, and the other deleted. Two writes, so the plan names both.
    function planMergeHouseholds(families, keepId, dropId) {
        const keep = findFamily(families, keepId);
        const drop = findFamily(families, dropId);
        if (!keep || !drop || keep.id === drop.id) return refuse(['those Households no longer exist']);
        if (!SEATS.some(s => keep[s] && keep[s] === drop[s])) return refuse(['those Households share no parent']);
        if (!SEATS.every(s => !keep[s] || !drop[s] || keep[s] === drop[s])) {
            return refuse(['those Households have different husbands or wives, so they are not the same Household']);
        }
        const parents = SEATS.map(s => keep[s] || drop[s]).filter(Boolean);
        const childIds = [];
        (keep.childIds || []).concat(drop.childIds || []).forEach(id => {
            if (parents.indexOf(id) === -1 && childIds.indexOf(id) === -1) childIds.push(id);
        });
        return Object.assign(planned('merge', keep.id, {
            husbandId: keep.husbandId || drop.husbandId || null,
            wifeId: keep.wifeId || drop.wifeId || null,
            childIds,
            anniversary: keep.anniversary || drop.anniversary || null,
        }), { deleteId: drop.id });
    }

    // The Family tree drawn as a pedigree (MS-709 layout C), from one Household
    // down: each child either stays a leaf or, once married, becomes the couple
    // of their own Household with their children beneath. `origins` are the
    // Households the two parents grew up in, drawn above. Chained records are
    // not trusted to be acyclic, so a Household is drawn at most once.
    function familyTree(families, familyId, maxDepth) {
        const root = findFamily(families, familyId);
        if (!root) return null;
        const limit = typeof maxDepth === 'number' ? maxDepth : 6;
        const drawn = new Set();

        function node(fam, depth) {
            drawn.add(fam.id);
            return {
                familyId: fam.id,
                husbandId: fam.husbandId || null,
                wifeId: fam.wifeId || null,
                children: (fam.childIds || []).map(id => {
                    const own = familyOfSpouse(families, id);
                    const grows = own && own.id !== fam.id && !drawn.has(own.id) && depth < limit;
                    return { personId: id, household: grows ? node(own, depth + 1) : null };
                }),
            };
        }

        const tree = node(root, 0);
        const origins = [root.husbandId, root.wifeId].filter(Boolean).map(pid => {
            const o = familyOfChild(families, pid);
            if (!o || drawn.has(o.id)) return null;
            return { forPersonId: pid, familyId: o.id, husbandId: o.husbandId || null, wifeId: o.wifeId || null };
        }).filter(Boolean);
        return { root: tree, origins };
    }

    // ── Families (MS-709) ────────────────────────────────────────────────────
    //
    // A Family is a tree of Households, never stored. It starts at a Household
    // whose father (the single parent, when there is no husband) is nobody's
    // recorded child, and takes in every Household its children start when they
    // marry, all the way down. A married daughter's Household is in her parents'
    // Family and, when her husband's parents are not recorded, it starts his.
    //
    // It is named for that top father: "Hatley family", or "Hatley, Ambrose
    // family" once two Families share the surname.

    function familyHouseholdIds(families, rootId) {
        const tree = familyTree(families, rootId, 12);
        if (!tree) return [];
        const out = [];
        (function walk(node, depth) {
            out.push({ familyId: node.familyId, depth });
            node.children.forEach(k => { if (k.household) walk(k.household, depth + 1); });
        })(tree.root, 0);
        return out;
    }

    function familyTrees(families, people) {
        const list = families || [];
        const roots = list.filter(f => !isEmptyFamily(f) && !familyOfChild(list, f.husbandId || f.wifeId || null));
        const named = roots.map(root => {
            const fatherId = root.husbandId || root.wifeId || (root.childIds || [])[0] || null;
            const parts = String(nameIn(people, fatherId) || '').trim().split(/\s+/).filter(Boolean);
            const households = familyHouseholdIds(list, root.id);
            const peopleIds = [];
            households.forEach(h => {
                const f = findFamily(list, h.familyId);
                [f.husbandId, f.wifeId].concat(f.childIds || []).forEach(id => {
                    if (id && peopleIds.indexOf(id) === -1) peopleIds.push(id);
                });
            });
            return {
                id: root.id,
                fatherId,
                surname: parts.length ? parts[parts.length - 1] : 'Unnamed',
                firstName: parts.length > 1 ? parts[0] : '',
                households,
                peopleIds,
            };
        });
        const bySurname = {};
        named.forEach(t => { const k = t.surname.toLowerCase(); bySurname[k] = (bySurname[k] || 0) + 1; });
        const seen = {};
        return named
            .map(t => {
                let name = bySurname[t.surname.toLowerCase()] > 1 && t.firstName
                    ? t.surname + ', ' + t.firstName + ' family'
                    : t.surname + ' family';
                seen[name] = (seen[name] || 0) + 1;
                if (seen[name] > 1) name += ' (' + seen[name] + ')';
                return Object.assign(t, { name });
            })
            .sort((a, b) => a.name.localeCompare(b.name));
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
        // the Household editor (MS-709)
        householdOf,
        householdView,
        householdCandidates,
        planSetParent,
        planAddChild,
        planRemoveChild,
        planSetAnniversary,
        householdDuplicates,
        planMergeHouseholds,
        familyTree,
        familyTrees,
        familyHouseholdIds,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = FamilyCore;
    }
    if (global) {
        global.FamilyCore = FamilyCore;
    }
})(typeof window !== 'undefined' ? window : null);
