# Local patch: firebase-auth-compat.js

`firebase-auth-compat.js` (Firebase 9.6.1) has one intentional local edit:

    popupRedirectResolver:n   →   popupRedirectResolver:void 0

## Why
On iOS (Capacitor / WKWebView) the origin is `capacitor://localhost`, which
Firebase cannot authorize. The popup/redirect resolver loads a gapi iframe from
apis.google.com that can never complete its handshake against that origin, so
Firebase Auth initialization hangs forever and `signInWithEmailAndPassword`
never resolves — the app signs in but no data loads.

We only use email/password auth (no OAuth popup/redirect), so removing the
resolver is a no-op on web and Android and unblocks iOS.

## Caution
If you ever re-download / re-vendor the Firebase compat SDK, RE-APPLY this edit
or iOS auth will silently hang again. The repo `npm run vendor` script does NOT
touch Firebase, so normal vendoring is safe.
