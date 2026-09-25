const {test} = require('node:test');
const assert = require('node:assert');

const admin = require('../functions/notification-admin.js');

function mockDb(state) {
    const s = state || {};
    return {
        collectionGroup(name) {
            assert.strictEqual(name, 'push_tokens');
            return {
                orderBy() { return this; },
                limit() { return this; },
                async get() {
                    return {docs: s.tokenDocs || []};
                },
            };
        },
        collection(name) {
            return {
                doc(id) {
                    if (name === 'users') {
                        return {
                            async get() {
                                return s.users && s.users[id] ?
                                    {exists: true, id: id, data: () => s.users[id]} :
                                    {exists: false};
                            },
                            collection(sub) {
                                if (sub !== 'push_tokens') {
                                    throw new Error('unexpected users sub ' + sub);
                                }
                                return {
                                    doc(tid) {
                                        return {
                                            async get() {
                                                const key = id + ':' + tid;
                                                return s.tokens && s.tokens[key] ?
                                                    {exists: true, data: () => s.tokens[key]} :
                                                    {exists: false};
                                            },
                                            async delete() {
                                                s.deleted = s.deleted || [];
                                                s.deleted.push(id + ':' + tid);
                                            },
                                        };
                                    },
                                    async get() {
                                        const docs = [];
                                        Object.keys(s.tokens || {}).forEach((key) => {
                                            if (key.startsWith(id + ':')) {
                                                const tid = key.split(':')[1];
                                                docs.push({
                                                    id: tid,
                                                    data: () => s.tokens[key],
                                                });
                                            }
                                        });
                                        return {docs: docs};
                                    },
                                };
                            },
                        };
                    }
                    return {
                        async get() {
                            if (name === 'people') {
                                return {exists: false};
                            }
                            return {exists: false};
                        },
                        collection(sub) {
                            if (sub === 'push_tokens') {
                                return {
                                    doc(tid) {
                                        return {
                                            async get() {
                                                const key = id + ':' + tid;
                                                return s.tokens && s.tokens[key] ?
                                                    {exists: true, data: () => s.tokens[key]} :
                                                    {exists: false};
                                            },
                                            async delete() {
                                                s.deleted = s.deleted || [];
                                                s.deleted.push(id + ':' + tid);
                                            },
                                        };
                                    },
                                    async get() {
                                        const docs = [];
                                        Object.keys(s.tokens || {}).forEach((key) => {
                                            if (key.startsWith(id + ':')) {
                                                const tid = key.split(':')[1];
                                                docs.push({
                                                    id: tid,
                                                    data: () => s.tokens[key],
                                                });
                                            }
                                        });
                                        return {docs: docs};
                                    },
                                };
                            }
                            throw new Error('unexpected sub ' + sub);
                        },
                    };
                },
                where(field, op, val) {
                    return {
                        async get() {
                            if (name === 'people' && field === 'userId') {
                                const docs = (s.peopleByUid && s.peopleByUid[val]) ?
                                    [{id: s.peopleByUid[val].id, data: () => s.peopleByUid[val]}] :
                                    [];
                                return {docs: docs};
                            }
                            return {docs: []};
                        },
                    };
                },
            };
        },
        doc(path) {
            return {
                async get() {
                    if (path === 'app_config/prayer_request_sms') {
                        return {exists: true, data: () => ({autoSendEnabled: false})};
                    }
                    return {exists: false};
                },
            };
        },
    };
}

test('sendSelfPushTest only reads tokens for the signed-in admin uid', async () => {
    const queried = [];
    const db = {
        collection(name) {
            return {
                doc(uid) {
                    return {
                        collection(sub) {
                            assert.strictEqual(sub, 'push_tokens');
                            queried.push(uid);
                            return {
                                async get() {
                                    return {
                                        docs: uid === 'admin-1' ? [{
                                            id: 'tok1',
                                            data: () => ({token: 'secret-token-value'}),
                                        }] : [],
                                    };
                                },
                            };
                        },
                    };
                },
            };
        },
    };
    const logs = [];
    await admin.sendSelfPushTest({
        db: db,
        assertAdmin: async () => {},
        sendPush: async () => ({accepted: true}),
        writeLog: async (row) => { logs.push(row); },
        deleteToken: async () => {},
    }, {uid: 'admin-1'});

    assert.deepStrictEqual(queried, ['admin-1']);
    assert.strictEqual(logs.length, 1);
    assert.strictEqual(logs[0].purpose, admin.ADMIN_PUSH_TEST_PURPOSE);
    assert.ok(!JSON.stringify(logs).includes('secret-token-value'));
});

test('sendSelfPushTest ignores a client-supplied uid in data (handler takes auth only)', async () => {
    let readUid = null;
    const db = {
        collection() {
            return {
                doc(uid) {
                    readUid = uid;
                    return {
                        collection() {
                            return {
                                async get() {
                                    return {docs: []};
                                },
                            };
                        },
                    };
                },
            };
        },
    };
    await assert.rejects(
        () => admin.sendSelfPushTest({
            db: db,
            assertAdmin: async () => {},
            sendPush: async () => ({accepted: true}),
            writeLog: async () => {},
            deleteToken: async () => {},
        }, {uid: 'admin-1'}),
        (err) => err.message.includes('No device tokens'),
    );
    assert.strictEqual(readUid, 'admin-1');
});

test('revokePushToken requires admin guard', async () => {
    await assert.rejects(
        () => admin.revokePushToken({
            db: mockDb({}),
            assertAdmin: async () => {
                throw new Error('permission-denied');
            },
        }, {uid: 'u1'}, {uid: 'u1', tokenId: 't1'}),
        /permission-denied/,
    );
});

test('revokePushToken deletes the token document', async () => {
    const state = {
        tokens: {'user-a:device-1': {token: 'x'.repeat(20)}},
        deleted: [],
    };
    const db = mockDb(state);
    const result = await admin.revokePushToken({
        db: db,
        assertAdmin: async () => {},
    }, {uid: 'admin'}, {uid: 'user-a', tokenId: 'device-1'});
    assert.strictEqual(result.revoked, true);
    assert.deepStrictEqual(state.deleted, ['user-a:device-1']);
});

test('listPushDevices returns masked tokens only', async () => {
    const tokenDocs = [{
        id: 'd1',
        data: () => ({token: '0123456789abcdef', platform: 'ios', updatedAt: new Date()}),
        ref: {
            parent: {parent: {id: 'uid-1'}},
        },
    }];
    const db = mockDb({
        tokenDocs: tokenDocs,
        users: {'uid-1': {email: 'a@example.com'}},
        peopleByUid: {'uid-1': {id: 'p1', name: {full: 'Ada Lovelace'}, userId: 'uid-1'}},
    });
    const {devices} = await admin.listPushDevices({
        db: db,
        assertAdmin: async () => {},
        now: () => new Date(),
    }, {uid: 'admin'});
    assert.strictEqual(devices.length, 1);
    assert.ok(devices[0].maskedToken.includes('cdef'));
    assert.ok(!devices[0].maskedToken.includes('0123456789abcdef'));
});
