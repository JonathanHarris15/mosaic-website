// Pure decision logic for resolving a Link Request — a User's request to
// become a Linked User (CONTEXT.md, ADR-0025). The callable in index.js wraps
// these decisions with reads and writes; the rules themselves live here so
// they can be unit-tested without Firestore.
//
// Why the server decides at all: approving writes users/{uid}.personId, and
// the `users` collection is admin-only for a good reason — a rule loose enough
// to let an editor link an account would also let them edit permission levels.
// So editors and elders resolve requests through a callable, and the
// privileged writes stay on the server.
//
// This file deliberately does NOT import public/link-request-core.js: Cloud
// Functions deploy only the functions/ directory, so it cannot see it. The
// shared vocabulary below is duplicated on purpose and pinned to the client
// copy by test/link-request.test.js, exactly as member-sync.js duplicates
// MEMBER_TAG.

const track = require("./membership-track");

const STATUS = {
  PENDING: "pending",
  APPROVED: "approved",
  DECLINED: "declined",
};

const KIND = {
  MATCH: "match",
  NEW: "new",
};

// Editors, elders, admins and super admins may resolve a request. Mirrors the
// Firestore `isEditor()` helper and the directory's `canEdit` — an elder knows
// the congregation and should not need an admin to confirm a name.
const RESOLVER_LEVELS = ["editor", "elder", "admin", "super_admin"];

/**
 * May this permission level approve or decline a Link Request?
 * @param {?string} permissionLevel The caller's permission level.
 * @return {boolean} True for editor, elder, admin and super_admin.
 */
function canResolve(permissionLevel) {
  return RESOLVER_LEVELS.includes(permissionLevel);
}

// A Person created from a NEW request starts at the FIRST Membership Stage —
// Visitor. Someone who says "I'm not in your directory" is, as far as the
// church's records go, exactly that until an editor moves them along the Track;
// assuming anything further would let a stranger self-declare into membership.
//
// The stage and its projected tag are written together because the Membership
// Tag is a projection of the stage (ADR-0012), so the tags come from the
// projection rather than being typed out here.
const INITIAL_STAGE = track.MEMBERSHIP_STAGES[0];
const INITIAL_STAGE_TAGS = track.membershipTagsFor({stage: INITIAL_STAGE});

/**
 * The `people/{id}` document body for a NEW request's Person. The caller adds
 * createdAt/updatedAt (server timestamps are not plain values) and userId,
 * which is written in the same batch as the reciprocal users/{uid}.personId.
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
 * @return {{action: string, personId: ?string, reason: ?string}} The plan.
 */
function refuse(reason) {
  return {action: "refuse", personId: null, reason: reason};
}

/**
 * Decide what approving a request should do, given the world as it is NOW.
 *
 * Everything here is a race that actually happens: a request sits in the queue
 * for days while an admin links the account by hand, or two elders open the
 * inbox at once, or the Person gets merged away. So the plan is computed from
 * fresh reads at approval time, never from what the request said when filed.
 *
 * @param {?Object} request The stored Link Request.
 * @param {?Object} ctx Fresh state: `requesterPersonId` (users/{uid}.personId
 *   as it stands now), `overridePersonId` (a Person the approver picked
 *   instead — how an editor redirects "add me" onto a record that already
 *   exists), and `target` ({exists, userId}) for the Person id resolved to.
 * @return {{action: string, personId: ?string, reason: ?string}} `link` an
 *   existing Person, `create` one from the proposal, or `refuse` with a reason.
 */
function planApproval(request, ctx) {
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
    (r.kind === KIND.MATCH ? r.personId : null);

  // No existing Person named: the only remaining path is creating one, and
  // only a NEW request carries the details to create it from.
  if (!personId) {
    if (r.kind !== KIND.NEW) {
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

module.exports = {
  STATUS,
  KIND,
  RESOLVER_LEVELS,
  INITIAL_STAGE,
  INITIAL_STAGE_TAGS,
  canResolve,
  newPersonFields,
  planApproval,
};
