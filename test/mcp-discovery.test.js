// What an assistant learns from this server before it is allowed in, and
// what it is told when its pass has gone stale. MS-262.
//
// ⚠ THE STATUS CODE IS THE CONVERSATION. Everything here is about a client
// that holds a pass from before a redeploy. Told 401, it sends the person
// back through the sign-in and recovers on its own. Told 500, it concludes
// the server is broken and stops — and because the fault looks like ours
// rather than its own, removing and re-adding the connector does not help.
// That was a real, silent outage: every refusal in mcp-auth.js threw a bare
// Error, and the SDK turns anything that is not an OAuthError into a 500.
//
// These run against the real Express app with a stub Firestore, because the
// bug was never in the provider's logic — it was in the shape of what came
// out of it, and only the wired-up app shows that.

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

const {buildApp} = require('../functions/mcp-app.js');

const ISSUER = 'https://mcp.example.test';

// A Firestore that holds nothing. Enough for the paths under test: an
// unknown token and an unknown client both come back as "does not exist".
const emptyDb = {
    collection: () => ({
        doc: () => ({
            get: async () => ({exists: false, data: () => undefined}),
        }),
    }),
};

/** @return {Promise<{url: string, close: function(): Promise<void>}>} a live server */
async function serve() {
    const app = await buildApp({
        db: emptyDb,
        auth: {verifyIdToken: async () => ({uid: 'nobody'})},
        issuerUrl: ISSUER,
        webConfig: {apiKey: 'fake', authDomain: 'fake', projectId: 'fake'},
        geminiKey: () => '',
        fieldValues: {serverTimestamp: () => null, deleteField: () => null},
    });
    const server = http.createServer(app);
    await new Promise((done) => server.listen(0, '127.0.0.1', done));
    const {port} = server.address();
    return {
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((done) => server.close(done)),
    };
}

test('the protected-resource document answers at both addresses', async () => {
    const s = await serve();
    try {
        // The address the spec sends a client to, and the one our own 401
        // names. The SDK owns this one.
        const suffixed = await fetch(
            `${s.url}/.well-known/oauth-protected-resource/mcp`);
        // The older, unsuffixed address. Several clients ask only here, and
        // a 404 reads to them as "this server has no OAuth" rather than
        // "wrong address" — so they never find the sign-in at all.
        const bare = await fetch(
            `${s.url}/.well-known/oauth-protected-resource`);

        assert.strictEqual(suffixed.status, 200);
        assert.strictEqual(bare.status, 200, 'the bare well-known path 404s, ' +
            'so a client that only asks there cannot discover the sign-in');
        assert.deepStrictEqual(await bare.json(), await suffixed.json(),
            'the two addresses disagree about what this server is — a client ' +
            'would pin the wrong issuer or the wrong audience');
    } finally {
        await s.close();
    }
});

test('⚠ a stale pass is refused with a 401 that says where to sign in', async () => {
    const s = await serve();
    try {
        const res = await fetch(`${s.url}/mcp`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json, text/event-stream',
                'Authorization': 'Bearer a-pass-from-before-the-redeploy',
            },
            body: JSON.stringify({
                jsonrpc: '2.0', id: 1, method: 'initialize',
                params: {
                    protocolVersion: '2025-06-18', capabilities: {},
                    clientInfo: {name: 'test', version: '1'},
                },
            }),
        });

        assert.strictEqual(res.status, 401, 'a stale pass came back as a ' +
            `${res.status} — anything but 401 tells the assistant this ` +
            'server is broken rather than that it should sign in again');

        const challenge = res.headers.get('www-authenticate') || '';
        assert.match(challenge, /invalid_token/,
            'the refusal does not name invalid_token, so a client cannot ' +
            'tell a stale pass from a server fault');
        assert.match(challenge, /resource_metadata=/,
            'the refusal does not say where the sign-in is advertised');
    } finally {
        await s.close();
    }
});
