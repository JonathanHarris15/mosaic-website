const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const zlib = require('node:zlib');

// Does a Note Body actually come out the other end as a Word file?
//
// `document-docx-core.test.js` proves the WALK is right — which marks survive,
// how a nested list keeps its level. It cannot prove the file opens, because it
// never builds one. This does: it loads the same vendored bundle the browser
// loads, builds a real .docx, then unzips it and reads the XML Word would read.
//
// What it cannot check is what Word itself makes of the file. Nothing in a test
// runner can. It checks the things that would actually be wrong — a part
// missing, a mark that never made it into the XML, a list with no numbering
// behind it.

const PUBLIC = path.join(__dirname, '..', 'public');
const Core = require('../public/document-docx-core.js');
const DocumentDocx = require('../public/document-docx.js');

// ── The vendored library, loaded the way the page loads it ───────────────────

let cachedLib = null;
function docxLibrary() {
    if (cachedLib) return cachedLib;
    const source = fs.readFileSync(path.join(PUBLIC, 'vendor', 'docx-9.7.1.iife.js'), 'utf8');
    const sandbox = {
        console, setTimeout, clearTimeout, TextEncoder, TextDecoder,
        Uint8Array, ArrayBuffer, Math, Date, JSON, Promise, Object, Array,
        String, Number, Boolean, Error, RegExp, Map, Set, Symbol, Buffer, process,
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    sandbox.self = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(source, sandbox, { filename: 'docx-9.7.1.iife.js' });
    cachedLib = sandbox.docx;
    assert.ok(cachedLib && cachedLib.Packer, 'the vendored docx bundle did not define what it should');
    return cachedLib;
}

// ── Just enough zip to read one part back out ────────────────────────────────
//
// A .docx is a zip of XML. Read the central directory (which always carries
// honest sizes and offsets), find the part, inflate it.
function readZipEntry(buffer, wanted) {
    const end = buffer.lastIndexOf(Buffer.from('PK\x05\x06', 'binary'));
    assert.ok(end !== -1, 'not a zip file at all');

    const count = buffer.readUInt16LE(end + 10);
    let at = buffer.readUInt32LE(end + 16);

    for (let i = 0; i < count; i++) {
        const nameLength = buffer.readUInt16LE(at + 28);
        const extraLength = buffer.readUInt16LE(at + 30);
        const commentLength = buffer.readUInt16LE(at + 32);
        const name = buffer.toString('utf8', at + 46, at + 46 + nameLength);
        const method = buffer.readUInt16LE(at + 10);
        const compressedSize = buffer.readUInt32LE(at + 20);
        const localAt = buffer.readUInt32LE(at + 42);

        if (name === wanted) {
            const localNameLength = buffer.readUInt16LE(localAt + 26);
            const localExtraLength = buffer.readUInt16LE(localAt + 28);
            const from = localAt + 30 + localNameLength + localExtraLength;
            const raw = buffer.subarray(from, from + compressedSize);
            return (method === 0 ? raw : zlib.inflateRawSync(raw)).toString('utf8');
        }
        at += 46 + nameLength + extraLength + commentLength;
    }
    return null;
}

function zipEntryNames(buffer) {
    const names = [];
    const end = buffer.lastIndexOf(Buffer.from('PK\x05\x06', 'binary'));
    const count = buffer.readUInt16LE(end + 10);
    let at = buffer.readUInt32LE(end + 16);
    for (let i = 0; i < count; i++) {
        const nameLength = buffer.readUInt16LE(at + 28);
        names.push(buffer.toString('utf8', at + 46, at + 46 + nameLength));
        at += 46 + nameLength + buffer.readUInt16LE(at + 30) + buffer.readUInt16LE(at + 32);
    }
    return names;
}

async function wordFileFrom(tiptapDoc, options) {
    const lib = docxLibrary();
    const blocks = Core.docxBlocksFromTiptap(tiptapDoc, options);
    const document = DocumentDocx.buildWordDocument(lib, blocks, options || {});
    return await lib.Packer.toBuffer(document);
}

const doc = content => ({ type: 'doc', content: content });
const text = (t, marks) => marks ? { type: 'text', text: t, marks: marks } : { type: 'text', text: t };
const para = content => ({ type: 'paragraph', content: content });

// ── The file itself ───────────────────────────────────────────────────────────

test('a note comes out as a real Word file, with the parts Word looks for', async () => {
    const buffer = await wordFileFrom(doc([para([text('Hello')])]));

    assert.strictEqual(buffer.subarray(0, 2).toString('binary'), 'PK', 'not a zip');
    const names = zipEntryNames(buffer);
    ['[Content_Types].xml', '_rels/.rels', 'word/document.xml'].forEach(part => {
        assert.ok(names.includes(part), 'missing ' + part + ' — Word will call this corrupt');
    });
});

test('the words a person typed are in the file', async () => {
    const buffer = await wordFileFrom(doc([
        para([text('Spoke with the family on Tuesday.')]),
    ]));
    const xml = readZipEntry(buffer, 'word/document.xml');
    assert.match(xml, /Spoke with the family on Tuesday\./);
});

test('an empty note still produces a file that opens', async () => {
    // A document with no paragraph at all is reported by Word as corrupt
    // rather than as empty, which is a much worse thing to hand somebody.
    const buffer = await wordFileFrom(doc([]));
    const xml = readZipEntry(buffer, 'word/document.xml');
    assert.match(xml, /<w:p[ />]/, 'a Word file needs at least one paragraph');
});

// ── Formatting, as Word records it ────────────────────────────────────────────

test('bold, italic and underline reach the XML', async () => {
    const buffer = await wordFileFrom(doc([para([
        text('b', [{ type: 'bold' }]),
        text('i', [{ type: 'italic' }]),
        text('u', [{ type: 'underline' }]),
    ])]));
    const xml = readZipEntry(buffer, 'word/document.xml');
    assert.match(xml, /<w:b\b/, 'bold did not survive');
    assert.match(xml, /<w:i\b/, 'italic did not survive');
    assert.match(xml, /<w:u\b/, 'underline did not survive');
});

test('a highlight becomes shading in the colour it was written in', async () => {
    const buffer = await wordFileFrom(doc([para([
        text('marked', [{ type: 'highlight', attrs: { color: '#ff0000' } }]),
    ])]));
    const xml = readZipEntry(buffer, 'word/document.xml');
    assert.match(xml, /FF0000/, 'the highlight colour is not in the file');
});

test('a font size in pixels arrives in Word as half-points', async () => {
    // 24px → 18pt → 36 half-points. Getting this wrong makes every exported
    // document subtly the wrong size, which nobody reports as a bug.
    const buffer = await wordFileFrom(doc([para([
        text('big', [{ type: 'textStyle', attrs: { fontSize: '24px' } }]),
    ])]));
    const xml = readZipEntry(buffer, 'word/document.xml');
    assert.match(xml, /w:sz w:val="36"/);
});

test('a heading is a real Word heading, not just big text', async () => {
    const buffer = await wordFileFrom(doc([
        { type: 'heading', attrs: { level: 2 }, content: [text('Prayer')] },
    ]));
    const xml = readZipEntry(buffer, 'word/document.xml');
    assert.match(xml, /w:pStyle w:val="Heading2"/);
});

test('a link is a link, not blue text', async () => {
    const buffer = await wordFileFrom(doc([para([
        text('the rota', [{ type: 'link', attrs: { href: 'https://example.org/rota' } }]),
    ])]));
    assert.match(readZipEntry(buffer, 'word/document.xml'), /<w:hyperlink/);
    const rels = readZipEntry(buffer, 'word/_rels/document.xml.rels');
    assert.match(rels, /example\.org\/rota/, 'the address is not recorded anywhere');
});

// ── Lists ─────────────────────────────────────────────────────────────────────

test('a list is numbered by Word, with a definition behind it', async () => {
    const buffer = await wordFileFrom(doc([
        { type: 'bulletList', content: [
            { type: 'listItem', content: [para([text('first')])] },
            { type: 'listItem', content: [
                para([text('second')]),
                { type: 'orderedList', content: [
                    { type: 'listItem', content: [para([text('nested')])] },
                ] },
            ] },
        ] },
    ]));

    const xml = readZipEntry(buffer, 'word/document.xml');
    assert.match(xml, /<w:numPr>/, 'the list items are not numbered paragraphs');
    assert.match(xml, /w:ilvl w:val="1"/, 'the nested item lost its level');

    // A numPr pointing at a definition that is not in the file is how a list
    // opens in Word as unindented plain paragraphs.
    const names = zipEntryNames(buffer);
    assert.ok(names.includes('word/numbering.xml'), 'no numbering definitions in the file');
});

// ── Tables ────────────────────────────────────────────────────────────────────

test('a table is a table, with its header row and its text', async () => {
    const cell = (type, t) => ({ type: type, content: [para([text(t)])] });
    const buffer = await wordFileFrom(doc([
        { type: 'table', content: [
            { type: 'tableRow', content: [cell('tableHeader', 'Name'), cell('tableHeader', 'Role')] },
            { type: 'tableRow', content: [cell('tableCell', 'Bethany'), cell('tableCell', 'Welcome')] },
        ] },
    ]));

    const xml = readZipEntry(buffer, 'word/document.xml');
    assert.match(xml, /<w:tbl>/);
    assert.strictEqual((xml.match(/<w:tr\b/g) || []).length, 2, 'wrong number of rows');
    assert.match(xml, /Bethany/);
    assert.match(xml, /F2F2F2/, 'the header row lost its shading');
});

// ── The title ─────────────────────────────────────────────────────────────────

test('the document title leads the file as a heading', async () => {
    const lib = docxLibrary();
    const blocks = Core.docxBlocksFromTiptap(doc([para([text('Attendance was thin')])]));
    const buffer = await lib.Packer.toBuffer(
        DocumentDocx.buildWordDocument(lib, blocks, { title: 'Elders Meeting' }));

    const xml = readZipEntry(buffer, 'word/document.xml');
    assert.match(xml, /Elders Meeting/);
    assert.ok(xml.indexOf('Elders Meeting') < xml.indexOf('Attendance was thin'),
        'the title is not first');
    assert.match(xml, /w:pStyle w:val="Heading1"/);
});

// ── Colour parsing, the one fiddly bit in the thin layer ─────────────────────

test('a colour is written the way Word writes one: six hex digits, no hash', () => {
    assert.strictEqual(DocumentDocx.hexOnly('#fef08a'), 'FEF08A');
    assert.strictEqual(DocumentDocx.hexOnly('FEF08A'), 'FEF08A');
    assert.strictEqual(DocumentDocx.hexOnly('yellow'), null);
    assert.strictEqual(DocumentDocx.hexOnly('#fff'), null);
    assert.strictEqual(DocumentDocx.hexOnly(null), null);
});
