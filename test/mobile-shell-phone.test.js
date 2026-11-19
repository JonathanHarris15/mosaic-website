const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// mobile-shell.js decides whether a desktop page draws as the phone app. It
// used to decide that ONLY from ?shell=mobile or the tab's memory of it — so a
// phone that opened calendar.html or commitments.html straight from a text
// message link got the desktop month squeezed onto 390px. These run the real
// script against a fake browser, the same way mobile-entry.test.js runs
// index.html's entry rule.

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'mobile-shell.js'), 'utf8');
const PREF = 'mosaicPrefersDesktop';

/** @param {Record<string, string>} [init] */
function storage(init) {
    /** @type {Record<string, string>} */
    const s = Object.assign({}, init);
    return {
        data: s,
        api: {
            getItem: (/** @type {string} */ k) => (k in s ? s[k] : null),
            setItem: (/** @type {string} */ k, /** @type {unknown} */ v) => { s[k] = String(v); },
            removeItem: (/** @type {string} */ k) => { delete s[k]; },
        },
    };
}

/**
 * @param {{ phone?: boolean, pointer?: string, width?: number, native?: boolean,
 *           search?: string, stored?: Record<string, string>, session?: Record<string, string> }} opts
 */
function load(opts) {
    const pointer = opts.pointer || (opts.phone ? 'coarse' : 'fine');
    const width = opts.width || (opts.phone ? 390 : 1440);
    const matchMedia = (/** @type {string} */ q) => {
        let matches = true;
        const p = q.match(/\(pointer:\s*(\w+)\)/);
        if (p) matches = matches && p[1] === pointer;
        const w = q.match(/\(max-width:\s*(\d+)px\)/);
        if (w) matches = matches && width <= Number(w[1]);
        return { matches };
    };
    const local = storage(opts.stored);
    const session = storage(opts.session);
    const classes = new Set();
    const document = {
        readyState: 'complete',
        documentElement: { classList: { add: (/** @type {string} */ c) => classes.add(c) } },
        body: { classList: { add() {} } },
        head: { appendChild() {} },
        querySelector: () => ({ getAttribute: () => 'width=device-width', setAttribute() {} }),
        createElement: () => ({ setAttribute() {} }),
        addEventListener() {},
    };
    /** @type {Record<string, any>} */
    const window = {
        location: { search: opts.search || '' },
        matchMedia, URLSearchParams, document,
        localStorage: local.api, sessionStorage: session.api,
    };
    if (opts.native) window.Capacitor = {};
    window.window = window;
    vm.createContext(window);
    vm.runInContext(SRC, window);
    return { shell: window.MOSAIC_SHELL, cls: classes.has('shell-mobile'), local: local.data, session: session.data };
}

test('a phone browser opened straight onto a page gets the phone layout', () => {
    const out = load({ phone: true });
    assert.equal(out.shell, 'mobile');
    assert.ok(out.cls, 'html.shell-mobile was not set, so the page drew its desktop layout');
    assert.equal(out.session.mosaicShell, 'mobile', 'the next page in the tab forgets it is on a phone');
});

test('a desktop browser stays desktop', () => {
    assert.equal(load({ phone: false }).shell, 'web');
});

test('a narrow desktop window stays desktop', () => {
    assert.equal(load({ pointer: 'fine', width: 700 }).shell, 'web');
});

test('a tablet stays desktop', () => {
    assert.equal(load({ pointer: 'coarse', width: 1024 }).shell, 'web');
});

test('a phone that chose the desktop site keeps it', () => {
    assert.equal(load({ phone: true, stored: { [PREF]: '1' } }).shell, 'web');
});

test('?shell=web on a phone is the desktop site, and is remembered', () => {
    const first = load({ phone: true, search: '?shell=web', session: { mosaicShell: 'mobile' } });
    assert.equal(first.shell, 'web');
    assert.equal(first.local[PREF], '1');
    assert.ok(!('mosaicShell' in first.session));
    assert.equal(load({ phone: true, stored: first.local }).shell, 'web');
});

test('?shell=mobile clears the desktop preference', () => {
    const out = load({ phone: true, search: '?shell=mobile', stored: { [PREF]: '1' } });
    assert.equal(out.shell, 'mobile');
    assert.ok(!(PREF in out.local));
});
