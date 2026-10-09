// Printable Export Core — two print paths for the same laid-out pages.
//
// Flat (MS-589 / MS-592). `exportEntries` appends blank leaves so a
// Sunday booklet is a multiple of 4. It does not reorder. A copier set
// to Booklet / Saddle Stitch folds that stack itself. Pad and the
// booklet banner are the Sunday booklet path only: the MS-481 binds
// (`sunday_typed`, `sunday_hymns`) or an explicit `bookletExport` flag.
//
// Folio. `folioSpreads` is how the service guide editor prints
// (`GuideEngine.imposeSpreads`): pad to a multiple of 4, then pair
// pages onto landscape sheets, two pages each, saddle-stitch order.
// Any Printable can take this path — a directory is not forced onto
// it, and choosing it does not change the flat export. The sheet is
// twice the page width (half letter lands on letter landscape).
//
// Pure: no DOM, no jsPDF. The print UI calls these on the layout
// PrintableLive already produced.

(function (global) {
    'use strict';

    const MULTIPLE = 4;

    // The Sunday booklet data sources MS-481 added. A directory, a
    // liturgy card, or any other Printable that does not wire these
    // (and has no bookletExport flag) prints as-laid-out.
    const SUNDAY_BOOKLET_SOURCES = Object.freeze(['sunday_typed', 'sunday_hymns']);
    const LEGACY_FILL_PREFIX = 'legacy_';

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
            if (node.repeat && node.repeat.source) visit(node.repeat.source, node.repeat);
            Object.keys(node.bind || {}).forEach(prop => {
                const b = node.bind[prop];
                if (b && b.source) visit(b.source, b);
            });
            if (node.children) walkSources(node.children, visit);
        });
    }

    // Sunday booklet path: the same binds MS-481 added for the real
    // Sunday guide, migrated legacy_* event fill-ins, or an explicit flag.
    // Nothing else is a booklet — a 1-page directory is not.
    function isSundayBookletPath(project) {
        if (!project || typeof project !== 'object') return false;
        if (project.bookletExport === true) return true;
        if ((project.inputs || []).some(i => i && String(i.id || '').indexOf(LEGACY_FILL_PREFIX) === 0)) {
            return true;
        }
        let found = false;
        (project.pages || []).forEach(page => {
            walkSources(page && page.nodes, (source, bind) => {
                if (SUNDAY_BOOKLET_SOURCES.indexOf(source) !== -1) found = true;
                if (source === 'event_field' && bind && String(bind.field || '').indexOf(LEGACY_FILL_PREFIX) === 0) {
                    found = true;
                }
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

    function inches(n) {
        const x = Number(n);
        if (!isFinite(x) || x < 0) return 0;
        return Math.round(x * 1000) / 1000;
    }

    // The physical sheet folio prints on: two pages side by side.
    function folioSheet(template) {
        const t = template || {};
        const pageWidthIn = inches(t.widthIn);
        const pageHeightIn = inches(t.heightIn);
        return {
            pageWidthIn: pageWidthIn,
            pageHeightIn: pageHeightIn,
            widthIn: inches(pageWidthIn * 2),
            heightIn: pageHeightIn,
        };
    }

    // Saddle-stitch spreads, the same pairing as GuideEngine.imposeSpreads.
    // Pages are padded with blanks to a multiple of 4. For spread k the two
    // indices sum to n-1; even spreads put the high page on the left, odd
    // spreads flip. Blank leaves are real empty pages so a print can draw them.
    // This always pads — folio is a folded booklet, including for a Printable
    // that would not pad on the flat path.
    function folioSpreads(entries) {
        const padded = padEntries(Array.isArray(entries) ? entries : []);
        const n = padded.length;
        const spreads = [];
        for (let k = 0; k < n / 2; k++) {
            const hi = n - 1 - k;
            const lo = k;
            const even = (k % 2 === 0);
            const leftIdx = even ? hi : lo;
            const rightIdx = even ? lo : hi;
            spreads.push({
                left: padded[leftIdx],
                leftIdx: leftIdx,
                right: padded[rightIdx],
                rightIdx: rightIdx,
            });
        }
        return spreads;
    }

    // Print stylesheet for those sheets. `scale` is PrintableCore.printScale
    // (96 / dpi) so a page laid out at 150 dpi still lands at true size.
    function folioPrintCss(template, scale) {
        const sheet = folioSheet(template);
        const s = (typeof scale === 'number' && isFinite(scale) && scale > 0) ? scale : 1;
        return '@page { size: ' + sheet.widthIn + 'in ' + sheet.heightIn + 'in; margin: 0; }'
            + ' .pr-folio-sheet { width: ' + sheet.widthIn + 'in; height: ' + sheet.heightIn + 'in;'
            + ' display: flex; flex-direction: row; align-items: stretch; overflow: hidden;'
            + ' page-break-after: always; break-after: page; }'
            + ' .pr-folio-leaf { width: ' + sheet.pageWidthIn + 'in; height: ' + sheet.pageHeightIn + 'in;'
            + ' flex: 0 0 ' + sheet.pageWidthIn + 'in; overflow: hidden; position: relative; background: #fff; }'
            + ' .pr-folio-leaf > .pr-page { transform: scale(' + s + '); transform-origin: 0 0; }';
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
        folioSheet,
        folioSpreads,
        folioPrintCss,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = PrintableExportCore;
    }
    if (global) {
        global.PrintableExportCore = PrintableExportCore;
    }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
