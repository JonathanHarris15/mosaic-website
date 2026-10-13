// Printable DOM — draws a page's element tree as real elements.
//
// The one place a Printable's tree becomes DOM, shared by the editor's
// canvas, the view-only page and the PDF snapshot, so they cannot draw the
// same page three different ways. It is browser-only (it needs `document`)
// and deliberately thin: PrintableCore says what a page is, PrintableRender
// says what its bound values are today, and this only draws.
//
// Two modes. **Editing** stamps every element with `data-pid` so the canvas
// can find the element under the cursor, and draws an empty image as a
// placeholder box. **Output** (view, print, PDF) leaves nothing of the
// editor behind — an empty image is an empty image at its own size.

(function (global) {
    'use strict';

    const Core = global.PrintableCore;

    // The rules every drawn page depends on — box-sizing, the paper's type
    // and colour, block images — put into the document ONCE by the first
    // page drawn, so the editor, the view page and the PDF snapshot on the
    // event page all lay out the same page the same way.
    const BASE_CSS = [
        '.pr-page { font-family: "EB Garamond", Georgia, serif; color: #000; background: #fff; }',
        '.pr-page * { box-sizing: border-box; }',
        '.pr-page img { display: block; max-width: 100%; }',
        '.pr-page ul { list-style: disc; padding-left: 1.25em; margin: 0.35em 0; }',
        '.pr-page ol { list-style: decimal; padding-left: 1.25em; margin: 0.35em 0; }',
        '.pr-page .m-scripture { line-height: 1.45; }',
        '.pr-page .m-scripture__line { display: block; }',
        '.pr-page .m-scripture__line--poetry { padding-left: 1.25em; }',
        '.pr-page .m-scripture__gap { display: block; height: 0.6em; }',
        '.pr-page .m-scripture__n { font-size: 0.65em; line-height: 0; margin-right: 0.2em; }',
        '.pr-page .pr-pagenums { position: absolute; inset: 0; z-index: 1000; pointer-events: none; }',
        '.pr-page .pr-pagenum { pointer-events: auto; cursor: grab; }',
    ].join('\n');

    function ensureBaseStyles() {
        if (typeof document === 'undefined' || document.getElementById('pr-page-base')) return;
        const style = document.createElement('style');
        style.id = 'pr-page-base';
        style.textContent = BASE_CSS;
        (document.head || document.documentElement).appendChild(style);
    }

    function applyStyle(el, style) {
        Object.keys(style || {}).forEach(k => {
            const v = style[k];
            if (v === '' || v == null) return;
            el.style.setProperty(k, String(v));
        });
    }

    // `values`, when given, is what PrintableRender resolved for this node:
    // { text, src } — either may be absent, in which case the element's own
    // content stands (that is the fallback the brief asks for).
    function renderNode(node, opts) {
        const o = opts || {};
        const el = document.createElement(node.tag || 'div');
        Object.keys(node.attrs || {}).forEach(k => {
            if (k === 'style' || /^data-(pid|name|bind|repeat)$/.test(k)) return;
            if (node.attrs[k] == null) return;
            if (k === 'src' && node.tag === 'img') return;
            el.setAttribute(k, String(node.attrs[k]));
        });
        applyStyle(el, node.style);
        if (o.editing) {
            el.setAttribute('data-pid', node.id);
            if (node.bind) el.setAttribute('data-bound', '1');
            if (node.repeat) el.setAttribute('data-repeat', '1');
        }
        const values = (o.values && o.values[node.id]) || null;
        const fill = typeof o.fillFor === 'function' ? o.fillFor(node) : null;

        if (fill && (node.tag === 'img' || fill.kind === 'image')) {
            return renderFillImage(node, fill);
        }

        if (node.tag === 'img') {
            // fill is the default once both axes are set, and it stretches.
            // Cover and contain stay whatever the element asked for.
            if (!node.style || !node.style['object-fit']) el.style.objectFit = 'contain';
            const src = (values && values.src) || (node.attrs && node.attrs.src) || '';
            if (src) {
                el.src = src;
                el.addEventListener('error', () => { el.classList.add('pr-img-broken'); });
            } else {
                // No src at all: keep the box (its width/height still apply)
                // and, while editing, draw it as a placeholder.
                el.removeAttribute('src');
                if (o.editing) el.classList.add('pe-img-empty');
            }
            el.setAttribute('alt', (node.attrs && node.attrs.alt) || '');
            return el;
        }

        if (node.children && node.children.length) {
            node.children.forEach(child => {
                if (o.skip && o.skip(child)) return;
                el.appendChild(renderNode(child, o));
            });
        } else if (fill) {
            el.appendChild(renderFillControl(fill));
        } else if (node.passageHtml) {
            el.classList.add('m-scripture');
            el.innerHTML = node.passageHtml;
        } else {
            const text = (values && typeof values.text === 'string') ? values.text : (node.text || '');
            el.textContent = text;
            // ⚠ ONLY A TEXT ELEMENT IS "EMPTY". An empty <p> is a run somebody
            // has not typed into yet, and the placeholder is how they find it.
            // An empty BOX is not a mistake — a hairline rule, a spacer, the
            // border frame on a page are all boxes that hold nothing on
            // purpose, and marking those drew a dotted outline round half a
            // page and stretched every 1px rule to a line's height (the class
            // carries min-height: 1em). They are visible by their own border
            // or background, and the layer tree still selects them.
            if (o.editing && !text && Core.kindOf(node) === 'text') el.classList.add('pe-text-empty');
        }
        return el;
    }

    // Text flows in the element's own type and measure: a textarea the width
    // of the box, not a one-line field. A number stays a field. A date stays
    // a date.
    // Output and print never pass fillFor, so those sheets stay static.
    // Output and print never pass fillFor, so those sheets stay static.
    function isFlowingFill(fill) {
        return fill.kind !== 'date' && fill.kind !== 'number';
    }

    // A textarea's default box is one line and does not grow. After it is in
    // the page, grow it to the wrapped text so the blank takes the same
    // height the printed words will.
    function fitFlowingFill(el) {
        if (!el || el.tagName !== 'TEXTAREA') return;
        el.style.height = '0px';
        el.style.height = el.scrollHeight + 'px';
    }

    function renderFlowingFill(fill) {
        const el = document.createElement('textarea');
        el.className = 'pv-fill pv-fill--text';
        el.rows = 1;
        el.wrap = 'soft';
        el.spellcheck = true;
        el.setAttribute('aria-multiline', 'true');
        const written = fill.value == null ? '' : String(fill.value);
        el.value = written;
        if (!written) el.placeholder = fill.label || '';
        el.addEventListener('input', function () { fitFlowingFill(el); });
        return el;
    }

    function renderFillControl(fill) {
        if (isFlowingFill(fill)) {
            const el = renderFlowingFill(fill);
            el.setAttribute('data-fill-id', fill.id);
            el.setAttribute('aria-label', fill.label || 'Fill in');
            return el;
        }
        const input = document.createElement('input');
        input.className = 'pv-fill';
        input.name = fill.id;
        input.setAttribute('data-fill-id', fill.id);
        input.setAttribute('aria-label', fill.label || 'Fill in');
        input.autocomplete = 'off';
        if (fill.kind === 'date') {
            input.type = 'date';
        } else {
            input.type = 'text';
            input.setAttribute('inputmode', 'decimal');
        }
        input.value = fill.value == null ? '' : String(fill.value);
        if (!input.value) input.placeholder = fill.label || '';
        return input;
    }

    function renderFillImage(node, fill) {
        const lab = document.createElement('label');
        lab.className = 'pv-fill-img';
        applyStyle(lab, node.style);
        if (!lab.style.position) lab.style.position = 'relative';
        const img = document.createElement('img');
        const src = fill.value || (node.attrs && node.attrs.src) || '';
        if (src) img.src = src;
        img.alt = '';
        img.style.objectFit = (node.style && node.style['object-fit']) || 'contain';
        img.style.width = '100%';
        img.style.height = '100%';
        img.style.maxWidth = '100%';
        img.style.maxHeight = '100%';
        img.style.minWidth = '0';
        img.style.minHeight = '0';
        const file = document.createElement('input');
        file.type = 'file';
        file.accept = 'image/*';
        file.name = fill.id;
        file.className = 'pv-fill-file';
        file.setAttribute('data-fill-id', fill.id);
        file.setAttribute('aria-label', fill.label || 'Upload image');
        file.autocomplete = 'off';
        const cap = document.createElement('span');
        cap.className = 'pv-fill-img__btn';
        cap.textContent = src ? 'Replace image' : 'Upload image';
        lab.appendChild(img);
        lab.appendChild(cap);
        lab.appendChild(file);
        return lab;
    }

    // A page: sized, padded by its margins, carrying its stylesheet scoped
    // to itself, holding its elements. `scopeId` is what the page's own CSS
    // is scoped under so one page's rules cannot restyle another's.
    function renderPage(page, template, opts) {
        const o = opts || {};
        ensureBaseStyles();
        const wrap = document.createElement('div');
        wrap.className = 'pr-page' + (o.className ? ' ' + o.className : '');
        // `~` and other CSS combinators in an id (folio copies used to be
        // `page~folio…`) turn `.pr-page~folio` into a sibling selector, so the
        // page's own stylesheet never matches and the copy draws unstyled.
        const scope = 'pr-' + cssScopeToken(o.scopeId || page.id);
        wrap.classList.add(scope);
        applyStyle(wrap, Core.pageContainerStyle(template, page));
        if (o.editing) wrap.setAttribute('data-page', page.id);

        if (page.css && page.css.trim()) {
            const style = document.createElement('style');
            style.textContent = scopeCss(page.css, '.' + scope);
            wrap.appendChild(style);
        }
        const numbers = [];
        const content = pageNumbersAside(page.nodes, numbers);
        const placeOpts = {
            pageIndex: o.pageIndex == null ? 0 : o.pageIndex,
            widthPx: (template && template.widthPx) || o.widthPx,
            heightPx: (template && template.heightPx) || o.heightPx,
        };
        content.forEach(node => {
            wrap.appendChild(renderNode(node, o));
        });
        if (numbers.length) {
            const layer = document.createElement('div');
            layer.className = 'pr-pagenums';
            layer.setAttribute('data-pagenums', '');
            numbers.forEach(node => {
                const placed = Core.placePageNumber(node, placeOpts);
                const el = renderNode(placed, o);
                el.classList.add('pr-pagenum');
                layer.appendChild(el);
            });
            wrap.appendChild(layer);
        }
        return wrap;
    }

    // Page numbers draw in their own layer, above the rest of the page, and
    // are taken out of whatever box they were stored in.
    function pageNumbersAside(nodes, sink) {
        const out = [];
        (nodes || []).forEach(node => {
            if (!node) return;
            if (Core.isPageNumber(node)) { sink.push(node); return; }
            if (node.children && node.children.length) {
                const kids = pageNumbersAside(node.children, sink);
                if (kids.length !== node.children.length) {
                    out.push(Object.assign({}, node, { children: kids }));
                    return;
                }
            }
            out.push(node);
        });
        return out;
    }

    // Prefixes every selector in a page's stylesheet with the page's own
    // class. Good enough for the CSS a page carries — rules and @media
    // blocks — without pulling in a CSS parser.
    function cssScopeToken(id) {
        const cleaned = String(id || 'page').replace(/[^A-Za-z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
        if (!cleaned) return 'page';
        return /^[A-Za-z_]/.test(cleaned) ? cleaned : ('p-' + cleaned);
    }

    function scopeCss(css, prefix) {
        return String(css).replace(/(^|\})\s*([^{}@]+)\{/g, (m, pre, selectors) => {
            const scoped = selectors.split(',').map(s => {
                const t = s.trim();
                if (!t) return t;
                return prefix + ' ' + t;
            }).join(', ');
            return pre + ' ' + scoped + ' {';
        });
    }

    // Folio print: the same sheets the service guide editor sends to the
    // printer. Two pages per landscape sheet, saddle-stitch order from
    // PrintableExportCore.folioSpreads. Replaces whatever the layer held.
    function mountFolioPrint(layer, template, entries) {
        if (!layer || !template) return [];
        // Read at print time. A const capture of the global would bind while
        // this file parses, and the view page loads this file first.
        if (typeof PrintableExportCore === 'undefined' || typeof PrintableExportCore.folioSpreads !== 'function') return [];
        const spreads = PrintableExportCore.folioSpreads(entries || []);
        layer.innerHTML = '';
        const style = document.createElement('style');
        style.textContent = PrintableExportCore.folioPrintCss(template, Core.printScale(template));
        layer.appendChild(style);
        let blankN = 0;
        const leaf = (entry, pageIndex) => {
            const slot = document.createElement('div');
            slot.className = 'pr-folio-leaf';
            let page;
            if (entry && entry.page) {
                page = Object.assign({}, entry.page, {
                    nodes: entry.nodes || entry.page.nodes || [],
                });
            } else {
                blankN += 1;
                page = {
                    id: 'folio-blank-' + blankN,
                    nodes: [],
                    margins: { top: 0, right: 0, bottom: 0, left: 0 },
                    style: { 'background-color': '#ffffff' },
                };
            }
            const idx = pageIndex == null ? (entry && entry.pageIndex) : pageIndex;
            slot.appendChild(renderPage(page, template, { scopeId: page.id, pageIndex: idx == null ? 0 : idx }));
            return slot;
        };
        spreads.forEach(spread => {
            const sheet = document.createElement('div');
            sheet.className = 'pr-folio-sheet';
            sheet.setAttribute('x-ignore', '');
            sheet.appendChild(leaf(spread.left, spread.leftIdx));
            sheet.appendChild(leaf(spread.right, spread.rightIdx));
            layer.appendChild(sheet);
        });
        return spreads;
    }

    // Folio pad board: every page as a thumbnail, gaps between them to
    // stamp the brush into. Pure DOM paint — Alpine owns the side counter.
    function mountFolioPadBoard(host, opts) {
        if (!host || !opts || !opts.template) return;
        const Ex = typeof PrintableExportCore !== 'undefined' ? PrintableExportCore : null;
        const t = opts.template;
        const entries = Array.isArray(opts.entries) ? opts.entries : [];
        const brushIndex = opts.brushIndex;
        const needCount = Number(opts.needCount) || 0;
        const thumbW = opts.thumbWidth || 132;
        const scale = thumbW / Math.max(1, t.widthPx || 1);
        host.innerHTML = '';
        host.classList.add('folio-pad__board');

        function appendGap(afterIndex) {
            const legal = Ex ? Ex.canInsertAfterEntry(entries, afterIndex) : (afterIndex < 0 || afterIndex >= entries.length - 1);
            const open = legal && brushIndex != null && brushIndex >= 0 && needCount > 0;
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'folio-pad__gap' + (open ? ' is-open' : '') + (!legal ? ' is-blocked' : '');
            btn.disabled = !open;
            btn.setAttribute('aria-label', afterIndex < 0
                ? 'Insert brush at the start'
                : 'Insert brush after page ' + (afterIndex + 1));
            if (!legal) btn.title = 'Inside an overflow run — insert before or after the run';
            else if (brushIndex == null || brushIndex < 0) btn.title = 'Pick a page first';
            else if (needCount <= 0) btn.title = 'Fold is full';
            else btn.title = 'Place a copy of the brush here';
            const tick = document.createElement('span');
            tick.className = 'folio-pad__gap-tick';
            tick.setAttribute('aria-hidden', 'true');
            btn.appendChild(tick);
            btn.addEventListener('click', () => {
                if (typeof opts.onInsert === 'function') opts.onInsert(afterIndex);
            });
            host.appendChild(btn);
        }

        appendGap(-1);
        entries.forEach((entry, i) => {
            const card = document.createElement('div');
            const isBrush = brushIndex === i;
            const isPad = !!(entry && entry.folioPad);
            const isBlank = !!(entry && entry.blank);
            card.className = 'folio-pad__card'
                + (isBrush ? ' is-brush' : '')
                + (isPad ? ' is-pad' : '')
                + (isBlank ? ' is-blank' : '');

            const meta = document.createElement('div');
            meta.className = 'folio-pad__meta';
            const num = document.createElement('span');
            num.className = 'folio-pad__num';
            num.textContent = String(i + 1);
            meta.appendChild(num);
            const name = document.createElement('span');
            name.className = 'folio-pad__name';
            const label = Ex ? Ex.entryLabel(entry, i) : ('Page ' + (i + 1));
            name.textContent = (entry && entry.page && entry.page.name)
                || (isBlank ? 'Blank' : (isPad ? 'Print only' : 'Page'));
            name.title = label;
            meta.appendChild(name);
            const canRemove = entries.length > 1;
            if (canRemove) {
                const rm = document.createElement('button');
                rm.type = 'button';
                rm.className = 'folio-pad__remove';
                rm.setAttribute('aria-label', 'Remove page ' + (i + 1) + ' from this print');
                rm.title = 'Remove from this print';
                rm.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">close</span>';
                rm.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (typeof opts.onRemove === 'function') opts.onRemove(i);
                });
                meta.appendChild(rm);
            }
            card.appendChild(meta);

            const pick = document.createElement('button');
            pick.type = 'button';
            pick.className = 'folio-pad__pick';
            pick.disabled = isBlank;
            pick.setAttribute('aria-pressed', isBrush ? 'true' : 'false');
            pick.setAttribute('aria-label', isBlank
                ? ('Page ' + (i + 1) + ', blank')
                : (isBrush ? ('Brush is page ' + (i + 1)) : ('Set brush to page ' + (i + 1))));

            const thumb = document.createElement('div');
            thumb.className = 'folio-pad__thumb';
            const inner = document.createElement('div');
            inner.className = 'folio-pad__thumb-inner';
            inner.style.width = (t.widthPx || 0) + 'px';
            inner.style.height = (t.heightPx || 0) + 'px';
            inner.style.transform = 'scale(' + scale + ')';
            try {
                const page = entry && entry.page
                    ? Object.assign({}, entry.page, { nodes: entry.nodes || entry.page.nodes || [] })
                    : { id: 'folio-pad-' + i, nodes: [], margins: { top: 0, right: 0, bottom: 0, left: 0 }, style: { 'background-color': '#ffffff' } };
                const mini = renderPage(page, t, { editing: false, scopeId: page.id || ('pad-' + i), pageIndex: entry && entry.pageIndex != null ? entry.pageIndex : i });
                mini.style.width = (t.widthPx || 0) + 'px';
                mini.style.height = (t.heightPx || 0) + 'px';
                inner.appendChild(mini);
            } catch (err) { /* thumb is best-effort */ }
            thumb.appendChild(inner);
            thumb.style.height = Math.round((t.heightPx || 0) * scale) + 'px';
            pick.appendChild(thumb);
            if (!isBlank) {
                pick.addEventListener('click', () => {
                    if (typeof opts.onBrush === 'function') opts.onBrush(i);
                });
            }
            card.appendChild(pick);
            host.appendChild(card);
            appendGap(i);
        });
    }

    const PrintableDom = {
        renderNode, renderPage, renderFillControl, renderFillImage, fitFlowingFill,
        scopeCss, applyStyle, ensureBaseStyles, mountFolioPrint, mountFolioPadBoard, BASE_CSS,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = PrintableDom;
    }
    if (global) {
        global.PrintableDom = PrintableDom;
    }
})(typeof window !== 'undefined' ? window : globalThis);
