// Migrate insert_page_number binds to node.pageNumber (MS-801).
(function (global) {
    'use strict';

    function legacyPageNumber(bind) {
        if (!bind || !bind.text || bind.text.source !== 'insert_page_number') return null;
        const cls = bind.class || bind.className;
        const mirror = !!(cls && cls.source === 'insert_page_number');
        return { mirror: mirror };
    }

    function stripLegacyPageNumber(bind) {
        const next = Object.assign({}, bind || {});
        if (next.text && next.text.source === 'insert_page_number') delete next.text;
        ['class', 'className'].forEach((k) => {
            if (next[k] && next[k].source === 'insert_page_number') delete next[k];
        });
        return Object.keys(next).length ? next : null;
    }

    function parsePx(v) {
        const n = parseFloat(v);
        return Number.isFinite(n) ? Math.round(n) : 0;
    }

    /**
     * @param {any} node
     * @param {(spec: any) => any} normalizePageNumber
     * @return {{changed: boolean, node: any}}
     */
    function migrateNode(node, normalizePageNumber) {
        const n = node || {};
        if (n.pageNumber) return { changed: false, node: n };
        const legacy = legacyPageNumber(n.bind);
        if (!legacy) return { changed: false, node: n };

        const style = n.style || {};
        const placed = style.left || style.right || style.top || style.bottom;
        const pageNumber = normalizePageNumber({
            mirror: legacy.mirror,
            anchor: placed ? 'free' : 'bottom-right',
            inset: 36,
            left: parsePx(style.left),
            top: parsePx(style.top),
        });

        const next = Object.assign({}, n);
        const rest = stripLegacyPageNumber(next.bind);
        if (rest) next.bind = rest;
        else delete next.bind;
        next.pageNumber = pageNumber;
        delete next.repeat;
        next.children = [];
        if (typeof next.text !== 'string') next.text = '';
        return { changed: true, node: next };
    }

    function walkPages(project, normalizePageNumber) {
        let changed = false;
        const pages = (project && project.pages) || [];
        const nextPages = pages.map((page) => {
            const nodes = (page && page.nodes) || [];
            const nextNodes = nodes.map((node) => {
                const result = migrateNode(node, normalizePageNumber);
                if (result.changed) changed = true;
                return result.node;
            });
            return Object.assign({}, page, { nodes: nextNodes });
        });
        return { changed, project: Object.assign({}, project, { pages: nextPages }) };
    }

    const MigratePrintablePageNumberCore = {
        migrateNode,
        walkPages,
        legacyPageNumber,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = MigratePrintablePageNumberCore;
    }
    if (global) {
        global.MigratePrintablePageNumberCore = MigratePrintablePageNumberCore;
    }
})(typeof window !== 'undefined' ? window : null);
