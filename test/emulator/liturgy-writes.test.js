const {describe, test, before, beforeEach} = require('node:test');
const assert = require('node:assert');

const H = require('./harness.js');
const {updateLiturgy} = require('../../functions/liturgy-writes.js');

// oos_update_liturgy's actual write (MS-262).
//
// ⚠ WHAT THIS PROVES THAT THE UNIT TESTS ON liturgy-save-core.js CANNOT.
// The allowlist and the path-shaping are pure and covered elsewhere. What can
// only be shown against a real Firestore is:
//   1. A partial write really does leave every untouched field alone —
//      ADR-0034's whole point, and the actual reason this ticket promotes
//      the merge logic instead of restating it.
//   2. The first save of a Sunday with no document yet takes the
//      `.set({merge:true})` fallback and produces the SAME nested shape a
//      later partial `.update()` would read back correctly.
//   3. The authorship stamp (decidedBy.{slot}) rides in the SAME write as
//      the value, and clearing a slot clears its stamp too — even for an
//      account we cannot resolve to a Person.

const DATE = '2026-03-15';
const UID = 'uid-editor-1';
const PERSON_ID = 'person-alice';

const suite = H.skipReason
    ? (name) => test(name, {skip: H.skipReason}, () => {})
    : describe;

suite('oos_update_liturgy writes', () => {
    let db, admin;

    before(() => {
        db = H.connect();
        admin = require('firebase-admin');
    });

    beforeEach(async () => {
        await H.wipe();
        await H.seedPerson(db, PERSON_ID, {name: 'Alice Smith'});
        await db.collection('users').doc(UID).set({personId: PERSON_ID});
    });

    function args(fields) {
        return {
            dateKey: DATE,
            fields,
            uid: UID,
            serverTimestamp: admin.firestore.FieldValue.serverTimestamp(),
            deleteField: admin.firestore.FieldValue.delete(),
        };
    }

    test('the first save of a Sunday with no document yet lands the nested shape', async () => {
        const result = await updateLiturgy(db, args({
            theme: 'The God Who Rescues',
            hymn1: {id: 'h-1', name: 'Holy Holy Holy'},
        }));
        assert.strictEqual(result.ok, true);

        const doc = (await db.collection('services').doc(DATE).get()).data();
        assert.strictEqual(doc.theme, 'The God Who Rescues');
        assert.deepStrictEqual(doc.liturgy.hymn1, {id: 'h-1', name: 'Holy Holy Holy'});
        assert.strictEqual(doc.decidedBy.hymn1.id, PERSON_ID);
        assert.strictEqual(doc.decidedBy.hymn1.name, 'Alice Smith');
        assert.ok(doc.updatedAt);
    });

    test('a partial update on an existing Sunday leaves every other field untouched', async () => {
        await db.collection('services').doc(DATE).set({
            theme: 'Old Theme',
            keyVerse: 'Psalm 23:1',
            liturgy: {
                hymn1: {id: 'h-old', name: 'Old Hymn'},
                sermon: 'Old sermon text',
            },
            decidedBy: {hymn1: {id: 'someone-else', name: 'Bob', at: 'earlier'}},
        });

        const result = await updateLiturgy(db, args({sermon: 'John 3:16'}));
        assert.strictEqual(result.ok, true);

        const doc = (await db.collection('services').doc(DATE).get()).data();
        assert.strictEqual(doc.theme, 'Old Theme');
        assert.strictEqual(doc.keyVerse, 'Psalm 23:1');
        assert.deepStrictEqual(doc.liturgy.hymn1, {id: 'h-old', name: 'Old Hymn'});
        assert.strictEqual(doc.liturgy.sermon, 'John 3:16');
        // hymn1's stamp is untouched — only sermon's changed.
        assert.deepStrictEqual(doc.decidedBy.hymn1, {id: 'someone-else', name: 'Bob', at: 'earlier'});
        assert.strictEqual(doc.decidedBy.sermon.id, PERSON_ID);
    });

    test('a rejected field is refused before anything is written', async () => {
        const result = await updateLiturgy(db, args({
            theme: 'Should not land',
            preacher: {id: 'p-1', name: 'Someone'},
        }));
        assert.strictEqual(result.ok, false);
        assert.deepStrictEqual(result.rejectedFields, ['preacher']);

        const doc = await db.collection('services').doc(DATE).get();
        assert.strictEqual(doc.exists, false);
    });

    test('clearing a hymn slot clears its authorship stamp too', async () => {
        await db.collection('services').doc(DATE).set({
            liturgy: {hymn1: {id: 'h-old', name: 'Old Hymn'}},
            decidedBy: {hymn1: {id: 'someone-else', name: 'Bob', at: 'earlier'}},
        });

        const result = await updateLiturgy(db, args({hymn1: null}));
        assert.strictEqual(result.ok, true);

        const doc = (await db.collection('services').doc(DATE).get()).data();
        assert.strictEqual(doc.liturgy.hymn1, null);
        assert.strictEqual((doc.decidedBy || {}).hymn1, undefined);
    });

    test('theme/keyVerse changes carry no authorship stamp — only liturgy elements are stamped', async () => {
        const result = await updateLiturgy(db, args({
            theme: 'A New Theme', keyVerse: 'Romans 8:28',
        }));
        assert.strictEqual(result.ok, true);

        const doc = (await db.collection('services').doc(DATE).get()).data();
        assert.strictEqual(doc.theme, 'A New Theme');
        assert.strictEqual(doc.decidedBy, undefined);
    });

    test('an account with no linked Person still writes, but records no stamp', async () => {
        await db.collection('users').doc(UID).set({}); // no personId

        const result = await updateLiturgy(db, args({
            hymn1: {id: 'h-1', name: 'Holy Holy Holy'},
        }));
        assert.strictEqual(result.ok, true);

        const doc = (await db.collection('services').doc(DATE).get()).data();
        assert.deepStrictEqual(doc.liturgy.hymn1, {id: 'h-1', name: 'Holy Holy Holy'});
        assert.strictEqual((doc.decidedBy || {}).hymn1, undefined);
    });

    test('an update with nothing allowed to change is a no-op, not a write', async () => {
        const result = await updateLiturgy(db, args({}));
        assert.deepStrictEqual(result, {ok: true, updated: {}});

        const doc = await db.collection('services').doc(DATE).get();
        assert.strictEqual(doc.exists, false);
    });
});
