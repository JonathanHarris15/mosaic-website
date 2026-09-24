const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { h, Fragment } = require('preact');
const render = require('preact-render-to-string');
const htm = require('../public/vendor/htm-3.1.1.umd.js');

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');

function setupMobileEnv() {
    global.window = global;
    global.M = {
        h,
        Fragment,
        html: htm.bind(h),
        hooks: { useState: (v) => [v, () => {}], useEffect: () => {} },
        Ic: (name, size) => h('i', { 'data-icon': name, 'data-size': size }),
        useAsync: () => ({ loading: false, data: null, error: null }),
        ui: {},
        data: {
            DESTINATIONS: [],
            canSee: () => true,
            getNextService: async () => null,
            onUser: () => () => {},
            signIn: async () => {},
            signOut: async () => {},
        },
    };

    delete require.cache[require.resolve('../public/mobile/ui.js')];
    require('../public/mobile/ui.js');
    return global.M;
}

test('M.ui.Body renders m-bottom-buffer with safe-area bottom calculation by default', () => {
    const M = setupMobileEnv();
    const Body = M.ui.Body;
    const out = render(h(Body, null, h('p', null, 'Hello World')));

    assert.match(out, /class="m-bottom-buffer"/, 'Body must render m-bottom-buffer spacer');
    assert.match(out, /calc\(24px \+ env\(safe-area-inset-bottom, 0px\)\)/, 'm-bottom-buffer must calculate safe area bottom inset');
    assert.match(out, /aria-hidden="true"/, 'm-bottom-buffer should be aria-hidden');
});

test('M.ui.Body omits m-bottom-buffer when noBuffer is true', () => {
    const M = setupMobileEnv();
    const Body = M.ui.Body;
    const out = render(h(Body, { noBuffer: true }, h('p', null, 'Centered View')));

    assert.doesNotMatch(out, /m-bottom-buffer/, 'Body with noBuffer=true must not render m-bottom-buffer');
    assert.match(out, /Centered View/, 'Body children should still be rendered');
});

test('public/mobile.html defines the .m-bottom-buffer css rule', () => {
    const html = fs.readFileSync(path.join(PUBLIC, 'mobile.html'), 'utf8');
    assert.match(html, /\.m-bottom-buffer\s*\{[^}]*env\(safe-area-inset-bottom/,
        'mobile.html stylesheet must define .m-bottom-buffer with safe area inset');
});

test('HomeScreen provides a bottom buffer in both web and native app modes', () => {
    const M = setupMobileEnv();
    require('../public/mobile/destinations.js');
    delete require.cache[require.resolve('../public/mobile/app.js')];
    require('../public/mobile/app.js');

    // Web mode (browser)
    delete global.Capacitor;
    const webOut = render(h(M.SCREENS.home, { nav: () => {}, openMenu: () => {}, user: null }));
    assert.match(webOut, /View desktop site/, 'Web mode should render desktop site link');
    assert.match(webOut, /m-bottom-buffer/, 'Web mode should have m-bottom-buffer');

    // Native app mode (installed on phone)
    global.Capacitor = { isNativePlatform: () => true };
    const nativeOut = render(h(M.SCREENS.home, { nav: () => {}, openMenu: () => {}, user: null }));
    assert.doesNotMatch(nativeOut, /View desktop site/, 'Native app must not offer desktop site link');
    assert.match(nativeOut, /aria-hidden="true"/, 'Native app must render buffer spacer');
    assert.match(nativeOut, /m-bottom-buffer/, 'Native app must have m-bottom-buffer');
});

test('CareList list container includes bottom safe-area buffer spacer', () => {
    const careListSrc = fs.readFileSync(path.join(PUBLIC, 'mobile/screens-carelist.js'), 'utf8');
    assert.match(careListSrc, /calc\(24px \+ env\(safe-area-inset-bottom, 0px\)\)/,
        'CareList list must include bottom buffer with safe area inset');
});
