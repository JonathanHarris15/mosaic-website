// TipTap JSON → HTML — the renderer for a Note Body (TipTap document JSON) into
// the read-only HTML shown on the Shepherding Profile and elsewhere.
//
// This existed twice: shepherding-profile.js (live) and shepherding-document.js
// (an unused copy). The only real difference was that the document variant
// appended a "fromPage/fromId/fromTitle" breadcrumb to person/note mention
// links so the profile could show a back-link. That difference is now the
// `options.breadcrumb` parameter; pass it when you want the back-link.
//
// Pure string in/out — loaded as a classic <script> before page scripts (IIFE
// exposes window.TiptapRender) and module.exports for Node tests.
(function (global) {
    'use strict';

    function escapeHtml(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    // When options.breadcrumb = { fromPage, fromId, fromTitle } is supplied,
    // person/note mention links carry it back so the target can render a
    // "From: <document>" link. Absent → no suffix (the plain profile case).
    function breadcrumbSuffix(options) {
        const b = options && options.breadcrumb;
        if (!b) return '';
        return `&fromPage=${encodeURIComponent(b.fromPage || '')}` +
               `&fromId=${encodeURIComponent(b.fromId || '')}` +
               `&fromTitle=${encodeURIComponent(b.fromTitle || '')}`;
    }

    function renderNode(node, options) {
        switch (node.type) {
            case 'paragraph': {
                const inner = node.content ? renderNodes(node.content, options) : '';
                return inner ? `<p>${inner}</p>` : '<p></p>';
            }
            case 'text': {
                let t = escapeHtml(node.text || '');
                if (node.marks) {
                    for (const m of node.marks) {
                        if (m.type === 'bold')      t = `<strong>${t}</strong>`;
                        if (m.type === 'italic')    t = `<em>${t}</em>`;
                        if (m.type === 'underline') t = `<u>${t}</u>`;
                        if (m.type === 'highlight') {
                            const color = m.attrs?.color || '#fef08a';
                            t = `<mark style="background-color:${color};padding:0 2px;border-radius:2px;">${t}</mark>`;
                        }
                        if (m.type === 'textStyle') {
                            const styles = [];
                            if (m.attrs?.fontSize) styles.push(`font-size:${m.attrs.fontSize}`);
                            if (m.attrs?.fontFamily) styles.push(`font-family:${m.attrs.fontFamily}`);
                            if (styles.length) t = `<span style="${styles.join(';')}">${t}</span>`;
                        }
                    }
                }
                return t;
            }
            case 'mention': {
                const rawId = node.attrs?.id || '';
                const label = escapeHtml(node.attrs?.label || '?');
                let parsed = null;
                try { parsed = JSON.parse(rawId); } catch {}
                const crumb = breadcrumbSuffix(options);
                if (parsed?.kind === 'person') {
                    return `<a class="mention-chip" href="shepherding-profile.html?id=${encodeURIComponent(parsed.id)}${crumb}">@${label}</a>`;
                }
                if (parsed?.kind === 'note' && parsed.personId) {
                    return `<a class="mention-chip" href="shepherding-profile.html?id=${encodeURIComponent(parsed.personId)}${crumb}">@${label}</a>`;
                }
                if (parsed?.kind === 'elder_document') {
                    return `<a class="mention-chip" href="shepherding-document.html?id=${encodeURIComponent(parsed.id)}">@${label}</a>`;
                }
                if (parsed?.kind === 'elder_folder') {
                    return `<a class="mention-chip" href="shepherding-documents.html?folder=${encodeURIComponent(parsed.id)}">@${label}</a>`;
                }
                return `<span class="mention-chip" style="opacity:.5">@${label}</span>`;
            }
            case 'bulletList':  return `<ul>${renderNodes(node.content, options)}</ul>`;
            case 'orderedList': return `<ol>${renderNodes(node.content, options)}</ol>`;
            case 'listItem':    return `<li>${renderNodes(node.content, options)}</li>`;
            case 'hardBreak':   return '<br>';
            case 'table':       return `<table class="note-table">${renderNodes(node.content, options)}</table>`;
            case 'tableRow':    return `<tr>${renderNodes(node.content, options)}</tr>`;
            case 'tableHeader': return `<th>${node.content ? renderNodes(node.content, options) : ''}</th>`;
            case 'tableCell':   return `<td>${node.content ? renderNodes(node.content, options) : ''}</td>`;
            default:            return node.content ? renderNodes(node.content, options) : (node.text || '');
        }
    }

    function renderNodes(nodes, options) {
        if (!nodes) return '';
        return nodes.map(n => renderNode(n, options)).join('');
    }

    function renderTiptapJson(doc, options) {
        if (!doc || !doc.content) return '';
        return renderNodes(doc.content, options || {});
    }

    const TiptapRender = { renderTiptapJson };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = TiptapRender;
    }
    if (global) {
        global.TiptapRender = TiptapRender;
    }
})(typeof window !== 'undefined' ? window : null);
