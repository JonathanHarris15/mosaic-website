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
    //
    // ⚠ THERE IS NO `url` FIELD, AND ADDING ONE BACK REOPENS MS-287'S HOLE.
    // It used to hold what `getDownloadURL()` returned, which is a link that
    // reads the file for anyone holding it — signed out, forever, whatever
    // storage.rules says about who may see the Event. The record carries the
    // PATH instead, and the reader's own credentials fetch the bytes each
    // time (ADR-0046).
    const RECORD_FIELDS = [
        'name', 'contentType', 'size', 'storagePath',
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

    // ── What can be SHOWN, rather than only saved ─────────────────────────────
    //
    // Google Drive puts two doors on a file: open it, or download it. The first
    // door here cannot be Google's. Docs, Sheets, Slides and Drive's own
    // previewer all open a file by FETCHING IT THEMSELVES from a URL anyone can
    // read — and an Event Attachment deliberately has no such URL (ADR-0046).
    // Minting one for Google is minting one for everybody, which is exactly the
    // hole MS-287 closed a week ago.
    //
    // So the first door is ours. The bytes already arrive as a blob over the
    // reader's own authenticated request; a browser can render most of them
    // without help, and mammoth — already carried for the Service Guide — reads
    // a .docx. This says WHICH renderer a file gets, or `null` for "there is
    // nothing to show, save it instead" (ADR-0047).
    //
    // Read from the extension, like the icon, for the same reason: a name is
    // known before the bytes are.
    const PREVIEW_BY_EXTENSION = Object.freeze({
        pdf: 'pdf',

        // Anything the <img> tag draws unaided. HEIC, HEIF and TIFF are
        // deliberately absent: only Safari draws them, and a broken image is a
        // worse answer than an honest "save it to look at it".
        png: 'image', jpg: 'image', jpeg: 'image', gif: 'image',
        webp: 'image', bmp: 'image', avif: 'image', svg: 'image',

        // Shown as the letters they contain, never run as a page — see
        // `previewIsRenderedAsMarkup` below for why .html is on this list.
        txt: 'text', md: 'text', markdown: 'text', log: 'text', json: 'text',
        xml: 'text', yml: 'text', yaml: 'text', ics: 'text', vcf: 'text',
        srt: 'text', css: 'text', js: 'text', html: 'text', htm: 'text',

        csv: 'sheet', tsv: 'sheet',

        docx: 'docx',

        mp3: 'audio', wav: 'audio', m4a: 'audio', aac: 'audio',
        oga: 'audio', ogg: 'audio', flac: 'audio',

        mp4: 'video', webm: 'video', m4v: 'video', mov: 'video', ogv: 'video',
    });

    const DOCX_TYPE =
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

    // Image types the browser will accept a file OF and then draw nothing.
    const UNDRAWABLE_IMAGE_TYPES = Object.freeze({
        'image/heic': true, 'image/heif': true, 'image/tiff': true,
    });

    // The second opinion, for a file whose name says nothing — attached without
    // an extension, or with one nobody has heard of. The browser recorded what
    // it thought the file was at upload; that is worth asking when the name has
    // already failed to answer.
    function previewKindFromContentType(contentType) {
        const type = String(contentType || '').toLowerCase().split(';')[0].trim();
        if (!type) return null;
        if (type === 'application/pdf') return 'pdf';
        if (type === DOCX_TYPE) return 'docx';
        if (type === 'text/csv' || type === 'text/tab-separated-values') return 'sheet';
        if (UNDRAWABLE_IMAGE_TYPES[type]) return null;
        if (type.indexOf('image/') === 0) return 'image';
        if (type.indexOf('audio/') === 0) return 'audio';
        if (type.indexOf('video/') === 0) return 'video';
        if (type.indexOf('text/') === 0) return 'text';
        return null;
    }

    function previewKindFor(fileName, contentType) {
        const ext = fileExtension(fileName).toLowerCase();
        if (ext && PREVIEW_BY_EXTENSION[ext]) return PREVIEW_BY_EXTENSION[ext];
        return previewKindFromContentType(contentType);
    }

    function canPreview(fileName, contentType) {
        return previewKindFor(fileName, contentType) !== null;
    }

    // What the button beside the file should say. Drive names the door after
    // what is behind it — "Preview" tells you nothing a picture of a page
    // doesn't.
    const PREVIEW_VERBS = Object.freeze({
        pdf: 'View', image: 'View', docx: 'View', text: 'View',
        sheet: 'View', audio: 'Play', video: 'Play',
    });

    function previewVerbFor(fileName, contentType) {
        return PREVIEW_VERBS[previewKindFor(fileName, contentType)] || null;
    }

    // ── Which files can be trusted with a tab of their own ────────────────────
    //
    // A blob opened in a tab is served under THIS site's origin, so this list
    // is short on purpose: the thing drawing the file has to be the BROWSER —
    // its PDF reader, its image decoder, its media player — and never our page.
    //
    // The three kinds we render ourselves are absent, and .html is the reason
    // why. A .txt attachment in a tab is harmless; a .html one would run its
    // script beside the reader's own signed-in session, and both arrive here as
    // 'text'. A .docx or a .csv in a tab is not a document, it is a download
    // with extra steps.
    //
    // Full screen has no such problem — the page is still ours, it is just
    // bigger — so anything can go full screen.
    const OWN_TAB_KINDS = Object.freeze({ pdf: true, image: true, video: true, audio: true });

    function previewOpensInOwnTab(kind) {
        return OWN_TAB_KINDS[kind] === true;
    }

    // ── Reading a spreadsheet the browser cannot open ─────────────────────────
    //
    // A .csv is a spreadsheet that happens to be legible, so it is drawn as the
    // table it is rather than the letters it is made of. Quotes matter: a cell
    // may hold the delimiter, a line break, or a quote of its own doubled.
    //
    // .xlsx is NOT here. Reading one needs a library we would have to carry in
    // full (everything on this site is vendored locally, nothing loads from a
    // CDN), and the last version published to one is old enough to have a
    // prototype-pollution hole in its parser. An .xlsx downloads.
    function delimiterFor(fileName) {
        return fileExtension(fileName).toLowerCase() === 'tsv' ? '\t' : ',';
    }

    function parseDelimitedRows(text, delimiter) {
        const sep = delimiter || ',';
        const source = String(text == null ? '' : text);
        const rows = [];
        let row = [];
        let field = '';
        let quoted = false;

        for (let i = 0; i < source.length; i++) {
            const ch = source[i];
            if (quoted) {
                if (ch !== '"') { field += ch; continue; }
                // A doubled quote inside a quoted cell is one literal quote.
                if (source[i + 1] === '"') { field += '"'; i += 1; continue; }
                quoted = false;
                continue;
            }
            if (ch === '"') { quoted = true; continue; }
            if (ch === sep) { row.push(field); field = ''; continue; }
            if (ch === '\r') continue;
            if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
            field += ch;
        }
        // A file ending in a newline has no trailing empty row; one ending
        // mid-line still has its last row.
        if (field !== '' || row.length) { row.push(field); rows.push(row); }
        return rows;
    }

    // How much of a long file is worth drawing. A 5MB log is not read on an
    // Event page, and pasting all of it into the DOM freezes the tab.
    const MAX_PREVIEW_CHARACTERS = 200 * 1024;
    const MAX_PREVIEW_ROWS = 500;

    function truncateForPreview(text) {
        const s = String(text == null ? '' : text);
        if (s.length <= MAX_PREVIEW_CHARACTERS) return { text: s, truncated: false };
        return { text: s.slice(0, MAX_PREVIEW_CHARACTERS), truncated: true };
    }

    // ── The one kind that arrives as markup ───────────────────────────────────
    //
    // mammoth turns a .docx into HTML, and that HTML is written into the page.
    // Everything else it produces is a paragraph, a heading, a list or a table —
    // but a Word hyperlink carries whatever address it was given, and Word can
    // be made to carry `javascript:`. Only an editor can attach a file, so this
    // is a low door rather than a locked one; it still costs nothing to shut.
    //
    // An .html attachment is NOT run through this. It is shown as text, because
    // a blob URL inherits this site's own origin, so an uploaded page would run
    // its script with our signed-in reader's session sitting right there.
    const previewIsRenderedAsMarkup = true;

    function sanitizeDocxHtml(html) {
        return String(html == null ? '' : html)
            .replace(/<\s*(script|iframe|object|embed|link|style)\b[\s\S]*?(?:<\s*\/\s*\1\s*>|$)/gi, '')
            .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
            .replace(/((?:href|src|xlink:href)\s*=\s*)(["'])\s*javascript:[^"']*\2/gi, '$1$2#$2');
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
        MAX_PREVIEW_CHARACTERS,
        MAX_PREVIEW_ROWS,
        validateAttachmentFile,
        formatFileSize,
        storagePath,
        buildAttachmentRecord,
        fileExtension,
        materialIconFor,
        previewKindFor,
        canPreview,
        previewOpensInOwnTab,
        previewVerbFor,
        delimiterFor,
        parseDelimitedRows,
        truncateForPreview,
        sanitizeDocxHtml,
        previewIsRenderedAsMarkup,
        formatUploadedAt,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = EventAttachmentsCore;
    }
    if (global) {
        global.EventAttachmentsCore = EventAttachmentsCore;
    }
})(typeof window !== 'undefined' ? window : null);
