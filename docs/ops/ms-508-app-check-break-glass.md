# MS-508 / MS-534 — App Check break-glass and rollback

Paste onto MS-508. No secrets belong in this file or the ticket.

## What is live after this PR lands

The public form door (`publicForm`) **monitors** App Check by default:

- The answering page collects a token (web: reCAPTCHA Enterprise; phone
  shell: hops to `liveOrigin` then the same).
- The function **does not refuse** a missing or invalid token.
- Missing/invalid tokens are logged as `publicForm app-check` with
  `appCheckToken=missing-or-invalid`. Watch Cloud Logging / App Check metrics.
- Platform `enforceAppCheck` stays **false** so the handler can log. Enforce
  is an in-process check, not a Firebase 401-before-handler.

MS-364 rate limits (when they ship) stay complementary. They are not a
substitute for this door.

## Flip enforce (Atlas-escalated HITL — do not do this silently)

Do **not** change the code default to `enforce` in a drive-by. A clean monitor
window (web + phone token rates look like real members, not a wall of
`missing-or-invalid`) is the gate. Escalate via Atlas.

1. Confirm MS-536 manual proof is on the ticket (web submit, phone-shell
   submit, bare request still accepted under **monitor**).
2. Set the Functions param `PUBLIC_FORM_APP_CHECK_MODE=enforce` for project
   `mosaic-hymn-database` and redeploy `publicForm` only:
   `firebase deploy --only functions:publicForm --project mosaic-hymn-database`
   The param is **not** committed (see `functions/.env.*` in `.gitignore`).
   Do not put a secret in that file either.
3. Optionally set `mode: 'enforce'` in `public/app-check-config.js` so the
   committed comment matches live behaviour, then deploy hosting. The
   answering page already collects tokens in monitor, so this is docs
   alignment, not a second switch you must flip for submits to work.
4. Note the timestamp and the monitor window on MS-508.

Do **not** set `enforceAppCheck: true` on the `onCall` options. That rejects
before the handler, kills monitor, and makes rollback another code deploy.

## Rollback (forms dark again)

Goal: members can answer immediately. Security waits.

**Fastest (functions only):** set `PUBLIC_FORM_APP_CHECK_MODE=monitor` (or
`off` if collection itself is hanging pages) and redeploy `publicForm`.
Monitor refuses nothing.

**If the answering page is hanging on reCAPTCHA:** set
`mode: 'off'` and `enabled: false` in `public/app-check-config.js`, deploy
**hosting**, and keep the server on `monitor` or `off`. Two deploys; the
agreement test will fail until they match again — that failure is the
reminder to turn collection back on, not a reason to skip the rollback.

**Do not** invent a second public submit path.

## Break-glass for a known device

A debug token is a real bypass. Use it for a named laptop or a named test
phone, never as the member path.

1. On the device, open a public form on **localhost** (or a Capacitor build
   that cannot hop — `liveOrigin` missing). The page sets
   `FIREBASE_APPCHECK_DEBUG_TOKEN=true` before `activate()`.
2. Copy the UUID Firebase prints in the console. Paste it under the **web**
   app’s debug tokens in the Firebase App Check console.
3. For a one-off already-known UUID, an operator may set
   `self.FIREBASE_APPCHECK_DEBUG_TOKEN = '<uuid>'` in that browser’s console
   **before reload**. Never commit the UUID, never paste it into a screenshot
   in Slack, never put it in this repo.

Phone **members** do not get debug tokens. The shell hops onto `liveOrigin`
so reCAPTCHA attests the real site. If that hop is wrong (custom domain not
on the reCAPTCHA key), fix the key’s domains or `liveOrigin` — do not ship a
debug token in the app.

## Support contact

Escalate via **Atlas** to Jonathan (MS-508 watcher). There is no separate
pager address in this repo; do not invent one. If enforce is on and forms
are dark, rollback first, then comment the ticket with timestamps / request
ids.

## Complementary, not a replacement

- ADR-0051: one closed door, App Check on that door.
- MS-364 paid-form rate limit: still required when that Feature ships; it
  does not replace App Check.
- Out of scope: App Check on unrelated callables; building MS-271 / MS-364.
