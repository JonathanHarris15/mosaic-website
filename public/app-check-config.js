// App Check — the site key, and why it is committed in plain sight.
//
// WHAT APP CHECK IS FOR. A public form lives at an address anybody can reach;
// that is the whole point of a form for people outside the church. Nothing
// about that address says the request came from a real person on our page, so
// without this a script can hit it a thousand times a second and fill a bible
// study sign-up with rubbish. App Check has the browser collect a token
// proving it is running THIS website, and `publicForm` refuses anything that
// arrives without one (ADR-0051). Somebody filling in a form sees nothing —
// no "tick to prove you are human".
//
// ⚠ THIS KEY IS PUBLIC AND BELONGS IN THE REPO. A reCAPTCHA site key ships in
// every browser that loads the page, exactly like the Firebase apiKey in
// auth.js. It is not a secret, it is not in functions/.env, and hiding it
// would only mean a clean checkout could not answer a form. The secret half
// lives in Google's console and never comes near this repo.
//
// Set it with: bash scripts/wizard-app-check.sh
//
// Until it is set, the answering page does not activate App Check and
// `publicForm` refuses every submission — which is the correct failure. A
// public form that quietly accepted anything would be worse than one that does
// not work yet.

(function (global) {
    'use strict';

    global.MOSAIC_APP_CHECK = {
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
})(typeof window !== 'undefined' ? window : globalThis);
