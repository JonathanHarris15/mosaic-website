// Who an assistant is writing AS, and whether it may write at all (MS-278).
//
// ⚠ WHAT THIS PROVES. Three separate rules that all have to hold before a
// single `shep_` tool is allowed to touch a Person:
//
//   1. THE RANK. The MCP's front door admits anyone `editor` and up, because
//      that is right for the Order of Service. It is wrong for the Shepherding
//      System. An editor holding a valid token must still be refused here.
//   2. THE AUTHOR. CONTEXT.md's Author rule: a record whose author cannot be
//      resolved is refused rather than written. An untraceable pastoral record
//      is worse than a create that failed — it exists, it stands in the
//      Pastoral Record, and nothing surfaces the problem.
//   3. THE PROVENANCE. Every record an assistant writes carries a mark saying
//      so, so an Elder reading their own Pastoral Record can tell what an agent
//      wrote from what a person typed.
//
// Pure: the module reads two documents and decides. The fake db below answers
// those two reads and nothing else, which is the whole of its dependency.

const {describe, test} = require('node:test');
const assert = require('node:assert');

const Actor = require('../functions/mcp-actor.js');

// A Firestore stand-in that knows about `users` and `people` and nothing else.
// Anything the module asks for that was not seeded reads back as absent, which
// is exactly the case the Author rule is about.
function fakeDb({users = {}, people = {}} = {}) {
    const store = {users, people};
    return {
        collection(name) {
            return {
                doc(id) {
                    return {
                        get: async () => {
                            const data = (store[name] || {})[id];
                            return {exists: !!data, data: () => data};
                        },
                    };
                },
            };
        },
    };
}

const ELDER_DB = fakeDb({
    users: {'uid-elder': {personId: 'person-jono', email: 'jono@example.com'}},
    people: {'person-jono': {name: 'Jonathan Harris'}},
});

describe('the rank an assistant must hold', () => {
    test('an elder and a super admin may write on a Person', () => {
        assert.strictEqual(Actor.isElder('elder'), true);
        assert.strictEqual(Actor.isElder('super_admin'), true);
    });

    test('an editor may not, even though the MCP let them in the door', () => {
        // The whole point of the second gate. `editor` is a valid MCP caller
        // and keeps every oos_ tool; it has no business on a Shepherding
        // Profile.
        assert.strictEqual(Actor.isElder('editor'), false);
    });

    test('nobody below that gets near it', () => {
        ['viewer', 'member', '', null, undefined, 'admin'].forEach((level) => {
            assert.strictEqual(Actor.isElder(level), false, String(level));
        });
    });

    test('the refusal says why, so an assistant can tell its elder', () => {
        const message = Actor.refusalFor('viewer');
        assert.match(message, /elder/i);
        // Not "permission denied". The elder reading this needs to know it is
        // about their rank, not a mistyped address or a broken server.
        assert.ok(message.length > 30, message);
    });
});

describe('the Author an assistant writes as', () => {
    test('is the Person behind the account, by name', async () => {
        const actor = await Actor.resolveActor(ELDER_DB, 'uid-elder');
        assert.strictEqual(actor.uid, 'uid-elder');
        assert.strictEqual(actor.name, 'Jonathan Harris');
        assert.strictEqual(actor.personId, 'person-jono');
    });

    test('falls back to the account name the pages use, never to "Elder"', async () => {
        // The Shepherding Profile writes `email.split('@')[0]`. An account with
        // no Person attached still has an author worth recording — but the
        // literal string "Elder", which MS-283 found on the Documents tab, is
        // the failure this rules out.
        const db = fakeDb({users: {'uid-x': {email: 'sam@example.com'}}});
        const actor = await Actor.resolveActor(db, 'uid-x');
        assert.strictEqual(actor.name, 'sam');
        assert.strictEqual(actor.personId, null);
        assert.notStrictEqual(actor.name, 'Elder');
    });

    test('a Person with no name does not silently become a blank author', async () => {
        const db = fakeDb({
            users: {'uid-y': {personId: 'person-blank', email: 'ruth@example.com'}},
            people: {'person-blank': {}},
        });
        const actor = await Actor.resolveActor(db, 'uid-y');
        assert.strictEqual(actor.name, 'ruth');
    });

    test('an account nothing can be traced to resolves to nothing', async () => {
        const db = fakeDb({users: {'uid-z': {}}});
        assert.strictEqual(await Actor.resolveActor(db, 'uid-z'), null);
        assert.strictEqual(await Actor.resolveActor(db, ''), null);
        assert.strictEqual(await Actor.resolveActor(fakeDb(), 'nobody'), null);
    });

    test('requireActor refuses rather than returning a half-author', async () => {
        const db = fakeDb({users: {'uid-z': {}}});
        await assert.rejects(
            () => Actor.requireActor(db, 'uid-z'),
            (e) => e.code === Actor.MISSING_AUTHOR);
    });

    test('requireActor hands back the same author resolveActor found', async () => {
        const actor = await Actor.requireActor(ELDER_DB, 'uid-elder');
        assert.strictEqual(actor.name, 'Jonathan Harris');
    });
});

describe('the mark an assistant leaves', () => {
    test('every record written through the MCP says so', () => {
        assert.deepStrictEqual(Actor.provenance(), {writtenVia: 'mcp'});
    });

    test('a Pastoral Record entry carries it as its source', () => {
        // Status Changes and Tag Changes already record where they came from —
        // profile, people_list or document. An assistant is a fourth place, and
        // saying so in the field that already exists beats inventing a second.
        assert.strictEqual(Actor.SOURCE, 'mcp');
    });

    test('the stamp merges into a record without disturbing it', () => {
        const record = Object.assign(
            {kind: 'status_change', authorName: 'Jonathan Harris'},
            Actor.provenance());
        assert.strictEqual(record.kind, 'status_change');
        assert.strictEqual(record.authorName, 'Jonathan Harris');
        assert.strictEqual(record.writtenVia, 'mcp');
    });
});
