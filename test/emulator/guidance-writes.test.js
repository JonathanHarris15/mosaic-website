const {describe, test, before, beforeEach} = require('node:test');
const assert = require('node:assert');

const admin = require('firebase-admin');
const H = require('./harness.js');
const gw = require('../../functions/guidance-writes.js');
const Core = require('../../functions/shared/mcp-guidance-core.js');

// Writing and rewinding the assistant's own guidance (MS-262).
//
// ⚠ WHY THIS FILE MATTERS MORE THAN ITS SIZE SUGGESTS. Every other write in
// this feature changes ONE Sunday, on a page people look at weekly; a wrong
// one is obvious and gets undone. A guidance edit changes how the assistant
// behaves on every Sunday from then on, and nobody reads the MCP Manager
// page weekly.
//
// The thing that makes letting the assistant write guidance acceptable is
// not that a bad edit cannot happen — it is that it cannot happen QUIETLY or
// PERMANENTLY. So what is pinned here is: every change is filed, who and
// which door is filed with it, and any earlier version can be put back.
//
// The trigger that files versions is a Cloud Function and does not run under
// this suite, so these tests exercise the write and restore logic directly
// and file versions by hand where a version is needed. What the trigger
// itself decides — file a version, or not — is pinned as pure logic in
// test/mcp-guidance-core.test.js via sameContent().

const NOW = () => admin.firestore.Timestamp.now();

const suite = H.skipReason
    ? (name) => test(name, {skip: H.skipReason}, () => {})
    : describe;

suite('writing and rewinding guidance', () => {
    let db;

    before(() => {
        db = H.connect();
    });

    beforeEach(async () => {
        await H.wipe();
    });

    const write = (fields, extra) => gw.updateGuidance(db, Object.assign({
        slug: 'hymn-selection',
        fields,
        uid: 'uid-alice',
        name: 'Alice Smith',
        source: 'assistant',
        serverTimestamp: NOW(),
    }, extra || {}));

    const full = {
        title: 'Choosing hymns',
        summary: 'How we pick hymns.',
        body: 'Prefer something not sung in eight weeks.',
    };

    // ── Creating and editing ─────────────────────────────────────────────

    test('an unknown address creates a file', async () => {
        const r = await write(full);
        assert.strictEqual(r.ok, true);
        assert.strictEqual(r.action, 'created');

        const file = await gw.bySlug(db, 'hymn-selection');
        assert.strictEqual(file.title, 'Choosing hymns');
        assert.strictEqual(file.updatedVia, 'assistant');
    });

    test('a known address edits in place, keeping its address', async () => {
        await write(full);
        const r = await write({body: 'Prefer something not sung in six weeks.'});

        assert.strictEqual(r.action, 'updated');
        const file = await gw.bySlug(db, 'hymn-selection');
        assert.match(file.body, /six weeks/);
        assert.strictEqual(file.slug, 'hymn-selection');
    });

    test('⚠ an edit only has to send what it is changing', async () => {
        // Requiring a full resend invites the assistant to reconstruct the
        // title and summary slightly wrong on every small edit.
        await write(full);
        await write({body: 'New wording.'});

        const file = await gw.bySlug(db, 'hymn-selection');
        assert.strictEqual(file.title, 'Choosing hymns', 'the title was lost');
        assert.strictEqual(file.summary, 'How we pick hymns.', 'the summary was lost');
        assert.strictEqual(file.body, 'New wording.');
    });

    test('a file can be retired without being deleted', async () => {
        await write(full);
        await write({enabled: false});

        const file = await gw.bySlug(db, 'hymn-selection');
        assert.strictEqual(file.enabled, false);
        assert.ok(file.body, 'the writing should still be there');
    });

    // ── Refusals ─────────────────────────────────────────────────────────

    test('a new file with no summary is refused, in words worth showing', async () => {
        const r = await write({title: 'A file', body: 'Some words.'});
        assert.strictEqual(r.ok, false);
        assert.match(r.problems.join(' '), /summary/i);
    });

    test('two files cannot share one address', async () => {
        await write(full);
        const r = await gw.updateGuidance(db, {
            slug: 'hymn-selection',
            fields: full,
            uid: 'uid-bob',
            source: 'assistant',
            serverTimestamp: NOW(),
        });
        // Same slug is an EDIT, not a clash — that is the addressing model.
        assert.strictEqual(r.action, 'updated');

        const all = await db.collection('mcp_guidance').get();
        assert.strictEqual(all.size, 1, 'a second file appeared at one address');
    });

    // ── Who, and through which door ──────────────────────────────────────

    test('⚠ the door a change came through is recorded, not just the person', async () => {
        // "Alice, on the page" and "Alice, via the assistant" are different
        // events even though Alice answers for both.
        await write(full, {source: 'page', name: 'Alice Smith'});
        let file = await gw.bySlug(db, 'hymn-selection');
        assert.strictEqual(file.updatedVia, 'page');
        assert.strictEqual(file.updatedByName, 'Alice Smith');

        await write({body: 'Changed by the assistant.'}, {source: 'assistant'});
        file = await gw.bySlug(db, 'hymn-selection');
        assert.strictEqual(file.updatedVia, 'assistant');
    });

    test('an unrecognised source is recorded as the assistant, not as the page', async () => {
        // Defaulting the unknown case to "page" would let a future caller
        // quietly attribute machine edits to a person.
        await write(full, {source: 'nonsense'});
        const file = await gw.bySlug(db, 'hymn-selection');
        assert.strictEqual(file.updatedVia, 'assistant');
    });

    // ── Rewinding ────────────────────────────────────────────────────────

    /**
     * Files a version by hand, standing in for the trigger.
     *
     * ⚠ The slug is included because the trigger snapshots the whole stored
     * document, which always has one. Leaving it out here produced a version
     * that restored a BLANK address — the file kept its writing and became
     * findable by nobody. A test-only slip, but it is why restoreVersion now
     * refuses to write an address it cannot use.
     */
    async function fileVersion(id, snapshot, via) {
        const ref = await db.collection('mcp_guidance').doc(id)
            .collection('versions').add(Object.assign(
                Core.snapshotOf(Object.assign({slug: 'hymn-selection'}, snapshot)), {
                    savedAt: NOW(),
                    savedByName: 'Alice Smith',
                    savedVia: via || 'page',
                }));
        return ref.id;
    }

    test('an older version can be put back', async () => {
        const created = await write(full);
        const oldVersion = await fileVersion(created.id, full);

        await write({body: 'Something the editor did not want.'});
        let file = await gw.bySlug(db, 'hymn-selection');
        assert.match(file.body, /did not want/);

        const r = await gw.restoreVersion(db, {
            id: created.id,
            versionId: oldVersion,
            uid: 'uid-alice',
            name: 'Alice Smith',
            serverTimestamp: NOW(),
        });
        assert.strictEqual(r.ok, true);

        file = await gw.bySlug(db, 'hymn-selection');
        assert.match(file.body, /eight weeks/, 'the old wording did not come back');
    });

    test('⚠ a restore is recorded as a change, so an undo can be undone', async () => {
        const created = await write(full);
        const oldVersion = await fileVersion(created.id, full);
        await write({body: 'Bad wording.'});

        await gw.restoreVersion(db, {
            id: created.id, versionId: oldVersion,
            uid: 'uid-alice', name: 'Alice Smith', serverTimestamp: NOW(),
        });

        const file = await gw.bySlug(db, 'hymn-selection');
        assert.strictEqual(file.updatedVia, 'restore',
            'a restore that does not show as a change erases its own evidence');
    });

    test('the history is not rolled back by a restore — it keeps growing', async () => {
        const created = await write(full);
        const v1 = await fileVersion(created.id, full);
        await write({body: 'Second wording.'});
        await fileVersion(created.id, {...full, body: 'Second wording.'});

        await gw.restoreVersion(db, {
            id: created.id, versionId: v1,
            uid: 'uid-alice', serverTimestamp: NOW(),
        });

        const versions = await gw.listVersions(db, created.id);
        assert.strictEqual(versions.length, 2,
            'restoring must not delete the version it replaced');
    });

    test('restoring a version that no longer exists is refused plainly', async () => {
        const created = await write(full);
        const r = await gw.restoreVersion(db, {
            id: created.id, versionId: 'never-existed',
            uid: 'uid-alice', serverTimestamp: NOW(),
        });
        assert.strictEqual(r.ok, false);
        assert.strictEqual(r.reason, 'no-such-version');
    });

    test('restoring into a file that has been deleted is refused', async () => {
        const r = await gw.restoreVersion(db, {
            id: 'gone', versionId: 'whatever',
            uid: 'uid-alice', serverTimestamp: NOW(),
        });
        assert.strictEqual(r.ok, false);
        assert.strictEqual(r.reason, 'no-such-file');
    });

    test('the history reads newest first', async () => {
        const created = await write(full);
        await fileVersion(created.id, {...full, body: 'oldest'});
        await new Promise(r => setTimeout(r, 25));
        await fileVersion(created.id, {...full, body: 'newest'});

        const versions = await gw.listVersions(db, created.id);
        assert.strictEqual(versions[0].body, 'newest');
    });

    test('⚠ a restore can never blank the address of a file', async () => {
        // The address is how an assistant asks for a file. A version filed
        // without one — as an older trigger or a hand-written fixture might —
        // must not restore into a document nobody can reach. The writing
        // would survive and the file would look fine on the page.
        const created = await write(full);
        const ref = await db.collection('mcp_guidance').doc(created.id)
            .collection('versions').add({
                title: 'Choosing hymns', slug: '', summary: 'x',
                body: 'From before addresses existed.', enabled: true,
                savedAt: NOW(), savedVia: 'page',
            });

        const r = await gw.restoreVersion(db, {
            id: created.id, versionId: ref.id,
            uid: 'uid-alice', serverTimestamp: NOW(),
        });
        assert.strictEqual(r.ok, true);

        const file = await gw.bySlug(db, 'hymn-selection');
        assert.ok(file, 'the file became unreachable');
        assert.match(file.body, /before addresses existed/,
            'the old writing should still have been restored');
    });
});
