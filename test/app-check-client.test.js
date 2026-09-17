const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const AppCheck = require('../public/app-check-client.js');

// MS-535 — the two token paths a public form actually uses, pinned so a
// later "just turn enforce on" cannot quietly drop the phone shell or
// localhost debug exchange again.

const CFG = {
    enabled: true,
    siteKey: '6Le-test-site-key',
    provider: 'enterprise',
    liveOrigin: 'https://mosaic-hymn-database.web.app',
};

const live = (over) => Object.assign({
    protocol: 'https:',
    hostname: 'mosaic-hymn-database.web.app',
    origin: 'https://mosaic-hymn-database.web.app',
    pathname: '/f/7bQm2xK9vRt4Lp8sYw3NcF',
    search: '',
    hash: '',
    replace() {},
}, over || {});

test('tokens are collected only when the page is asked to prove itself', () => {
    assert.strictEqual(AppCheck.collectsTokens({enabled: false}), false);
    assert.strictEqual(AppCheck.collectsTokens({enabled: true}), true);
    assert.strictEqual(AppCheck.collectsTokens({mode: 'off', enabled: true}), false);
    assert.strictEqual(AppCheck.collectsTokens({mode: 'monitor', enabled: false}), true);
    assert.strictEqual(AppCheck.collectsTokens({mode: 'enforce'}), true);
    assert.strictEqual(AppCheck.siteKey({enabled: false, siteKey: 'k'}), '');
    assert.strictEqual(AppCheck.siteKey(CFG), '6Le-test-site-key');
});

test('a live HTTPS origin can use the Enterprise site key', () => {
    const loc = live();
    assert.strictEqual(AppCheck.originCannotAttest(loc), false);
    assert.strictEqual(AppCheck.shouldUseDebugExchange(loc, CFG, {}), false);
    assert.strictEqual(AppCheck.shouldHopToHostedOrigin(loc, CFG, {}), false);
    const described = AppCheck.describePath(loc, CFG, {});
    assert.strictEqual(described.client, 'web');
    assert.strictEqual(described.path, 'recaptcha-enterprise');
});

test('localhost cannot attest, so it uses the debug-token exchange', () => {
    const loc = live({
        protocol: 'http:',
        hostname: '127.0.0.1',
        origin: 'http://127.0.0.1:4173',
        pathname: '/f/7bQm2xK9vRt4Lp8sYw3NcF',
    });
    assert.ok(AppCheck.originCannotAttest(loc));
    assert.ok(AppCheck.shouldUseDebugExchange(loc, CFG, {}));
    assert.strictEqual(AppCheck.shouldHopToHostedOrigin(loc, CFG, {}), false,
        'a developer laptop must not be hopped to prod — that hides the code ' +
        'they are trying to run');
    const described = AppCheck.describePath(loc, CFG, {});
    assert.strictEqual(described.client, 'localhost');
    assert.strictEqual(described.path, 'debug-token-exchange');
});

test('the phone shell hops onto the hosted origin rather than minting on localhost', () => {
    const loc = live({
        protocol: 'capacitor:',
        hostname: 'localhost',
        origin: 'capacitor://localhost',
        pathname: '/form-answer.html',
        search: '?f=7bQm2xK9vRt4Lp8sYw3NcF',
    });
    const cap = {Capacitor: {}};
    assert.ok(AppCheck.originCannotAttest(loc));
    assert.ok(AppCheck.isCapacitorShell(cap));
    assert.ok(AppCheck.shouldHopToHostedOrigin(loc, CFG, cap));
    assert.strictEqual(AppCheck.shouldUseDebugExchange(loc, CFG, cap), false,
        'hopping is the production phone path; debug tokens are a laptop / ' +
        'break-glass tool, not something every member device can register');
    assert.strictEqual(
        AppCheck.hostedFormUrl(loc, CFG),
        'https://mosaic-hymn-database.web.app/f/7bQm2xK9vRt4Lp8sYw3NcF');
    const described = AppCheck.describePath(loc, CFG, cap);
    assert.strictEqual(described.client, 'phone-shell');
    assert.strictEqual(described.path, 'hop-to-hosted-origin');
});

test('hopping is the same fill-in page, not a second submit path', () => {
    const html = fs.readFileSync(
        path.join(__dirname, '..', 'public', 'form-answer.html'), 'utf8');
    assert.match(html, /src="\/app-check-client\.js"/,
        'the answering page never loads the client helper, so the phone hop ' +
        'and debug-token flag cannot run');
    const src = fs.readFileSync(
        path.join(__dirname, '..', 'public', 'app-check-client.js'), 'utf8');
    assert.doesNotMatch(src, /httpsCallable\(/,
        'the helper must not grow its own callable — that would be a second door');
    assert.match(src, /publicForm/,
        'the comment that names the one door has gone missing');
});

test('hopIfNeeded actually navigates, and only once', () => {
    const replaced = [];
    const loc = live({
        protocol: 'capacitor:',
        hostname: 'localhost',
        origin: 'capacitor://localhost',
        pathname: '/f/7bQm2xK9vRt4Lp8sYw3NcF',
        replace: (url) => replaced.push(url),
    });
    const first = AppCheck.hopIfNeeded(loc, CFG, {Capacitor: {}});
    assert.strictEqual(first.hopped, true);
    assert.deepStrictEqual(replaced,
        ['https://mosaic-hymn-database.web.app/f/7bQm2xK9vRt4Lp8sYw3NcF']);

    const alreadyLive = live({
        replace: (url) => replaced.push(url),
    });
    const second = AppCheck.hopIfNeeded(alreadyLive, CFG, {Capacitor: {}});
    assert.strictEqual(second.hopped, false);
    assert.strictEqual(replaced.length, 1, 'hopping the live origin loops');
});

test('the debug-token flag is set before activate, and no secret is written', () => {
    const g = {};
    const loc = live({
        protocol: 'http:',
        hostname: 'localhost',
        origin: 'http://localhost:5000',
    });
    const prepared = AppCheck.prepareDebugToken(g, loc, CFG);
    assert.strictEqual(prepared.used, true);
    assert.strictEqual(g.FIREBASE_APPCHECK_DEBUG_TOKEN, true,
        'the SDK only exchanges a debug token when this global is set');

    const given = {FIREBASE_APPCHECK_DEBUG_TOKEN: 'local-only-uuid'};
    const kept = AppCheck.prepareDebugToken(given, loc, CFG);
    assert.strictEqual(kept.reason, 'existing-token');
    assert.strictEqual(given.FIREBASE_APPCHECK_DEBUG_TOKEN, 'local-only-uuid',
        'an operator-supplied token must not be overwritten');

    const src = fs.readFileSync(
        path.join(__dirname, '..', 'public', 'app-check-client.js'), 'utf8');
    assert.doesNotMatch(src, /FIREBASE_APPCHECK_DEBUG_TOKEN\s*=\s*['"][0-9a-f-]{8,}/i,
        'a debug token UUID has been committed — it is a real bypass');
});

test('off collects nothing, so it neither hops nor arms a debug token', () => {
    const loc = live({
        protocol: 'capacitor:',
        hostname: 'localhost',
        origin: 'capacitor://localhost',
        pathname: '/form-answer.html',
        search: '?f=7bQm2xK9vRt4Lp8sYw3NcF',
    });
    const off = Object.assign({}, CFG, {enabled: false});
    assert.strictEqual(AppCheck.shouldHopToHostedOrigin(loc, off, {Capacitor: {}}), false);
    assert.strictEqual(AppCheck.shouldUseDebugExchange(loc, off, {Capacitor: {}}), false);
    assert.strictEqual(AppCheck.prepareDebugToken({}, loc, off).used, false);
});

test('activate names the Enterprise provider and refuses to run without <body>', () => {
    const calls = [];
    const fakeFirebase = {
        appCheck: {
            ReCaptchaV3Provider: function V3(k) { calls.push(['v3', k]); },
            ReCaptchaEnterpriseProvider: function Ent(k) { calls.push(['enterprise', k]); },
        },
    };
    fakeFirebase.appCheck = Object.assign(function appCheck() {
        return {
            activate(provider, refresh) { calls.push(['activate', provider, refresh]); },
        };
    }, fakeFirebase.appCheck);

    const logs = {warn: () => {}, error: () => {}, info: () => {}};
    const noBody = AppCheck.activate(fakeFirebase, CFG, {body: null}, logs);
    assert.strictEqual(noBody.reason, 'no-body');
    assert.deepStrictEqual(calls, []);

    const started = AppCheck.activate(fakeFirebase, CFG, {body: {}}, logs);
    assert.strictEqual(started.started, true);
    assert.strictEqual(calls[0][0], 'enterprise');
    assert.strictEqual(calls[1][0], 'activate');
    assert.strictEqual(calls[1][2], true);

    const v3 = AppCheck.activate(
        fakeFirebase, Object.assign({}, CFG, {provider: 'v3'}), {body: {}}, logs);
    assert.strictEqual(v3.started, true);
    assert.ok(calls.some(c => c[0] === 'v3'));
});

test('a missing site key is a loud no-start, not a hang', () => {
    const logs = [];
    const result = AppCheck.activate(
        {appCheck: function () { throw new Error('should not run'); }},
        {enabled: true, siteKey: '', provider: 'enterprise'},
        {body: {}},
        {warn: (m) => logs.push(m), error: () => {}, info: () => {}});
    assert.strictEqual(result.reason, 'no-site-key');
    assert.ok(String(logs[0]).includes('wizard-app-check'));
});
