const {describe, test, before, beforeEach} = require('node:test');
const assert = require('node:assert');

const H = require('./harness.js');
const Writes = require('../../functions/shepherding-writes.js');
const Read = require('../../functions/shepherding-read.js');
const Docs = require('../../functions/shepherding-doc-writes.js');
const Actor = require('../../functions/mcp-actor.js');

// What the MCP actually does to a Person, against a real Firestore (MS-278).
//
// ⚠ WHAT THIS PROVES THAT THE UNIT TESTS CANNOT. shepherding-core.js is pure
// and covered elsewhere; the markdown conversion has its own suite. What can
// only be shown against a real database is:
//
//   1. ADR-0005's dual write really is atomic through this path — the
//      denormalised field on the Person and the Pastoral Record entry land
//      together, in one batch, from the server as well as from the browser.
//   2. A note an agent writes comes back through the READ tools looking like a
//      note, and through the page's own fields looking like a note the page
//      wrote. One code path, checked from both ends.
//   3. The provenance mark rides on every kind of entry, including the two that
//      ShepherdingCore builds internally and hands back only an id for —
//      exactly where a stamp is easiest to lose.
//   4. `arrayUnion` on a Person's tags does the right thing when the field does
//      not exist yet, which is the state every new Person is in.

const UID = 'uid-elder-1';
const ELDER_PERSON = 'person-jono';
const SUBJECT = 'person-sarah';

const suite = H.skipReason
    ? (name) => test(name, {skip: H.skipReason}, () => {})
    : describe;

suite('what the MCP writes on a Person', () => {
    let db, actor;

    before(() => {
        db = H.connect();

        // ⚠ THE SAME firebase-admin THAT MADE `db`. A sentinel is only
        // understood by the copy that produced it, and `functions/` carries its
        // own node_modules — which is the whole reason these modules take the
        // namespaces rather than requiring admin themselves. Binding the wrong
        // copy here would pass while production failed, which is worse than
        // failing. See functions/mcp-firestore.js.
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
            personId: ELDER_PERSON,
            email: 'jono@example.com',
            permissionLevel: 'elder',
        });
        await db.collection('people_tags').doc('red-flag').set({
            name: 'Red Flag', hidePeople: false, hiddenFromOthers: false,
        });
        actor = await Actor.requireActor(db, UID);
    });

    // ── Notes ────────────────────────────────────────────────────────────

    test('a note lands on the Person, authored and marked', async () => {
        const {noteId} = await Writes.writeNote(db, {
            personId: SUBJECT,
            type: 'Elder Meeting',
            subject: 'Surgery on the 12th',
            markdown: '## Visit\n\nHer mother is **staying** for a fortnight.',
            actor,
        });

        const snap = await db.collection('people').doc(SUBJECT)
            .collection('shepherding_notes').doc(noteId).get();
        const note = snap.data();

        assert.strictEqual(note.type, 'Elder Meeting');
        assert.strictEqual(note.subject, 'Surgery on the 12th');
        assert.strictEqual(note.authorUid, UID);
        assert.strictEqual(note.authorName, 'Jonathan Harris');
        assert.strictEqual(note.writtenVia, 'mcp');

        // The Note Body is TipTap, the shape the editor opens — not markdown
        // stored as a string, which would render as literal hashes.
        assert.strictEqual(note.contentJson.type, 'doc');
        assert.strictEqual(note.contentJson.content[0].type, 'heading');

        // And the plain-text copy the note list previews from is filled in,
        // the same field the page writes.
        assert.match(note.content, /Her mother is staying/);
    });

    test('a note reads back out as the prose that went in', async () => {
        const markdown = '## Visit\n\n- her mother is staying\n- surgery on the 12th';
        const {noteId} = await Writes.writeNote(db, {
            personId: SUBJECT, type: 'Elder Meeting', markdown, actor,
        });

        const back = await Read.getNote(db, {personId: SUBJECT, noteId});
        assert.strictEqual(back.body, markdown);
        assert.strictEqual(back.writtenVia, 'mcp');
    });

    test('appending grows the one note instead of making a second', async () => {
        const {noteId} = await Writes.writeNote(db, {
            personId: SUBJECT, type: 'Elder Meeting', markdown: 'Visited Tuesday.', actor,
        });
        await Writes.appendToNote(db, {
            personId: SUBJECT, noteId, markdown: 'Called again Friday.', actor,
        });

        const listed = await Read.listNotes(db, {personId: SUBJECT});
        assert.strictEqual(listed.count, 1);

        const back = await Read.getNote(db, {personId: SUBJECT, noteId});
        assert.strictEqual(back.body, 'Visited Tuesday.\n\nCalled again Friday.');
    });

    test('an invented Note Type is refused before anything is written', async () => {
        await assert.rejects(() => Writes.writeNote(db, {
            personId: SUBJECT, type: 'Coffee Chat', markdown: 'x', actor,
        }), /not a Note Type/);

        const listed = await Read.listNotes(db, {personId: SUBJECT});
        assert.strictEqual(listed.count, 0, 'nothing may be left behind by a refusal');
    });

    test('a Person id nobody has is refused, and says how to find a real one', async () => {
        await assert.rejects(() => Writes.writeNote(db, {
            personId: 'person-nobody', type: 'Other', markdown: 'x', actor,
        }), /shep_find_person/);
    });

    // ── Status, and ADR-0005 ─────────────────────────────────────────────

    test('a status writes the Person field and the record entry together', async () => {
        const {activityId} = await Writes.setStatus(db, {
            personId: SUBJECT,
            urgency: 'urgent',
            importance: 'important',
            explanation: 'Surgery on the 12th.',
            actor,
        });

        const person = (await db.collection('people').doc(SUBJECT).get()).data();
        assert.deepStrictEqual(person.shepherdingStatus,
            {urgency: 'urgent', importance: 'important'});

        const entry = (await db.collection('people').doc(SUBJECT)
            .collection('shepherding_activity').doc(activityId).get()).data();
        assert.strictEqual(entry.kind, 'status_change');
        assert.strictEqual(entry.previousStatus, null);
        assert.deepStrictEqual(entry.newStatus, {urgency: 'urgent', importance: 'important'});
        assert.strictEqual(entry.explanation, 'Surgery on the 12th.');
        assert.strictEqual(entry.authorName, 'Jonathan Harris');

        // The fourth source. Status Changes already recorded where they came
        // from — profile, people_list, document — so an assistant says so in
        // the field that exists rather than in a second one beside it.
        assert.strictEqual(entry.source, 'mcp');
        assert.strictEqual(entry.writtenVia, 'mcp');
    });

    test('clearing records what it replaced', async () => {
        await Writes.setStatus(db, {
            personId: SUBJECT, urgency: 'urgent', importance: 'important', actor,
        });
        const {activityId} = await Writes.clearStatus(db, {
            personId: SUBJECT, explanation: 'Home and well.', actor,
        });

        const person = (await db.collection('people').doc(SUBJECT).get()).data();
        assert.strictEqual(person.shepherdingStatus, null);

        const entry = (await db.collection('people').doc(SUBJECT)
            .collection('shepherding_activity').doc(activityId).get()).data();
        assert.deepStrictEqual(entry.previousStatus,
            {urgency: 'urgent', importance: 'important'});
        assert.strictEqual(entry.newStatus, null);
    });

    test('clearing a status nobody had writes no entry at all', async () => {
        const result = await Writes.clearStatus(db, {personId: SUBJECT, actor});
        assert.strictEqual(result.activityId, null);

        const record = await Read.getPastoralRecord(db, {personId: SUBJECT});
        assert.strictEqual(record.count, 0);
    });

    test('a made-up urgency is refused', async () => {
        await assert.rejects(() => Writes.setStatus(db, {
            personId: SUBJECT, urgency: 'quite', importance: 'important', actor,
        }), /not an urgency/);
    });

    // ── Tags ─────────────────────────────────────────────────────────────

    test('a tag lands on a Person who has no tags field yet', async () => {
        // Every new Person is in this state, and arrayUnion on an absent field
        // is the case a fake would answer differently from Firestore.
        const result = await Writes.addTags(db, {
            personId: SUBJECT, tagIds: ['red-flag'], explanation: 'Meeting agreed.', actor,
        });
        assert.strictEqual(result.changed.length, 1);

        const person = (await db.collection('people').doc(SUBJECT).get()).data();
        assert.deepStrictEqual(person.tags, ['red-flag']);

        const entry = (await db.collection('people').doc(SUBJECT)
            .collection('shepherding_activity')
            .doc(result.changed[0].activityId).get()).data();
        assert.strictEqual(entry.kind, 'tag_change');
        assert.strictEqual(entry.action, 'added');
        assert.strictEqual(entry.tagName, 'Red Flag');
        assert.strictEqual(entry.writtenVia, 'mcp');
    });

    test('a tag already carried is skipped rather than logged twice', async () => {
        await Writes.addTags(db, {personId: SUBJECT, tagIds: ['red-flag'], actor});
        const again = await Writes.addTags(db, {
            personId: SUBJECT, tagIds: ['red-flag'], actor,
        });

        assert.strictEqual(again.changed.length, 0);
        assert.strictEqual(again.skipped.length, 1);
        assert.match(again.skipped[0].why, /already/);

        const record = await Read.getPastoralRecord(db, {personId: SUBJECT});
        assert.strictEqual(record.count, 1, 'one Tag Change, not two');
    });

    test('a tag nobody defined is skipped, and the real ones still land', async () => {
        const result = await Writes.addTags(db, {
            personId: SUBJECT, tagIds: ['red-flag', 'not-a-tag'], actor,
        });
        assert.strictEqual(result.changed.length, 1);
        assert.strictEqual(result.skipped.length, 1);
    });

    test('a Membership Tag cannot be applied by hand', async () => {
        // Projected Tags follow the Membership Track and the Elder role. Setting
        // one here would put a Person's tags and their Track into disagreement
        // with nothing to reconcile them.
        const result = await Writes.addTags(db, {
            personId: SUBJECT, tagIds: ['Member'], actor,
        });
        assert.strictEqual(result.changed.length, 0);
        assert.match(result.skipped[0].why, /Membership Track|Elder role/);
    });

    // ── The entries ShepherdingCore builds for itself ────────────────────

    test('a Membership Change is marked too, though the core writes it', async () => {
        // commitMembershipChange builds its own record and hands back only an
        // id, so there is nowhere to merge the stamp in on the way through.
        // Without the second touch this is the one entry an agent could write
        // that nobody could tell apart from a person's.
        const {activityId} = await Writes.setMembershipStage(db, {
            personId: SUBJECT, stage: 'member', explanation: 'Received 6 Sept.', actor,
        });

        const entry = (await db.collection('people').doc(SUBJECT)
            .collection('shepherding_activity').doc(activityId).get()).data();
        assert.strictEqual(entry.kind, 'membership_change');
        assert.strictEqual(entry.newStage, 'member');
        assert.strictEqual(entry.writtenVia, 'mcp');
        assert.strictEqual(entry.explanation, 'Received 6 Sept.');

        // And the Membership Tags were re-projected in the same act.
        const person = (await db.collection('people').doc(SUBJECT).get()).data();
        assert.ok((person.tags || []).includes('Member'), JSON.stringify(person.tags));
    });

    test('an Assignment Change is marked as well', async () => {
        await db.collection('people').doc(ELDER_PERSON).update({tags: ['Elder']});

        const {activityId} = await Writes.setElderAssignment(db, {
            personId: SUBJECT, elderPersonId: ELDER_PERSON, actor,
        });

        const entry = (await db.collection('people').doc(SUBJECT)
            .collection('shepherding_activity').doc(activityId).get()).data();
        assert.strictEqual(entry.kind, 'assignment_change');
        assert.strictEqual(entry.newElderName, 'Jonathan Harris');
        assert.strictEqual(entry.writtenVia, 'mcp');
    });

    test('somebody without the Elder Tag cannot be assigned to', async () => {
        await assert.rejects(() => Writes.setElderAssignment(db, {
            personId: SUBJECT, elderPersonId: ELDER_PERSON, actor,
        }), /Elder Tag/);
    });

    // ── Reading it all back ──────────────────────────────────────────────

    test('the Pastoral Record interleaves what an agent wrote', async () => {
        await Writes.writeNote(db, {
            personId: SUBJECT, type: 'Elder Meeting', markdown: 'Visited.', actor,
        });
        await Writes.setStatus(db, {
            personId: SUBJECT, urgency: 'urgent', importance: 'important', actor,
        });
        await Writes.addTags(db, {personId: SUBJECT, tagIds: ['red-flag'], actor});

        const record = await Read.getPastoralRecord(db, {personId: SUBJECT});
        assert.strictEqual(record.count, 3);

        const kinds = record.entries.map((e) => e.kind).sort();
        assert.deepStrictEqual(kinds, ['note', 'status_change', 'tag_change']);
        record.entries.forEach((e) => assert.strictEqual(e.writtenVia, 'mcp'));
    });

    test('the profile reads the status, tags and elder an agent set', async () => {
        await db.collection('people').doc(ELDER_PERSON).update({tags: ['Elder']});
        await Writes.setStatus(db, {
            personId: SUBJECT, urgency: 'somewhat_urgent', importance: 'important', actor,
        });
        await Writes.addTags(db, {personId: SUBJECT, tagIds: ['red-flag'], actor});
        await Writes.setElderAssignment(db, {
            personId: SUBJECT, elderPersonId: ELDER_PERSON, actor,
        });

        const profile = await Read.getProfile(db, {personId: SUBJECT});
        assert.strictEqual(profile.found, true);
        assert.strictEqual(profile.name, 'Sarah Bell');
        assert.deepStrictEqual(profile.shepherdingStatus,
            {urgency: 'somewhat_urgent', importance: 'important'});
        assert.deepStrictEqual(profile.tags, [{tagId: 'red-flag', name: 'Red Flag'}]);
        assert.strictEqual(profile.assignedElder.name, 'Jonathan Harris');
    });

    test('finding a person is honest about there being two of them', async () => {
        await H.seedPerson(db, 'person-sarah-2', {name: 'Sarah Doyle'});

        const found = await Read.findPerson(db, {query: 'Sarah'});
        assert.strictEqual(found.count, 2);
        assert.match(found.note, /do not guess/i);

        const one = await Read.findPerson(db, {query: 'Sarah Bell'});
        assert.strictEqual(one.count, 1);
        assert.strictEqual(one.matches[0].personId, SUBJECT);
    });

    // ── The meeting-minutes path, end to end ─────────────────────────────

    test('a meeting document puts a note on each person named in it', async () => {
        // MS-278's whole reason for existing: one transcript becomes one
        // Meeting Minutes document and a note per Person, with nobody typing
        // anything into the Shepherding System.
        const {documentId} = await Docs.createDocument(db, {
            title: 'Elder meeting, 6 September',
            markdown: '## Present\n\nJonathan, Sam, Ruth.',
            actor,
        });

        const panel = await Docs.addPersonPanel(db, {
            documentId,
            personId: SUBJECT,
            noteType: 'Elder Meeting',
            markdown: 'Surgery on the 12th. Somebody to visit before then.',
            actor,
        });

        // The note is on the PERSON, where an elder opening her profile finds
        // it — not buried in the document.
        const note = await Read.getNote(db, {
            personId: SUBJECT, noteId: panel.noteId,
        });
        assert.strictEqual(note.found, true);
        assert.match(note.body, /Surgery on the 12th/);

        // And it points back at the meeting it came from, which is what draws
        // the "From: [document]" link on the profile.
        assert.strictEqual(note.sourceDocumentId, documentId);

        // The panel is in the document's body, as the atom node the editor
        // draws, carrying the person's name and the note it is linked to.
        const doc = (await db.collection('elder_documents').doc(documentId).get()).data();
        const nodes = doc.contentJson.content;
        const found = nodes.find((n) => n.type === 'personPanel');
        assert.ok(found, 'the document must carry the panel');
        assert.strictEqual(found.attrs.personId, SUBJECT);
        assert.strictEqual(found.attrs.noteId, panel.noteId);
        assert.strictEqual(found.attrs.personName, 'Sarah Bell');

        // The prose written above the panel is still there.
        assert.strictEqual(nodes[0].type, 'heading');
    });

    test('a document is filed where it can be found again', async () => {
        const {folderId} = await Docs.createFolder(db, {name: 'Elder meetings'});
        const {documentId} = await Docs.createDocument(db, {
            title: 'Minutes', markdown: 'x', folderId, actor,
        });

        const listed = await Docs.listDocuments(db, {folderId});
        assert.deepStrictEqual(
            listed.documents.map((d) => d.documentId), [documentId]);
    });

    test('a folder full of documents will not be deleted on a guess', async () => {
        const {folderId} = await Docs.createFolder(db, {name: 'Elder meetings'});
        await Docs.createDocument(db, {title: 'One', folderId, actor});
        await Docs.createDocument(db, {title: 'Two', folderId, actor});

        // The page puts up a dialog with a count and this cannot. So it refuses
        // until the count is said back to it — an agent that has not looked
        // cannot delete two documents by accident.
        await assert.rejects(
            () => Docs.deleteFolder(db, {folderId}), /2 document/);

        const still = await Docs.listDocuments(db, {folderId});
        assert.strictEqual(still.documents.length, 2);

        const gone = await Docs.deleteFolder(db, {folderId, confirmDocumentCount: 2});
        assert.strictEqual(gone.deleted.documents, 2);
    });

    // ── The Author rule ──────────────────────────────────────────────────

    test('an account that cannot be traced writes nothing', async () => {
        await db.collection('users').doc('uid-ghost').set({permissionLevel: 'elder'});
        await assert.rejects(
            () => Actor.requireActor(db, 'uid-ghost'),
            (e) => e.code === Actor.MISSING_AUTHOR);
    });
});
