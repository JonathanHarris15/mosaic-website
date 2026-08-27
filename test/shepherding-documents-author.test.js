const { test } = require('node:test');
const assert = require('node:assert');

const Core = require('../public/shepherding-documents-core.js');

// MS-283. An Elder Document that nobody can be traced to is worse than a create
// that failed: the record exists, it sits in the Pastoral Record, and nothing
// surfaces the problem. So the builder refuses rather than emitting one.
//
// The bug this guards: the Documents tab on a Shepherding Profile captured the
// signed-in user before Firebase Auth had produced one, so every document it
// made was authored by `undefined` — or, for the name, by the literal string
// "Elder". Both faults were assembled inline in a click handler where no test
// could reach them. This is that seam, lifted out.

const STAMP = { __serverTimestamp: true }; // stands in for the Firestore sentinel

function build(overrides = {}) {
    return Core.buildElderDocument({
        title: 'New Document',
        docType: 'note',
        author: { uid: 'uid-jono', name: 'jono' },
        timestamp: STAMP,
        ...overrides,
    });
}

function refusal(overrides) {
    return assert.throws(() => build(overrides), (e) => e.code === Core.MISSING_AUTHOR);
}

test('a document carries the author it was given, not a default', () => {
    const record = build({ author: { uid: 'uid-sam', name: 'sam' } });
    assert.strictEqual(record.authorUid, 'uid-sam');
    assert.strictEqual(record.authorName, 'sam');
    assert.strictEqual(record.updatedByName, 'sam');
    assert.notStrictEqual(record.authorName, 'Elder');
});

test('a document with no resolvable author is refused, not written', () => {
    refusal({ author: null });
    refusal({ author: undefined });
    refusal({ author: {} });
    refusal({ author: { uid: undefined, name: 'jono' } });
    refusal({ author: { uid: '', name: 'jono' } });
    refusal({ author: { uid: '   ', name: 'jono' } });
    refusal({ author: { uid: 'uid-jono', name: '' } });
    refusal({ author: { uid: 'uid-jono' } });
});

function refusalMessage(overrides) {
    try { build(overrides); } catch (e) { return e.message; }
    return assert.fail('expected a refusal');
}

test('the refusal says which half of the author was missing', () => {
    const noId = refusalMessage({ author: { name: 'jono' } });
    const noName = refusalMessage({ author: { uid: 'uid-jono' } });
    assert.match(noId, /author id/i);
    assert.match(noName, /author name/i);
    assert.notStrictEqual(noId, noName);
});

test('a refused document never leaks a half-built record', () => {
    // Nothing is returned on refusal — the caller cannot accidentally write one.
    let record = 'untouched';
    try { record = build({ author: null }); } catch { /* expected */ }
    assert.strictEqual(record, 'untouched');
});

test('no field of a built record is undefined', () => {
    for (const record of [
        build(),
        build({ ownerPersonId: 'person-7' }),
        build({ docType: 'care-list', filterId: 'view-1' }),
        build({ docType: 'care-list', filterConfig: { filterTags: [], filterMode: 'any', statusZoneFilters: [] } }),
    ]) {
        for (const [key, value] of Object.entries(record)) {
            assert.notStrictEqual(value, undefined, `${key} is undefined`);
        }
    }
});

test('in profile scope the document belongs to its Person and stays off the Library', () => {
    const record = build({ ownerPersonId: 'person-7' });
    assert.strictEqual(record.ownerPersonId, 'person-7');
    assert.strictEqual(record.inLibrary, false);
});

test('outside profile scope the document has neither owning Person nor Library flag', () => {
    const record = build();
    assert.strictEqual('ownerPersonId' in record, false);
    assert.strictEqual('inLibrary' in record, false);
});

test('a note is blank, a care list carries its filter', () => {
    const note = build();
    assert.strictEqual(note.docType, 'note');
    assert.strictEqual(note.contentJson, null);
    assert.strictEqual('careListData' in note, false);

    const preset = build({ docType: 'care-list', title: 'New Care List', filterId: 'view-1' });
    assert.strictEqual(preset.filterId, 'view-1');
    assert.deepStrictEqual(preset.careListData, {});
    assert.strictEqual('contentJson' in preset, false);
    assert.strictEqual('filterConfig' in preset, false);

    const custom = { filterTags: ['t1'], filterMode: 'any', statusZoneFilters: [] };
    const bespoke = build({ docType: 'care-list', filterConfig: custom });
    assert.deepStrictEqual(bespoke.filterConfig, custom);
    assert.notStrictEqual(bespoke.filterConfig, custom, 'the filter is copied, not aliased');
    assert.strictEqual('filterId' in bespoke, false);
});

test('the timestamp the caller supplies is used for both stamps', () => {
    const record = build();
    assert.strictEqual(record.createdAt, STAMP);
    assert.strictEqual(record.updatedAt, STAMP);
});

test('the payload is otherwise unchanged from what the Library wrote before', () => {
    assert.deepStrictEqual(Object.keys(build()).sort(), [
        'authorName', 'authorUid', 'contentJson', 'createdAt',
        'docType', 'title', 'updatedAt', 'updatedByName',
    ]);
    assert.deepStrictEqual(Object.keys(build({ ownerPersonId: 'person-7' })).sort(), [
        'authorName', 'authorUid', 'contentJson', 'createdAt', 'docType',
        'inLibrary', 'ownerPersonId', 'title', 'updatedAt', 'updatedByName',
    ]);
});

// ── Resolving who is writing ─────────────────────────────────────────────────
// The host page's identity is the truth; the live auth session is the last
// resort. This was inline in a getter until both reviews pointed out that a
// fallback covering only half the author can never rescue anything.

const SESSION = { uid: 'uid-session', email: 'jono@example.org' };

test('the host page is believed when it knows who is signed in', () => {
    assert.deepStrictEqual(
        Core.resolveAuthor({ user: { uid: 'uid-host' }, name: 'jono' }, SESSION),
        { uid: 'uid-host', name: 'jono' });
});

test('the live auth session covers BOTH halves when the host knows nothing', () => {
    assert.deepStrictEqual(
        Core.resolveAuthor({ user: null, name: '' }, SESSION),
        { uid: 'uid-session', name: 'jono' });
    // The whole point: a uid on its own would still be refused by the builder.
    assert.doesNotThrow(() => build({ author: Core.resolveAuthor({}, SESSION) }));
});

test('with neither host nor session, the author is empty and the build is refused', () => {
    for (const empty of [
        Core.resolveAuthor(null, null),
        Core.resolveAuthor({}, null),
        Core.resolveAuthor({ user: null, name: '' }, null),
        Core.resolveAuthor(undefined, undefined),
    ]) {
        assert.deepStrictEqual(empty, { uid: '', name: '' });
        refusal({ author: empty });
    }
});

test('a session with no email still yields its uid, and is refused for want of a name', () => {
    const author = Core.resolveAuthor({}, { uid: 'uid-session' });
    assert.strictEqual(author.uid, 'uid-session');
    assert.strictEqual(author.name, '');
    refusal({ author: author });
});

test('the author is never undefined in either half', () => {
    for (const args of [[null, null], [{}, {}], [{ user: {} }, null], [{ name: 'jono' }, null]]) {
        const author = Core.resolveAuthor(args[0], args[1]);
        assert.notStrictEqual(author.uid, undefined);
        assert.notStrictEqual(author.name, undefined);
    }
});
