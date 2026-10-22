// MS-435 — the Care List rules web, phone and the assistant all share.
//
// A Care List used to save by writing every cell back at once, so two elders in
// two different cells overwrote each other, and the web page wiped the cells of
// anybody who had dropped out of the list's filter. Now:
//
//   - each cell lives in its own field, and a save writes only the cells this
//     editor was typed into;
//   - a change somebody else made arrives, unless this editor has an unsaved
//     change to that very cell;
//   - columns change one change at a time, against the latest list.

const { test } = require('node:test');
const assert = require('node:assert');

const Core = require('../public/care-list-core.js');

const DOC = 'doc-1';
const BOB = 'p-bob';
const SUE = 'p-sue';

function body(text) {
    return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] };
}

function list(extra = {}) {
    return Object.assign({
        title: 'Visits',
        careListColumns: [{ id: 'col_1', name: 'Needs' }, { id: 'col_2', name: 'Last visit' }],
        careListData: {
            [BOB]: { col_1: body('Meals'), col_2: body('May') },
            [SUE]: { col_1: body('Rides') },
        },
    }, extra);
}

// ── Where a cell lives, and what a box is called ─────────────────────────────

test('a cell is addressed person, then column, as separate segments', () => {
    assert.deepStrictEqual(Core.cellPath('a.b', 'col_1'), ['careListData', 'a.b', 'col_1'],
        'a dot in an id stays inside its segment instead of splitting the path');
});

test('a cell box and the title box name the same thing wherever they are worked out', () => {
    assert.deepStrictEqual(Core.box.cell(DOC, BOB, 'col_1'), Core.box.cell(DOC, BOB, 'col_1'));
    assert.notDeepStrictEqual(Core.box.cell(DOC, BOB, 'col_1'), Core.box.cell(DOC, BOB, 'col_2'));
    assert.notDeepStrictEqual(Core.box.cell(DOC, BOB, 'col_1'), Core.box.title(DOC));
    assert.strictEqual(Core.box.cell(DOC, BOB, 'col_1').scopeKey, Core.box.title(DOC).scopeKey,
        'one Care List is one scope');
});

// ── The save set ─────────────────────────────────────────────────────────────

test('opening a list and not typing saves nothing', () => {
    const s = Core.createSession(list());
    const save = s.takeSave(() => body('anything'), () => 'Visits');
    assert.deepStrictEqual(save.cells, []);
    assert.strictEqual(save.title, null);
});

test('the save holds exactly the cells this editor was typed into', () => {
    const s = Core.createSession(list());
    s.edited(BOB, 'col_2');
    const save = s.takeSave((pid, cid) => body(pid + ' ' + cid), () => 'Visits');
    assert.deepStrictEqual(save.cells, [{ personId: BOB, columnId: 'col_2', value: body(BOB + ' col_2') }]);
    assert.strictEqual(save.title, null);
    assert.deepStrictEqual(s.takeSave(() => body('x'), () => 'Visits').cells, [], 'a saved cell is clean again');
});

test('the title saves on its own, and only when it was typed into', () => {
    const s = Core.createSession(list());
    s.titleEdited();
    const save = s.takeSave(() => null, () => 'Home visits');
    assert.deepStrictEqual(save.cells, []);
    assert.strictEqual(save.title, 'Home visits');
});

test('a cell of somebody outside the filter is never in a save', () => {
    // The old web save rebuilt the whole map from the rows on screen. Now
    // nothing outside the save set is written, so there is nothing to wipe.
    const s = Core.createSession(list());
    s.edited(BOB, 'col_1');
    const save = s.takeSave(() => body('Meals twice a week'), () => 'Visits');
    assert.ok(save.cells.every(c => c.personId !== SUE));
});

test('two editors in different cells write no field path in common', () => {
    const a = Core.createSession(list());
    const b = Core.createSession(list());
    a.edited(BOB, 'col_1');
    b.edited(SUE, 'col_1');
    const pathsA = a.takeSave(() => body('a'), () => '').cells.map(c => Core.cellPath(c.personId, c.columnId).join('\u0000'));
    const pathsB = b.takeSave(() => body('b'), () => '').cells.map(c => Core.cellPath(c.personId, c.columnId).join('\u0000'));
    assert.strictEqual(pathsA.filter(p => pathsB.includes(p)).length, 0);
});

test('a save that failed puts its cells back in the next one', () => {
    const s = Core.createSession(list());
    s.edited(BOB, 'col_1');
    s.titleEdited();
    const save = s.takeSave(() => body('Meals'), () => 'Home visits');
    s.saveFailed(save);
    const again = s.takeSave(() => body('Meals'), () => 'Home visits');
    assert.deepStrictEqual(again.cells.map(c => c.personId), [BOB]);
    assert.strictEqual(again.title, 'Home visits');
});

test('a cell in a column that has since been removed is not saved back into being', () => {
    const s = Core.createSession(list());
    s.edited(BOB, 'col_2');
    s.adopt(list({ careListColumns: [{ id: 'col_1', name: 'Needs' }] }), {});
    assert.deepStrictEqual(s.takeSave(() => body('June'), () => 'Visits').cells, []);
});

// ── Adopting somebody else's change ──────────────────────────────────────────

test('a cell somebody else changed arrives', () => {
    const s = Core.createSession(list());
    const remote = list();
    remote.careListData[SUE].col_1 = body('Rides on Sunday');
    const out = s.adopt(remote, {});
    assert.deepStrictEqual(out.cells, [{ personId: SUE, columnId: 'col_1', value: body('Rides on Sunday') }]);
});

test('an adopted cell is not dirty, and moves the saved copy so it is not written back', () => {
    const s = Core.createSession(list());
    const remote = list();
    remote.careListData[SUE].col_1 = body('Rides on Sunday');
    s.adopt(remote, {});
    assert.strictEqual(s.isDirty(SUE, 'col_1'), false);
    assert.deepStrictEqual(s.cell(SUE, 'col_1'), body('Rides on Sunday'));
    assert.deepStrictEqual(s.takeSave(() => body('x'), () => 'Visits').cells, []);
    assert.deepStrictEqual(s.adopt(remote, {}).cells, [], 'the same arrival twice is nothing new');
});

test('a cell with an unsaved change of this editor is not adopted', () => {
    const s = Core.createSession(list());
    s.edited(SUE, 'col_1');
    const remote = list();
    remote.careListData[SUE].col_1 = body('Theirs');
    assert.deepStrictEqual(s.adopt(remote, {}).cells, []);
    assert.strictEqual(s.isDirty(SUE, 'col_1'), true);
});

test('a cell a new person arrives with, or a cell cleared, arrives too', () => {
    const s = Core.createSession(list());
    const remote = list();
    remote.careListData['p-new'] = { col_1: body('Welcome') };
    delete remote.careListData[BOB].col_2;
    const out = s.adopt(remote, {});
    assert.deepStrictEqual(out.cells.map(c => [c.personId, c.columnId, c.value]).sort(), [
        ['p-bob', 'col_2', null],
        ['p-new', 'col_1', body('Welcome')],
    ]);
});

test('the cell under this editor\'s cursor waits until they leave it', () => {
    const s = Core.createSession(list());
    const remote = list();
    remote.careListData[BOB].col_1 = body('Meals — from the assistant');
    const out = s.adopt(remote, { inCell: { personId: BOB, columnId: 'col_1' } });
    assert.deepStrictEqual(out.cells, []);
    assert.deepStrictEqual(s.catchUpCell(BOB, 'col_1'), { value: body('Meals — from the assistant') });
    assert.strictEqual(s.catchUpCell(BOB, 'col_1'), null, 'and only once');
});

test('catching up after your own save never puts the older text back', () => {
    // Leaving a cell waits for its save, then catches up — before the list
    // has come back with that save in it.
    const s = Core.createSession(list());
    s.edited(BOB, 'col_1');
    s.takeSave(() => body('Meals twice a week'), () => '');
    assert.strictEqual(s.catchUpCell(BOB, 'col_1'), null);
    s.titleEdited();
    s.takeSave(() => null, () => 'Home visits');
    assert.strictEqual(s.catchUpTitle(), null);
});

test('a failed save puts the stored copy back, so discarding shows what is stored', () => {
    const s = Core.createSession(list());
    s.edited(SUE, 'col_1');
    s.titleEdited();
    const save = s.takeSave(() => body('Unsaved'), () => 'Unsaved title');
    s.saveFailed(save);
    assert.deepStrictEqual(s.cell(SUE, 'col_1'), body('Rides'));
    assert.strictEqual(s.title(), 'Visits');
    assert.deepStrictEqual(s.discard(SUE, 'col_1'), body('Rides'));
});

test('entering a cell catches up on what arrived while somebody else had it', () => {
    const s = Core.createSession(list());
    const remote = list();
    remote.careListData[SUE].col_1 = body('Rides — from Ann');
    s.adopt(remote, { inCell: { personId: SUE, columnId: 'col_1' } });
    assert.deepStrictEqual(s.catchUpCell(SUE, 'col_1'), { value: body('Rides — from Ann') });
});

test('leaving a cell you typed in keeps your text', () => {
    const s = Core.createSession(list());
    s.edited(BOB, 'col_1');
    const remote = list();
    remote.careListData[BOB].col_1 = body('Theirs');
    s.adopt(remote, { inCell: { personId: BOB, columnId: 'col_1' } });
    assert.strictEqual(s.catchUpCell(BOB, 'col_1'), null);
});

test('key order inside a stored cell is not a change', () => {
    const s = Core.createSession(list());
    const remote = list();
    remote.careListData[BOB].col_1 = { content: [{ content: [{ text: 'Meals', type: 'text' }], type: 'paragraph' }], type: 'doc' };
    assert.deepStrictEqual(s.adopt(remote, {}).cells, []);
});

test('the title arrives unless this editor is renaming it', () => {
    const s = Core.createSession(list());
    assert.strictEqual(s.adopt(list({ title: 'Home visits' }), {}).title, 'Home visits');
    assert.strictEqual(s.title(), 'Home visits');

    assert.strictEqual(s.adopt(list({ title: 'Hospital' }), { inTitle: true }).title, null);
    assert.strictEqual(s.catchUpTitle(), 'Hospital');

    s.titleEdited();
    assert.strictEqual(s.adopt(list({ title: 'Other' }), {}).title, null);
});

test('columns always arrive, saying which were added and which went', () => {
    const s = Core.createSession(list());
    const out = s.adopt(list({
        careListColumns: [{ id: 'col_1', name: 'What they need' }, { id: 'col_3', name: 'Prayer' }],
    }), {});
    assert.deepStrictEqual(out.columns.map(c => c.id), ['col_1', 'col_3']);
    assert.deepStrictEqual(out.addedColumns, ['col_3']);
    assert.deepStrictEqual(out.removedColumns, ['col_2']);
    assert.deepStrictEqual(s.columns().map(c => c.name), ['What they need', 'Prayer']);
    assert.strictEqual(s.adopt(list({
        careListColumns: [{ id: 'col_1', name: 'What they need' }, { id: 'col_3', name: 'Prayer' }],
    }), {}).columns, null, 'the same columns again are no change');
});

test('a cell typed into a column this editor just added is saved before the list comes back', () => {
    const s = Core.createSession(list());
    const out = s.columnsChanged(list().careListColumns.concat([{ id: 'col_3', name: 'Prayer' }]));
    assert.deepStrictEqual(out.addedColumns, ['col_3']);
    s.edited(BOB, 'col_3');
    assert.deepStrictEqual(s.takeSave(() => body('Pray for work'), () => '').cells.map(c => c.columnId), ['col_3']);
    assert.strictEqual(s.adopt(list({ careListColumns: s.columns() }), {}).columns, null,
        'the list arriving back is no news');
});

test('a cell somebody took is given back unsaved, showing what was stored', () => {
    const s = Core.createSession(list());
    s.edited(SUE, 'col_1');
    assert.deepStrictEqual(s.discard(SUE, 'col_1'), body('Rides'));
    assert.strictEqual(s.isDirty(SUE, 'col_1'), false);
    assert.deepStrictEqual(s.takeSave(() => body('stray keystroke'), () => '').cells, []);
});

// ── Column changes ───────────────────────────────────────────────────────────

test('a column is added to the latest list, not to the one this page loaded', () => {
    const latest = list({ careListColumns: [{ id: 'col_1', name: 'Needs' }, { id: 'col_2', name: 'Renamed by Ann' }] });
    const out = Core.applyColumnChange(latest, { kind: 'add', name: 'Prayer' });
    assert.deepStrictEqual(out.columns.map(c => c.name), ['Needs', 'Renamed by Ann', 'Prayer']);
    assert.strictEqual(out.column.name, 'Prayer');
});

test('a rename touches one column of the latest list', () => {
    const latest = list({ careListColumns: [{ id: 'col_1', name: 'Needs' }, { id: 'col_2', name: 'Last visit' }, { id: 'col_3', name: 'Added by Ann' }] });
    const out = Core.applyColumnChange(latest, { kind: 'rename', columnId: 'col_2', name: 'Visited' });
    assert.deepStrictEqual(out.columns.map(c => c.name), ['Needs', 'Visited', 'Added by Ann']);
});

test('removing a column drops its cells for every person', () => {
    const out = Core.applyColumnChange(list(), { kind: 'remove', columnId: 'col_1' });
    assert.deepStrictEqual(out.columns.map(c => c.id), ['col_2']);
    assert.deepStrictEqual(out.clearCells.sort((a, b) => a.personId.localeCompare(b.personId)), [
        { personId: BOB, columnId: 'col_1' },
        { personId: SUE, columnId: 'col_1' },
    ]);
});

test('the last column cannot be removed', () => {
    assert.throws(() => Core.applyColumnChange(list({ careListColumns: [{ id: 'col_1', name: 'Needs' }] }),
        { kind: 'remove', columnId: 'col_1' }), /last column/);
});

test('a column somebody else already removed is not renamed back into being', () => {
    const out = Core.applyColumnChange(list(), { kind: 'rename', columnId: 'col_9', name: 'Ghost' });
    assert.deepStrictEqual(out.columns.map(c => c.id), ['col_1', 'col_2']);
    assert.strictEqual(out.changed, false);
});

test('a new column never takes an id that still has cells stored under it', () => {
    const leftovers = list({
        careListColumns: [{ id: 'col_1', name: 'Needs' }],
        careListData: { [BOB]: { col_1: body('a'), col_2: body('left behind') } },
    });
    const out = Core.applyColumnChange(leftovers, { kind: 'add', name: 'New' });
    assert.notStrictEqual(out.column.id, 'col_1');
    assert.notStrictEqual(out.column.id, 'col_2');
});

test('who holds a cell in a column is found among the claims', () => {
    const claims = {
        'x|y': { name: 'Nobody relevant', scopeKey: 'x', boxKey: 'y' },
        held: Object.assign({ name: 'Ann Lee' }, Core.box.cell(DOC, SUE, 'col_2')),
    };
    assert.strictEqual(Core.columnHolder(claims, DOC, 'col_2').name, 'Ann Lee');
    assert.strictEqual(Core.columnHolder(claims, DOC, 'col_1'), null);
    assert.strictEqual(Core.columnHolder(claims, 'other-doc', 'col_2'), null);
});

// ── The old shape ────────────────────────────────────────────────────────────

test('a Care List from before columns becomes one Notes column, with nothing lost', () => {
    const old = { title: 'Old', careListData: { [BOB]: body('Meals'), [SUE]: body('Rides') } };
    assert.strictEqual(Core.isOldShape(old), true);
    const out = Core.normalise(old);
    assert.deepStrictEqual(out.careListColumns, [{ id: 'col_default', name: 'Notes' }]);
    assert.deepStrictEqual(out.careListData, { [BOB]: { col_default: body('Meals') }, [SUE]: { col_default: body('Rides') } });
    assert.strictEqual(Core.isOldShape(Object.assign({}, old, out)), false);
    assert.strictEqual(Core.isOldShape(list()), false);
});

test('a normalised list opens in a session with its cells where the editors look', () => {
    const shaped = Core.normalise({ title: 'Old', careListData: { [BOB]: body('Meals') } });
    const s = Core.createSession(Object.assign({ title: 'Old' }, shaped));
    assert.deepStrictEqual(s.columns(), [{ id: 'col_default', name: 'Notes' }]);
    assert.deepStrictEqual(s.cell(BOB, 'col_default'), body('Meals'));
});
