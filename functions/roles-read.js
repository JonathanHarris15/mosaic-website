/**
 * Reading the stored Role Definitions on the server (MS-16, ADR-0016).
 *
 * ⚠ ONE WAY TO TURN A SLUG INTO A ROLE. The functions used to ask
 * `where("slug", "==", x).limit(1)`, which found nothing for a Role stored
 * without a slug (so its rules were never checked) and an arbitrary one of two
 * Roles that shared a slug (so a take was judged against the other Role's
 * slots and rules). The browser resolved the same documents differently. Both
 * now go through RolesCore.registry, which is synced into functions/shared:
 * a slugless Role reads as its name slugified, and a shared slug resolves to
 * nothing — refused, not guessed.
 *
 * The whole collection is read: it is a few dozen documents, and resolving a
 * slug honestly means knowing whether any OTHER document reads as it too.
 */

const RolesCore = require("./shared/roles-core.js");

/**
 * @param {Object} db the Firestore handle
 * @return {Promise<*>} RolesCore.registry over every stored definition
 */
async function loadRoleRegistry(db) {
  const snap = await db.collection("roles").get();
  return RolesCore.registry(
      snap.docs.map((d) => Object.assign({id: d.id}, d.data())));
}

module.exports = {loadRoleRegistry};
