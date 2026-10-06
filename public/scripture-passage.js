// Scripture passage — how a Printable reads a citation as verses.
//
// The Order of Service stores the reference and nothing else (ADR 0079).
// This module turns that reference into the ESV query, a cache key, and
// the two drawings: plain text, or scripture markup we generate ourselves.
// It does not decide which Sunday. The caller already has the citation.

(function (global) {
    'use strict';

    // Slots that hold a scripture citation. People-name slots are not here.
    const FIELDS = [
        'keyVerse',
        'callToWorship',
        'callToConfession',
        'assuranceOfPardon',
        'scriptureReading',
        'sermon',
        'benediction',
    ];

    function isScriptureField(field) {
        return FIELDS.indexOf(field) !== -1;
    }

    function defaultPresentation() {
        return {
            style: 'styled',
            numbers: false,
            headings: false,
            footnotes: false,
            citation: true,
        };
    }

    function normalize(presentation) {
        const d = defaultPresentation();
        const p = presentation || {};
        return {
            style: p.style === 'plain' ? 'plain' : 'styled',
            numbers: p.numbers === true,
            headings: p.headings === true,
            footnotes: p.footnotes === true,
            citation: p.citation !== false,
            // A passage keeps the short copyright. The key verse on the
            // service-guide cover is the one place the old booklet asks
            // for the words without it.
            copyright: p.copyright !== false,
        };
    }

    function cacheKey(reference, presentation) {
        const ref = String(reference || '').trim().replace(/\s+/g, ' ');
        const p = normalize(presentation);
        return [
            ref.toLowerCase(),
            p.style,
            p.numbers ? 'n' : '-',
            p.headings ? 'h' : '-',
            p.footnotes ? 'f' : '-',
            p.citation ? 'c' : '-',
            p.copyright ? 'y' : 'n',
        ].join('|');
    }

    // The query string for api.esv.org/v3/passage/text/. The key is not here.
    function query(reference, presentation) {
        const p = normalize(presentation);
        const q = new URLSearchParams();
        q.set('q', String(reference || '').trim());
        q.set('include-passage-references', p.citation ? 'true' : 'false');
        q.set('include-verse-numbers', p.numbers ? 'true' : 'false');
        q.set('include-first-verse-numbers', p.numbers ? 'true' : 'false');
        q.set('include-footnotes', p.footnotes ? 'true' : 'false');
        q.set('include-footnote-body', p.footnotes ? 'true' : 'false');
        q.set('include-headings', p.headings ? 'true' : 'false');
        q.set('include-short-copyright', p.copyright ? 'true' : 'false');
        q.set('include-copyright', 'false');
        q.set('indent-poetry', 'true');
        return q.toString();
    }

    function escapeHtml(s) {
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    function stripVerseNumbers(s) {
        return String(s).replace(/\[\d+\]\s*/g, '');
    }

    function markVerseNumbers(escapedLine) {
        return escapedLine.replace(/\[(\d+)\]/g, '<sup class="m-scripture__n">$1</sup>');
    }

    // `raw` is the passage text the API returned for this presentation.
    // Plain collapses to one run. Styled keeps lines and marks verse numbers.
    function format(raw, presentation) {
        const p = normalize(presentation);
        let text = String(raw || '').replace(/\r\n/g, '\n').trim();
        if (!p.numbers) text = stripVerseNumbers(text);
        text = text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
        if (!text) return { text: '', html: '' };
        if (p.style === 'plain') {
            const flat = text.replace(/\s+/g, ' ').trim();
            return { text: flat, html: '' };
        }
        const html = text.split('\n').map(line => {
            if (!line.trim()) return '<span class="m-scripture__gap"></span>';
            const indent = /^\s/.test(line);
            const body = markVerseNumbers(escapeHtml(line.trim()));
            const cls = indent ? 'm-scripture__line m-scripture__line--poetry' : 'm-scripture__line';
            return '<span class="' + cls + '">' + body + '</span>';
        }).join('');
        const plain = text.replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').trim();
        return { text: plain, html: html };
    }

    // The same public token the service-guide editors already ship. One
    // place for new code to read it. A deployment may set ESV_API_KEY first.
    function apiKey() {
        if (global && global.ESV_API_KEY) return global.ESV_API_KEY;
        return '3ca8c306dfdefdc42598bb88a037361a0f44cb0b';
    }

    const ScripturePassage = {
        FIELDS: FIELDS,
        isScriptureField: isScriptureField,
        defaultPresentation: defaultPresentation,
        normalize: normalize,
        cacheKey: cacheKey,
        query: query,
        format: format,
        apiKey: apiKey,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = ScripturePassage;
    }
    if (global) {
        global.ScripturePassage = ScripturePassage;
    }
})(typeof window !== 'undefined' ? window : globalThis);
