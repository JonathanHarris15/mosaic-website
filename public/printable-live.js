// Printable Live — a Printable with today's data in it, laid out page by page.
//
// The one place the editor, the view-only page and the PDF snapshot all go to
// turn a project into pages they can draw:
//
//   collectNeeds(project)             what every binding and list on it asks for
//   resolver(project, bundle, ctx)    rows and values, cached per source
//   layoutPages(project, resolver, host)
//       the pages to draw — the project's own, plus the pages an overflowing
//       list generates, each with its elements expanded and its warnings
//
// Pagination needs a browser to measure with: `host` is a hidden element at
// true page size that probe pages are drawn into and measured. Without one
// (no DOM) every list stays on its own page, which is what the tests want.
//
// Pure decisions live below this — PrintableDataCore resolves, and
// PrintableRenderCore expands and bisects. This module only joins them.

(function (global) {
    'use strict';

    const isNode = (typeof require === 'function' && typeof module !== 'undefined' && module.exports);
    const Core = isNode ? require('./printable-core.js') : global.PrintableCore;
    const Data = isNode ? require('./printable-data-core.js') : global.PrintableDataCore;
    const Render = isNode ? require('./printable-render-core.js') : global.PrintableRenderCore;

    function keyOf(source, params) {
        return source + '|' + JSON.stringify(params || {});
    }

    // Every source a project reads, as { source, params } pairs — one per
    // distinct choice of params.
    function usesOf(project) {
        const uses = {};
        (project.pages || []).forEach(page => Core.walk(page.nodes, node => {
            if (node.repeat && node.repeat.source) uses[keyOf(node.repeat.source, node.repeat.params)] = { source: node.repeat.source, params: node.repeat.params || {} };
            Object.keys(node.bind || {}).forEach(prop => {
                const b = node.bind[prop];
                if (b && b.scope === 'global' && b.source) uses[keyOf(b.source, b.params)] = { source: b.source, params: b.params || {} };
            });
        }));
        return Object.keys(uses).map(k => uses[k]);
    }

    function collectNeeds(project, today) {
        return usesOf(project).reduce((acc, u) => mergeNeeds(acc, Data.needsFor(u.source, u.params, today)), {});
    }

    function mergeNeeds(a, b) {
        const DS = global.PrintableDataStore;
        if (DS && DS.mergeNeeds) return DS.mergeNeeds(a, b);
        return Object.assign({}, a, b);
    }

    // Rows and values for one project against one bundle. Everything is
    // resolved once per source+params and remembered, so a directory with two
    // hundred cards costs one resolve, not two hundred.
    function resolver(project, bundle, ctx) {
        const cache = {};
        const c = Object.assign({ today: Data.toDateStr(new Date()), level: 'viewer' }, ctx || {});

        function resolved(source, params) {
            const k = keyOf(source, params);
            if (!cache[k]) cache[k] = Data.resolve(source, params, bundle || {}, c);
            return cache[k];
        }

        function rowsFor(node) {
            if (!node.repeat || !node.repeat.source) return null;
            return resolved(node.repeat.source, node.repeat.params).rows;
        }

        function valueFor(bind, row) {
            if (!bind) return { ok: false, why: 'Not wired.' };
            if (bind.scope === 'item') {
                if (!row) return { ok: false, why: 'This element is wired to a row but is not inside an iterated element.' };
                const v = row[bind.field];
                if (v === undefined) return { ok: false, why: 'The "' + bind.field + '" field is not visible to you.' };
                if (v === '' || v == null) return { ok: false, why: 'No ' + bind.field + ' for ' + (row.name || row.label || row._id || 'this row') + '.' };
                return { ok: true, value: v };
            }
            if (!bind.source) return { ok: false, why: 'Not wired.' };
            const r = resolved(bind.source, bind.params);
            const one = r.rows[0];
            if (!one) return { ok: false, why: r.warnings[0] || 'Nothing to show.' };
            const v = one[bind.field];
            if (v === '' || v == null) return { ok: false, why: r.warnings[0] || ('No ' + fieldName(bind) + ' to show.') };
            return { ok: true, value: v };
        }

        function fieldName(bind) {
            const src = Data.sourceByKey(bind.source);
            const f = src && src.fields.find(x => x.key === bind.field);
            return f ? f.label.toLowerCase() : bind.field;
        }

        // The source-level warnings — "nothing planned for that Sunday" — for
        // every source the project reads.
        function sourceWarnings() {
            const out = [];
            usesOf(project).forEach(u => {
                const r = resolved(u.source, u.params);
                const src = Data.sourceByKey(u.source);
                (r.warnings || []).forEach(w => out.push({ source: u.source, label: src ? src.label : u.source, message: w }));
            });
            return out;
        }

        return { rowsFor, valueFor, resolved, sourceWarnings, ctx: c };
    }

    // A data object for expandPage that shows only a slice of one list —
    // what a page shows of a list that continues on the next.
    function sliced(res, nodeId, start, end) {
        return {
            rowsFor: node => {
                const rows = res.rowsFor(node);
                if (rows && node.id === nodeId) return rows.slice(start, end);
                return rows;
            },
            valueFor: res.valueFor,
        };
    }

    const STAND_INS = { rowsFor: () => null, valueFor: () => ({ ok: false, why: '' }) };

    // The pages to draw. `res` null means stand-ins everywhere.
    function layoutPages(project, res, host) {
        const template = project.template;
        const out = [];
        (project.pages || []).forEach((page, pageIndex) => {
            const data = res || STAND_INS;
            const overflowing = res ? Render.overflowingRepeats(page) : [];
            const repeat = overflowing[0] || null;
            const rows = repeat ? res.rowsFor(repeat) : null;

            if (!repeat || !rows || !rows.length || !host) {
                const expanded = Render.expandPage(page, data);
                out.push({ key: page.id, page: page, nodes: expanded.nodes, warnings: expanded.warnings, generated: false, originId: page.id, pageIndex: pageIndex });
                return;
            }

            // The page new pages copy must carry the list, or the rows would
            // have nowhere to go; a page chosen that lacks it falls back to
            // the page the list started on.
            const chosen = repeat.repeat.continueWith && (project.pages || []).find(p => p.id === repeat.repeat.continueWith);
            const continueWith = (chosen && Core.findNode(chosen, repeat.id)) ? chosen : page;
            const cap = (repeat.repeat.layout && repeat.repeat.layout.maxPerPage) || 0;
            const fitsOn = (i, start, n) => {
                const bg = i === 0 ? page : continueWith;
                const probe = Render.expandPage(bg, sliced(res, repeat.id, start, start + n));
                return fits(host, template, bg, probe.nodes, repeat.id);
            };
            const plan = Render.planPages(rows, cap, fitsOn);
            plan.forEach((slice, i) => {
                const bg = i === 0 ? page : continueWith;
                const expanded = Render.expandPage(bg, sliced(res, repeat.id, slice.start, slice.end), { warnEveryRow: false });
                out.push({
                    key: page.id + (i === 0 ? '' : '~' + i),
                    page: bg,
                    nodes: expanded.nodes,
                    warnings: expanded.warnings,
                    generated: i > 0,
                    originId: page.id,
                    pageIndex: pageIndex,
                    continuation: i,
                    rowsFrom: slice.start,
                    rowsTo: slice.end,
                });
            });
        });
        return out;
    }

    // Does the list wrapper stay inside the page's content box? Drawn into the
    // measuring host at true size, measured, removed.
    function fits(host, template, page, nodes, repeatId) {
        const Dom = global.PrintableDom;
        if (!Dom) return true;
        const el = Dom.renderPage(Object.assign({}, page, { nodes: nodes }), template, {});
        host.appendChild(el);
        try {
            const list = el.querySelector('[data-list-of="' + repeatId + '"]');
            if (!list) return true;
            const pageRect = el.getBoundingClientRect();
            const listRect = list.getBoundingClientRect();
            const limit = pageRect.top + template.heightPx - (page.margins ? page.margins.bottom : 0) + 0.5;
            return listRect.bottom <= limit;
        } finally {
            el.remove();
        }
    }

    // Every warning for the project, for the drawer: the sources' own, then
    // the elements'.
    function warningsFor(entries, res, project) {
        const out = [];
        if (res) res.sourceWarnings().forEach(w => out.push({ kind: 'source', label: w.label, message: w.message }));
        const seen = {};
        entries.forEach(entry => (entry.warnings || []).forEach(w => {
            const key = w.nodeId + '|' + w.message;
            if (seen[key]) return;
            seen[key] = true;
            const page = (project.pages || []).find(p => Core.findNode(p, w.nodeId));
            const node = page && Core.findNode(page, w.nodeId);
            out.push({ kind: 'element', nodeId: w.nodeId, pageId: page ? page.id : null, label: node ? (node.name || node.tag) : w.nodeId, message: w.message, count: w.count || 1 });
        }));
        return out;
    }

    const PrintableLive = { keyOf, usesOf, collectNeeds, resolver, layoutPages, warningsFor, STAND_INS };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = PrintableLive;
    }
    if (global) {
        global.PrintableLive = PrintableLive;
    }
})(typeof window !== 'undefined' ? window : globalThis);
