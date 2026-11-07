// Who is calling, as a Person (MS-811).
//
// The Roles callables act for "the caller's own Person": take a place, answer
// an Assignment, offer a swap. Until MS-811 they took that Person straight
// from users/{uid}.personId, and a brand-new sign-up could write that field
// itself, so any account could act as any member.
//
// The rules now refuse a client-written personId. This is the second wall,
// because one wall is a wall somebody forgets: the link is bidirectional
// (users/{uid}.personId <-> people/{personId}.userId, see CONTEXT.md), and a
// caller only counts as a Person when BOTH halves agree. A users doc that
// points at somebody whose record does not point back is a ghost link, and a
// ghost link is treated as no link at all.

/** @typedef {import("firebase-admin/firestore").Firestore} Firestore */

/**
 * Read the caller's account and the Person it is truly linked to.
 *
 * @param {Firestore} db Admin Firestore.
 * @param {string} uid The caller's auth uid.
 * @return {Promise<{user: Object<string, *>, personId: ?string}>} The
 *   account (an empty object when there is none) and the Person id, or null
 *   when the account is not linked both ways.
 */
async function callerOf(db, uid) {
  const userSnap = await db.collection("users").doc(uid).get();
  // `exists` is what guarantees `data()`; the SDK's type cannot see that.
  const user = /** @type {Object<string, *>} */ (
    userSnap.exists ? userSnap.data() : {});
  const claimed = typeof user.personId === "string" && user.personId ?
    user.personId : null;
  if (!claimed) return {user, personId: null};

  const personSnap = await db.collection("people").doc(claimed).get();
  const linkedBack = personSnap.exists &&
    (/** @type {Object<string, *>} */ (personSnap.data())).userId === uid;
  return {user, personId: linkedBack ? claimed : null};
}

module.exports = {callerOf};
