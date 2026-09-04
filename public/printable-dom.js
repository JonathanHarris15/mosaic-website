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
        '.pr-page img { display: block; }',
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

        if (node.tag === 'img') {
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
        } else {
            const text = (values && typeof values.text === 'string') ? values.text : (node.text || '');
            el.textContent = text;
            if (o.editing && !text) el.classList.add('pe-text-empty');
        }
        return el;
    }

    // A page: sized, padded by its margins, carrying its stylesheet scoped
    // to itself, holding its elements. `scopeId` is what the page's own CSS
    // is scoped under so one page's rules cannot restyle another's.
    function renderPage(page, template, opts) {
        const o = opts || {};
        ensureBaseStyles();
        const wrap = document.createElement('div');
        wrap.className = 'pr-page' + (o.className ? ' ' + o.className : '');
        const scope = 'pr-' + (o.scopeId || page.id);
        wrap.classList.add(scope);
        applyStyle(wrap, Core.pageContainerStyle(template, page));
        if (o.editing) wrap.setAttribute('data-page', page.id);

        if (page.css && page.css.trim()) {
            const style = document.createElement('style');
            style.textContent = scopeCss(page.css, '.' + scope);
            wrap.appendChild(style);
        }
        (page.nodes || []).forEach(node => {
            wrap.appendChild(renderNode(node, o));
        });
        return wrap;
    }

    // Prefixes every selector in a page's stylesheet with the page's own
    // class. Good enough for the CSS a page carries — rules and @media
    // blocks — without pulling in a CSS parser.
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

    const PrintableDom = { renderNode, renderPage, scopeCss, applyStyle, ensureBaseStyles, BASE_CSS };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = PrintableDom;
    }
    if (global) {
        global.PrintableDom = PrintableDom;
    }
})(typeof window !== 'undefined' ? window : globalThis);
