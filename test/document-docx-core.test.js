const { test } = require('node:test');
const assert = require('node:assert');

// The walk from a Note Body (TipTap JSON) to the description of a Word file.
//
// Everything here is a pure function of its inputs, so everything here is
// tested as one. The `docx` library that turns this description into actual
// zipped XML is not involved and is not the thing that gets it wrong.

const Core = require('../public/document-docx-core.js');

const doc = content => ({ type: 'doc', content: content });
const text = (t, marks) => marks ? { type: 'text', text: t, marks: marks } : { type: 'text', text: t };
const para = content => ({ type: 'paragraph', content: content });

// ── Nothing at all ────────────────────────────────────────────────────────────

test('an empty document is no blocks, not one empty one', () => {
    assert.deepStrictEqual(Core.docxBlocksFromTiptap(null), []);
    assert.deepStrictEqual(Core.docxBlocksFromTiptap({}), []);
    assert.deepStrictEqual(Core.docxBlocksFromTiptap(doc([])), []);
});

test('an empty paragraph survives — it is a blank line somebody typed', () => {
    const blocks = Core.docxBlocksFromTiptap(doc([para([])]));
    assert.strictEqual(blocks.length, 1);
    assert.strictEqual(blocks[0].kind, 'paragraph');
    assert.deepStrictEqual(blocks[0].runs, []);
});

// ── What is true of a stretch of text ─────────────────────────────────────────

test('every mark the editor can write comes through', () => {
    const blocks = Core.docxBlocksFromTiptap(doc([para([
        text('plain'),
        text('bold', [{ type: 'bold' }]),
        text('italic', [{ type: 'italic' }]),
        text('under', [{ type: 'underline' }]),
        text('struck', [{ type: 'strike' }]),
        text('code', [{ type: 'code' }]),
    ])]));

    const runs = blocks[0].runs;
    assert.strictEqual(runs[0].bold, false);
    assert.strictEqual(runs[1].bold, true);
    assert.strictEqual(runs[2].italic, true);
    assert.strictEqual(runs[3].underline, true);
    assert.strictEqual(runs[4].strike, true);
    assert.strictEqual(runs[5].code, true);
});

test('two marks on one stretch of text both survive', () => {
    const blocks = Core.docxBlocksFromTiptap(doc([para([
        text('both', [{ type: 'bold' }, { type: 'italic' }]),
    ])]));
    assert.strictEqual(blocks[0].runs[0].bold, true);
    assert.strictEqual(blocks[0].runs[0].italic, true);
});

test('a highlight keeps its colour, and a colourless one takes the default pen', () => {
    const blocks = Core.docxBlocksFromTiptap(doc([para([
        text('a', [{ type: 'highlight', attrs: { color: '#ff0000' } }]),
        text('b', [{ type: 'highlight' }]),
    ])]));
    assert.strictEqual(blocks[0].runs[0].highlight, '#ff0000');
    assert.strictEqual(blocks[0].runs[1].highlight, '#fef08a',
        'the fallback must match the one tiptap-render.js uses');
});

test('a link keeps its address', () => {
    const blocks = Core.docxBlocksFromTiptap(doc([para([
        text('notes', [{ type: 'link', attrs: { href: 'https://example.org' } }]),
    ])]));
    assert.strictEqual(blocks[0].runs[0].link, 'https://example.org');
});

test('a hard break is its own run, because that is how Word holds one', () => {
    const blocks = Core.docxBlocksFromTiptap(doc([para([
        text('one'), { type: 'hardBreak' }, text('two'),
    ])]));
    assert.deepStrictEqual(blocks[0].runs.map(r => r.break === true), [false, true, false]);
});

// ── Font size, in the only unit Word has ──────────────────────────────────────

test('a size in pixels becomes a size in points', () => {
    assert.strictEqual(Core.fontSizeToPoints('16px'), 12);
    assert.strictEqual(Core.fontSizeToPoints('14px'), 10.5);
});

test('a size already in points is left alone', () => {
    assert.strictEqual(Core.fontSizeToPoints('11pt'), 11);
});

test('a size rounds to the half point, because Word cannot hold finer', () => {
    assert.strictEqual(Core.fontSizeToPoints('13px'), 10);
});

test('a relative size is dropped rather than guessed at', () => {
    // 1.2em of WHAT? There is no answer without the thing it is relative to.
    assert.strictEqual(Core.fontSizeToPoints('1.2em'), null);
    assert.strictEqual(Core.fontSizeToPoints('120%'), null);
    assert.strictEqual(Core.fontSizeToPoints(''), null);
    assert.strictEqual(Core.fontSizeToPoints('0px'), null);
});

test('a font and a size ride on the same run', () => {
    const blocks = Core.docxBlocksFromTiptap(doc([para([
        text('big', [{ type: 'textStyle', attrs: { fontSize: '24px', fontFamily: 'Georgia' } }]),
    ])]));
    assert.strictEqual(blocks[0].runs[0].sizePt, 18);
    assert.strictEqual(blocks[0].runs[0].font, 'Georgia');
});

// ── Headings ──────────────────────────────────────────────────────────────────

test('every heading level maps to the Word style of the same number', () => {
    for (let level = 1; level <= 6; level++) {
        const blocks = Core.docxBlocksFromTiptap(doc([
            { type: 'heading', attrs: { level: level }, content: [text('H')] },
        ]));
        assert.strictEqual(blocks[0].style, 'Heading' + level);
    }
});

test('a heading level Word does not have is pulled to one it does', () => {
    const deep = Core.docxBlocksFromTiptap(doc([
        { type: 'heading', attrs: { level: 9 }, content: [text('H')] },
    ]));
    assert.strictEqual(deep[0].style, 'Heading6');

    const none = Core.docxBlocksFromTiptap(doc([
        { type: 'heading', attrs: {}, content: [text('H')] },
    ]));
    assert.strictEqual(none[0].style, 'Heading1');
});

// ── Lists ─────────────────────────────────────────────────────────────────────

test('a bullet list becomes list items at level 0', () => {
    const blocks = Core.docxBlocksFromTiptap(doc([
        { type: 'bulletList', content: [
            { type: 'listItem', content: [para([text('one')])] },
            { type: 'listItem', content: [para([text('two')])] },
        ] },
    ]));
    assert.strictEqual(blocks.length, 2);
    blocks.forEach(b => {
        assert.strictEqual(b.kind, 'listItem');
        assert.strictEqual(b.ordered, false);
        assert.strictEqual(b.level, 0);
    });
    assert.strictEqual(blocks[0].runs[0].text, 'one');
});

test('an ordered list says so', () => {
    const blocks = Core.docxBlocksFromTiptap(doc([
        { type: 'orderedList', content: [
            { type: 'listItem', content: [para([text('first')])] },
        ] },
    ]));
    assert.strictEqual(blocks[0].ordered, true);
});

test('a list inside a list item is one level deeper', () => {
    const blocks = Core.docxBlocksFromTiptap(doc([
        { type: 'bulletList', content: [
            { type: 'listItem', content: [
                para([text('outer')]),
                { type: 'bulletList', content: [
                    { type: 'listItem', content: [
                        para([text('inner')]),
                        { type: 'orderedList', content: [
                            { type: 'listItem', content: [para([text('deepest')])] },
                        ] },
                    ] },
                ] },
            ] },
        ] },
    ]));

    assert.deepStrictEqual(
        blocks.map(b => [b.runs[0].text, b.level, b.ordered]),
        [['outer', 0, false], ['inner', 1, false], ['deepest', 2, true]]);
});

test('a paragraph after a list is a paragraph again, not a stranded list item', () => {
    const blocks = Core.docxBlocksFromTiptap(doc([
        { type: 'bulletList', content: [
            { type: 'listItem', content: [para([text('item')])] },
        ] },
        para([text('after')]),
    ]));
    assert.strictEqual(blocks[0].kind, 'listItem');
    assert.strictEqual(blocks[1].kind, 'paragraph');
});

// ── Quotes, code and rules ────────────────────────────────────────────────────

test('a blockquote disappears and its paragraphs carry the style', () => {
    const blocks = Core.docxBlocksFromTiptap(doc([
        { type: 'blockquote', content: [para([text('quoted')]), para([text('still quoted')])] },
    ]));
    assert.strictEqual(blocks.length, 2);
    blocks.forEach(b => assert.strictEqual(b.style, 'Quote'));
});

test('a code block keeps its text under a style of its own', () => {
    const blocks = Core.docxBlocksFromTiptap(doc([
        { type: 'codeBlock', content: [text('const a = 1;')] },
    ]));
    assert.strictEqual(blocks[0].style, 'Code');
    assert.strictEqual(blocks[0].runs[0].text, 'const a = 1;');
});

test('a horizontal rule is a block of its own', () => {
    const blocks = Core.docxBlocksFromTiptap(doc([{ type: 'horizontalRule' }]));
    assert.deepStrictEqual(blocks, [{ kind: 'rule' }]);
});

// ── Tables ────────────────────────────────────────────────────────────────────

test('a table keeps its rows, its cells and which cells are headers', () => {
    const cell = (type, t) => ({ type: type, content: [para([text(t)])] });
    const blocks = Core.docxBlocksFromTiptap(doc([
        { type: 'table', content: [
            { type: 'tableRow', content: [cell('tableHeader', 'Name'), cell('tableHeader', 'Role')] },
            { type: 'tableRow', content: [cell('tableCell', 'Bethany'), cell('tableCell', 'Welcome')] },
        ] },
    ]));

    assert.strictEqual(blocks.length, 1);
    assert.strictEqual(blocks[0].kind, 'table');
    assert.strictEqual(blocks[0].rows.length, 2);
    assert.deepStrictEqual(blocks[0].rows[0].cells.map(c => c.header), [true, true]);
    assert.deepStrictEqual(blocks[0].rows[1].cells.map(c => c.header), [false, false]);
    assert.strictEqual(blocks[0].rows[1].cells[0].blocks[0].runs[0].text, 'Bethany');
});

test('a list inside a table cell is a list, not a stray paragraph', () => {
    const blocks = Core.docxBlocksFromTiptap(doc([
        { type: 'table', content: [
            { type: 'tableRow', content: [
                { type: 'tableCell', content: [
                    { type: 'bulletList', content: [
                        { type: 'listItem', content: [para([text('in a cell')])] },
                    ] },
                ] },
            ] },
        ] },
    ]));
    const inner = blocks[0].rows[0].cells[0].blocks[0];
    assert.strictEqual(inner.kind, 'listItem');
    assert.strictEqual(inner.level, 0);
});

// ── A Cross-Reference, once it has left the app ───────────────────────────────

test('an @-mention keeps the name it was written as', () => {
    const blocks = Core.docxBlocksFromTiptap(doc([para([
        text('spoke with '),
        { type: 'mention', attrs: { label: 'Bethany Croft', id: '{"kind":"person","id":"p1"}' } },
    ])]));
    assert.strictEqual(blocks[0].runs[1].text, '@Bethany Croft');
    assert.strictEqual(blocks[0].runs[1].bold, true);
    assert.strictEqual(blocks[0].runs[1].mention, true);
});

test('a mention with no label still says something', () => {
    const blocks = Core.docxBlocksFromTiptap(doc([para([{ type: 'mention', attrs: {} }])]));
    assert.strictEqual(blocks[0].runs[0].text, '@?');
});

// ── A Person Panel (ADR-0004) ─────────────────────────────────────────────────

test('a Person Panel whose note was fetched has that note in the file', () => {
    const blocks = Core.docxBlocksFromTiptap(
        doc([{ type: 'personPanel', attrs: { personName: 'Tom Reed', noteId: 'n1' } }]),
        { panelBodies: { n1: doc([para([text('Doing much better.')])]) } });

    assert.strictEqual(blocks[0].style, 'Heading3');
    assert.strictEqual(blocks[0].runs[0].text, 'Tom Reed');
    assert.strictEqual(blocks[1].runs[0].text, 'Doing much better.');
});

test('a Person Panel whose note was NOT fetched says so instead of going quiet', () => {
    // Silently exporting an empty panel is how somebody sends out minutes with
    // a person's section missing and never notices.
    const blocks = Core.docxBlocksFromTiptap(
        doc([{ type: 'personPanel', attrs: { personName: 'Tom Reed', noteId: 'n1' } }]));

    assert.strictEqual(blocks[0].runs[0].text, 'Tom Reed');
    assert.match(blocks[1].runs[0].text, /not included/i);
    assert.strictEqual(blocks[1].runs[0].italic, true);
});

// ── A node this file has never met ────────────────────────────────────────────

test('an unknown node is walked through, never dropped', () => {
    // The editor will grow nodes after this file is written. Losing formatting
    // is a bad day; losing words is a lost document.
    const blocks = Core.docxBlocksFromTiptap(doc([
        { type: 'somethingNew', content: [para([text('still here')])] },
    ]));
    assert.strictEqual(blocks[0].runs[0].text, 'still here');
});

// ── Coming the other way: a Word file made safe to put in a page ──────────────
//
// mammoth's output is written straight into the DOM — into the editor on
// import, into the Files-tab viewer on an attachment. A Word hyperlink carries
// whatever address it was given, and Word can be made to carry javascript:.
//
// This filter used to exist twice, here and in event-attachments-core.js. One
// copy now, because two copies of a security filter is how one gets fixed and
// the other does not.

test('a Word file cannot bring script into the page it lands on', () => {
    const dirty = '<p onclick="steal()">Hello</p><script>steal()<\/script>' +
        '<a href="javascript:steal()">click</a>';
    const clean = Core.sanitizeDocxHtml(dirty);
    assert.ok(!/<script/i.test(clean), 'a script tag survived');
    assert.ok(!/onclick/i.test(clean), 'an event handler survived');
    assert.ok(!/javascript:/i.test(clean), 'a javascript: link survived');
    assert.ok(/Hello/.test(clean), 'the actual document was thrown away too');
});

test('an unclosed script tag cannot slip through by never closing', () => {
    assert.ok(!/<script/i.test(Core.sanitizeDocxHtml('<p>hi</p><script>steal()')));
});

test('an ordinary Word document comes through untouched', () => {
    const html = '<h1>Elders Meeting</h1><p><strong>Present:</strong> Tom</p>' +
        '<a href="https://example.org/notes">notes</a>';
    assert.strictEqual(Core.sanitizeDocxHtml(html), html);
});

test('a style or link tag smuggled into a Word file does not reach the page', () => {
    assert.ok(!/<style/i.test(Core.sanitizeDocxHtml('<style>body{display:none}</style><p>hi</p>')));
    assert.ok(!/<iframe/i.test(Core.sanitizeDocxHtml('<iframe src="evil"></iframe>')));
});

// ── The filename ──────────────────────────────────────────────────────────────

test('a title becomes a filename Windows will accept', () => {
    assert.strictEqual(Core.docxFileName('Elders Meeting: 3rd Sept'), 'Elders Meeting 3rd Sept.docx');
    assert.strictEqual(Core.docxFileName('a/b\\c*d?e"f<g>h|i'), 'a b c d e f g h i.docx');
});

test('a document with no usable title still gets a name', () => {
    assert.strictEqual(Core.docxFileName(''), 'Document.docx');
    assert.strictEqual(Core.docxFileName(null), 'Document.docx');
    assert.strictEqual(Core.docxFileName('///'), 'Document.docx');
});

test('a very long title is cut rather than refused', () => {
    const name = Core.docxFileName('x'.repeat(400));
    assert.ok(name.length <= 125, 'got ' + name.length);
    assert.ok(name.endsWith('.docx'));
});

// ── Alignment ─────────────────────────────────────────────────────────────────

test('an alignment rides on the block, and left is dropped rather than restated', () => {
    const aligned = a => Core.docxBlocksFromTiptap(doc([
        { type: 'paragraph', attrs: { textAlign: a }, content: [text('x')] },
    ]))[0].align;

    assert.strictEqual(aligned('center'), 'center');
    assert.strictEqual(aligned('right'), 'right');
    assert.strictEqual(aligned('justify'), 'justify');
    // Emitting 'left' would override a document whose own default is something
    // else, so the absence is the point.
    assert.strictEqual(aligned('left'), null);
    assert.strictEqual(aligned(undefined), null);
    assert.strictEqual(aligned('nonsense'), null);
});

test('a heading and a list item carry alignment too', () => {
    const heading = Core.docxBlocksFromTiptap(doc([
        { type: 'heading', attrs: { level: 1, textAlign: 'center' }, content: [text('T')] },
    ]));
    assert.strictEqual(heading[0].align, 'center');

    const list = Core.docxBlocksFromTiptap(doc([
        { type: 'bulletList', content: [
            { type: 'listItem', content: [
                { type: 'paragraph', attrs: { textAlign: 'right' }, content: [text('x')] },
            ] },
        ] },
    ]));
    assert.strictEqual(list[0].align, 'right');
});

// ── A picture ─────────────────────────────────────────────────────────────────

test('a data URI is split into what it is and what it holds', () => {
    assert.deepStrictEqual(Core.parseDataUri('data:image/png;base64,AAAB'),
        { mime: 'image/png', base64: 'AAAB' });
    assert.deepStrictEqual(Core.parseDataUri('DATA:image/JPEG;base64,QQ=='),
        { mime: 'image/jpeg', base64: 'QQ==' });
});

test('anything that is not an inline picture is not one', () => {
    assert.strictEqual(Core.parseDataUri('https://example.org/a.png'), null);
    assert.strictEqual(Core.parseDataUri('data:text/html;base64,AAAA'), null,
        'only images may be inlined into a Word file');
    assert.strictEqual(Core.parseDataUri(''), null);
    assert.strictEqual(Core.parseDataUri(null), null);
});

test('a picture becomes an image block, carrying its bytes and its words', () => {
    const blocks = Core.docxBlocksFromTiptap(doc([
        { type: 'image', attrs: { src: 'data:image/png;base64,AAAB', alt: 'the flyer' } },
    ]));
    assert.deepStrictEqual(blocks, [
        { kind: 'image', mime: 'image/png', base64: 'AAAB', alt: 'the flyer' },
    ]);
});

test('a picture held at a URL says so in words instead of breaking the file', () => {
    // A .docx carrying a link to a picture shows a broken frame to anyone
    // reading it offline, which is most people with a document they were sent.
    const blocks = Core.docxBlocksFromTiptap(doc([
        { type: 'image', attrs: { src: 'https://example.org/a.png', alt: 'the flyer' } },
    ]));
    assert.strictEqual(blocks[0].kind, 'paragraph');
    assert.strictEqual(blocks[0].runs[0].text, '[the flyer]');
    assert.strictEqual(blocks[0].runs[0].italic, true);
});

// ── How big a picture is, read from the picture ───────────────────────────────

const PNG_1x1 = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64');

test('a PNG says how big it is, and is believed', () => {
    assert.deepStrictEqual(Core.imageSizeFromBytes(new Uint8Array(PNG_1x1)), { width: 1, height: 1 });
});

test('a GIF is read the other way round, because that is how a GIF stores it', () => {
    const gif = new Uint8Array(24);
    gif.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61], 0);  // GIF89a
    gif[6] = 0x20; gif[7] = 0x00;                       // width  32, little-endian
    gif[8] = 0x10; gif[9] = 0x00;                       // height 16
    assert.deepStrictEqual(Core.imageSizeFromBytes(gif), { width: 32, height: 16 });
});

test('a JPEG is walked to its frame marker, past whatever metadata came first', () => {
    const jpeg = new Uint8Array([
        0xff, 0xd8,                          // start of image
        0xff, 0xe0, 0x00, 0x04, 0x00, 0x00,  // a segment of its own length
        0xff, 0xc0, 0x00, 0x11, 0x08,        // start of frame
        0x00, 0x40,                          // height 64
        0x00, 0x80,                          // width 128
        0, 0, 0, 0, 0, 0, 0,
    ]);
    assert.deepStrictEqual(Core.imageSizeFromBytes(jpeg), { width: 128, height: 64 });
});

test('something that is not a picture measures as nothing, not as a guess', () => {
    assert.strictEqual(Core.imageSizeFromBytes(new Uint8Array(4)), null);
    assert.strictEqual(Core.imageSizeFromBytes(null), null);
});

test('a picture too wide for a page is scaled down, keeping its shape', () => {
    const fitted = Core.fitImage({ width: 2000, height: 1000 });
    assert.strictEqual(fitted.width, Core.MAX_IMAGE_WIDTH_PT);
    assert.strictEqual(fitted.height, Core.MAX_IMAGE_WIDTH_PT / 2, 'the picture was stretched');
});

test('a small picture keeps its own size, converted to points', () => {
    assert.deepStrictEqual(Core.fitImage({ width: 100, height: 50 }), { width: 75, height: 38 });
});

test('a picture that would not say how big it is still gets into the document', () => {
    // Leaving it out is worse than showing it at a size nobody chose.
    const fitted = Core.fitImage(null);
    assert.ok(fitted.width > 0 && fitted.height > 0);
});

test('the toolbar now offers Word sizes in points, and they survive exactly', () => {
    // The size dropdown moved from pixels to points so a document written at
    // 12pt exports as 12pt, rather than arriving via a conversion that lands
    // half a point out. Every value the toolbar offers has to come through
    // untouched.
    ['8', '9', '10', '10.5', '11', '12', '14', '16', '18', '20',
     '22', '24', '26', '28', '36', '48', '72'].forEach(size => {
        assert.strictEqual(Core.fontSizeToPoints(size + 'pt'), Number(size), size + 'pt');
    });
});
