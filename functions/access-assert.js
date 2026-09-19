/**
 * Callable gates that restated AccessCore (MS-594).
 *
 * Firestore and the MCP already ask the shared core. Callables that the
 * browser reaches with httpsCallable must ask the same questions, or a
 * Pastoral Assistant who can see the chrome still gets permission-denied.
 *
 * Counted-as-elder stays Access.isAnElder — Elder Tag, pickers, digest.
 */

const {HttpsError} = require("firebase-functions/v2/https");
const Access = require("./shared/access-core.js");

/**
 * The caller's account from users/{uid}, or an empty object.
 * @param {object} db Firestore
 * @param {object} authCtx request.auth
 * @return {Promise<object>} permissionLevel + pastoralAssistant
 */
async function loadAccount(db, authCtx) {
  if (!authCtx || !authCtx.uid) {
    throw new HttpsError("unauthenticated", "Sign in first.");
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
    throw new HttpsError("permission-denied", "Elders only.");
  }
}

module.exports = {
  loadAccount,
  assertCanDecide,
};
