// MS-501 / MS-505 / MS-506 — an Elder Document open in an editor, live.
//
// Run against real ProseMirror and TipTap's schema when build/tiptap has its
// packages installed (`npm run vendor:tiptap`); skipped otherwise, since the
// vendored bundle needs a browser. What these pin is the editor half of the
// Blocks rules — which box a change touches, that a change to somebody else's
// box is dropped and a free one is claimed, that saving writes only changed
// blocks at their own paths, and that blocks arriving from somebody else go in
// without touching what this editor has not saved.
//
// Wiring (both pages use the layer, both register the lock) runs everywhere.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, 'public', f), 'utf8');

const TIPTAP = path.join(ROOT, 'build', 'tiptap', 'node_modules');
let T = null;
try {
    T = {
        core: require(path.join(TIPTAP, '@tiptap', 'core')),
        state: require(path.join(TIPTAP, 'prosemirror-state')),
        StarterKit: require(path.join(TIPTAP, '@tiptap', 'starter-kit')).default,
        Table: require(path.join(TIPTAP, '@tiptap', 'extension-table')).default,
        TableRow: require(path.join(TIPTAP, '@tiptap', 'extension-table-row')).default,
        TableCell: require(path.join(TIPTAP, '@tiptap', 'extension-table-cell')).default,
        TableHeader: require(path.join(TIPTAP, '@tiptap', 'extension-table-header')).default,
    };
} catch (e) {
    T = null;
}
const skip = T ? false : 'build/tiptap is not installed — run npm run vendor:tiptap';

const Body = require('../public/document-body-core.js');
globalThis.DocumentBodyCore = Body;
const { BlockIdExtension } = require('../public/block-id-extension.js');
const { ElderDocumentLive } = require('../public/elder-document-live.js');

const DOC = 'doc1';

// A presence store with somebody else in some boxes.
function presenceWith(heldBy) {
    const claims = [];
    const p = {
        box: { note: (pid, nid) => ({ scopeKey: 'person:' + pid, boxKey: 'note:' + nid }) },
        holder: (scopeKey, boxKey) => heldBy[scopeKey + '|' + boxKey] || null,
        claimBox: (box) => { if (p.holder(box.scopeKey, box.boxKey)) return false; claims.push(box.boxKey); return true; },
        touch: () => true,
        release: () => claims.push('released'),
        subscribe: () => () => {},
        claims,
    };
    return p;
}

function schema() {
    const PersonPanel = T.core.Node.create({
        name: 'personPanel', group: 'block', atom: true,
        addAttributes() { return { personId: { default: '' }, noteId: { default: '' }, personName: { default: '' }, noteType: { default: '' }, bodySnapshot: { default: null } }; },
        parseHTML() { return [{ tag: 'div[data-person-panel]' }]; },
        renderHTML() { return ['div', { 'data-person-panel': '' }]; },
    });
    const lib = { Extension: T.core.Extension, Plugin: T.state.Plugin, PluginKey: T.state.PluginKey };
    return T.core.getSchema([T.StarterKit, T.Table, T.TableRow, T.TableCell, T.TableHeader, PersonPanel, BlockIdExtension.create(lib)]);
}

const text = (t) => ({ type: 'text', text: t });
const body = () => ({
    type: 'doc', content: [
        { type: 'heading', attrs: { level: 2, blockId: 'h1' }, content: [text('Minutes')] },
        { type: 'paragraph', attrs: { blockId: 'p1' }, content: [text('Opened in prayer.')] },
        { type: 'bulletList', attrs: { blockId: 'ul' }, content: [
            { type: 'listItem', attrs: { blockId: 'li1' }, content: [
                { type: 'paragraph', attrs: { blockId: 'lp1' }, content: [text('Visits')] },
                { type: 'bulletList', attrs: { blockId: 'ul2' }, content: [
                    { type: 'listItem', attrs: { blockId: 'li2' }, content: [{ type: 'paragraph', attrs: { blockId: 'lp2' }, content: [text('Smiths')] }] },
                ] },
            ] },
        ] },
        { type: 'table', attrs: { blockId: 't' }, content: [{ type: 'tableRow', attrs: { blockId: 'r' }, content: [
            { type: 'tableCell', attrs: { blockId: 'c1' }, content: [{ type: 'paragraph', attrs: { blockId: 'cp1' }, content: [text('Bob')] }] },
        ] }] },
        { type: 'personPanel', attrs: { blockId: 'pp', personId: 'p9', noteId: 'n9', personName: 'Sue', noteType: 'Elder Meeting' } },
        { type: 'paragraph', attrs: { blockId: 'p2' }, content: [text('Closed.')] },
    ],
});

// The position just inside the text block with this id.
function inside(doc, blockId) {
    let at = null;
    doc.descendants((node, pos) => {
        if (at === null && node.attrs && node.attrs.blockId === blockId) at = pos + 1;
        return at === null;
    });
    return at;
}

function stateFor(sch, plugins) {
    return T.state.EditorState.create({ schema: sch, doc: sch.nodeFromJSON(body()), plugins: plugins || [] });
}

// ── Which box a change touches ───────────────────────────────────────────────

test('typing in a paragraph touches that paragraph; in a list item, the item; in a cell, the cell', { skip }, () => {
    const sch = schema();
    const s = stateFor(sch);
    const boxes = (tr) => ElderDocumentLive.boxesTouched(tr, DOC).map(b => b.boxKey).sort();
    assert.deepStrictEqual(boxes(s.tr.insertText('x', inside(s.doc, 'p1'))), ['block:p1']);
    assert.deepStrictEqual(boxes(s.tr.insertText('x', inside(s.doc, 'lp1'))), ['block:li1']);
    assert.deepStrictEqual(boxes(s.tr.insertText('x', inside(s.doc, 'lp2'))), ['block:li2'],
        'a nested item is its own box, not its parent item');
    assert.deepStrictEqual(boxes(s.tr.insertText('x', inside(s.doc, 'cp1'))), ['block:c1']);
});

test('a selection-wide delete touches every box in its range', { skip }, () => {
    const s = stateFor(schema());
    const tr = s.tr.delete(inside(s.doc, 'p1'), inside(s.doc, 'cp1') + 1);
    const keys = ElderDocumentLive.boxesTouched(tr, DOC).map(b => b.boxKey).sort();
    assert.deepStrictEqual(keys, ['block:c1', 'block:li1', 'block:li2', 'block:p1']);
});

test('formatting touches the box it formats', { skip }, () => {
    const sch = schema();
    const s = stateFor(sch);
    const from = inside(s.doc, 'p2');
    const tr = s.tr.addMark(from, from + 3, sch.marks.bold.create());
    assert.deepStrictEqual(ElderDocumentLive.boxesTouched(tr, DOC).map(b => b.boxKey), ['block:p2']);
});

// ── The lock ─────────────────────────────────────────────────────────────────

function withLock(heldBy) {
    const presence = presenceWith(heldBy);
    globalThis.ShepherdingPresence = presence;
    const refused = [];
    const live = ElderDocumentLive.create({
        db: { collection: () => ({ doc: () => ({}) }) }, fs: {}, docId: DOC,
        onRefused: (holder) => refused.push(holder && holder.name),
    });
    const sch = schema();
    const plugin = live.lockPlugin({ Plugin: T.state.Plugin, PluginKey: T.state.PluginKey });
    let state = stateFor(sch, [plugin]);
    return {
        presence, refused, sch,
        get state() { return state; },
        apply(tr) { const out = state.applyTransaction(tr); const changed = out.state !== state; state = out.state; return changed; },
    };
}

test('typing in a box somebody else holds changes nothing, and says who has it', { skip }, () => {
    const ed = withLock({ ['document:' + DOC + '|block:p1']: { name: 'Ann Lee' } });
    const before = ed.state.doc.toJSON();
    ed.apply(ed.state.tr.insertText('x', inside(ed.state.doc, 'p1')));
    assert.deepStrictEqual(ed.state.doc.toJSON(), before);
    assert.deepStrictEqual(ed.refused, ['Ann Lee']);
});

test('deleting a list that holds somebody’s item is refused, and typing elsewhere is not', { skip }, () => {
    const ed = withLock({ ['document:' + DOC + '|block:li2']: { name: 'Ann Lee' } });
    const s = ed.state;
    let listPos = null;
    s.doc.descendants((n, pos) => { if (n.attrs.blockId === 'ul') listPos = pos; return listPos === null; });
    const list = s.doc.nodeAt(listPos);
    const before = s.doc.toJSON();
    ed.apply(s.tr.delete(listPos, listPos + list.nodeSize));
    assert.deepStrictEqual(ed.state.doc.toJSON(), before, 'the held item was deleted with its list');

    ed.apply(ed.state.tr.insertText('!', inside(ed.state.doc, 'p2')));
    assert.match(JSON.stringify(ed.state.doc.toJSON()), /!Closed\./);
});

test('the first keystroke in a free box claims it', { skip }, () => {
    const ed = withLock({});
    ed.apply(ed.state.tr.insertText('x', inside(ed.state.doc, 'lp1')));
    assert.deepStrictEqual(ed.presence.claims, ['block:li1']);
    ed.apply(ed.state.tr.insertText('y', inside(ed.state.doc, 'lp1')));
    assert.deepStrictEqual(ed.presence.claims, ['block:li1'], 'a second keystroke claimed again');
});

test('a Person Panel held on the profile’s note editor is held in the document too', { skip }, () => {
    const ed = withLock({ 'person:p9|note:n9': { name: 'Sam Jones' } });
    let panelPos = null;
    ed.state.doc.descendants((n, pos) => { if (n.type.name === 'personPanel') panelPos = pos; return panelPos === null; });
    const before = ed.state.doc.toJSON();
    ed.apply(ed.state.tr.delete(panelPos, panelPos + 1));
    assert.deepStrictEqual(ed.state.doc.toJSON(), before);
    assert.deepStrictEqual(ed.refused, ['Sam Jones']);
});

test('a remote change is never refused by the lock', { skip }, () => {
    const ed = withLock({ ['document:' + DOC + '|block:p1']: { name: 'Ann Lee' } });
    const tr = ed.state.tr.insertText('Ann says ', inside(ed.state.doc, 'p1'));
    tr.setMeta('remote', true);
    assert.strictEqual(ed.apply(tr), true);
});

// ── Saving and taking in, through a stand-in editor ──────────────────────────

function fakeEditor(sch, stateRef) {
    const handlers = {};
    return {
        schema: sch,
        get state() { return stateRef.state; },
        view: { dispatch: (tr) => { stateRef.state = stateRef.state.apply(tr); } },
        getJSON: () => stateRef.state.doc.toJSON(),
        on: (name, fn) => { handlers[name] = fn; },
        isDestroyed: false,
        isFocused: false,
    };
}

function fakeDb(record, writes) {
    const ref = {
        get: () => Promise.resolve({ exists: true, data: () => JSON.parse(JSON.stringify(record)) }),
        update: (...args) => { writes.push(args); return Promise.resolve(); },
        onSnapshot: () => () => {},
    };
    return { collection: () => ({ doc: () => ref }), runTransaction: () => { throw new Error('no conversion expected'); } };
}

class FieldPath { constructor(...segments) { this.segments = segments; } }
const FS = { FieldPath, FieldValue: { delete: () => 'DELETE', serverTimestamp: () => 'NOW' } };

async function opened() {
    globalThis.ShepherdingPresence = undefined;
    globalThis.MosaicLiveRead = undefined;
    const record = { title: 'Minutes', docType: 'note', blocks: Body.blocksOfBody(body()) };
    const writes = [];
    const live = ElderDocumentLive.create({ db: fakeDb(record, writes), fs: FS, docId: DOC, byName: () => 'Jonathan' });
    const out = await live.open();
    const sch = schema();
    const stateRef = { state: T.state.EditorState.create({ schema: sch, doc: sch.nodeFromJSON(out.body) }) };
    const editor = fakeEditor(sch, stateRef);
    live.attach(editor);
    return { live, stateRef, writes, record, sch };
}

test('opening and saving without typing writes nothing', { skip }, async () => {
    const { live, writes } = await opened();
    await live.save();
    assert.strictEqual(writes.length, 0);
});

test('a save writes only the block that was typed into, at its own path', { skip }, async () => {
    const { live, stateRef, writes } = await opened();
    stateRef.state = stateRef.state.apply(stateRef.state.tr.insertText('Silently ', inside(stateRef.state.doc, 'p2')));
    await live.save();
    assert.strictEqual(writes.length, 1);
    const paths = writes[0].filter(a => a instanceof FieldPath).map(fp => fp.segments.join('.'));
    assert.deepStrictEqual(paths, ['blocks.p2']);
    assert.ok(!writes[0].includes('contentJson'));
});

test('a block somebody else changed arrives; an unsaved one of ours is kept', { skip }, async () => {
    const { live, stateRef, record } = await opened();
    // Ours, unsaved.
    stateRef.state = stateRef.state.apply(stateRef.state.tr.insertText('Mine: ', inside(stateRef.state.doc, 'p2')));
    // Theirs: p1 and p2 both changed remotely, and a new paragraph added.
    const theirs = JSON.parse(JSON.stringify(record.blocks));
    theirs.p1.content = [text('Opened by Ann.')];
    theirs.p2.content = [text('Theirs.')];
    theirs.n1 = { type: 'paragraph', parent: null, order: Body.orderKeyBetween(theirs.p2.order, null), content: [text('Added by Ann.')] };
    live.adopt({ title: 'Minutes', blocks: theirs });
    const words = Body.plainText(stateRef.state.doc.toJSON());
    assert.ok(words.includes('Opened by Ann.'), words);
    assert.ok(words.includes('Mine: Closed.'), 'our unsaved block was written over: ' + words);
    assert.ok(words.includes('Added by Ann.'), words);
});

test('taking in somebody else’s block does not make it look like our edit', { skip }, async () => {
    const { live, stateRef, record, writes } = await opened();
    const theirs = JSON.parse(JSON.stringify(record.blocks));
    theirs.h1.content = [text('Elder minutes')];
    live.adopt({ title: 'Minutes', blocks: theirs });
    assert.match(Body.plainText(stateRef.state.doc.toJSON()), /Elder minutes/);
    await live.save();
    assert.strictEqual(writes.length, 0, 'an adopted block was saved back');
});

test('a title somebody else set arrives when this page is not renaming', { skip }, async () => {
    const titles = [];
    const record = { title: 'Minutes', docType: 'note', blocks: Body.blocksOfBody(body()) };
    const live = ElderDocumentLive.create({ db: fakeDb(record, []), fs: FS, docId: DOC, onTitle: t => titles.push(t) });
    const out = await live.open();
    const sch = schema();
    const stateRef = { state: T.state.EditorState.create({ schema: sch, doc: sch.nodeFromJSON(out.body) }) };
    live.attach(fakeEditor(sch, stateRef));
    live.adopt({ title: 'Elder meeting', blocks: record.blocks });
    assert.deepStrictEqual(titles, ['Elder meeting']);
});

// ── Wiring ───────────────────────────────────────────────────────────────────

test('both document editors sit on the shared live layer', () => {
    const web = read('shepherding-document.js');
    const phone = read('mobile/screens-document-editor.js');
    [['web', web], ['phone', phone]].forEach(([name, src]) => {
        assert.match(src, /ElderDocumentLive\.create\(/, name + ' does not use the shared layer');
        assert.match(src, /\.lockPlugin\(/, name + ' registers no lock');
        assert.ok(!/contentJson:\s*_docEditor\.getJSON\(\)|contentJson: editor\.getJSON\(\)/.test(src), name + ' still saves the whole body');
    });
    const html = read('shepherding-document.html');
    ['document-body-core.js', 'block-id-extension.js', 'live-read.js', 'presence-core.js', 'shepherding-presence.js', 'elder-document-live.js']
        .forEach(f => assert.ok(html.includes('src="' + f + '"'), 'the page does not load ' + f));
    const mobile = read('mobile.html');
    assert.ok(mobile.includes('src="elder-document-live.js"'));
});
