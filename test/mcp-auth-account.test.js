// MCP reads the account the same way the rules do (ADR 0084). A permissions
// field that is present and not a map is a saved map of no keys. Leaving it
// off the account would let accountLevelId answer instead.

const {test} = require('node:test');
const assert = require('node:assert');

const {FirebaseOAuthProvider, hashToken} = require('../functions/mcp-auth.js');
const {callerFromExtra} = require('../functions/mcp-app.js');
const Levels = require('../public/account-levels-core.js');
const Access = require('../public/access-core.js');

/** @param {Record<string, Record<string, object>>} collections */
function dbFrom(collections) {
    return {
        /** @param {string} name */
        collection(name) {
            const bag = collections[name] || {};
            return {
                /** @param {string} id */
                doc(id) {
                    return {
                        get: async () => {
                            const data = bag[id];
                            return {
                                exists: data !== undefined,
                                data: () => data,
                            };
                        },
                    };
                },
            };
        },
    };
}

/** @param {Record<string, object>} users */
function provider(users) {
    return new FirebaseOAuthProvider({
        db: dbFrom({users}),
        auth: {},
        issuerUrl: 'https://example.test',
        webConfig: {},
    });
}

test('a permissions field that is not a map does not fall through to the level', async () => {
    const p = provider({
        u: {accountLevelId: 'level_editor', permissions: 'nope'},
    });
    const account = await p.accountOf('u');
    assert.strictEqual(account.permissions, 'nope');
    assert.equal(Access.readsAsEditor(account), false);
    assert.equal(account.permissionLevel, 'viewer');
});

test('a missing permissions field uses the builtin account level', async () => {
    const p = provider({u: {accountLevelId: 'level_editor'}});
    const account = await p.accountOf('u');
    assert.equal(Object.prototype.hasOwnProperty.call(account, 'permissions'), false);
    assert.equal(Access.readsAsEditor(account), true);
    const editor = Levels.userWriteFromLevel('level_editor');
    assert.equal(Access.readsAsEditor(editor), true);
});

test('a falsy permissions field stays on the caller and does not open the level', async () => {
    for (const raw of [null, false, 0, '']) {
        const direct = /** @type {{permissions?: *}} */ (callerFromExtra({
            uid: 'u',
            accountLevelId: 'level_editor',
            permissionLevel: 'editor',
            permissions: raw,
            permissionsPresent: true,
        }));
        assert.equal(Object.prototype.hasOwnProperty.call(direct, 'permissions'), true, String(raw));
        assert.equal(direct.permissions, raw, String(raw));
        assert.equal(Access.readsAsEditor(direct), false, String(raw));
    }

    const dropped = callerFromExtra({
        uid: 'u',
        accountLevelId: 'level_editor',
        permissionLevel: 'editor',
        permissionsPresent: false,
    });
    assert.equal(Object.prototype.hasOwnProperty.call(dropped, 'permissions'), false);
    assert.equal(Access.readsAsEditor(dropped), true);

    const token = 'pass-falsy-map';
    const p = new FirebaseOAuthProvider({
        db: dbFrom({
            mcp_tokens: {
                [hashToken(token)]: {
                    type: 'access',
                    clientId: 'client',
                    uid: 'u',
                    scopes: [],
                    resource: null,
                    expiresAt: Date.now() + 60 * 1000,
                },
            },
            users: {
                u: {accountLevelId: 'level_editor', permissions: null},
            },
        }),
        auth: {},
        issuerUrl: 'https://example.test',
        webConfig: {},
    });
    await assert.rejects(
        () => p.verifyAccessToken(token),
        (err) => {
            if (!(err instanceof Error)) return false;
            assert.match(err.message, /no longer has editor access/);
            return true;
        },
    );
});
