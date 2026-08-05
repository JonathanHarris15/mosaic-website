// Breaking a Linked User (CONTEXT.md), server side.
//
// The link is bidirectional — users/{uid}.personId ↔ people/{personId}.userId —
// and until now only an admin could break it, from a modal in the profile
// page's admin panel. That is the wrong person and the wrong place. The mistake
// being corrected ("this account got connected to the wrong Person") is spotted
// by whoever is looking at the directory, which is an editor or an elder, and
// they cannot write the `users` collection: it is admin-only, because a rule
// loose enough to let an editor clear a personId would also let them change
// permission levels. So unlinking is a callable, and this is the decision half
// of it.
//
// Deliberately NOT part of directory-request.js. A Directory Request is
// something a person asks for; unlinking is something an editor does to a
// record. Sharing a file would imply a queue that does not exist.

// Editors, elders, admins and super admins may unlink. The same set that
// resolves Directory Requests and that the directory calls `canEdit` — anyone
// trusted to connect an account is trusted to disconnect it, and refusing the
// second while allowing the first would leave a mistake standing.
const UNLINK_LEVELS = ["editor", "elder", "admin", "super_admin"];

/**
 * May this permission level break a link?
 * @param {?string} permissionLevel The caller's permission level.
 * @return {boolean} True for editor, elder, admin and super_admin.
 */
function canUnlink(permissionLevel) {
  return UNLINK_LEVELS.includes(permissionLevel);
}

/**
 * Decide what unlinking a Person should do, from that Person as it stands now.
 *
 * Both sides are cleared or neither is. Clearing only `people.userId` would
 * leave the account still pointing at a Person that no longer points back —
 * the exact ghost `tearDownLogin` already exists to clean up, and the state
 * in which the next editor to connect that account fights something invisible.
 *
 * Note what is NOT undone. The Person keeps their Membership Stage, their tags
 * and every shepherding record: the member-status sync is add-only by design
 * (ADR-0026), and unlinking is a correction to an account connection, not a
 * statement that somebody stopped being a member. The Elder Tag DOES clear
 * itself, because it is projected from the linked account's permission level
 * and the reciprocal trigger reconciles it — the projection working, not
 * this function reaching past what it should.
 *
 * @param {?Object} person The Person record, or null if it is gone.
 * @return {{action: string, uid: ?string, reason: ?string}} `unlink` with the
 *   account to clear, or `refuse` with a reason.
 */
function planUnlink(person) {
  if (!person) {
    return {action: "refuse", uid: null,
      reason: "That directory record no longer exists."};
  }
  if (!person.userId) {
    return {action: "refuse", uid: null,
      reason: "That record is not connected to an account."};
  }
  return {action: "unlink", uid: person.userId, reason: null};
}

module.exports = {
  UNLINK_LEVELS,
  canUnlink,
  planUnlink,
};
