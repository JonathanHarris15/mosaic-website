// Pure decision logic for the add-only member-status sync between user accounts
// (users/{uid}) and directory people (people/{personId}). The two Firestore
// triggers in index.js wrap these decisions with reads/writes; the rules
// themselves — member-or-higher, add-only, never-demote, and the skip-write
// that stops the two triggers looping into each other — live here so they can
// be unit-tested in isolation.

const MEMBER_OR_HIGHER = ["member", "editor", "elder", "admin", "super_admin"];

// The directory tag carried by people. Canonical casing is capital-M "Member" —
// that is what the directory and the Service Builder/Calendar member queries
// match on (tags array-contains "Member"). Older writes added a lowercase
// "member", which the frontend queries miss; presence is therefore matched
// case-insensitively so we never add a second variant alongside an existing one.
const MEMBER_TAG = "Member";

// The user-account role granted by the member tag. Roles are lowercase, so this
// is deliberately distinct from MEMBER_TAG: the two used to share one constant,
// which conflated a directory tag with an account role.
const MEMBER_ROLE = "member";

/** True when a role is "member" or any higher privilege. */
function isMemberOrHigher(role) {
  return MEMBER_OR_HIGHER.includes(role);
}

/**
 * True when the person already carries the member tag in any casing. Whole-tag,
 * case-insensitive match — so "Member" and a legacy "member" both count, but a
 * different tag that merely contains the word (e.g. "Former Member") does not.
 */
function hasMemberTag(personTags) {
  const want = MEMBER_TAG.toLowerCase();
  return (personTags || []).some(
      (t) => typeof t === "string" && t.toLowerCase() === want);
}

/**
 * Direction A — a linked user's role should grant the person the member tag iff
 * the role is member-or-higher AND the tag isn't already present (in any casing).
 * The tag-absent check is what makes the write a no-op once synced, so the
 * reciprocal trigger isn't fired in a loop. Lower roles never tag and never
 * untag (add-only).
 */
function shouldAddMemberTag(userRole, personTags) {
  return isMemberOrHigher(userRole) && !hasMemberTag(personTags);
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
  MEMBER_ROLE,
  isMemberOrHigher,
  hasMemberTag,
  shouldAddMemberTag,
  shouldPromoteToMember,
};
