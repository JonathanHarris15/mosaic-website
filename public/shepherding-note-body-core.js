// Plain-text preview and backfill planning for Shepherding Notes (MS-798).
(function (global) {
    'use strict';

    function noteMarkdownCore() {
        if (typeof require === 'function') {
            try {
                return require('./note-markdown-core.js');
            } catch (e) {
                return null;
            }
        }
        return global && global.NoteMarkdownCore;
    }

    /** @param {*} contentJson */
    function plainFromJson(contentJson) {
        const Core = noteMarkdownCore();
        if (!Core || typeof Core.toMarkdown !== 'function' || !contentJson) return '';
        return String(Core.toMarkdown(contentJson) || '').replace(/\s+/g, ' ').trim();
    }

    /**
     * @param {any} note
     * @param {number} [maxLen]
     * @return {string}
     */
    function notePreviewPlain(note, maxLen) {
        const cap = maxLen == null ? 160 : maxLen;
        const content = String((note && note.content) || '').trim();
        if (content) return content.slice(0, cap);
        const fromJson = plainFromJson(note && note.contentJson);
        return fromJson.slice(0, cap);
    }

    /**
     * @param {any} note
     * @return {{content?: string, contentJson?: object}|null}
     */
    function planNoteBodyBackfill(note) {
        const doc = note || {};
        const hasContent = String(doc.content || '').trim().length > 0;
        const hasJson = doc.contentJson && typeof doc.contentJson === 'object';
        if (hasContent && hasJson) return null;
        if (!hasContent && hasJson) {
            const plain = plainFromJson(doc.contentJson);
            if (!plain) return null;
            return { content: plain };
        }
        if (hasContent && !hasJson) {
            return null;
        }
        return null;
    }

    const ShepherdingNoteBodyCore = {
        notePreviewPlain,
        planNoteBodyBackfill,
        plainFromJson,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = ShepherdingNoteBodyCore;
    }
    if (global) {
        global.ShepherdingNoteBodyCore = ShepherdingNoteBodyCore;
    }
})(typeof window !== 'undefined' ? window : null);
