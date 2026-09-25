/**
 * Callable gates that restated AccessCore (MS-594).
 *
 * Firestore and the MCP already ask the shared core. Callables that the
 * browser reaches with httpsCallable must ask the same questions, or a
 * Pastoral Assistant who can see the chrome still gets permission-denied.
 *
 * Counted-as-elder stays Access.isAnElder — Elder Tag, pickers, digest.
 *
 * This module is loaded by the root unit suite (`npm test`). It must not
 * require firebase-functions — that package lives in functions/node_modules
 * and the PR CI unit job only `npm ci`s the root tree.
 */

const Access = require("./shared/access-core.js");
const {isAdminPermissionLevel} = require("./sms.js");

/**
 * A gate refusal the callable maps onto HttpsError.
 * @param {string} code unauthenticated | permission-denied
 * @param {string} message what to say
 * @return {Error} the refusal
 */
function refuse(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

/**
 * The caller's account from users/{uid}, or an empty object.
 * @param {object} db Firestore
 * @param {object} authCtx request.auth
 * @return {Promise<object>} permissionLevel + pastoralAssistant
 */
async function loadAccount(db, authCtx) {
  if (!authCtx || !authCtx.uid) {
    throw refuse("unauthenticated", "Sign in first.");
  }
  const snap = await db.collection("users").doc(authCtx.uid).get();
  return snap.exists ? snap.data() : {};
}

/**
 * Throws unless the caller may make a shepherding decision write.
 * Elders, super admins, and a Pastoral Assistant (AccessCore.canDecide).
 * @param {object} db Firestore
 * @param {object} authCtx request.auth
 * @return {Promise<void>}
 */
async function assertCanDecide(db, authCtx) {
  const account = await loadAccount(db, authCtx);
  if (!Access.canDecide(account)) {
    throw refuse("permission-denied", "Elders only.");
  }
}

/**
 * Throws unless the caller writes the Membership Directory.
 * Editor, admin, elder, super admin. A Pastoral Assistant does not.
 * @param {object} db Firestore
 * @param {object} authCtx request.auth
 * @return {Promise<void>}
 */
async function assertWritesAsEditor(db, authCtx) {
  const account = await loadAccount(db, authCtx);
  if (!Access.writesAsEditor(account)) {
    throw refuse("permission-denied", "Editors only.");
  }
}

/**
 * Throws unless the caller runs the Admin Dashboard: admin or super_admin.
 *
 * An elder is not an admin here. The dashboard's tools reach the Textbelt
 * credit, the send path and, since MS-682, other people's Device tokens —
 * which the rules keep from every client, admin included. The callable is
 * the only door, so the door asks.
 *
 * @param {object} db Firestore
 * @param {object} authCtx request.auth
 * @param {string} [what] what the caller was reaching for
 * @return {Promise<void>}
 */
async function assertIsAdmin(db, authCtx, what) {
  const account = await loadAccount(db, authCtx);
  const level = account.permissionLevel || account.role;
  if (!isAdminPermissionLevel(level)) {
    throw refuse("permission-denied", what ?
      `Admins only — ${what}.` : "Admins only.");
  }
}

module.exports = {
  loadAccount,
  assertCanDecide,
  assertWritesAsEditor,
  assertIsAdmin,
};
