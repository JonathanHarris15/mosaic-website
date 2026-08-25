const {describe, test, before, beforeEach} = require('node:test');
const assert = require('node:assert');

const admin = require('firebase-admin');
const H = require('./harness.js');
const nw = require('../../functions/note-writes.js');
const sr = require('../../functions/service-read.js');

// Writing the comment bubble on one element of a Sunday (MS-262).
//
// ⚠ WHAT ONLY A REAL FIRESTORE SHOWS HERE. `notes` is a MAP, and the write
// must land as the dot path `notes.{slot}`. set(merge) reads 'notes.sermon'
// as a field NAME containing a dot and quietly builds a second, parallel
// notes map beside the real one — a bug invisible to a fake, and invisible
// on the page too, because the real map still reads fine and the note simply
// never appears.
//
// The escaping is covered as pure logic in test/service-note-core.test.js.
// What is checked here is that nothing unescaped reaches the document.

const DATE = '2026-08-17';

const suite = H.skipReason
    ? (name) => test(name, {skip: H.skipReason}, () => {})
    : describe;

suite('writing an element note', () => {
    let db;

    before(() => {
        db = H.connect();
    });

    beforeEach(async () => {
        await H.wipe();
    });

    function args(element, text) {
        return {
            dateKey: DATE,
            element,
            text,
            serverTimestamp: admin.firestore.FieldValue.serverTimestamp(),
            deleteField: admin.firestore.FieldValue.delete(),
        };
    }

    const doc = async () =>
        (await db.collection('services').doc(DATE).get()).data();

    test('a note lands under notes, keyed by its element', async () => {
        const r = await nw.updateNote(db, args('hymn1', 'Bill is away'));
        assert.strictEqual(r.ok, true);
        assert.strictEqual(r.action, 'written');

        const d = await doc();
        assert.strictEqual(d.notes.hymn1, '<p>Bill is away</p>');
    });

    test('⚠ it lands as a nested map, NOT as a field called "notes.hymn1"', async () => {
        await db.collection('services').doc(DATE).set({theme: 'Existing'});
        await nw.updateNote(db, args('hymn1', 'A note'));

        const d = await doc();
        assert.strictEqual(d['notes.hymn1'], undefined,
            'a parallel notes map was built beside the real one');
        assert.strictEqual(typeof d.notes, 'object');
        assert.ok(d.notes.hymn1);
    });

    test('a note on one element leaves the others, and the liturgy, alone', async () => {
        await db.collection('services').doc(DATE).set({
            theme: 'The God Who Rescues',
            liturgy: {hymn1: {id: 'h-1', name: 'Holy Holy Holy'}},
            notes: {sermon: '<p>Existing sermon note</p>'},
        });

        await nw.updateNote(db, args('hymn1', 'New hymn note'));

        const d = await doc();
        assert.strictEqual(d.theme, 'The God Who Rescues');
        assert.deepStrictEqual(d.liturgy.hymn1, {id: 'h-1', name: 'Holy Holy Holy'});
        assert.strictEqual(d.notes.sermon, '<p>Existing sermon note</p>');
        assert.strictEqual(d.notes.hymn1, '<p>New hymn note</p>');
    });

    test('the first note on a Sunday with no document yet still lands', async () => {
        const r = await nw.updateNote(db, args('sermon', 'Start here'));
        assert.strictEqual(r.ok, true);

        const d = await doc();
        assert.strictEqual(d.notes.sermon, '<p>Start here</p>');
        assert.ok(d.updatedAt);
    });

    test('an empty note DELETES the key rather than storing an empty string', async () => {
        await nw.updateNote(db, args('hymn1', 'Something'));
        const r = await nw.updateNote(db, args('hymn1', ''));

        assert.strictEqual(r.action, 'cleared');
        const d = await doc();
        assert.strictEqual((d.notes || {}).hymn1, undefined,
            'an empty string would leave an empty bubble hanging on the element');
    });

    test('clearing a note on a Sunday that does not exist creates nothing', async () => {
        const r = await nw.updateNote(db, args('hymn1', ''));
        assert.strictEqual(r.ok, true);

        const snap = await db.collection('services').doc(DATE).get();
        assert.strictEqual(snap.exists, false,
            'an empty Sunday carrying nothing but a deleted note is a lie on the calendar');
    });

    test('an element that carries no note is refused, and nothing is written', async () => {
        const r = await nw.updateNote(db, args('preacher', 'Not allowed'));
        assert.strictEqual(r.ok, false);
        assert.strictEqual(r.reason, 'unknown-element');

        const snap = await db.collection('services').doc(DATE).get();
        assert.strictEqual(snap.exists, false);
    });

    test('⚠ nothing unescaped reaches the stored document', async () => {
        await nw.updateNote(db, args('sermon', '<script>alert(1)</script>'));
        const d = await doc();
        assert.ok(!/<script/i.test(d.notes.sermon), d.notes.sermon);
        assert.ok(d.notes.sermon.includes('&lt;script&gt;'));
    });

    test('a note written here reads back through oos_get_service, as text', async () => {
        await nw.updateNote(db, args('sermon', 'Ask Cara about the reading'));

        const s = await sr.getService(db, DATE);
        const row = s.liturgy.find((r) => r.field === 'sermon');
        assert.strictEqual(row.note, 'Ask Cara about the reading',
            'the assistant should read the note, not its markup');
    });

    test('writing a note does not claim the element was chosen by anybody', async () => {
        // decidedBy records who CHOSE an element. Commenting on a hymn is not
        // choosing it, and stamping it would reassign credit for the pick.
        await db.collection('services').doc(DATE).set({
            liturgy: {hymn1: {id: 'h-1', name: 'Holy Holy Holy'}},
            decidedBy: {hymn1: {id: 'p-1', name: 'Alice Smith', at: null}},
        });

        await nw.updateNote(db, args('hymn1', 'A passing remark'));

        const d = await doc();
        assert.deepStrictEqual(d.decidedBy.hymn1,
            {id: 'p-1', name: 'Alice Smith', at: null},
            'the note must not rewrite who chose the hymn');
    });

    test('every element that can carry a note accepts one', async () => {
        const NoteCore = require('../../functions/shared/service-note-core.js');
        for (const key of NoteCore.NOTE_KEYS) {
            const r = await nw.updateNote(db, args(key, `note for ${key}`));
            assert.strictEqual(r.ok, true, key);
        }
        const d = await doc();
        assert.strictEqual(Object.keys(d.notes).length, NoteCore.NOTE_KEYS.length);
    });
});
