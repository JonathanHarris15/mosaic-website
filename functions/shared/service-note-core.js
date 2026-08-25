// ⚠ GENERATED FILE — DO NOT EDIT.
//
// Copied from public/service-note-core.js by scripts/sync-shared-to-functions.js, because
// functions/ deploys as its own bundle and cannot require across into
// public/. Edit the original; run the script; commit both.
//
// test/functions-shared-sync.test.js fails if this copy is stale.

// Service Note Core — the per-element note on an Order of Service (the
// "comment bubble"): context, reminders and reasoning for whoever leads the
// service, attached to one liturgy element.
//
// Pure logic only, so it can be COPIED into functions/shared (see
// scripts/sync-shared-to-functions.js) for the MCP server's oos_update_note
// tool (MS-262) without dragging in Firestore or the DOM.
//
// ⚠ THE STORE IS HTML, AND THE PAGE RENDERS IT WITH x-html. A note written
// into `notes.{slot}` is injected into the Order of Service page as MARKUP,
// not as text (see service-builder.html — the note body and the leader's
// sidebar both use x-html). On the website that is safe enough: the only way
// to write one is through Quill, whose toolbar allows bold, italic and
// bullets and nothing else.
//
// ⚠ AN ASSISTANT IS NOT QUILL, AND MUST NOT BE TRUSTED LIKE IT. It reads
// hymn names, scripture references and themes that people typed, and can be
// steered by them. If it could write raw HTML into a note, a crafted string
// sitting in the church's own data could end up as a <script> that runs in
// the browser of whoever opens that Sunday. So this module takes PLAIN TEXT
// and builds the markup itself, escaping first. There is deliberately no
// path here that accepts HTML from a caller.
//
// The small formatting subset below is exactly Quill's toolbar — bold,
// italic, bullets — so a note written by an assistant and one written by
// hand produce the same shapes, and neither produces anything else.
(function (global) {
    'use strict';

    // Every element that can carry a note, in service order. These are the
    // keys service-builder.js's _MOVEMENTS uses — the liturgy fields plus
    // `baptism`, which carries a note even though oos_update_liturgy cannot
    // set its value.
    const NOTE_KEYS = Object.freeze([
        'preparatoryHymn',
        'callToWorship',
        'hymn1',
        'hymn2',
        'callToConfession',
        'assuranceOfPardon',
        'hymnMid1',
        'hymnMid2',
        'scriptureReading',
        'sermon',
        'baptism',
        'hymnEnd1',
        'hymnEnd2',
        'benediction',
    ]);

    function isNoteKey(key) {
        return NOTE_KEYS.indexOf(key) !== -1;
    }

    // ⚠ RUNS BEFORE ANY MARKUP IS ADDED, never after. Escaping last would
    // escape the tags this module just built and emit them as visible text.
    function escapeHtml(text) {
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // Bold and italic, applied to ALREADY-ESCAPED text. Because the input can
    // no longer contain a real angle bracket at this point, the only tags in
    // the result are the ones these two lines put there.
    function inlineMarkup(escaped) {
        return escaped
            .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
            .replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, '$1<em>$2</em>');
    }

    // Plain text to the markup Quill would have produced.
    //
    // Blank lines separate blocks. A block whose every line begins "- " is a
    // bullet list; anything else is a paragraph, with single newlines kept as
    // line breaks. Returns '' for blank input, which the caller treats as
    // "delete this note" — an empty note and no note are the same thing, and
    // the website already deletes the key rather than storing an empty one.
    function textToNoteHtml(text) {
        const raw = String(text == null ? '' : text).replace(/\r\n?/g, '\n');
        if (!raw.trim()) return '';

        return raw.split(/\n{2,}/)
            .map((block) => block.split('\n').filter((l) => l.trim() !== ''))
            .filter((lines) => lines.length)
            .map((lines) => {
                const bulleted = lines.every((l) => /^\s*[-*]\s+/.test(l));
                if (bulleted) {
                    const items = lines
                        .map((l) => l.replace(/^\s*[-*]\s+/, ''))
                        .map((l) => '<li>' + inlineMarkup(escapeHtml(l)) + '</li>')
                        .join('');
                    return '<ul>' + items + '</ul>';
                }
                const body = lines
                    .map((l) => inlineMarkup(escapeHtml(l.trim())))
                    .join('<br>');
                return '<p>' + body + '</p>';
            })
            .join('');
    }

    // The other direction: a stored note as readable text.
    //
    // Regex rather than a DOM, because this runs on the server too. It is
    // only ever used to SHOW a note to an assistant, never to decide
    // anything, so a rough job is fine — but block tags become line breaks
    // rather than vanishing, or a bullet list would read as one run-on word.
    function noteHtmlToText(html) {
        if (!html) return '';
        return String(html)
            .replace(/<\s*br\s*\/?>/gi, '\n')
            .replace(/<\s*\/\s*(p|div|li|ul|ol|h[1-6])\s*>/gi, '\n')
            .replace(/<\s*li[^>]*>/gi, '- ')
            .replace(/<[^>]*>/g, '')
            .replace(/&nbsp;/gi, ' ')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/&amp;/g, '&')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }

    // Does this note actually say anything? Mirrors service-builder.js's
    // `hasNote`, which strips the markup before deciding — markup with no
    // words in it is not a note.
    function hasNote(html) {
        return noteHtmlToText(html).trim() !== '';
    }

    const ServiceNoteCore = {
        NOTE_KEYS,
        isNoteKey,
        escapeHtml,
        textToNoteHtml,
        noteHtmlToText,
        hasNote,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = ServiceNoteCore;
    }
    if (global) {
        global.ServiceNoteCore = ServiceNoteCore;
    }
})(typeof window !== 'undefined' ? window : null);
