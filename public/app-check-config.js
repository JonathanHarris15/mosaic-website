// App Check — the site key, and why it is committed in plain sight.
//
// WHAT APP CHECK IS FOR. A public form lives at an address anybody can reach;
// that is the whole point of a form for people outside the church. Nothing
// about that address says the request came from a real person on our page, so
// without this a script can hit it a thousand times a second and fill a bible
// study sign-up with rubbish. App Check has the browser collect a token
// proving it is running THIS website. In **enforce**, `publicForm` refuses
// anything that arrives without one (ADR-0051). In **monitor** (the default
// after MS-508) it logs missing tokens and refuses nothing. Somebody filling
// in a form sees nothing — no "tick to prove you are human".
//
// ⚠ THIS KEY IS PUBLIC AND BELONGS IN THE REPO. A reCAPTCHA site key ships in
// every browser that loads the page, exactly like the Firebase apiKey in
// auth.js. It is not a secret, it is not in functions/.env, and hiding it
// would only mean a clean checkout could not answer a form. The secret half
// lives in Google's console and never comes near this repo.
//
// Set it with: bash scripts/wizard-app-check.sh
//
// Until the site key is set, the answering page cannot collect a token. In
// monitor that is a log line; in enforce it is a refusal — which is the
// correct failure. A public form that quietly accepted anything would be
// worse than one that does not work yet.

(function (global) {
    'use strict';

    global.MOSAIC_APP_CHECK = {
        // ⚠ MONITOR, ON PURPOSE. `mode` is the switch the answering page and
        // the server agree on (test/app-check-agreement.test.js). Values:
        //
        //   off      — do not collect a token. Server must not enforce.
        //   monitor  — collect a token; server logs missing/invalid, refuses
        //              nothing. Safe default. This is what lands with MS-508.
        //   enforce  — collect a token; server refuses a caller without one.
        //              Atlas-escalated flip — see
        //              docs/ops/ms-508-app-check-break-glass.md.
        //
        // Platform `enforceAppCheck` on publicForm stays false in every mode
        // so monitor can actually run the handler. The in-process door is
        // functions/app-check-door.js, keyed on PUBLIC_FORM_APP_CHECK_MODE
        // (default `monitor`, matching this file).
        //
        // WHY IT IS NOT ENFORCE YET. This was turned on in one step, straight
        // to enforce, and it stopped anybody answering a form for days:
        //
        //   1. Activation ran from <head>, where document.body is null. The
        //      reCAPTCHA provider throws appending its container — but only
        //      after recording a promise saying attestation has started, so
        //      every call then waited for a token that was never coming. That
        //      one is fixed: the scripts load at the end of <body>.
        //
        //   2. The phone shell served this page from capacitor://localhost,
        //      which a WEBSITE reCAPTCHA key cannot attest, and the debug-
        //      token flag was never set before activate(). That is MS-535.
        //
        //   3. Nothing in App Check gives up. When reCAPTCHA cannot finish —
        //      an ad blocker, a corporate proxy, a privacy extension —
        //      getToken() does not fail, it waits. Monitor is how we measure
        //      that cost against real traffic before charging it to strangers.
        //
        // `enabled` is true iff mode is monitor or enforce. Keep them in
        // step; the agreement test fails if they drift.
        mode: 'monitor',
        enabled: true,

        // The live HTTPS origin reCAPTCHA is registered against. The phone
        // shell serves this same fill-in page from capacitor://localhost,
        // which a WEBSITE key cannot attest — so when collection is on, the
        // answering page hops onto this origin (MS-535). Not a secret; it is
        // the public hosting URL. Trailing slashes are stripped in code.
        liveOrigin: 'https://mosaic-hymn-database.web.app',

        // Replace with the reCAPTCHA site key from the Firebase console.
        // The wizard writes it here.
        siteKey: '6Leq76UtAAAAADJc3TUWYPjG89v3tfWQT6DMvasB',

        // ⚠ WHICH KIND OF KEY THAT IS, AND IT MATTERS. Firebase App Check
        // offers two reCAPTCHA providers and they are not interchangeable:
        // an Enterprise key attested through the v3 flow simply fails, and
        // the failure looks like "the form will not load" rather than
        // anything mentioning reCAPTCHA.
        //
        // Passing a bare string to appCheck().activate() silently picks V3,
        // which is why this is named rather than inferred. Ours is Enterprise
        // (Mosaic-Manager-Forms, created in Google Cloud); set 'v3' if the key
        // ever comes from google.com/recaptcha/admin instead.
        provider: 'enterprise',
    };

    // Debug-token policy (MS-535). Never put a UUID in this file.
    //
    // On localhost the answering page sets `self.FIREBASE_APPCHECK_DEBUG_TOKEN
    // = true` *before* activate() (see app-check-client.js). The SDK prints a
    // UUID in the console; an operator pastes that into the Firebase App Check
    // debug-token list. A string token may be set in the browser console for
    // a known device (break-glass) — it is a real bypass, it is not committed,
    // and it is not how members in the phone shell get a token (they hop to
    // liveOrigin instead).
})(typeof window !== 'undefined' ? window : globalThis);
