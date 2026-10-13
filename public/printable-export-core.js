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
// Folio pad tool. When the laid-out stack is not a multiple of 4,
// the print UI lets the operator duplicate a page (or add a blank)
// into a temporary print-only stack until it folds cleanly. Those
// leaves never write the printable. Insert slots follow the same
// overflow-run rule as the pages filmstrip. Page numbers on the
// temporary stack are restamped for the print order.
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
    // that would not pad on the flat path. Prefer a pad-ready `folioPadEntries`
    // stack first so the operator's brush copies are what print, not blanks.
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

    function deepClone(v) {
        return JSON.parse(JSON.stringify(v));
    }

    function cloneEntriesForFolio(entries) {
        return deepClone(Array.isArray(entries) ? entries : []);
    }

    function folioNeedsPad(entries) {
        return blankPadCount((entries || []).length) > 0;
    }

    function folioPadNeed(entries) {
        return blankPadCount((entries || []).length);
    }

    function entryLabel(entry, index) {
        const name = (entry && entry.page && entry.page.name) || '';
        const n = Math.round(Number(index)) + 1;
        const base = 'Page ' + (Number.isFinite(n) && n > 0 ? n : '?');
        if (entry && entry.folioPad) {
            return name ? (base + ' · ' + name + ' (print only)') : (base + ' (print only)');
        }
        return name ? (base + ' · ' + name) : base;
    }

    // Same rule as PrintableCore.canInsertAfter: never between two sheets of
    // one overflow run (`continues.from` chain).
    function canInsertAfterEntry(entries, index) {
        const list = entries || [];
        if (index < -1 || index >= list.length) return false;
        if (index < 0 || index >= list.length - 1) return true;
        const a = list[index] && list[index].page;
        const b = list[index + 1] && list[index + 1].page;
        if (!a || !b || !b.continues || !b.continues.from) return true;
        const from = b.continues.from;
        if (a.id === from) return false;
        if (a.continues && a.continues.from === from) return false;
        return true;
    }

    function folioInsertAfterOptions(entries) {
        const list = entries || [];
        const opts = [{ afterIndex: -1, label: 'At the start' }];
        for (let i = 0; i < list.length; i++) {
            if (!canInsertAfterEntry(list, i)) continue;
            opts.push({ afterIndex: i, label: 'After ' + entryLabel(list[i], i) });
        }
        return opts;
    }

    function folioSourceOptions(entries) {
        const list = entries || [];
        const opts = [{ kind: 'blank', sourceIndex: -1, label: 'Blank page' }];
        list.forEach((entry, i) => {
            if (!entry || entry.blank) return;
            opts.push({ kind: 'duplicate', sourceIndex: i, label: entryLabel(entry, i) });
        });
        return opts;
    }

    function restampPageNumberNodes(nodes, pageIndex) {
        const n = Math.round(Number(pageIndex));
        const text = Number.isFinite(n) && n >= 0 ? String(n + 1) : '';
        (nodes || []).forEach(node => {
            if (!node) return;
            if (node.pageNumber) {
                node.text = text;
                node.children = [];
            }
            if (node.children) restampPageNumberNodes(node.children, pageIndex);
        });
    }

    function restampFolioPageNumbers(entries) {
        (entries || []).forEach((entry, i) => {
            if (!entry) return;
            entry.pageIndex = i;
            restampPageNumberNodes(entry.nodes, i);
            if (entry.page && entry.page.nodes && entry.page.nodes !== entry.nodes) {
                restampPageNumberNodes(entry.page.nodes, i);
            }
        });
        return entries;
    }

    // A page id is also the CSS scope class (`pr-` + id). `~` is a CSS
    // sibling combinator, so an id like `notes~folio…` makes every rule in
    // the page stylesheet fail to match and the copy draws unstyled.
    function cssSafeId(value) {
        const cleaned = String(value || 'pg').replace(/[^A-Za-z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
        if (!cleaned) return 'pg';
        return /^[A-Za-z_]/.test(cleaned) ? cleaned : ('p-' + cleaned);
    }

    function duplicateFolioEntry(entry, stamp) {
        const copy = deepClone(entry || {});
        const base = (entry && entry.key) || (entry && entry.page && entry.page.id) || 'pg';
        const id = cssSafeId(base) + '-folio-' + cssSafeId(stamp);
        copy.key = id;
        copy.folioPad = true;
        copy.folioDuplicate = true;
        copy.blank = false;
        copy.generated = true;
        copy.originId = (entry && (entry.originId || (entry.page && entry.page.id))) || id;
        if (copy.page) {
            const nodes = Array.isArray(copy.nodes) ? copy.nodes : (copy.page.nodes || []);
            copy.page = Object.assign({}, copy.page, {
                id: id,
                continues: null,
                name: (entry.page && entry.page.name) || copy.page.name || '',
                nodes: deepClone(nodes),
            });
        }
        return copy;
    }

    function blankFolioPadEntry(proto, stamp) {
        const entry = blankEntry(proto, stamp);
        entry.folioPad = true;
        entry.key = 'folio-blank~' + stamp;
        if (entry.page) entry.page.id = entry.key;
        return entry;
    }

    // Insert one temporary leaf into a folio working stack. Mutates nothing
    // on the caller's array: returns a new list with page numbers restamped.
    // `action.kind` is 'duplicate' | 'blank'. `afterIndex` is -1 for start.
    function applyFolioPad(entries, action) {
        const list = cloneEntriesForFolio(entries);
        const act = action || {};
        const afterIndex = Math.round(Number(act.afterIndex));
        if (!Number.isFinite(afterIndex) || afterIndex < -1 || afterIndex >= list.length) {
            return { ok: false, why: 'Pick where the page should go.', entries: list };
        }
        if (!canInsertAfterEntry(list, afterIndex)) {
            return { ok: false, why: 'That spot sits inside an overflow run. Insert before or after the run.', entries: list };
        }
        const stamp = Date.now().toString(36) + Math.floor(Math.random() * 1000);
        let leaf = null;
        if (act.kind === 'blank') {
            leaf = blankFolioPadEntry(list[0] || null, stamp);
        } else if (act.kind === 'duplicate') {
            const sourceIndex = Math.round(Number(act.sourceIndex));
            if (!Number.isFinite(sourceIndex) || sourceIndex < 0 || sourceIndex >= list.length) {
                return { ok: false, why: 'Pick a page to duplicate.', entries: list };
            }
            const source = list[sourceIndex];
            if (!source || source.blank) {
                return { ok: false, why: 'Pick a real page to duplicate.', entries: list };
            }
            leaf = duplicateFolioEntry(source, stamp);
        } else {
            return { ok: false, why: 'Pick a page to duplicate, or a blank page.', entries: list };
        }
        list.splice(afterIndex + 1, 0, leaf);
        restampFolioPageNumbers(list);
        return { ok: true, entries: list, leaf: leaf };
    }

    // Drop a leaf from the temporary print stack. Any page can go — this
    // never writes the printable. Keep at least one page so there is still
    // a fold to print.
    function removeFolioPadAt(entries, index) {
        const list = cloneEntriesForFolio(entries);
        const i = Math.round(Number(index));
        if (!Number.isFinite(i) || i < 0 || i >= list.length) {
            return { ok: false, why: 'That page is not in the print stack.', entries: list };
        }
        if (list.length <= 1) {
            return { ok: false, why: 'Keep at least one page to print.', entries: list };
        }
        list.splice(i, 1);
        restampFolioPageNumbers(list);
        return { ok: true, entries: list };
    }

    function folioReadyToPrint(entries) {
        const n = (entries || []).length;
        return n > 0 && n % MULTIPLE === 0;
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
        cloneEntriesForFolio,
        cssSafeId,
        folioNeedsPad,
        folioPadNeed,
        entryLabel,
        canInsertAfterEntry,
        folioInsertAfterOptions,
        folioSourceOptions,
        restampFolioPageNumbers,
        applyFolioPad,
        removeFolioPadAt,
        folioReadyToPrint,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = PrintableExportCore;
    }
    if (global) {
        global.PrintableExportCore = PrintableExportCore;
    }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
