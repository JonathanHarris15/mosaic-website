const {onCall, onRequest, HttpsError} = require("firebase-functions/v2/https");
const {onDocumentWritten} = require("firebase-functions/v2/firestore");
const {onSchedule} = require("firebase-functions/v2/scheduler");
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
const pr = require("./prayer-request");

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
  const role = callerDoc.exists ? callerDoc.data().role : null;
  if (!["elder", "super_admin"].includes(role)) {
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

