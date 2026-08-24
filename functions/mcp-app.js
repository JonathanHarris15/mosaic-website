/**
 * The HTTP app that puts the MCP server (mcp-server.js) behind the front
 * door (mcp-auth.js). MS-262.
 *
 * ⚠ THE ORDER OF THE MIDDLEWARE IS THE SECURITY. `requireBearerAuth` sits in
 * front of the MCP endpoint and nothing else may be added between them. Move
 * the tool handler above it, or mount a second route to it, and the whole
 * door is open.
 *
 * WHAT LIVES WHERE. The SDK's `mcpAuthRouter` owns /authorize, /token,
 * /register, /revoke and the two .well-known documents — those are standard
 * OAuth and are not ours to write. This file adds exactly one endpoint of its
 * own, /oauth/signin, which is the hand-off from our sign-in page back into
 * the flow.
 *
 * ⚠ THESE PATHS SIT AT THE ROOT OF WHATEVER HOST SERVES THEM. /authorize and
 * /register are not namespaced — that is fixed by the OAuth discovery specs,
 * not a choice. Serve this from its own hosting site rather than from the
 * church's main domain unless you are certain none of those paths are wanted
 * there. See docs/plans/ms-262-mcp-server-order-of-service.md.
 */

const express = require("express");

const mcpServer = require("./mcp-server");
const {FirebaseOAuthProvider} = require("./mcp-auth");

/**
 * Builds the Express app.
 *
 * @param {object} deps
 * @param {object} deps.db the Firestore handle
 * @param {object} deps.auth the Firebase Auth admin instance
 * @param {string} deps.issuerUrl this server's public base URL, no trailing slash
 * @param {object} deps.webConfig the public Firebase web config, for the sign-in page
 * @param {function(): string} deps.geminiKey reads the Gemini secret
 * @param {object} deps.fieldValues {serverTimestamp, deleteField} factories
 * @return {Promise<object>} the Express app
 */
async function buildApp({db, auth, issuerUrl, webConfig, geminiKey, fieldValues}) {
  const [{mcpAuthRouter, getOAuthProtectedResourceMetadataUrl},
    {requireBearerAuth}] = await Promise.all([
    import("@modelcontextprotocol/sdk/server/auth/router.js"),
    import("@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js"),
  ]);

  const base = String(issuerUrl).replace(/\/+$/, "");
  const resourceUrl = new URL(base + "/mcp");

  const provider = new FirebaseOAuthProvider({
    db, auth, issuerUrl: base, webConfig,
  });

  const app = express();
  app.use(express.json({limit: "1mb"}));
  app.use(express.urlencoded({extended: false}));

  app.use(mcpAuthRouter({
    provider,
    issuerUrl: new URL(base),
    resourceServerUrl: resourceUrl,
    resourceName: "Mosaic Order of Service",
    scopesSupported: ["order-of-service"],
  }));

  // The hand-off from our own sign-in page. The browser has already talked
  // to Firebase Auth directly and holds a signed identity token; this turns
  // that into an authorization code and bounces back to the assistant.
  app.post("/oauth/signin", async (req, res) => {
    try {
      const result = await provider.completeSignIn({
        requestId: (req.body && req.body.request_id) || "",
        idToken: (req.body && req.body.id_token) || "",
      });
      if (result.error) {
        res.status(400).set("Content-Type", "text/html; charset=utf-8");
        res.send(errorPage(result.error));
        return;
      }
      res.redirect(302, result.redirectTo);
    } catch (e) {
      res.status(500).set("Content-Type", "text/html; charset=utf-8");
      res.send(errorPage("Something went wrong completing the sign-in."));
    }
  });

  // ⚠ NOTHING GOES BETWEEN THIS MIDDLEWARE AND THIS HANDLER.
  app.post("/mcp", requireBearerAuth({
    verifier: provider,
    resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(resourceUrl),
  }), async (req, res) => {
    const info = req.auth || {};
    const extra = info.extra || {};
    await mcpServer.handleMcpRequest(req, res, {
      db,
      auth: {uid: extra.uid, permissionLevel: extra.permissionLevel},
      geminiKey,
      fieldValues,
    });
  });

  // Streamable HTTP allows GET for a server-initiated stream. This server has
  // nothing to push — every tool is request/response — so it says so plainly
  // rather than leaving a client waiting on a stream that never speaks.
  app.get("/mcp", requireBearerAuth({
    verifier: provider,
    resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(resourceUrl),
  }), (req, res) => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: {code: -32000, message: "This server does not push events."},
      id: null,
    });
  });

  return app;
}

/**
 * A plain page for the handful of things that can go wrong in the browser
 * half of the flow.
 * @param {string} message what went wrong
 * @return {string} HTML
 */
function errorPage(message) {
  const safe = String(message)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Could not connect</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
         display: grid; place-items: center; min-height: 100vh; margin: 0;
         background: #f6f7f9; color: #14171f; }
  @media (prefers-color-scheme: dark) {
    body { background: #14171f; color: #e9ecf2; }
    .card { background: #1d212b !important; border-color: #2b3140 !important; }
  }
  .card { background: #fff; border: 1px solid #e2e5ea; border-radius: 12px;
          padding: 28px; width: min(380px, calc(100vw - 32px)); }
  h1 { font-size: 1.1rem; margin: 0 0 8px; }
  p { margin: 0; font-size: .92rem; line-height: 1.5; opacity: .85; }
</style></head>
<body><div class="card"><h1>Could not connect</h1><p>${safe}</p></div></body></html>`;
}

module.exports = {buildApp, errorPage};
