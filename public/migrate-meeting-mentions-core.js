// Rewrite legacy TipTap mention payloads that used kind: 'meeting' (ADR-0015).
// Writers now emit elder_document / elder_folder. The renderer treats meeting
// as an alias; this module is for a prod pass that updates stored JSON.
(function (global) {
    'use strict';

    const LEGACY_KIND = 'meeting';
    const TARGET_KIND = 'elder_document';

    /**
     * @param {string} rawId mention node attrs.id
     * @return {{next: string, changed: boolean}}
     */
    function rewriteMentionId(rawId) {
        if (!rawId || typeof rawId !== 'string') {
            return {next: rawId, changed: false};
        }
        let parsed;
        try {
            parsed = JSON.parse(rawId);
        } catch {
            return {next: rawId, changed: false};
        }
        if (!parsed || parsed.kind !== LEGACY_KIND) {
            return {next: rawId, changed: false};
        }
        const next = Object.assign({}, parsed, {kind: TARGET_KIND});
        return {next: JSON.stringify(next), changed: true};
    }

    /**
     * @param {*} node TipTap node
     * @return {{node: *, changed: boolean}}
     */
    function rewriteNode(node) {
        if (!node || typeof node !== 'object') {
            return {node, changed: false};
        }
        let changed = false;
        let out = node;

        if (node.type === 'mention' && node.attrs && typeof node.attrs.id === 'string') {
            const {next, changed: idChanged} = rewriteMentionId(node.attrs.id);
            if (idChanged) {
                out = Object.assign({}, node, {
                    attrs: Object.assign({}, node.attrs, {id: next}),
                });
                changed = true;
            }
        }

        if (Array.isArray(node.content)) {
            const content = [];
            let childChanged = false;
            for (const child of node.content) {
                const r = rewriteNode(child);
                content.push(r.node);
                if (r.changed) childChanged = true;
            }
            if (childChanged) {
                out = Object.assign({}, out === node ? node : out, {content});
                changed = true;
            }
        }

        return {node: out, changed};
    }

    /**
     * @param {*} doc TipTap doc JSON or null
     * @return {{doc: *, changed: boolean, mentionCount: number}}
     */
    function rewriteContentJson(doc) {
        if (!doc || typeof doc !== 'object') {
            return {doc, changed: false, mentionCount: 0};
        }
        const r = rewriteNode(doc);
        return {
            doc: r.node,
            changed: r.changed,
            mentionCount: r.changed ? countLegacyMentions(doc) : 0,
        };
    }

    /**
     * @param {*} node
     * @return {number}
     */
    function countLegacyMentions(node) {
        if (!node || typeof node !== 'object') return 0;
        let n = 0;
        if (node.type === 'mention' && node.attrs && typeof node.attrs.id === 'string') {
            try {
                const parsed = JSON.parse(node.attrs.id);
                if (parsed && parsed.kind === LEGACY_KIND) n += 1;
            } catch { /* ignore */ }
        }
        if (Array.isArray(node.content)) {
            for (const child of node.content) n += countLegacyMentions(child);
        }
        return n;
    }

    const api = {
        LEGACY_KIND,
        TARGET_KIND,
        rewriteMentionId,
        rewriteContentJson,
        countLegacyMentions,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    } else {
        global.MigrateMeetingMentionsCore = api;
    }
}(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this));
