# MS-508 / MS-535 — App Check outage root cause

Paste this onto MS-508. Evidence is from the codebase (no live Firebase secrets
in this environment). HITL checks at the bottom are what still needs a console.

## What broke, in one sentence

Enforcement was flipped on in one step. The **website** could hang waiting for
a reCAPTCHA token that never arrived; the **phone shell** could not mint a
valid token at all. Members filling a public form were refused (or sat on a
spinner) for days, so `enforceAppCheck` was turned back off.

## Which client

| Caller | Token path then | What they saw |
| --- | --- | --- |
| Website (live HTTPS) | reCAPTCHA Enterprise site key → `firebase.appCheck().activate(provider)` | Hang, then refusal once the callable timed out or the server demanded a token |
| Website on localhost | same path; **no debug-token flag** | Cannot prove the origin; `getToken()` waits; form never answers |
| Phone shell (Capacitor) | same reCAPTCHA **website** key, but the page origin is `capacitor://localhost` / `https://localhost` | Token missing or invalid. Most likely cause of the multi-day outage for people answering *in the app* |

There is still one door (`form-answer.html` → `publicForm`). The phone was not
a second submit path; it was the same page on an origin reCAPTCHA cannot attest.

## Which key / token path

- **Site key** lives in `public/app-check-config.js` (`siteKey`). It is public
  by design (same class of value as the Firebase `apiKey`). Provider is
  **Enterprise**, not v3 — a bare string to `activate()` silently picks v3 and
  the Enterprise key then fails with no reCAPTCHA-shaped error.
- **Debug tokens** were never armed in code. Firebase only exchanges one if
  `self.FIREBASE_APPCHECK_DEBUG_TOKEN` is set **before** `activate()`. The
  wizard told a human to copy a console UUID into the Firebase console, but
  the answering page never opted into that exchange, so localhost (and the
  phone WebView) had no working fallback.
- **Native App Check** (App Attest / Play Integrity) is not initialised:
  `ios/App/App/AppDelegate.swift` and `android/.../MainActivity.java` have no
  Firebase App Check. The shell cannot mint a native token.

## What error (code-shaped; live IDs need HITL)

1. **Activation from `<head>`** (fixed earlier, still the shape of the hang):
   reCAPTCHA appends its container to `document.body`. From `<head>` that is
   null, so it throws *after* App Check has stored an “attestation is starting”
   promise. Every later callable waits forever. Console:
   `form-answer.js ran before <body> existed` / `App Check did not start`.
   Symptom: spinner, no rejection. Guard: scripts at end of `<body>` +
   `test/form-answer-browser.test.js`.
2. **Phone origin cannot attest.** `local-cache.js` already records the
   WebView origin as `capacitor://localhost`. A website reCAPTCHA key will not
   mint a token there. With `enforceAppCheck: true` the callable is refused
   (`unauthenticated` / failed App Check) or the client hangs in `getToken()`.
3. **Server/client switch mismatch.** `enabled` (hosting) and
   `enforceAppCheck` (functions) are two deploys. Enforced-not-enabled refuses
   everybody — named in `test/app-check-agreement.test.js` as “this shipped”.
4. **Stale comment.** `functions/index.js` still said “App Check is ENFORCED”
   while `enforceAppCheck: false`. Maintainers reading the door were lied to.

## Code fix in this commit (MS-535)

- Web / localhost: set the debug-token flag before `activate()` when the
  origin cannot attest, without committing any token value.
- Phone shell: hop the same fill-in page onto `liveOrigin` (hosted HTTPS)
  so reCAPTCHA can mint a real token. Not a second door.
- Named Enterprise provider unchanged. Activation still requires `<body>`.

## HITL remaining (cannot be done without Firebase console access)

- Confirm the reCAPTCHA Enterprise key’s allowed domains include the live
  hosting origin (`liveOrigin` in `app-check-config.js`) **and** the custom
  church domain if one is attached.
- Register a debug token from a localhost console print (UUID only; never
  commit it) so a developer laptop can submit during monitor.
- After monitor is on: one web submit + one phone-shell submit with a valid
  token (MS-536). Capture request ids / timestamps on this ticket.
