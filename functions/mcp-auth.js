/**
 * The front door to the Order of Service MCP server (MS-262, ADR-0038).
 *
 * ⚠ READ THIS BEFORE CHANGING ANYTHING HERE. This file decides who may read
 * and rewrite the church's Sundays from outside the website. Everything in
 * it is either a deliberate security property or a bug.
 *
 * WHAT IS OURS AND WHAT IS NOT. The OAuth mechanics — the flow, PKCE, the
 * standard metadata documents, the challenge responses — belong to the MCP
 * SDK and are not reimplemented here. This file supplies only the parts that
 * are specific to this church: who is signing in, whether they are allowed
 * to edit, and where the passes are kept. Resist the urge to hand-roll any
 * of the OAuth half back into this file.
 *
 * THE PASSWORD NEVER REACHES THIS SERVER. The sign-in page talks straight to
 * Firebase Auth in the browser — the same call public/login.html has always
 * made — and sends us back only the signed identity token Firebase issues.
 * We verify that token with the Admin SDK. So this server never sees, logs,
 * or could accidentally store anybody's password.
 *
 * TOKENS ARE STORED AS HASHES, NEVER AS THEMSELVES. `mcp_tokens` is keyed by
 * the SHA-256 of the token, and the row does not contain the token. Somebody
 * who walked off with a copy of that collection would hold no working pass.
 *
 * PERMISSION IS RE-CHECKED ON EVERY SINGLE REQUEST, not snapshotted into the
 * token at sign-in. Take somebody's editor rights away and their assistant
 * stops being able to write on the next call, rather than whenever their
 * pass happens to expire. This costs one Firestore read per request and is
 * worth it.
 *
 * AUTHORIZATION CODES ARE SINGLE-USE AND SHORT-LIVED. Exchanged inside a
 * transaction that deletes the code, so two racing redemptions cannot both
 * win.
 */

const crypto = require("crypto");

const CLIENTS = "mcp_clients";
const AUTH_REQUESTS = "mcp_auth_requests";
const AUTH_CODES = "mcp_auth_codes";
const TOKENS = "mcp_tokens";

// Who may use this at all. The same floor the Order of Service writes and
// scoreTheme already enforce — this door is not a new level of access, it is
// the existing one reached a different way.
const EDITOR_LEVELS = ["editor", "elder", "admin", "super_admin"];

// An authorization code is exchanged within seconds of being issued. A long
// life on one buys an attacker time and buys a real user nothing.
const AUTH_CODE_TTL_MS = 60 * 1000;
// How long a sign-in page may sit open before its pending request lapses.
const AUTH_REQUEST_TTL_MS = 15 * 60 * 1000;
const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000;
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** @return {string} a 256-bit random value, hex encoded */
function randomToken() {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * ⚠ The only thing ever written to `mcp_tokens` as an id.
 * @param {string} token the raw token
 * @return {string} its SHA-256, hex encoded
 */
function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/**
 * Compares two secrets without leaking which byte differed via timing.
 * @param {string} a one
 * @param {string} b the other
 * @return {boolean} whether they match
 */
function safeEqual(a, b) {
  const bufA = Buffer.from(String(a || ""), "utf8");
  const bufB = Buffer.from(String(b || ""), "utf8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Where registered MCP clients live. An assistant registers itself once
 * (Dynamic Client Registration) and is remembered by its id thereafter.
 */
class FirebaseClientsStore {
  /** @param {object} db the Firestore handle */
  constructor(db) {
    this.db = db;
  }

  /**
   * @param {string} clientId the client's id
   * @return {Promise<object|undefined>} the client, or undefined
   */
  async getClient(clientId) {
    const snap = await this.db.collection(CLIENTS).doc(clientId).get();
    return snap.exists ? snap.data() : undefined;
  }

  /**
   * @param {object} client the metadata the client registered with
   * @return {Promise<object>} the stored client, with its issued id
   */
  async registerClient(client) {
    const clientId = randomToken();
    const record = Object.assign({}, client, {
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
    });
    await this.db.collection(CLIENTS).doc(clientId).set(record);
    return record;
  }
}

/**
 * The OAuth server, backed by Firebase Auth for identity and Firestore for
 * everything that has to outlive one Cloud Functions instance.
 */
class FirebaseOAuthProvider {
  /**
   * @param {object} deps
   * @param {object} deps.db the Firestore handle
   * @param {object} deps.auth the Firebase Auth admin instance
   * @param {string} deps.issuerUrl this server's own base URL
   * @param {object} deps.webConfig the Firebase web config for the sign-in page
   */
  constructor({db, auth, issuerUrl, webConfig}) {
    this.db = db;
    this.auth = auth;
    this.issuerUrl = issuerUrl;
    this.webConfig = webConfig;
    this._clientsStore = new FirebaseClientsStore(db);
  }

  /** @return {FirebaseClientsStore} the clients store */
  get clientsStore() {
    return this._clientsStore;
  }

  /**
   * Step one of signing in: park what the client asked for, and show the
   * person a sign-in page.
   *
   * The request is parked SERVER-SIDE under a random id rather than being
   * round-tripped through the page. Anything sent through the browser is
   * something the browser can edit — and `redirectUri` is exactly the field
   * an attacker would want to edit.
   *
   * @param {object} client the registered client
   * @param {object} params what it asked for
   * @param {object} res the Express response
   * @return {Promise<void>}
   */
  async authorize(client, params, res) {
    const requestId = randomToken();
    await this.db.collection(AUTH_REQUESTS).doc(requestId).set({
      clientId: client.client_id,
      clientName: client.client_name || "An assistant",
      codeChallenge: params.codeChallenge,
      redirectUri: params.redirectUri,
      state: params.state || null,
      scopes: params.scopes || [],
      resource: params.resource ? String(params.resource) : null,
      expiresAt: Date.now() + AUTH_REQUEST_TTL_MS,
    });

    res.set("Content-Type", "text/html; charset=utf-8");
    res.send(this.signInPage(requestId, client.client_name || "An assistant"));
  }

  /**
   * Step two: the browser has signed in with Firebase and sends back the
   * identity token Firebase issued. Verify it, check they are an editor,
   * and hand back an authorization code.
   *
   * @param {object} args
   * @param {string} args.requestId the parked request
   * @param {string} args.idToken the Firebase identity token
   * @return {Promise<{redirectTo: string}|{error: string}>} where to go next
   */
  async completeSignIn({requestId, idToken}) {
    const reqRef = this.db.collection(AUTH_REQUESTS).doc(String(requestId || ""));
    const reqSnap = await reqRef.get();
    if (!reqSnap.exists) return {error: "This sign-in link has expired. Start again."};
    const pending = reqSnap.data();
    if (pending.expiresAt < Date.now()) {
      await reqRef.delete();
      return {error: "This sign-in link has expired. Start again."};
    }

    let decoded;
    try {
      decoded = await this.auth.verifyIdToken(String(idToken || ""), true);
    } catch (e) {
      return {error: "That sign-in could not be verified. Please try again."};
    }

    const level = await this.permissionLevelOf(decoded.uid);
    if (!EDITOR_LEVELS.includes(level)) {
      // Deliberately specific: a member who is refused should understand it
      // is about their permissions, not a mistyped password.
      await reqRef.delete();
      return {
        error: "Your account does not have editor access to the Order of " +
          "Service, so it cannot be connected to an assistant.",
      };
    }

    const code = randomToken();
    await this.db.collection(AUTH_CODES).doc(code).set({
      clientId: pending.clientId,
      codeChallenge: pending.codeChallenge,
      redirectUri: pending.redirectUri,
      scopes: pending.scopes,
      resource: pending.resource,
      uid: decoded.uid,
      expiresAt: Date.now() + AUTH_CODE_TTL_MS,
    });
    await reqRef.delete();

    const url = new URL(pending.redirectUri);
    url.searchParams.set("code", code);
    if (pending.state) url.searchParams.set("state", pending.state);
    // RFC 9207 — lets the client prove the response came from us, and not
    // from a different authorization server it also talks to.
    url.searchParams.set("iss", this.issuerUrl);
    return {redirectTo: url.toString()};
  }

  /**
   * Someone's permission level, read fresh.
   * @param {string} uid the Firebase uid
   * @return {Promise<?string>} their level, or null
   */
  async permissionLevelOf(uid) {
    const snap = await this.db.collection("users").doc(uid).get();
    if (!snap.exists) return null;
    const data = snap.data();
    return data.permissionLevel || data.role || null;
  }

  /**
   * The PKCE challenge recorded when this code was issued. The SDK compares
   * it against the verifier the client presents.
   * @param {object} client the client
   * @param {string} authorizationCode the code
   * @return {Promise<string>} the challenge
   */
  async challengeForAuthorizationCode(client, authorizationCode) {
    const snap = await this.db.collection(AUTH_CODES)
        .doc(String(authorizationCode || "")).get();
    if (!snap.exists) throw new Error("Unknown or already-used code.");
    const data = snap.data();
    if (!safeEqual(data.clientId, client.client_id)) {
      throw new Error("That code was not issued to this client.");
    }
    return data.codeChallenge;
  }

  /**
   * Trade a code for a pass.
   *
   * ⚠ IN A TRANSACTION THAT DELETES THE CODE. A code is good exactly once;
   * two redemptions racing must not both succeed.
   *
   * @param {object} client the client
   * @param {string} authorizationCode the code
   * @param {string} [codeVerifier] PKCE verifier (checked by the SDK)
   * @param {string} [redirectUri] must match the one the code was issued for
   * @param {URL} [resource] what the token is for
   * @return {Promise<object>} OAuth tokens
   */
  async exchangeAuthorizationCode(
      client, authorizationCode, codeVerifier, redirectUri, resource) {
    const codeRef = this.db.collection(AUTH_CODES)
        .doc(String(authorizationCode || ""));

    const claim = await this.db.runTransaction(async (tx) => {
      const snap = await tx.get(codeRef);
      if (!snap.exists) throw new Error("Unknown or already-used code.");
      const data = snap.data();
      if (!safeEqual(data.clientId, client.client_id)) {
        throw new Error("That code was not issued to this client.");
      }
      if (data.expiresAt < Date.now()) {
        tx.delete(codeRef);
        throw new Error("That code has expired.");
      }
      if (redirectUri !== undefined && data.redirectUri !== redirectUri) {
        throw new Error("Redirect URI does not match the one authorized.");
      }
      tx.delete(codeRef);
      return data;
    });

    // The audience this pass is good for. Recorded now and checked on every
    // use, so a pass minted for this server cannot be presented at another.
    const audience = resource ? String(resource) : claim.resource;
    return this.issueTokens({
      clientId: client.client_id,
      uid: claim.uid,
      scopes: claim.scopes || [],
      resource: audience,
    });
  }

  /**
   * Trade a refresh token for a fresh pass. The old refresh token is
   * retired in the same transaction that reads it (rotation), so a stolen
   * one stops working the moment the real client next refreshes.
   *
   * @param {object} client the client
   * @param {string} refreshToken the refresh token
   * @param {Array<string>} [scopes] requested scopes
   * @param {URL} [resource] what the token is for
   * @return {Promise<object>} OAuth tokens
   */
  async exchangeRefreshToken(client, refreshToken, scopes, resource) {
    const ref = this.db.collection(TOKENS).doc(hashToken(String(refreshToken || "")));

    const claim = await this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new Error("Unknown or already-used refresh token.");
      const data = snap.data();
      if (data.type !== "refresh") throw new Error("That is not a refresh token.");
      if (!safeEqual(data.clientId, client.client_id)) {
        throw new Error("That token was not issued to this client.");
      }
      if (data.expiresAt < Date.now()) {
        tx.delete(ref);
        throw new Error("That refresh token has expired.");
      }
      tx.delete(ref);
      return data;
    });

    // Still an editor? A refresh is a fresh grant of an hour's access, so it
    // is exactly the wrong moment to skip the check.
    const level = await this.permissionLevelOf(claim.uid);
    if (!EDITOR_LEVELS.includes(level)) {
      throw new Error("This account no longer has editor access.");
    }

    return this.issueTokens({
      clientId: client.client_id,
      uid: claim.uid,
      scopes: scopes && scopes.length ? scopes : (claim.scopes || []),
      resource: resource ? String(resource) : claim.resource,
    });
  }

  /**
   * Mints an access/refresh pair and stores only their hashes.
   * @param {object} args the grant
   * @return {Promise<object>} OAuth tokens
   */
  async issueTokens({clientId, uid, scopes, resource}) {
    const accessToken = randomToken();
    const refreshToken = randomToken();
    const now = Date.now();

    const batch = this.db.batch();
    batch.set(this.db.collection(TOKENS).doc(hashToken(accessToken)), {
      type: "access",
      clientId, uid, scopes: scopes || [], resource: resource || null,
      expiresAt: now + ACCESS_TOKEN_TTL_MS,
    });
    batch.set(this.db.collection(TOKENS).doc(hashToken(refreshToken)), {
      type: "refresh",
      clientId, uid, scopes: scopes || [], resource: resource || null,
      expiresAt: now + REFRESH_TOKEN_TTL_MS,
    });
    await batch.commit();

    return {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
      refresh_token: refreshToken,
      scope: (scopes || []).join(" "),
    };
  }

  /**
   * Is this pass good, and whose is it?
   *
   * ⚠ THE PERMISSION CHECK HERE IS LIVE, not a replay of what was true at
   * sign-in. This is the line that makes revoking somebody's editor rights
   * take effect immediately.
   *
   * @param {string} token the bearer token
   * @return {Promise<object>} AuthInfo for the SDK
   */
  async verifyAccessToken(token) {
    const snap = await this.db.collection(TOKENS)
        .doc(hashToken(String(token || ""))).get();
    if (!snap.exists) throw new Error("Invalid access token.");
    const data = snap.data();
    if (data.type !== "access") throw new Error("Invalid access token.");
    if (data.expiresAt < Date.now()) throw new Error("Access token expired.");

    const level = await this.permissionLevelOf(data.uid);
    if (!EDITOR_LEVELS.includes(level)) {
      throw new Error("This account no longer has editor access.");
    }

    return {
      token,
      clientId: data.clientId,
      scopes: data.scopes || [],
      expiresAt: Math.floor(data.expiresAt / 1000),
      resource: data.resource ? new URL(data.resource) : undefined,
      // What the MCP server needs to know about the caller. `extra` is the
      // SDK's sanctioned channel for it.
      extra: {uid: data.uid, permissionLevel: level},
    };
  }

  /**
   * Throws a pass away. Silent if it was already gone — revoking twice is
   * not an error.
   * @param {object} client the client
   * @param {object} request {token}
   * @return {Promise<void>}
   */
  async revokeToken(client, request) {
    const ref = this.db.collection(TOKENS)
        .doc(hashToken(String((request && request.token) || "")));
    const snap = await ref.get();
    if (!snap.exists) return;
    if (!safeEqual(snap.data().clientId, client.client_id)) return;
    await ref.delete();
  }

  /**
   * The sign-in page. Deliberately plain and self-contained: it is served
   * from a Cloud Function, not from the site, so it cannot lean on the
   * site's stylesheet without a second round trip.
   *
   * The Firebase web config here is the same public config already served
   * in public/auth.js — it identifies the project, it is not a secret.
   *
   * @param {string} requestId the parked request
   * @param {string} clientName who is asking
   * @return {string} HTML
   */
  signInPage(requestId, clientName) {
    const safeName = String(clientName)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    const cfg = JSON.stringify(this.webConfig);
    const rid = String(requestId).replace(/[^a-f0-9]/gi, "");

    return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Connect to Mosaic</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
         display: grid; place-items: center; min-height: 100vh; margin: 0;
         background: #f6f7f9; color: #14171f; }
  @media (prefers-color-scheme: dark) {
    body { background: #14171f; color: #e9ecf2; }
    .card { background: #1d212b !important; border-color: #2b3140 !important; }
    input { background: #14171f !important; color: #e9ecf2 !important;
            border-color: #2b3140 !important; }
  }
  .card { background: #fff; border: 1px solid #e2e5ea; border-radius: 12px;
          padding: 28px; width: min(380px, calc(100vw - 32px));
          box-shadow: 0 1px 3px rgba(0,0,0,.06); }
  h1 { font-size: 1.15rem; margin: 0 0 4px; }
  p.sub { margin: 0 0 20px; font-size: .9rem; opacity: .75; line-height: 1.45; }
  label { display: block; font-size: .8rem; font-weight: 600; margin: 12px 0 5px; }
  input { width: 100%; box-sizing: border-box; padding: 9px 11px; font-size: .95rem;
          border: 1px solid #d3d7de; border-radius: 7px; }
  button { width: 100%; margin-top: 20px; padding: 10px; font-size: .95rem;
           font-weight: 600; border: 0; border-radius: 7px; background: #2f6df6;
           color: #fff; cursor: pointer; }
  button[disabled] { opacity: .55; cursor: default; }
  .err { margin-top: 14px; font-size: .85rem; color: #c02b2b; line-height: 1.45; }
  @media (prefers-color-scheme: dark) { .err { color: #ff8a8a; } }
</style>
</head><body>
<div class="card">
  <h1>Connect to Mosaic</h1>
  <p class="sub"><strong>${safeName}</strong> is asking to read and edit your
     church's Order of Service. Sign in with your usual Mosaic account to allow it.</p>
  <form id="f">
    <label for="e">Email</label>
    <input id="e" type="email" autocomplete="username" required>
    <label for="p">Password</label>
    <input id="p" type="password" autocomplete="current-password" required>
    <button id="b" type="submit">Sign in and connect</button>
  </form>
  <div class="err" id="err" hidden></div>
</div>
<script src="https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/10.12.2/firebase-auth-compat.js"></script>
<script>
  firebase.initializeApp(${cfg});
  var f = document.getElementById('f'), b = document.getElementById('b'),
      err = document.getElementById('err');
  function fail(m) { err.textContent = m; err.hidden = false; b.disabled = false;
                     b.textContent = 'Sign in and connect'; }
  f.addEventListener('submit', function (ev) {
    ev.preventDefault();
    err.hidden = true; b.disabled = true; b.textContent = 'Signing in\\u2026';
    firebase.auth().signInWithEmailAndPassword(
        document.getElementById('e').value.trim(),
        document.getElementById('p').value)
      .then(function (c) { return c.user.getIdToken(); })
      .then(function (idToken) {
        // The password stays in this page. Only the token Firebase signed
        // goes to the server.
        var form = document.createElement('form');
        form.method = 'POST';
        form.action = '/oauth/signin';
        [['request_id', ${JSON.stringify(rid)}], ['id_token', idToken]]
          .forEach(function (pair) {
            var i = document.createElement('input');
            i.type = 'hidden'; i.name = pair[0]; i.value = pair[1];
            form.appendChild(i);
          });
        document.body.appendChild(form);
        form.submit();
      })
      .catch(function () { fail('That email and password did not match an account.'); });
  });
</script>
</body></html>`;
  }
}

module.exports = {
  FirebaseOAuthProvider,
  FirebaseClientsStore,
  EDITOR_LEVELS,
  hashToken,
  randomToken,
  safeEqual,
  AUTH_CODE_TTL_MS,
  AUTH_REQUEST_TTL_MS,
  ACCESS_TOKEN_TTL_MS,
  REFRESH_TOKEN_TTL_MS,
  COLLECTIONS: {CLIENTS, AUTH_REQUESTS, AUTH_CODES, TOKENS},
};
