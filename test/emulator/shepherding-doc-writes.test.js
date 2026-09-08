const {describe, test, before, beforeEach} = require('node:test');
const assert = require('node:assert');

const H = require('./harness.js');
const Docs = require('../../functions/shepherding-doc-writes.js');
const DocsCore = require('../../functions/shared/shepherding-documents-core.js');
const Actor = require('../../functions/mcp-actor.js');

// The Document Library tools, against a real Firestore (MS-278).
//
// ⚠ THE THING THAT CANNOT BE FAKED HERE IS THAT A DOCUMENT LIVES IN TWO PLACES.
// The record is a row in `elder_documents`; WHERE IT SITS is a node in the
// single `elder_document_structure/root` tree. Every operation below touches one
// or both, and the failures worth catching are the ones where they disagree:
//
//   1. A create that writes the record and forgets the tree makes a document
//      that exists and cannot be found.
//   2. A move must touch the tree and NOT the record.
//   3. A delete must unhook the node as well as remove the row, or the Library
//      lists a document that is not there.
//   4. The tree is rewritten whole, inside a transaction, so two changes in
//      quick succession must not lose one of them — which is a claim about
//      Firestore, not about our code.

const UID = 'uid-elder-1';
const ELDER_PERSON = 'person-jono';
const SUBJECT = 'person-sarah';

const suite = H.skipReason
    ? (name) => test(name, {skip: H.skipReason}, () => {})
    : describe;

suite('the Document Library tools', () => {
    let db, actor;

    before(() => {
        db = H.connect();
        const admin = require('firebase-admin');
        require('../../functions/mcp-firestore.js').bind({
            FieldValue: admin.firestore.FieldValue,
            Timestamp: admin.firestore.Timestamp,
        });
    });

    beforeEach(async () => {
        await H.wipe();
        await H.seedPerson(db, ELDER_PERSON, {name: 'Jonathan Harris'});
        await H.seedPerson(db, SUBJECT, {name: 'Sarah Bell'});
        await db.collection('users').doc(UID).set({
            personId: ELDER_PERSON, email: 'jono@example.com', permissionLevel: 'elder',
        });
        actor = await Actor.requireActor(db, UID);
    });

    /** The folder tree as it currently stands. */
    async function tree() {
        const snap = await db.collection('elder_document_structure').doc('root').get();
        return snap.exists ? snap.data() : {children: []};
    }

    // ── Reading ──────────────────────────────────────────────────────────

    test('a document reads back with its body as prose', async () => {
        const {documentId} = await Docs.createDocument(db, {
            title: 'Elder meeting, 6 September',
            markdown: '## Present\n\n- Jonathan\n- Sam',
            actor,
        });

        const back = await Docs.getDocument(db, {documentId});
        assert.strictEqual(back.title, 'Elder meeting, 6 September');
        assert.strictEqual(back.body, '## Present\n\n- Jonathan\n- Sam');
        assert.strictEqual(back.author, 'Jonathan Harris');
        assert.strictEqual(back.writtenVia, 'mcp');
        assert.strictEqual(back.docType, 'note');
    });

    test('an id nobody has says how to find a real one', async () => {
        await assert.rejects(
            () => Docs.getDocument(db, {documentId: 'nope'}), /shep_list_documents/);
    });

    test('the top level lists what is in it, folders and documents apart', async () => {
        const {folderId} = await Docs.createFolder(db, {name: 'Elder meetings'});
        const {documentId} = await Docs.createDocument(db, {title: 'Loose note', actor});

        const listed = await Docs.listDocuments(db, {});
        assert.deepStrictEqual(listed.folders.map((f) => f.name), ['Elder meetings']);
        assert.deepStrictEqual(listed.documents.map((d) => d.documentId), [documentId]);
        assert.strictEqual(listed.folders[0].folderId, folderId);
    });

    test('recursive reaches documents at any depth', async () => {
        const outer = await Docs.createFolder(db, {name: '2026'});
        const inner = await Docs.createFolder(db, {
            name: 'September', parentFolderId: outer.folderId,
        });
        await Docs.createDocument(db, {
            title: 'Deep one', folderId: inner.folderId, actor,
        });

        const shallow = await Docs.listDocuments(db, {folderId: outer.folderId});
        assert.strictEqual(shallow.documents.length, 0);

        const deep = await Docs.listDocuments(db, {
            folderId: outer.folderId, recursive: true,
        });
        assert.deepStrictEqual(deep.documents.map((d) => d.title), ['Deep one']);
    });

    test('a tree node pointing at nothing is reported, not silently dropped', async () => {
        // The record and the tree live in different places, so they can come
        // apart. A listing that quietly shortened itself would hide that.
        const {documentId} = await Docs.createDocument(db, {title: 'Doomed', actor});
        await db.collection('elder_documents').doc(documentId).delete();

        const listed = await Docs.listDocuments(db, {});
        assert.deepStrictEqual(listed.danglingIds, [documentId]);
        assert.strictEqual(listed.documents.length, 0);
    });

    // ── Writing ──────────────────────────────────────────────────────────

    test('an update replaces the body, and says who touched it last', async () => {
        const {documentId} = await Docs.createDocument(db, {
            title: 'Minutes', markdown: 'First draft.', actor,
        });

        await Docs.updateDocument(db, {
            documentId, markdown: '## Second draft', actor,
        });

        const back = await Docs.getDocument(db, {documentId});
        assert.strictEqual(back.body, '## Second draft');
        assert.strictEqual(back.title, 'Minutes', 'the title is left alone');

        const stored = (await db.collection('elder_documents').doc(documentId).get()).data();
        assert.strictEqual(stored.updatedByName, 'Jonathan Harris');
    });

    test('appending leaves what is already there and adds after it', async () => {
        const {documentId} = await Docs.createDocument(db, {
            title: 'Minutes', markdown: 'Present: Jonathan, Sam.', actor,
        });

        await Docs.appendToDocument(db, {
            documentId, markdown: 'Agreed to review in October.', actor,
        });

        const back = await Docs.getDocument(db, {documentId});
        assert.strictEqual(back.body,
            'Present: Jonathan, Sam.\n\nAgreed to review in October.');
    });

    test('appending nothing is refused rather than written as a blank line', async () => {
        const {documentId} = await Docs.createDocument(db, {title: 'Minutes', actor});
        await assert.rejects(
            () => Docs.appendToDocument(db, {documentId, markdown: '   ', actor}),
            /nothing to add/i);
    });

    test('a rename changes the title and nothing else', async () => {
        const {folderId} = await Docs.createFolder(db, {name: 'Elder meetings'});
        const {documentId} = await Docs.createDocument(db, {
            title: 'Untitled', markdown: 'Body.', folderId, actor,
        });

        await Docs.renameDocument(db, {documentId, title: 'September minutes', actor});

        const back = await Docs.getDocument(db, {documentId});
        assert.strictEqual(back.title, 'September minutes');
        assert.strictEqual(back.body, 'Body.');

        const listed = await Docs.listDocuments(db, {folderId});
        assert.strictEqual(listed.documents.length, 1, 'it stayed in its folder');
    });

    // ── Moving: the tree changes, the record does not ────────────────────

    test('a move touches the tree and leaves the record alone', async () => {
        const {folderId} = await Docs.createFolder(db, {name: 'Elder meetings'});
        const {documentId} = await Docs.createDocument(db, {
            title: 'Minutes', markdown: 'Body.', actor,
        });

        const beforeRecord = (await db.collection('elder_documents')
            .doc(documentId).get()).data();

        await Docs.moveDocument(db, {documentId, folderId});

        const afterRecord = (await db.collection('elder_documents')
            .doc(documentId).get()).data();
        assert.deepStrictEqual(afterRecord, beforeRecord, 'the record must not change');

        const inFolder = await Docs.listDocuments(db, {folderId});
        assert.deepStrictEqual(inFolder.documents.map((d) => d.documentId), [documentId]);

        const atTop = await Docs.listDocuments(db, {});
        assert.strictEqual(atTop.documents.length, 0, 'and it left the top level');
    });

    test('a move into a folder that is not there is refused', async () => {
        const {documentId} = await Docs.createDocument(db, {title: 'Minutes', actor});
        await assert.rejects(
            () => Docs.moveDocument(db, {documentId, folderId: 'nope'}), /No Folder/);
    });

    test('a folder can be renamed without disturbing what is in it', async () => {
        const {folderId} = await Docs.createFolder(db, {name: 'Meetings'});
        const {documentId} = await Docs.createDocument(db, {
            title: 'Minutes', folderId, actor,
        });

        await Docs.renameFolder(db, {folderId, name: 'Elder meetings'});

        const listed = await Docs.listDocuments(db, {folderId});
        assert.strictEqual(listed.folderName, 'Elder meetings');
        assert.deepStrictEqual(listed.documents.map((d) => d.documentId), [documentId]);
    });

    test('a folder moves with its whole subtree', async () => {
        const archive = await Docs.createFolder(db, {name: 'Archive'});
        const meetings = await Docs.createFolder(db, {name: 'Meetings'});
        const {documentId} = await Docs.createDocument(db, {
            title: 'Minutes', folderId: meetings.folderId, actor,
        });

        await Docs.moveFolder(db, {
            folderId: meetings.folderId, targetFolderId: archive.folderId,
        });

        const inArchive = await Docs.listDocuments(db, {folderId: archive.folderId});
        assert.deepStrictEqual(inArchive.folders.map((f) => f.name), ['Meetings']);

        const stillThere = await Docs.listDocuments(db, {folderId: meetings.folderId});
        assert.deepStrictEqual(
            stillThere.documents.map((d) => d.documentId), [documentId]);
    });

    test('a folder cannot be moved inside itself', async () => {
        // The tree would stop being a tree and everything under it would drop
        // out of the Library at once.
        const outer = await Docs.createFolder(db, {name: '2026'});
        const inner = await Docs.createFolder(db, {
            name: 'September', parentFolderId: outer.folderId,
        });

        await assert.rejects(() => Docs.moveFolder(db, {
            folderId: outer.folderId, targetFolderId: inner.folderId,
        }), /own sub-folders/);

        // And into itself, which is the same mistake one step shorter.
        await assert.rejects(() => Docs.moveFolder(db, {
            folderId: outer.folderId, targetFolderId: outer.folderId,
        }), /into itself/);

        const root = await tree();
        assert.strictEqual(root.children.length, 1, 'the tree is unchanged');

        // The real damage this prevents: moveNode lifts the subtree out before
        // it looks for the target, so an unguarded move takes the target with
        // it and the whole branch drops out of the Library.
        const still = await Docs.listDocuments(db, {folderId: outer.folderId});
        assert.deepStrictEqual(still.folders.map((f) => f.name), ['September']);
    });

    // ── Deleting ─────────────────────────────────────────────────────────

    test('deleting removes the record AND unhooks the node', async () => {
        const {documentId} = await Docs.createDocument(db, {title: 'Doomed', actor});

        const gone = await Docs.deleteDocument(db, {documentId});
        assert.strictEqual(gone.deleted.title, 'Doomed');

        assert.strictEqual(
            (await db.collection('elder_documents').doc(documentId).get()).exists, false);

        const listed = await Docs.listDocuments(db, {});
        assert.strictEqual(listed.documents.length, 0);
        assert.deepStrictEqual(listed.danglingIds, [], 'no orphaned node may be left');
    });

    test('deleting a document leaves its Person Panel notes on their people', async () => {
        // Those are the pastoral record; this was only the meeting.
        const {documentId} = await Docs.createDocument(db, {title: 'Minutes', actor});
        const panel = await Docs.addPersonPanel(db, {
            documentId, personId: SUBJECT, markdown: 'Discussed.', actor,
        });

        await Docs.deleteDocument(db, {documentId});

        const note = await db.collection('people').doc(SUBJECT)
            .collection('shepherding_notes').doc(panel.noteId).get();
        assert.strictEqual(note.exists, true, 'the note must survive the meeting');
    });

    // ── The payload types are not prose ──────────────────────────────────

    test('a Care List refuses to be written into as though it were prose', async () => {
        const Payload = require('../../functions/shepherding-payload-writes.js');
        const made = await Payload.createCareList(db, {title: 'Visits', actor});

        await assert.rejects(() => Docs.updateDocument(db, {
            documentId: made.documentId, markdown: 'x', actor,
        }), /Care List/);

        await assert.rejects(() => Docs.addPersonPanel(db, {
            documentId: made.documentId, personId: SUBJECT, actor,
        }), /Care List/);
    });

    test('but the Library still lists, renames, moves and deletes one', async () => {
        // ADR-0055: a document carrying a payload is not a new KIND of record,
        // so the Library handles it with no special case.
        const Payload = require('../../functions/shepherding-payload-writes.js');
        const {folderId} = await Docs.createFolder(db, {name: 'Lists'});
        const made = await Payload.createCareList(db, {title: 'Visits', actor});

        await Docs.renameDocument(db, {
            documentId: made.documentId, title: 'Autumn visits', actor,
        });
        await Docs.moveDocument(db, {documentId: made.documentId, folderId});

        const listed = await Docs.listDocuments(db, {folderId});
        assert.strictEqual(listed.documents[0].title, 'Autumn visits');
        assert.strictEqual(listed.documents[0].docType, 'care-list');

        await Docs.deleteDocument(db, {documentId: made.documentId});
        assert.strictEqual((await Docs.listDocuments(db, {folderId})).documents.length, 0);
    });

    // ── The tree is rewritten whole ──────────────────────────────────────

    test('two documents made at once both end up in the tree', async () => {
        // The structure document is rewritten whole, so a lost update here
        // means a document that exists and cannot be found. The writes go
        // through a transaction for exactly this reason — and an agent working
        // in a loop makes the race likelier than a handful of elders clicking.
        const made = await Promise.all([
            Docs.createDocument(db, {title: 'One', actor}),
            Docs.createDocument(db, {title: 'Two', actor}),
            Docs.createDocument(db, {title: 'Three', actor}),
        ]);

        const listed = await Docs.listDocuments(db, {});
        const ids = listed.documents.map((d) => d.documentId).sort();
        assert.deepStrictEqual(ids, made.map((m) => m.documentId).sort());
    });

    test('a document filed into a folder that vanished still lands somewhere', async () => {
        // Better at the top level than nowhere: the record is already written
        // by the time the tree is touched.
        const made = await Docs.createDocument(db, {
            title: 'Homeless', folderId: 'not-a-folder', actor,
        });
        assert.strictEqual(made.folderId, DocsCore.ROOT);
        assert.match(made.note, /top level/);

        const listed = await Docs.listDocuments(db, {});
        assert.deepStrictEqual(
            listed.documents.map((d) => d.documentId), [made.documentId]);
    });
});
