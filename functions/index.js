const {onCall} = require("firebase-functions/v2/https");
const {onDocumentWritten} = require("firebase-functions/v2/firestore");
const {log} = require("firebase-functions/logger");
const admin = require("firebase-admin");

/**
 * @fileoverview Firebase Cloud Functions for the Mosaic Website.
 * This file contains the callable HTTPS functions used by the frontend.
 */

// Initialize admin at the top level
if (!admin.apps.length) {
  admin.initializeApp();
}

/**
 * Cache for the hymn index to reduce Firestore read costs.
 * @type {Array<Object>|null}
 */
let cachedIndex = null;

/**
 * Timestamp of the last cache update in milliseconds.
 * @type {number}
 */
let lastCacheTime = 0;

/**
 * Cache Time-To-Live (TTL) in milliseconds.
 * @type {number}
 */
const CACHE_TTL_MS = 1000 * 60 * 5; // 5 minutes

/**
 * A Callable Cloud Function that fetches the entire hymn index from Firestore.
 * 
 * This function returns a simplified list of hymns with basic metadata,
 * optimized for search and display in the frontend lookup tool.
 * Results are cached in memory for 5 minutes.
 * 
 * @param {Object} request - The request object.
 * @returns {Promise<Array<Object>>} A promise that resolves to an array of hymn objects.
 * @property {string} id - The Firestore document ID.
 * @property {string} hymn_name - The title of the hymn.
 * @property {number} variations - The number of available versions/arrangements.
 * @property {string} music_writer - The composer of the music.
 * @property {string} lyrics_writer - The author of the lyrics.
 * @property {string|null} last_played_date - The last date the hymn was played.
 * @property {Array<string>} tags - Descriptive tags for the hymn.
 * @property {string} database_url - Relative URL to the hymn details page.
 */
exports.getHymnIndex = onCall({cors: true, region: "us-central1"}, async (request) => {
  if (cachedIndex && (Date.now() - lastCacheTime < CACHE_TTL_MS)) {
    log("Returning index from memory cache.");
    return cachedIndex;
  }

  log("Function 'getHymnIndex' called. Fetching data from Firestore...");

  const db = admin.firestore();

  // 1. Query the entire 'hymns' collection
  const hymnsSnapshot = await db.collection("hymns").orderBy("hymn_name").get();

  // 2. Map the documents to the simpler index structure
  const hymnIndexData = hymnsSnapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      hymn_name: data.hymn_name || "Unknown",
      variations: data.versions ? data.versions.length : 0,
      music_writer: data.music_writer || "Unknown",
      lyrics_writer: data.lyrics_writer || "Unknown",
      last_played_date: data.last_played_date || null,
      tags: data.tags || [],
      database_url: `/hymns/${doc.id}`,
    };
  });

  log(`Returning index with ${hymnIndexData.length} hymns.`);
  
  cachedIndex = hymnIndexData;
  lastCacheTime = Date.now();

  return hymnIndexData;
});

/**
 * A Callable Cloud Function that allows admins to create new users.
 */
exports.createUser = onCall({cors: true, region: "us-central1"}, async (request) => {
  // 1. Check if the caller is an admin
  if (!request.auth) {
    throw new Error("The function must be called while authenticated.");
  }

  const callerUid = request.auth.uid;
  const db = admin.firestore();
  const callerDoc = await db.collection("users").doc(callerUid).get();
  
  if (!callerDoc.exists || !["admin", "super_admin"].includes(callerDoc.data().role)) {
    throw new Error("Only admins can create new users.");
  }

  const {email, password, role} = request.data;

  if (!email || !password || !role) {
    throw new Error("Missing required fields: email, password, or role.");
  }

  try {
    // 2. Create the user in Firebase Auth
    const userRecord = await admin.auth().createUser({
      email: email,
      password: password,
    });

    // 3. Store the user's role and password in Firestore
    await db.collection("users").doc(userRecord.uid).set({
      email: email,
      role: role,
      password: password, // Storing for admin visibility as requested
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    log(`Successfully created new user: ${userRecord.uid}`);
    return {uid: userRecord.uid};
  } catch (error) {
    log(`Error creating user: ${error.message}`);
    throw new Error(error.message);
  }
});

/**
 * A Callable Cloud Function that allows admins to delete users.
 */
exports.deleteUser = onCall({cors: true, region: "us-central1"}, async (request) => {
  if (!request.auth) {
    throw new Error("The function must be called while authenticated.");
  }

  const callerUid = request.auth.uid;
  const db = admin.firestore();
  const callerDoc = await db.collection("users").doc(callerUid).get();
  
  if (!callerDoc.exists || !["admin", "super_admin"].includes(callerDoc.data().role)) {
    throw new Error("Only admins can delete users.");
  }

  const {uid} = request.data;
  if (!uid) {
    throw new Error("Missing user UID.");
  }

  if (uid === callerUid) {
    throw new Error("Admins cannot delete themselves.");
  }

  try {
    // Delete from Auth
    await admin.auth().deleteUser(uid);
    // Delete from Firestore
    await db.collection("users").doc(uid).delete();

    log(`Successfully deleted user: ${uid}`);
    return {success: true};
  } catch (error) {
    log(`Error deleting user: ${error.message}`);
    throw new Error(error.message);
  }
});

/**
 * A Callable Cloud Function that allows admins to update any user's password.
 */
exports.updateUserPasswordAdmin = onCall({cors: true, region: "us-central1"}, async (request) => {
  if (!request.auth) {
    throw new Error("The function must be called while authenticated.");
  }

  const callerUid = request.auth.uid;
  const db = admin.firestore();
  const callerDoc = await db.collection("users").doc(callerUid).get();
  
  if (!callerDoc.exists || !["admin", "super_admin"].includes(callerDoc.data().role)) {
    throw new Error("Only admins can update user passwords.");
  }

  const {uid, newPassword} = request.data;
  if (!uid || !newPassword) {
    throw new Error("Missing required fields: uid or newPassword.");
  }

  try {
    // Update Auth
    await admin.auth().updateUser(uid, {
      password: newPassword,
    });
    // Update Firestore
    await db.collection("users").doc(uid).update({
      password: newPassword,
    });

    log(`Successfully updated password for user: ${uid}`);
    return {success: true};
  } catch (error) {
    log(`Error updating user password: ${error.message}`);
    throw new Error(error.message);
  }
});

/**
 * A Callable Cloud Function that allows users to update their own password.
 * Note: Frontend handles the 're-auth' requirement by asking for old password,
 * but since we store it in Firestore, we can verify it here too.
 */
exports.updateUserPasswordSelf = onCall({cors: true, region: "us-central1"}, async (request) => {
  if (!request.auth) {
    throw new Error("The function must be called while authenticated.");
  }

  const uid = request.auth.uid;
  const {oldPassword, newPassword} = request.data;

  if (!oldPassword || !newPassword) {
    throw new Error("Missing required fields: oldPassword or newPassword.");
  }

  const db = admin.firestore();
  const userDoc = await db.collection("users").doc(uid).get();

  if (!userDoc.exists) {
    throw new Error("User record not found.");
  }

  const userData = userDoc.data();
  if (userData.password !== oldPassword) {
    throw new Error("Incorrect current password.");
  }

  try {
    // Update Auth
    await admin.auth().updateUser(uid, {
      password: newPassword,
    });
    // Update Firestore
    await db.collection("users").doc(uid).update({
      password: newPassword,
    });

    log(`User ${uid} successfully updated their own password.`);
    return {success: true};
  } catch (error) {
    log(`Error updating self password: ${error.message}`);
    throw new Error(error.message);
  }
});

/**
 * Member-status synchronisation between user accounts and directory people.
 *
 * A user account (`users/{uid}`) can be linked to a directory person
 * (`people/{personId}`) via reciprocal `personId` / `userId` fields. When the
 * link exists, "member" status is kept in sync in an ADD-ONLY fashion:
 *
 *   • A user whose role is member-or-higher marks their person with the
 *     "member" tag.
 *   • A person carrying the "member" tag promotes their user from viewer to
 *     member — but never demotes a user who already holds a higher role.
 *
 * Removing the role or the tag never strips the other side; that is cleared
 * manually. Both triggers read the target before writing and skip the write
 * when no change is needed, which keeps the two triggers from looping into
 * each other.
 */
const {
  MEMBER_TAG,
  MEMBER_ROLE,
  isMemberOrHigher,
  hasMemberTag,
  shouldAddMemberTag,
  shouldPromoteToMember,
} = require("./member-sync");

/**
 * Direction A: a user's role grants the linked person the "member" tag.
 */
exports.syncRoleToMemberTag = onDocumentWritten(
    {document: "users/{uid}", region: "us-central1"},
    async (event) => {
      const after = event.data && event.data.after && event.data.after.exists ?
        event.data.after.data() : null;
      if (!after) return; // Deleted — add-only, nothing to mirror.

      const personId = after.personId;
      if (!personId) return; // Not linked to a person.
      if (!isMemberOrHigher(after.role)) return; // Viewer/unknown: never tag, never untag (skip the read).

      const db = admin.firestore();
      const personRef = db.collection("people").doc(personId);
      const personSnap = await personRef.get();
      if (!personSnap.exists) return;

      const tags = personSnap.data().tags || [];
      if (!shouldAddMemberTag(after.role, tags)) return; // Already tagged — skip write to avoid a trigger loop.

      // Make sure the tag exists in the directory's tag registry so it shows in the Tags Manager.
      await db.collection("people_tags").doc(MEMBER_TAG).set({name: MEMBER_TAG}, {merge: true});
      await personRef.update({
        tags: admin.firestore.FieldValue.arrayUnion(MEMBER_TAG),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      log(`Tagged person ${personId} as '${MEMBER_TAG}' (linked user role: ${after.role}).`);
    },
);

/**
 * Direction B: a person's "member" tag promotes the linked user to member.
 */
exports.syncMemberTagToRole = onDocumentWritten(
    {document: "people/{personId}", region: "us-central1"},
    async (event) => {
      const after = event.data && event.data.after && event.data.after.exists ?
        event.data.after.data() : null;
      if (!after) return; // Deleted — add-only, nothing to mirror.

      const userId = after.userId;
      if (!userId) return; // Not linked to a user.
      const tags = after.tags || [];
      if (!hasMemberTag(tags)) return; // No member tag (any casing): never promote, never demote.

      const db = admin.firestore();
      const userRef = db.collection("users").doc(userId);
      const userSnap = await userRef.get();
      if (!userSnap.exists) return;

      const role = userSnap.data().role || "viewer";
      if (!shouldPromoteToMember(role)) return; // Already member+ — never demote, and skip write to avoid a loop.

      await userRef.update({role: MEMBER_ROLE});
      log(`Promoted user ${userId} from '${role}' to '${MEMBER_ROLE}' (linked person has the member tag).`);
    },
);

