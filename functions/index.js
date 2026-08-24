const {onCall, onRequest, HttpsError} = require("firebase-functions/v2/https");
const {onDocumentWritten} = require("firebase-functions/v2/firestore");
const {onSchedule} = require("firebase-functions/v2/scheduler");
const {defineSecret} = require("firebase-functions/params");
const {log} = require("firebase-functions/logger");
const admin = require("firebase-admin");
const {
  toE164US,
  isAdminPermissionLevel,
  interpretQuota,
  interpretSend,
  parseInboundReply,
  verifyTextbeltSignature,
} = require("./sms");
const pr = require("./prayer-request");
const ac = require("./assignment-conversion");
const si = require("./service-involvement");
const dr = require("./directory-request");
const lu = require("./linked-user");
// The Firestore half of answering and taking. It takes a `db` rather than
// reaching for one, which is what lets test/emulator/ drive the transactions
// against real Firestore semantics (MS-217). The decisions inside it stay in
// assignment-answer.js and assignment-take.js, which are pure.
//
// It reaches on into functions/shared — copied from public/ by
// scripts/sync-shared-to-functions.js, see the predeploy hook in firebase.json.
// functions/ cannot require across into public/, and ADR-0030 needs the
// eligibility rules on the SERVER.
const aw = require("./assignment-writes");
// Every way a Trade moves (MS-190). Same split again: the decisions are in
// shared/trade-core.js, pure; this takes a db so the transactions can be
// exercised.
const tw = require("./trade-writes");
// What changed on a Service save, in hymn/scripture-usage terms. Pure, and
// copied from public/ the same way shared/cover-core.js is — the picker on
// the client and the trigger below have to agree on what counts as "this
// hymn just became used."
const usc = require("./shared/usage-stats-core.js");
// The pure maths behind Service Theme similarity scoring (docs/plans/
// theme-similarity.md) — normalization, centering, calibrated uniqueness.
// Copied from public/ the same way; scoreTheme below is what actually calls
// out to Firestore and the embedding API.
const tsc = require("./shared/theme-similarity-core.js");
// The Firestore half of oos_update_liturgy (MS-262) — takes a `db` for the
// same reason as assignment-writes.js and trade-writes.js above. The
// allowlist/shape decisions stay in shared/liturgy-save-core.js, pure.
const lw = require("./liturgy-writes");
// oos_get_scripture_heatmap's read (MS-262).
const sh = require("./scripture-heatmap");
// The hymn index read, shared by the getHymnIndex callable and the MCP
// server's oos_get_hymn_history tool (MS-262).
const hi = require("./hymn-index");
// Theme similarity scoring + the Gemini embedding call, shared by the
// scoreTheme callable, onServiceThemeWritten, and the MCP server's
// oos_score_theme tool (MS-262).
const ts = require("./theme-scoring");

/**
 * Prepaid Textbelt API key, held as a Firebase secret. Set or rotate it with:
 *   firebase functions:secrets:set TEXTBELT_KEY
 * Functions that send or check SMS declare this in their `secrets` option.
 */
const TEXTBELT_KEY = defineSecret("TEXTBELT_KEY");

/**
 * Google Gemini API key for Service Theme embeddings (docs/plans/
 * theme-similarity.md). Set or rotate it with:
 *   firebase functions:secrets:set GEMINI_KEY
 */
const GEMINI_KEY = defineSecret("GEMINI_KEY");

/**
 * Public URL of the smsInbound HTTP function. Textbelt POSTs reply webhooks
 * here so test-text replies land in the sms_test_replies stack. This is the
 * stable cloudfunctions.net alias for the deployed function.
 */
const SMS_REPLY_WEBHOOK_URL =
  "https://us-central1-mosaic-hymn-database.cloudfunctions.net/smsInbound";

/** Firestore collection holding inbound replies to test texts. */
const SMS_REPLIES_COLLECTION = "sms_test_replies";

/** Outbound message log — maps a sent text's textId to who/what it was for. */
const SMS_MESSAGES_COLLECTION = "sms_messages";

/** Config doc holding the editable templates and the automation kill switch. */
const PRAYER_CONFIG_DOC = "app_config/prayer_request_sms";

/**
 * @fileoverview Firebase Cloud Functions for the Mosaic Website.
 * This file contains the callable HTTPS functions used by the frontend.
 */

// Initialize admin at the top level
if (!admin.apps.length) {
  admin.initializeApp();
}

// The hymn index cache moved to hymn-index.js with the read it belongs to
// (MS-262), so the callable and the MCP server share one cache rather than
// warming two.

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
 * @property {number} times_played - How many services currently schedule this hymn.
 * @property {Array<string>} tags - Descriptive tags for the hymn.
 * @property {string} database_url - Relative URL to the hymn details page.
 */
exports.getHymnIndex = onCall({cors: true, region: "us-central1"}, async () => {
  // The read itself lives in hymn-index.js (MS-262) so the MCP server can
  // serve the same list from the same code. Same query, same mapping, same
  // 5-minute cache — moved, not rewritten.
  log("Function 'getHymnIndex' called.");
  return hi.getHymnIndex(admin.firestore(), log);
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
  
  if (!callerDoc.exists || !["admin", "super_admin"].includes(callerDoc.data().permissionLevel || callerDoc.data().role)) {
    throw new Error("Only admins can create new users.");
  }

  const {email, password, role, permissionLevel} = request.data;
  const level = permissionLevel || role; // Accept either during the MS-119 migration.

  if (!email || !password || !level) {
    throw new Error("Missing required fields: email, password, or permission level.");
  }

  try {
    // 2. Create the user in Firebase Auth
    const userRecord = await admin.auth().createUser({
      email: email,
      password: password,
    });

    // 3. Store the user's permission level and password in Firestore. Write both
    // permissionLevel and the legacy role during the MS-119 migration (MS-127
    // drops the old role field afterwards).
    await db.collection("users").doc(userRecord.uid).set({
      email: email,
      permissionLevel: level,
      role: level,
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
/**
 * Tears down a login: the Auth account, the users doc, and the Person link.
 *
 * The Person record itself SURVIVES. A Person is the church's membership
 * record, not the user's property — deleting it would take the directory
 * entry, the family structure and the elders' shepherding notes with it.
 * Losing a login must never cost the church its records. Members who want
 * the record itself removed are pointed at the church office (see
 * public/privacy.html).
 *
 * Clearing people.userId matters: the link is bidirectional
 * (users.personId <-> people.userId, see CONTEXT.md), so skipping it would
 * leave the Person pointing at a uid that no longer exists, and the next
 * admin to link that Person would be fighting a ghost.
 *
 * @param {string} uid The uid of the login being torn down.
 * @return {Promise<void>}
 */
async function tearDownLogin(uid) {
  const db = admin.firestore();
  const del = admin.firestore.FieldValue.delete();

  const linked = await db.collection("people")
      .where("userId", "==", uid).get();

  const batch = db.batch();
  linked.forEach((person) => batch.update(person.ref, {userId: del}));
  batch.delete(db.collection("users").doc(uid));
  await batch.commit();

  await admin.auth().deleteUser(uid);
  log(`Tore down login ${uid}; unlinked ${linked.size} person record(s)`);
}

exports.deleteUser = onCall({cors: true, region: "us-central1"}, async (request) => {
  if (!request.auth) {
    throw new Error("The function must be called while authenticated.");
  }

  const callerUid = request.auth.uid;
  const db = admin.firestore();
  const callerDoc = await db.collection("users").doc(callerUid).get();

  if (!callerDoc.exists || !["admin", "super_admin"].includes(callerDoc.data().permissionLevel || callerDoc.data().role)) {
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
    await tearDownLogin(uid);
    return {success: true};
  } catch (error) {
    log(`Error deleting user: ${error.message}`);
    throw new Error(error.message);
  }
});

/**
 * Lets a signed-in member delete their OWN login. Required by both app stores:
 * an app with accounts must offer in-app account deletion.
 *
 * Distinct from deleteUser above, which is an admin acting on someone else and
 * deliberately refuses self-deletion. Here the caller IS the subject, so there
 * is no role check — anyone may leave. The one guard is numerical: the last
 * remaining admin cannot delete themselves, because that would strand the
 * church with no one who can administer it and no way back in.
 */
exports.deleteOwnAccount = onCall({cors: true, region: "us-central1"}, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "You must be signed in to delete your account.");
  }

  const uid = request.auth.uid;
  const db = admin.firestore();
  const userDoc = await db.collection("users").doc(uid).get();
  const permissionLevel = userDoc.exists ? (userDoc.data().permissionLevel || userDoc.data().role) : null;

  if (["admin", "super_admin"].includes(permissionLevel)) {
    const admins = await db.collection("users")
        .where("permissionLevel", "in", ["admin", "super_admin"]).get();
    if (admins.size <= 1) {
      throw new HttpsError(
          "failed-precondition",
          "You are the only administrator. Make someone else an administrator " +
          "before deleting your account, or the church will be locked out.",
      );
    }
  }

  try {
    await tearDownLogin(uid);
    return {success: true};
  } catch (error) {
    log(`Error deleting own account ${uid}: ${error.message}`);
    throw new HttpsError("internal", error.message);
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
  
  if (!callerDoc.exists || !["admin", "super_admin"].includes(callerDoc.data().permissionLevel || callerDoc.data().role)) {
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

/* ------------------------------------------------------------------
 * Directory Requests (ADR-0025, ADR-0027)
 * ------------------------------------------------------------------ */

/** Where a Directory Request lives. Ids are namespaced `${uid}_...`. */
const DIRECTORY_REQUESTS_COLLECTION = "directory_requests";

/**
 * Resolves a Directory Request: anything a person asks the church to change
 * about their own directory record. Four kinds share this one queue —
 * link_match, link_new, name_fix and family.
 *
 * This is a callable rather than a Firestore rule because every kind writes
 * somewhere the requester cannot reach and the approver often cannot either.
 * Linking writes users/{uid}.personId, and `users` is admin-only for a good
 * reason: a rule loose enough to let an editor link an account would also let
 * them change permission levels. A name fix and a Family change write to
 * `people` and `families` on behalf of someone who may be a plain member.
 *
 * Approving is one atomic batch — apply the change, close the request. Anything
 * less and a half-approved request leaves the record and the queue disagreeing.
 *
 * `personId` in the payload is the approver's OVERRIDE, and applies only to
 * link requests: an editor reading "add me to the directory" who recognises the
 * person as someone already on file approves onto that record instead, which is
 * the one-click answer to the duplicate-record problem.
 */
exports.resolveDirectoryRequest = onCall({cors: true, region: "us-central1"}, async (request) => {
  if (!request.auth) {
    throw new HttpsError(
        "unauthenticated", "Sign in to resolve directory requests.");
  }

  const db = admin.firestore();
  const callerUid = request.auth.uid;
  const callerDoc = await db.collection("users").doc(callerUid).get();
  const callerLevel = callerDoc.exists ?
    (callerDoc.data().permissionLevel || callerDoc.data().role) : null;

  if (!dr.canResolve(callerLevel)) {
    throw new HttpsError(
        "permission-denied",
        "Only editors, elders and admins can resolve directory requests.");
  }

  const data = request.data || {};
  const {requestId, decision, personId: overridePersonId, reason} = data;
  if (!requestId) {
    throw new HttpsError("invalid-argument", "Missing the request id.");
  }
  if (!["approve", "decline"].includes(decision)) {
    throw new HttpsError(
        "invalid-argument", "Decision must be 'approve' or 'decline'.");
  }

  const requestRef =
    db.collection(DIRECTORY_REQUESTS_COLLECTION).doc(requestId);
  const requestSnap = await requestRef.get();
  if (!requestSnap.exists) {
    throw new HttpsError("not-found", "That request no longer exists.");
  }
  const req = requestSnap.data();

  const now = admin.firestore.FieldValue.serverTimestamp();
  const resolution = {
    resolvedAt: now,
    resolvedBy: callerUid,
    resolvedByEmail: (callerDoc.data() || {}).email || null,
  };

  if (decision === "decline") {
    if (req.status !== dr.STATUS.PENDING) {
      throw new HttpsError(
          "failed-precondition", "This request has already been resolved.");
    }
    await requestRef.update(Object.assign({
      status: dr.STATUS.DECLINED,
      declineReason: (reason || "").trim() || null,
    }, resolution));
    log(`Directory request ${requestId} declined by ${callerUid}`);
    return {status: dr.STATUS.DECLINED};
  }

  const userRef = db.collection("users").doc(req.uid);
  const userSnap = await userRef.get();
  if (!userSnap.exists) {
    throw new HttpsError(
        "failed-precondition", "That account no longer exists.");
  }
  const requesterPersonId = userSnap.data().personId || null;

  // Everything a plan turns on is read fresh here, never taken from the request
  // as filed — a request can sit in the queue for days while an admin links the
  // account by hand, a Person is merged away, or somebody gets married.
  const ctx = {requesterPersonId: requesterPersonId};

  if (req.kind === dr.KIND.FAMILY) {
    const familiesSnap = await db.collection("families").get();
    ctx.families = familiesSnap.docs.map(
        (d) => Object.assign({id: d.id}, d.data()));
    const involved = {};
    for (const id of [req.personId, (req.family || {}).otherId]) {
      if (!id) continue;
      const snap = await db.collection("people").doc(id).get();
      involved[id] = snap.exists ? Object.assign({id: id}, snap.data()) : null;
    }
    ctx.personById = (id) => involved[id] || null;
  } else {
    const targetId = overridePersonId ||
      (req.kind === dr.KIND.LINK_NEW ? null : req.personId);
    ctx.overridePersonId = overridePersonId || null;
    if (targetId) {
      const targetSnap = await db.collection("people").doc(targetId).get();
      ctx.target = {
        exists: targetSnap.exists,
        userId: targetSnap.exists ? (targetSnap.data().userId || null) : null,
        name: targetSnap.exists ? (targetSnap.data().name || null) : null,
      };
    } else {
      ctx.target = null;
    }
  }

  const plan = dr.planApproval(req, ctx);
  if (plan.action === "refuse") {
    throw new HttpsError("failed-precondition", plan.reason);
  }

  const batch = db.batch();
  const closed = Object.assign({
    status: dr.STATUS.APPROVED,
    declineReason: null,
  }, resolution);

  if (plan.action === "create" || plan.action === "link") {
    let personId = plan.personId;
    if (plan.action === "create") {
      const personRef = db.collection("people").doc();
      personId = personRef.id;
      const fields = dr.newPersonFields(req.proposed);
      batch.set(personRef, Object.assign(fields, {
        userId: req.uid,
        createdAt: now,
        updatedAt: now,
      }));
      // Register the starting Membership Tag so it appears in the Tags Manager,
      // the same way the Elder Tag projection registers its own tag.
      for (const tag of dr.INITIAL_STAGE_TAGS) {
        batch.set(
            db.collection("people_tags").doc(tag), {name: tag}, {merge: true});
      }
    } else {
      batch.update(
          db.collection("people").doc(personId),
          {userId: req.uid, updatedAt: now});
    }
    batch.update(userRef, {personId: personId});
    closed.personId = personId;
  } else if (plan.action === "rename") {
    batch.update(db.collection("people").doc(plan.personId), {
      name: plan.name,
      updatedAt: now,
    });
  } else if (plan.action === "family") {
    const familyRef = plan.familyAction === "create" ?
      db.collection("families").doc() :
      db.collection("families").doc(plan.familyId);
    if (plan.familyAction === "create") {
      batch.set(familyRef, Object.assign({childIds: []}, plan.changes, {
        createdAt: now,
        updatedAt: now,
      }));
    } else {
      batch.update(familyRef, Object.assign({}, plan.changes, {updatedAt: now}));
    }
  }

  batch.update(requestRef, closed);
  await batch.commit();
  log(`Directory request ${requestId} (${req.kind}) approved by ` +
      `${callerUid} → ${plan.action}`);
  return {status: dr.STATUS.APPROVED, action: plan.action};
});

/**
 * Deletes a directory photo's blob once the Person stops pointing at it
 * (ADR-0029) — a replacement, a removal, or the Person being deleted outright.
 *
 * This lives on the server rather than in the browser that did the replacing,
 * for two reasons. Storage rules cannot read Firestore, so a rule that let
 * clients delete under people_photos/ would let ANY signed-in account delete
 * ANYONE's photo. And a browser closed between the upload and the tidy-up would
 * leak the old file for good.
 *
 * Best-effort by design: the blob may already be gone, and a failure to remove
 * bytes must never look like a failure to change the photo, which has already
 * happened by the time this runs.
 */
exports.cleanUpReplacedPhoto = onDocumentWritten(
    {document: "people/{personId}", region: "us-central1"},
    async (event) => {
      const before = event.data && event.data.before && event.data.before.exists ?
        event.data.before.data() : null;
      const after = event.data && event.data.after && event.data.after.exists ?
        event.data.after.data() : null;

      const oldPath = before && before.photoPath;
      if (!oldPath) return; // Nothing was stored — nothing to tidy.
      const newPath = after && after.photoPath;
      if (oldPath === newPath) return; // Still in use.

      try {
        await admin.storage().bucket().file(oldPath).delete();
        log(`Removed replaced photo ${oldPath}`);
      } catch (e) {
        // Already gone, or never landed. Either way the Person is correct.
        log(`Could not remove photo ${oldPath}: ${e.message}`);
      }
    },
);

/**
 * Breaks a Linked User: clears users/{uid}.personId and people/{id}.userId.
 *
 * A callable rather than a rule because the `users` collection is admin-only —
 * a rule loose enough to let an editor clear a personId would also let them
 * change permission levels — and the person who spots that an account is
 * connected to the wrong record is an editor or elder looking at the directory,
 * not an admin.
 *
 * Both sides go in one batch. Clearing only one leaves an account pointing at a
 * Person that no longer points back, which is invisible and which the next
 * editor to connect that account would be fighting.
 *
 * Deliberately does NOT touch the Person's membership, tags or shepherding
 * records: this corrects an account connection, it does not say somebody
 * stopped being a member. The Elder Tag clears itself, because the reciprocal
 * trigger reconciles it from the (now absent) link.
 */
exports.unlinkDirectoryPerson = onCall({cors: true, region: "us-central1"}, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in to disconnect an account.");
  }

  const db = admin.firestore();
  const callerUid = request.auth.uid;
  const callerDoc = await db.collection("users").doc(callerUid).get();
  const callerLevel = callerDoc.exists ?
    (callerDoc.data().permissionLevel || callerDoc.data().role) : null;

  if (!lu.canUnlink(callerLevel)) {
    throw new HttpsError(
        "permission-denied",
        "Only editors, elders and admins can disconnect an account.");
  }

  const {personId} = request.data || {};
  if (!personId) {
    throw new HttpsError("invalid-argument", "Missing the directory record id.");
  }

  const personRef = db.collection("people").doc(personId);
  const personSnap = await personRef.get();
  const plan = lu.planUnlink(
      personSnap.exists ? personSnap.data() : null);

  if (plan.action === "refuse") {
    throw new HttpsError("failed-precondition", plan.reason);
  }

  const del = admin.firestore.FieldValue.delete();
  const batch = db.batch();
  batch.update(personRef, {
    userId: del,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  // The account may already be gone (a login deleted without the reciprocal
  // clear). Its absence is not a reason to leave the Person half-linked, so the
  // users write is conditional and the people write is not.
  const userSnap = await db.collection("users").doc(plan.uid).get();
  if (userSnap.exists) {
    batch.update(db.collection("users").doc(plan.uid), {personId: del});
  }

  await batch.commit();
  log(`Unlinked person ${personId} from account ${plan.uid} by ${callerUid}`);
  return {success: true};
});

/**
 * A member takes an Assignment off the cover list (MS-20, ADR-0030).
 *
 * ⚠ ELIGIBILITY IS DECIDED HERE, ON THE SERVER. ADR-0021 made the Role's rules
 * advisory — they warn an editor and never refuse, because the editor authored
 * them and overruling yourself is your own business. A member is not that
 * person and nobody reviews what they pick, so for them the same rules are a
 * wall. A wall enforced only by the screen is not a wall.
 *
 * `cover-core` is the module that answers it, and it is the SAME FILE the
 * browser runs, copied into functions/shared by the predeploy hook. Restating
 * it here by hand would put the one divergence nobody would notice in the one
 * place it would matter most.
 *
 * ⚠ THE PLACE CHANGES HANDS AS A DELETE PLUS A CREATE. A roster row's id
 * carries the personId, so the old row is a different document from the new
 * one and would otherwise simply remain.
 *
 * Nothing is reserved while somebody reads the cover list. Two people can press
 * Take in the same second; the transaction re-reads and `planTake` decides, so
 * the loser is told plainly rather than overwriting whoever got there first.
 */
exports.takeAssignment = onCall(
    {cors: true, region: "us-central1"},
    async (request) => {
      if (!request.auth) {
        throw new HttpsError("unauthenticated", "Sign in to take a place.");
      }

      const db = admin.firestore();
      const userSnap = await db.collection("users")
          .doc(request.auth.uid).get();
      const user = userSnap.exists ? userSnap.data() : {};

      const {occurrenceId, roleSlug, slotId} = request.data || {};
      if (!occurrenceId || !roleSlug) {
        throw new HttpsError(
            "invalid-argument", "Missing the place being taken.");
      }

      const result = await aw.take(db, {
        personId: user.personId || null,
        rank: user.permissionLevel || user.role || null,
        occurrenceId: occurrenceId,
        roleSlug: roleSlug,
        slotId: slotId || null,
        today: ac.churchToday(new Date()),
        now: admin.firestore.Timestamp.now(),
      });

      if (!result.ok) {
        throw new HttpsError(result.code, result.message);
      }

      log(`takeAssignment: ${user.personId} took ${roleSlug} on ` +
          `${occurrenceId}` +
          (result.warning ? ` (warned: ${result.warning})` : ""));
      return {success: true, warning: result.warning || null};
    },
);

/**
 * A member confirms or declines their own Assignment (MS-20).
 *
 * ⚠ WHY THIS EXISTS AT ALL. A member cannot make this change from the browser.
 * It touches two documents at once — their row in the occurrence's `roster`
 * subcollection, and the occurrence's own derived fields — and that occurrence
 * is
 * editor-only to write for good reason: opening it to members would let one
 * restamp `visibility` or `participantIds`, which is what the whole five-rung
 * ladder rests on. So the caller's own `personId` is checked against the
 * Assignment they claim, and the writes go out under the Admin SDK.
 *
 * ⚠ THE THREE WRITES ARE ONE TRANSACTION. The roster row, the occurrence's
 * derived fields, and the cover entry move together or not at all. Split up,
 * the derived fields drift from the roster they describe — which is the failure
 * events-store.js already warns about, and it drifts the very list the security
 * rules read.
 *
 * Every decision is in `assignment-answer.js`, which is pure and tested without
 * an emulator. This reads, asks, and writes.
 */
exports.answerAssignment = onCall(
    {cors: true, region: "us-central1"},
    async (request) => {
      if (!request.auth) {
        throw new HttpsError(
            "unauthenticated", "Sign in to answer for yourself.");
      }

      const db = admin.firestore();
      const userSnap = await db.collection("users")
          .doc(request.auth.uid).get();
      const personId = userSnap.exists ?
        (userSnap.data().personId || null) : null;

      const {occurrenceId, roleSlug, slotId, state, quiet} =
        request.data || {};
      if (!occurrenceId || !roleSlug) {
        throw new HttpsError(
            "invalid-argument", "Missing the place being answered.");
      }

      const result = await aw.answer(db, {
        personId: personId,
        occurrenceId: occurrenceId,
        roleSlug: roleSlug,
        slotId: slotId || null,
        state: state,
        quiet: quiet,
        today: ac.churchToday(new Date()),
        now: admin.firestore.Timestamp.now(),
      });

      if (!result.ok) {
        throw new HttpsError(result.code, result.message);
      }

      log(`answerAssignment: ${personId} set ${roleSlug} on ` +
          `${occurrenceId} to ${result.assignment.state} ` +
          `(cover: ${result.cover.action})`);
      return {
        success: true,
        state: result.assignment.state,
        onCoverList: result.cover.action === "set",
      };
    },
);

/**
 * Trades (MS-190). Five moves, one record.
 *
 * ⚠ EVERY TRANSITION COMES THROUGH HERE. `firestore.rules` refuses a client
 * write of a Trade outright — editors included — so the state machine cannot be
 * walked round with a browser console. "The screen only offers the legal
 * buttons" is not a wall.
 *
 * ⚠ THE CALLER IS TRUSTED FOR IDS AND NOTHING ELSE. Dates, Event names and Role
 * names are all resolved from Firestore inside `trade-writes`. The date is the
 * only clock in this feature, and a caller who could send their own would be
 * able to trade a Saturday that has already happened.
 *
 * @param {Object} request the callable request
 * @param {function} run given a db and the caller's own details, does the move
 * @return {Promise<Object>} what the move returned
 */
async function tradeMove(request, run) {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in to arrange a swap.");
  }

  const db = admin.firestore();
  const userSnap = await db.collection("users").doc(request.auth.uid).get();
  const personId = userSnap.exists ?
    (userSnap.data().personId || null) : null;
  if (!personId) {
    throw new HttpsError(
        "permission-denied", "Only a linked account can arrange a swap.");
  }

  const result = await run(db, {
    actorId: personId,
    today: ac.churchToday(new Date()),
    now: admin.firestore.Timestamp.now(),
  });

  if (!result.ok) throw new HttpsError(result.code, result.message);
  return result;
}

exports.inviteToTrade = onCall(
    {cors: true, region: "us-central1"},
    async (request) => {
      const {occurrenceId, roleSlug, slotId, counterpartyId} =
        request.data || {};
      if (!occurrenceId || !roleSlug || !counterpartyId) {
        throw new HttpsError("invalid-argument", "Missing who, or what.");
      }

      const result = await tradeMove(request, (db, base) => tw.invite(
          db, Object.assign({
            assignment: {occurrenceId, roleSlug, slotId: slotId || null},
            counterpartyId: counterpartyId,
          }, base)));

      log(`inviteToTrade: ${counterpartyId} asked about ${roleSlug} ` +
          `on ${occurrenceId}`);
      return {success: true, tradeId: result.tradeId, state: result.state};
    },
);

exports.withdrawTrade = onCall(
    {cors: true, region: "us-central1"},
    async (request) => {
      const {tradeId} = request.data || {};
      if (!tradeId) throw new HttpsError("invalid-argument", "Missing which.");

      const result = await tradeMove(request, (db, base) =>
        tw.withdraw(db, Object.assign({tradeId}, base)));
      return {success: true, state: result.state};
    },
);

exports.refuseTrade = onCall(
    {cors: true, region: "us-central1"},
    async (request) => {
      const {tradeId} = request.data || {};
      if (!tradeId) throw new HttpsError("invalid-argument", "Missing which.");

      const result = await tradeMove(request, (db, base) =>
        tw.refuse(db, Object.assign({tradeId}, base)));
      return {success: true, state: result.state};
    },
);

/**
 * The reply, or an uninvited offer. `tradeId` says which: with one it
 * answers an invitation, without one it opens a fresh offer.
 *
 * An empty `offered` on a reply SETTLES it — they were asked, so the
 * answer is the agreement. An empty one with no tradeId is refused: taking
 * something nobody offered you is the Take button on the cover list.
 */
exports.offerTrade = onCall(
    {cors: true, region: "us-central1"},
    async (request) => {
      const {tradeId, occurrenceId, roleSlug, slotId, offered} =
        request.data || {};
      // ⚠ NO `holderId`. Who holds the place is read off the roster inside
      // `tw.offer` — the caller may not name them, and the cover list an
      // uninvited offer starts from deliberately does not disclose them.
      if (!tradeId && (!occurrenceId || !roleSlug)) {
        throw new HttpsError("invalid-argument", "Missing what you are after.");
      }

      const result = await tradeMove(request, (db, base) => tw.offer(
          db, Object.assign({
            tradeId: tradeId || null,
            assignment: tradeId ?
              null : {occurrenceId, roleSlug, slotId: slotId || null},
            offered: Array.isArray(offered) ? offered : [],
          }, base)));

      return {
        success: true,
        tradeId: result.tradeId,
        state: result.state,
        settled: result.state === "settled",
      };
    },
);

exports.acceptTrade = onCall(
    {cors: true, region: "us-central1"},
    async (request) => {
      const {tradeId, chosen} = request.data || {};
      if (!tradeId || !chosen) {
        throw new HttpsError("invalid-argument", "Missing which one.");
      }

      const result = await tradeMove(request, (db, base) =>
        tw.accept(db, Object.assign({tradeId, chosen}, base)));

      log(`acceptTrade: ${tradeId} settled, ` +
          `${(result.dying || []).length} others ended`);
      return {
        success: true,
        state: result.state,
        telling: result.telling || [],
      };
    },
);

/**
 * Push a quiet Assignment onto the open cover list, or take an open one back
 * off it (MS-213). The escalation when nobody you asked could help.
 */
exports.setCoverReach = onCall(
    {cors: true, region: "us-central1"},
    async (request) => {
      const {occurrenceId, roleSlug, slotId, quiet} = request.data || {};
      if (!occurrenceId || !roleSlug) {
        throw new HttpsError("invalid-argument", "Missing which place.");
      }

      const result = await tradeMove(request, (db, base) => tw.setReach(
          db, Object.assign({
            assignment: {occurrenceId, roleSlug, slotId: slotId || null},
            quiet: quiet === true,
          }, base)));

      return {success: true, quiet: result.quiet};
    },
);

/**
 * Clear a notice about a Trade that ended (MS-212).
 *
 * The Trade IS the notice — it carries both parties, the place, the date and
 * why it ended — so this marks it read rather than deleting anything. Per
 * person: both parties are usually being told the same news, and one of them
 * dismissing it must not dismiss the other's.
 */
exports.clearTradeNotice = onCall(
    {cors: true, region: "us-central1"},
    async (request) => {
      const {tradeId} = request.data || {};
      if (!tradeId) {
        throw new HttpsError("invalid-argument", "Missing which one.");
      }

      await tradeMove(request, (db, base) =>
        tw.markSeen(db, Object.assign({tradeId}, base)));

      return {success: true};
    },
);

/**
 * An editor filling a place ends every Trade about it — and tells both people
 * (MS-212).
 *
 * ⚠ THIS HANGS OFF THE ROSTER WRITE, NOT OFF A BUTTON, and that is the whole
 * design. Auto-assign, the roster grid, a drag on the calendar and a straight
 * edit are four doors to the same act; a cleanup wired to one of them is a
 * cleanup that quietly does not run for the other three. The editor does
 * nothing special — the Trades simply notice.
 *
 * ⚠ AND IT IS DELIBERATELY BLUNT. It re-reads the place and asks whether each
 * live Trade about it can still happen, rather than trying to work out what the
 * editor meant. A settlement's own roster writes land here too and find nothing
 * to do, because the settlement already ended the same set inside its
 * transaction.
 */
exports.endTradesOnFilledPlace = onDocumentWritten(
    {
      document: "event_occurrences/{occurrenceId}/roster/{assignmentId}",
      region: "us-central1",
    },
    async (event) => {
      const snap = event.data || {};
      const before = snap.before && snap.before.exists ?
        snap.before.data() : null;
      const after = snap.after && snap.after.exists ? snap.after.data() : null;
      const row = after || before;
      if (!row || !row.roleSlug) return;

      // Nothing about WHO holds the place, or WHETHER it is still looking for
      // cover, has changed — a `quiet` toggle, say, which fires on every
      // reach change and must not end anybody's conversation.
      if (before && after &&
          before.personId === after.personId &&
          (before.state || null) === (after.state || null)) return;

      const db = admin.firestore();

      // ⚠ TWO SWEEPS, AND THE SECOND IS NEW. A Trade is a conversation about
      // the place and ends when the place does; the COVER ENTRY is the
      // advertisement for it, and nothing was taking that down when an editor
      // simply removed the roster row. Emptying a run of dates left the list
      // asking for cover on Sundays that no longer had a rota.
      //
      // Both hang off the roster write for the same reason: the editor does
      // nothing special, so the cleanup has to run whichever door they changed
      // the roster through.
      await aw.sweepCover(db, {
        occurrenceId: event.params.occurrenceId,
        roleSlug: row.roleSlug,
        slotId: row.slotId || null,
        row: after,
      });

      const result = await tw.sweepAssignment(db, {
        occurrenceId: event.params.occurrenceId,
        roleSlug: row.roleSlug,
        slotId: row.slotId || null,
        today: ac.churchToday(new Date()),
        now: admin.firestore.Timestamp.now(),
      });

      const closed = (result && result.closed) || [];
      if (closed.length) {
        log(`endTradesOnFilledPlace: ${event.params.occurrenceId}/` +
            `${row.roleSlug} ended ${closed.length} — ` +
            closed.map((c) => c.because).join(", "));
      }
    },
);

/**
 * Order of Service usage stats — hymns & scripture.
 *
 * Lets a picker say "used 4×, last Jul 14" instead of nothing. Reacts to
 * every services/{date} write, diffs the liturgy's hymn and scripture slots
 * with UsageStatsCore.diffLiturgyUsage, and applies the resulting +1/-1
 * deltas to hymns/{hymnId}.times_played / .last_played_date and
 * scripture_usage/{reference}.count / .lastUsed.
 */
exports.updateOrderOfServiceUsageStats = onDocumentWritten(
    {
      document: "services/{dateKey}",
      region: "us-central1",
    },
    async (event) => {
      const dateKey = event.params.dateKey;
      const snap = event.data || {};
      const before = snap.before && snap.before.exists ?
        snap.before.data() : null;
      const after = snap.after && snap.after.exists ?
        snap.after.data() : null;

      const {hymnDeltas, scriptureDeltas} =
        usc.diffLiturgyUsage(before, after, dateKey);
      if (!hymnDeltas.length && !scriptureDeltas.length) return;

      const db = admin.firestore();
      await Promise.all([
        ...hymnDeltas.map((d) => applyUsageDelta(
            db.collection("hymns").doc(d.hymnId), d,
            "times_played", "last_played_date")),
        ...scriptureDeltas.map((d) => applyUsageDelta(
            db.collection("scripture_usage").doc(d.reference), d,
            "count", "lastUsed", {reference: d.reference})),
      ]);
    },
);

/**
 * Applies one usage delta to an aggregate doc, inside a transaction — "last
 * used" is a max, and Firestore has no atomic max, only atomic increment. A
 * service edited out of chronological order must not drag a hymn's
 * last-used date backwards just because it was touched.
 *
 * `createFields` are written only the first time the doc is created —
 * `scripture_usage` needs its own `reference` field stamped on; `hymns`
 * docs already exist, so nothing extra is needed there.
 * @param {FirebaseFirestore.DocumentReference} ref
 * @param {{countDelta: number, date: string}} delta
 * @param {string} countField
 * @param {string} dateField
 * @param {?Object} createFields
 */
async function applyUsageDelta(
    ref, delta, countField, dateField, createFields) {
  await ref.firestore.runTransaction(async (tx) => {
    const doc = await tx.get(ref);
    const data = doc.exists ? doc.data() : {};
    const nextCount =
      Math.max(0, (data[countField] || 0) + delta.countDelta);
    const existingDate = data[dateField] || null;
    const movesForward = delta.countDelta > 0 &&
      (!existingDate || delta.date > existingDate);
    const nextDate = movesForward ? delta.date : existingDate;

    const payload = {[countField]: nextCount, [dateField]: nextDate};
    if (!doc.exists && createFields) Object.assign(payload, createFields);
    tx.set(ref, payload, {merge: true});
  });
}

/**
 * A named person's cached serving-role stats — how many times, and when
 * last, they've filled each Order of Service "who" field. Recomputes the
 * WHOLE roleStats map from people/{personId}/involvement on every write to
 * that subcollection, rather than incrementing — the subcollection is small
 * per person, and a full recompute can't drift from what's actually there
 * the way an increment could if a write were ever missed or retried.
 *
 * Pastoral prayer (prayerMale/prayerFemale) is NOT here — it isn't a
 * serving role (service-involvement-core.js excludes it deliberately) and
 * is tracked by updatePastoralPrayerUsageStats below instead.
 */
exports.updateRoleUsageStats = onDocumentWritten(
    {
      document: "people/{personId}/involvement/{involvementId}",
      region: "us-central1",
    },
    async (event) => {
      const personId = event.params.personId;
      const db = admin.firestore();
      const personRef = db.collection("people").doc(personId);
      const [involvementSnap, personSnap] = await Promise.all([
        personRef.collection("involvement").get(),
        personRef.get(),
      ]);
      // A person can be deleted while their involvement subcollection
      // survives underneath them (subcollections don't cascade-delete) —
      // nothing left to cache the stats on.
      if (!personSnap.exists) return;

      const stats = {};
      involvementSnap.forEach((doc) => {
        const record = doc.data();
        const key = usc.roleStatKey(record.type,
            record.metadata && record.metadata.prayer_type);
        if (!key) return;
        const bucket = stats[key] || (stats[key] = {count: 0, lastUsed: null});
        bucket.count += 1;
        if (record.serviceDate &&
            (!bucket.lastUsed || record.serviceDate > bucket.lastUsed)) {
          bucket.lastUsed = record.serviceDate;
        }
      });

      await personRef.update({roleStats: stats});
    },
);

/**
 * A named person's cached "prayed for" count, alongside the existing
 * lastPastoralPrayerDate cache (pastoral-prayer-core.js) — that cache
 * already tracks the newest date correctly, written in the same batch as
 * the history record itself, so this only adds the count and reads the
 * date rather than recomputing it.
 */
exports.updatePastoralPrayerUsageStats = onDocumentWritten(
    {
      document: "people/{personId}/pastoral_prayer_history/{historyId}",
      region: "us-central1",
    },
    async (event) => {
      const personId = event.params.personId;
      const db = admin.firestore();
      const personRef = db.collection("people").doc(personId);

      const [historySnap, personSnap] = await Promise.all([
        personRef.collection("pastoral_prayer_history").get(),
        personRef.get(),
      ]);
      if (!personSnap.exists) return;

      const lastUsed = personSnap.data().lastPastoralPrayerDate || null;
      await personRef.update({
        pastoralPrayerStats: {count: historySnap.size, lastUsed: lastUsed},
      });
    },
);

// Service Theme similarity (docs/plans/theme-similarity.md). The scoring, the
// embedding call and the two constants that pin them live in
// theme-scoring.js (MS-262) so the MCP server scores a theme through the very
// same code this page does. Vectors from different models or dimensionalities
// are not comparable — changing either constant means re-embedding the whole
// `themes` collection first.
const {
  embedThemeText,
  THEME_EMBEDDING_MODEL,
  THEME_EMBEDDING_DIMS,
} = ts;

/**
 * How close a Service Theme an editor is typing is to one already preached,
 * and how unique it is overall. Advisory only — nothing here blocks or
 * changes a save. Editor+ only: this spends money per call.
 *
 * Scoring runs here rather than on the client because the alternative is
 * downloading every theme's vector to the browser on every page load —
 * several MB in the phone WebView, on mobile data, for a feature that only
 * needs a few hundred bytes back.
 */
exports.scoreTheme = onCall(
    {cors: true, region: "us-central1", secrets: [GEMINI_KEY]},
    async (request) => {
      if (!request.auth) {
        throw new HttpsError("unauthenticated", "Sign in to score a theme.");
      }

      const db = admin.firestore();
      const callerSnap =
        await db.collection("users").doc(request.auth.uid).get();
      const level = callerSnap.exists &&
          (callerSnap.data().permissionLevel || callerSnap.data().role);
      if (!["editor", "elder", "admin", "super_admin"].includes(level)) {
        throw new HttpsError("permission-denied",
            "Editors only — scoring a theme calls a paid API.");
      }

      const text = ((request.data && request.data.text) || "").trim();
      if (!text) {
        throw new HttpsError("invalid-argument", "No theme text given.");
      }
      // The service currently being edited — excluded from the corpus below
      // so a theme reads as "compared against everyone else's history," not
      // against the very draft that's typing it. Without this, saving a
      // theme embeds it immediately (onServiceThemeWritten), and the next
      // keystroke's score would match 100% against itself.
      const excludeDate = (request.data && request.data.excludeDate) || null;

      try {
        return await ts.scoreTheme(db, {
          text,
          excludeDate,
          apiKey: GEMINI_KEY.value(),
        });
      } catch (e) {
        if (e && e.reason === "stale-corpus") {
          throw new HttpsError("failed-precondition", e.message);
        }
        throw e;
      }
    },
);

/**
 * MS-262 — merges a partial set of liturgy fields (theme, keyVerse, the 7
 * hymn slots, the 6 scripture/text slots) into one Sunday's
 * `services/{dateKey}` document, for the oos_update_liturgy MCP tool.
 *
 * Editor+ only, same floor as scoreTheme and every other liturgy write.
 * Explicitly refuses any field outside that allowlist — see
 * shared/liturgy-save-core.js — so a person-assignment field (Preacher,
 * Service Leader, …) can never be set through this door; that needs a
 * find-this-person tool this ticket does not build.
 */
exports.oosUpdateLiturgy = onCall(
    {cors: true, region: "us-central1"},
    async (request) => {
      if (!request.auth) {
        throw new HttpsError("unauthenticated", "Sign in to update an Order of Service.");
      }

      const db = admin.firestore();
      const callerSnap = await db.collection("users").doc(request.auth.uid).get();
      const level = callerSnap.exists &&
          (callerSnap.data().permissionLevel || callerSnap.data().role);
      if (!["editor", "elder", "admin", "super_admin"].includes(level)) {
        throw new HttpsError("permission-denied",
            "Editors only — this changes the live Order of Service.");
      }

      const dateKey = (request.data && request.data.dateKey) || "";
      const fields = (request.data && request.data.fields) || null;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
        throw new HttpsError("invalid-argument", "dateKey must be YYYY-MM-DD.");
      }
      if (!fields || typeof fields !== "object" || Array.isArray(fields) ||
          !Object.keys(fields).length) {
        throw new HttpsError("invalid-argument", "No liturgy fields given.");
      }

      const result = await lw.updateLiturgy(db, {
        dateKey,
        fields,
        uid: request.auth.uid,
        serverTimestamp: admin.firestore.FieldValue.serverTimestamp(),
        deleteField: admin.firestore.FieldValue.delete(),
      });

      if (!result.ok) {
        throw new HttpsError("invalid-argument",
            "Fields not allowed: " +
            result.rejectedFields.concat(result.invalidFields).join(", "));
      }

      return {updated: Object.keys(fields)};
    },
);

/**
 * MS-262 — scripture usage across every Sunday on record, for the
 * oos_get_scripture_heatmap MCP tool. Same shape and pattern as
 * getHymnIndex; today `scripture_usage` is only read client-side, on the
 * Analytics page (public/usage-stats-store.js).
 */
exports.oosGetScriptureHeatmap = onCall(
    {cors: true, region: "us-central1"},
    async () => sh.getScriptureHeatmap(admin.firestore()),
);

/**
 * Keeps the `themes` collection current as Services are saved (docs/plans/
 * theme-similarity.md). Each distinct theme is embedded exactly once, ever
 * — repeat and edited-elsewhere-first saves just add/remove a date from
 * `usedOn`.
 */
exports.onServiceThemeWritten = onDocumentWritten(
    {
      document: "services/{dateKey}",
      region: "us-central1",
      secrets: [GEMINI_KEY],
    },
    async (event) => {
      const dateKey = event.params.dateKey;
      const snap = event.data || {};
      const before = snap.before && snap.before.exists ?
        snap.before.data() : null;
      const after = snap.after && snap.after.exists ?
        snap.after.data() : null;

      const oldText = before ? before.theme : null;
      const newText = after ? after.theme : null;
      if ((oldText || "") === (newText || "")) return;

      const db = admin.firestore();
      const oldKey = tsc.themeKey(oldText);
      const newKey = tsc.themeKey(newText);

      if (oldKey && oldKey !== newKey) {
        const oldRef = db.collection("themes").doc(oldKey);
        const oldSnap = await oldRef.get();
        if (oldSnap.exists) {
          const remaining = (oldSnap.data().usedOn || [])
              .filter((d) => d !== dateKey);
          if (remaining.length) {
            await oldRef.update({
              usedOn: admin.firestore.FieldValue.arrayRemove(dateKey),
            });
          } else {
            // Nothing uses this theme anymore — drop it from the corpus
            // rather than leave an empty-usedOn doc that still turns up
            // as a similarity match for something nobody's preached.
            await oldRef.delete();
          }
        }
      }

      if (!newKey) return;

      const newRef = db.collection("themes").doc(newKey);
      const newSnap = await newRef.get();

      if (newSnap.exists) {
        await newRef.update({
          usedOn: admin.firestore.FieldValue.arrayUnion(dateKey),
        });
        return;
      }

      const displayText = tsc.normalizeThemeText(newText);
      const vector = await embedThemeText(displayText, GEMINI_KEY.value());
      await newRef.set({
        text: displayText,
        vector: vector,
        model: THEME_EMBEDDING_MODEL,
        dims: THEME_EMBEDDING_DIMS,
        usedOn: [dateKey],
        embeddedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    },
);

/**
 * Member-status synchronisation between user accounts and directory people.
 *
 * A user account (`users/{uid}`) can be linked to a directory person
 * (`people/{personId}`) via reciprocal `personId` / `userId` fields. When the
 * link exists, "member" status is kept in sync in an ADD-ONLY fashion:
 *
 *   • A user whose permission level is member-or-higher advances their person
 *     along the Membership Track to the `member` stage — which projects the
 *     "Member" tag as a consequence (ADR-0012, ADR-0026). It does NOT write the
 *     tag directly; that is what used to leave a Person whose stage said
 *     Visitor and whose tags said Member.
 *   • A person carrying the "Member" tag promotes their user from viewer to
 *     member — but never demotes a user who already holds a higher level.
 *
 * Removing the level or the tag never strips the other side; that is cleared
 * manually. Both triggers read the target before writing and skip the write
 * when no change is needed, which keeps the two triggers from looping into
 * each other.
 */
const {
  MEMBER_PERMISSION_LEVEL,
  isMemberOrHigher,
  hasMemberTag,
  shouldAdvanceToMember,
  memberAdvanceUpdate,
  buildMemberAdvanceRecord,
  shouldPromoteToMember,
} = require("./member-sync");

const membershipTrack = require("./membership-track");

const {
  ELDER_TAG,
  isElderPermissionLevel,
  hasElderTag,
} = require("./elder-sync");

/**
 * Direction A: a user's permission level advances the linked person along the
 * Membership Track to `member`.
 *
 * ⚠ RENAMED from `syncRoleToMemberTag` (ADR-0026). The old function must be
 * DELETED on deploy — if both survive, the old one keeps stapling the Member
 * tag onto Persons behind this one's back, which is the exact bug this fixes.
 */
exports.syncPermissionLevelToMembershipStage = onDocumentWritten(
    {document: "users/{uid}", region: "us-central1"},
    async (event) => {
      const after = event.data && event.data.after && event.data.after.exists ?
        event.data.after.data() : null;
      if (!after) return; // Deleted — add-only, nothing to mirror.

      const personId = after.personId;
      if (!personId) return; // Not linked to a person.
      const level = after.permissionLevel || after.role;
      if (!isMemberOrHigher(level)) return; // Viewer/unknown: skip the read.

      const db = admin.firestore();
      const personRef = db.collection("people").doc(personId);
      const personSnap = await personRef.get();
      if (!personSnap.exists) return;

      const person = personSnap.data();
      const previous = person.membership || {};
      // Already a member, already left, or marked inactive — all of which are
      // decisions a permission level does not get to undo. Refusing also skips
      // the write once in sync, so the reciprocal trigger never loops.
      if (!shouldAdvanceToMember(level, previous)) return;

      const now = admin.firestore.FieldValue.serverTimestamp();
      const update = memberAdvanceUpdate(person.tags);
      update.updatedAt = now;

      // The stage move and its Pastoral Record entry are one batch: ADR-0005
      // requires the denormalized field and the history to move together, and a
      // stage that moved with nothing in the record credits the change to
      // nobody.
      const batch = db.batch();
      batch.update(personRef, update);
      batch.set(
          personRef.collection("shepherding_activity").doc(),
          Object.assign(
              buildMemberAdvanceRecord(previous, level), {createdAt: now}));

      // Register the projected tags so they show in the Tags Manager.
      for (const tag of membershipTrack.membershipTagsFor(
          {stage: membershipTrack.MEMBER_STAGE})) {
        batch.set(
            db.collection("people_tags").doc(tag), {name: tag}, {merge: true});
      }

      await batch.commit();
      log(`Advanced person ${personId} from ` +
          `'${previous.stage || "no stage"}' to ` +
          `'${membershipTrack.MEMBER_STAGE}' (linked user is ${level}).`);
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

      const permissionLevel = userSnap.data().permissionLevel || userSnap.data().role || "viewer";
      if (!shouldPromoteToMember(permissionLevel)) return; // Already member+ — never demote, and skip write to avoid a loop.

      await userRef.update({permissionLevel: MEMBER_PERMISSION_LEVEL, role: MEMBER_PERMISSION_LEVEL});
      log(`Promoted user ${userId} from '${permissionLevel}' to '${MEMBER_PERMISSION_LEVEL}' (linked person has the member tag).`);
    },
);

/**
 * Elder-Tag projection (ADR-0013, MS-92): the `elder` User role projects an
 * immutable "Elder" tag onto the linked directory Person. Unlike the member sync
 * (add-only), the Elder Tag is a Projected Tag kept in EXACT sync — added when a
 * linked user is an elder, removed when they stop being one or are unlinked.
 *
 * The tag on a Person is a function of THAT Person's current linked user, so we
 * reconcile from the person's live `userId` rather than trusting the event delta:
 * one `reconcileElderTag(personId)` recomputes the correct state and only writes
 * on a change (which also stops the trigger looping). Both the newly-linked
 * person and any person the user was UNLINKED from get reconciled.
 *
 * One-directional: the Elder Tag is never hand-applied, so there is no
 * person-tag → user-role counterpart (contrast syncMemberTagToRole).
 */
async function reconcileElderTag(db, personId) {
  const personRef = db.collection("people").doc(personId);
  const personSnap = await personRef.get();
  if (!personSnap.exists) return;
  const person = personSnap.data();
  const tags = person.tags || [];

  // Elder-ness comes from the person's CURRENT linked user's role.
  let elder = false;
  if (person.userId) {
    const userSnap = await db.collection("users").doc(person.userId).get();
    elder = userSnap.exists && isElderPermissionLevel(userSnap.data().permissionLevel || userSnap.data().role);
  }

  const has = hasElderTag(tags);
  if (elder === has) return; // Already correct — skip write to avoid a trigger loop.

  if (elder) {
    // Register the tag so it shows in the Tags Manager (like the member tag).
    await db.collection("people_tags").doc(ELDER_TAG)
        .set({name: ELDER_TAG}, {merge: true});
    await personRef.update({
      tags: admin.firestore.FieldValue.arrayUnion(ELDER_TAG),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    log(`Tagged person ${personId} as '${ELDER_TAG}' (linked user is an elder).`);
  } else {
    await personRef.update({
      tags: admin.firestore.FieldValue.arrayRemove(ELDER_TAG),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    log(`Removed '${ELDER_TAG}' from person ${personId} (linked user no longer an elder).`);
  }
}

exports.syncElderRoleToTag = onDocumentWritten(
    {document: "users/{uid}", region: "us-central1"},
    async (event) => {
      const before = event.data && event.data.before && event.data.before.exists ?
        event.data.before.data() : null;
      const after = event.data && event.data.after && event.data.after.exists ?
        event.data.after.data() : null;

      const beforePersonId = before && before.personId;
      const afterPersonId = after && after.personId;
      if (!beforePersonId && !afterPersonId) return; // Never linked — nothing to project.

      const db = admin.firestore();

      // Reconcile the person the user is linked to now (apply or remove).
      if (afterPersonId) await reconcileElderTag(db, afterPersonId);

      // If the link moved or was cleared (unlink / relink / user deleted), the
      // previously-linked person may still carry a stale Elder tag — reconcile it
      // too (its userId was cleared reciprocally, so it resolves to non-elder).
      if (beforePersonId && beforePersonId !== afterPersonId) {
        await reconcileElderTag(db, beforePersonId);
      }
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
  if (!callerDoc.exists || !isAdminPermissionLevel(callerDoc.data().permissionLevel || callerDoc.data().role)) {
    throw new HttpsError("permission-denied", "Admins only.");
  }
}

/**
 * Throws unless the caller is an elder/super_admin — the roles that manage
 * pastoral-prayer subjects and their Prayer Requests (matches isShepherd in the
 * Service Builder and the prayer_requests Firestore rule).
 * @param {import("firebase-admin").firestore.Firestore} db
 * @param {Object|undefined} authCtx
 * @return {Promise<void>}
 */
async function assertElder(db, authCtx) {
  if (!authCtx) {
    throw new HttpsError("unauthenticated", "Sign in first.");
  }
  const callerDoc = await db.collection("users").doc(authCtx.uid).get();
  const permissionLevel = callerDoc.exists ? (callerDoc.data().permissionLevel || callerDoc.data().role) : null;
  if (!["elder", "super_admin"].includes(permissionLevel)) {
    throw new HttpsError("permission-denied", "Elders only.");
  }
}

/**
 * Sends one SMS via Textbelt and returns the shaped result. Prayer-request and
 * test sends share this so reply routing and signature verification behave
 * identically. Outbound texts that expect a reply attach the reply webhook.
 * @param {{to: string, body: string, withReplyWebhook?: boolean}} args
 * @return {Promise<{success: boolean, textId: string|null,
 *   quotaRemaining: number|null, error: string|null}>}
 */
async function sendViaTextbelt({to, body, withReplyWebhook = true}) {
  const payload = {phone: to, message: body, key: TEXTBELT_KEY.value()};
  if (withReplyWebhook) payload.replyWebhookUrl = SMS_REPLY_WEBHOOK_URL;
  const resp = await fetch("https://textbelt.com/text", {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify(payload),
  });
  return interpretSend(await resp.json());
}

/**
 * Records an outbound text in the message log so an inbound reply's textId can
 * be resolved back to its purpose/person/service.
 * @param {import("firebase-admin").firestore.Firestore} db
 * @param {Object} entry - {to, body, textId, purpose, personId?, serviceDate?,
 *   kind?}
 * @return {Promise<void>}
 */
async function recordOutbound(db, entry) {
  if (!entry.textId) return;
  await db.collection(SMS_MESSAGES_COLLECTION).add({
    direction: "outbound",
    to: entry.to,
    body: entry.body,
    textId: String(entry.textId),
    purpose: entry.purpose,
    personId: entry.personId || null,
    serviceDate: entry.serviceDate || null,
    kind: entry.kind || null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

/**
 * Loads the prayer-request config: the resolved message templates (saved values
 * over built-in defaults) and whether automatic sending is enabled.
 * @param {import("firebase-admin").firestore.Firestore} db
 * @return {Promise<{templates: Object, autoSendEnabled: boolean}>}
 */
async function loadPrayerConfig(db) {
  const snap = await db.doc(PRAYER_CONFIG_DOC).get();
  const data = snap.exists ? snap.data() : {};
  return {
    templates: pr.resolveTemplates(data),
    autoSendEnabled: !!data.autoSendEnabled,
  };
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
        const result = await sendViaTextbelt({to, body: message});
        if (result.success) {
          // Log as a 'test' send so a reply routes to the test stack, not the
          // prayer-request flow.
          await recordOutbound(admin.firestore(), {
            to, body: message, textId: result.textId, purpose: "test",
          });
        }
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
 * Public webhook Textbelt POSTs to when someone replies to a text we sent. The
 * reply's textId is looked up in the outbound log: a 'prayer_request' reply
 * fills that Sunday's Prayer Request (and is thanked); anything else (a test
 * send, or an unrecognized id) lands in the sms_test_replies stack the Admin
 * Dashboard shows. Always returns 200 (besides auth) so Textbelt does not retry.
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

      const db = admin.firestore();
      try {
        // Resolve what this reply was a reply to.
        const originSnap = await db.collection(SMS_MESSAGES_COLLECTION)
            .where("textId", "==", reply.textId)
            .where("direction", "==", "outbound")
            .limit(1)
            .get();
        const origin = originSnap.empty ? null : originSnap.docs[0].data();

        if (origin && origin.purpose === "prayer_request" &&
            origin.personId && origin.serviceDate) {
          await applyPrayerRequestReply(db, {
            personId: origin.personId,
            serviceDate: origin.serviceDate,
            replyText: reply.text,
          });
          log(`smsInbound: prayer reply from ${reply.fromNumber} → ` +
            `person ${origin.personId} (service ${origin.serviceDate}).`);
        } else {
          // Test send or unrecognized — keep it in the admin test stack.
          await db.collection(SMS_REPLIES_COLLECTION).add({
            ...reply,
            receivedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          log(`smsInbound: stored test/unmatched reply from ` +
            `${reply.fromNumber} (textId=${reply.textId}).`);
        }
        res.status(200).send("ok");
      } catch (err) {
        log(`smsInbound: failed to handle reply: ${err.message}`);
        res.status(200).send("error-logged");
      }
    },
);

/**
 * Applies a pastoral-prayer subject's texted reply: fills that Sunday's Prayer
 * Request (once), generates a "Prayer Request" Shepherding Note, and sends the
 * thank-you. No date cutoff — a reply is accepted whenever it arrives, as long
 * as the request is still empty. A reply for an already-filled request is
 * ignored so a second reply can't duplicate the note.
 * @param {import("firebase-admin").firestore.Firestore} db
 * @param {{personId: string, serviceDate: string, replyText: string}} args
 * @return {Promise<void>}
 */
async function applyPrayerRequestReply(db, {personId, serviceDate, replyText}) {
  const text = (replyText || "").trim();
  if (!serviceDate || !text) return;

  const personRef = db.collection("people").doc(personId);
  const reqRef = personRef.collection("prayer_requests").doc(serviceDate);
  const [personSnap, reqSnap] = await Promise.all([personRef.get(), reqRef.get()]);
  // Already filled (manually or by an earlier reply) — don't duplicate.
  if (reqSnap.exists && (reqSnap.data().prayerRequest || "").trim()) return;

  const personName = personSnap.exists ? (personSnap.data().name || "") : "";
  const note = pr.buildPrayerRequestNote({personName, serviceDate, requestText: text});
  const now = admin.firestore.FieldValue.serverTimestamp();

  await reqRef.set({
    serviceDate,
    prayerRequest: text,
    prayerRequestSource: "reply",
    requestFilledAt: now,
    noteGenerated: true,
  }, {merge: true});

  await personRef.collection("shepherding_notes").add({
    type: note.type,
    subject: note.subject,
    content: note.content,
    contentJson: note.contentJson,
    authorName: "Prayer Request (texted)",
    authorUid: null,
    createdAt: now,
  });

  // Thank the subject. Best-effort: a failed thank-you must not fail the reply.
  try {
    const phone = personSnap.exists && personSnap.data().contact &&
      personSnap.data().contact.phone;
    const to = toE164US(phone);
    if (to) {
      const {templates} = await loadPrayerConfig(db);
      const body = pr.renderPrayerRequestMessage(
          "thankyou", pr.firstNameOf(personName), templates);
      const result = await sendViaTextbelt({to, body, withReplyWebhook: false});
      if (result.success) {
        await recordOutbound(db, {
          to, body, textId: result.textId,
          purpose: "prayer_request_thankyou", personId, serviceDate,
        });
      }
    }
  } catch (e) {
    log(`Thank-you send failed for ${personId}: ${e.message}`);
  }
  log(`Filled prayer request for ${personId} (service ${serviceDate}).`);
}

/**
 * Loads a subject's person record and that Sunday's prayer-request state.
 * @param {import("firebase-admin").firestore.Firestore} db
 * @param {string} personId
 * @param {string} serviceDate
 * @return {Promise<{personSnap: Object, reqSnap: Object, reqRef: Object}>}
 */
async function loadSubjectState(db, personId, serviceDate) {
  const reqRef = db.collection("people").doc(personId)
      .collection("prayer_requests").doc(serviceDate);
  const personRef = db.collection("people").doc(personId);
  const [personSnap, reqSnap] = await Promise.all([personRef.get(), reqRef.get()]);
  return {personSnap, reqSnap, reqRef};
}

/**
 * Sends a resolved prayer-request text (initial or reminder) to a subject,
 * records the send-state on the request and the linkage in the outbound log.
 * Shared by the scheduler and the manual button.
 * @param {import("firebase-admin").firestore.Firestore} db
 * @param {Object} args - {serviceDate, personId, kind, templates, personSnap,
 *   reqRef}
 * @return {Promise<Object>} the Textbelt send result.
 */
async function dispatchPrayerText(db, args) {
  const {serviceDate, personId, kind, templates, personSnap, reqRef} = args;
  const person = personSnap.data();
  const to = toE164US(person.contact && person.contact.phone);
  const body = pr.renderPrayerRequestMessage(
      kind, pr.firstNameOf(person.name), templates);

  const result = await sendViaTextbelt({to, body, withReplyWebhook: true});
  if (!result.success) return result;

  const today = pr.churchDateParts(new Date()).date;
  const update = kind === "initial" ?
    {serviceDate, initialSentDate: today} :
    {serviceDate, reminderSent: true, reminderSentDate: today};
  await reqRef.set(update, {merge: true});
  await recordOutbound(db, {
    to, body, textId: result.textId,
    purpose: "prayer_request", personId, serviceDate, kind,
  });
  return result;
}

/**
 * Evaluates one pastoral-prayer subject for the scheduler and sends the initial
 * or reminder when due.
 * @param {import("firebase-admin").firestore.Firestore} db
 * @param {Object} args - {serviceDate, personId, today, localHour, templates}
 * @return {Promise<void>}
 */
async function processPrayerSubject(db, args) {
  const {serviceDate, personId, today, localHour, templates} = args;
  const {personSnap, reqSnap, reqRef} = await loadSubjectState(db, personId, serviceDate);
  if (!personSnap.exists) return;

  const person = personSnap.data();
  const req = reqSnap.exists ? reqSnap.data() : {};
  const to = toE164US(person.contact && person.contact.phone);

  const action = pr.prayerRequestAction({
    daysUntilService: pr.daysUntil(serviceDate, today),
    localHour,
    hasPhone: !!to,
    requestFilled: !!(req.prayerRequest || "").trim(),
    initialSentDate: req.initialSentDate || null,
    reminderSent: !!req.reminderSent,
    today,
  });
  if (action === "none") return;

  const result = await dispatchPrayerText(db, {
    serviceDate, personId, kind: action, templates, personSnap, reqRef,
  });
  if (!result.success) {
    log(`Prayer-request ${action} send failed for ${personId}: ${result.error}`);
  } else {
    log(`Sent prayer-request ${action} to ${personId} (service ${serviceDate}).`);
  }
}

/**
 * Hourly scheduled sender for pastoral-prayer Prayer Request texts. Gated by the
 * autoSendEnabled kill switch (default off). For each upcoming Service within
 * the initial-send window, each pastoral-prayer subject (prayerMale/prayerFemale)
 * with an empty request is texted per the 5-day/3-day, 8am-8pm-Central rules.
 */
exports.sendPrayerRequestTexts = onSchedule(
    {
      schedule: "every 60 minutes",
      timeZone: pr.CHURCH_TIMEZONE,
      region: "us-central1",
      secrets: [TEXTBELT_KEY],
    },
    async () => {
      const db = admin.firestore();
      const {templates, autoSendEnabled} = await loadPrayerConfig(db);
      if (!autoSendEnabled) {
        log("sendPrayerRequestTexts: automation disabled — skipping.");
        return;
      }

      const {date: today, hour: localHour} = pr.churchDateParts(new Date());
      if (localHour < pr.WINDOW_OPEN_HOUR || localHour >= pr.WINDOW_CLOSE_HOUR) {
        return;
      }

      const snap = await db.collection("services")
          .where(admin.firestore.FieldPath.documentId(), ">=", today)
          .get();

      for (const doc of snap.docs) {
        const serviceDate = doc.id;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(serviceDate)) continue;
        if (pr.daysUntil(serviceDate, today) > pr.INITIAL_DAYS_OUT) continue;

        const liturgy = doc.data().liturgy || {};
        const subjects = [liturgy.prayerMale, liturgy.prayerFemale]
            .filter((s) => s && s.id);
        for (const subject of subjects) {
          await processPrayerSubject(db, {
            serviceDate, personId: subject.id, today, localHour, templates,
          });
        }
      }
    },
);

/**
 * Turns plans into history: once an Event's date has passed, every Confirmed
 * assignment on it becomes an Involvement record (MS-151, ADR-0018 §1).
 *
 * An Assignment is the plan and is mutable. An Involvement is the fact that
 * somebody served. Before this, assigning wrote a serve record immediately —
 * including for a Sunday six weeks away — so the serve log already counted
 * serving that had not happened.
 *
 *   Confirmed → written.
 *   Declined  → never, ever.
 *   Pending   → not written, and NOT discarded: it stays an open question on the
 *               past Event for an editor to answer. An unanswered question stays
 *               unanswered permanently and never counts as serving.
 *
 * Idempotent by construction — the Involvement id is derived from the occurrence,
 * the Role, the slot and the person, so a second run overwrites the same
 * document instead of writing a duplicate.
 *
 * Runs daily, just after midnight church-local, so "the date has passed" is
 * evaluated where the church is rather than where the server is.
 */
exports.convertConfirmedAssignments = onSchedule(
    {
      schedule: "every day 00:30",
      timeZone: ac.CHURCH_TIMEZONE,
      region: "us-central1",
    },
    async () => {
      const db = admin.firestore();
      const {today, from, to} = ac.conversionWindow(new Date());

      // Strictly past dates only. An Event happening TODAY has not happened yet,
      // and converting it would be the very bug this job exists to fix.
      const snap = await db.collection("event_occurrences")
          .where("date", ">=", from)
          .where("date", "<=", to)
          .get();

      let written = 0;
      let open = 0;

      for (const doc of snap.docs) {
        const occurrence = Object.assign({id: doc.id}, doc.data());
        if (!ac.hasPassed(occurrence.date, today)) continue;

        // The roster lives in a subcollection, not on the document — Firestore
        // cannot hide a field from a reader, so that is where the assignments
        // are. The admin SDK reads it regardless of the rules.
        const roster = await doc.ref.collection("roster").get();
        if (roster.empty) continue;

        occurrence.assignments = roster.docs.map((r) => r.data());
        const {serves, questions} = ac.conversion(occurrence);
        open += questions.length;
        if (!serves.length) continue;

        const batch = db.batch();
        serves.forEach((record) => {
          const ref = db.collection("people").doc(record.personId)
              .collection("involvement").doc(record.involvementId);
          batch.set(ref, {
            serviceDate: record.serviceDate,
            type: record.type,
            seriesId: record.seriesId,
            metadata: record.metadata || null,
            convertedAt: admin.firestore.FieldValue.serverTimestamp(),
          }, {merge: true});
        });
        await batch.commit();
        written += serves.length;
      }

      log(`convertConfirmedAssignments: wrote ${written} serve record(s); ` +
          `${open} assignment(s) left as open questions.`);
    },
);

/**
 * The same job for a Sunday's LITURGICAL Roles (MS-160, ADR-0018 §1–2).
 *
 * Kept separate from convertConfirmedAssignments deliberately. Liturgy is not
 * Assignments — it is denormalised fields on `services/{date}` that the printed
 * booklet reads — so it is read differently, it converts unconditionally (there
 * is no state to confirm; being on the booklet is the commitment), and it
 * raises no open questions. Folding it into the other job would mean one
 * function whose name is true of half of what it does, and a failure in either
 * half stopping the other.
 *
 * Only Services carrying `involvementDeferred` are converted. Every Sunday
 * saved before this shipped already has its records, written the old way under
 * an auto-generated id — converting those again would add a second record
 * beside each one rather than overwrite it. The flag is the Service saying its
 * records are still owed, and it is cleared in the same write that pays them.
 */
exports.convertServiceInvolvement = onSchedule(
    {
      schedule: "every day 00:30",
      timeZone: ac.CHURCH_TIMEZONE,
      region: "us-central1",
    },
    async () => {
      const db = admin.firestore();
      const today = ac.churchToday(new Date());

      const snap = await db.collection("services")
          .where(si.DEFERRED_FLAG, "==", true)
          .get();

      let written = 0;
      let converted = 0;

      for (const doc of snap.docs) {
        // The document id IS the date. A Sunday still ahead keeps its flag and
        // is picked up on the night it finally passes.
        const records = si.conversion(doc.data(), doc.id, today);
        if (!records.length) {
          // Nobody to credit, but the date has passed and the debt is settled —
          // otherwise an empty Sunday is re-read every night forever.
          if (doc.id < today) {
            await doc.ref.set({[si.DEFERRED_FLAG]: false}, {merge: true});
          }
          continue;
        }

        const batch = db.batch();
        // `totalInvolvements` is a counter the People page and Analytics both
        // sort by, and the editor used to keep it up as it wrote. Now that the
        // editor defers, this job owes it — counted per person first, because
        // one person can hold two Roles on the same Sunday.
        const gained = new Map();

        records.forEach((record) => {
          const ref = db.collection("people").doc(record.personId)
              .collection("involvement").doc(record.id);
          batch.set(ref, {
            serviceDate: record.serviceDate,
            type: record.type,
            seriesId: ac.SUNDAY_SERVICE_ID,
            metadata: record.metadata || null,
            convertedAt: admin.firestore.FieldValue.serverTimestamp(),
          }, {merge: true});
          gained.set(record.personId, (gained.get(record.personId) || 0) + 1);
        });

        gained.forEach((count, personId) => {
          batch.update(db.collection("people").doc(personId), {
            totalInvolvements: admin.firestore.FieldValue.increment(count),
          });
        });

        // Cleared in the same batch as the writes, so a crash between the two
        // cannot leave a Sunday paid twice or not at all.
        batch.set(doc.ref, {[si.DEFERRED_FLAG]: false}, {merge: true});
        await batch.commit();

        written += records.length;
        converted += 1;
      }

      log(`convertServiceInvolvement: wrote ${written} serve record(s) ` +
          `across ${converted} Service(s).`);
    },
);

/**
 * Manual "Send Prayer Request Text Now" — the Service Builder button. Elder-gated.
 * Bypasses the timing/quiet-hours guards (a human is choosing to send now) but
 * keeps the phone/already-filled guards. Sends initial then reminder, re-sending
 * the reminder on repeat calls.
 */
exports.sendPrayerRequestNow = onCall(
    {cors: true, region: "us-central1", secrets: [TEXTBELT_KEY]},
    async (request) => {
      const db = admin.firestore();
      await assertElder(db, request.auth);

      const serviceDate = request.data && request.data.serviceDate;
      const personId = request.data && request.data.personId;
      if (!serviceDate || !personId) {
        throw new HttpsError("invalid-argument",
            "serviceDate and personId are required.");
      }
      if (!TEXTBELT_KEY.value()) {
        throw new HttpsError("failed-precondition",
            "No Textbelt key is configured.");
      }

      const {personSnap, reqSnap, reqRef} = await loadSubjectState(db, personId, serviceDate);
      if (!personSnap.exists) {
        throw new HttpsError("not-found", "That person was not found.");
      }
      const person = personSnap.data();
      const req = reqSnap.exists ? reqSnap.data() : {};
      const to = toE164US(person.contact && person.contact.phone);

      const kind = pr.manualPrayerRequestKind({
        hasPhone: !!to,
        requestFilled: !!(req.prayerRequest || "").trim(),
        initialSentDate: req.initialSentDate || null,
        reminderSent: !!req.reminderSent,
      });
      if (kind === "none") {
        throw new HttpsError("failed-precondition", to ?
          "This prayer request is already filled." :
          "This person has no phone number on file.");
      }

      const {templates} = await loadPrayerConfig(db);
      const result = await dispatchPrayerText(db, {
        serviceDate, personId, kind, templates, personSnap, reqRef,
      });
      if (!result.success) {
        throw new HttpsError("unavailable", result.error || "Send failed.");
      }
      log(`Manual prayer-request ${kind} sent to ${personId} (${serviceDate}).`);
      return {success: true, kind, textId: result.textId,
        quotaRemaining: result.quotaRemaining};
    },
);

/**
 * Elder digest. When every designated pastoral-prayer subject for a service has
 * a filled Prayer Request — and the fill that completed the set came by text
 * reply — text everyone with the "Elder" tag a summary (who, the date, each
 * request). A set completed manually (an elder already in the system) sends
 * nothing. Fires at most once per service via a deterministic marker doc.
 *
 * This trigger catches both fill paths because both write the same
 * prayer_requests doc — the texted reply (applyPrayerRequestReply) and the
 * manual save (the Service Builder client). It is independent of the automatic-
 * send kill switch, which governs only the outbound request texts.
 */
exports.notifyEldersOnPrayerComplete = onDocumentWritten(
    {
      document: "people/{personId}/prayer_requests/{serviceDate}",
      region: "us-central1",
      secrets: [TEXTBELT_KEY],
    },
    async (event) => {
      const after = event.data && event.data.after && event.data.after.exists ?
        event.data.after.data() : null;
      if (!after) return; // Deleted — nothing to do.
      // Only a fill (non-empty request) can complete the set.
      if (!(after.prayerRequest || "").trim()) return;

      const {personId, serviceDate} = event.params;
      const before = event.data.before && event.data.before.exists ?
        event.data.before.data() : null;
      const db = admin.firestore();

      // Designated subjects for this service.
      const svcSnap = await db.collection("services").doc(serviceDate).get();
      if (!svcSnap.exists) return;
      const liturgy = svcSnap.data().liturgy || {};
      const subjects = [liturgy.prayerMale, liturgy.prayerFemale]
          .filter((s) => s && s.id);
      if (subjects.length === 0) return;

      // Current request docs for each subject (the changed one uses the write's
      // after-state; the others are unchanged by this event).
      const reqSnaps = await Promise.all(subjects.map((s) =>
        db.collection("people").doc(s.id)
            .collection("prayer_requests").doc(serviceDate).get()));
      const filledText = (i) => {
        if (subjects[i].id === personId) return (after.prayerRequest || "").trim();
        const snap = reqSnaps[i];
        return ((snap.exists && snap.data().prayerRequest) || "").trim();
      };

      const subjectStates = subjects.map((s, i) => ({filled: !!filledText(i)}));
      const wasCompleteBefore = subjects.every((s, i) =>
        s.id === personId ?
          !!(before && (before.prayerRequest || "").trim()) :
          !!filledText(i));

      if (!pr.elderDigestDecision({
        subjectStates,
        changedSource: after.prayerRequestSource || null,
        wasCompleteBefore,
      })) {
        return;
      }

      // Idempotency lock: a deterministic marker doc, created atomically. If it
      // already exists, another invocation has the digest.
      const markerRef = db.collection(SMS_MESSAGES_COLLECTION)
          .doc(`elder_digest_${serviceDate}`);
      try {
        await markerRef.create({
          direction: "outbound",
          purpose: "elder_digest",
          serviceDate,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      } catch (e) {
        log(`Elder digest already handled for ${serviceDate}; skipping.`);
        return;
      }

      // Render the digest from each subject's name + request.
      const subjectLines = subjects.map((s, i) => ({
        name: s.name || "", request: filledText(i),
      }));
      const {templates} = await loadPrayerConfig(db);
      const body = pr.renderElderDigest(templates.elderDigest, {
        serviceDate, subjects: subjectLines,
      });

      // Recipients: everyone with the "Elder" tag and a phone, deduped.
      const eldersSnap = await db.collection("people")
          .where("tags", "array-contains", "Elder").get();
      const seen = new Set();
      const recipients = [];
      for (const doc of eldersSnap.docs) {
        const to = toE164US(doc.data().contact && doc.data().contact.phone);
        if (!to || seen.has(to)) continue;
        seen.add(to);
        recipients.push({personId: doc.id, to});
      }
      if (recipients.length === 0) {
        log(`Elder digest ${serviceDate}: no Elder-tagged recipients with a phone.`);
        return;
      }

      for (const r of recipients) {
        try {
          const result = await sendViaTextbelt({to: r.to, body, withReplyWebhook: false});
          if (result.success) {
            await recordOutbound(db, {
              to: r.to, body, textId: result.textId,
              purpose: "elder_digest", personId: r.personId, serviceDate,
            });
          } else {
            log(`Elder digest send failed for ${r.to}: ${result.error}`);
          }
        } catch (e) {
          log(`Elder digest send error for ${r.to}: ${e.message}`);
        }
      }
      log(`Elder digest sent for ${serviceDate} to ${recipients.length} elder(s).`);
    },
);

