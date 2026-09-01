const { test } = require('node:test');
const assert = require('node:assert');

// The one shape every document written in Mosaic takes — a Shepherding Note,
// Meeting Minutes, an Elder Document, an Event Document. Four things to a
// person, one thing to the code (ADR-0049).

const Core = require('../public/document-body-core.js');

const doc = content => ({ type: 'doc', content: content });
const para = t => ({ type: 'paragraph', content: t ? [{ type: 'text', text: t }] : [] });

// ── A new document ────────────────────────────────────────────────────────────

test('a new body is a document TipTap will actually open', () => {
    // Not null and not {} — TipTap refuses anything that is not a doc node with
    // content, and an editor handed one renders nothing at all, which reads as
    // a broken page rather than an empty one.
    const body = Core.emptyBody();
    assert.strictEqual(body.type, 'doc');
    assert.ok(Array.isArray(body.content) && body.content.length > 0);
});

test('two new bodies are separate objects, not one shared by everybody', () => {
    const a = Core.emptyBody();
    a.content.push(para('typed into the first'));
    assert.strictEqual(Core.emptyBody().content.length, 1);
});

// ── The record ────────────────────────────────────────────────────────────────

test('the record carries every field a screen might read', () => {
    const record = Core.buildDocumentRecord({
        title: 'Elders Meeting',
        contentJson: doc([para('present')]),
        createdAt: 't0', createdBy: 'u1', createdByName: 'Edie Torres',
        updatedAt: 't1', updatedByName: 'Edie Torres',
    });
    assert.deepStrictEqual(Object.keys(record).sort(), [
        'contentJson', 'createdAt', 'createdBy', 'createdByName',
        'title', 'updatedAt', 'updatedByName',
    ]);
    assert.strictEqual(record.title, 'Elders Meeting');
});

test('a record never invents a field it was not given', () => {
    const record = Core.buildDocumentRecord({ title: 'A' });
    assert.strictEqual(record.updatedByName, null);
    assert.strictEqual(record.createdBy, null);
});

test('a record with no body still gets one that opens', () => {
    // A document with no body cannot be opened at all, so this is the one field
    // that is filled in rather than left null.
    const record = Core.buildDocumentRecord({ title: 'A' });
    assert.strictEqual(record.contentJson.type, 'doc');
    assert.ok(record.contentJson.content.length);
});

test('a record with no title gets the one fallback everybody uses', () => {
    // A list, a tab title and a Word filename showing three different
    // fallbacks is how one document looks like three.
    assert.strictEqual(Core.buildDocumentRecord({}).title, 'Untitled Document');
    assert.strictEqual(Core.buildDocumentRecord({ title: '   ' }).title, 'Untitled Document');
});

// ── Titles ────────────────────────────────────────────────────────────────────

test('a title loses the whitespace somebody did not mean to type', () => {
    assert.strictEqual(Core.normaliseTitle('  Elders   Meeting  '), 'Elders Meeting');
    assert.strictEqual(Core.normaliseTitle('line\nbreak'), 'line break');
});

test('a title longer than a row is cut, not refused', () => {
    const long = Core.normaliseTitle('x'.repeat(500));
    assert.strictEqual(long.length, Core.MAX_TITLE_LENGTH);
});

test('isUntitled knows the fallback from a title somebody chose', () => {
    assert.strictEqual(Core.isUntitled(''), true);
    assert.strictEqual(Core.isUntitled(null), true);
    assert.strictEqual(Core.isUntitled('Untitled Document'), true);
    assert.strictEqual(Core.isUntitled('Agenda'), false);
});

// ── Reading a body without rendering it ───────────────────────────────────────

test('the plain text is what a person would read aloud', () => {
    assert.strictEqual(
        Core.plainText(doc([para('Hello'), para('there')])),
        'Hello there');
});

test('two paragraphs do not run together into a word nobody wrote', () => {
    // Without a separator this is "Helloworld", which then matches a search for
    // a word that is not in the document.
    assert.strictEqual(Core.plainText(doc([para('Hello'), para('world')])), 'Hello world');
});

test('a Cross-Reference reads as the name it was written as', () => {
    const body = doc([{ type: 'paragraph', content: [
        { type: 'text', text: 'spoke with ' },
        { type: 'mention', attrs: { label: 'Bethany Croft' } },
    ] }]);
    assert.strictEqual(Core.plainText(body), 'spoke with @Bethany Croft');
});

test('text inside a table is still text', () => {
    const cell = t => ({ type: 'tableCell', content: [para(t)] });
    const body = doc([{ type: 'table', content: [
        { type: 'tableRow', content: [cell('Name'), cell('Role')] },
    ] }]);
    assert.strictEqual(Core.plainText(body), 'Name Role');
});

test('nothing at all reads as nothing, not as a crash', () => {
    assert.strictEqual(Core.plainText(null), '');
    assert.strictEqual(Core.plainText({}), '');
    assert.strictEqual(Core.plainText(doc([])), '');
});

// ── Empty, honestly ───────────────────────────────────────────────────────────

test('a document nobody has typed in is empty', () => {
    assert.strictEqual(Core.isEmptyBody(null), true);
    assert.strictEqual(Core.isEmptyBody(Core.emptyBody()), true);
    assert.strictEqual(Core.isEmptyBody(doc([para(''), para('')])), true);
});

test('a document with a word in it is not empty', () => {
    assert.strictEqual(Core.isEmptyBody(doc([para('a')])), false);
});

test('a document holding a table with no words in it is NOT empty', () => {
    // Somebody put that table there. Telling them the document is blank is
    // telling them something they can see is false.
    const body = doc([{ type: 'table', content: [
        { type: 'tableRow', content: [{ type: 'tableCell', content: [para('')] }] },
    ] }]);
    assert.strictEqual(Core.isEmptyBody(body), false);
});

test('a rule, an image or a Person Panel all count as something', () => {
    assert.strictEqual(Core.isEmptyBody(doc([{ type: 'horizontalRule' }])), false);
    assert.strictEqual(Core.isEmptyBody(doc([{ type: 'image', attrs: {} }])), false);
    assert.strictEqual(Core.isEmptyBody(doc([{ type: 'personPanel', attrs: {} }])), false);
});

// ── The line under the name in a list ─────────────────────────────────────────

test('a short document previews as all of itself, with no trailing dots', () => {
    assert.strictEqual(Core.bodyPreview(doc([para('Short one.')])), 'Short one.');
});

test('a long document is cut at a word, and says it was cut', () => {
    const words = ('lorem ipsum dolor sit amet '.repeat(20)).trim();
    const preview = Core.bodyPreview(doc([para(words)]));
    assert.ok(preview.length <= Core.PREVIEW_LENGTH + 1, 'got ' + preview.length);
    assert.ok(preview.endsWith('…'));
    assert.ok(!/ …$/.test(preview), 'a space before the ellipsis reads as a typo');
    assert.ok(words.startsWith(preview.slice(0, -1)), 'the preview is not the start of the text');
});

test('one enormous word is cut mid-word rather than vanishing', () => {
    const preview = Core.bodyPreview(doc([para('x'.repeat(400))]));
    assert.strictEqual(preview.length, Core.PREVIEW_LENGTH + 1);
});

test('an empty document has no preview line at all', () => {
    assert.strictEqual(Core.bodyPreview(Core.emptyBody()), '');
    assert.strictEqual(Core.bodyPreview(null), '');
});
