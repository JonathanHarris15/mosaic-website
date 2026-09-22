// Printable Live — a Printable with today's data in it, laid out page by page.
//
// The one place the editor, the view-only page and the PDF snapshot all go to
// turn a project into pages they can draw:
//
//   collectNeeds(project)             what every binding and list on it asks for
//   resolver(project, bundle, ctx)    rows and values, cached per source
//   layoutPages(project, resolver, host, options)
//       the pages to draw — the project's own, each overflowing list sliced
//       across the real pages that continue it, and a new page cloned when
//       the rows still do not fit (needsPersist so the editor can keep it)
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

    const STAND_INS = { rowsFor: () => null, valueFor: () => ({ ok: false, why: '' }) };

    function overflowingRepeatOn(page) {
        return Render.overflowingRepeats(page)[0] || null;
    }

    // The origin page plus every stored page that immediately follows it and
    // continues its list. Those pages are real and keep their own design.
    function continuationChain(project, origin) {
        const pages = project.pages || [];
        const start = pages.findIndex(p => p.id === origin.id);
        const chain = [origin];
        if (start < 0) return chain;
        for (let i = start + 1; i < pages.length; i++) {
            const p = pages[i];
            if (p.continues && p.continues.from === origin.id) chain.push(p);
            else break;
        }
        return chain;
    }

    function templateForNew(project, origin, repeat) {
        const chosenId = repeat.repeat && repeat.repeat.continueWith;
        const chosen = chosenId && (project.pages || []).find(p => p.id === chosenId);
        if (chosen && overflowingRepeatOn(chosen)) return chosen;
        return origin;
    }

    // Slice the *origin* list onto this page's iterated element, so a
    // continuation page that was redesigned still reads the same live rows.
    function sliceFrom(res, originRepeat, pageRepeatId, start, end) {
        return {
            rowsFor: node => {
                if (!node.repeat) return res.rowsFor(node);
                if (node.id === pageRepeatId || node.id === originRepeat.id) {
                    const rows = res.rowsFor(originRepeat);
                    return rows ? rows.slice(start, end) : rows;
                }
                return res.rowsFor(node);
            },
            valueFor: res.valueFor,
        };
    }

    function entryOf(page, expanded, extras) {
        const x = extras || {};
        return {
            key: page.id,
            page: page,
            nodes: expanded.nodes,
            warnings: expanded.warnings,
            generated: false,
            needsPersist: !!x.needsPersist,
            originId: x.originId || page.id,
            pageIndex: x.pageIndex == null ? 0 : x.pageIndex,
            continuation: x.continuation || 0,
            rowsFrom: x.rowsFrom,
            rowsTo: x.rowsTo,
        };
    }

    function emptySlice(res, originRepeat, pageRepeatId) {
        return sliceFrom(res, originRepeat, pageRepeatId, 0, 0);
    }

    // The pages to draw. `res` null means stand-ins everywhere.
    // `options.fitsOn(pageIndex, start, n)` lets tests paginate without a DOM.
    function layoutPages(project, res, host, options) {
        const o = options || {};
        const template = project.template;
        const out = [];
        const claimed = {};
        const pages = project.pages || [];
        const canPaginate = !!(res && (host || o.fitsOn));

        function emitEmptyContinuations(chain, originRepeat, pageIndex, data) {
            chain.slice(1).forEach((pg, i) => {
                claimed[pg.id] = true;
                const r = overflowingRepeatOn(pg);
                const expanded = Render.expandPage(pg, (res && originRepeat && r)
                    ? emptySlice(res, originRepeat, r.id)
                    : data);
                out.push(entryOf(pg, expanded, { originId: chain[0].id, pageIndex: pageIndex, continuation: i + 1, rowsFrom: 0, rowsTo: 0 }));
            });
        }

        pages.forEach((page, pageIndex) => {
            if (claimed[page.id]) return;
            const data = res || STAND_INS;

            if (page.continues && page.continues.from) {
                const expanded = Render.expandPage(page, data);
                out.push(entryOf(page, expanded, { originId: page.continues.from, pageIndex: pageIndex }));
                return;
            }

            const overflowing = (res && canPaginate) ? Render.overflowingRepeats(page) : [];
            const repeat = overflowing[0] || null;
            const rows = repeat ? res.rowsFor(repeat) : null;
            const chain = continuationChain(project, page);

            if (!repeat || !rows || !rows.length || !canPaginate) {
                const expanded = Render.expandPage(page, data);
                out.push(entryOf(page, expanded, { originId: page.id, pageIndex: pageIndex }));
                emitEmptyContinuations(chain, repeat || overflowingRepeatOn(page), pageIndex, data);
                return;
            }

            chain.slice(1).forEach(p => { claimed[p.id] = true; });
            const proto = templateForNew(project, page, repeat);
            const originCap = (repeat.repeat.layout && repeat.repeat.layout.maxPerPage) || 0;
            const capAt = (i) => {
                const bg = chain[i] || proto;
                const r = overflowingRepeatOn(bg) || repeat;
                return (r.repeat.layout && r.repeat.layout.maxPerPage) || originCap;
            };
            const pageAt = (i) => chain[i] || proto;
            const repeatAt = (i) => overflowingRepeatOn(pageAt(i)) || repeat;

            const fitsOn = (i, start, n) => {
                const bg = pageAt(i);
                const r = repeatAt(i);
                if (o.fitsOn) return o.fitsOn(i, start, n, { page: bg, repeat: r });
                const probe = Render.expandPage(bg, sliceFrom(res, repeat, r.id, start, start + n));
                return fits(host, template, bg, probe.nodes, r.id);
            };

            const plan = Render.planPages(rows, capAt, fitsOn);
            plan.forEach((slice, i) => {
                let bg = chain[i];
                let needsPersist = false;
                if (!bg) {
                    bg = Core.clonePage(template, proto, { continues: { from: page.id, repeat: repeat.id } });
                    needsPersist = true;
                    chain.push(bg);
                }
                const r = overflowingRepeatOn(bg) || repeat;
                const expanded = Render.expandPage(bg, sliceFrom(res, repeat, r.id, slice.start, slice.end), { warnEveryRow: false });
                out.push(entryOf(bg, expanded, {
                    needsPersist: needsPersist,
                    originId: page.id,
                    pageIndex: pageIndex,
                    continuation: i,
                    rowsFrom: slice.start,
                    rowsTo: slice.end,
                }));
            });

            for (let i = plan.length; i < chain.length; i++) {
                const bg = chain[i];
                const r = overflowingRepeatOn(bg);
                const expanded = Render.expandPage(bg, r ? emptySlice(res, repeat, r.id) : data, { warnEveryRow: false });
                out.push(entryOf(bg, expanded, {
                    originId: page.id,
                    pageIndex: pageIndex,
                    continuation: i,
                    rowsFrom: 0,
                    rowsTo: 0,
                }));
            }
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
