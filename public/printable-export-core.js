// Printable Export Core — pad a flat Printable to a multiple of 4 (MS-589).
//
// The church printer's booklet / saddle mode folds a stack whose leaf
// count is a multiple of four. This module only appends blank pages so
// the flat PDF is that length. It does not reorder, pair, or impose
// spreads — software saddle-stitch is out of scope (MS-481 lock).
//
// Pure: no DOM, no jsPDF. The print UI and the PDF snapshot both call
// `padEntries` on the layout PrintableLive already produced.

(function (global) {
    'use strict';

    const MULTIPLE = 4;

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
    // whole of the v1 folding contract.
    function padEntries(entries) {
        const list = Array.isArray(entries) ? entries.slice() : [];
        const need = blankPadCount(list.length);
        const proto = list[0] || null;
        for (let i = 0; i < need; i++) list.push(blankEntry(proto, i));
        return list;
    }

    const PrintableExportCore = {
        MULTIPLE,
        blankPadCount,
        paddedPageCount,
        padEntries,
        blankEntry,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = PrintableExportCore;
    }
    if (global) {
        global.PrintableExportCore = PrintableExportCore;
    }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
