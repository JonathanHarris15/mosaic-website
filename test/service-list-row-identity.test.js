// MS-277 — a row of a list belongs to its entry, not to its position.
//
// Music Helpers, Baptism Candidates and the irregular elements are LISTS, and
// each row of one mounts its own people-picker. A picker takes the entry OBJECT
// once, when its row is first drawn, and mutates that object from then on.
//
// Alpine reuses a row whose `:key` has not changed — it refreshes the loop
// variable and leaves the row's x-data alone. So a list keyed by POSITION hands
// row 0 the second helper's data while row 0's picker is still wired to the
// first helper's object:
//
//   Helpers are [Ann, Ben]. Take Ann out. The row still reads "Ann" — its
//   query is watched off the object it is holding — while the document says
//   "Ben". Type a new name into it and the name goes into an object that is no
//   longer on the model. Saved nowhere, and nothing on screen says so.
//
// That is the "music assignments get switched around" report. Two things fix
// it, and both are pinned here:
//
//   1. `_rowId` — a handle minted per entry, so the x-for keys by the helper
//      rather than by the slot the helper is in.
//   2. The lists are brought in line IN PLACE when another editor's change
//      arrives, the way the liturgy slots always have been, so the objects the
//      pickers hold stay on the model.
//
// And `_rowId` is screen state, not part of the Sunday: it must never reach the
// document, and must never make an untouched Sunday look edited.

const { test } = require('node:test');
const assert = require('node:assert');

const {
    ROW_ID,
    newRowId,
    withRowIds,
    stampRowIds,
    reconcilePersonList,
    serviceSnapshot,
    flattenServiceForSave,
    changedFieldPaths,
    applyFlatFieldPath,
} = require('../public/service-builder.js');

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
            hymn1: { id: null, name: '' },
            baptism: [],
        },
    };
    return Object.assign(base, overrides);
}

// ── A row is keyed by its entry ────────────────────────────────────────────

test('every helper read out of the document gets its own row handle', () => {
    const helpers = withRowIds([{ id: 'p-1', name: 'Ann' }, { id: 'p-2', name: 'Ben' }]);

    assert.strictEqual(helpers.length, 2);
    assert.ok(helpers[0][ROW_ID], 'a helper with no row handle has nothing to key a row by');
    assert.notStrictEqual(helpers[0][ROW_ID], helpers[1][ROW_ID],
        'two helpers sharing a row handle share a row');
});

test('a row handle is never handed out twice', () => {
    const seen = new Set([newRowId(), newRowId(), newRowId()]);
    assert.strictEqual(seen.size, 3);
});

test('taking a helper out leaves the others on the rows they were already on', () => {
    // The property the whole bug turns on. Keyed by position, removing Ann
    // moved Ben onto Ann's row while that row's picker still held Ann.
    const helpers = withRowIds([{ id: 'p-1', name: 'Ann' }, { id: 'p-2', name: 'Ben' }]);
    const bensRow = helpers[1][ROW_ID];
    const bensObject = helpers[1];

    helpers.splice(0, 1); // removeMusicHelper(0)

    assert.strictEqual(helpers.length, 1);
    assert.strictEqual(helpers[0], bensObject, 'Ben is not the object he was');
    assert.strictEqual(helpers[0][ROW_ID], bensRow,
        'Ben moved to a different row, so his picker is left holding Ann');
});

test('a dragged element keeps its row, so its picker follows it', () => {
    // The irregular elements are reorderable, which is the same bug with a
    // handle on it: keyed by position, a drag re-pointed every picker on screen.
    const elements = stampRowIds([
        { key: 'Sermon', type: 'text', value: 'John 1' },
        { key: 'Offering', type: 'text', value: '' },
    ]);
    const sermonRow = elements[0][ROW_ID];

    const moved = elements.splice(0, 1)[0]; // initSortable's onEnd
    elements.splice(1, 0, moved);

    assert.strictEqual(elements[1][ROW_ID], sermonRow, 'the sermon changed rows on a drag');
});

// ── Another editor's change does not orphan a picker ───────────────────────

test("a helper who is still there keeps the object his picker is holding", () => {
    // The liturgy slots have always been mutated in place for this reason —
    // see applyFlatFieldPath, "Preserve reference for components like
    // hymnPicker". The helper list was replaced wholesale instead, so every
    // helper box on screen was left editing an object off the model.
    const m = model({ musicHelpers: withRowIds([{ id: 'p-1', name: 'Ann' }]) });
    const annsObject = m.musicHelpers[0];
    const annsRow = annsObject[ROW_ID];

    applyFlatFieldPath(m, 'musicHelpers', [
        { id: 'p-1', name: 'Ann' },
        { id: 'p-2', name: 'Ben' },
    ]);

    assert.strictEqual(m.musicHelpers[0], annsObject, "Ann's picker is holding a dead object");
    assert.strictEqual(m.musicHelpers[0][ROW_ID], annsRow, 'Ann was moved to a new row');
    assert.strictEqual(m.musicHelpers[1].name, 'Ben');
    assert.ok(m.musicHelpers[1][ROW_ID], 'the new helper has no row to be drawn on');
});

test('what a picker types after a remote change lands on the model', () => {
    // The failure the report describes, end to end: another editor changes the
    // helpers, then you pick somebody in a box that was already on screen.
    const m = model({ musicHelpers: withRowIds([{ id: 'p-1', name: 'Ann' }]) });
    const pickerHolds = m.musicHelpers[0];

    applyFlatFieldPath(m, 'musicHelpers', [{ id: 'p-1', name: 'Ann' }, { id: 'p-2', name: 'Ben' }]);

    // personPicker.select(): it mutates the object it took at init.
    pickerHolds.id = 'p-9';
    pickerHolds.name = 'Nina';

    assert.deepStrictEqual(
        m.musicHelpers.map(h => h.name), ['Nina', 'Ben'],
        'the name went into an object that is no longer on the model');
});

test('a helper who has gone takes his row with him', () => {
    const m = model({
        musicHelpers: withRowIds([{ id: 'p-1', name: 'Ann' }, { id: 'p-2', name: 'Ben' }]),
    });
    const bensObject = m.musicHelpers[1];

    applyFlatFieldPath(m, 'musicHelpers', [{ id: 'p-2', name: 'Ben' }]);

    assert.strictEqual(m.musicHelpers.length, 1);
    assert.strictEqual(m.musicHelpers[0], bensObject, 'Ben was rebuilt rather than kept');
});

test('the helper list itself is the same array, so the rows still see it', () => {
    const m = model({ musicHelpers: withRowIds([{ id: 'p-1', name: 'Ann' }]) });
    const boundList = m.musicHelpers;

    applyFlatFieldPath(m, 'musicHelpers', [{ id: 'p-2', name: 'Ben' }]);

    assert.strictEqual(m.musicHelpers, boundList, 'x-for is left iterating a list off the model');
});

test('Baptism Candidates are brought in line the same way', () => {
    const m = model();
    m.liturgy.baptism = withRowIds([{ id: 'p-1', name: 'Kid One' }]);
    const kidsObject = m.liturgy.baptism[0];

    applyFlatFieldPath(m, 'liturgy.baptism', [
        { id: 'p-1', name: 'Kid One' },
        { id: 'p-2', name: 'Kid Two' },
    ]);

    assert.strictEqual(m.liturgy.baptism[0], kidsObject);
    assert.strictEqual(m.liturgy.baptism.length, 2);
});

test('an unlinked half-typed entry is matched in the order it was left in', () => {
    // No Person id to match on, so position is the only order these have.
    const list = withRowIds([{ id: null, name: 'Jo' }]);
    const first = list[0];

    reconcilePersonList(list, [{ id: null, name: 'Jonathan' }]);

    assert.strictEqual(list[0], first, 'the half-typed row was thrown away mid-type');
    assert.strictEqual(list[0].name, 'Jonathan');
});

test('the adoption path mints the same row handles on both copies', () => {
    // adoptRemoteChanges applies every path to BOTH the live model and the
    // loaded snapshot. Handles minted from a counter would differ between the
    // two, and a Sunday nobody edited would read as unsaved forever.
    const live = model();
    const snapshot = model();
    const incoming = [{ id: 'p-1', name: 'Ann' }, { id: null, name: '' }];

    applyFlatFieldPath(live, 'musicHelpers', incoming);
    applyFlatFieldPath(snapshot, 'musicHelpers', incoming);

    assert.deepStrictEqual(
        live.musicHelpers.map(h => h[ROW_ID]),
        snapshot.musicHelpers.map(h => h[ROW_ID]));
});

// ── A row handle is not part of the Sunday ─────────────────────────────────

test('no row handle ever reaches the document', () => {
    const m = model({
        musicHelpers: withRowIds([{ id: 'p-1', name: 'Ann' }]),
        irregularElements: stampRowIds([{ key: 'Sermon', type: 'text', value: 'John 1' }]),
    });
    m.liturgy.baptism = withRowIds([{ id: 'p-2', name: 'Kid One' }]);

    const flat = flattenServiceForSave(m);

    assert.ok(!JSON.stringify(flat).includes(ROW_ID),
        'a screen handle is being written into the Sunday');
});

test('re-keying a row is not a change, so it never writes a Sunday', () => {
    // isDirty compares these two strings. If a handle counted, opening a
    // Sunday would mark it unsaved and the 3s autosave would write it.
    const loaded = model({ musicHelpers: withRowIds([{ id: 'p-1', name: 'Ann' }]) });
    const reopened = model({ musicHelpers: withRowIds([{ id: 'p-1', name: 'Ann' }]) });

    assert.notStrictEqual(loaded.musicHelpers[0][ROW_ID], reopened.musicHelpers[0][ROW_ID],
        'the two copies happen to share handles, so this proves nothing');
    assert.strictEqual(serviceSnapshot(loaded), serviceSnapshot(reopened));
});

test('a Sunday whose rows were re-keyed produces no field update', () => {
    const before = flattenServiceForSave(
        model({ musicHelpers: withRowIds([{ id: 'p-1', name: 'Ann' }]) }));
    const after = flattenServiceForSave(
        model({ musicHelpers: withRowIds([{ id: 'p-1', name: 'Ann' }]) }));

    assert.deepStrictEqual(changedFieldPaths(before, after), {});
});

test('an actual change to the helpers still writes the helpers', () => {
    // The diff must not have been blunted by any of the above.
    const before = flattenServiceForSave(
        model({ musicHelpers: withRowIds([{ id: 'p-1', name: 'Ann' }]) }));
    const after = flattenServiceForSave(model({
        musicHelpers: withRowIds([{ id: 'p-1', name: 'Ann' }, { id: 'p-2', name: 'Ben' }]),
    }));

    const update = changedFieldPaths(before, after);
    assert.deepStrictEqual(update.musicHelpers, [
        { name: 'Ann', id: 'p-1' },
        { name: 'Ben', id: 'p-2' },
    ]);
});
