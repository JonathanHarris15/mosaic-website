// MS-500 — every block in the Elder Document editor carries a lasting id.
//
// Run against real ProseMirror when the vendored bundle's build folder has its
// packages installed (build/tiptap, `npm run vendor:tiptap`); the rule itself is
// covered as a pure function in document-blocks-core.test.js either way.
//
// The wiring half — both loaders provide it, both Elder Document editors
// register it, and the renderers ignore the attribute — runs everywhere.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, 'public', f), 'utf8');
const { BlockIdExtension } = require('../public/block-id-extension.js');

// ── Real ProseMirror, when it is installed ───────────────────────────────────

const TIPTAP = path.join(ROOT, 'build', 'tiptap', 'node_modules');
let pm = null;
try {
    pm = {
        core: require(path.join(TIPTAP, '@tiptap', 'core')),
        state: require(path.join(TIPTAP, 'prosemirror-state')),
        Document: require(path.join(TIPTAP, '@tiptap', 'extension-document')).default,
        Paragraph: require(path.join(TIPTAP, '@tiptap', 'extension-paragraph')).default,
        Text: require(path.join(TIPTAP, '@tiptap', 'extension-text')).default,
    };
} catch (e) {
    pm = null;
}
const skip = pm ? false : 'build/tiptap is not installed — run npm run vendor:tiptap';

function setup(body) {
    const ext = BlockIdExtension.create({ Extension: pm.core.Extension, Plugin: pm.state.Plugin, PluginKey: pm.state.PluginKey });
    const schema = pm.core.getSchema([pm.Document, pm.Paragraph, pm.Text, ext]);
    const plugin = BlockIdExtension.plugin({ Plugin: pm.state.Plugin, PluginKey: pm.state.PluginKey });
    let state = pm.state.EditorState.create({ schema, doc: schema.nodeFromJSON(body), plugins: [plugin] });
    const first = BlockIdExtension.assignIds(state, null, null);
    if (first) state = state.apply(first);
    return { schema, get state() { return state; }, apply(fn) { state = state.applyTransaction(fn(state)).state; } };
}

const ids = (state) => { const out = []; state.doc.forEach(n => out.push(n.attrs.blockId)); return out; };

test('opening a document without ids gives every block one', { skip }, () => {
    const ed = setup({ type: 'doc', content: [{ type: 'paragraph' }, { type: 'paragraph' }] });
    const got = ids(ed.state);
    assert.strictEqual(got.length, 2);
    assert.ok(got.every(Boolean));
    assert.notStrictEqual(got[0], got[1]);
});

test('splitting a paragraph leaves the original with its id and gives the new half a fresh one', { skip }, () => {
    const ed = setup({ type: 'doc', content: [
        { type: 'paragraph', attrs: { blockId: 'keep' }, content: [{ type: 'text', text: 'One two' }] },
    ] });
    ed.apply(state => state.tr.split(4)); // after "One"
    const got = ids(ed.state);
    assert.strictEqual(got[0], 'keep');
    assert.ok(got[1] && got[1] !== 'keep');
});

test('pasting a copy of a block above it gives the copy a fresh id; the original keeps its own', { skip }, () => {
    const ed = setup({ type: 'doc', content: [
        { type: 'paragraph', attrs: { blockId: 'orig' }, content: [{ type: 'text', text: 'Minutes' }] },
    ] });
    ed.apply(state => state.tr.insert(0, state.doc.firstChild.copy(state.doc.firstChild.content)));
    const got = ids(ed.state);
    assert.strictEqual(got.length, 2);
    assert.strictEqual(got[1], 'orig', 'the original lost its id to the copy');
    assert.ok(got[0] && got[0] !== 'orig');
});

test('giving blocks ids is not something undo would take back', { skip }, () => {
    const ed = setup({ type: 'doc', content: [{ type: 'paragraph', attrs: { blockId: 'a' } }] });
    const result = ed.state.applyTransaction(ed.state.tr.insert(0, ed.state.schema.nodes.paragraph.create()));
    const appended = result.transactions.slice(1);
    assert.strictEqual(appended.length, 1, 'a new block without an id was not given one');
    assert.strictEqual(appended[0].getMeta('addToHistory'), false);
});

// ── Wiring ───────────────────────────────────────────────────────────────────

test('both loaders provide the extension, and both Elder Document editors register it', () => {
    assert.match(read('tiptap-editor-loader.js'), /BlockIdExtension\.create\(/);
    assert.match(read('mobile/tiptap-loader.js'), /BlockIdExtension\.create\(/);
    assert.match(read('shepherding-document.js'), /\bBlockId\b/);
    assert.match(read('mobile/screens-document-editor.js'), /\bBlockId\b/);
    ['shepherding-care-list.js', 'mobile/screens-carelist.js'].forEach(file => {
        assert.ok(!/\bBlockId\b/.test(read(file)), file + ' registers block ids; only Elder Documents do');
    });
});

test('the renderers give the same output with or without block ids', () => {
    const Docx = require('../public/document-docx-core.js');
    const Markdown = require('../public/note-markdown-core.js');
    const Render = require('../public/tiptap-render.js');
    const body = {
        type: 'doc', content: [
            { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Minutes' }] },
            { type: 'paragraph', content: [{ type: 'text', text: 'Opened in prayer.' }] },
            { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Visits' }] }] }] },
        ],
    };
    const withIds = require('../public/document-body-core.js').bodyOfBlocks(
        require('../public/document-body-core.js').blocksOfBody(body));
    assert.strictEqual(Markdown.toMarkdown(withIds), Markdown.toMarkdown(body));
    assert.strictEqual(Render.renderTiptapJson(withIds), Render.renderTiptapJson(body));
    assert.deepStrictEqual(Docx.docxBlocksFromTiptap(withIds), Docx.docxBlocksFromTiptap(body));
});
