// App Check client paths for the public form door (MS-535 / MS-508).
//
// WHY THIS FILE EXISTS. Turning `enforceAppCheck` on once stopped anybody
// answering a form for days. The hang from activating reCAPTCHA in <head>
// is already fixed (scripts at the end of <body>). What was still missing,
// and what this file is, is the two TOKEN PATHS a real caller uses:
//
//   1. Website (and localhost). A reCAPTCHA Enterprise site key attests
//      the live HTTPS origin. On localhost the browser cannot prove that,
//      so Firebase's debug-token exchange is how a developer gets through
//      without weakening anybody else. The flag that turns that exchange
//      on MUST be set before activate(), and it was never set.
//   2. Phone shell (Capacitor). The fill-in page inside the WebView is
//      served from capacitor://localhost (iOS) or https://localhost
//      (Android) — documented in local-cache.js. A WEBSITE reCAPTCHA key
//      cannot attest that origin, and nothing native (App Attest / Play
//      Integrity) is wired. The shell therefore hops the SAME page onto
//      the hosted HTTPS origin so reCAPTCHA can mint a real token. That
//      is not a second door: it is still form-answer.html → publicForm.
//
// Deliberately self-contained, like the other *-core modules: requires
// nothing, mutates only the debug-token flag it is documented to set,
// and is loaded as a classic <script> plus exported for Node.

(function (global) {
    'use strict';

    function configFrom(g) {
        const root = g || global;
        return (root && root.MOSAIC_APP_CHECK) || {};
    }

    // Tokens are collected whenever the answering page is asked to prove
    // itself — monitor and enforce both, off neither. `enabled` is the
    // older boolean; `mode` wins when present so MS-534 can name the
    // rollout without a second switch that disagrees with it.
    function collectsTokens(cfg) {
        const mode = cfg && cfg.mode;
        if (mode === 'off') return false;
        if (mode === 'monitor' || mode === 'enforce') return true;
        return !!(cfg && cfg.enabled);
    }

    function siteKey(cfg) {
        const key = (cfg && cfg.siteKey) || '';
        return collectsTokens(cfg) ? key : '';
    }

    function providerKind(cfg) {
        return (cfg && cfg.provider) === 'v3' ? 'v3' : 'enterprise';
    }

    function liveOrigin(cfg) {
        return String((cfg && cfg.liveOrigin) || '').replace(/\/+$/, '');
    }

    function isCapacitorShell(g) {
        const root = g || global;
        return !!(root && root.Capacitor);
    }

    // Origins reCAPTCHA Enterprise (a WEBSITE key) cannot attest. Phone
    // WebView and a developer laptop look the same from here: not our
    // live domain.
    function originCannotAttest(location) {
        if (!location) return true;
        const host = String(location.hostname || '');
        const proto = String(location.protocol || '');
        if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]') {
            return true;
        }
        if (proto === 'capacitor:' || proto === 'ionic:' || proto === 'file:') {
            return true;
        }
        return false;
    }

    function formIdFromLocation(location) {
        const path = String((location && location.pathname) || '');
        const m = path.match(/\/f\/([A-Za-z0-9]+)\/?$/);
        if (m) return m[1];
        try {
            return new URLSearchParams((location && location.search) || '').get('f') || '';
        } catch (e) {
            return '';
        }
    }

    // Same fill-in page, hosted origin, pretty /f/<id> when we have one.
    // Capacitor has no hosting rewrite, so a form opened as
    // form-answer.html?f=<id> inside the shell becomes /f/<id> on the
    // live site — the URL a text-message tap already uses.
    function hostedFormUrl(location, cfg) {
        const live = liveOrigin(cfg);
        const id = formIdFromLocation(location);
        if (id) return live + '/f/' + id;
        const path = String((location && location.pathname) || '/form-answer.html');
        const search = String((location && location.search) || '');
        const hash = String((location && location.hash) || '');
        return live + path + search + hash;
    }

    // Phone shell only. A laptop on localhost keeps the local page and
    // uses a debug token instead — hopping a developer to prod would
    // hide the code they are trying to run.
    function shouldHopToHostedOrigin(location, cfg, g) {
        if (!collectsTokens(cfg)) return false;
        if (!isCapacitorShell(g)) return false;
        const live = liveOrigin(cfg);
        if (!live) return false;
        const current = String((location && location.origin) || '').replace(/\/+$/, '');
        if (!current || current === live) return false;
        return true;
    }

    function hopIfNeeded(location, cfg, g) {
        if (!shouldHopToHostedOrigin(location, cfg, g)) {
            return {hopped: false, reason: 'not-needed'};
        }
        const url = hostedFormUrl(location, cfg);
        if (location && typeof location.replace === 'function') {
            location.replace(url);
            return {hopped: true, url: url};
        }
        return {hopped: false, reason: 'no-replace', url: url};
    }

    // Debug-token exchange: localhost (and a Capacitor shell that cannot
    // hop, e.g. liveOrigin not set). Firebase reads
    // FIREBASE_APPCHECK_DEBUG_TOKEN at activate() time. `true` makes the
    // SDK mint a UUID and print it; a string uses that UUID. Neither
    // value is a secret we ship — the string form is for an operator to
    // set locally, never to commit.
    function shouldUseDebugExchange(location, cfg, g) {
        if (!collectsTokens(cfg)) return false;
        if (shouldHopToHostedOrigin(location, cfg, g)) return false;
        return originCannotAttest(location);
    }

    function prepareDebugToken(g, location, cfg) {
        const root = g || global;
        if (!shouldUseDebugExchange(location, cfg, root)) {
            return {used: false, reason: 'not-needed'};
        }
        const existing = root.FIREBASE_APPCHECK_DEBUG_TOKEN;
        if (typeof existing === 'string' && existing) {
            return {used: true, reason: 'existing-token'};
        }
        if (existing === true) {
            return {used: true, reason: 'already-true'};
        }
        root.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
        return {used: true, reason: 'enabled-true'};
    }

    // What an operator pastes onto MS-508 when a client cannot attest.
    function describePath(location, cfg, g) {
        const collecting = collectsTokens(cfg);
        const hop = shouldHopToHostedOrigin(location, cfg, g);
        const debug = shouldUseDebugExchange(location, cfg, g);
        const kind = providerKind(cfg);
        const host = location ? (location.origin || location.hostname || '') : '';
        let client = 'web';
        if (isCapacitorShell(g)) client = 'phone-shell';
        else if (originCannotAttest(location)) client = 'localhost';
        let path = 'recaptcha-' + kind;
        if (hop) path = 'hop-to-hosted-origin';
        else if (debug) path = 'debug-token-exchange';
        else if (!collecting) path = 'off';
        return {
            client: client,
            path: path,
            origin: String(host),
            siteKeySet: !!(cfg && cfg.siteKey),
            collecting: collecting,
        };
    }

    function activate(firebase, cfg, document, log) {
        const warn = (log && log.warn) || (global && global.console && global.console.warn.bind(global.console)) || function () {};
        const error = (log && log.error) || (global && global.console && global.console.error.bind(global.console)) || function () {};
        const info = (log && log.info) || (global && global.console && global.console.info.bind(global.console)) || function () {};

        if (!collectsTokens(cfg)) {
            info('App Check is off — see app-check-config.js.');
            return {started: false, reason: 'off'};
        }
        const key = siteKey(cfg);
        if (!key) {
            warn('App Check is enabled but has no site key, so public forms will be ' +
                'refused. Run: bash scripts/wizard-app-check.sh');
            return {started: false, reason: 'no-site-key'};
        }
        if (document && !document.body) {
            error('form-answer.js ran before <body> existed. App Check is NOT being ' +
                'started, because starting it here hangs every call for ever. ' +
                'Move this script back to the end of <body>.');
            return {started: false, reason: 'no-body'};
        }
        if (!firebase || !firebase.appCheck) {
            warn('App Check did not start: firebase.appCheck is missing.');
            return {started: false, reason: 'no-sdk'};
        }
        try {
            // ⚠ THE PROVIDER IS NAMED, NEVER INFERRED. activate() given a
            // bare string quietly builds a ReCaptchaV3Provider — and ours
            // is an Enterprise key, which the v3 flow cannot attest. The
            // symptom is not an error mentioning reCAPTCHA; it is every
            // submission refused and a form that will not load.
            const P = firebase.appCheck;
            const provider = providerKind(cfg) === 'v3'
                ? new P.ReCaptchaV3Provider(key)
                : new P.ReCaptchaEnterpriseProvider(key);
            firebase.appCheck().activate(provider, true);
            return {started: true, reason: 'ok'};
        } catch (e) {
            warn('App Check did not start:', e && e.message);
            return {started: false, reason: 'threw', error: e && e.message};
        }
    }

    const MosaicAppCheck = {
        configFrom: configFrom,
        collectsTokens: collectsTokens,
        siteKey: siteKey,
        providerKind: providerKind,
        liveOrigin: liveOrigin,
        isCapacitorShell: isCapacitorShell,
        originCannotAttest: originCannotAttest,
        formIdFromLocation: formIdFromLocation,
        hostedFormUrl: hostedFormUrl,
        shouldHopToHostedOrigin: shouldHopToHostedOrigin,
        hopIfNeeded: hopIfNeeded,
        shouldUseDebugExchange: shouldUseDebugExchange,
        prepareDebugToken: prepareDebugToken,
        describePath: describePath,
        activate: activate,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = MosaicAppCheck;
    }
    if (global) {
        global.MosaicAppCheck = MosaicAppCheck;
    }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null));
