// Pure decision logic for the Elder-Tag projection (ADR-0013, MS-92). The
// `elder` User role projects an immutable "Elder" tag onto the linked directory
// Person; unlinking, or a role change away from `elder`, removes it. The
// Firestore trigger in index.js wraps these decisions with reads/writes; the
// rules — elder-only, and the skip-write that keeps the trigger from looping —
// live here so they can be unit-tested in isolation.
//
// Unlike the member-tag sync (add-only), the Elder Tag is a Projected Tag: it is
// kept in exact sync with the source of truth, so it is BOTH added when a linked
// user becomes an elder AND removed when they stop being one (or are unlinked).
// Super Admins are a distinct office and are NOT elders.

const ELDER_PERMISSION_LEVEL = "elder";

// Canonical Elder Tag id/name. Tag identity is the name (ADR-0011), and this
// matches ShepherdingCore.ELDER_TAG_ID on the client so both surfaces agree.
const ELDER_TAG = "Elder";

/** True only for the elder level — super_admin is excluded (a distinct office). */
function isElderPermissionLevel(permissionLevel) {
  return permissionLevel === ELDER_PERMISSION_LEVEL;
}

/** True when the person already carries the Elder tag (exact-name match). */
function hasElderTag(personTags) {
  return (personTags || []).indexOf(ELDER_TAG) !== -1;
}

/**
 * Should the trigger ADD the Elder tag? Iff the linked user is an elder and the
 * person doesn't already carry it. The tag-absent check makes the write a no-op
 * once synced, so the trigger doesn't re-fire itself in a loop.
 */
function shouldAddElderTag(permissionLevel, personTags) {
  return isElderPermissionLevel(permissionLevel) && !hasElderTag(personTags);
}

/**
 * Should the trigger REMOVE the Elder tag? Iff the linked user is NOT an elder
 * (role changed away, or no link) yet the person still carries it. This is the
 * half the add-only member sync deliberately omits — the Elder Tag is projected,
 * so a stale tag must be cleared.
 */
function shouldRemoveElderTag(permissionLevel, personTags) {
  return !isElderPermissionLevel(permissionLevel) && hasElderTag(personTags);
}

module.exports = {
  ELDER_PERMISSION_LEVEL,
  ELDER_TAG,
  isElderPermissionLevel,
  hasElderTag,
  shouldAddElderTag,
  shouldRemoveElderTag,
};
