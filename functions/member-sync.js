// Pure decision logic for the add-only member-status sync between user accounts
// (users/{uid}) and directory people (people/{personId}). The two Firestore
// triggers in index.js wrap these decisions with reads/writes; the rules
// themselves — member-or-higher, add-only, never-demote, and the skip-write
// that stops the two triggers looping into each other — live here so they can
// be unit-tested in isolation.

const MEMBER_OR_HIGHER = ["member", "editor", "elder", "admin", "super_admin"];
const MEMBER_TAG = "member";

/** True when a role is "member" or any higher privilege. */
function isMemberOrHigher(role) {
  return MEMBER_OR_HIGHER.includes(role);
}

/**
 * Direction A — a linked user's role should grant the person the member tag iff
 * the role is member-or-higher AND the tag isn't already present. The tag-absent
 * check is what makes the write a no-op once synced, so the reciprocal trigger
 * isn't fired in a loop. Lower roles never tag and never untag (add-only).
 */
function shouldAddMemberTag(userRole, personTags) {
  return isMemberOrHigher(userRole) && !(personTags || []).includes(MEMBER_TAG);
}

/**
 * Direction B — a person's member tag should promote the linked user iff the
 * user is currently below member. Never demotes; returns false when the user is
 * already member-or-higher, which also skips the write and avoids a loop.
 */
function shouldPromoteToMember(currentRole) {
  return !isMemberOrHigher(currentRole);
}

module.exports = {
  MEMBER_OR_HIGHER,
  MEMBER_TAG,
  isMemberOrHigher,
  shouldAddMemberTag,
  shouldPromoteToMember,
};
