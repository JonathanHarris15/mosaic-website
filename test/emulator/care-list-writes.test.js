const {describe, test, before, beforeEach} = require('node:test');
const assert = require('node:assert');

const H = require('./harness.js');
const CareList = require('../../public/care-list-core.js');

// The Care List writes the web page and the phone screen share (MS-435),
// against a real Firestore.
//
// ⚠ WHAT ONLY A REAL DATABASE SHOWS HERE. That a save written at one cell's
// field path leaves a cell somebody else wrote in between alone, and that two
// column changes in a row both stand, are claims about Firestore's update and
// transaction — a fake would only agree with itself.

const DOC = 'care-list-1';
const BOB = 'p-bob';
const SUE = 'p-sue';

function body(text) {
    return {type: 'doc', content: [{type: 'paragraph', content: [{type: 'text', text}]}]};
}

const suite = H.skipReason
    ? (name) => test(name, {skip: H.skipReason}, () => {})
    : describe;

suite('the shared Care List writes', () => {
    let db, fs, ref;

    before(() => {
        db = H.connect();
        fs = require('firebase-admin').firestore;
    });

    beforeEach(async () => {
        await H.wipe();
        ref = db.collection('elder_documents').doc(DOC);
        await ref.set({
            title: 'Visits', docType: 'care-list',
            careListColumns: [{id: 'col_1', name: 'Needs'}, {id: 'col_2', name: 'Last visit'}],
            careListData: {[BOB]: {col_1: body('Meals')}, [SUE]: {col_1: body('Rides')}},
        });
    });

    test('a cell save leaves a cell written in between untouched', async () => {
        // Two elders open the list; Ann saves Sue's cell; then Bob's page saves
        // Bob's. Bob's page never saw Ann's change, and must not undo it.
        const ann = CareList.createSession((await ref.get()).data());
        const bob = CareList.createSession((await ref.get()).data());

        ann.edited(SUE, 'col_1');
        await CareList.saveEdits(db, fs, DOC, Object.assign(
            ann.takeSave(() => body('Rides on Sunday'), () => ''), {byName: 'Ann'}));

        bob.edited(BOB, 'col_2');
        await CareList.saveEdits(db, fs, DOC, Object.assign(
            bob.takeSave(() => body('June'), () => ''), {byName: 'Bob'}));

        const stored = (await ref.get()).data();
        assert.deepStrictEqual(stored.careListData[SUE].col_1, body('Rides on Sunday'));
        assert.deepStrictEqual(stored.careListData[BOB], {col_1: body('Meals'), col_2: body('June')});
        assert.strictEqual(stored.updatedByName, 'Bob');
        assert.strictEqual(stored.title, 'Visits', 'the title was not typed into, so it was not written');
    });

    test('a cell a person outside the filter owns survives a save', async () => {
        await ref.update(new fs.FieldPath('careListData', 'p-gone', 'col_1'), body('Kept'));
        const s = CareList.createSession((await ref.get()).data());
        s.edited(BOB, 'col_1');
        await CareList.saveEdits(db, fs, DOC, s.takeSave(() => body('Meals twice'), () => ''));
        assert.deepStrictEqual((await ref.get()).data().careListData['p-gone'], {col_1: body('Kept')});
    });

    test('an emptied cell is taken out of the record', async () => {
        await CareList.saveEdits(db, fs, DOC, {cells: [{personId: SUE, columnId: 'col_1', value: null}]});
        assert.deepStrictEqual((await ref.get()).data().careListData[SUE], {});
    });

    test('two column changes back to back both survive', async () => {
        await CareList.changeColumn(db, fs, DOC, {kind: 'add', name: 'Prayer'}, 'Ann');
        await CareList.changeColumn(db, fs, DOC, {kind: 'rename', columnId: 'col_2', name: 'Visited'}, 'Bob');
        const names = (await ref.get()).data().careListColumns.map((c) => c.name);
        assert.deepStrictEqual(names, ['Needs', 'Visited', 'Prayer']);
    });

    test('two column changes at the same moment both survive', async () => {
        await Promise.all([
            CareList.changeColumn(db, fs, DOC, {kind: 'add', name: 'Prayer'}, 'Ann'),
            CareList.changeColumn(db, fs, DOC, {kind: 'rename', columnId: 'col_1', name: 'What they need'}, 'Bob'),
        ]);
        const names = (await ref.get()).data().careListColumns.map((c) => c.name);
        assert.deepStrictEqual(names, ['What they need', 'Last visit', 'Prayer']);
    });

    test('removing a column removes its cells in the same write', async () => {
        await CareList.changeColumn(db, fs, DOC, {kind: 'remove', columnId: 'col_1'}, 'Ann');
        const data = (await ref.get()).data();
        assert.deepStrictEqual(data.careListColumns.map((c) => c.id), ['col_2']);
        assert.deepStrictEqual(data.careListData, {[BOB]: {}, [SUE]: {}});
    });

    test('an old-shaped list is normalised before a cell is written', async () => {
        await ref.set({title: 'Old', docType: 'care-list', careListData: {[BOB]: body('Written years ago')}});
        const s = CareList.createSession((await ref.get()).data());
        s.edited(SUE, 'col_default');
        const save = s.takeSave(() => body('New'), () => '');
        await CareList.saveEdits(db, fs, DOC, Object.assign(save, {oldShape: s.oldShape()}));

        const data = (await ref.get()).data();
        assert.deepStrictEqual(data.careListColumns, [{id: 'col_default', name: 'Notes'}]);
        assert.deepStrictEqual(data.careListData, {
            [BOB]: {col_default: body('Written years ago')},
            [SUE]: {col_default: body('New')},
        });
    });
});
