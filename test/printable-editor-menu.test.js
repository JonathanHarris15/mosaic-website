const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PrintableCore = require('../public/printable-core.js');

// The context menu is drawn inside the viewport. A press on one of its
// commands used to be treated as a press on empty canvas: the menu closed
// on mousedown, so the click fell through and only deselected the element.

function el(tag, className) {
    const node = {
        tagName: String(tag || 'div').toUpperCase(),
        id: '',
        className: className || '',
        attrs: {},
        style: {},
        children: [],
        parentElement: null,
        _on: {},
        _dataset: {},
        textContent: '',
        focused: false,
        selected: false,
    };
    node.classList = classListFor(node);
    node.dataset = node._dataset;
    node.setAttribute = (k, v) => { node.attrs[k] = String(v); };
    node.getAttribute = (k) => (Object.prototype.hasOwnProperty.call(node.attrs, k) ? node.attrs[k] : null);
    node.addEventListener = (type, fn) => { (node._on[type] || (node._on[type] = [])).push(fn); };
    node.removeEventListener = () => {};
    node.appendChild = (child) => {
        child.parentElement = node;
        node.children.push(child);
        return child;
    };
    node.matches = (sel) => {
        if (sel.charAt(0) === '.') return node.classList.contains(sel.slice(1));
        if (sel.charAt(0) === '[' && sel.charAt(sel.length - 1) === ']') {
            return node.getAttribute(sel.slice(1, -1)) != null;
        }
        return node.tagName === sel.toUpperCase();
    };
    node.closest = (sel) => {
        let n = node;
        while (n && n.matches) {
            if (n.matches(sel)) return n;
            n = n.parentElement;
        }
        return null;
    };
    node.querySelectorAll = () => [];
    node.querySelector = () => null;
    node.focus = () => { node.focused = true; };
    node.select = () => { node.selected = true; };
    node.getBoundingClientRect = () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 });
    return node;
}

function classListFor(node) {
    const set = new Set(String(node.className || '').split(/\s+/).filter(Boolean));
    const sync = () => { node.className = Array.from(set).join(' '); };
    return {
        add(...xs) { xs.forEach(x => set.add(x)); sync(); },
        remove(...xs) { xs.forEach(x => set.delete(x)); sync(); },
        contains(x) { return set.has(x); },
        toggle(x, force) {
            const on = force == null ? !set.has(x) : !!force;
            if (on) set.add(x); else set.delete(x);
            sync();
        },
    };
}

function dispatch(target, type, extra) {
    const event = Object.assign({
        type: type,
        button: 0,
        clientX: 20,
        clientY: 20,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        altKey: false,
        target: target,
        currentTarget: null,
        defaultPrevented: false,
        preventDefault() { this.defaultPrevented = true; },
        stopPropagation() { this.stopped = true; },
    }, extra || {});
    const chain = [];
    for (let n = target; n; n = n.parentElement) chain.push(n);
    if (target.ownerDocument) chain.push(target.ownerDocument);
    if (target.ownerWindow) chain.push(target.ownerWindow);
    for (const node of chain) {
        event.currentTarget = node;
        const list = node._on && node._on[type] ? node._on[type].slice() : [];
        for (const fn of list) fn(event);
        if (event.stopped) break;
    }
    return event;
}

function boot() {
    const doc = {
        _on: {},
        activeElement: null,
        addEventListener(type, fn) { (this._on[type] || (this._on[type] = [])).push(fn); },
        removeEventListener() {},
        getElementById(id) { return find(this.body, n => n.id === id); },
        querySelector() { return null; },
        createElement(tag) { return el(tag); },
    };
    const win = {
        _on: {},
        document: doc,
        innerWidth: 1400,
        localStorage: { getItem() { return null; }, setItem() {} },
        setTimeout, clearTimeout,
        addEventListener(type, fn) { (this._on[type] || (this._on[type] = [])).push(fn); },
        removeEventListener() {},
        getSelection() { return { removeAllRanges() {}, addRange() {} }; },
    };
    doc.defaultView = win;

    const viewport = el('div', 'pe-viewport');
    viewport.id = 'pe-viewport';
    const world = el('div', 'pe-world');
    world.id = 'pe-world';
    const page = el('div', 'pr-page');
    page.setAttribute('data-page', 'p1');
    const sermon = el('p');
    sermon.setAttribute('data-pid', 'sermon');
    page.appendChild(sermon);
    world.appendChild(page);
    const canvas = el('div'); // the dotted margin, not a page
    viewport.appendChild(world);
    viewport.appendChild(canvas);

    const menu = el('div', 'pe-menu pe-menu--ctx');
    const button = el('button');
    const icon = el('span', 'material-symbols-outlined');
    button.appendChild(icon);
    menu.appendChild(button);
    viewport.appendChild(menu);

    const tree = el('div');
    tree.id = 'pe-tree';
    const strip = el('div');
    strip.id = 'pe-pages-strip';
    const nameField = el('input');
    nameField.id = 'pe-prop-name';

    const body = el('body');
    body.appendChild(viewport);
    body.appendChild(tree);
    body.appendChild(strip);
    body.appendChild(nameField);
    doc.body = body;

    const stamp = (n) => {
        n.ownerDocument = doc;
        n.ownerWindow = win;
        n.children.forEach(stamp);
    };
    stamp(body);

    global.document = doc;
    global.PrintableCore = PrintableCore;
    const src = fs.readFileSync(path.join(__dirname, '../public/printable-editor.js'), 'utf8');
    const ed = new Function('window', src + '\nreturn printableEditor;')(win)();
    ed.renderAll = () => {};
    ed.renderPage = () => {};
    ed.renderTree = () => {};
    ed.renderPagesStrip = () => {};
    ed.refreshOverlays = () => {};
    ed.readProps = () => {};
    ed.touch = () => {};
    ed.$nextTick = (fn) => { if (typeof fn === 'function') fn(); };
    ed.mount();

    return { ed: ed, win: win, doc: doc, viewport: viewport, canvas: canvas, menu: menu, button: button, icon: icon, nameField: nameField };
}

function find(node, pred) {
    if (!node) return null;
    if (pred(node)) return node;
    for (const child of node.children || []) {
        const hit = find(child, pred);
        if (hit) return hit;
    }
    return null;
}

function arm(env) {
    const template = PrintableCore.buildTemplate({ paper: 'letter', orientation: 'portrait', dpi: 150 });
    const sermon = PrintableCore.newText(template.dpi, 'Sermon');
    sermon.id = 'sermon';
    sermon.name = 'Sermon';
    const hymn = PrintableCore.newText(template.dpi, 'Hymn');
    hymn.id = 'hymn';
    hymn.name = 'Hymn';
    const page = PrintableCore.buildPage(template, { id: 'p1', nodes: [sermon, hymn] });
    env.ed.project = { id: 'doc', name: 'Guide', template: template, pages: [page], inputs: [] };
    env.ed.selection.pageId = 'p1';
    env.ed.selection.nodeId = 'sermon';
    env.ed.menu = { open: true, x: 40, y: 80, nodeId: 'sermon', pageId: 'p1' };
    env.ed.makeIterated = () => { env.iterated = true; };
    env.iterated = false;
    env.nameField.focused = false;
    env.nameField.selected = false;
    env.button._on.click = [() => {}];
}

// What a real press does. Closing the menu on mousedown removes it before
// mouseup, so the click lands on the canvas behind the menu, not the command.
function press(env, action) {
    env.button._on.click = [() => env.ed.menuAct(action)];
    const down = dispatch(env.icon, 'mousedown');
    const hit = env.ed.menu.open ? env.icon : env.canvas;
    dispatch(hit, 'mouseup');
    dispatch(hit, 'click');
    return down;
}

function nodes(env) {
    return env.ed.project.pages[0].nodes;
}

test('a context-menu command acts on the selected element instead of only deselecting it', () => {
    const env = boot();

    arm(env);
    const down = press(env, 'duplicate');
    assert.equal(down.defaultPrevented, false, 'the press is not swallowed as a canvas pan');
    assert.equal(env.viewport.classList.contains('pe-panning'), false);
    assert.equal(nodes(env).length, 3);
    assert.equal(nodes(env)[1].name, 'Sermon');
    assert.notEqual(env.ed.selection.nodeId, null);
    assert.notEqual(env.ed.selection.nodeId, 'sermon');
    assert.equal(env.ed.menu.open, false);

    arm(env);
    press(env, 'wrap');
    assert.equal(nodes(env)[0].tag, 'div');
    assert.equal(nodes(env)[0].children[0].id, 'sermon');
    assert.equal(env.ed.selection.nodeId, 'sermon');

    arm(env);
    press(env, 'forward');
    assert.deepEqual(nodes(env).map(n => n.id), ['hymn', 'sermon']);
    assert.equal(env.ed.selection.nodeId, 'sermon');

    arm(env);
    press(env, 'back');
    assert.deepEqual(nodes(env).map(n => n.id), ['sermon', 'hymn']);
    assert.equal(env.ed.selection.nodeId, 'sermon');

    arm(env);
    press(env, 'rename');
    assert.equal(env.ed.selection.nodeId, 'sermon');
    assert.equal(env.nameField.focused, true);
    assert.equal(env.nameField.selected, true);

    arm(env);
    press(env, 'iterate');
    assert.equal(env.iterated, true);
    assert.equal(env.ed.selection.nodeId, 'sermon');

    arm(env);
    press(env, 'delete');
    assert.deepEqual(nodes(env).map(n => n.id), ['hymn']);
    assert.equal(env.ed.selection.nodeId, null);

    arm(env);
    press(env, 'add-page');
    assert.equal(env.ed.project.pages.length, 2);
});

test('clicking the canvas still closes the menu and clears the selection', () => {
    const env = boot();
    arm(env);
    dispatch(env.canvas, 'mousedown');
    assert.equal(env.ed.menu.open, false);
    dispatch(env.canvas, 'mouseup');
    dispatch(env.canvas, 'click');
    assert.equal(env.ed.selection.nodeId, null);
    assert.deepEqual(nodes(env).map(n => n.id), ['sermon', 'hymn']);
});
