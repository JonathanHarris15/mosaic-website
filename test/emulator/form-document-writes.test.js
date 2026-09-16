const {describe, test, before, beforeEach} = require('node:test');
const assert = require('node:assert');

const H = require('./harness.js');
const FormDoc = require('../../public/form-document-core.js');
const DocsCore = require('../../functions/shared/shepherding-documents-core.js');
const {withTree} = require('../../functions/shepherding-doc-writes.js');

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

    // What a page reaches through the shepherdingTree callable: one change,
    // applied to the latest tree in a transaction (MS-493).
    const changeTree = (treeId, change) =>
        withTree(db, (tree) => DocsCore.applyTreeChange(tree, change), treeId);

    async function treeIds(treeId) {
        const snap = await db.collection('elder_document_structure').doc(treeId).get();
        return snap.exists ? snap.data().children.map((c) => c.id) : null;
    }

    async function pickSubject(personId, name) {
        await ref.update(new fs.FieldPath('answers', 'shepherd_subject'), {personId, name});
    }

    test('settling moves it off the old profile and onto the one its answer names', async () => {
        await db.collection('elder_document_structure').doc('person_p-bob')
            .set({children: [{type: 'document', id: 'other'}, {type: 'document', id: DOC}]});
        await pickSubject('p-sue', 'Sue');

        const plan = await FormDoc.settleFiling(db, changeTree, DOC);

        assert.deepStrictEqual(plan.after, 'p-sue');
        assert.deepStrictEqual(await treeIds('person_p-bob'), ['other']);
        assert.deepStrictEqual(await treeIds('person_p-sue'), [DOC]);
        const stored = (await ref.get()).data();
        assert.strictEqual(stored.ownerPersonId, 'p-sue');
        assert.strictEqual(stored.inLibrary, true);
    });

    test('a document already filed under who it is about is left alone', async () => {
        await db.collection('elder_document_structure').doc('person_p-bob')
            .set({children: [{type: 'document', id: DOC}]});
        assert.strictEqual(await FormDoc.settleFiling(db, changeTree, DOC), null);
        assert.deepStrictEqual(await treeIds('person_p-bob'), [DOC]);
        assert.strictEqual(await treeIds('person_p-sue'), null);
    });

    test('two writers settling the same change at once leave it on one profile', async () => {
        await db.collection('elder_document_structure').doc('person_p-bob')
            .set({children: [{type: 'document', id: DOC}]});
        await pickSubject('p-sue', 'Sue');
        await Promise.all([
            FormDoc.settleFiling(db, changeTree, DOC),
            FormDoc.settleFiling(db, changeTree, DOC),
        ]);
        assert.deepStrictEqual(await treeIds('person_p-bob'), []);
        assert.deepStrictEqual(await treeIds('person_p-sue'), [DOC]);
    });

    test('a second pick while the first is settling ends filed under the second', async () => {
        await db.collection('elder_document_structure').doc('person_p-bob')
            .set({children: [{type: 'document', id: DOC}]});
        await pickSubject('p-sue', 'Sue');
        const first = FormDoc.settleFiling(db, changeTree, DOC);
        await first;
        await pickSubject('p-ann', 'Ann');
        await FormDoc.settleFiling(db, changeTree, DOC);
        assert.deepStrictEqual(await treeIds('person_p-bob'), []);
        assert.deepStrictEqual(await treeIds('person_p-sue'), []);
        assert.deepStrictEqual(await treeIds('person_p-ann'), [DOC]);
        assert.strictEqual((await ref.get()).data().ownerPersonId, 'p-ann');
    });

    test('clearing who it is about takes it off the profile and files it nowhere', async () => {
        await db.collection('elder_document_structure').doc('person_p-bob')
            .set({children: [{type: 'document', id: DOC}]});
        await ref.update(new fs.FieldPath('answers', 'shepherd_subject'), null);
        await FormDoc.settleFiling(db, changeTree, DOC);
        assert.deepStrictEqual(await treeIds('person_p-bob'), []);
        assert.strictEqual((await ref.get()).data().ownerPersonId, null);
    });
});
