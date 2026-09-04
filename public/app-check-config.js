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
        // ⚠ OFF, ON PURPOSE, AND IT MUST MATCH THE SERVER. `enforceAppCheck`
        // on publicForm in functions/index.js is false to match, and
        // test/app-check-agreement.test.js fails if the two ever disagree.
        //
        // WHY IT IS OFF. This was turned on in one step, straight to enforce,
        // and it stopped anybody answering a form for days. Two faults, and
        // the second is the reason it is off rather than fixed:
        //
        //   1. Activation ran from <head>, where document.body is null. The
        //      reCAPTCHA provider throws appending its container — but only
        //      after recording a promise saying attestation has started, so
        //      every call then waited for a token that was never coming. That
        //      one is fixed: the scripts load at the end of <body>.
        //
        //   2. Nothing in App Check gives up. When reCAPTCHA cannot finish —
        //      an ad blocker, a corporate proxy, a privacy extension, a bad
        //      minute on a phone — getToken() does not fail, it waits. So a
        //      person who blocks trackers cannot answer a form and is shown
        //      no reason. That is not a bug to fix in our code; it is what
        //      turning this on costs, and it has to be measured before it is
        //      charged to strangers.
        //
        // Firebase's own order is monitor first, enforce once the metrics show
        // real traffic being attested. That step was skipped. Turn `enabled`
        // back on together with `enforceAppCheck`, not before, and watch the
        // App Check metrics in the console for a week in between.
        //
        // What is lost meanwhile: a script could post rubbish to a form whose
        // link it has. What is NOT lost: the link is 128 bits of base58 and
        // cannot be guessed, refusals stay uniform, and the ballot's two lists
        // still cannot be joined (ADR-0051, ADR-0052).
        enabled: false,

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
