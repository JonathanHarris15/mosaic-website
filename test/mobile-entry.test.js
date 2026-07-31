const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// The front door. index.html decides, before anything paints, whether you get
// the desktop site or the mobile app — and it is the ONLY page that decides it,
// so a mistake here is the whole site opening wrong on somebody's phone.
//
// This runs the real rule out of the real page rather than reading it, because
// every interesting case is a combination (a phone that asked for desktop, the
// native app that asked for nothing) and a regex cannot tell you what those do.

const ROOT = path.join(__dirname, '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');

// The first inline <script> in the head IS the entry rule. Asserted, so moving
// it fails here loudly instead of silently testing some other script.
const ENTRY = (INDEX.match(/<script>([\s\S]*?)<\/script>/) || [])[1];
assert.ok(ENTRY && /mobile\.html/.test(ENTRY), 'index.html no longer opens with the entry rule');

// A browser, as much of one as the rule touches. `stored` is what localStorage
// already holds; `broken` makes every localStorage call throw, which is Safari
// in private browsing and must not take the redirect down with it.
function visit(opts) {
    const store = Object.assign({}, opts.stored);
    const replaced = [];
    const localStorage = opts.broken ? {
        getItem() { throw new Error('denied'); },
        setItem() { throw new Error('denied'); },
        removeItem() { throw new Error('denied'); },
    } : {
        getItem: (k) => (k in store ? store[k] : null),
        setItem: (k, v) => { store[k] = String(v); },
        removeItem: (k) => { delete store[k]; },
    };

    // A real enough matchMedia: it answers the two halves of the query
    // separately, so "touch screen" and "narrow" can disagree — which is the
    // whole difference between a phone and a small desktop window.
    const pointer = opts.pointer || (opts.phone ? 'coarse' : 'fine');
    const width = opts.width || (opts.phone ? 390 : 1440);
    const matchMedia = (q) => {
        let matches = true;
        const wantsPointer = q.match(/\(pointer:\s*(\w+)\)/);
        if (wantsPointer) matches = matches && wantsPointer[1] === pointer;
        const wantsWidth = q.match(/\(max-width:\s*(\d+)px\)/);
        if (wantsWidth) matches = matches && width <= Number(wantsWidth[1]);
        return { matches };
    };

    const session = Object.assign({}, opts.session);
    const sessionStorage = {
        getItem: (k) => (k in session ? session[k] : null),
        setItem: (k, v) => { session[k] = String(v); },
        removeItem: (k) => { delete session[k]; },
    };

    const window = { localStorage, sessionStorage, URLSearchParams, matchMedia };
    if (opts.native) window.Capacitor = { isNativePlatform: () => true };

    window.location = {
        pathname: opts.pathname || '/index.html',
        search: opts.search || '',
        replace: (url) => replaced.push(url),
    };
    window.window = window;

    vm.createContext(window);
    vm.runInContext(ENTRY, window);
    return { wentTo: replaced[0] || null, store, session };
}

const MOBILE = 'mobile.html';
const PREF = 'mosaicPrefersDesktop';

test('the viewport tag is parsed before the rule asks how wide we are', () => {
    // THE BUG THIS EXISTS FOR. The rule shipped ABOVE the viewport meta tag,
    // and every iPhone got the desktop site. Until Safari parses that tag the
    // viewport is the default 980px, so `(max-width: 820px)` is false — on a
    // phone that reports a 402px touch screen to the very next line of script.
    //
    // Nothing else in this file can catch it: the rule is correct, and running
    // it (as the tests below do) has no viewport to get wrong. Only the order
    // of two tags in the page is wrong, so only the page can be asked.
    const viewport = INDEX.indexOf('name="viewport"');
    const rule = INDEX.indexOf('<script>');
    assert.ok(viewport !== -1, 'the viewport tag is gone');
    assert.ok(viewport < rule,
        'the entry rule runs before the viewport tag, so it measures a 980px window on every phone');
});

test('a desktop browser stays on the desktop site', () => {
    assert.equal(visit({ phone: false }).wentTo, null);
});

test('a narrow desktop window is still the desktop site', () => {
    // The window being small is not the same as the device being a phone —
    // a mouse at 700px is somebody who resized, not somebody on a phone.
    assert.equal(visit({ pointer: 'fine', width: 700 }).wentTo, null);
});

test('a tablet is the desktop site', () => {
    // Touch, but the room to show the real thing. The mobile app is built for
    // one hand at phone width; an iPad given it loses screens for no reason.
    assert.equal(visit({ pointer: 'coarse', width: 1024 }).wentTo, null);
});

test('a phone browser opens the mobile app', () => {
    assert.equal(visit({ phone: true }).wentTo, MOBILE);
});

test('the native app opens the mobile app', () => {
    assert.equal(visit({ native: true, phone: false }).wentTo, MOBILE);
});

test('?shell=web keeps a phone on the desktop site, and is remembered', () => {
    const first = visit({ phone: true, search: '?shell=web' });
    assert.equal(first.wentTo, null, 'asking for the desktop site did not get you the desktop site');
    // The whole point of remembering: the NEXT visit, with no query at all.
    assert.equal(visit({ phone: true, stored: first.store }).wentTo, null,
        'the desktop site is reachable exactly once, then you are bounced back forever');
});

test('leaving for the desktop site takes the phone chrome off with it', () => {
    // mobile-shell.js remembers the shell for the whole tab, and its own guard
    // ("am I narrow?") is always yes on a phone. Left set, the desktop site you
    // asked for hands you phone-shaped pages with back-links into the app.
    const out = visit({ phone: true, search: '?shell=web', session: { mosaicShell: 'mobile' } });
    assert.equal(out.wentTo, null);
    assert.ok(!('mosaicShell' in out.session),
        'the shell flag survived, so every desktop page after this one still renders as the app');
});

test('?shell=mobile undoes it', () => {
    const back = visit({ phone: true, search: '?shell=mobile', stored: { [PREF]: '1' } });
    assert.equal(back.wentTo, MOBILE);
    assert.ok(!(PREF in back.store), 'the desktop preference survived, so the next visit goes back to desktop');
});

test('the native app ignores a remembered desktop preference', () => {
    // There is no desktop site inside the WebView — index.html would just send
    // you back here. Honouring the preference would be an infinite bounce.
    assert.equal(visit({ native: true, stored: { [PREF]: '1' } }).wentTo, MOBILE);
});

test('a phone with localStorage denied still gets the mobile app', () => {
    // Safari in private browsing throws on every localStorage call. That must
    // cost you the remembered preference, not the app.
    assert.equal(visit({ phone: true, broken: true }).wentTo, MOBILE);
});

test('the mobile app is never redirected to itself', () => {
    assert.equal(visit({ phone: true, pathname: '/mobile.html' }).wentTo, null);
});

// ── The doors between the two sites ──────────────────────────────────────────
//
// Each site is a dead end without the other's link: a phone that chose desktop
// can never get back, or the app has no way out to the screens it doesn't cover.
// The desktop side is a link in the page; the mobile side is rendered, so this
// asks the real Home screen what it actually put on the page.

test('the desktop site has a way back to the mobile app', () => {
    assert.match(INDEX, /id="mobile-switch"/, 'the link is gone');
    assert.match(INDEX, /href="index\.html\?shell=mobile"/,
        'the way back does not clear the remembered desktop preference, so it cannot work');
    // Hidden on desktop by CSS, not by JS — a rule that only runs after the
    // page boots would flash the link at every desktop visitor first.
    assert.match(INDEX, /#mobile-switch\s*\{\s*display:\s*none/,
        'the link is not hidden by default, so a desktop browser sees it');
});

// The Home screen, rendered for real, the way mobile-relationships-tab.test.js
// does it: stub the shell around it and assert what comes out.
function renderHome({ native }) {
    const { h, Fragment } = require('preact');
    const render = require('preact-render-to-string');
    const htm = require('../public/vendor/htm-3.1.1.umd.js');

    global.window = global;
    if (native) global.Capacitor = { isNativePlatform: () => true };
    else delete global.Capacitor;

    const pass = (name) => (props) => h('div', { 'data-c': name }, props.children);
    global.M = {
        h, Fragment,
        html: htm.bind(h),
        hooks: { useState: (v) => [v, () => {}], useEffect: () => {} },
        Ic: (name, size) => h('i', { 'data-icon': name, 'data-size': size }),
        useAsync: () => ({ loading: false, data: null, error: null }),
        ui: {
            Screen: pass('screen'), Body: pass('body'), TopBar: pass('topbar'),
            BarAction: pass('baraction'), Overline: pass('overline'),
            SerifHead: pass('serifhead'), Row: pass('row'), CardList: pass('cardlist'),
            Medallion: pass('medallion'), Button: pass('button'), Badge: pass('badge'),
            Avatar: pass('avatar'), Input: pass('input'),
        },
        data: {
            DESTINATIONS: [],
            canSee: () => true,
            getNextService: async () => null,
            onUser: () => () => {},
            signIn: async () => {},
            signOut: async () => {},
        },
    };

    require('../public/mobile/destinations.js');
    delete require.cache[require.resolve('../public/mobile/app.js')];
    require('../public/mobile/app.js');

    return render(h(global.M.SCREENS.home, { nav: () => {}, openMenu: () => {}, user: null }));
}

test('the mobile app has a way out to the desktop site', () => {
    assert.match(renderHome({ native: false }), /href="index\.html\?shell=web"/,
        'a phone browser is stuck in the mobile app with no way to the pages it does not cover');
});

test('the way out is not offered inside the native app', () => {
    // index.html would send you straight back here, so the link would be a
    // button that does nothing.
    const out = renderHome({ native: true });
    assert.doesNotMatch(out, /index\.html\?shell=web/,
        'the native app is offering a desktop site it cannot reach');
});
