// Printable Export Core — pad a flat Printable to a multiple of 4 (MS-589)
// and decide whether that pad + booklet chrome apply (MS-592).
//
// The church printer's booklet / saddle mode folds a stack whose leaf
// count is a multiple of four. This module only appends blank pages so
// the flat PDF is that length. It does not reorder, pair, or impose
// spreads — software saddle-stitch is out of scope (MS-481 lock).
//
// Pad and the booklet-mode banner are the Sunday booklet path only
// (MS-590 / MS-592). Detection is the MS-481 Sunday-booklet binds
// (`sunday_typed`, `sunday_hymns`) or an explicit `bookletExport` flag
// on the Printable — not a second export product.
//
// Pure: no DOM, no jsPDF. The print UI and the PDF snapshot both call
// `exportEntries` on the layout PrintableLive already produced.

(function (global) {
    'use strict';

    const MULTIPLE = 4;

    // The Sunday booklet data sources MS-481 added. A directory, a
    // liturgy card, or any other Printable that does not wire these
    // (and has no bookletExport flag) prints as-laid-out.
    const SUNDAY_BOOKLET_SOURCES = Object.freeze(['sunday_typed', 'sunday_hymns']);

    function blankPadCount(n) {
        const count = Number(n) || 0;
        if (count <= 0) return 0;
        const rem = count % MULTIPLE;
        return rem === 0 ? 0 : MULTIPLE - rem;
    }

    function paddedPageCount(n) {
        const count = Number(n) || 0;
        if (count <= 0) return 0;
        return count + blankPadCount(count);
    }

    function blankPageFrom(entry, index) {
        const proto = (entry && entry.page) || {};
        const id = (proto.id || 'pg') + '~pad' + index;
        return {
            id: id,
            name: proto.name || '',
            margins: proto.margins ? Object.assign({}, proto.margins) : { top: 0, right: 0, bottom: 0, left: 0 },
            style: Object.assign({ 'background-color': '#ffffff' }, proto.style || {}),
            css: typeof proto.css === 'string' ? proto.css : '',
            nodes: [],
        };
    }

    function blankEntry(entry, index) {
        const page = blankPageFrom(entry, index);
        return {
            key: 'pad~' + index,
            page: page,
            nodes: [],
            warnings: [],
            generated: true,
            blank: true,
            originId: (entry && (entry.originId || (entry.page && entry.page.id))) || page.id,
        };
    }

    // Append blank leaves only. Content order is unchanged — that is the
    // whole of the v1 folding contract. Callers that must not pad a
    // non-booklet Printable go through `exportEntries`.
    function padEntries(entries) {
        const list = Array.isArray(entries) ? entries.slice() : [];
        const need = blankPadCount(list.length);
        const proto = list[0] || null;
        for (let i = 0; i < need; i++) list.push(blankEntry(proto, i));
        return list;
    }

    function walkSources(nodes, visit) {
        (nodes || []).forEach(node => {
            if (!node) return;
            if (node.repeat && node.repeat.source) visit(node.repeat.source);
            Object.keys(node.bind || {}).forEach(prop => {
                const b = node.bind[prop];
                if (b && b.source) visit(b.source);
            });
            if (node.children) walkSources(node.children, visit);
        });
    }

    // Sunday booklet path: the same binds MS-481 added for the real
    // Sunday guide, or an explicit flag when those wires are not yet on
    // the tree. Nothing else is a booklet — a 1-page directory is not.
    function isSundayBookletPath(project) {
        if (!project || typeof project !== 'object') return false;
        if (project.bookletExport === true) return true;
        let found = false;
        (project.pages || []).forEach(page => {
            walkSources(page && page.nodes, source => {
                if (SUNDAY_BOOKLET_SOURCES.indexOf(source) !== -1) found = true;
            });
        });
        return found;
    }

    function wantsBookletPad(project, opts) {
        const o = opts || {};
        if (o.padToMultipleOf4 === false) return false;
        if (o.padToMultipleOf4 === true) return true;
        return isSundayBookletPath(project);
    }

    function exportEntries(entries, project, opts) {
        const list = Array.isArray(entries) ? entries.slice() : [];
        return wantsBookletPad(project, opts) ? padEntries(list) : list;
    }

    function exportPageCount(n, project, opts) {
        const count = Number(n) || 0;
        if (count <= 0) return 0;
        return wantsBookletPad(project, opts) ? paddedPageCount(count) : count;
    }

    function exportPadCount(n, project, opts) {
        return wantsBookletPad(project, opts) ? blankPadCount(n) : 0;
    }

    const PrintableExportCore = {
        MULTIPLE,
        SUNDAY_BOOKLET_SOURCES,
        blankPadCount,
        paddedPageCount,
        padEntries,
        blankEntry,
        isSundayBookletPath,
        wantsBookletPad,
        exportEntries,
        exportPageCount,
        exportPadCount,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = PrintableExportCore;
    }
    if (global) {
        global.PrintableExportCore = PrintableExportCore;
    }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
