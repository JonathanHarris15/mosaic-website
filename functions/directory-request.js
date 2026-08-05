// Pure decision logic for resolving a Directory Request — anything a person
// asks the church to change about their own directory record (CONTEXT.md,
// ADR-0025, ADR-0027). The callable in index.js wraps these decisions with
// reads and writes; the rules themselves live here so they can be unit-tested
// without Firestore.
//
// Why the server decides at all: approving a link writes users/{uid}.personId,
// and the `users` collection is admin-only for a good reason — a rule loose
// enough to let an editor link an account would also let them edit permission
// levels. Approving a name fix or a Family change writes to `people` and
// `families` on behalf of someone who may not be an editor at all. All of it
// therefore happens on the server, and no browser ever resolves a request.
//
// This file deliberately does NOT import public/directory-request-core.js:
// Cloud Functions deploy only the functions/ directory. The shared vocabulary
// below is duplicated on purpose and pinned to the client copy by
// test/directory-request.test.js, exactly as member-sync.js duplicates
// MEMBER_TAG.

const track = require("./membership-track");
const familyPlan = require("./family-plan");

const STATUS = {
  PENDING: "pending",
  APPROVED: "approved",
  DECLINED: "declined",
};

const KIND = {
  LINK_MATCH: "link_match",
  LINK_NEW: "link_new",
  NAME_FIX: "name_fix",
  FAMILY: "family",
};

const KINDS = [KIND.LINK_MATCH, KIND.LINK_NEW, KIND.NAME_FIX, KIND.FAMILY];

// Editors, elders, admins and super admins may resolve a request. Mirrors the
// Firestore `isEditor()` helper and the directory's `canEdit` — an elder knows
// the congregation and should not need an admin to confirm a name.
const RESOLVER_LEVELS = ["editor", "elder", "admin", "super_admin"];

/**
 * May this permission level approve or decline a Directory Request?
 * @param {?string} permissionLevel The caller's permission level.
 * @return {boolean} True for editor, elder, admin and super_admin.
 */
function canResolve(permissionLevel) {
  return RESOLVER_LEVELS.includes(permissionLevel);
}

// A Person created from a link_new request starts at the FIRST Membership Stage
// — Visitor. Someone who says "I'm not in your directory" is, as far as the
// church's records go, exactly that until an editor moves them along the Track;
// assuming anything further would let a stranger self-declare into membership.
const INITIAL_STAGE = track.MEMBERSHIP_STAGES[0];
const INITIAL_STAGE_TAGS = track.membershipTagsFor({stage: INITIAL_STAGE});

/**
 * The `people/{id}` document body for a link_new request's Person. The caller
 * adds createdAt/updatedAt (server timestamps are not plain values) and userId,
 * written in the same batch as the reciprocal users/{uid}.personId.
 *
 * @param {?Object} proposed The `proposed` block off the request.
 * @return {Object} Fields for the new Person document.
 */
function newPersonFields(proposed) {
  const p = proposed || {};
  const contact = p.contact || {};
  return {
    name: p.name,
    totalInvolvements: 0,
    contact: {
      email: contact.email || "",
      phone: contact.phone || "",
      address: contact.address || "",
    },
    birthday: p.birthday || null,
    sex: p.sex || null,
    lastPastoralPrayerDate: null,
    membership: {stage: INITIAL_STAGE, inactive: false},
    tags: INITIAL_STAGE_TAGS.slice(),
  };
}

/**
 * A refusal, with the reason the approver should be shown.
 * @param {string} reason Why approval cannot proceed.
 * @return {{action: string, reason: string}} The plan.
 */
function refuse(reason) {
  return {action: "refuse", reason: reason};
}

/**
 * Decide what approving a LINK request should do, given the world as it is NOW.
 *
 * Everything here is a race that actually happens: a request sits in the queue
 * for days while an admin links the account by hand, or two elders open the
 * inbox at once, or the Person gets merged away. So the plan is computed from
 * fresh reads at approval time, never from what the request said when filed.
 *
 * @param {?Object} request The stored Directory Request.
 * @param {?Object} ctx Fresh state: `requesterPersonId` (users/{uid}.personId
 *   as it stands now), `overridePersonId` (a Person the approver picked
 *   instead — how an editor redirects "add me" onto a record that already
 *   exists), and `target` ({exists, userId}) for the Person id resolved to.
 * @return {Object} `link` an existing Person, `create` one from the proposal,
 *   or `refuse` with a reason.
 */
function planLinkApproval(request, ctx) {
  const r = request || {};
  const c = ctx || {};

  if (r.status !== STATUS.PENDING) {
    return refuse("This request has already been resolved.");
  }

  // Somebody linked this account while the request was queued. Approving now
  // would silently re-point their link at a different Person, which is how a
  // member ends up editing someone else's contact details.
  if (c.requesterPersonId) {
    return refuse(
        "This account is already linked to a directory record. " +
        "Decline this request, or unlink the account first.");
  }

  const personId = c.overridePersonId ||
    (r.kind === KIND.LINK_MATCH ? r.personId : null);

  // No existing Person named: the only remaining path is creating one, and
  // only a link_new request carries the details to create it from.
  if (!personId) {
    if (r.kind !== KIND.LINK_NEW) {
      return refuse("This request names no directory record.");
    }
    if (!r.proposed || !r.proposed.name) {
      return refuse("This request has no name to create a record from.");
    }
    return {action: "create", personId: null, reason: null};
  }

  const target = c.target || {};
  if (!target.exists) {
    return refuse("That directory record no longer exists.");
  }
  // Claimed by someone else. Never steal a link: the other account would be
  // left pointing at a Person that no longer points back.
  if (target.userId && target.userId !== r.uid) {
    return refuse(
        "That directory record is already linked to another account.");
  }

  return {action: "link", personId: personId, reason: null};
}

/**
 * Decide what approving a NAME FIX should do.
 *
 * The guard that matters is that the Person is STILL the requester's own. A
 * name fix is only ever a person correcting their own record; if the link moved
 * while the request was queued, approving would rename a stranger.
 *
 * @param {?Object} request The stored Directory Request.
 * @param {?Object} ctx Fresh state: `requesterPersonId` and `target`
 *   ({exists, name}).
 * @return {Object} `rename` with the new name, or `refuse` with a reason.
 */
function planNameFixApproval(request, ctx) {
  const r = request || {};
  const c = ctx || {};
  const target = c.target || {};

  if (r.status !== STATUS.PENDING) {
    return refuse("This request has already been resolved.");
  }
  const name = (r.proposed && r.proposed.name || "").trim();
  if (!name) {
    return refuse("This request carries no name.");
  }
  if (!r.personId || c.requesterPersonId !== r.personId) {
    return refuse(
        "This account is no longer linked to that directory record.");
  }
  if (!target.exists) {
    return refuse("That directory record no longer exists.");
  }
  if (target.name === name) {
    return refuse("That record already has this spelling.");
  }

  return {action: "rename", personId: r.personId, name: name, reason: null};
}

/**
 * Decide what approving a FAMILY change should do.
 *
 * The decision is not made here — it is REPLAYED through the same planners the
 * Membership Directory uses (FamilyCore's write-through, ADR-0014 §4), against
 * families and people as they stand at approval time. That matters: a request
 * to add a spouse filed last week may now be impossible because one of them was
 * married in the meantime, and the planner is where that rule already lives.
 *
 * @param {?Object} request The stored Directory Request.
 * @param {?Object} ctx Fresh state: `requesterPersonId`, `families` (all of
 *   them), and `personById` (a resolver over the People involved).
 * @return {Object} A `family` plan carrying the planner's write, or `refuse`.
 */
function planFamilyApproval(request, ctx) {
  const r = request || {};
  const c = ctx || {};
  const f = r.family || {};

  if (r.status !== STATUS.PENDING) {
    return refuse("This request has already been resolved.");
  }
  if (!r.personId || c.requesterPersonId !== r.personId) {
    return refuse(
        "This account is no longer linked to that directory record.");
  }
  if (!f.otherId || familyPlan.KINDS.indexOf(f.relation) === -1) {
    return refuse("This request names no Family relation.");
  }

  const plan = f.op === "remove" ?
    familyPlan.planRemoveFamilyRelation(
        c.families, r.personId, f.relation, f.otherId) :
    familyPlan.planAddFamilyRelation(
        c.families, r.personId, f.relation, f.otherId, c.personById);

  if (!plan.valid) {
    // The planner's reasons are already written for a human — surface them
    // rather than inventing a second vocabulary for the same refusals.
    return refuse("Cannot be applied: " + plan.errors.join("; ") + ".");
  }

  return {
    action: "family",
    familyAction: plan.action,
    familyId: plan.familyId,
    changes: plan.changes,
    reason: null,
  };
}

/**
 * Route a request to the right planner.
 * @param {?Object} request The stored Directory Request.
 * @param {?Object} ctx Fresh state for whichever planner applies.
 * @return {Object} The plan.
 */
function planApproval(request, ctx) {
  const kind = (request || {}).kind;
  if (kind === KIND.LINK_MATCH || kind === KIND.LINK_NEW) {
    return planLinkApproval(request, ctx);
  }
  if (kind === KIND.NAME_FIX) return planNameFixApproval(request, ctx);
  if (kind === KIND.FAMILY) return planFamilyApproval(request, ctx);
  return refuse("Unknown request kind.");
}

module.exports = {
  STATUS,
  KIND,
  KINDS,
  RESOLVER_LEVELS,
  INITIAL_STAGE,
  INITIAL_STAGE_TAGS,
  canResolve,
  newPersonFields,
  planLinkApproval,
  planNameFixApproval,
  planFamilyApproval,
  planApproval,
};
