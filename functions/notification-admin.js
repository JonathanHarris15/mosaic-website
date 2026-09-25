/**
 * @fileoverview Admin-only push notification tools for the dashboard.
 * Handlers are exported for unit tests; index.js wires them to onCall.
 * Throws plain Errors with `.code` so root npm test avoids firebase-functions.
 */

const nc = require("./notification-core");
const nac = require("./shared/notification-admin-core.js");
const pr = require("./prayer-request.js");

const ADMIN_PUSH_TEST_PURPOSE = "admin_push_test";

/**
 * @param {string} code
 * @param {string} message
 */
function reject(code, message) {
  const err = new Error(message);
  err.code = code;
  throw err;
}

/**
 * @param {Object} db
 * @param {Object} authCtx
 * @param {function} assertAdminFn
 * @return {Promise<void>}
 */
async function guardAdmin(db, authCtx, assertAdminFn) {
  await assertAdminFn(db, authCtx);
}

/**
 * List device tokens (masked) for all linked users. Admins cannot read
 * push_tokens client-side (ADR-0036).
 * @param {Object} deps db, assertAdmin
 * @param {Object} authCtx
 * @return {Promise<{devices: Array}>}
 */
async function listPushDevices(deps, authCtx) {
  await guardAdmin(deps.db, authCtx, deps.assertAdmin);
  const snap = await deps.db.collectionGroup("push_tokens")
      .orderBy("updatedAt", "desc")
      .limit(200)
      .get();

  const uids = [];
  snap.docs.forEach((doc) => {
    const parent = doc.ref.parent && doc.ref.parent.parent;
    const uid = parent && parent.id;
    if (uid) uids.push(uid);
  });
  const uniqueUids = [...new Set(uids)];

  const userSnaps = await Promise.all(uniqueUids.map((uid) =>
    deps.db.collection("users").doc(uid).get()));
  const usersByUid = {};
  userSnaps.forEach((us) => {
    if (us.exists) usersByUid[us.id] = us.data();
  });

  const personByUid = {};
  for (let i = 0; i < uniqueUids.length; i += 30) {
    const chunk = uniqueUids.slice(i, i + 30);
    if (!chunk.length) continue;
    const personSnaps = await deps.db.collection("people")
        .where("userId", "in", chunk).get();
    personSnaps.docs.forEach((ps) => {
      const uid = ps.data().userId;
      if (uid && !personByUid[uid]) {
        const data = ps.data();
        personByUid[uid] = {
          id: ps.id,
          name: (data.name && data.name.full) ||
            pr.firstNameOf(data.name) || ps.id,
        };
      }
    });
  }

  const now = deps.now ? deps.now() : new Date();
  const devices = snap.docs.map((doc) => {
    const data = doc.data() || {};
    const parent = doc.ref.parent && doc.ref.parent.parent;
    const uid = parent && parent.id;
    const user = usersByUid[uid] || {};
    const person = personByUid[uid] || null;
    const updatedAt = data.updatedAt || null;
    return {
      uid: uid,
      tokenId: doc.id,
      platform: data.platform || "unknown",
      updatedAtMs: nac.timestampToMs(updatedAt),
      maskedToken: nac.maskPushToken(data.token),
      stale: nac.isStaleToken(updatedAt, now.getTime()),
      accountEmail: user.email || null,
      personId: person && person.id,
      personName: person && person.name,
    };
  });

  return {devices: devices};
}

/**
 * Delete one push token document. Admin-only.
 * @param {Object} deps
 * @param {Object} authCtx
 * @param {Object} data uid, tokenId
 * @return {Promise<{revoked: boolean}>}
 */
async function revokePushToken(deps, authCtx, data) {
  await guardAdmin(deps.db, authCtx, deps.assertAdmin);
  const uid = data && data.uid;
  const tokenId = data && data.tokenId;
  if (!uid || !tokenId) {
    reject("invalid-argument", "uid and tokenId are required.");
  }
  const ref = deps.db.collection("users").doc(String(uid))
      .collection("push_tokens").doc(String(tokenId));
  const snap = await ref.get();
  if (!snap.exists) {
    reject("not-found", "That device token is already gone.");
  }
  await ref.delete();
  return {revoked: true};
}

/**
 * Send a test push to every token on the signed-in admin's account only.
 * Ignores any client-supplied uid or token.
 * @param {Object} deps db, assertAdmin, sendPush, writeLog, now
 * @param {Object} authCtx
 * @return {Promise<Object>}
 */
async function sendSelfPushTest(deps, authCtx) {
  await guardAdmin(deps.db, authCtx, deps.assertAdmin);
  if (!authCtx || !authCtx.uid) {
    reject("unauthenticated", "Sign in first.");
  }
  const uid = authCtx.uid;
  const snap = await deps.db.collection("users").doc(uid)
      .collection("push_tokens").get();
  const tokens = snap.docs
      .map((doc) => ({id: doc.id, token: doc.data().token}))
      .filter((row) => row.token);

  if (!tokens.length) {
    reject(
        "failed-precondition",
        "No device tokens on your account. Sign in on the phone app first.");
  }

  const title = "Mosaic admin test";
  const body = "Push notifications admin tab — test send.";
  const url = "/index.html";
  let sent = 0;
  let accepted = 0;

  for (const row of tokens) {
    sent += 1;
    let result;
    try {
      result = await deps.sendPush({
        token: row.token,
        title: title,
        body: body,
        url: url,
      });
    } catch (err) {
      result = {accepted: false, error: err};
    }
    const ok = !!(result && result.accepted);
    if (ok) accepted += 1;
    if (result && result.error && nc.isDeadToken(result.error)) {
      await deps.deleteToken(uid, row.id);
    }
    await deps.writeLog({
      personId: null,
      channel: "push",
      purpose: ADMIN_PUSH_TEST_PURPOSE,
      wording: null,
      serviceDate: null,
      accepted: ok,
      unreachable: !ok,
      url: url,
      title: title,
      body: body,
      adminUid: uid,
      tokenId: row.id,
    });
  }

  return {sent: sent, accepted: accepted, purpose: ADMIN_PUSH_TEST_PURPOSE};
}

/**
 * Overview payload: flow steps + registry + autoSend flag.
 * @param {Object} deps
 * @param {Object} authCtx
 * @return {Promise<Object>}
 */
async function notificationOverview(deps, authCtx) {
  await guardAdmin(deps.db, authCtx, deps.assertAdmin);
  const configSnap = await deps.db.doc("app_config/prayer_request_sms").get();
  const autoSendEnabled = configSnap.exists &&
    !!configSnap.data().autoSendEnabled;
  return {
    flow: nac.buildSendFlow({
      CHURCH_TIMEZONE: nc.CHURCH_TIMEZONE,
      WINDOW_OPEN_HOUR: nc.WINDOW_OPEN_HOUR,
      WINDOW_CLOSE_HOUR: nc.WINDOW_CLOSE_HOUR,
      DEAD_TOKEN_CODES: nc.DEAD_TOKEN_CODES,
    }),
    triggers: nac.notificationTriggers(),
    autoSendEnabled: autoSendEnabled,
    smsMigrationNote:
      "Older outbound rows may still live in the legacy SMS log until " +
      "the MS-253 copy runs in prod; this tab reads notifications only.",
  };
}

module.exports = {
  ADMIN_PUSH_TEST_PURPOSE,
  listPushDevices,
  revokePushToken,
  sendSelfPushTest,
  notificationOverview,
};
