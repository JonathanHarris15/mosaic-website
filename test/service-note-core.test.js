// MS-262 — the per-element note on an Order of Service (the comment bubble).
//
// ⚠ WHAT THIS FILE IS REALLY GUARDING. The note is rendered on the Order of
// Service page with x-html — injected as MARKUP into an editor's browser, not
// shown as text. On the website that is safe because the only way to write
// one is Quill, whose toolbar allows bold, italic and bullets and nothing
// else.
//
// An assistant is not Quill. It reads hymn names, themes and scripture
// references that people typed, and can be steered by them. If a crafted
// string in the church's own data could reach a note as raw HTML, it would
// run in the browser of whoever next opened that Sunday. So the only input
// this module takes is plain text, and it builds the markup itself.
//
// Every escaping test below is that hole, checked from a different angle.

const {test} = require('node:test');
const assert = require('node:assert');

const Core = require('../public/service-note-core.js');

// ── Which elements can carry a note ──────────────────────────────────────

test('the note keys are the elements the service actually has', () => {
    // Matches service-builder.js's _MOVEMENTS: the liturgy fields plus
    // baptism, which carries a note even though its value is not settable.
    assert.strictEqual(Core.NOTE_KEYS.length, 14);
    ['hymn1', 'sermon', 'benediction', 'baptism'].forEach((k) => {
        assert.ok(Core.isNoteKey(k), k);
    });
});

test('a person field is not an element that carries a note', () => {
    ['preacher', 'serviceLeader', 'theme', 'keyVerse'].forEach((k) => {
        assert.strictEqual(Core.isNoteKey(k), false, k);
    });
});

// ── ⚠ Nothing a caller sends may become markup ───────────────────────────

test('⚠ a script tag is escaped, not stored as a script tag', () => {
    const html = Core.textToNoteHtml('<script>alert(1)</script>');
    assert.ok(!/<script/i.test(html), 'a script tag reached the store: ' + html);
    assert.ok(html.includes('&lt;script&gt;'));
});

// The tags this module is allowed to emit, and the only ones. Anything else
// appearing as real markup is the bug this file exists to catch.
const OURS = /<\/?(p|br|ul|li|strong|em)>/g;

test('⚠ an event handler on a crafted tag cannot survive', () => {
    const html = Core.textToNoteHtml('<img src=x onerror="alert(1)">');
    assert.ok(!/<img/i.test(html), html);
    assert.ok(html.includes('&lt;img'), 'it should be there, but as text');

    // ⚠ THE PROPERTY THAT MATTERS: once our own tags are removed, no real
    // angle bracket is left, so nothing in the stored value can open a tag.
    // (Do NOT un-escape first and then look for "onerror" — that finds the
    // characters we deliberately neutralised and proves nothing.)
    assert.strictEqual(html.replace(OURS, '').includes('<'), false, html);
});

test('⚠ no input produces a real tag other than the six this module emits', () => {
    [
        '<script>alert(1)</script>',
        '<img src=x onerror=alert(1)>',
        '<iframe src="javascript:alert(1)"></iframe>',
        '<a href="javascript:alert(1)">click</a>',
        '<style>body{display:none}</style>',
        '</p><script>alert(1)</script><p>',
        '<svg/onload=alert(1)>',
        '**<b onclick=x>hi</b>**',
        '- <img src=x onerror=alert(1)>',
    ].forEach((attack) => {
        const html = Core.textToNoteHtml(attack);
        assert.strictEqual(html.replace(OURS, '').includes('<'), false,
            `markup escaped from: ${attack} -> ${html}`);
    });
});

test('⚠ quotes and ampersands are escaped, so no attribute can be broken out of', () => {
    const html = Core.textToNoteHtml('He said "a & b" and \'c\'');
    assert.ok(html.includes('&quot;'));
    assert.ok(html.includes('&amp;'));
    assert.ok(html.includes('&#39;'));
});

test('⚠ escaping happens BEFORE the markup is added, not after', () => {
    // The trap: escape last and the <strong> this module just built becomes
    // visible text, while the caller's angle brackets are already gone.
    const html = Core.textToNoteHtml('**bold**');
    assert.ok(html.includes('<strong>bold</strong>'), html);
    assert.ok(!html.includes('&lt;strong&gt;'), html);
});

test('⚠ a caller cannot smuggle a tag through the bold syntax', () => {
    const html = Core.textToNoteHtml('**<b onclick="x">hi</b>**');
    assert.ok(!/<b\s/i.test(html), html);
    assert.ok(html.includes('<strong>'), 'our own strong tag should still be there');
});

// ── The formatting subset, which is exactly Quill's toolbar ──────────────

test('a plain line becomes a paragraph', () => {
    assert.strictEqual(Core.textToNoteHtml('Bill is away'), '<p>Bill is away</p>');
});

test('a blank line starts a new paragraph', () => {
    assert.strictEqual(
        Core.textToNoteHtml('First.\n\nSecond.'),
        '<p>First.</p><p>Second.</p>');
});

test('a single newline is a line break inside one paragraph', () => {
    assert.strictEqual(
        Core.textToNoteHtml('One\nTwo'), '<p>One<br>Two</p>');
});

test('lines beginning "- " become a bullet list', () => {
    assert.strictEqual(
        Core.textToNoteHtml('- first\n- second'),
        '<ul><li>first</li><li>second</li></ul>');
});

test('bold and italic use Quill\'s own two formats and no others', () => {
    assert.strictEqual(
        Core.textToNoteHtml('**bold** and *italic*'),
        '<p><strong>bold</strong> and <em>italic</em></p>');
});

test('a mix of a paragraph and a list keeps them apart', () => {
    assert.strictEqual(
        Core.textToNoteHtml('Why:\n\n- one\n- two'),
        '<p>Why:</p><ul><li>one</li><li>two</li></ul>');
});

// ── Empty means gone ─────────────────────────────────────────────────────

test('blank input produces nothing at all, which the caller reads as "delete"', () => {
    ['', '   ', '\n\n', null, undefined].forEach((v) => {
        assert.strictEqual(Core.textToNoteHtml(v), '', JSON.stringify(v));
    });
});

test('markup with no words in it does not count as a note', () => {
    assert.strictEqual(Core.hasNote('<p></p>'), false);
    assert.strictEqual(Core.hasNote('<p><br></p>'), false);
    assert.strictEqual(Core.hasNote('<p>Something</p>'), true);
});

// ── Reading a note back ──────────────────────────────────────────────────

test('a stored note reads back as text, without its tags', () => {
    assert.strictEqual(
        Core.noteHtmlToText('<p>Bill is <strong>away</strong></p>'),
        'Bill is away');
});

test('a bullet list reads back as bullets, not as one run-on word', () => {
    assert.strictEqual(
        Core.noteHtmlToText('<ul><li>one</li><li>two</li></ul>'),
        '- one\n- two');
});

test('escaped characters come back as themselves', () => {
    assert.strictEqual(
        Core.noteHtmlToText('<p>a &amp; b &lt;c&gt;</p>'), 'a & b <c>');
});

test('a note survives a round trip through storage and back', () => {
    const original = 'Bill is away.\n\n- ask Cara\n- **confirm** by Friday';
    const back = Core.noteHtmlToText(Core.textToNoteHtml(original));
    assert.strictEqual(back, 'Bill is away.\n- ask Cara\n- confirm by Friday');
});
