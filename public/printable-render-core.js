// Printable Render Core — a page's tree with its data poured in.
//
// Two jobs, both pure:
//
// 1. **Expand** a page: walk its elements, repeat every iterated element once
//    per row of its list, and put each bound field's value where the element
//    would otherwise show its stand-in. Out comes a tree PrintableDom can draw
//    as-is, plus the warnings — which elements fell back, and why.
//
// 2. **Fit**: the arithmetic behind "overflow makes a new page". The browser
//    can measure how tall a list is; deciding how many rows go on this page is
//    a binary search over that measurement, and the search lives here so it
//    can be tested without a browser.
//
// What this module is handed is a `data` object with two functions:
//   rowsFor(node)      → the rows an iterated element stands for, or null
//                         when nothing has been loaded (stand-ins are shown)
//   valueFor(bind, row) → { ok, value, why } for one binding, against the row
//                         of the nearest iterated ancestor (or none)
// Neither Firestore nor the catalog appears here — see printable-data-core.

(function (global) {
    'use strict';

    // Ids on the copies of an iterated element: the first copy keeps the
    // element's own id (it is the one you click to edit), the rest carry the
    // row number after a tilde. `originalId` strips it back off.
    const COPY_SEP = '~';

    function copyId(id, index) {
        return index === 0 ? id : id + COPY_SEP + index;
    }

    function originalId(id) {
        const at = String(id || '').indexOf(COPY_SEP);
        return at < 0 ? String(id || '') : String(id).slice(0, at);
    }

    function clone(v) { return JSON.parse(JSON.stringify(v)); }

    // How the copies of an iterated element are laid out: a grid across, a
    // column down, or columns filled top to bottom. `count` is how many copies
    // are on this page, which a top-to-bottom layout needs to know its rows.
    function layoutStyle(repeat, count) {
        const l = (repeat && repeat.layout) || {};
        const perLine = Math.max(1, Number(l.perLine) || 1);
        const gap = Math.max(0, Number(l.gap) || 0) + 'px';
        if (l.direction === 'row') {
            return { display: 'grid', 'grid-template-columns': 'repeat(' + perLine + ', minmax(0, 1fr))', gap: gap, 'align-items': 'start' };
        }
        if (perLine > 1) {
            const rows = Math.max(1, Math.ceil((count || 1) / perLine));
            return { display: 'grid', 'grid-auto-flow': 'column', 'grid-template-columns': 'repeat(' + perLine + ', minmax(0, 1fr))', 'grid-template-rows': 'repeat(' + rows + ', auto)', gap: gap, 'align-items': 'start' };
        }
        return { display: 'flex', 'flex-direction': 'column', gap: gap };
    }

    // The wrapper's id: the iterated element's id plus a marker, so the canvas
    // can find "the list" as well as "the first card".
    function wrapperId(id) { return id + COPY_SEP + 'list'; }

    function expandPage(page, data, options) {
        const o = options || {};
        const warnings = [];
        const seen = {};

        function warn(nodeId, message) {
            const key = nodeId + '|' + message;
            if (seen[key]) { seen[key].count += 1; return; }
            seen[key] = { nodeId: nodeId, message: message, count: 1 };
            warnings.push(seen[key]);
        }

        function applyBindings(node, row, index) {
            if (!node.bind) return;
            Object.keys(node.bind).forEach(prop => {
                const bind = node.bind[prop];
                if (!bind) return;
                const r = data.valueFor ? data.valueFor(bind, row, node) : { ok: false, why: 'No data loaded.' };
                if (r && r.ok && r.value !== '' && r.value != null) {
                    if (prop === 'src') { node.attrs = Object.assign({}, node.attrs, { src: String(r.value) }); }
                    else if (prop === 'text') { node.text = String(r.value); delete node.children; node.children = []; }
                    else { node.attrs = Object.assign({}, node.attrs, { [prop]: String(r.value) }); }
                } else if (r && r.why && (index === 0 || index == null || o.warnEveryRow)) {
                    warn(originalId(node.id), r.why);
                } else if (r && !r.ok && r.why) {
                    warn(originalId(node.id), r.why);
                }
            });
        }

        // A copy of a subtree for row `index`, with ids suffixed and bindings
        // applied against `row`. Descendants that are themselves iterated are
        // expanded inside.
        function copyFor(node, row, index) {
            const out = clone(node);
            out.id = copyId(node.id, index);
            delete out.repeat;
            if (index > 0) { out.attrs = Object.assign({}, out.attrs, { 'data-copy': String(index) }); }
            applyBindings(out, row, index);
            if (out.children && out.children.length) {
                out.children = out.children.map(child => expandNode(child, row, index));
            }
            return out;
        }

        function expandNode(node, row, index) {
            if (node.repeat) {
                const rows = data.rowsFor ? data.rowsFor(node) : null;
                if (rows == null) {
                    // Nothing loaded: the stand-in, once, still inside its list
                    // wrapper so the layout reads the same.
                    const only = copyFor(node, row, 0);
                    only.id = node.id;
                    return wrap(node, [only], 1);
                }
                if (!rows.length) {
                    warn(node.id, 'The list is empty, so nothing is drawn here.');
                    return wrap(node, [], 0);
                }
                const copies = rows.map((r, i) => copyFor(node, r, i));
                return wrap(node, copies, rows.length);
            }
            const out = clone(node);
            if (index > 0) out.id = copyId(node.id, index);
            applyBindings(out, row, index);
            if (out.children && out.children.length) {
                out.children = out.children.map(child => expandNode(child, row, index));
            }
            return out;
        }

        function wrap(node, copies, count) {
            return {
                id: wrapperId(node.id),
                tag: 'div',
                name: '',
                attrs: { 'data-list-of': node.id },
                style: layoutStyle(node.repeat, count),
                children: copies,
            };
        }

        const nodes = (page.nodes || []).map(n => expandNode(n, null, 0));
        return { nodes: nodes, warnings: warnings };
    }

    // The iterated elements on a page whose list may spill onto new pages,
    // in tree order. The first is the one that paginates.
    function overflowingRepeats(page) {
        const out = [];
        const walk = (list) => (list || []).forEach(n => {
            if (n.repeat && n.repeat.overflow === 'new-page') out.push(n);
            walk(n.children);
        });
        walk(page.nodes);
        return out;
    }

    // How many rows fit. `fits(n)` says whether the first n rows stay inside
    // the page; it is monotone (if n fit, fewer fit), so a binary search finds
    // the largest n that does. Never returns less than 1 when there is at
    // least one row, so a row taller than the page still goes somewhere
    // rather than sending the search round for ever.
    function largestFitting(total, fits, cap) {
        const limit = cap > 0 ? Math.min(total, cap) : total;
        if (limit <= 0) return 0;
        if (fits(limit)) return limit;
        let lo = 1, hi = limit;
        while (lo < hi) {
            const mid = Math.floor((lo + hi) / 2);
            if (fits(mid)) lo = mid + 1; else hi = mid;
        }
        // lo is the first n that does not fit; the answer is one less.
        return Math.max(1, lo - 1);
    }

    // Splits rows into pages given a fit function per page. `fitsOn(pageIndex,
    // rowsSoFar, n)` is asked whether n rows starting at `rowsSoFar` fit on
    // page `pageIndex` — the browser measures; this only slices.
    function planPages(rows, cap, fitsOn) {
        const plan = [];
        let start = 0, pageIndex = 0;
        while (start < rows.length) {
            const remaining = rows.length - start;
            const n = largestFitting(remaining, count => fitsOn(pageIndex, start, count), cap);
            const take = Math.max(1, n);
            plan.push({ pageIndex: pageIndex, start: start, end: start + take });
            start += take;
            pageIndex += 1;
            if (pageIndex > 500) break; // a runaway is a bug, not a document
        }
        return plan;
    }

    const PrintableRenderCore = {
        COPY_SEP,
        copyId,
        originalId,
        wrapperId,
        layoutStyle,
        expandPage,
        overflowingRepeats,
        largestFitting,
        planPages,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = PrintableRenderCore;
    }
    if (global) {
        global.PrintableRenderCore = PrintableRenderCore;
    }
})(typeof window !== 'undefined' ? window : null);
