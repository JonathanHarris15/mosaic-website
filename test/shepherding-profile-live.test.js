// MS-490 — the Shepherding Profile, live.
//
// The profile used to read once. Now its notes, its Pastoral Record, the Care
// List cells about this person and the Tasks owed them all arrive as they
// change — on the web page and on the phone screen alike. What each of them
// does with an arrival is decided ONCE, here, by ShepherdingCore.combineProfile:
//
//   - the feed comes out newest first, notes and changes interleaved;
//   - a note somebody has open in the editor is left out of the feed, so the
//     editor is never drawn twice;
//   - and if the record under an open editor changes or disappears, the page is
//     TOLD — it is never quietly rewritten under somebody's hands.

const { test } = require('node:test');
const assert = require('node:assert');

const Core = require('../public/shepherding-core.js');

function at(ms) { return { toDate: () => new Date(ms), toMillis: () => ms }; }

const BOB = 'p-bob';

function note(id, ms, extra = {}) {
    return Object.assign({ id, type: 'Elder Check-in', subject: '', content: 'Hi', contentJson: null, createdAt: at(ms) }, extra);
}

function change(id, ms, extra = {}) {
    return Object.assign({ id, kind: 'status_change', createdAt: at(ms) }, extra);
}

function careList(id, cells, extra = {}) {
    return Object.assign({
        id,
        docType: 'care-list',
        careListColumns: [{ id: 'c1', name: 'Needs' }],
        careListData: cells,
        updatedAt: at(500),
        updatedByName: 'Ann',
    }, extra);
}

const TEXT = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Pray' }] }] };

// ── The feed ─────────────────────────────────────────────────────────────────

test('notes and changes arrive as one feed, newest first', () => {
    const out = Core.combineProfile({
        personId: BOB,
        personNotes: [note('n1', 100), note('n2', 300)],
        activity: [change('a1', 200)],
    });
    assert.deepStrictEqual(out.record.map(e => e.id), ['n2', 'a1', 'n1']);
});

test('a Care List cell about this person joins the feed as a note', () => {
    const out = Core.combineProfile({
        personId: BOB,
        personNotes: [note('n1', 100)],
        careListDocs: [careList('cl1', { [BOB]: { c1: TEXT }, 'p-other': { c1: TEXT } })],
    });
    const cell = out.notes.find(n => n.isCareList);
    assert.ok(cell, 'the cell is on the profile');
    assert.strictEqual(cell.subject, 'Needs');
    assert.strictEqual(cell.sourceDocumentId, 'cl1');
    assert.strictEqual(out.notes.filter(n => n.isCareList).length, 1, 'only cells about THIS person');
});

test('a cell left under a column that was removed is not on the profile (MS-430)', () => {
    const out = Core.combineProfile({
        personId: BOB,
        careListDocs: [careList('cl1', { [BOB]: { c1: TEXT, c_gone: TEXT } })],
    });
    assert.deepStrictEqual(out.notes.map(n => n.subject), ['Needs']);
});

test('a Care List from before columns shows its cell as Notes', () => {
    const out = Core.combineProfile({
        personId: BOB,
        careListDocs: [careList('cl1', { [BOB]: TEXT }, { careListColumns: undefined })],
    });
    assert.deepStrictEqual(out.notes.map(n => n.subject), ['Notes']);
});

test('an empty Care List cell is not a note', () => {
    const out = Core.combineProfile({
        personId: BOB,
        careListDocs: [careList('cl1', { [BOB]: { c1: { type: 'doc', content: [{ type: 'paragraph' }] } } })],
    });
    assert.strictEqual(out.notes.length, 0);
});

test('a note open in the editor is left out of the feed, so it is not drawn twice', () => {
    const out = Core.combineProfile({
        personId: BOB,
        personNotes: [note('n1', 100), note('n2', 200)],
        editor: { kind: 'note', openedWith: note('n1', 100) },
    });
    assert.deepStrictEqual(out.record.map(e => e.id), ['n2']);
});

// ── The record under an open editor ──────────────────────────────────────────

test('an open note nobody else touched is reported unchanged', () => {
    const opened = note('n1', 100, { content: 'Hi' });
    const out = Core.combineProfile({
        personId: BOB,
        personNotes: [note('n1', 100, { content: 'Hi' })],
        editor: { kind: 'note', openedWith: opened },
    });
    assert.strictEqual(out.editor.state, 'unchanged');
});

test('an open note somebody else saved is reported changed, and by whom', () => {
    const opened = note('n1', 100, { content: 'Hi' });
    const out = Core.combineProfile({
        personId: BOB,
        personNotes: [note('n1', 100, { content: 'Hi — and his mother is unwell', updatedByName: 'Sam Jones' })],
        editor: { kind: 'note', openedWith: opened },
    });
    assert.strictEqual(out.editor.state, 'changed');
    assert.strictEqual(out.editor.by, 'Sam Jones');
});

test('an open note somebody else deleted is reported deleted', () => {
    const out = Core.combineProfile({
        personId: BOB,
        personNotes: [note('n2', 200)],
        editor: { kind: 'note', openedWith: note('n1', 100) },
    });
    assert.strictEqual(out.editor.state, 'deleted');
});

test('a new note being written has nothing under it to change', () => {
    const out = Core.combineProfile({
        personId: BOB,
        personNotes: [note('n1', 100)],
        editor: { kind: 'note', openedWith: null },
    });
    assert.strictEqual(out.editor.state, 'unchanged');
});

test('the open draft is never touched — the report is all that comes back', () => {
    const opened = note('n1', 100, { content: 'Hi' });
    const draft = JSON.stringify(opened);
    Core.combineProfile({
        personId: BOB,
        personNotes: [note('n1', 100, { content: 'Changed elsewhere' })],
        editor: { kind: 'note', openedWith: opened },
    });
    assert.strictEqual(JSON.stringify(opened), draft);
});

test('the person\'s details are compared field by field', () => {
    const opened = { id: BOB, name: 'Bob', contact: { email: 'b@x', phone: '1' }, birthday: null, sex: 'male', tags: ['a'] };
    const tagged = Object.assign({}, opened, { tags: ['a', 'b'] });
    assert.strictEqual(Core.openRecordState('details', opened, tagged).state, 'unchanged',
        'a tag added by somebody else is not a change to the details being edited');

    const moved = Object.assign({}, opened, { contact: { email: 'b@x', phone: '2' }, updatedByName: 'Ann' });
    const state = Core.openRecordState('details', opened, moved);
    assert.strictEqual(state.state, 'changed');
    assert.strictEqual(state.by, 'Ann');

    assert.strictEqual(Core.openRecordState('details', opened, null).state, 'deleted');
});

test('a Task is compared on what its editor edits', () => {
    const opened = { id: 't1', dueDate: '2026-09-20', title: 'Visit', body: '', assigneeIds: ['e1'], state: 'open' };
    const overdue = Object.assign({}, opened, { state: 'overdue' });
    assert.strictEqual(Core.openRecordState('task', opened, overdue).state, 'unchanged',
        'the clock moving a Task to overdue is not somebody editing it');

    const renamed = Object.assign({}, opened, { title: 'Visit in hospital' });
    assert.strictEqual(Core.openRecordState('task', opened, renamed).state, 'changed');
    const ticked = Object.assign({}, opened, { state: 'done', completedOn: '2026-09-19' });
    assert.strictEqual(Core.openRecordState('task', opened, ticked).state, 'changed');
});

// ── One answer for an open editor, and one way of saying it (MS-491) ─────────

test('somebody else holding the box outranks what happened to the record', () => {
    const opened = note('n1', 100, { content: 'Hi' });
    const state = Core.editorState({
        kind: 'note', openedWith: opened, current: null,
        holder: { name: 'Sam Jones' },
    });
    assert.deepStrictEqual(state, { state: 'taken', by: 'Sam Jones' });
});

test('a box the store says was taken reads as taken even before its holder arrives', () => {
    const opened = note('n1', 100);
    assert.strictEqual(Core.editorState({ kind: 'note', openedWith: opened, current: opened, lost: true }).state, 'taken');
});

test('with nobody in the box, the editor reports what happened to the record', () => {
    const opened = note('n1', 100, { content: 'Hi' });
    assert.strictEqual(Core.editorState({ kind: 'note', openedWith: opened, current: opened }).state, 'unchanged');
    assert.strictEqual(Core.editorState({ kind: 'note', openedWith: opened, current: null }).state, 'deleted');
});

test('the warning names who, keeps the text, and says nothing when there is nothing to say', () => {
    assert.strictEqual(Core.editorWarning({ state: 'unchanged' }, 'note'), '');
    const taken = Core.editorWarning({ state: 'taken', by: 'Sam Jones' }, 'note');
    assert.match(taken, /^Sam Jones is editing this note now\./);
    assert.match(taken, /still here/);
    assert.match(Core.editorWarning({ state: 'changed', by: '' }, 'task'), /^Somebody changed this task/);
    assert.match(Core.editorWarning({ state: 'deleted' }, "person's details"), /was deleted/);
});

test('an editor nobody has defined is a mistake, not a note', () => {
    assert.throws(() => Core.openRecordState('document', { id: 'd1' }, { id: 'd1' }));
});
