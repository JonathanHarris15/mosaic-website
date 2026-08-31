// Event Attachments Core — the pure model for a file attached to one Event
// occurrence (MS-287): a flyer, a sign-up sheet, a floor plan — whatever the
// original ask meant by "whatever Google Drive can handle". Confirmed with the
// person who raised the ticket: that phrase meant "accept lots of file types",
// not an actual Google Drive integration — the bytes live in our own Storage,
// the same pattern `person-photo-core.js` already uses for a Directory Photo.
//
// Three things it knows:
//
//   1. Whether a chosen file is fit to upload at all — any file type is
//      welcome, but there is still a size a browser should refuse before it
//      spends a minute uploading something too big to be useful.
//
//   2. Where the bytes go. Every attachment gets its OWN path, under its own
//      occurrence and its own id — never a path two uploads could collide on.
//
//   3. The one shape a Firestore record takes, so the store and the UI can
//      never quietly drift onto two different ideas of what an attachment is.
//
// Deliberately self-contained — like every other *-core module here, it
// requires nothing and returns new objects rather than mutating its inputs.
//
// Loaded as a classic <script> (window.EventAttachmentsCore) and exported for
// Node tests.

(function (global) {
    'use strict';

    // 25MB — the ticket's cap, chosen to match common document/image sizes.
    // Generous enough for a scanned order of service or a photo-heavy flyer,
    // small enough that a signed-in account cannot park a feature-length
    // video on the church's bill. Unlike a Directory Photo, nothing here
    // resizes the file first — a .docx or a .pdf cannot be shrunk in a canvas —
    // so the cap is the only guard there is.
    const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

    // ── Before it is ever uploaded ────────────────────────────────────────────
    //
    // Deliberately NOT a content-type check. "Whatever Google Drive can
    // handle" means any file type is welcome — a .docx, a .pdf, a .png, or
    // anything else — so the only thing worth refusing here is a file too big
    // to be useful.
    function validateAttachmentFile(file) {
        if (!file || !file.name) {
            return { ok: false, error: 'Choose a file to attach.' };
        }
        if (Number(file.size) > MAX_ATTACHMENT_BYTES) {
            return {
                ok: false,
                error: 'That file is larger than ' + formatFileSize(MAX_ATTACHMENT_BYTES) +
                    ', which is the most this can take in one go.',
            };
        }
        return { ok: true, error: null };
    }

    // ── Human-readable size ───────────────────────────────────────────────────

    const SIZE_UNITS = ['B', 'KB', 'MB', 'GB'];

    function formatFileSize(bytes) {
        const n = Number(bytes) || 0;
        if (n < 1024) return n + ' B';

        let value = n;
        let unit = 0;
        while (value >= 1024 && unit < SIZE_UNITS.length - 1) {
            value /= 1024;
            unit += 1;
        }
        // One decimal place, and only when it says something — "5 MB" reads
        // better than "5.0 MB", but "1.5 KB" needs the decimal to be honest.
        const rounded = Math.round(value * 10) / 10;
        return (Number.isInteger(rounded) ? rounded : rounded.toFixed(1)) + ' ' + SIZE_UNITS[unit];
    }

    // ── Where the bytes live ──────────────────────────────────────────────────
    //
    // `event_attachments/{occurrenceId}/{attachmentId}/{fileName}`. The
    // attachment id is a fresh Firestore doc id, generated before the upload —
    // so every attachment gets its own path the same way a Directory Photo
    // does (ADR-0029 §3), and two people attaching a file with the same name to
    // the same Event never collide.
    //
    // The filename is the LAST segment, kept human-readable rather than
    // hashed, so a browser looking at the raw Storage console can still tell
    // what it is. Any slash in it is stripped first — a filename is not
    // trusted to stay inside the one path segment it was given.
    function storagePath(occurrenceId, attachmentId, fileName) {
        const safeName = String(fileName || 'file').replace(/[\\/]/g, '_');
        return 'event_attachments/' + occurrenceId + '/' + attachmentId + '/' + safeName;
    }

    // ── The record shape, decided in one place ────────────────────────────────
    //
    // What the Firestore document carries. One function, so a screen that only
    // knows about a few of these fields cannot write a lopsided record — every
    // field is always present, `null` where the caller gave nothing.
    const RECORD_FIELDS = [
        'name', 'contentType', 'size', 'storagePath', 'url',
        'uploadedBy', 'uploadedByName', 'uploadedAt',
    ];

    function buildAttachmentRecord(spec) {
        const s = spec || {};
        const record = {};
        RECORD_FIELDS.forEach(field => {
            record[field] = field in s ? s[field] : null;
        });
        return record;
    }

    // ── An icon by what the file IS ───────────────────────────────────────────
    //
    // Read from the name's extension, never the bytes — this runs before
    // upload as easily as after, and a file the browser has not read yet still
    // has a name.
    const ICONS_BY_EXTENSION = Object.freeze({
        pdf: 'picture_as_pdf',
        doc: 'description', docx: 'description', txt: 'description', rtf: 'description',
        xls: 'table_chart', xlsx: 'table_chart', csv: 'table_chart',
        ppt: 'slideshow', pptx: 'slideshow',
        png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', heic: 'image',
        zip: 'folder_zip',
    });

    // The one place a filename's extension is pulled out, so the icon and the
    // type label printed beside it can never read two different letters off
    // the same name.
    function fileExtension(fileName) {
        const match = /\.([a-z0-9]+)$/i.exec(String(fileName || ''));
        return match ? match[1].toUpperCase() : '';
    }

    function materialIconFor(fileName) {
        return ICONS_BY_EXTENSION[fileExtension(fileName).toLowerCase()] || 'attach_file';
    }

    // ── When it was uploaded, read back ───────────────────────────────────────
    //
    // `uploadedAt` is stored as a full ISO instant (`new Date().toISOString()`),
    // not the plain 'YYYY-MM-DD' the rest of this app's date helpers expect —
    // so this reads it with the platform's own `Date`, not `DateUtils`, which
    // would misparse the time half of the string as a second '-' segment.
    function formatUploadedAt(iso) {
        if (!iso) return '';
        const d = new Date(iso);
        if (isNaN(d.getTime())) return '';
        return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    }

    const EventAttachmentsCore = {
        MAX_ATTACHMENT_BYTES,
        validateAttachmentFile,
        formatFileSize,
        storagePath,
        buildAttachmentRecord,
        fileExtension,
        materialIconFor,
        formatUploadedAt,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = EventAttachmentsCore;
    }
    if (global) {
        global.EventAttachmentsCore = EventAttachmentsCore;
    }
})(typeof window !== 'undefined' ? window : null);
