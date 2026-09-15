const {describe, test, before, beforeEach} = require('node:test');
const assert = require('node:assert');

const H = require('./harness.js');
const Payload = require('../../functions/shepherding-payload-writes.js');
const Writes = require('../../functions/shepherding-writes.js');
const FormsCore = require('../../functions/shared/forms-core.js');
const Actor = require('../../functions/mcp-actor.js');
const NoteMarkdown = require('../../functions/shared/note-markdown-core.js');

// Form Documents, Care Lists and Filtered Views, against a
// real Firestore (MS-278).
//
// ⚠ WHAT ONLY A REAL DATABASE SHOWS HERE.
//
//   1. A Form Document takes a COPY of its template's questions (ADR-0055).
//      Proving that means editing the template afterwards and watching the
//      document not move — two records, checked apart.
//   2. An answer goes through the same validator the public fill-in page uses,
//      so a date that is not a date is refused by the code a stranger's browser
//      would hit, not by a second opinion written here.
//   3. A Care List works out who is on it from its filter EVERY TIME it opens,
//      which means the answer changes as people's tags change.
//   4. A Filtered View is shared. Deleting one has to say which Care Lists were
//      reading it, and that is a query across another collection.

const UID = 'uid-elder-1';
const ELDER_PERSON = 'person-jono';
const A = 'person-sarah';
const B = 'person-tom';

const suite = H.skipReason
    ? (name) => test(name, {skip: H.skipReason}, () => {})
    : describe;

suite('the payload-carrying shepherding tools', () => {
    let db, actor;

    before(() => {
        db = H.connect();
        const admin = require('firebase-admin');
        require('../../functions/mcp-firestore.js').bind({
            FieldValue: admin.firestore.FieldValue,
            Timestamp: admin.firestore.Timestamp,
            FieldPath: admin.firestore.FieldPath,
        });
    });

    beforeEach(async () => {
        await H.wipe();
        await H.seedPerson(db, ELDER_PERSON, {name: 'Jonathan Harris'});
        await H.seedPerson(db, A, {name: 'Sarah Bell'});
        await H.seedPerson(db, B, {name: 'Tom Reed'});
        await db.collection('users').doc(UID).set({
            personId: ELDER_PERSON, email: 'jono@example.com', permissionLevel: 'elder',
        });
        await db.collection('people_tags').doc('red-flag').set({
            name: 'Red Flag', hidePeople: false, hiddenFromOthers: false,
        });
        actor = await Actor.requireActor(db, UID);
    });

    /** An interview form, of the kind a Form Document is started from. */
    async function seedTemplate(id, extra) {
        await db.collection('forms').doc(id).set(Object.assign({
            title: 'Elder Interview',
            mode: 'document',
            questions: [
                {id: 'q_head', type: 'section', text: 'Background'},
                {id: 'q_story', type: 'paragraph', text: 'How did they come to faith?'},
                {id: 'q_when', type: 'date', text: 'Date of baptism'},
                {
                    id: 'q_ready', type: 'choice_one', text: 'Ready for membership?',
                    options: ['Yes', 'Not yet'],
                },
                {id: 'q_file', type: 'file', text: 'Anything to attach'},
            ],
        }, extra || {}));
    }

    // ── Form Documents ───────────────────────────────────────────────────

    test('only forms meant to be filled in once are offered', async () => {
        await seedTemplate('interview');
        await db.collection('forms').doc('signup').set({
            title: 'Camp signup', mode: 'responses', questions: [],
        });

        const listed = await Payload.listFormTemplates(db);
        assert.deepStrictEqual(listed.templates.map((t) => t.templateId), ['interview']);
    });

    test('the listing says which questions an assistant cannot answer', async () => {
        await seedTemplate('interview');
        const listed = await Payload.listFormTemplates(db);
        const byId = {};
        listed.templates[0].questions.forEach((q) => {
            byId[q.questionId] = q;
        });

        assert.strictEqual(byId['q_story'].answerable, true);
        // A section asks nothing; an upload wants bytes an assistant has none of.
        assert.strictEqual(byId['q_head'].answerable, false);
        assert.strictEqual(byId['q_file'].answerable, false);
    });

    test('a form document copies the questions rather than pointing at them', async () => {
        // ADR-0055. A record has to keep the question it was actually asked.
        await seedTemplate('interview');
        const made = await Payload.createFormDocument(db, {
            templateId: 'interview', personId: A, actor,
        });

        await db.collection('forms').doc('interview').update({
            questions: [{id: 'q_new', type: 'short_text', text: 'Something else'}],
        });

        const doc = await Payload.getFormDocument(db, {documentId: made.documentId});
        assert.ok(doc.questions.some((q) => q.questionId === 'q_story'),
            'the document keeps the question it was asked');
        assert.ok(!doc.questions.some((q) => q.questionId === 'q_new'),
            'and never picks up a later edit');
    });

    test('a personal shepherding form starts already answered with its subject', async () => {
        await seedTemplate('interview', {shepherdingDoc: true});
        const made = await Payload.createFormDocument(db, {
            templateId: 'interview', personId: A, actor,
        });

        const stored = (await db.collection('elder_documents')
            .doc(made.documentId).get()).data();
        assert.strictEqual(stored.answers[FormsCore.SUBJECT_QUESTION_ID].personId, A);
        assert.strictEqual(stored.ownerPersonId, A);
        assert.strictEqual(stored.inLibrary, true);
    });

    test('a personal shepherding form about nobody is refused', async () => {
        await seedTemplate('interview', {shepherdingDoc: true});
        await assert.rejects(() => Payload.createFormDocument(db, {
            templateId: 'interview', actor,
        }), /has to be about somebody/);
    });

    test('a survey cannot be started as a document', async () => {
        await db.collection('forms').doc('signup').set({
            title: 'Camp signup', mode: 'responses', questions: [],
        });
        await assert.rejects(() => Payload.createFormDocument(db, {
            templateId: 'signup', actor,
        }), /people answer/);
    });

    test('answers land, and are readable back', async () => {
        await seedTemplate('interview');
        const made = await Payload.createFormDocument(db, {
            templateId: 'interview', personId: A, actor,
        });

        const result = await Payload.answerFormDocument(db, {
            documentId: made.documentId,
            answers: {
                q_story: 'Grew up in the church, came back at university.',
                q_when: '2019-04-21',
                q_ready: 'Yes',
            },
            actor,
        });
        assert.deepStrictEqual(result.answered.sort(),
            ['q_ready', 'q_story', 'q_when']);

        const doc = await Payload.getFormDocument(db, {documentId: made.documentId});
        const byId = {};
        doc.questions.forEach((q) => {
            byId[q.questionId] = q;
        });
        assert.strictEqual(byId['q_when'].answer, '2019-04-21');
        assert.strictEqual(byId['q_ready'].answer, 'Yes');
    });

    test('a bad answer is refused by the same check the fill-in page runs', async () => {
        await seedTemplate('interview');
        const made = await Payload.createFormDocument(db, {
            templateId: 'interview', personId: A, actor,
        });

        const result = await Payload.answerFormDocument(db, {
            documentId: made.documentId,
            answers: {
                q_when: 'last April',
                q_ready: 'Maybe',
                q_story: 'This one is fine.',
            },
            actor,
        });

        assert.deepStrictEqual(result.answered, ['q_story'], 'the good one still lands');
        const skipped = result.skipped.map((s) => s.questionId).sort();
        assert.deepStrictEqual(skipped, ['q_ready', 'q_when']);
    });

    test('an upload is skipped and SAID to be skipped', async () => {
        // Silently blank would look like an answered form with a gap in it.
        await seedTemplate('interview');
        const made = await Payload.createFormDocument(db, {
            templateId: 'interview', personId: A, actor,
        });

        const result = await Payload.answerFormDocument(db, {
            documentId: made.documentId,
            answers: {q_file: 'a photo', q_head: 'not a question'},
            actor,
        });

        assert.strictEqual(result.answered.length, 0);
        const why = {};
        result.skipped.forEach((s) => {
            why[s.questionId] = s.why;
        });
        assert.match(why['q_file'], /upload/);
        assert.match(why['q_head'], /section heading/);
    });

    test('answering twice changes the answer rather than adding a second', async () => {
        await seedTemplate('interview');
        const made = await Payload.createFormDocument(db, {
            templateId: 'interview', personId: A, actor,
        });

        await Payload.answerFormDocument(db, {
            documentId: made.documentId, answers: {q_ready: 'Not yet'}, actor,
        });
        await Payload.answerFormDocument(db, {
            documentId: made.documentId, answers: {q_ready: 'Yes'}, actor,
        });

        const stored = (await db.collection('elder_documents')
            .doc(made.documentId).get()).data();
        assert.strictEqual(stored.answers.q_ready, 'Yes');
    });

    test('a note document is not a form document', async () => {
        const Docs = require('../../functions/shepherding-doc-writes.js');
        const {documentId} = await Docs.createDocument(db, {title: 'Minutes', actor});
        await assert.rejects(
            () => Payload.getFormDocument(db, {documentId}), /not a Form Document/);
    });

    // ── Care Lists ───────────────────────────────────────────────────────

    test('a care list works out who is on it from its filter, every time', async () => {
        const made = await Payload.createCareList(db, {
            title: 'Red flags', filter: {tagIds: ['red-flag']}, actor,
        });

        const empty = await Payload.getCareList(db, {documentId: made.documentId});
        assert.strictEqual(empty.rows.length, 0);

        await Writes.addTags(db, {personId: A, tagIds: ['red-flag'], actor});

        const filled = await Payload.getCareList(db, {documentId: made.documentId});
        assert.deepStrictEqual(filled.rows.map((r) => r.name), ['Sarah Bell']);
    });

    test('it starts with one column, and more can be added', async () => {
        const made = await Payload.createCareList(db, {title: 'Visits', actor});
        assert.deepStrictEqual(made.columns.map((c) => c.name), ['Notes']);

        const added = await Payload.addCareListColumn(db, {
            documentId: made.documentId, name: 'Last contact', actor,
        });
        assert.deepStrictEqual(added.columns.map((c) => c.name), ['Notes', 'Last contact']);
        assert.notStrictEqual(added.column.id, 'col_default');
    });

    test('a cell is written against a person and a column, and reads back as prose', async () => {
        await Writes.addTags(db, {personId: A, tagIds: ['red-flag'], actor});
        const made = await Payload.createCareList(db, {
            title: 'Red flags', filter: {tagIds: ['red-flag']}, actor,
        });

        await Payload.writeCareListCell(db, {
            documentId: made.documentId,
            personId: A,
            markdown: 'Visited **Tuesday**.',
            actor,
        });

        const list = await Payload.getCareList(db, {documentId: made.documentId});
        assert.strictEqual(list.rows[0].cells.col_default, 'Visited **Tuesday**.');
        assert.match(list.note, /shows, read-only, on that person's Shepherding Profile/);
    });

    test('a column that is not on the list is refused, listing the ones that are', async () => {
        const made = await Payload.createCareList(db, {title: 'Visits', actor});
        await assert.rejects(() => Payload.writeCareListCell(db, {
            documentId: made.documentId, personId: A, columnId: 'col_99', markdown: 'x', actor,
        }), /col_default/);
    });

    // ── MS-437: the assistant writes one cell, and never undoes a column ──

    function body(text) {
        return {type: 'doc', content: [{type: 'paragraph', content: [{type: 'text', text}]}]};
    }

    test('a cell another writer changed after the assistant read is still there after it writes a different cell', async () => {
        const made = await Payload.createCareList(db, {title: 'Visits', actor});
        const ref = db.collection('elder_documents').doc(made.documentId);
        await Payload.writeCareListCell(db, {
            documentId: made.documentId, personId: A, markdown: 'First.', actor,
        });
        // An elder's page saves B's cell — the whole map the assistant read is
        // now out of date.
        await ref.update(new (require('firebase-admin').firestore.FieldPath)(
            'careListData', B, 'col_default'), body('From the page'));

        await Payload.writeCareListCell(db, {
            documentId: made.documentId, personId: A, markdown: 'Second.', actor,
        });

        const stored = (await ref.get()).data().careListData;
        assert.deepStrictEqual(stored[B].col_default, body('From the page'));
        assert.strictEqual(NoteMarkdown.toMarkdown(stored[A].col_default), 'Second.');
    });

    test('writing into an old-shaped Care List keeps every cell and leaves the column shape', async () => {
        const ref = db.collection('elder_documents').doc('old-list');
        await ref.set({
            title: 'Old', docType: 'care-list', authorUid: UID, authorName: 'Jonathan Harris',
            careListData: {[B]: body('Written years ago')},
        });

        await Payload.writeCareListCell(db, {
            documentId: 'old-list', personId: A, markdown: 'New.', actor,
        });

        const data = (await ref.get()).data();
        assert.deepStrictEqual(data.careListColumns, [{id: 'col_default', name: 'Notes'}]);
        assert.deepStrictEqual(data.careListData[B], {col_default: body('Written years ago')});
        assert.strictEqual(NoteMarkdown.toMarkdown(data.careListData[A].col_default), 'New.');
    });

    test('a column the assistant adds never shows cells a removed column left behind', async () => {
        const made = await Payload.createCareList(db, {title: 'Visits', columns: ['Needs'], actor});
        const ref = db.collection('elder_documents').doc(made.documentId);
        // Leftovers under col_2, from a column removed before removals cleaned up.
        await ref.update({careListData: {[A]: {col_1: body('a'), col_2: body('stray')}}});

        const added = await Payload.addCareListColumn(db, {
            documentId: made.documentId, name: 'Prayer', actor,
        });
        assert.notStrictEqual(added.column.id, 'col_2');
        const list = await Payload.getCareList(db, {documentId: made.documentId});
        assert.ok(list.columns.some((c) => c.name === 'Prayer'));
    });

    test('a column change an elder made just before the assistant adds a column survives', async () => {
        const made = await Payload.createCareList(db, {title: 'Visits', columns: ['Needs', 'Visit'], actor});
        const ref = db.collection('elder_documents').doc(made.documentId);
        await ref.update({careListColumns: [{id: 'col_1', name: 'Needs'}, {id: 'col_2', name: 'Renamed by Ann'}]});

        await Payload.addCareListColumn(db, {documentId: made.documentId, name: 'Prayer', actor});

        const names = (await ref.get()).data().careListColumns.map((c) => c.name);
        assert.deepStrictEqual(names, ['Needs', 'Renamed by Ann', 'Prayer']);
    });

    test('a care list can read a saved Filtered View instead of its own filter', async () => {
        const view = await Payload.createView(db, {
            title: 'Red flags', filter: {tagIds: ['red-flag']}, actor,
        });
        await Writes.addTags(db, {personId: B, tagIds: ['red-flag'], actor});

        const made = await Payload.createCareList(db, {
            title: 'From the view', viewId: view.viewId, actor,
        });

        const list = await Payload.getCareList(db, {documentId: made.documentId});
        assert.deepStrictEqual(list.rows.map((r) => r.name), ['Tom Reed']);
    });

    // ── Filtered Views ───────────────────────────────────────────────────

    test('a view is stored in the shape the landing page reads', async () => {
        const made = await Payload.createView(db, {
            title: 'Urgent',
            filter: {tagIds: ['red-flag'], tagMode: 'all', statusZones: ['urgent__important']},
            actor,
        });
        assert.match(made.note, /every elder/i);

        const stored = (await db.collection('shepherding_views')
            .doc(made.viewId).get()).data();
        // The page's own field names, not ours.
        assert.deepStrictEqual(stored.filterTags, ['red-flag']);
        assert.strictEqual(stored.filterMode, 'all');
        assert.deepStrictEqual(stored.statusZoneFilters, ['urgent__important']);
        assert.strictEqual(stored.createdByName, 'Jonathan Harris');
        assert.strictEqual(stored.writtenVia, 'mcp');
    });

    test('a view can be listed and changed', async () => {
        const made = await Payload.createView(db, {
            title: 'Urgent', filter: {tagIds: ['red-flag']}, actor,
        });

        await Payload.updateView(db, {
            viewId: made.viewId, title: 'Needs attention',
            filter: {tagIds: ['red-flag'], tagMode: 'all'}, actor,
        });

        const listed = await Payload.listViews(db);
        assert.strictEqual(listed.count, 1);
        assert.strictEqual(listed.views[0].title, 'Needs attention');
        assert.strictEqual(listed.views[0].tagMode, 'all');
    });

    test('deleting a view says which Care Lists were reading it', async () => {
        const view = await Payload.createView(db, {
            title: 'Red flags', filter: {tagIds: ['red-flag']}, actor,
        });
        const list = await Payload.createCareList(db, {
            title: 'From the view', viewId: view.viewId, actor,
        });

        const gone = await Payload.deleteView(db, {viewId: view.viewId});
        assert.deepStrictEqual(
            gone.careListsAffected.map((c) => c.documentId), [list.documentId]);
        assert.match(gone.note, /every elder/i);
    });

    test('a view that is not there is refused rather than reported deleted', async () => {
        await assert.rejects(
            () => Payload.deleteView(db, {viewId: 'nope'}), /No Filtered View/);
    });

});
