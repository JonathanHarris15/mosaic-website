// The Resources library, reached by an assistant (MS-693).
//
// ⚠ WHAT THIS PROVES. Three things, and the first is the one with teeth:
//
//   1. THE GATE, AND WHY IT LIVES IN CODE. An MCP write goes through
//      firebase-admin, which never consults firestore.rules — so
//      `editsWith('resources.edit')` guarding `resources` DOES NOT RUN for
//      these calls. The check in mcp-resource-tools.js is the only one there
//      is, and it must answer what the rule answers, saved permission map and
//      all. A member is refused; an editor is allowed; an editor whose saved
//      map says false is refused DESPITE the rung (ADR-0082).
//   2. EVERY OPERATION WORKS THROUGH THE REGISTERED TOOL, not just through the
//      helper underneath it. The tools are exercised the way an assistant
//      reaches them, so a tool wired to the wrong helper or registered without
//      the gate fails here.
//   3. NOTHING IS DECIDED TWICE. The ranks a reorder writes are the ranks
//      ResourcesCore produces, the bytes land at ResourcesCore's path, and a
//      folder move that would swallow its own parent is refused by FilingCore.
//
// The fake db below is a Firestore stand-in that keeps documents in memory,
// and the fake bucket keeps files in a plain object. They answer the handful
// of calls resource-writes.js makes and nothing else.

const {describe, test, beforeEach} = require('node:test');
const assert = require('node:assert');

const Actor = require('../functions/mcp-actor.js');
const Levels = require('../public/account-levels-core.js');

function account(preset, extra) {
    return Object.assign({}, Levels.userWriteFromLevel(Levels.BUILTIN_LEVEL_IDS[preset]), extra || {});
}
const Firestore = require('../functions/mcp-firestore.js');
const resourceTools = require('../functions/mcp-resource-tools.js');
const Core = require('../functions/shared/resources-core.js');

Firestore.bind({
    FieldValue: {serverTimestamp: () => '<when>'},
    Timestamp: {fromDate: (d) => d},
});

function fakeDb(seed = {}) {
    const store = JSON.parse(JSON.stringify(seed));
    let next = 0;
    const col = (name) => (store[name] = store[name] || {});
    const docHandle = (name, id) => ({
        id,
        get: async () => ({exists: !!col(name)[id], id, data: () => col(name)[id]}),
        set: async (data, options) => {
            const now = col(name)[id];
            col(name)[id] = (options && options.merge && now)
                ? Object.assign({}, now, JSON.parse(JSON.stringify(data)))
                : JSON.parse(JSON.stringify(data));
        },
        delete: async () => {
            delete col(name)[id];
        },
    });
    return {
        store,
        collection(name) {
            return {
                get: async () => ({
                    docs: Object.keys(col(name)).map((id) => ({
                        id, data: () => col(name)[id],
                    })),
                }),
                add: async (data) => {
                    const id = `${name}-${++next}`;
                    col(name)[id] = JSON.parse(JSON.stringify(data));
                    return {id};
                },
                doc: (id) => docHandle(name, id || `${name}-${++next}`),
            };
        },
        batch() {
            const queued = [];
            return {
                set: (ref, data, options) => queued.push([ref, data, options]),
                commit: async () => {
                    for (const [ref, data, options] of queued) {
                        await ref.set(data, options);
                    }
                },
            };
        },
    };
}

function fakeBucket() {
    const files = {};
    return {
        files,
        file(path) {
            return {
                save: async (bytes, options) => {
                    files[path] = {bytes, options};
                },
                delete: async () => {
                    if (!files[path]) throw new Error('no such object');
                    delete files[path];
                },
            };
        },
    };
}

// A stand-in for the MCP server, which only has to remember what was
// registered so a test can call it the way a client would.
function fakeServer() {
    const tools = new Map();
    return {
        tools,
        registerTool(name, spec, handler) {
            tools.set(name, {spec, handler});
        },
    };
}

const FIELD_VALUES = {
    FieldValue: {serverTimestamp: () => '<when>'},
    Timestamp: {fromDate: (d) => d},
};

const EDITOR = Object.assign({uid: 'uid-editor'}, account('editor'));
const MEMBER = Object.assign({uid: 'uid-member'}, account('member'));
// Editor preset, with resources.edit forced off. The saved map is the whole
// answer: the builtin id does not put the key back.
const BARRED = Object.assign({uid: 'uid-barred'}, account('editor'), {
    permissions: Object.assign({}, account('editor').permissions, {
        'resources.edit': false,
    }),
});
// A member map plus the one key that fills the shelf.
const GRANTED = Object.assign({uid: 'uid-granted'}, account('member'), {
    permissionLevel: 'member',
    permissions: Object.assign({}, account('member').permissions, {
        'resources.edit': true,
    }),
});

const USERS = {
    'uid-editor': {personId: 'p-editor', email: 'ed@example.com'},
    'uid-member': {personId: 'p-member', email: 'mem@example.com'},
    'uid-barred': {personId: 'p-editor', email: 'ed@example.com'},
    'uid-granted': {personId: 'p-member', email: 'mem@example.com'},
};
const PEOPLE = {
    'p-editor': {name: 'Ada Editor'},
    'p-member': {name: 'Mo Member'},
};

/**
 * A server with the Resources tools on it, bound to one caller, plus the db
 * and bucket they write into.
 */
function wire(auth, seed = {}) {
    const db = fakeDb(Object.assign({users: USERS, people: PEOPLE}, seed));
    const bucket = fakeBucket();
    const server = fakeServer();
    resourceTools.register(server, {db, auth, fieldValues: FIELD_VALUES, bucket});
    const call = async (name, args) => {
        const tool = server.tools.get(name);
        assert.ok(tool, `no tool named ${name}`);
        return await tool.handler(args || {});
    };
    const data = async (name, args) => {
        const result = await call(name, args);
        assert.ok(!result.isError, `${name} refused: ${result.content[0].text}`);
        return JSON.parse(result.content[0].text);
    };
    const refusal = async (name, args) => {
        const result = await call(name, args);
        assert.ok(result.isError, `${name} was allowed and should not have been`);
        return result.content[0].text;
    };
    return {db, bucket, server, call, data, refusal};
}

describe('who may fill the Resources shelf', () => {
    test('an editor and everyone above may, on the rung alone', () => {
        ['editor', 'admin', 'elder', 'super_admin'].forEach((level) => {
            assert.strictEqual(Actor.mayEditResources(level), true, level);
        });
    });

    test('a member, a viewer and nobody at all may not', () => {
        [null, undefined, '', 'viewer', 'member'].forEach((level) => {
            assert.strictEqual(Actor.mayEditResources(level), false, String(level));
        });
    });

    // ADR-0082, restated here because this is the only place it is enforced
    // for an MCP call. A saved map is the whole answer.
    test('a saved map saying false beats the editor rung', () => {
        assert.strictEqual(Actor.mayEditResources(BARRED), false);
    });

    test('a saved map saying true admits a member', () => {
        assert.strictEqual(Actor.mayEditResources(GRANTED), true);
    });

    test('every member may read the shelf, editor or not', () => {
        ['member', 'editor', 'admin', 'elder', 'super_admin'].forEach((level) => {
            assert.strictEqual(Actor.mayReadResources(level), true, level);
        });
        assert.strictEqual(Actor.mayReadResources('viewer'), false);
    });

    test('the refusal names the level held and the permission to ask for', () => {
        const why = Actor.resourcesRefusalFor('member');
        assert.match(why, /"member"/);
        assert.match(why, /Add and organise resources/);
    });
});

describe('the gate on a registered tool', () => {
    test('a member is refused every write, and told why', async () => {
        const {refusal, db} = wire(MEMBER);
        const writes = [
            ['resource_upload', {name: 'a.pdf', base64: 'aGk='}],
            ['resource_add_link', {url: 'https://docs.google.com/d/1'}],
            ['resource_create_folder', {name: 'Studies'}],
            ['resource_rename', {resourceId: 'x', name: 'y'}],
            ['resource_move', {resourceId: 'x'}],
            ['resource_delete', {resourceId: 'x'}],
            ['resource_pin', {resourceId: 'x'}],
            ['resource_unpin', {resourceId: 'x'}],
            ['resource_reorder_pins', {resourceIds: ['x']}],
        ];
        for (const [name, args] of writes) {
            const why = await refusal(name, args);
            assert.match(why, /Resources library/, name);
        }
        // Refused before anything was touched, not after.
        assert.deepStrictEqual(Object.keys(db.store.resources || {}), []);
        assert.deepStrictEqual(Object.keys(db.store.resource_folders || {}), []);
    });

    test('a member may still browse the shelf', async () => {
        const {data} = wire(MEMBER, {
            resources: {r1: {name: 'Membership class', kind: 'link', url: 'https://x.test/'}},
        });
        const listing = await data('resource_list', {});
        assert.deepStrictEqual(listing.resources.map((r) => r.name), ['Membership class']);
    });

    test('an editor is allowed, and the row lands', async () => {
        const {data, db} = wire(EDITOR);
        const row = await data('resource_add_link', {
            url: 'https://docs.google.com/document/d/abc/edit',
            name: 'Elders handbook',
        });
        assert.equal(row.name, 'Elders handbook');
        assert.equal(row.kind, Core.KIND_LINK);
        assert.equal(Object.keys(db.store.resources).length, 1);
    });

    test('an editor whose saved map says false is refused like a member', async () => {
        const {refusal, db} = wire(BARRED);
        const why = await refusal('resource_create_folder', {name: 'Studies'});
        assert.match(why, /"editor"/);
        assert.ok(!db.store.resource_folders);
    });

    test('a member whose saved map says true is allowed', async () => {
        const {data} = wire(GRANTED);
        const folder = await data('resource_create_folder', {name: 'Studies'});
        assert.equal(folder.name, 'Studies');
    });

    test('an account traceable to nobody cannot write in its name', async () => {
        const {refusal} = wire(Object.assign({uid: 'uid-ghost'}, account('editor')));
        const why = await refusal('resource_create_folder', {name: 'Studies'});
        assert.match(why, /cannot be traced/);
    });
});

describe('putting something on the shelf', () => {
    let wired;
    beforeEach(() => {
        wired = wire(EDITOR);
    });

    test('a base64 upload stores the bytes and writes the row', async () => {
        const row = await wired.data('resource_upload', {
            name: 'Romans study.pdf',
            base64: Buffer.from('%PDF-1.7 pretend').toString('base64'),
            contentType: 'application/pdf',
        });
        assert.equal(row.kind, Core.KIND_FILE);

        const stored = wired.db.store.resources[row.id];
        assert.equal(stored.storagePath, Core.storagePathFor(row.id, 'Romans study.pdf'));
        assert.equal(stored.size, 16);
        // The path the bucket actually holds is the path the record names —
        // if those two ever disagree, every download 404s.
        assert.ok(wired.bucket.files[stored.storagePath], 'the bytes are not where the row says');
    });

    test('an upload the shelf will not take is refused and stores nothing', async () => {
        const tooBig = Buffer.alloc(Core.MAX_FILE_BYTES + 1).toString('base64');
        const why = await wired.refusal('resource_upload', {name: 'huge.pdf', base64: tooBig});
        assert.match(why, new RegExp(Core.formatFileSize(Core.MAX_FILE_BYTES)));
        assert.match(why, /larger/i);
        assert.deepStrictEqual(Object.keys(wired.bucket.files), []);
        assert.deepStrictEqual(Object.keys(wired.db.store.resources || {}), []);
    });

    test('an upload with neither url nor bytes says which to give', async () => {
        const why = await wired.refusal('resource_upload', {name: 'a.pdf'});
        assert.match(why, /url/);
        assert.match(why, /base64/);
    });

    test('a link is a link and never a copy', async () => {
        const row = await wired.data('resource_add_link', {
            url: 'https://docs.google.com/document/d/abc/edit',
        });
        const stored = wired.db.store.resources[row.id];
        assert.equal(stored.kind, Core.KIND_LINK);
        assert.equal(stored.url, 'https://docs.google.com/document/d/abc/edit');
        assert.ok(!stored.storagePath, 'a link must not claim a storage path');
        assert.deepStrictEqual(Object.keys(wired.bucket.files), []);
    });

    test('a link that is not a web address is refused', async () => {
        const why = await wired.refusal('resource_add_link', {url: 'javascript:alert(1)'});
        assert.ok(why.length > 10, why);
        assert.deepStrictEqual(Object.keys(wired.db.store.resources || {}), []);
    });

    test('a folder can be made, and made inside another', async () => {
        const top = await wired.data('resource_create_folder', {name: 'Studies'});
        const inner = await wired.data('resource_create_folder', {
            name: 'Romans', parentId: top.id,
        });
        assert.equal(inner.folderId, top.id);
        assert.equal(inner.path, 'Studies');
    });
});

describe('finding things again', () => {
    async function shelf() {
        const wired = wire(EDITOR);
        const studies = await wired.data('resource_create_folder', {name: 'Studies'});
        const romans = await wired.data('resource_add_link', {
            url: 'https://x.test/romans', name: 'Romans overview', folderId: studies.id,
        });
        const policy = await wired.data('resource_add_link', {
            url: 'https://x.test/policy', name: 'Safeguarding policy',
        });
        return {wired, studies, romans, policy};
    }

    test('a listing shows one folder at a time', async () => {
        const {wired, studies, policy} = await shelf();

        const root = await wired.data('resource_list', {});
        assert.deepStrictEqual(root.folders.map((f) => f.name), ['Studies']);
        assert.deepStrictEqual(root.resources.map((r) => r.id), [policy.id]);

        const inside = await wired.data('resource_list', {folderId: studies.id});
        assert.deepStrictEqual(inside.resources.map((r) => r.name), ['Romans overview']);
    });

    test('a search crosses every folder, because the asker knows the name not the folder', async () => {
        const {wired, romans} = await shelf();
        const found = await wired.data('resource_list', {search: 'romans'});
        assert.deepStrictEqual(found.resources.map((r) => r.id), [romans.id]);
        assert.equal(found.searched, 'romans');
    });

    test('a row says which folder it is in, in words', async () => {
        const {wired, romans} = await shelf();
        const found = await wired.data('resource_list', {search: 'romans'});
        assert.equal(found.resources[0].path, 'Studies');
        assert.equal(found.resources[0].folderId, romans.folderId);
    });
});

describe('changing one', () => {
    test('a rename changes the label and not where the bytes are', async () => {
        const wired = wire(EDITOR);
        const row = await wired.data('resource_upload', {
            name: 'draft.pdf', base64: 'aGVsbG8=', contentType: 'application/pdf',
        });
        const before = wired.db.store.resources[row.id].storagePath;

        const renamed = await wired.data('resource_rename', {
            resourceId: row.id, name: 'Final order of service.pdf',
        });
        assert.equal(renamed.name, 'Final order of service.pdf');
        assert.equal(wired.db.store.resources[row.id].storagePath, before);
        assert.ok(wired.bucket.files[before]);
    });

    test('a move files it somewhere else, and back to the top', async () => {
        const wired = wire(EDITOR);
        const folder = await wired.data('resource_create_folder', {name: 'Studies'});
        const link = await wired.data('resource_add_link', {url: 'https://x.test/a'});

        const moved = await wired.data('resource_move', {
            resourceId: link.id, folderId: folder.id,
        });
        assert.equal(moved.folderId, folder.id);

        const back = await wired.data('resource_move', {resourceId: link.id});
        assert.equal(back.folderId, null);
        assert.equal(back.path, 'All resources');
    });

    test('a folder cannot be moved inside something it already holds', async () => {
        const wired = wire(EDITOR);
        const parent = await wired.data('resource_create_folder', {name: 'Studies'});
        const child = await wired.data('resource_create_folder', {
            name: 'Romans', parentId: parent.id,
        });
        const why = await wired.refusal('resource_move', {
            resourceId: parent.id, folderId: child.id,
        });
        assert.ok(why.length > 10, why);
        assert.equal(wired.db.store.resource_folders[parent.id].parentId, null);
    });

    test('a move to a folder that is not there names the id rather than filing it nowhere', async () => {
        const wired = wire(EDITOR);
        const link = await wired.data('resource_add_link', {url: 'https://x.test/a'});
        const why = await wired.refusal('resource_move', {
            resourceId: link.id, folderId: 'folder-that-went',
        });
        assert.match(why, /folder-that-went/);
    });

    test('an id nothing answers to is said plainly', async () => {
        const wired = wire(EDITOR);
        const why = await wired.refusal('resource_rename', {
            resourceId: 'never-existed', name: 'x',
        });
        assert.match(why, /never-existed/);
    });
});

describe('taking something off the shelf', () => {
    test('a file goes, and its bytes go with it', async () => {
        const wired = wire(EDITOR);
        const row = await wired.data('resource_upload', {
            name: 'old.pdf', base64: 'aGk=', contentType: 'application/pdf',
        });
        const path = wired.db.store.resources[row.id].storagePath;

        const result = await wired.data('resource_delete', {resourceId: row.id});
        assert.equal(result.deleted, true);
        assert.ok(!wired.db.store.resources[row.id]);
        assert.ok(!wired.bucket.files[path]);
    });

    // The same shape printable_delete_page takes: a multiple-choice chip in a
    // client is not somebody agreeing to lose twenty files.
    test('a folder with things in it refuses the first time and names the count', async () => {
        const wired = wire(EDITOR);
        const folder = await wired.data('resource_create_folder', {name: 'Studies'});
        await wired.data('resource_add_link', {
            url: 'https://x.test/a', name: 'A', folderId: folder.id,
        });
        await wired.data('resource_add_link', {
            url: 'https://x.test/b', name: 'B', folderId: folder.id,
        });

        const asked = await wired.data('resource_delete', {resourceId: folder.id});
        assert.equal(asked.deleted, false);
        assert.equal(asked.wouldDelete, 2);
        assert.deepStrictEqual(asked.names.slice().sort(), ['A', 'B']);
        assert.equal(Object.keys(wired.db.store.resources).length, 2);

        const wrongCount = await wired.data('resource_delete', {
            resourceId: folder.id, confirm: 1,
        });
        assert.equal(wrongCount.deleted, false);
        assert.equal(Object.keys(wired.db.store.resources).length, 2);

        const done = await wired.data('resource_delete', {
            resourceId: folder.id, confirm: 2,
        });
        assert.equal(done.deleted, true);
        assert.equal(done.resourcesDeleted, 2);
        assert.deepStrictEqual(Object.keys(wired.db.store.resources), []);
        assert.deepStrictEqual(Object.keys(wired.db.store.resource_folders), []);
    });

    test('an empty folder needs no confirmation — there is nothing to lose', async () => {
        const wired = wire(EDITOR);
        const folder = await wired.data('resource_create_folder', {name: 'Empty'});
        const done = await wired.data('resource_delete', {resourceId: folder.id});
        assert.equal(done.deleted, true);
    });
});

describe('the Pinned card', () => {
    async function pinned() {
        const wired = wire(EDITOR);
        const rows = [];
        for (const name of ['A', 'B', 'C']) {
            rows.push(await wired.data('resource_add_link', {
                url: `https://x.test/${name}`, name,
            }));
        }
        return {wired, rows};
    }

    test('pinning puts it at the bottom of the card, in the order pinned', async () => {
        const {wired, rows} = await pinned();
        for (const row of rows) {
            await wired.data('resource_pin', {resourceId: row.id});
        }
        const listing = await wired.data('resource_list', {});
        assert.deepStrictEqual(listing.pinned.map((p) => p.name), ['A', 'B', 'C']);
    });

    test('pinning twice changes nothing', async () => {
        const {wired, rows} = await pinned();
        const first = await wired.data('resource_pin', {resourceId: rows[0].id});
        const again = await wired.data('resource_pin', {resourceId: rows[0].id});
        assert.equal(again.pinRank, first.pinRank);
    });

    test('unpinning clears the rank, and leaves the row where it is filed', async () => {
        const {wired, rows} = await pinned();
        await wired.data('resource_pin', {resourceId: rows[0].id});
        const off = await wired.data('resource_unpin', {resourceId: rows[0].id});
        assert.equal(off.pinned, false);
        assert.equal(wired.db.store.resources[rows[0].id].pinRank, null);

        const listing = await wired.data('resource_list', {});
        assert.deepStrictEqual(listing.pinned, []);
        assert.equal(listing.resources.length, 3);
    });

    test('a reorder puts the card in the order asked for', async () => {
        const {wired, rows} = await pinned();
        for (const row of rows) {
            await wired.data('resource_pin', {resourceId: row.id});
        }
        const wanted = [rows[2].id, rows[0].id, rows[1].id];
        const after = await wired.data('resource_reorder_pins', {resourceIds: wanted});
        assert.deepStrictEqual(after.pinned.map((p) => p.id), wanted);

        // And it stuck, rather than only being reported.
        const listing = await wired.data('resource_list', {});
        assert.deepStrictEqual(listing.pinned.map((p) => p.id), wanted);
    });

    test('a folder can be pinned beside a file', async () => {
        const {wired, rows} = await pinned();
        const folder = await wired.data('resource_create_folder', {name: 'Studies'});
        await wired.data('resource_pin', {resourceId: folder.id});
        await wired.data('resource_pin', {resourceId: rows[0].id});

        const reordered = await wired.data('resource_reorder_pins', {
            resourceIds: [rows[0].id, folder.id],
        });
        assert.deepStrictEqual(reordered.pinned.map((p) => p.kind), ['link', 'folder']);
        assert.equal(wired.db.store.resource_folders[folder.id].pinRank > 0, true);
    });

    test('a partial order is refused rather than half-applied', async () => {
        const {wired, rows} = await pinned();
        for (const row of rows) {
            await wired.data('resource_pin', {resourceId: row.id});
        }
        const before = rows.map((r) => wired.db.store.resources[r.id].pinRank);

        const why = await wired.refusal('resource_reorder_pins', {
            resourceIds: [rows[1].id, rows[0].id],
        });
        assert.match(why, /3/);
        assert.deepStrictEqual(
            rows.map((r) => wired.db.store.resources[r.id].pinRank), before);
    });

    test('an id that is not pinned has no place in the order', async () => {
        const {wired, rows} = await pinned();
        await wired.data('resource_pin', {resourceId: rows[0].id});
        const why = await wired.refusal('resource_reorder_pins', {
            resourceIds: [rows[1].id],
        });
        assert.match(why, new RegExp(rows[1].id));
        assert.match(why, /resource_pin/);
    });
});

describe('the tool surface', () => {
    test('every operation the ticket asked for is registered, and no more', () => {
        const {server} = wire(EDITOR);
        assert.deepStrictEqual([...server.tools.keys()].sort(), [
            'resource_add_link',
            'resource_create_folder',
            'resource_delete',
            'resource_list',
            'resource_move',
            'resource_pin',
            'resource_rename',
            'resource_reorder_pins',
            'resource_unpin',
            'resource_upload',
        ]);
    });

    test('only the listing is marked read-only, so a client knows which ones write', () => {
        const {server} = wire(EDITOR);
        const reads = [...server.tools.entries()]
            .filter(([, t]) => t.spec.annotations && t.spec.annotations.readOnlyHint)
            .map(([name]) => name);
        assert.deepStrictEqual(reads, ['resource_list']);
    });

    test('the upload tool quotes the real cap rather than a number typed twice', () => {
        const {server} = wire(EDITOR);
        const description = server.tools.get('resource_upload').spec.description;
        assert.match(description, new RegExp(Core.formatFileSize(Core.MAX_FILE_BYTES)));
    });

    test('a server built without a bucket still offers every tool, and says so on upload',
        async () => {
            const db = fakeDb({users: USERS, people: PEOPLE});
            const server = fakeServer();
            resourceTools.register(server, {
                db, auth: EDITOR, fieldValues: FIELD_VALUES, bucket: null,
            });
            assert.equal(server.tools.size, 10);

            const result = await server.tools.get('resource_upload').handler({
                name: 'a.pdf', base64: 'aGk=',
            });
            assert.ok(result.isError);
            assert.match(result.content[0].text, /bucket/i);
        });
});
