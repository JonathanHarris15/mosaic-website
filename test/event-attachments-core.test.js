const { test } = require('node:test');
const assert = require('node:assert');

// MS-287 — the pure model behind an Event Attachment: a file (a flyer, a sign-up
// sheet, a floor plan — whatever Google Drive would have taken, now in our own
// Storage) attached to one Event occurrence.
//
// Everything here is a pure function of its inputs, so everything here is
// tested as one. No Firestore, no Storage, no browser.

const Core = require('../public/event-attachments-core.js');

// ── The cap, restated in a rules language this module cannot reach ───────────
//
// `storage.rules` cannot `require()` this module — it is a different engine
// entirely — so it restates MAX_ATTACHMENT_BYTES as its own literal. Nothing
// stops the two drifting apart except this test actually reading both and
// checking they still agree.

test('the Storage rule refuses at the same size this module does', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const rules = fs.readFileSync(path.join(__dirname, '..', 'storage.rules'), 'utf8');
    const block = /match \/event_attachments\/\{occurrenceId\}\/\{attachmentId\}\/\{fileName\}\s*\{([\s\S]*?)\n    \}/
        .exec(rules);
    assert.ok(block, 'the Event Attachments Storage rule has moved or been renamed');

    const size = /request\.resource\.size\s*<\s*(\d+)\s*\*\s*1024\s*\*\s*1024/.exec(block[1]);
    assert.ok(size, 'the Storage rule no longer states its cap in MB the same way');
    assert.strictEqual(Number(size[1]) * 1024 * 1024, Core.MAX_ATTACHMENT_BYTES,
        'the Storage rule and EventAttachmentsCore.MAX_ATTACHMENT_BYTES have drifted apart');
});

// ── Validating a file before it is ever uploaded ──────────────────────────────

test('a normal file is accepted', () => {
    const result = Core.validateAttachmentFile({ name: 'order-of-service.pdf', size: 2 * 1024 * 1024 });
    assert.deepStrictEqual(result, { ok: true, error: null });
});

test('no file at all is refused', () => {
    const result = Core.validateAttachmentFile(null);
    assert.strictEqual(result.ok, false);
    assert.match(result.error, /choose a file/i);
});

test('a file with no name is refused', () => {
    const result = Core.validateAttachmentFile({ name: '', size: 100 });
    assert.strictEqual(result.ok, false);
});

test('a file over the size cap is refused, and the cap is named in the message', () => {
    const result = Core.validateAttachmentFile({ name: 'big.mov', size: Core.MAX_ATTACHMENT_BYTES + 1 });
    assert.strictEqual(result.ok, false);
    assert.match(result.error, /25\s?MB/);
});

test('a file exactly at the cap is accepted — the cap is a ceiling, not a floor', () => {
    const result = Core.validateAttachmentFile({ name: 'right-at-it.zip', size: Core.MAX_ATTACHMENT_BYTES });
    assert.strictEqual(result.ok, true);
});

test('any file type is accepted — the church can attach a .docx, a .pdf, a .png, anything', () => {
    ['flyer.png', 'minutes.docx', 'plan.pdf', 'notes.txt', 'archive.zip'].forEach(name => {
        const result = Core.validateAttachmentFile({ name: name, size: 1024 });
        assert.strictEqual(result.ok, true, name + ' should be accepted');
    });
});

// ── Human-readable size ───────────────────────────────────────────────────────

test('formatFileSize reads naturally at each scale', () => {
    assert.strictEqual(Core.formatFileSize(0), '0 B');
    assert.strictEqual(Core.formatFileSize(512), '512 B');
    assert.strictEqual(Core.formatFileSize(1024), '1 KB');
    assert.strictEqual(Core.formatFileSize(1536), '1.5 KB');
    assert.strictEqual(Core.formatFileSize(5 * 1024 * 1024), '5 MB');
    assert.strictEqual(Core.formatFileSize(2.5 * 1024 * 1024), '2.5 MB');
});

// ── Where the bytes live ──────────────────────────────────────────────────────

test('every attachment gets its own path, under its own occurrence and its own id', () => {
    const path = Core.storagePath('picnic_2026-07-11', 'att123', 'Order of Service.pdf');
    assert.strictEqual(path, 'event_attachments/picnic_2026-07-11/att123/Order of Service.pdf');
});

test('a filename cannot smuggle in an extra path segment', () => {
    const path = Core.storagePath('picnic_2026-07-11', 'att123', '../../etc/passwd');
    assert.strictEqual(path.split('/').length, 4, 'the filename must not add slashes of its own');
    assert.ok(path.startsWith('event_attachments/picnic_2026-07-11/att123/'));
});

// ── The record shape, decided in one place ────────────────────────────────────

test('buildAttachmentRecord fills every field the store and the UI both depend on', () => {
    const record = Core.buildAttachmentRecord({
        name: 'Order of Service.pdf',
        contentType: 'application/pdf',
        size: 12345,
        storagePath: 'event_attachments/picnic_2026-07-11/att123/Order of Service.pdf',
        uploadedBy: 'uid1',
        uploadedByName: 'Bethany Croft',
        uploadedAt: 't',
    });
    assert.deepStrictEqual(record, {
        name: 'Order of Service.pdf',
        contentType: 'application/pdf',
        size: 12345,
        storagePath: 'event_attachments/picnic_2026-07-11/att123/Order of Service.pdf',
        uploadedBy: 'uid1',
        uploadedByName: 'Bethany Croft',
        uploadedAt: 't',
    });
});

// The hole MS-287 shipped with: a `url` field held what getDownloadURL()
// returned, which serves the file to anyone holding the link — signed out,
// forever, whatever storage.rules says about who may see the Event. A record
// that carries no such link cannot leak one.
test('the record carries no public URL, only the path behind the rule', () => {
    const record = Core.buildAttachmentRecord({
        name: 'a.pdf', storagePath: 'event_attachments/x/y/a.pdf',
        url: 'https://files.example/leaked-forever',
    });
    assert.ok(!('url' in record),
        'a public download link is back in the record — see ADR-0046');
});

test('buildAttachmentRecord never invents a field it was not given', () => {
    const record = Core.buildAttachmentRecord({ name: 'a.txt', size: 1 });
    assert.strictEqual(record.contentType, null);
    assert.strictEqual(record.uploadedByName, null);
});

// ── Picking an icon by what the file is ───────────────────────────────────────

test('materialIconFor reads the shape of the file, not its bytes', () => {
    assert.strictEqual(Core.materialIconFor('report.pdf'), 'picture_as_pdf');
    assert.strictEqual(Core.materialIconFor('minutes.docx'), 'description');
    assert.strictEqual(Core.materialIconFor('rota.xlsx'), 'table_chart');
    assert.strictEqual(Core.materialIconFor('flyer.png'), 'image');
    assert.strictEqual(Core.materialIconFor('flyer.JPG'), 'image');
    assert.strictEqual(Core.materialIconFor('talk.pptx'), 'slideshow');
    assert.strictEqual(Core.materialIconFor('mystery.xyz'), 'attach_file');
    assert.strictEqual(Core.materialIconFor(''), 'attach_file');
});

test('fileExtension reads the same letters the icon is chosen from', () => {
    assert.strictEqual(Core.fileExtension('report.pdf'), 'PDF');
    assert.strictEqual(Core.fileExtension('flyer.JPG'), 'JPG');
    assert.strictEqual(Core.fileExtension('no-extension'), '');
});

// ── Which files can be SHOWN rather than only saved (ADR-0047) ────────────────
//
// The ask was "let me open it like Google Drive would". Drive's first door is
// Google's own servers fetching the file from a public link, which an Event
// Attachment does not have and must not get (ADR-0046) — so the door is ours,
// and this is the list of what is behind it.

test('the files Drive would open in a viewer are the files this opens in one', () => {
    const shown = {
        'order-of-service.pdf': 'pdf',
        'flyer.png': 'image',
        'photo.JPG': 'image',
        'sign.webp': 'image',
        'logo.svg': 'image',
        'minutes.docx': 'docx',
        'notes.txt': 'text',
        'readme.md': 'text',
        'rota.csv': 'sheet',
        'export.tsv': 'sheet',
        'talk.mp3': 'audio',
        'service.mp4': 'video',
    };
    Object.keys(shown).forEach(name => {
        assert.strictEqual(Core.previewKindFor(name), shown[name], name + ' should open in a viewer');
        assert.strictEqual(Core.canPreview(name), true, name);
    });
});

test('a file with no viewer says so, rather than opening an empty box', () => {
    // .doc, .xls and .ppt are the pre-2007 binaries; .xlsx and .pptx need a
    // parser this app does not carry. All four download, which is what Drive
    // itself falls back to for anything it cannot read.
    ['archive.zip', 'talk.pptx', 'rota.xlsx', 'letter.doc', 'book.xls',
     'deck.ppt', 'letter.rtf', 'mystery.xyz', 'no-extension'].forEach(name => {
        assert.strictEqual(Core.previewKindFor(name), null, name + ' has no viewer');
        assert.strictEqual(Core.canPreview(name), false, name);
        assert.strictEqual(Core.previewVerbFor(name), null, name);
    });
});

test('a picture only Safari can draw is treated as one nobody can', () => {
    // A broken image in a box is a worse answer than "save it to look at it".
    assert.strictEqual(Core.previewKindFor('holiday.heic'), null);
    assert.strictEqual(Core.previewKindFor('scan.tiff'), null);
    assert.strictEqual(Core.previewKindFor('x', 'image/heic'), null);
});

test('a file whose name says nothing falls back to what the browser called it', () => {
    assert.strictEqual(Core.previewKindFor('scan', 'application/pdf'), 'pdf');
    assert.strictEqual(Core.previewKindFor('', 'image/png'), 'image');
    assert.strictEqual(Core.previewKindFor('untitled', 'text/csv'), 'sheet');
    assert.strictEqual(Core.previewKindFor('untitled', 'text/plain; charset=utf-8'), 'text');
    assert.strictEqual(Core.previewKindFor('untitled', 'application/octet-stream'), null);
    assert.strictEqual(Core.previewKindFor('untitled', null), null);
});

test('the name wins over the recorded type, because the name is the thing read', () => {
    // Browsers routinely record a .docx as a zip, which is technically true and
    // completely unhelpful.
    assert.strictEqual(Core.previewKindFor('minutes.docx', 'application/zip'), 'docx');
});

test('the button names the door after what is behind it', () => {
    assert.strictEqual(Core.previewVerbFor('flyer.pdf'), 'View');
    assert.strictEqual(Core.previewVerbFor('sermon.mp3'), 'Play');
    assert.strictEqual(Core.previewVerbFor('service.mp4'), 'Play');
    assert.strictEqual(Core.previewVerbFor('archive.zip'), null);
});

// ── A tab of its own is a narrower offer than full screen ─────────────────────

test('only the files the BROWSER draws are trusted with a tab of their own', () => {
    ['pdf', 'image', 'video', 'audio'].forEach(kind => {
        assert.strictEqual(Core.previewOpensInOwnTab(kind), true, kind);
    });
});

test('a file this page renders itself stays on this page', () => {
    // 'text' is the one that matters: a .txt in a tab is harmless, a .html in a
    // tab runs its own script under this site's origin, and both arrive here as
    // 'text'. Full screen is the answer for all three — same page, just bigger.
    ['text', 'sheet', 'docx', null, undefined].forEach(kind => {
        assert.strictEqual(Core.previewOpensInOwnTab(kind), false, String(kind));
    });
});

// ── Reading a .csv as the table it is ─────────────────────────────────────────

test('a spreadsheet is split into rows and cells', () => {
    const rows = Core.parseDelimitedRows('Name,Role\nBethany,Welcome\nTom,Sound\n');
    assert.deepStrictEqual(rows, [
        ['Name', 'Role'],
        ['Bethany', 'Welcome'],
        ['Tom', 'Sound'],
    ]);
});

test('a cell may hold a comma, a quote, or a line break of its own', () => {
    const rows = Core.parseDelimitedRows('"Croft, Bethany","She said ""yes"""\n"two\nlines",plain');
    assert.deepStrictEqual(rows, [
        ['Croft, Bethany', 'She said "yes"'],
        ['two\nlines', 'plain'],
    ]);
});

test('a file saved on Windows does not gain a stray carriage return', () => {
    assert.deepStrictEqual(Core.parseDelimitedRows('a,b\r\nc,d\r\n'), [['a', 'b'], ['c', 'd']]);
});

test('a file ending mid-line still shows its last row', () => {
    assert.deepStrictEqual(Core.parseDelimitedRows('a,b\nc,d'), [['a', 'b'], ['c', 'd']]);
});

test('nothing at all is no rows, not one empty one', () => {
    assert.deepStrictEqual(Core.parseDelimitedRows(''), []);
    assert.deepStrictEqual(Core.parseDelimitedRows(null), []);
});

test('a .tsv is split on tabs, a .csv on commas', () => {
    assert.strictEqual(Core.delimiterFor('export.tsv'), '\t');
    assert.strictEqual(Core.delimiterFor('rota.csv'), ',');
    assert.deepStrictEqual(
        Core.parseDelimitedRows('a\tb\nc\td', Core.delimiterFor('export.tsv')),
        [['a', 'b'], ['c', 'd']]);
});

// ── A long file is cut before it reaches the page ─────────────────────────────

test('a short file is shown whole', () => {
    assert.deepStrictEqual(Core.truncateForPreview('hello'), { text: 'hello', truncated: false });
});

test('a very long file is cut, and says it was', () => {
    const long = 'x'.repeat(Core.MAX_PREVIEW_CHARACTERS + 500);
    const cut = Core.truncateForPreview(long);
    assert.strictEqual(cut.text.length, Core.MAX_PREVIEW_CHARACTERS);
    assert.strictEqual(cut.truncated, true);
});

// ── The one kind that arrives as markup ───────────────────────────────────────
//
// mammoth's output is written into the page, and a Word hyperlink carries
// whatever address it was given.

test('a docx cannot bring script into the page it is shown on', () => {
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

// ── When it was uploaded, read back ───────────────────────────────────────────

test('formatUploadedAt reads a stored ISO instant as a plain date', () => {
    assert.strictEqual(Core.formatUploadedAt('2026-08-31T12:30:10.013Z'), '31 Aug 2026');
});

test('formatUploadedAt is blank for nothing stored, not an invalid date', () => {
    assert.strictEqual(Core.formatUploadedAt(null), '');
    assert.strictEqual(Core.formatUploadedAt(''), '');
    assert.strictEqual(Core.formatUploadedAt('not a date'), '');
});
