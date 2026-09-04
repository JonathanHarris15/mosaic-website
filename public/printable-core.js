// Printable Core — what a Printable IS, before any page draws it.
//
// A **Printable** is a project the church lays out and prints: a membership
// directory, a service guide, an event handout. It is a name, the folder it is
// filed in, the **page template** it was created on (paper size, orientation
// and pixel density — fixed for the life of the project), and its **pages**.
//
// A **page** is a window of HTML and CSS at a physical size: margins, a
// stylesheet, and an ordered tree of **elements**. An element is a real HTML
// element — a **box** (div), a run of **text** (p, span, h1…) or an **image**
// (img) — carrying inline CSS in `style`, and optionally a **binding** (which
// live field feeds its text or its picture) or a **repeat** (it stands for one
// row of a list and is drawn once per row).
//
// ⚠ THE TREE IS THE RECORD; THE HTML IS A PROJECTION (ADR-0056). A page is
// stored as this tree and drawn from it. The code view shows the tree AS
// HTML, and an edit there is parsed back INTO the tree — so `pageToHtml` and
// `htmlToNodes` must round-trip, and the tests pin that they do. Bindings and
// repeats ride along as `data-` attributes so they survive the trip.
//
// Self-contained like every other *-core module: no Firestore, no DOM, new
// objects out. Loaded as a classic <script> (window.PrintableCore) and
// exported for Node.

(function (global) {
    'use strict';

    // Every record says which shape it was written in, so a later model can
    // read an older one rather than guess. Bumped only when a saved record
    // would otherwise be misread; `migrate` walks the older shapes forward.
    const RECORD_VERSION = 2;

    // ── The name ─────────────────────────────────────────────────────────────

    const MAX_NAME_LENGTH = 90;
    const DEFAULT_NAME = 'Untitled printable';

    function normaliseName(name) {
        const trimmed = String(name == null ? '' : name).trim();
        if (!trimmed) return DEFAULT_NAME;
        return trimmed.slice(0, MAX_NAME_LENGTH);
    }

    // What a duplicate is called. "Directory" → "Directory copy"; a second
    // copy beside those → "Directory copy 2", and so on, so two copies made in
    // a row never share a name. `taken` is the names already in the library.
    function copyName(name, taken) {
        const base = normaliseName(name).replace(/ copy( \d+)?$/, '');
        const used = {};
        (taken || []).forEach(n => { used[String(n)] = true; });
        let candidate = base + ' copy';
        let n = 2;
        while (used[candidate]) {
            candidate = base + ' copy ' + n;
            n += 1;
        }
        return normaliseName(candidate);
    }

    // ── Paper ────────────────────────────────────────────────────────────────
    //
    // Sizes are in inches because that is how the printers the church owns
    // describe their trays. A4/A5 are given to the hundredth, which at 300 dpi
    // is within a pixel of the metric size.
    const PAPERS = [
        { key: 'letter',      label: 'Letter',      widthIn: 8.5,  heightIn: 11 },
        { key: 'legal',       label: 'Legal',       widthIn: 8.5,  heightIn: 14 },
        { key: 'tabloid',     label: 'Tabloid',     widthIn: 11,   heightIn: 17 },
        { key: 'half_letter', label: 'Half Letter', widthIn: 5.5,  heightIn: 8.5 },
        { key: 'a4',          label: 'A4',          widthIn: 8.27, heightIn: 11.69 },
        { key: 'a5',          label: 'A5',          widthIn: 5.83, heightIn: 8.27 },
        { key: 'photo_5x7',   label: '5 × 7',       widthIn: 5,    heightIn: 7 },
        { key: 'photo_4x6',   label: '4 × 6',       widthIn: 4,    heightIn: 6 },
    ];

    // How many pixels make an inch inside the editor. 96 is what a browser
    // calls an inch; 150 is comfortable for print; 300 is press quality and
    // makes for big numbers in every box.
    const DENSITIES = [96, 150, 300];
    const DEFAULT_DPI = 150;
    const DEFAULT_MARGIN_IN = 0.5;

    function paperByKey(key) {
        return PAPERS.find(p => p.key === key) || null;
    }

    // The record a project carries for the life of the project. Built once,
    // from the picker; `widthPx`/`heightPx` are derived and stored so every
    // reader agrees on them without recomputing (and so a custom size that
    // was typed in inches survives with its pixels beside it).
    function buildTemplate(spec) {
        const s = spec || {};
        const dpi = DENSITIES.includes(Number(s.dpi)) ? Number(s.dpi) : DEFAULT_DPI;
        const orientation = s.orientation === 'landscape' ? 'landscape' : 'portrait';
        const paper = paperByKey(s.paper);
        let wIn = paper ? paper.widthIn : Number(s.widthIn);
        let hIn = paper ? paper.heightIn : Number(s.heightIn);
        if (!(wIn > 0) || !(hIn > 0)) { wIn = 8.5; hIn = 11; }
        // Papers are listed portrait; landscape swaps them. A custom size is
        // taken as given and its orientation is a description, not a swap.
        if (paper && orientation === 'landscape') { const t = wIn; wIn = hIn; hIn = t; }
        const marginIn = (s.marginIn >= 0) ? Number(s.marginIn) : DEFAULT_MARGIN_IN;
        const name = paper ? paper.label : (s.label || 'Custom');
        return {
            paper: paper ? paper.key : 'custom',
            orientation: orientation,
            dpi: dpi,
            widthIn: round2(wIn),
            heightIn: round2(hIn),
            widthPx: Math.round(wIn * dpi),
            heightPx: Math.round(hIn * dpi),
            marginPx: Math.round(marginIn * dpi),
            label: name + ' · ' + orientation + ' · ' + dpi + ' dpi',
        };
    }

    function round2(n) { return Math.round(n * 100) / 100; }

    // ── Ids ──────────────────────────────────────────────────────────────────
    //
    // Short, unique within a project, and stable for the life of an element —
    // the code view keeps them as `data-pid` so an element edited as text is
    // still the same element with the same bindings afterwards.
    let counter = 0;
    function newId(prefix) {
        counter = (counter + 1) % 1296;
        const rnd = Math.floor(Math.random() * 1679616).toString(36);
        return (prefix || 'n') + rnd + counter.toString(36);
    }

    // ── Elements ─────────────────────────────────────────────────────────────

    const TEXT_TAGS = ['p', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'em', 'small', 'label', 'li', 'td', 'th', 'a'];
    const VOID_TAGS = ['img', 'br', 'hr', 'input'];

    // What kind of thing an element is, read off its tag and its shape. A
    // box holds children; text holds a run of text; an image holds a src.
    function kindOf(node) {
        if (!node) return 'box';
        if (node.tag === 'img') return 'image';
        if (node.children && node.children.length) return 'box';
        if (TEXT_TAGS.includes(node.tag)) return 'text';
        if (typeof node.text === 'string' && node.text.length) return 'text';
        return 'box';
    }

    function buildNode(spec) {
        const s = spec || {};
        const tag = String(s.tag || 'div').toLowerCase();
        const node = {
            id: s.id || newId(),
            tag: tag,
            name: s.name ? String(s.name).slice(0, 40) : '',
            attrs: Object.assign({}, s.attrs || {}),
            style: Object.assign({}, s.style || {}),
            children: [],
        };
        if (tag === 'img') {
            if (!node.attrs.src) node.attrs.src = '';
        } else if (Array.isArray(s.children) && s.children.length) {
            node.children = s.children.map(buildNode);
        } else if (typeof s.text === 'string') {
            node.text = s.text;
        } else if (TEXT_TAGS.includes(tag)) {
            node.text = '';
        }
        if (s.bind && Object.keys(s.bind).length) node.bind = clone(s.bind);
        if (s.repeat) node.repeat = buildRepeat(s.repeat);
        return node;
    }

    // What an iterated element remembers: the list it stands for and how the
    // copies are laid out. `continueWith` is the page copied for an overflow
    // page — null means the page the list started on.
    function buildRepeat(spec) {
        const s = spec || {};
        const layout = s.layout || {};
        return {
            source: s.source || '',
            params: Object.assign({}, s.params || {}),
            layout: {
                direction: layout.direction === 'row' ? 'row' : 'column',
                perLine: Math.max(1, Math.min(12, Number(layout.perLine) || 1)),
                gap: Math.max(0, Number(layout.gap) || 0),
                maxPerPage: Math.max(0, Number(layout.maxPerPage) || 0),
            },
            overflow: s.overflow === 'new-page' ? 'new-page' : 'clip',
            continueWith: s.continueWith || null,
        };
    }

    // The three things the toolbar adds. Sized so a fresh one is visible on
    // the page rather than a zero-height nothing.
    function newBox(dpi) {
        const u = unit(dpi);
        return buildNode({ tag: 'div', name: 'Box', style: {
            'display': 'flex', 'flex-direction': 'column', 'gap': px(u * 8),
            'padding': px(u * 12), 'min-height': px(u * 60),
        } });
    }

    function newText(dpi, text) {
        const u = unit(dpi);
        return buildNode({ tag: 'p', name: 'Text', text: text == null ? 'Text' : text, style: {
            'font-family': 'EB Garamond, Georgia, serif', 'font-size': px(u * 16),
            'line-height': '1.3', 'margin': '0',
        } });
    }

    function newImage(dpi) {
        const u = unit(dpi);
        return buildNode({ tag: 'img', name: 'Image', attrs: { src: '', alt: '' }, style: {
            'width': px(u * 120), 'height': px(u * 120), 'object-fit': 'cover',
        } });
    }

    function unit(dpi) { return (Number(dpi) || 96) / 96; }
    function px(n) { return Math.round(n) + 'px'; }

    // ── Pages ────────────────────────────────────────────────────────────────

    function buildPage(template, spec) {
        const s = spec || {};
        const t = template || buildTemplate({});
        const m = s.margins || {};
        const d = t.marginPx != null ? t.marginPx : Math.round(DEFAULT_MARGIN_IN * t.dpi);
        return {
            id: s.id || newId('pg'),
            name: s.name ? String(s.name).slice(0, 40) : '',
            margins: {
                top: num(m.top, d), right: num(m.right, d), bottom: num(m.bottom, d), left: num(m.left, d),
            },
            style: Object.assign({ 'background-color': '#ffffff' }, s.style || {}),
            css: typeof s.css === 'string' ? s.css : '',
            nodes: (s.nodes || []).map(buildNode),
        };
    }

    function num(v, d) { const n = Number(v); return (v != null && !isNaN(n) && n >= 0) ? n : d; }

    // A page sized in physical units for a print stylesheet. CSS inches are
    // 96 per inch, so a page laid out at 150 dpi is scaled down by 96/150 to
    // land at true size on paper.
    function printScale(template) { return 96 / ((template && template.dpi) || 96); }

    // ── The record ───────────────────────────────────────────────────────────

    function buildPrintable(spec) {
        const s = spec || {};
        const template = s.template ? buildTemplate(s.template) : null;
        return {
            version: RECORD_VERSION,
            name: normaliseName(s.name),
            folderId: s.folderId || null,
            template: template,
            pages: Array.isArray(s.pages) ? s.pages.map(p => buildPage(template, p)) : [],
        };
    }

    // A copy for the library's Duplicate: the same paper, the same pages, the
    // same bindings, a new name, filed beside the original. Nothing about who
    // made it or when comes along — the store stamps those afresh.
    function duplicatePrintable(printable, taken) {
        const p = printable || {};
        return buildPrintable({
            name: copyName(p.name, taken),
            folderId: p.folderId || null,
            template: p.template || null,
            pages: p.pages || [],
        });
    }

    // Reads a record written by an older shape of this module. Version 1 was
    // the library-only record (MS-392) with no page shape; its pages, if any,
    // pass through buildPage unchanged.
    function migrate(record) {
        const r = record || {};
        const v = Number(r.version) || 1;
        if (v >= RECORD_VERSION) return buildPrintable(r);
        return buildPrintable(r);
    }

    // ── Custom page templates ────────────────────────────────────────────────
    //
    // A page somebody built, kept to start the next project from: the paper
    // it was on, its margins, its stylesheet and its elements. Stored in
    // `printable_templates` and offered in the picker beside the papers.
    function buildCustomTemplate(spec) {
        const s = spec || {};
        const template = buildTemplate(s.template || {});
        const page = buildPage(template, s.page || {});
        return {
            name: normaliseName(s.name),
            template: template,
            page: { margins: page.margins, style: page.style, css: page.css, nodes: page.nodes },
        };
    }

    // ── Walking a page's tree ────────────────────────────────────────────────
    //
    // Every operation returns a NEW page; nothing here mutates what it is
    // given. That is what makes undo a stack of snapshots rather than a
    // journal of inverse operations.

    function clone(value) { return JSON.parse(JSON.stringify(value)); }

    function findNode(page, id) {
        let found = null;
        walk(page.nodes, (node) => { if (node.id === id) { found = node; return false; } });
        return found;
    }

    // Parent and index of an element, or null at the top level.
    function locate(page, id) {
        let result = null;
        const visit = (list, parent) => {
            for (let i = 0; i < list.length; i++) {
                if (list[i].id === id) { result = { parent: parent, list: list, index: i }; return true; }
                if (list[i].children && visit(list[i].children, list[i])) return true;
            }
            return false;
        };
        visit(page.nodes, null);
        return result;
    }

    function walk(nodes, fn, parent) {
        for (const node of nodes || []) {
            if (fn(node, parent) === false) return false;
            if (node.children && walk(node.children, fn, node) === false) return false;
        }
        return true;
    }

    // Top-down chain of ids from the page to this element, for the tree and
    // for "which iterated element am I inside".
    function ancestorsOf(page, id) {
        const chain = [];
        const visit = (list, path) => {
            for (const node of list) {
                if (node.id === id) { chain.push(...path); return true; }
                if (node.children && visit(node.children, path.concat(node))) return true;
            }
            return false;
        };
        visit(page.nodes, []);
        return chain;
    }

    function isDescendantOf(page, candidateId, ancestorId) {
        return ancestorsOf(page, candidateId).some(n => n.id === ancestorId);
    }

    function withNodes(page, nodes) {
        return Object.assign({}, page, { nodes: nodes });
    }

    // Puts an element inside a parent (or at the top level when parentId is
    // null) at `index`, or at the end. A text or image element cannot take
    // children, so it is refused as a parent and the element lands beside it.
    function insertNode(page, parentId, node, index) {
        const next = clone(page);
        const fresh = buildNode(node);
        let list = next.nodes;
        if (parentId) {
            const at = locate(next, parentId);
            if (!at) return page;
            const parent = at.list[at.index];
            if (kindOf(parent) === 'box' && parent.tag !== 'img') {
                if (!parent.children) parent.children = [];
                delete parent.text;
                list = parent.children;
            } else {
                list = at.list;
                index = at.index + 1;
            }
        }
        const i = (index == null || index < 0 || index > list.length) ? list.length : index;
        list.splice(i, 0, fresh);
        return next;
    }

    function removeNode(page, id) {
        const next = clone(page);
        const at = locate(next, id);
        if (!at) return page;
        at.list.splice(at.index, 1);
        // A box that has just lost its last child is still a box; it keeps
        // its (now empty) children list rather than turning into text.
        return next;
    }

    function updateNode(page, id, patch) {
        const next = clone(page);
        const node = findNode(next, id);
        if (!node) return page;
        const p = patch || {};
        if (p.style) node.style = Object.assign({}, node.style, p.style);
        if (p.attrs) node.attrs = Object.assign({}, node.attrs, p.attrs);
        if (typeof p.text === 'string') node.text = p.text;
        if (typeof p.name === 'string') node.name = p.name.slice(0, 40);
        if (typeof p.tag === 'string') node.tag = p.tag.toLowerCase();
        if (p.bind !== undefined) {
            if (p.bind === null) delete node.bind; else node.bind = clone(p.bind);
        }
        if (p.repeat !== undefined) {
            if (p.repeat === null) delete node.repeat; else node.repeat = buildRepeat(p.repeat);
        }
        // A style set to '' is a style removed — the code view would otherwise
        // print `color: ;`.
        Object.keys(node.style).forEach(k => { if (node.style[k] === '' || node.style[k] == null) delete node.style[k]; });
        return next;
    }

    // Moves an element under a new parent (null for the page) at an index.
    // Refused, with a reason, when it would put an element inside itself.
    function moveNode(page, id, newParentId, index) {
        if (id === newParentId) return { ok: false, why: 'An element cannot go inside itself.', page: page };
        if (newParentId && isDescendantOf(page, newParentId, id)) {
            return { ok: false, why: 'An element cannot go inside something it already contains.', page: page };
        }
        const at = locate(page, id);
        if (!at) return { ok: false, why: 'That element no longer exists.', page: page };
        const node = clone(at.list[at.index]);
        // Removing first shifts the index when the move is within one list.
        let target = index;
        if ((at.parent ? at.parent.id : null) === (newParentId || null) && index != null && index > at.index) target = index - 1;
        const without = removeNode(page, id);
        const placed = insertNode(without, newParentId, node, target);
        return { ok: true, why: '', page: placed };
    }

    // A deep copy with fresh ids, placed right after the original.
    function duplicateNode(page, id) {
        const at = locate(page, id);
        if (!at) return page;
        const copy = reid(clone(at.list[at.index]));
        return insertNode(page, at.parent ? at.parent.id : null, copy, at.index + 1);
    }

    function reid(node) {
        node.id = newId();
        (node.children || []).forEach(reid);
        return node;
    }

    // Puts a box around an element, so a lone text can be given a background
    // or grouped with a neighbour later.
    function wrapNode(page, id, dpi) {
        const at = locate(page, id);
        if (!at) return page;
        const inner = clone(at.list[at.index]);
        const box = newBox(dpi);
        box.children = [inner];
        const without = removeNode(page, id);
        return insertNode(without, at.parent ? at.parent.id : null, box, at.index);
    }

    // ── Styles ───────────────────────────────────────────────────────────────

    function styleToCss(style) {
        return Object.keys(style || {})
            .filter(k => style[k] !== '' && style[k] != null)
            .map(k => k + ': ' + String(style[k]).trim())
            .join('; ');
    }

    function cssToStyle(text) {
        const out = {};
        String(text || '').split(';').forEach(pair => {
            const i = pair.indexOf(':');
            if (i < 0) return;
            const k = pair.slice(0, i).trim().toLowerCase();
            const v = pair.slice(i + 1).trim();
            if (k && v) out[k] = v;
        });
        return out;
    }

    // ── HTML out ─────────────────────────────────────────────────────────────

    function escapeHtml(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function escapeAttr(s) {
        return escapeHtml(s).replace(/"/g, '&quot;');
    }

    function nodeToHtml(node, indent) {
        const pad = '  '.repeat(indent || 0);
        const attrs = [];
        attrs.push('data-pid="' + escapeAttr(node.id) + '"');
        if (node.name) attrs.push('data-name="' + escapeAttr(node.name) + '"');
        Object.keys(node.attrs || {}).forEach(k => {
            if (k === 'style' || /^data-(pid|name|bind|repeat)$/.test(k)) return;
            if (node.attrs[k] == null) return;
            attrs.push(k + '="' + escapeAttr(node.attrs[k]) + '"');
        });
        const css = styleToCss(node.style);
        if (css) attrs.push('style="' + escapeAttr(css) + '"');
        if (node.bind) attrs.push('data-bind="' + escapeAttr(JSON.stringify(node.bind)) + '"');
        if (node.repeat) attrs.push('data-repeat="' + escapeAttr(JSON.stringify(node.repeat)) + '"');
        const open = '<' + node.tag + ' ' + attrs.join(' ');
        if (VOID_TAGS.includes(node.tag)) return pad + open + '>';
        if (node.children && node.children.length) {
            return pad + open + '>\n'
                + node.children.map(c => nodeToHtml(c, (indent || 0) + 1)).join('\n')
                + '\n' + pad + '</' + node.tag + '>';
        }
        return pad + open + '>' + escapeHtml(node.text || '') + '</' + node.tag + '>';
    }

    function pageToHtml(page) {
        return (page.nodes || []).map(n => nodeToHtml(n, 0)).join('\n');
    }

    // ── HTML in ──────────────────────────────────────────────────────────────
    //
    // A small parser for the subset of HTML a page is: elements, attributes,
    // text, comments. It is strict where a browser is forgiving — a tag left
    // open or closed in the wrong order is refused with its line, because a
    // page silently rebuilt from a guess is worse than one that says no.

    function decodeEntities(s) {
        return String(s)
            .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'").replace(/&apos;/g, "'").replace(/&nbsp;/g, ' ')
            .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
            .replace(/&amp;/g, '&');
    }

    function lineOf(src, pos) {
        return src.slice(0, pos).split('\n').length;
    }

    function parseHtml(src) {
        const s = String(src || '');
        const root = { children: [] };
        const stack = [root];
        let i = 0;
        const problems = [];
        const top = () => stack[stack.length - 1];

        while (i < s.length) {
            if (s.startsWith('<!--', i)) {
                const end = s.indexOf('-->', i + 4);
                if (end < 0) { problems.push('A comment starting on line ' + lineOf(s, i) + ' never closes.'); break; }
                i = end + 3;
                continue;
            }
            if (s[i] === '<' && s[i + 1] === '/') {
                const end = s.indexOf('>', i);
                if (end < 0) { problems.push('A closing tag on line ' + lineOf(s, i) + ' never ends.'); break; }
                const tag = s.slice(i + 2, end).trim().toLowerCase();
                const open = top();
                if (open === root || open.tag !== tag) {
                    const expected = open === root ? 'nothing' : '</' + open.tag + '>';
                    problems.push('Line ' + lineOf(s, i) + ': found </' + tag + '> but expected ' + expected + '.');
                    break;
                }
                stack.pop();
                i = end + 1;
                continue;
            }
            if (s[i] === '<' && /[a-zA-Z]/.test(s[i + 1] || '')) {
                const parsed = parseTag(s, i);
                if (!parsed) { problems.push('A tag on line ' + lineOf(s, i) + ' never ends.'); break; }
                const el = { tag: parsed.tag, attrs: parsed.attrs, children: [], line: lineOf(s, i) };
                top().children.push(el);
                i = parsed.end;
                if (!parsed.selfClosing && !VOID_TAGS.includes(parsed.tag)) stack.push(el);
                continue;
            }
            // Text up to the next tag.
            let next = s.indexOf('<', i);
            if (next < 0) next = s.length;
            const raw = s.slice(i, next);
            if (raw.trim()) top().children.push({ text: decodeEntities(raw) });
            i = next;
        }
        if (!problems.length && stack.length > 1) {
            const open = top();
            problems.push('<' + open.tag + '> on line ' + open.line + ' is never closed.');
        }
        return { ok: problems.length === 0, problems: problems, children: root.children };
    }

    function parseTag(s, start) {
        let i = start + 1;
        const tagMatch = /^[a-zA-Z][a-zA-Z0-9-]*/.exec(s.slice(i));
        if (!tagMatch) return null;
        const tag = tagMatch[0].toLowerCase();
        i += tagMatch[0].length;
        const attrs = {};
        for (;;) {
            while (i < s.length && /\s/.test(s[i])) i++;
            if (i >= s.length) return null;
            if (s[i] === '>') return { tag, attrs, end: i + 1, selfClosing: false };
            if (s[i] === '/' && s[i + 1] === '>') return { tag, attrs, end: i + 2, selfClosing: true };
            const nameMatch = /^[^\s=\/>]+/.exec(s.slice(i));
            if (!nameMatch) return null;
            const name = nameMatch[0].toLowerCase();
            i += nameMatch[0].length;
            while (i < s.length && /\s/.test(s[i])) i++;
            if (s[i] !== '=') { attrs[name] = ''; continue; }
            i++;
            while (i < s.length && /\s/.test(s[i])) i++;
            let value = '';
            if (s[i] === '"' || s[i] === "'") {
                const q = s[i];
                const end = s.indexOf(q, i + 1);
                if (end < 0) return null;
                value = s.slice(i + 1, end);
                i = end + 1;
            } else {
                const m = /^[^\s>]+/.exec(s.slice(i));
                value = m ? m[0] : '';
                i += value.length;
            }
            attrs[name] = decodeEntities(value);
        }
    }

    // Turns parsed markup into elements. Text between elements is wrapped in
    // a span so it is still an element the tree can select; an element with
    // only text inside is a text element; ids and bindings come back off
    // their data- attributes.
    function toNode(parsed) {
        if (parsed.text != null) {
            return buildNode({ tag: 'span', text: parsed.text.trim() });
        }
        const attrs = Object.assign({}, parsed.attrs);
        const id = attrs['data-pid'] || newId();
        const name = attrs['data-name'] || '';
        const style = cssToStyle(attrs.style);
        let bind = null, repeat = null;
        try { if (attrs['data-bind']) bind = JSON.parse(attrs['data-bind']); } catch (e) { bind = null; }
        try { if (attrs['data-repeat']) repeat = JSON.parse(attrs['data-repeat']); } catch (e) { repeat = null; }
        ['data-pid', 'data-name', 'style', 'data-bind', 'data-repeat'].forEach(k => { delete attrs[k]; });

        const kids = parsed.children || [];
        const elements = kids.filter(k => k.text == null);
        const texts = kids.filter(k => k.text != null);
        const spec = { id, tag: parsed.tag, name, attrs, style, bind, repeat };
        if (parsed.tag === 'img' || VOID_TAGS.includes(parsed.tag)) {
            // nothing inside
        } else if (elements.length) {
            spec.children = kids.map(toNode);
        } else {
            spec.text = texts.map(t => t.text).join('').replace(/\s+/g, ' ').trim();
        }
        return buildNode(spec);
    }

    function htmlToNodes(src) {
        const parsed = parseHtml(src);
        if (!parsed.ok) return { ok: false, problems: parsed.problems, nodes: [] };
        return { ok: true, problems: [], nodes: parsed.children.map(toNode) };
    }

    // ── The page as a CSS rule for print and screen ──────────────────────────

    function pageContainerStyle(template, page) {
        const t = template || buildTemplate({});
        const m = (page && page.margins) || {};
        return Object.assign({
            'width': t.widthPx + 'px',
            'height': t.heightPx + 'px',
            'padding': [m.top, m.right, m.bottom, m.left].map(v => (v || 0) + 'px').join(' '),
            'box-sizing': 'border-box',
            'overflow': 'hidden',
            'position': 'relative',
        }, (page && page.style) || {});
    }

    // ── Linked to an event (MS-400) ──────────────────────────────────────────
    //
    // An event series carries the ids of the Printables that belong to it
    // (`printables: [id, …]`), so every date of it offers them. Whether a
    // member may open one is a fact about the Printable — `memberVisible` on
    // its own record — because the rule that answers a member's read has the
    // Printable in hand and not the event.

    function linkPrintable(ids, id) {
        const list = (ids || []).filter(x => x && x !== id);
        return id ? list.concat([id]) : list;
    }

    function unlinkPrintable(ids, id) {
        return (ids || []).filter(x => x && x !== id);
    }

    const PrintableCore = {
        RECORD_VERSION,
        linkPrintable,
        unlinkPrintable,
        MAX_NAME_LENGTH,
        DEFAULT_NAME,
        PAPERS,
        DENSITIES,
        DEFAULT_DPI,
        DEFAULT_MARGIN_IN,
        TEXT_TAGS,
        VOID_TAGS,
        normaliseName,
        copyName,
        paperByKey,
        buildTemplate,
        printScale,
        newId,
        kindOf,
        buildNode,
        buildRepeat,
        newBox,
        newText,
        newImage,
        buildPage,
        buildPrintable,
        duplicatePrintable,
        migrate,
        buildCustomTemplate,
        findNode,
        locate,
        walk,
        ancestorsOf,
        isDescendantOf,
        insertNode,
        removeNode,
        updateNode,
        moveNode,
        duplicateNode,
        wrapNode,
        styleToCss,
        cssToStyle,
        escapeHtml,
        nodeToHtml,
        pageToHtml,
        parseHtml,
        htmlToNodes,
        pageContainerStyle,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = PrintableCore;
    }
    if (global) {
        global.PrintableCore = PrintableCore;
    }
})(typeof window !== 'undefined' ? window : null);
