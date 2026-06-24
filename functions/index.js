const {onCall, onRequest, HttpsError} = require("firebase-functions/v2/https");
const {onDocumentWritten} = require("firebase-functions/v2/firestore");
const {defineSecret} = require("firebase-functions/params");
const {log} = require("firebase-functions/logger");
const admin = require("firebase-admin");
const {
  toE164US,
  isAdminRole,
  interpretQuota,
  interpretSend,
  parseInboundReply,
  verifyTextbeltSignature,
} = require("./sms");

/**
 * Prepaid Textbelt API key, held as a Firebase secret. Set or rotate it with:
 *   firebase functions:secrets:set TEXTBELT_KEY
 * Functions that send or check SMS declare this in their `secrets` option.
 */
const TEXTBELT_KEY = defineSecret("TEXTBELT_KEY");

/**
 * Public URL of the smsInbound HTTP function. Textbelt POSTs reply webhooks
 * here so test-text replies land in the sms_test_replies stack. This is the
 * stable cloudfunctions.net alias for the deployed function.
 */
const SMS_REPLY_WEBHOOK_URL =
  "https://us-central1-mosaic-hymn-database.cloudfunctions.net/smsInbound";

/** Firestore collection holding inbound replies to test texts. */
const SMS_REPLIES_COLLECTION = "sms_test_replies";

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

/* ------------------------------------------------------------------ *
 * SMS admin tools (Textbelt) — backing the Admin Dashboard.
 * ------------------------------------------------------------------ */

/**
 * Throws unless the authenticated caller is an admin/super_admin. The Admin
 * Dashboard is admin-only, but callable functions are reachable directly, so the
 * SMS tools re-check the role server-side rather than trusting the UI gate.
 * @param {import("firebase-admin").firestore.Firestore} db
 * @param {Object|undefined} authCtx - request.auth
 * @return {Promise<void>}
 */
async function assertAdmin(db, authCtx) {
  if (!authCtx) {
    throw new HttpsError("unauthenticated", "Sign in to use the SMS tools.");
  }
  const callerDoc = await db.collection("users").doc(authCtx.uid).get();
  if (!callerDoc.exists || !isAdminRole(callerDoc.data().role)) {
    throw new HttpsError("permission-denied", "Admins only.");
  }
}

/**
 * Reports whether a Textbelt key is configured and how many texts remain.
 * Admin-gated. Returns {configured, quotaRemaining, error}.
 */
exports.smsCheckQuota = onCall(
    {cors: true, region: "us-central1", secrets: [TEXTBELT_KEY]},
    async (request) => {
      await assertAdmin(admin.firestore(), request.auth);

      const key = TEXTBELT_KEY.value();
      if (!key) return interpretQuota(null, false);

      try {
        const resp = await fetch(`https://textbelt.com/quota/${key}`);
        const json = await resp.json();
        const result = interpretQuota(json, true);
        log(`smsCheckQuota: configured, quotaRemaining=${result.quotaRemaining}.`);
        return result;
      } catch (err) {
        log(`smsCheckQuota: Textbelt request failed: ${err.message}`);
        throw new HttpsError("unavailable", "Could not reach Textbelt to check quota.");
      }
    },
);

/**
 * Sends a one-off test SMS so admins can verify outbound delivery (and, if a
 * reply webhook is wired later, two-way messaging). Admin-gated; spends one
 * credit per send. Accepts {phone, message?} and returns the send result.
 */
exports.smsSendTest = onCall(
    {cors: true, region: "us-central1", secrets: [TEXTBELT_KEY]},
    async (request) => {
      await assertAdmin(admin.firestore(), request.auth);

      const key = TEXTBELT_KEY.value();
      if (!key) {
        throw new HttpsError(
            "failed-precondition",
            "No Textbelt key is configured. Set TEXTBELT_KEY first.");
      }

      const to = toE164US(request.data && request.data.phone);
      if (!to) {
        throw new HttpsError("invalid-argument", "Enter a valid US phone number.");
      }

      const message = (request.data && request.data.message || "").trim() ||
        "Mosaic Church SMS test — outbound texting works.";

      try {
        const resp = await fetch("https://textbelt.com/text", {
          method: "POST",
          headers: {"Content-Type": "application/json"},
          body: JSON.stringify({
            phone: to,
            message,
            key,
            // Textbelt's parameter is replyWebhookUrl (not replyWebhook); with
            // the wrong name it is silently ignored and no replies are forwarded.
            replyWebhookUrl: SMS_REPLY_WEBHOOK_URL,
          }),
        });
        const json = await resp.json();
        const result = interpretSend(json);
        log(`smsSendTest: to=${to} success=${result.success} ` +
          `textId=${result.textId} quotaRemaining=${result.quotaRemaining}.`);
        return result;
      } catch (err) {
        log(`smsSendTest: Textbelt request failed: ${err.message}`);
        throw new HttpsError("unavailable", "Could not reach Textbelt to send the test.");
      }
    },
);

/**
 * Public webhook that Textbelt POSTs to when someone replies to a test text.
 * Replies are appended to the sms_test_replies stack for an admin to review and
 * clear from the Admin Dashboard. Always returns 200 so Textbelt does not retry;
 * unparseable/empty bodies are acknowledged and ignored.
 *
 * Forged POSTs are rejected by verifying Textbelt's HMAC-SHA256 signature over
 * the raw body using the API key as the secret, so only Textbelt can write here.
 */
exports.smsInbound = onRequest(
    {cors: false, region: "us-central1", secrets: [TEXTBELT_KEY]},
    async (req, res) => {
      const ok = verifyTextbeltSignature({
        apiKey: TEXTBELT_KEY.value(),
        timestamp: req.get("X-textbelt-timestamp"),
        signature: req.get("X-textbelt-signature"),
        rawBody: req.rawBody ? req.rawBody.toString("utf8") : "",
        nowMs: Date.now(),
      });
      if (!ok) {
        log("smsInbound: rejected POST with missing/invalid signature.");
        res.status(401).send("unauthorized");
        return;
      }

      const reply = parseInboundReply(req.body);
      if (!reply) {
        res.status(200).send("ignored");
        return;
      }
      try {
        await admin.firestore().collection(SMS_REPLIES_COLLECTION).add({
          ...reply,
          receivedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        log(`smsInbound: stored reply from ${reply.fromNumber} ` +
          `(textId=${reply.textId}).`);
        res.status(200).send("ok");
      } catch (err) {
        log(`smsInbound: failed to store reply: ${err.message}`);
        res.status(200).send("error-logged");
      }
    },
);

