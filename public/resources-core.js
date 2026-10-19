// Resources Core — the pure model for the church's shared file library
// (MS-693): old Bible studies, sermon manuscripts, outlines, the new-member
// packet. One library, read by every member, written by editors.
//
// Three kinds of thing live in it, and only two of them are records here:
//
//   1. A **Resource Folder** — a name and the folder it sits in. Flat, like a
//      Form Folder: the folder does not remember its children (ADR-0054), so
//      two editors filing at the same moment write two different records.
//      FilingCore does every walk over them; nothing is restated here.
//
//   2. A **Resource** — one entry in the library. Either a FILE whose bytes
//      are in Cloud Storage, or a LINK to something hosted elsewhere (a Google
//      Doc). A link is a link and never a copy: the church edits the Doc where
//      it lives, and a stale duplicate in Storage would be worse than no copy
//      at all.
//
//   3. A **pin** — not a record of its own. A folder or a resource carries its
//      own `pinRank`, and the Pinned card is everything that has one, in rank
//      order. The rank is a number with gaps, so dragging one pin between two
//      others writes ONE record rather than renumbering the list (the same
//      reason filing writes one record).
//
// Self-contained like every other *-core module: requires nothing but
// FilingCore, mutates nothing, returns new objects, knows nothing about
// Firestore or Storage. Loaded as a classic <script> (window.ResourcesCore)
// and exported for Node.

(function (global) {
    'use strict';

    const isNode = (typeof require === 'function' && typeof module !== 'undefined' && module.exports);
    const Filing = isNode ? require('./filing-core.js') : global.FilingCore;

    // ── What a resource is ───────────────────────────────────────────────────

    const KIND_FILE = 'file';
    const KIND_LINK = 'link';
    const KINDS = Object.freeze([KIND_FILE, KIND_LINK]);

    // 25MB per file, the same cap an Event Attachment takes and for the same
    // reason: generous enough for a scanned manuscript or a photo-heavy
    // handout, small enough that nobody parks a feature-length video on the
    // church's bill. There is no compression step here — a .docx cannot be
    // redrawn in a canvas — so this cap is the only guard, and storage.rules
    // restates it so a browser that skips the check is still refused.
    const MAX_FILE_BYTES = 25 * 1024 * 1024;

    // A resource name is read on one line of a dense list, and it is usually a
    // file name. Longer than a folder's 60 because "2024-03-17 — Romans 8
    // sermon manuscript.docx" is a reasonable thing to upload.
    const MAX_NAME_LENGTH = 120;

    const DEFAULT_NAME = 'Untitled';

    function normaliseName(name) {
        const trimmed = String(name == null ? '' : name).trim().replace(/\s+/g, ' ');
        if (!trimmed) return DEFAULT_NAME;
        return trimmed.slice(0, MAX_NAME_LENGTH);
    }

    // ── Where the bytes go ───────────────────────────────────────────────────
    //
    // Every file gets its own prefix, under its own resource id, so two
    // uploads can never collide and storage.rules can name the shape of the
    // path it is guarding.
    //
    // ⚠ THE NAME IN THE PATH IS NOT THE NAME ON THE RECORD. A person renames a
    // resource whenever they like; the bytes stay where they were written. The
    // record's `storagePath` is the truth, and nothing recomputes it from the
    // name.
    const STORAGE_PREFIX = 'resources';

    function safeFileName(name) {
        const cleaned = String(name == null ? '' : name)
            .replace(/[\\/]+/g, '-')
            .replace(/[^A-Za-z0-9._ -]/g, '')
            .trim()
            .slice(0, 80);
        // A name made entirely of punctuation survives the filter and reads as
        // a path segment of "-", so require something legible in it.
        return /[A-Za-z0-9]/.test(cleaned) ? cleaned : 'file';
    }

    function storagePathFor(resourceId, fileName) {
        return STORAGE_PREFIX + '/' + String(resourceId) + '/' + safeFileName(fileName);
    }

    // ── Before anything is uploaded ──────────────────────────────────────────
    //
    // Deliberately not a content-type allowlist. The ticket asks for Word
    // documents, PDFs and images, and the church will want the next format
    // too; refusing by type would make this library smaller than the Event
    // Attachments one for no gain. Size is the thing worth refusing.

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
        return (value >= 10 ? Math.round(value) : Math.round(value * 10) / 10) + ' ' + SIZE_UNITS[unit];
    }

    function validateUploadFile(file) {
        if (!file || !file.name) {
            return { ok: false, error: 'Choose a file to upload.' };
        }
        if (Number(file.size) > MAX_FILE_BYTES) {
            return {
                ok: false,
                error: 'That file is larger than ' + formatFileSize(MAX_FILE_BYTES) +
                    ', which is the most one resource can hold.',
            };
        }
        return { ok: true, error: null };
    }

    // A link entry points somewhere else on the web — a Google Doc, usually.
    // Only http(s): a `javascript:` or `data:` href on a page every member
    // opens is an attack, not a resource.
    function validateLinkUrl(url) {
        const raw = String(url == null ? '' : url).trim();
        if (!raw) return { ok: false, error: 'Paste the link first.', url: '' };
        if (!/^https?:\/\/[^\s]+$/i.test(raw)) {
            return {
                ok: false,
                error: 'That is not a web link. It must start with http:// or https://.',
                url: '',
            };
        }
        return { ok: true, error: null, url: raw };
    }

    // ── The records ──────────────────────────────────────────────────────────

    function buildFolder(spec) {
        const s = spec || {};
        const folder = Filing.buildFolder(s);
        folder.pinRank = normalisedRank(s.pinRank);
        return folder;
    }

    function buildFileResource(spec) {
        const s = spec || {};
        return {
            kind: KIND_FILE,
            name: normaliseName(s.name),
            folderId: s.folderId || null,
            // The PATH, never a download URL. getDownloadURL() mints a token
            // that serves the bytes to anyone holding it, signed out, forever,
            // with storage.rules never consulted (ADR-0046). A member-only
            // library one forwarded link away from the open internet is not a
            // member-only library.
            storagePath: String(s.storagePath || ''),
            contentType: s.contentType || null,
            size: Number(s.size) || 0,
            url: null,
            pinRank: normalisedRank(s.pinRank),
        };
    }

    function buildLinkResource(spec) {
        const s = spec || {};
        return {
            kind: KIND_LINK,
            name: normaliseName(s.name),
            folderId: s.folderId || null,
            storagePath: null,
            contentType: null,
            size: 0,
            url: String(s.url || ''),
            pinRank: normalisedRank(s.pinRank),
        };
    }

    // ── How a row reads ──────────────────────────────────────────────────────
    //
    // The glyph and the word under the name come from the record, so the page,
    // the phone and an assistant describing the library all say the same thing
    // about the same file.

    function extensionOf(name) {
        const m = /\.([A-Za-z0-9]+)$/.exec(String(name || ''));
        return m ? m[1].toLowerCase() : '';
    }

    function typeOf(resource) {
        const r = resource || {};
        if (r.kind === KIND_LINK) return 'link';
        const type = String(r.contentType || '').toLowerCase();
        const ext = extensionOf(r.name);
        if (type.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'svg'].includes(ext)) {
            return 'image';
        }
        if (type === 'application/pdf' || ext === 'pdf') return 'pdf';
        if (type.indexOf('word') !== -1 || ['doc', 'docx', 'odt', 'rtf'].includes(ext)) return 'doc';
        if (type.indexOf('sheet') !== -1 || type.indexOf('excel') !== -1 || ['xls', 'xlsx', 'csv', 'ods'].includes(ext)) {
            return 'sheet';
        }
        if (type.indexOf('presentation') !== -1 || ['ppt', 'pptx', 'odp'].includes(ext)) return 'slides';
        if (type.startsWith('audio/') || ['mp3', 'm4a', 'wav'].includes(ext)) return 'audio';
        if (type.startsWith('video/') || ['mp4', 'mov', 'm4v'].includes(ext)) return 'video';
        return 'other';
    }

    const ICONS = Object.freeze({
        folder: 'folder',
        link: 'link',
        image: 'image',
        pdf: 'picture_as_pdf',
        doc: 'description',
        sheet: 'table',
        slides: 'slideshow',
        audio: 'graphic_eq',
        video: 'movie',
        other: 'draft',
    });

    const TYPE_WORDS = Object.freeze({
        link: 'Link',
        image: 'Image',
        pdf: 'PDF',
        doc: 'Document',
        sheet: 'Spreadsheet',
        slides: 'Slides',
        audio: 'Audio',
        video: 'Video',
        other: 'File',
    });

    function iconFor(resource) {
        const r = resource || {};
        if (r.isFolder || r.kind === 'folder') return ICONS.folder;
        return ICONS[typeOf(r)] || ICONS.other;
    }

    // "PDF · 210 KB", "Link", "Folder". One line, no apology when a size is
    // missing — an older record that never stored one simply says the type.
    function metaFor(resource) {
        const r = resource || {};
        if (r.isFolder || r.kind === 'folder') return 'Folder';
        const word = TYPE_WORDS[typeOf(r)] || TYPE_WORDS.other;
        if (r.kind === KIND_LINK) return word;
        const size = Number(r.size) || 0;
        return size ? word + ' · ' + formatFileSize(size) : word;
    }

    // ── Search ───────────────────────────────────────────────────────────────
    //
    // Over the whole library, not the folder you are standing in: somebody
    // looking for "Romans" does not know which folder it was filed in, which
    // is the entire reason the box is there.

    function matchesSearch(item, term) {
        const needle = String(term == null ? '' : term).trim().toLowerCase();
        if (!needle) return true;
        return String((item && item.name) || '').toLowerCase().indexOf(needle) !== -1;
    }

    // ── Pins ─────────────────────────────────────────────────────────────────
    //
    // ⚠ THE RANK IS A NUMBER WITH GAPS, AND THAT IS THE DECISION (ADR-0083).
    // An array of ids in one document would be one write per reorder and one
    // clobber per pair of editors — the same trap ADR-0054 kept the folder
    // tree out of. A rank on each record makes a move a single-record write
    // that cannot discard anybody else's.
    //
    // Pins are counted across BOTH collections: a folder and a file sit in one
    // Pinned card, so one ordering spans the two.

    const PIN_STEP = 1000;

    // Below this the midpoints stop being worth trusting, so the whole pinned
    // list is renumbered instead. At PIN_STEP apart that is tens of moves
    // between the same two neighbours before it ever happens.
    const MIN_PIN_GAP = 0.01;

    // ⚠ `Number(null)` IS 0, AND 0 IS A PERFECTLY GOOD RANK. Leaning on
    // Number.isFinite alone makes every unpinned record the first pin in the
    // card, which is a bug that looks like a design.
    function normalisedRank(value) {
        if (value === null || value === undefined || value === '') return null;
        const n = Number(value);
        return Number.isFinite(n) ? n : null;
    }

    function isPinned(item) {
        return normalisedRank(item && item.pinRank) !== null;
    }

    // Everything pinned, in the order the Pinned card draws it. Ties break on
    // the name so two records written in the same breath have a settled order
    // rather than Firestore's.
    function pinnedOrder(items) {
        return (items || [])
            .filter(isPinned)
            .slice()
            .sort(function (a, b) {
                const d = normalisedRank(a.pinRank) - normalisedRank(b.pinRank);
                if (d !== 0) return d;
                return String(a.name || '').localeCompare(String(b.name || ''));
            });
    }

    // A new pin goes to the bottom of the card: pinning is "keep this where I
    // can find it", not "put this above everything I pinned before".
    function nextPinRank(items) {
        const pinned = pinnedOrder(items);
        if (!pinned.length) return PIN_STEP;
        return normalisedRank(pinned[pinned.length - 1].pinRank) + PIN_STEP;
    }

    function rankBetween(before, after) {
        const a = normalisedRank(before);
        const b = normalisedRank(after);
        if (a === null && b === null) return PIN_STEP;
        if (a === null) return b - PIN_STEP;
        if (b === null) return a + PIN_STEP;
        return (a + b) / 2;
    }

    function keyOf(item) {
        return String((item && item.kind === 'folder') || (item && item.isFolder) ? 'folder' : 'resource')
            + ':' + String((item && item.id) || '');
    }

    /**
     * Where one pin lands when it is dragged (or nudged) to a new position,
     * and what has to be written to put it there.
     *
     * Returns `{ ok, why, writes }`. `writes` is normally ONE entry —
     * `{ id, isFolder, pinRank }` — and is the whole pinned list only when the
     * midpoints have closed up and the ranks are renumbered.
     *
     * @param {Array<object>} items every folder and resource in the library
     * @param {object} which `{ id, isFolder }` — the pin being moved
     * @param {number} toIndex its position in the pinned list afterwards
     * @return {{ok: boolean, why: string, writes: Array<object>}}
     */
    function planPinMove(items, which, toIndex) {
        const pinned = pinnedOrder(items);
        const target = keyOf({ id: which && which.id, kind: (which && which.isFolder) ? 'folder' : 'resource' });
        const from = pinned.findIndex(function (p) { return keyOf(p) === target; });
        if (from < 0) return { ok: false, why: 'That is not pinned.', writes: [] };

        const rest = pinned.slice();
        const [moved] = rest.splice(from, 1);
        const at = Math.max(0, Math.min(rest.length, Number(toIndex)));
        if (at === from) return { ok: true, why: '', writes: [] };

        const before = at > 0 ? rest[at - 1] : null;
        const after = at < rest.length ? rest[at] : null;
        const rank = rankBetween(before && before.pinRank, after && after.pinRank);

        const gapTooSmall = before && after &&
            Math.abs(normalisedRank(after.pinRank) - normalisedRank(before.pinRank)) < MIN_PIN_GAP;
        if (gapTooSmall) {
            rest.splice(at, 0, moved);
            return {
                ok: true,
                why: '',
                writes: rest.map(function (p, i) {
                    return { id: p.id, isFolder: !!(p.isFolder || p.kind === 'folder'), pinRank: (i + 1) * PIN_STEP };
                }),
            };
        }

        return {
            ok: true,
            why: '',
            writes: [{
                id: moved.id,
                isFolder: !!(moved.isFolder || moved.kind === 'folder'),
                pinRank: rank,
            }],
        };
    }

    /** The same move, said as "one step up" or "one step down". */
    function planPinNudge(items, which, delta) {
        const pinned = pinnedOrder(items);
        const target = keyOf({ id: which && which.id, kind: (which && which.isFolder) ? 'folder' : 'resource' });
        const from = pinned.findIndex(function (p) { return keyOf(p) === target; });
        if (from < 0) return { ok: false, why: 'That is not pinned.', writes: [] };
        const to = from + (Number(delta) || 0);
        if (to < 0 || to >= pinned.length) {
            return { ok: false, why: 'It is already at the end.', writes: [] };
        }
        return planPinMove(items, which, to);
    }

    const ResourcesCore = {
        KIND_FILE,
        KIND_LINK,
        KINDS,
        MAX_FILE_BYTES,
        MAX_NAME_LENGTH,
        DEFAULT_NAME,
        STORAGE_PREFIX,
        PIN_STEP,
        MIN_PIN_GAP,
        normaliseName,
        safeFileName,
        storagePathFor,
        formatFileSize,
        validateUploadFile,
        validateLinkUrl,
        buildFolder,
        buildFileResource,
        buildLinkResource,
        typeOf,
        iconFor,
        metaFor,
        matchesSearch,
        isPinned,
        pinnedOrder,
        nextPinRank,
        rankBetween,
        planPinMove,
        planPinNudge,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = ResourcesCore;
    }
    if (global) {
        global.ResourcesCore = ResourcesCore;
    }
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : null));
