# MS-508 / MS-536 — Manual verify checklist and proof template

Live Firebase submits cannot be completed in the agent environment. Automated
allow/deny is `test/app-check-door.test.js` (and `test/app-check-verify-harness.test.js`).
This file is the remainder: one real web submit, one real phone-shell submit,
one bare request. Paste the filled template onto MS-508.

## What is already proven in CI

| Mode | Token | Door |
| --- | --- | --- |
| monitor | missing/invalid | allow + log |
| monitor | valid | allow |
| enforce | missing/invalid | reject `unauthenticated` |
| enforce | valid | allow |
| off | anything | allow, no log |

Run: `node --test test/app-check-door.test.js test/app-check-verify-harness.test.js`

## Phase A — after merge, still **monitor** (safe default)

Do this on staging or prod once hosting + `publicForm` are deployed. Enforce
is **not** on. A bare request must still succeed; the signal is the log line.

1. **Web submit.** Open a published public form at the live HTTPS origin
   (not localhost). Answer it. Expect: thank-you, no spinner hang.
2. **Phone-shell submit.** From the Capacitor app, open the same form (or
   `form-answer.html?f=<id>`). The page should hop to `liveOrigin` (`https://mosaic-hymn-database.web.app/f/<id>`
   unless a custom domain is `liveOrigin`). Answer it. Expect: thank-you.
3. **Bare request (monitor).** Call `publicForm` without an App Check token
   (curl / a REST client against the callable URL, or the Functions emulator
   with no `X-Firebase-AppCheck` header). Expect: **accepted** (200 with the
   usual `{ok:false}` / form payload, not `unauthenticated`). Cloud Logging
   should show `publicForm app-check` with `appCheckToken=missing-or-invalid`
   and `appCheckReject=false`.

If web or phone fails here, **do not flip enforce.** Fix the token path
(MS-535) or the reCAPTCHA domain list (HITL console). Rollback:
`docs/ops/ms-508-app-check-break-glass.md`.

## Phase B — after Atlas-escalated **enforce** flip

Only after Phase A looks clean (token rates are real members, not a wall of
missing tokens). Set `PUBLIC_FORM_APP_CHECK_MODE=enforce` and redeploy
`publicForm`. Do **not** set platform `enforceAppCheck: true`.

1. **Web submit** again. Expect: thank-you.
2. **Phone-shell submit** again. Expect: thank-you (after the hop).
3. **Bare request (enforce).** Same unauthenticated call as Phase A.
   Expect: **rejected** (`unauthenticated` /
   "This request did not come from Mosaic's site or app."). Logging:
   `appCheckToken=missing-or-invalid`, `appCheckReject=true`.

## HITL remainder after this PR merges

- Deploy hosting + `functions:publicForm`.
- Confirm reCAPTCHA Enterprise allowed domains include `liveOrigin` and the
  custom church domain if one is attached.
- Register a localhost debug token (UUID from the console; never commit it).
- Run Phase A. Paste proof below. Note the monitor window start/end.
- Escalate via Atlas to flip enforce. Run Phase B. Paste proof below.

Live monitor window, enforce flip, and this proof are **not** done by merge.

---

## Proof template (paste onto MS-508)

```
MS-536 proof — public form App Check
Date (UTC):
Operator:
Environment: staging / prod
publicForm revision / deploy id:
App Check mode (param): monitor / enforce
liveOrigin:

Phase A (monitor)
- Web submit: PASS/FAIL
  time:
  form id (last 4 ok):
  request id / log insertId:
  notes:
- Phone-shell submit: PASS/FAIL
  device / OS:
  hopped to (URL host):
  time:
  request id / log insertId:
  notes:
- Bare request accepted + logged missing token: PASS/FAIL
  time:
  request id / log insertId:
  appCheckReject (expect false):

Monitor window: <start UTC> → <end UTC>
missing-or-invalid rate (rough):

Phase B (enforce) — only after Atlas
- Web submit: PASS/FAIL   time:   request id:
- Phone-shell submit: PASS/FAIL   time:   request id:
- Bare request rejected: PASS/FAIL
  time:
  error code (expect unauthenticated):
  request id / log insertId:
  appCheckReject (expect true):

Break-glass used? no / debug token (device named, UUID not pasted) / rolled back to monitor
```
