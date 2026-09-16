const {describe, test, before, beforeEach} = require('node:test');
const assert = require('node:assert');

const H = require('./harness.js');
const FormDoc = require('../../public/form-document-core.js');
const DocsCore = require('../../public/shepherding-documents-core.js');

// The Form Document writes the page shares with the assistant (MS-483),
// against a real Firestore: a save at one answer's field leaves an answer
// somebody else saved in between alone, and re-filing moves a document between
// profile trees in the order that never leaves it on two.

const DOC = 'form-doc-1';

const suite = H.skipReason
    ? (name) => test(name, {skip: H.skipReason}, () => {})
    : describe;

suite('the shared Form Document writes', () => {
    let db, fs, ref;

    before(() => {
        db = H.connect();
        fs = require('firebase-admin').firestore;
    });

    beforeEach(async () => {
        await H.wipe();
        ref = db.collection('elder_documents').doc(DOC);
        await ref.set({
            title: 'Elder Interview', docType: 'form', shepherdingDoc: true, ownerPersonId: 'p-bob',
            questions: [
                {id: 'shepherd_subject', type: 'person', text: 'Who is this document for?'},
                {id: 'story', type: 'paragraph', text: 'How did they come to faith?'},
                {id: 'ready', type: 'choice_one', text: 'Ready?', options: ['Yes', 'No']},
            ],
            answers: {shepherd_subject: {personId: 'p-bob', name: 'Bob'}},
        });
    });

    test('an answer saved in between survives a save of a different answer', async () => {
        const ann = FormDoc.createSession((await ref.get()).data());
        const bob = FormDoc.createSession((await ref.get()).data());

        const annScreen = Object.assign({}, (await ref.get()).data().answers, {story: 'A friend asked.'});
        await FormDoc.saveEdits(db, fs, DOC, Object.assign(ann.takeSave(annScreen, 'Elder Interview'), {byName: 'Ann'}));

        const bobScreen = Object.assign({}, annScreen, {story: undefined, ready: 'Yes'});
        delete bobScreen.story;
        await FormDoc.saveEdits(db, fs, DOC, Object.assign(bob.takeSave(bobScreen, 'Elder Interview'), {byName: 'Bob'}));

        const stored = (await ref.get()).data();
        assert.strictEqual(stored.answers.story, 'A friend asked.');
        assert.strictEqual(stored.answers.ready, 'Yes');
        assert.strictEqual(stored.title, 'Elder Interview');
        assert.strictEqual(stored.updatedByName, 'Bob');
    });

    test('saving into a document with no answers at all works', async () => {
        await ref.update({answers: fs.FieldValue.delete()});
        await FormDoc.saveEdits(db, fs, DOC, {answers: [{questionId: 'ready', value: 'No'}]});
        assert.deepStrictEqual((await ref.get()).data().answers, {ready: 'No'});
    });

    test('re-filing takes it off the old profile and puts it on the new one', async () => {
        await db.collection('elder_document_structure').doc('person_p-bob')
            .set({children: [{type: 'document', id: 'other'}, {type: 'document', id: DOC}]});

        await FormDoc.refile(db, DocsCore, DOC, 'p-bob', 'p-sue');

        const bobTree = (await db.collection('elder_document_structure').doc('person_p-bob').get()).data();
        const sueTree = (await db.collection('elder_document_structure').doc('person_p-sue').get()).data();
        assert.deepStrictEqual(bobTree.children.map((c) => c.id), ['other']);
        assert.deepStrictEqual(sueTree.children.map((c) => c.id), [DOC]);
        const stored = (await ref.get()).data();
        assert.strictEqual(stored.ownerPersonId, 'p-sue');
        assert.strictEqual(stored.inLibrary, true);
    });

    test('clearing who it is about takes it off the profile and files it nowhere', async () => {
        await db.collection('elder_document_structure').doc('person_p-bob')
            .set({children: [{type: 'document', id: DOC}]});
        await FormDoc.refile(db, DocsCore, DOC, 'p-bob', '');
        const bobTree = (await db.collection('elder_document_structure').doc('person_p-bob').get()).data();
        assert.deepStrictEqual(bobTree.children, []);
        assert.strictEqual((await ref.get()).data().ownerPersonId, null);
    });
});
