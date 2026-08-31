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

// ── When it was uploaded, read back ───────────────────────────────────────────

test('formatUploadedAt reads a stored ISO instant as a plain date', () => {
    assert.strictEqual(Core.formatUploadedAt('2026-08-31T12:30:10.013Z'), '31 Aug 2026');
});

test('formatUploadedAt is blank for nothing stored, not an invalid date', () => {
    assert.strictEqual(Core.formatUploadedAt(null), '');
    assert.strictEqual(Core.formatUploadedAt(''), '');
    assert.strictEqual(Core.formatUploadedAt('not a date'), '');
});
