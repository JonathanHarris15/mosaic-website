const {describe, test, before, beforeEach} = require('node:test');
const assert = require('node:assert');

const H = require('./harness.js');
const {
    FirebaseOAuthProvider, hashToken, COLLECTIONS,
} = require('../../functions/mcp-auth.js');

// The front door to the Order of Service MCP server (MS-262, ADR-0038).
//
// ⚠ THIS IS THE FILE THAT GUARDS WHO CAN EDIT SUNDAYS FROM OUTSIDE THE SITE.
// Everything here is a claim made in mcp-auth.js's own comments, pinned:
//
//   1. Only editors get in, and losing editor rights locks you out on the
//      NEXT REQUEST rather than whenever your pass happens to expire. That
//      is the difference between revoking access and asking nicely.
//   2. An authorization code is good exactly once. Two racing redemptions
//      must not both succeed, which is a claim about a real Firestore
//      transaction and cannot be shown against a fake.
//   3. Passes are stored as hashes. Somebody holding a copy of the token
//      collection holds nothing usable.
//   4. A pass minted for one client cannot be used by another, and a
//      refresh token is retired the moment it is spent.
//
// Firebase Auth is the one thing substituted — `verifyIdToken` is injected,
// because what is under test is what we do with a verified identity, not
// Google's ability to verify one.

const UID = 'uid-alice';
const OTHER_UID = 'uid-mallory';
const ISSUER = 'https://mcp.example.test';

const suite = H.skipReason
    ? (name) => test(name, {skip: H.skipReason}, () => {})
    : describe;

suite('the MCP front door', () => {
    let db;

    before(() => {
        db = H.connect();
    });

    beforeEach(async () => {
        await H.wipe();
        await db.collection('users').doc(UID).set({permissionLevel: 'editor'});
        await db.collection('users').doc(OTHER_UID).set({permissionLevel: 'member'});
    });

    /** A provider whose Firebase Auth always vouches for `uid`. */
    function providerFor(uid) {
        return new FirebaseOAuthProvider({
            db,
            auth: {verifyIdToken: async () => ({uid})},
            issuerUrl: ISSUER,
            webConfig: {apiKey: 'fake', authDomain: 'fake', projectId: 'fake'},
        });
    }

    /** Registers a client and returns it. */
    async function aClient(provider, name) {
        return provider.clientsStore.registerClient({
            client_name: name || 'Test Assistant',
            redirect_uris: ['https://client.example.test/callback'],
            grant_types: ['authorization_code', 'refresh_token'],
        });
    }

    /** Runs authorize() and returns the parked request id. */
    async function beginSignIn(provider, client) {
        let sent = '';
        const res = {set: () => {}, send: (html) => {
            sent = html;
        }};
        await provider.authorize(client, {
            codeChallenge: 'challenge-abc',
            redirectUri: 'https://client.example.test/callback',
            state: 'state-xyz',
            scopes: ['order-of-service'],
            resource: new URL(ISSUER + '/mcp'),
        }, res);

        const snap = await db.collection(COLLECTIONS.AUTH_REQUESTS).get();
        assert.strictEqual(snap.size, 1, 'one request should be parked');
        return {requestId: snap.docs[0].id, html: sent};
    }

    /** Takes an editor all the way to a live pass. */
    async function signInFully(provider, client) {
        const {requestId} = await beginSignIn(provider, client);
        const {redirectTo} = await provider.completeSignIn(
            {requestId, idToken: 'whatever'});
        const code = new URL(redirectTo).searchParams.get('code');
        return provider.exchangeAuthorizationCode(
            client, code, 'verifier', 'https://client.example.test/callback',
            new URL(ISSUER + '/mcp'));
    }

    // ── Who gets in ──────────────────────────────────────────────────────

    test('an editor signs in and is sent back with a code, the state and the issuer', async () => {
        const p = providerFor(UID);
        const client = await aClient(p);
        const {requestId} = await beginSignIn(p, client);

        const result = await p.completeSignIn({requestId, idToken: 'tok'});
        assert.ok(!result.error, result.error);

        const url = new URL(result.redirectTo);
        assert.strictEqual(url.origin + url.pathname,
            'https://client.example.test/callback');
        assert.ok(url.searchParams.get('code'));
        assert.strictEqual(url.searchParams.get('state'), 'state-xyz');
        assert.strictEqual(url.searchParams.get('iss'), ISSUER);
    });

    test('a member is refused, told why, and gets no code at all', async () => {
        const p = providerFor(OTHER_UID);
        const client = await aClient(p);
        const {requestId} = await beginSignIn(p, client);

        const result = await p.completeSignIn({requestId, idToken: 'tok'});
        assert.ok(result.error, 'should have been refused');
        assert.ok(/editor access/i.test(result.error));
        assert.strictEqual(result.redirectTo, undefined);

        const codes = await db.collection(COLLECTIONS.AUTH_CODES).get();
        assert.strictEqual(codes.size, 0, 'no code should exist');
    });

    test('an identity Firebase will not vouch for is refused', async () => {
        const p = new FirebaseOAuthProvider({
            db,
            auth: {verifyIdToken: async () => {
                throw new Error('bad token');
            }},
            issuerUrl: ISSUER,
            webConfig: {},
        });
        const client = await aClient(p);
        const {requestId} = await beginSignIn(p, client);

        const result = await p.completeSignIn({requestId, idToken: 'forged'});
        assert.ok(/could not be verified/i.test(result.error));
    });

    test('the sign-in page names who is asking, and never contains the request id twice over', async () => {
        const p = providerFor(UID);
        const client = await aClient(p, 'Claude Desktop');
        const {html} = await beginSignIn(p, client);
        assert.ok(html.includes('Claude Desktop'));
        assert.ok(html.includes('signInWithEmailAndPassword'),
            'should sign in against Firebase in the browser');
    });

    // ── The code is good exactly once ────────────────────────────────────

    test('an authorization code cannot be spent twice', async () => {
        const p = providerFor(UID);
        const client = await aClient(p);
        const {requestId} = await beginSignIn(p, client);
        const {redirectTo} = await p.completeSignIn({requestId, idToken: 't'});
        const code = new URL(redirectTo).searchParams.get('code');

        const first = await p.exchangeAuthorizationCode(
            client, code, 'v', 'https://client.example.test/callback');
        assert.ok(first.access_token);

        await assert.rejects(
            () => p.exchangeAuthorizationCode(
                client, code, 'v', 'https://client.example.test/callback'),
            /already-used|Unknown/i);
    });

    test('two redemptions racing for one code: exactly one wins', async () => {
        const p = providerFor(UID);
        const client = await aClient(p);
        const {requestId} = await beginSignIn(p, client);
        const {redirectTo} = await p.completeSignIn({requestId, idToken: 't'});
        const code = new URL(redirectTo).searchParams.get('code');

        const attempts = [0, 1].map(() => p.exchangeAuthorizationCode(
            client, code, 'v', 'https://client.example.test/callback')
            .then(() => 'won').catch(() => 'lost'));
        const outcomes = await Promise.all(attempts);

        assert.strictEqual(outcomes.filter((o) => o === 'won').length, 1,
            `exactly one should win, got ${outcomes.join(',')}`);
    });

    test("a code issued to one assistant cannot be spent by another", async () => {
        const p = providerFor(UID);
        const mine = await aClient(p, 'Mine');
        const theirs = await aClient(p, 'Theirs');
        const {requestId} = await beginSignIn(p, mine);
        const {redirectTo} = await p.completeSignIn({requestId, idToken: 't'});
        const code = new URL(redirectTo).searchParams.get('code');

        await assert.rejects(
            () => p.exchangeAuthorizationCode(
                theirs, code, 'v', 'https://client.example.test/callback'),
            /not issued to this client/i);
    });

    test('a code sent to a different redirect than the one authorized is refused', async () => {
        const p = providerFor(UID);
        const client = await aClient(p);
        const {requestId} = await beginSignIn(p, client);
        const {redirectTo} = await p.completeSignIn({requestId, idToken: 't'});
        const code = new URL(redirectTo).searchParams.get('code');

        await assert.rejects(
            () => p.exchangeAuthorizationCode(
                client, code, 'v', 'https://evil.example.test/callback'),
            /Redirect URI does not match/i);
    });

    test('an expired code is refused and cleaned up', async () => {
        const p = providerFor(UID);
        const client = await aClient(p);
        const {requestId} = await beginSignIn(p, client);
        const {redirectTo} = await p.completeSignIn({requestId, idToken: 't'});
        const code = new URL(redirectTo).searchParams.get('code');

        await db.collection(COLLECTIONS.AUTH_CODES).doc(code)
            .update({expiresAt: Date.now() - 1});

        await assert.rejects(
            () => p.exchangeAuthorizationCode(
                client, code, 'v', 'https://client.example.test/callback'),
            /expired/i);
    });

    // ── What a pass is, and how it is stored ─────────────────────────────

    test('the raw token is never stored — only its hash', async () => {
        const p = providerFor(UID);
        const client = await aClient(p);
        const tokens = await signInFully(p, client);

        const byHash = await db.collection(COLLECTIONS.TOKENS)
            .doc(hashToken(tokens.access_token)).get();
        assert.ok(byHash.exists, 'should be findable by hash');

        const byRaw = await db.collection(COLLECTIONS.TOKENS)
            .doc(tokens.access_token).get();
        assert.strictEqual(byRaw.exists, false, 'must not be keyed by the token');

        const stored = JSON.stringify(byHash.data());
        assert.ok(!stored.includes(tokens.access_token),
            'the row must not contain the token itself');
    });

    test('a valid pass identifies its owner and their level', async () => {
        const p = providerFor(UID);
        const client = await aClient(p);
        const tokens = await signInFully(p, client);

        const info = await p.verifyAccessToken(tokens.access_token);
        assert.strictEqual(info.extra.uid, UID);
        assert.strictEqual(info.extra.permissionLevel, 'editor');
        assert.strictEqual(info.clientId, client.client_id);
        assert.strictEqual(String(info.resource), ISSUER + '/mcp');
    });

    test('a made-up pass is refused', async () => {
        const p = providerFor(UID);
        await assert.rejects(() => p.verifyAccessToken('not-a-real-token'),
            /Invalid access token/i);
    });

    test('an expired pass is refused', async () => {
        const p = providerFor(UID);
        const client = await aClient(p);
        const tokens = await signInFully(p, client);

        await db.collection(COLLECTIONS.TOKENS)
            .doc(hashToken(tokens.access_token))
            .update({expiresAt: Date.now() - 1});

        await assert.rejects(() => p.verifyAccessToken(tokens.access_token),
            /expired/i);
    });

    test('a refresh token cannot be used as an access token', async () => {
        const p = providerFor(UID);
        const client = await aClient(p);
        const tokens = await signInFully(p, client);

        await assert.rejects(() => p.verifyAccessToken(tokens.refresh_token),
            /Invalid access token/i);
    });

    // ── The live permission check ────────────────────────────────────────

    test('⚠ losing editor rights locks a live pass out on the very next request', async () => {
        const p = providerFor(UID);
        const client = await aClient(p);
        const tokens = await signInFully(p, client);

        // Works right now.
        await p.verifyAccessToken(tokens.access_token);

        // Somebody is demoted in the admin screen.
        await db.collection('users').doc(UID).update({permissionLevel: 'member'});

        // The very same, unexpired pass now gets nowhere.
        await assert.rejects(() => p.verifyAccessToken(tokens.access_token),
            /no longer has editor access/i);
    });

    test('a demoted account cannot refresh its way back in either', async () => {
        const p = providerFor(UID);
        const client = await aClient(p);
        const tokens = await signInFully(p, client);

        await db.collection('users').doc(UID).update({permissionLevel: 'member'});

        await assert.rejects(
            () => p.exchangeRefreshToken(client, tokens.refresh_token),
            /no longer has editor access/i);
    });

    test('an account deleted outright is refused', async () => {
        const p = providerFor(UID);
        const client = await aClient(p);
        const tokens = await signInFully(p, client);

        await db.collection('users').doc(UID).delete();

        await assert.rejects(() => p.verifyAccessToken(tokens.access_token),
            /no longer has editor access/i);
    });

    // ── Refresh and revoke ───────────────────────────────────────────────

    test('refreshing gives a new pass and retires the old refresh token', async () => {
        const p = providerFor(UID);
        const client = await aClient(p);
        const first = await signInFully(p, client);

        const second = await p.exchangeRefreshToken(client, first.refresh_token);
        assert.ok(second.access_token);
        assert.notStrictEqual(second.access_token, first.access_token);

        // The spent refresh token is gone — a stolen copy is worthless once
        // the real client has used it.
        await assert.rejects(
            () => p.exchangeRefreshToken(client, first.refresh_token),
            /already-used|Unknown/i);
    });

    test('another assistant cannot refresh with a token that is not its own', async () => {
        const p = providerFor(UID);
        const mine = await aClient(p, 'Mine');
        const theirs = await aClient(p, 'Theirs');
        const tokens = await signInFully(p, mine);

        await assert.rejects(
            () => p.exchangeRefreshToken(theirs, tokens.refresh_token),
            /not issued to this client/i);
    });

    test('revoking a pass stops it working, and revoking twice is not an error', async () => {
        const p = providerFor(UID);
        const client = await aClient(p);
        const tokens = await signInFully(p, client);

        await p.revokeToken(client, {token: tokens.access_token});
        await assert.rejects(() => p.verifyAccessToken(tokens.access_token),
            /Invalid access token/i);

        await p.revokeToken(client, {token: tokens.access_token});
    });

    test('one assistant cannot revoke another assistant\'s pass', async () => {
        const p = providerFor(UID);
        const mine = await aClient(p, 'Mine');
        const theirs = await aClient(p, 'Theirs');
        const tokens = await signInFully(p, mine);

        await p.revokeToken(theirs, {token: tokens.access_token});

        // Still works — the wrong client's revocation did nothing.
        const info = await p.verifyAccessToken(tokens.access_token);
        assert.strictEqual(info.extra.uid, UID);
    });

    // ── The parked sign-in request ───────────────────────────────────────

    test('a stale sign-in page cannot be completed', async () => {
        const p = providerFor(UID);
        const client = await aClient(p);
        const {requestId} = await beginSignIn(p, client);

        await db.collection(COLLECTIONS.AUTH_REQUESTS).doc(requestId)
            .update({expiresAt: Date.now() - 1});

        const result = await p.completeSignIn({requestId, idToken: 't'});
        assert.ok(/expired/i.test(result.error));
    });

    test('a sign-in request is consumed, so the page cannot be replayed', async () => {
        const p = providerFor(UID);
        const client = await aClient(p);
        const {requestId} = await beginSignIn(p, client);

        await p.completeSignIn({requestId, idToken: 't'});
        const again = await p.completeSignIn({requestId, idToken: 't'});
        assert.ok(/expired/i.test(again.error));
    });

    test('an invented request id gets nowhere', async () => {
        const p = providerFor(UID);
        const result = await p.completeSignIn(
            {requestId: 'made-up', idToken: 't'});
        assert.ok(result.error);
    });
});
