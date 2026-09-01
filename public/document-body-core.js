// Document Body Core — the one shape every document written in Mosaic takes.
//
// A Shepherding Note, Meeting Minutes, an Elder Document and an Event Document
// are four different things to a person: different places, different readers,
// different reasons to exist. To the code they are one thing — a title and a
// Note Body (TipTap JSON) — and the only honest differences are WHERE the
// record hangs and WHO may read it. Those two live in the Firestore path and in
// `firestore.rules`, which is exactly where a visibility rule belongs.
//
// So this module owns the parts that must not differ:
//
//   1. The record shape, decided once, so a screen that knows about three
//      fields cannot write a lopsided document.
//   2. What a document with nothing in it looks like, so "new" means the same
//      thing everywhere.
//   3. Whether a body is empty, and what it says at a glance — the line a list
//      shows under a document's name.
//
// Deliberately self-contained, like every other *-core module here: requires
// nothing, mutates nothing, returns new objects.
//
// Loaded as a classic <script> (window.DocumentBodyCore) and exported for Node.

(function (global) {
    'use strict';

    // What an untitled document is called. One literal, because a list, a tab
    // title, a Word filename and a search result showing three different
    // fallbacks is how one document looks like three.
    const DEFAULT_TITLE = 'Untitled Document';

    // Long enough for a real sentence of a title, short enough that a row in a
    // list stays a row.
    const MAX_TITLE_LENGTH = 200;

    // ── A document with nothing in it yet ─────────────────────────────────────
    //
    // Not `null`, and not `{}`. TipTap will refuse a document that is not a
    // `doc` node with content, and an editor handed one silently renders
    // nothing — which reads as "the page is broken", not as "this is empty".
    function emptyBody() {
        return { type: 'doc', content: [{ type: 'paragraph' }] };
    }

    // ── The record shape, decided in one place ────────────────────────────────
    //
    // `contentJson` is the Note Body. The two timestamps are written by the
    // caller (a server timestamp, which this module has no way to make), so
    // they are passed in rather than invented here.
    const RECORD_FIELDS = [
        'title', 'contentJson',
        'createdAt', 'createdBy', 'createdByName',
        'updatedAt', 'updatedByName',
    ];

    function buildDocumentRecord(spec) {
        const s = spec || {};
        const record = {};
        RECORD_FIELDS.forEach(field => {
            record[field] = field in s ? s[field] : null;
        });
        // The two fields nothing downstream can cope with being absent: a
        // document with no body cannot be opened, and one with no title cannot
        // be listed.
        if (record.contentJson == null) record.contentJson = emptyBody();
        record.title = normaliseTitle(record.title);
        return record;
    }

    // ── The title ─────────────────────────────────────────────────────────────

    function normaliseTitle(title) {
        const trimmed = String(title == null ? '' : title).replace(/\s+/g, ' ').trim();
        if (!trimmed) return DEFAULT_TITLE;
        return trimmed.slice(0, MAX_TITLE_LENGTH);
    }

    // Whether what somebody typed is a title they chose, or the fallback still
    // sitting there. A list uses this to know when to grey the name.
    function isUntitled(title) {
        return normaliseTitle(title) === DEFAULT_TITLE;
    }

    // ── Reading a body without rendering it ───────────────────────────────────
    //
    // The same walk `tiptap-render.js` and `document-docx-core.js` do, stripped
    // to the one question a LIST asks: what does this say? Block-level nodes are
    // separated by a space so two paragraphs do not run together into a word
    // that was never written.
    const BLOCK_TYPES = {
        paragraph: true, heading: true, listItem: true, blockquote: true,
        codeBlock: true, tableRow: true, tableCell: true, tableHeader: true,
    };

    function collectText(node, out) {
        if (!node) return out;
        if (node.type === 'text' && node.text) { out.push(String(node.text)); return out; }
        if (node.type === 'mention') {
            out.push('@' + String((node.attrs && node.attrs.label) || ''));
            return out;
        }
        if (node.type === 'hardBreak') { out.push(' '); return out; }
        (node.content || []).forEach(child => collectText(child, out));
        if (BLOCK_TYPES[node.type]) out.push(' ');
        return out;
    }

    function plainText(contentJson) {
        if (!contentJson) return '';
        return collectText(contentJson, []).join('').replace(/\s+/g, ' ').trim();
    }

    // ── Empty, and what "empty" honestly means ────────────────────────────────
    //
    // Not simply "no text". A document holding one empty table, or a horizontal
    // rule, or a Person Panel, has something in it that a person put there and
    // would be surprised to see described as blank.
    const CONTENT_WITHOUT_TEXT = {
        table: true, horizontalRule: true, image: true, personPanel: true,
    };

    function hasNodeOfType(node, types) {
        if (!node) return false;
        if (types[node.type]) return true;
        return (node.content || []).some(child => hasNodeOfType(child, types));
    }

    function isEmptyBody(contentJson) {
        if (!contentJson) return true;
        if (plainText(contentJson)) return false;
        return !hasNodeOfType(contentJson, CONTENT_WITHOUT_TEXT);
    }

    // The line under a document's name in a list. Long enough to tell two
    // documents apart, short enough not to become the row.
    const PREVIEW_LENGTH = 120;

    function bodyPreview(contentJson, maxLength) {
        const limit = Number(maxLength) > 0 ? Number(maxLength) : PREVIEW_LENGTH;
        const text = plainText(contentJson);
        if (!text) return '';
        if (text.length <= limit) return text;
        // Cut at a word rather than mid-syllable, unless the first word is
        // itself longer than the whole allowance.
        const cut = text.slice(0, limit);
        const lastSpace = cut.lastIndexOf(' ');
        return (lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd() + '…';
    }

    const DocumentBodyCore = {
        DEFAULT_TITLE,
        MAX_TITLE_LENGTH,
        PREVIEW_LENGTH,
        emptyBody,
        buildDocumentRecord,
        normaliseTitle,
        isUntitled,
        plainText,
        isEmptyBody,
        bodyPreview,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = DocumentBodyCore;
    }
    if (global) {
        global.DocumentBodyCore = DocumentBodyCore;
    }
})(typeof window !== 'undefined' ? window : null);
