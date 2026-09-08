// Markdown in, Note Body out, and back again (MS-278 / MS-408).
//
// ⚠ WHAT THIS PROVES. An assistant writes prose. Mosaic stores every Note Body
// as TipTap JSON — a Shepherding Note, Meeting Minutes, an Elder Document and
// an Event Document all the same. Until now the only converter went one way,
// TipTap → plain text, for list previews. A note an agent writes has to arrive
// as a real document: headings that are headings, lists that are lists, bold
// that survives being opened in the Note Module and edited by hand.
//
// The direction that must be lossless is markdown → TipTap → markdown, because
// that is an agent's own words going in and coming back. TipTap → markdown is a
// faithful READING of a document somebody else typed, and drops what markdown
// has no way to say — alignment, font size, colour, the bytes of a pasted
// picture. Those are recorded as deliberate below, not as gaps.

const {describe, test} = require('node:test');
const assert = require('node:assert');

const Core = require('../public/note-markdown-core.js');

/** markdown → TipTap → markdown, which is the trip that must not lose anything. */
function roundTrip(markdown) {
    return Core.toMarkdown(Core.fromMarkdown(markdown));
}

/** The first block of a parsed document, for asserting on shape. */
function firstBlock(markdown) {
    return Core.fromMarkdown(markdown).content[0];
}

describe('what an agent writes becomes a real document', () => {
    test('a plain sentence is a paragraph, not a blob of text', () => {
        const doc = Core.fromMarkdown('Visited Sarah on Tuesday.');
        assert.strictEqual(doc.type, 'doc');
        assert.deepStrictEqual(doc.content, [{
            type: 'paragraph',
            content: [{type: 'text', text: 'Visited Sarah on Tuesday.'}],
        }]);
    });

    test('blank lines separate paragraphs', () => {
        const doc = Core.fromMarkdown('First thing.\n\nSecond thing.');
        assert.strictEqual(doc.content.length, 2);
        assert.strictEqual(doc.content[1].content[0].text, 'Second thing.');
    });

    test('lines inside one paragraph stay in one paragraph', () => {
        // An agent wrapping its own prose must not produce a paragraph per line.
        const doc = Core.fromMarkdown('Visited Sarah\non Tuesday.');
        assert.strictEqual(doc.content.length, 1);
        assert.strictEqual(doc.content[0].content[0].text, 'Visited Sarah on Tuesday.');
    });

    test('an empty document is the same empty document the editor makes', () => {
        assert.deepStrictEqual(Core.fromMarkdown(''), Core.emptyBody());
        assert.deepStrictEqual(Core.fromMarkdown('   \n\n  '), Core.emptyBody());
    });

    test('nothing in, nothing out', () => {
        assert.strictEqual(Core.toMarkdown(null), '');
        assert.strictEqual(Core.toMarkdown(Core.emptyBody()), '');
    });
});

describe('headings', () => {
    test('all six levels survive the round trip', () => {
        for (let level = 1; level <= 6; level += 1) {
            const md = '#'.repeat(level) + ' Pastoral concerns';
            const block = firstBlock(md);
            assert.strictEqual(block.type, 'heading');
            assert.strictEqual(block.attrs.level, level);
            assert.strictEqual(roundTrip(md), md);
        }
    });

    test('a seventh hash is not a heading, it is text', () => {
        assert.strictEqual(firstBlock('####### too deep').type, 'paragraph');
    });

    test('a hash with no space is not a heading either', () => {
        assert.strictEqual(firstBlock('#notaheading').type, 'paragraph');
    });
});

describe('the marks an elder actually uses', () => {
    const cases = [
        ['bold', '**visited twice**', 'bold'],
        ['italic with stars', '*gently*', 'italic'],
        ['italic with underscores', '_gently_', 'italic'],
        ['highlight', '==follow up==', 'highlight'],
        ['underline', '<u>urgent</u>', 'underline'],
    ];

    cases.forEach(([name, md, markType]) => {
        test(name + ' arrives as a mark on the text', () => {
            const para = firstBlock(md);
            const text = para.content[0];
            assert.ok(text.marks.some((m) => m.type === markType),
                `${name}: expected a ${markType} mark, got ` + JSON.stringify(text.marks));
        });
    });

    test('bold and italic survive the round trip in their own spelling', () => {
        assert.strictEqual(roundTrip('**visited twice**'), '**visited twice**');
        assert.strictEqual(roundTrip('*gently*'), '*gently*');
        // Underscore italic normalises to stars. One spelling out, so a note
        // read twice reads the same twice.
        assert.strictEqual(roundTrip('_gently_'), '*gently*');
    });

    test('highlight and underline survive too', () => {
        assert.strictEqual(roundTrip('==follow up=='), '==follow up==');
        assert.strictEqual(roundTrip('<u>urgent</u>'), '<u>urgent</u>');
    });

    test('marks combine on the same run of text', () => {
        const text = firstBlock('**_both_**').content[0];
        const types = text.marks.map((m) => m.type).sort();
        assert.deepStrictEqual(types, ['bold', 'italic']);
    });

    test('a mark mid-sentence splits the text without losing a character', () => {
        const para = firstBlock('Spoke to **Sarah** on Tuesday.');
        const rebuilt = para.content.map((n) => n.text).join('');
        assert.strictEqual(rebuilt, 'Spoke to Sarah on Tuesday.');
        assert.strictEqual(para.content.length, 3);
    });

    test('an escaped star is a star, not a mark', () => {
        const para = firstBlock('2 \\* 3 is six');
        assert.strictEqual(para.content[0].text, '2 * 3 is six');
        assert.ok(!para.content[0].marks || !para.content[0].marks.length);
    });

    test('an unclosed mark is left alone rather than swallowing the rest', () => {
        const para = firstBlock('a ** dangling star');
        assert.strictEqual(para.content.map((n) => n.text).join(''), 'a ** dangling star');
    });
});

describe('links', () => {
    test('a link carries its href', () => {
        const text = firstBlock('See [the form](https://example.com/f).').content[1];
        const link = text.marks.find((m) => m.type === 'link');
        assert.strictEqual(link.attrs.href, 'https://example.com/f');
        assert.strictEqual(text.text, 'the form');
    });

    test('a link survives the round trip', () => {
        const md = 'See [the form](https://example.com/f).';
        assert.strictEqual(roundTrip(md), md);
    });
});

describe('lists', () => {
    test('a bullet list is a bulletList of listItems', () => {
        const list = firstBlock('- milk\n- bread');
        assert.strictEqual(list.type, 'bulletList');
        assert.strictEqual(list.content.length, 2);
        assert.strictEqual(list.content[0].type, 'listItem');
        assert.strictEqual(list.content[0].content[0].type, 'paragraph');
    });

    test('a numbered list is an orderedList', () => {
        const list = firstBlock('1. first\n2. second');
        assert.strictEqual(list.type, 'orderedList');
        assert.strictEqual(list.content.length, 2);
    });

    test('both survive the round trip', () => {
        assert.strictEqual(roundTrip('- milk\n- bread'), '- milk\n- bread');
        assert.strictEqual(roundTrip('1. first\n2. second'), '1. first\n2. second');
    });

    test('a nested list nests, and comes back indented', () => {
        const md = '- visits\n  - Sarah\n  - Tom\n- calls';
        const list = firstBlock(md);
        const nested = list.content[0].content[1];
        assert.strictEqual(nested.type, 'bulletList');
        assert.strictEqual(nested.content.length, 2);
        assert.strictEqual(roundTrip(md), md);
    });

    test('marks work inside a list item', () => {
        const item = firstBlock('- spoke to **Sarah**');
        const texts = item.content[0].content[0].content;
        assert.ok(texts[1].marks.some((m) => m.type === 'bold'));
    });

    test('a list ends at a blank line', () => {
        const doc = Core.fromMarkdown('- milk\n\nThen home.');
        assert.strictEqual(doc.content.length, 2);
        assert.strictEqual(doc.content[1].type, 'paragraph');
    });
});

describe('blockquotes and rules', () => {
    test('a blockquote wraps its paragraph', () => {
        const quote = firstBlock('> she said she was tired');
        assert.strictEqual(quote.type, 'blockquote');
        assert.strictEqual(quote.content[0].type, 'paragraph');
        assert.strictEqual(roundTrip('> she said she was tired'),
            '> she said she was tired');
    });

    test('three dashes is a horizontal rule', () => {
        assert.strictEqual(firstBlock('---').type, 'horizontalRule');
        assert.strictEqual(roundTrip('---'), '---');
    });
});

describe('tables', () => {
    const MD = [
        '| Person | Last visit |',
        '| --- | --- |',
        '| Sarah | March |',
        '| Tom | never |',
    ].join('\n');

    test('a pipe table becomes a table with a header row', () => {
        const table = firstBlock(MD);
        assert.strictEqual(table.type, 'table');
        assert.strictEqual(table.content.length, 3);
        assert.strictEqual(table.content[0].content[0].type, 'tableHeader');
        assert.strictEqual(table.content[1].content[0].type, 'tableCell');
    });

    test('a cell holds a paragraph, which is what the editor expects', () => {
        const cell = firstBlock(MD).content[1].content[0];
        assert.strictEqual(cell.content[0].type, 'paragraph');
        assert.strictEqual(cell.content[0].content[0].text, 'Sarah');
    });

    test('a table survives the round trip', () => {
        assert.strictEqual(roundTrip(MD), MD);
    });

    test('a ragged row is padded rather than losing the row', () => {
        const table = firstBlock('| a | b |\n| --- | --- |\n| only one |');
        assert.strictEqual(table.content[1].content.length, 2);
    });
});

describe('hard breaks', () => {
    test('a trailing backslash breaks the line inside one paragraph', () => {
        const para = firstBlock('first line\\\nsecond line');
        assert.strictEqual(para.type, 'paragraph');
        assert.ok(para.content.some((n) => n.type === 'hardBreak'));
        assert.strictEqual(roundTrip('first line\\\nsecond line'),
            'first line\\\nsecond line');
    });
});

describe('reading back a document somebody else typed', () => {
    test('a Cross-Reference reads as the name it points at', () => {
        const doc = {
            type: 'doc',
            content: [{
                type: 'paragraph',
                content: [
                    {type: 'text', text: 'Spoke with '},
                    {
                        type: 'mention',
                        attrs: {id: '{"kind":"person","id":"p1"}', label: 'Sarah Bell'},
                    },
                ],
            }],
        };
        assert.strictEqual(Core.toMarkdown(doc), 'Spoke with @Sarah Bell');
    });

    test('a picture is named, never dumped', () => {
        // A picture rides inside the Note Body as a data URI. Reading one out
        // verbatim would hand an assistant a megabyte of base64 in place of a
        // sentence.
        const doc = {
            type: 'doc',
            content: [{
                type: 'image',
                attrs: {src: 'data:image/png;base64,' + 'A'.repeat(5000), alt: 'the rota'},
            }],
        };
        const md = Core.toMarkdown(doc);
        assert.ok(md.length < 80, md.slice(0, 80));
        assert.match(md, /the rota/);
        assert.ok(!md.includes('base64'));
    });

    test('a Person Panel reads as the person it is about', () => {
        const doc = {
            type: 'doc',
            content: [{
                type: 'personPanel',
                attrs: {personName: 'Tom Reed', noteType: 'Elder Meeting', personId: 'p2'},
            }],
        };
        assert.match(Core.toMarkdown(doc), /Tom Reed/);
        assert.match(Core.toMarkdown(doc), /Elder Meeting/);
    });

    test('presentation-only attributes are dropped, not mangled', () => {
        // Alignment, font and colour have no markdown spelling. Reading a
        // centred paragraph gives the words, without inventing syntax for how
        // they were placed.
        const doc = {
            type: 'doc',
            content: [{
                type: 'paragraph',
                attrs: {textAlign: 'center'},
                content: [{
                    type: 'text',
                    text: 'Notice',
                    marks: [{type: 'textStyle', attrs: {fontSize: '24px'}}],
                }],
            }],
        };
        assert.strictEqual(Core.toMarkdown(doc), 'Notice');
    });

    test('an unknown node is read for its words rather than dropped', () => {
        const doc = {
            type: 'doc',
            content: [{
                type: 'somethingNew',
                content: [{type: 'text', text: 'still worth reading'}],
            }],
        };
        assert.match(Core.toMarkdown(doc), /still worth reading/);
    });
});

describe('appending to a note that already exists', () => {
    test('the new words land after the old ones, in one document', () => {
        const existing = Core.fromMarkdown('Visited Tuesday.');
        const grown = Core.appendMarkdown(existing, 'Called again Friday.');
        assert.strictEqual(grown.content.length, 2);
        assert.strictEqual(Core.toMarkdown(grown),
            'Visited Tuesday.\n\nCalled again Friday.');
    });

    test('appending to an empty note does not leave a blank first paragraph', () => {
        const grown = Core.appendMarkdown(Core.emptyBody(), 'First thing said.');
        assert.strictEqual(grown.content.length, 1);
        assert.strictEqual(Core.toMarkdown(grown), 'First thing said.');
    });

    test('appending nothing leaves the note exactly as it was', () => {
        const existing = Core.fromMarkdown('Visited Tuesday.');
        assert.deepStrictEqual(Core.appendMarkdown(existing, '   '), existing);
    });

    test('appending never mutates the document it was given', () => {
        const existing = Core.fromMarkdown('Visited Tuesday.');
        Core.appendMarkdown(existing, 'Called again Friday.');
        assert.strictEqual(existing.content.length, 1);
    });
});

describe('the whole trip, on a note an elder would actually write', () => {
    test('survives intact', () => {
        const md = [
            '## Elder meeting, 4 September',
            '',
            'Present: **Sam**, *Jonathan*, Ruth.',
            '',
            '### Follow-ups',
            '',
            '- Sarah Bell — surgery on the 12th, ==visit before then==',
            '  - her mother is staying',
            '- Tom Reed — no contact since June',
            '',
            '| Person | Last visit |',
            '| --- | --- |',
            '| Sarah | March |',
            '',
            '> "we should be quicker with the new families"',
            '',
            'Agreed to review at the [next meeting](https://example.com/m).',
        ].join('\n');

        assert.strictEqual(roundTrip(md), md);
    });
});
