// A Sunday can be edited by two people at once, so a save must write only what
// that person changed.
//
// The Order of Service used to send its whole in-memory copy on every autosave
// — every liturgy slot, filled or blank, from the snapshot the page loaded on
// open. Two men on the same Sunday therefore fought: one picks Hymn 1, the
// other picks Hymn 4, and whoever's three-second timer lands second writes the
// blank it loaded minutes ago over the other's hymn. Nothing warns anybody,
// because from Firestore's side it is an ordinary field write.
//
// The fix is to diff before writing. `flattenServiceForSave` turns the editor's
// nested model into the flat document shape, and `changedFieldPaths` compares
// the flattened original against the flattened current and hands back dot-path
// field updates for the difference only. A slot nobody touched is not in the
// write at all, so it cannot lose a race it never entered.
//
// The granularity that matters is the liturgy SLOT, not the leaf inside it. A
// hymn is {id, name} and the two are chosen together; splitting them could
// leave an id pointing at one hymn and a name reading another. One person edits
// one slot, so one slot is the unit.

const { test } = require('node:test');
const assert = require('node:assert');

const { flattenServiceForSave, changedFieldPaths } = require('../public/service-builder.js');

// A minimal editor model, shaped the way service-builder holds it in memory.
function model(overrides = {}) {
    const base = {
        theme: '',
        keyVerse: '',
        serviceLeader: { id: null, name: '' },
        musicLeader: { id: null, name: '' },
        musicHelpers: [],
        preacher: { id: null, name: '' },
        prayerPraise: { id: null, name: '' },
        prayerConfession: { id: null, name: '' },
        elements: { id: null, name: '' },
        other: { id: null, name: '' },
        hasBaptism: false,
        removedHymns: [],
        isIrregular: false,
        irregularElements: [],
        notes: {},
        liturgy: {
            preparatoryHymn: { id: null, name: '' },
            callToWorship: '',
            hymn1: { id: null, name: '' },
            hymn2: { id: null, name: '' },
            callToConfession: '',
            assuranceOfPardon: '',
            hymnMid1: { id: null, name: '' },
            hymnMid2: { id: null, name: '' },
            scriptureReading: '',
            prayerMale: { id: null, name: '' },
            prayerFemale: { id: null, name: '' },
            sermon: '',
            hymnEnd1: { id: null, name: '' },
            hymnEnd2: { id: null, name: '' },
            benediction: '',
            baptism: []
        }
    };
    return Object.assign(base, overrides);
}

// ── Nothing changed ────────────────────────────────────────────────────────

test('an untouched Sunday writes nothing', () => {
    const before = flattenServiceForSave(model());
    const after = flattenServiceForSave(model());
    assert.deepStrictEqual(changedFieldPaths(before, after), {});
});

// ── The race the fix exists to stop ────────────────────────────────────────

test('picking one hymn writes that hymn and no other slot', () => {
    const before = flattenServiceForSave(model());

    const mine = model();
    mine.liturgy.hymn1 = { id: 'h-88', name: 'Come Thou Fount' };
    const after = flattenServiceForSave(mine);

    const update = changedFieldPaths(before, after);

    assert.deepStrictEqual(update, {
        'liturgy.hymn1': { id: 'h-88', name: 'Come Thou Fount' }
    });
});

test("my save carries no path for the slot someone else is filling", () => {
    // I am editing Hymn 1. Another editor is on Hymn 4 (hymnMid2). My write
    // must not mention hymnMid2 at all — not even as the blank I loaded.
    const before = flattenServiceForSave(model());
    const mine = model();
    mine.liturgy.hymn1 = { id: 'h-88', name: 'Come Thou Fount' };

    const update = changedFieldPaths(before, flattenServiceForSave(mine));

    assert.ok(!('liturgy.hymnMid2' in update),
        'a slot this editor never touched must be absent from the write');
    assert.ok(!('liturgy.hymnEnd1' in update));
    assert.ok(!('liturgy.preparatoryHymn' in update));
});

test('two editors on different slots produce disjoint writes', () => {
    const loaded = flattenServiceForSave(model());

    const a = model();
    a.liturgy.hymn1 = { id: 'h-1', name: 'Holy Holy Holy' };

    const b = model();
    b.liturgy.hymnMid2 = { id: 'h-2', name: 'It Is Well' };

    const updateA = changedFieldPaths(loaded, flattenServiceForSave(a));
    const updateB = changedFieldPaths(loaded, flattenServiceForSave(b));

    const overlap = Object.keys(updateA).filter(k => k in updateB);
    assert.deepStrictEqual(overlap, [],
        'disjoint edits must not share a single field path');
});

// ── Slot granularity ───────────────────────────────────────────────────────

test('a hymn slot is written whole, so its id and name cannot split', () => {
    const before = flattenServiceForSave(model());
    const mine = model();
    mine.liturgy.hymn1 = { id: 'h-88', name: 'Come Thou Fount' };

    const update = changedFieldPaths(before, flattenServiceForSave(mine));

    assert.ok(!('liturgy.hymn1.name' in update), 'must not descend into the slot');
    assert.deepStrictEqual(update['liturgy.hymn1'], { id: 'h-88', name: 'Come Thou Fount' });
});

test('clearing a hymn is a change, not an absence', () => {
    const before = flattenServiceForSave(
        model({ liturgy: Object.assign(model().liturgy, { hymn1: { id: 'h-88', name: 'Come Thou Fount' } }) })
    );
    const after = flattenServiceForSave(model());

    const update = changedFieldPaths(before, after);
    assert.deepStrictEqual(update['liturgy.hymn1'], { id: null, name: '' });
});

// ── Top-level fields ───────────────────────────────────────────────────────

test('the theme writes as a top-level path', () => {
    const before = flattenServiceForSave(model());
    const update = changedFieldPaths(before, flattenServiceForSave(model({ theme: 'The Kindness of God' })));
    assert.deepStrictEqual(update, { theme: 'The Kindness of God' });
});

test('a person field writes its name and id together and nothing else', () => {
    const before = flattenServiceForSave(model());
    const mine = model();
    mine.preacher = { id: 'p-7', name: 'Bill Smith' };

    const update = changedFieldPaths(before, flattenServiceForSave(mine));

    assert.deepStrictEqual(update, { preacher: 'Bill Smith', preacherId: 'p-7' });
    assert.ok(!('serviceLeader' in update), 'the other people are untouched');
});

// ── Arrays ─────────────────────────────────────────────────────────────────

test('an unchanged array is not rewritten', () => {
    const withHelpers = () => model({ musicHelpers: [{ id: 'p-1', name: 'Ann' }] });
    const update = changedFieldPaths(
        flattenServiceForSave(withHelpers()),
        flattenServiceForSave(withHelpers())
    );
    assert.deepStrictEqual(update, {});
});

test('a changed array is replaced whole', () => {
    const before = flattenServiceForSave(model({ musicHelpers: [{ id: 'p-1', name: 'Ann' }] }));
    const after = flattenServiceForSave(
        model({ musicHelpers: [{ id: 'p-1', name: 'Ann' }, { id: 'p-2', name: 'Joe' }] })
    );
    const update = changedFieldPaths(before, after);
    assert.strictEqual(update.musicHelpers.length, 2);
});

// ── Notes ──────────────────────────────────────────────────────────────────

test('one note writes its own path, leaving other notes alone', () => {
    const before = flattenServiceForSave(model({ notes: { hymn1: 'check the key' } }));
    const after = flattenServiceForSave(
        model({ notes: { hymn1: 'check the key', sermon: 'runs long' } })
    );

    const update = changedFieldPaths(before, after);
    assert.deepStrictEqual(update, { 'notes.sermon': 'runs long' });
});
