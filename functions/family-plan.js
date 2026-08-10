// The Family write-through planners (ADR-0012 / ADR-0014 §4), server side.
//
// A Family is `{ husbandId?, wifeId?, childIds[], anniversary? }` in its own
// `families` collection. Husband is one male Person, Wife one female Person; a
// Person is a spouse in at most one Family (their marriage) and a child in at
// most one Family (their family of origin), which is what keeps the
// generational walk unambiguous.
//
// These are pure PLANNERS: they return the single write to make, and a writer
// applies it —
//
//   { valid, errors, collection: 'families', action: 'create'|'update',
//     familyId?, changes }
//
// The canonical copy lives in public/family-core.js. Cloud Functions deploy
// only the functions/ directory, so approving a Family request (ADR-0027) needs
// its own copy of the planners it replays. This is that copy — the planner half
// only, not the resolvers or the serving-group code, which the server has no
// use for. test/family-plan-server.test.js runs both implementations over the
// same matrix of households and asserts they agree write for write, because two
// copies of this logic silently disagreeing about who is married to whom is
// exactly the failure worth spending a test on.

const KINDS = ["spouse", "parent", "child"];

/**
 * The Family in which `personId` is a spouse (husband or wife), or null.
 * @param {?Array<Object>} families All families.
 * @param {?string} personId The Person to look up.
 * @return {?Object} Their marriage, or null.
 */
function familyOfSpouse(families, personId) {
  if (!personId) return null;
  return (families || []).find(
      (f) => f.husbandId === personId || f.wifeId === personId) || null;
}

/**
 * The Family of origin: the Family whose childIds include `personId`, or null.
 * @param {?Array<Object>} families All families.
 * @param {?string} personId The Person to look up.
 * @return {?Object} Their family of origin, or null.
 */
function familyOfChild(families, personId) {
  if (!personId) return null;
  return (families || []).find(
      (f) => (f.childIds || []).indexOf(personId) !== -1) || null;
}

/**
 * The other spouse in a Family, given one spouse's id.
 * @param {?Object} family The family.
 * @param {?string} personId One spouse.
 * @return {?string} The other spouse's id, or null.
 */
function spouseOf(family, personId) {
  if (!family) return null;
  if (family.husbandId === personId) return family.wifeId || null;
  if (family.wifeId === personId) return family.husbandId || null;
  return null;
}

/**
 * A refused plan, carrying the reasons.
 * @param {Array<string>} errors Why it cannot be planned.
 * @return {Object} The refusal.
 */
function refuse(errors) {
  return {
    valid: false, errors, collection: "families",
    action: null, familyId: null, changes: null,
  };
}

/**
 * Which seat a Person takes in a Family. Husband is male, wife female; an unset
 * sex fails closed rather than guessing (ADR-0012).
 * @param {?Object} person The Person.
 * @return {?string} 'husbandId', 'wifeId', or null.
 */
function seatFor(person) {
  if (!person) return null;
  if (person.sex === "male") return "husbandId";
  if (person.sex === "female") return "wifeId";
  return null;
}

/**
 * The parent word for a seat.
 * @param {string} seat 'husbandId' or 'wifeId'.
 * @return {string} 'father' or 'mother'.
 */
function seatWord(seat) {
  return seat === "husbandId" ? "father" : "mother";
}

/**
 * Add a Family relation between `personId` and `otherId`.
 *
 *   spouse — seat them together (their marriage). Find-or-create.
 *   child  — append `otherId` to the children of the Family personId is married
 *            into. Find-or-create that Family.
 *   parent — seat `otherId` as a parent in personId's family of origin; when
 *            there is none, put the child in the parent's OWN household (their
 *            marriage) rather than minting a second one for the same couple.
 *
 * Find-or-create always asks "whose household is this already?" first. A Person
 * is a spouse in at most one Family, so no plan may ever seat somebody in a
 * second — that invariant is what stops one couple being recorded many times.
 *
 * @param {?Array<Object>} families All families, as they stand now.
 * @param {?string} personId The Person the relation belongs to.
 * @param {string} kind 'spouse', 'parent' or 'child'.
 * @param {?string} otherId The Person on the other end.
 * @param {Function} personById Resolves a Person id to a Person.
 * @return {Object} The plan.
 */
function planAddFamilyRelation(families, personId, kind, otherId, personById) {
  if (KINDS.indexOf(kind) === -1) {
    return refuse([`"${kind}" is not a Family relation`]);
  }
  if (!personId || !otherId) return refuse(["two People are required"]);
  if (personId === otherId) {
    return refuse(["a Person cannot be their own " + kind]);
  }

  const byId = typeof personById === "function" ?
    personById : function() {
      return null;
    };
  const self = byId(personId);
  const other = byId(otherId);

  if (kind === "spouse") {
    const selfSeat = seatFor(self);
    const otherSeat = seatFor(other);
    if (!selfSeat || !otherSeat) {
      return refuse([
        "both People need a recorded sex before they can be seated as " +
        "husband and wife",
      ]);
    }
    if (selfSeat === otherSeat) {
      return refuse(["a Family seats one husband and one wife"]);
    }
    const mine = familyOfSpouse(families, personId);
    if (mine && spouseOf(mine, personId)) {
      return refuse(["this Person already has a spouse"]);
    }
    const theirs = familyOfSpouse(families, otherId);
    if (theirs && spouseOf(theirs, otherId)) {
      return refuse(["that Person already has a spouse"]);
    }
    // Both already head a household of their own (each with children, say).
    // Seating one into the other's would leave them a spouse in two, so this
    // refuses rather than quietly recording the couple twice; joining two
    // households is a restructure, not a link.
    if (mine && theirs && mine.id !== theirs.id) {
      return refuse([
        "both People already head a Family of their own — those two " +
        "households have to be joined in the directory first",
      ]);
    }

    if (mine) {
      return {
        valid: true, errors: [], collection: "families",
        action: "update", familyId: mine.id, changes: {[otherSeat]: otherId},
      };
    }
    return {
      valid: true, errors: [], collection: "families",
      action: "create", familyId: null,
      changes: {[selfSeat]: personId, [otherSeat]: otherId, childIds: []},
    };
  }

  if (kind === "child") {
    // A Person is a child in at most one Family — that is what keeps the
    // generational walk unambiguous.
    if (familyOfChild(families, otherId)) {
      return refuse([
        "that Person is already a child in another Family " +
        "(they have a family of origin)",
      ]);
    }
    const mine = familyOfSpouse(families, personId);
    if (mine) {
      if (spouseOf(mine, personId) === otherId) {
        return refuse(["that Person is this Person’s spouse, not their child"]);
      }
      const kids = (mine.childIds || []).slice();
      if (kids.indexOf(otherId) !== -1) {
        return refuse(["that Person is already a child of this Family"]);
      }
      kids.push(otherId);
      return {
        valid: true, errors: [], collection: "families",
        action: "update", familyId: mine.id, changes: {childIds: kids},
      };
    }
    const selfSeat = seatFor(self);
    if (!selfSeat) {
      return refuse([
        "this Person needs a recorded sex before a Family can be created " +
        "for them",
      ]);
    }
    return {
      valid: true, errors: [], collection: "families",
      action: "create", familyId: null,
      changes: {[selfSeat]: personId, childIds: [otherId]},
    };
  }

  // kind === 'parent'
  const otherSeat = seatFor(other);
  if (!otherSeat) {
    return refuse([
      "that Person needs a recorded sex before they can be seated as a parent",
    ]);
  }

  // A parent's household is their marriage, if they have one. Everything below
  // hangs on that: a child joins the Family their parent is already seated in
  // rather than getting one of their own. Without this, naming both parents of
  // each child in turn minted a fresh Family per child — the same couple
  // recorded many times over, and as many spouse links between them.
  const theirs = familyOfSpouse(families, otherId);
  const origin = familyOfChild(families, personId);
  if (origin) {
    if (origin[otherSeat] === otherId) {
      return refuse([
        `that Person is already this Person's ${seatWord(otherSeat)}`,
      ]);
    }
    if (origin[otherSeat]) {
      return refuse([`this Person already has a ${seatWord(otherSeat)}`]);
    }
    // Seating them here would leave them a spouse in two households, and a
    // Person is a spouse in at most one.
    if (theirs && theirs.id !== origin.id) {
      return refuse([
        "that Person is already seated in another Family — record the " +
        "parents' marriage first, then add the child to it",
      ]);
    }
    return {
      valid: true, errors: [], collection: "families",
      action: "update", familyId: origin.id, changes: {[otherSeat]: otherId},
    };
  }
  if (theirs) {
    const kids = (theirs.childIds || []).slice();
    kids.push(personId);
    return {
      valid: true, errors: [], collection: "families",
      action: "update", familyId: theirs.id, changes: {childIds: kids},
    };
  }
  return {
    valid: true, errors: [], collection: "families",
    action: "create", familyId: null,
    changes: {[otherSeat]: otherId, childIds: [personId]},
  };
}

/**
 * Remove a Family relation. Removal is scoped to ONE individual's membership —
 * no other Person's place in the Family changes.
 *
 *   spouse — vacate the OTHER spouse's seat. A spouse link is one mutual field,
 *            so ending it necessarily ends it for both.
 *   child  — pull `otherId` from the children. Their siblings stay put.
 *   parent — pull `personId` from their family of origin. Because a Family
 *            seats exactly one father and one mother, a parent cannot be
 *            removed from one child without removing them from every sibling —
 *            so the individual leaves instead. `alsoDetaches` reports what else
 *            this Person loses, for the confirm.
 *
 * @param {?Array<Object>} families All families, as they stand now.
 * @param {?string} personId The Person the relation belongs to.
 * @param {string} kind 'spouse', 'parent' or 'child'.
 * @param {?string} otherId The Person on the other end.
 * @return {Object} The plan.
 */
function planRemoveFamilyRelation(families, personId, kind, otherId) {
  if (KINDS.indexOf(kind) === -1) {
    return refuse([`"${kind}" is not a removable Family relation`]);
  }
  if (!personId || !otherId) return refuse(["two People are required"]);

  if (kind === "spouse") {
    const family = familyOfSpouse(families, personId);
    if (!family || spouseOf(family, personId) !== otherId) {
      return refuse(["those two are not recorded as spouses"]);
    }
    const theirSeat = family.husbandId === otherId ? "husbandId" : "wifeId";
    return {
      valid: true, errors: [], collection: "families",
      action: "update", familyId: family.id, changes: {[theirSeat]: null},
    };
  }

  if (kind === "child") {
    const family = familyOfSpouse(families, personId);
    if (!family || (family.childIds || []).indexOf(otherId) === -1) {
      return refuse(["that Person is not recorded as a child of this Family"]);
    }
    return {
      valid: true, errors: [], collection: "families",
      action: "update", familyId: family.id,
      changes: {
        childIds: (family.childIds || []).filter((id) => id !== otherId),
      },
    };
  }

  // kind === 'parent'
  const origin = familyOfChild(families, personId);
  if (!origin ||
      (origin.husbandId !== otherId && origin.wifeId !== otherId)) {
    return refuse(["that Person is not recorded as a parent of this Person"]);
  }
  return {
    valid: true, errors: [], collection: "families",
    action: "update", familyId: origin.id,
    changes: {
      childIds: (origin.childIds || []).filter((id) => id !== personId),
    },
    alsoDetaches: {
      parentIds: [origin.husbandId, origin.wifeId].filter(Boolean),
      siblingIds: (origin.childIds || []).filter((id) => id !== personId),
    },
  };
}

module.exports = {
  KINDS,
  familyOfSpouse,
  familyOfChild,
  spouseOf,
  seatFor,
  planAddFamilyRelation,
  planRemoveFamilyRelation,
};
