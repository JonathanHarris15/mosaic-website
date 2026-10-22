// MCP reads the account the same way the rules do (ADR 0084). A permissions
// field that is present and not a map is a saved map of no keys. Leaving it
// off the account would let accountLevelId answer instead.

const {test} = require('node:test');
const assert = require('node:assert');

const {FirebaseOAuthProvider} = require('../functions/mcp-auth.js');
const Levels = require('../public/account-levels-core.js');
const Access = require('../public/access-core.js');

/** @param {Record<string, object>} users */
function provider(users) {
    return new FirebaseOAuthProvider({
        db: {
            collection() {
                return {
                    /** @param {string} id */
                    doc(id) {
                        return {
                            get: async () => {
                                const data = users[id];
                                return {
                                    exists: data !== undefined,
                                    data: () => data,
                                };
                            },
                        };
                    },
                };
            },
        },
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
