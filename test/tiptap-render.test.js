const { test } = require('node:test');
const assert = require('node:assert');

const { renderTiptapJson } = require('../public/tiptap-render.js');

// Renders a Note Body (TipTap document JSON) to read-only HTML. These pin the
// exact markup the Shepherding Profile depends on — escaping, marks, mention
// link shapes per kind, and the optional document back-link breadcrumb.

const doc = (...content) => ({ type: 'doc', content });
const para = (...content) => ({ type: 'paragraph', content });
const txt = (text, marks) => marks ? { type: 'text', text, marks } : { type: 'text', text };

test('empty / contentless docs render to empty string', () => {
    assert.strictEqual(renderTiptapJson(null), '');
    assert.strictEqual(renderTiptapJson({}), '');
    assert.strictEqual(renderTiptapJson({ type: 'doc' }), '');
});

test('an empty paragraph renders as <p></p>', () => {
    assert.strictEqual(renderTiptapJson(doc(para())), '<p></p>');
});

test('text is HTML-escaped', () => {
    assert.strictEqual(renderTiptapJson(doc(para(txt('a < b & c > d')))), '<p>a &lt; b &amp; c &gt; d</p>');
});

test('marks wrap text: bold, italic, underline', () => {
    assert.strictEqual(
        renderTiptapJson(doc(para(txt('hi', [{ type: 'bold' }, { type: 'italic' }, { type: 'underline' }])))),
        '<p><u><em><strong>hi</strong></em></u></p>');
});

test('highlight mark uses its colour, defaulting to #fef08a', () => {
    assert.match(renderTiptapJson(doc(para(txt('h', [{ type: 'highlight' }])))), /background-color:#fef08a/);
    assert.match(renderTiptapJson(doc(para(txt('h', [{ type: 'highlight', attrs: { color: '#abc' } }])))), /background-color:#abc/);
});

test('textStyle mark emits font-size / font-family spans', () => {
    const html = renderTiptapJson(doc(para(txt('s', [{ type: 'textStyle', attrs: { fontSize: '20px', fontFamily: 'Serif' } }]))));
    assert.strictEqual(html, '<p><span style="font-size:20px;font-family:Serif">s</span></p>');
});

test('person mention links to the profile, label escaped', () => {
    const m = { type: 'mention', attrs: { id: JSON.stringify({ kind: 'person', id: 'p1' }), label: 'Jane & Co' } };
    assert.strictEqual(renderTiptapJson(doc(para(m))),
        '<p><a class="mention-chip" href="shepherding-profile.html?id=p1">@Jane &amp; Co</a></p>');
});

test('note mention links to the owning person; document/folder to their pages', () => {
    const note = { type: 'mention', attrs: { id: JSON.stringify({ kind: 'note', personId: 'p9' }), label: 'N' } };
    assert.match(renderTiptapJson(doc(para(note))), /shepherding-profile\.html\?id=p9/);
    const ed = { type: 'mention', attrs: { id: JSON.stringify({ kind: 'elder_document', id: 'd3' }), label: 'D' } };
    assert.match(renderTiptapJson(doc(para(ed))), /shepherding-document\.html\?id=d3/);
    const folder = { type: 'mention', attrs: { id: JSON.stringify({ kind: 'elder_folder', id: 'f2' }), label: 'F' } };
    assert.match(renderTiptapJson(doc(para(folder))), /shepherding-documents\.html\?folder=f2/);
});

test('an unparseable or unknown mention renders a dimmed span, not a link', () => {
    const bad = { type: 'mention', attrs: { id: 'not json', label: 'X' } };
    assert.strictEqual(renderTiptapJson(doc(para(bad))), '<p><span class="mention-chip" style="opacity:.5">@X</span></p>');
});

test('breadcrumb option appends back-link params to person/note mentions only', () => {
    const m = { type: 'mention', attrs: { id: JSON.stringify({ kind: 'person', id: 'p1' }), label: 'J' } };
    const html = renderTiptapJson(doc(para(m)), { breadcrumb: { fromPage: 'document', fromId: 'd1', fromTitle: 'My Doc' } });
    assert.match(html, /id=p1&fromPage=document&fromId=d1&fromTitle=My%20Doc/);
    // document/folder links never carry the breadcrumb
    const ed = { type: 'mention', attrs: { id: JSON.stringify({ kind: 'elder_document', id: 'd3' }), label: 'D' } };
    assert.ok(!renderTiptapJson(doc(para(ed)), { breadcrumb: { fromPage: 'document' } }).includes('fromPage'));
});

test('lists and tables nest correctly', () => {
    const list = { type: 'bulletList', content: [{ type: 'listItem', content: [para(txt('one'))] }] };
    assert.strictEqual(renderTiptapJson(doc(list)), '<ul><li><p>one</p></li></ul>');
    const table = { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [para(txt('c'))] }] }] };
    assert.strictEqual(renderTiptapJson(doc(table)), '<table class="note-table"><tr><td><p>c</p></td></tr></table>');
});
