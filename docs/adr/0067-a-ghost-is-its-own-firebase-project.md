# ADR 0067 — The ghost is its own Firebase project, seeded with synthetic church data, never a copy of production

**Status:** Proposed (awaiting Jonathan / Helm)
**Date:** 2026-09-21
**Ticket:** MS-605
**Follows:** [ADR 0038](0038-mcp-server-hosted-on-firebase-authenticates-through-firebase-auth.md),
[ADR 0051](0051-a-public-form-is-served-and-answered-through-one-closed-door.md)

This ticket is research. Nothing here creates a second Firebase project, changes
prod config, deploys, or adds credentials. A follow-up Feature implements the
path Jonathan and Helm accept.

## Context

Jonathan (via Helm, 2026-09-21) wants a **non-production twin** of Mosaic so
the project Grok Bot can drive Cursor Cloud Agents — ship features, run
Functions, mutate data — without touching production Hosting, Functions, Rules,
or data. The same pattern may apply later to HAS. Method is a different app and
is out of scope.

Firebase's own guidance is unambiguous: **one Firebase project per
environment**, because apps in one project share Auth, Firestore, Storage,
Functions, and Hosting backends
([Overview of environments](https://firebase.google.com/docs/projects/dev-workflows/overview-environments),
updated 2026-09-17). A Hosting preview channel is a frontend URL on the *same*
project; "your web app interacts with your real backend for all project
resources"
([Test, preview, deploy](https://firebase.google.com/docs/hosting/test-preview-deploy)).
The Local Emulator Suite is for disposable local / CI work, not a shared
persistent environment
([Security guidelines](https://firebase.google.com/docs/projects/dev-workflows/general-security-guidelines)).

This repo today is a **single-project production app**. There is no ghost.

### What this codebase actually has

| Fact | Where |
| --- | --- |
| One Firebase project, alias `default` | `.firebaserc` → `mosaic-hymn-database` |
| Two Hosting *sites* in that one project | `firebase.json`: church site `mosaic-hymn-database`, MCP OAuth site `mosaic-hymn-mcp` (ADR-0038 — OAuth root paths cannot live on the church origin) |
| Leftover Hosting target, not a twin | `.firebaserc` `targets.test-site` → `mosaic-hymn-test-shifting-1` (looks like a preview-channel leftover) |
| Frontend config is compiled to prod | `public/auth.js` and `public/mobile/data.js` hardcode `projectId: "mosaic-hymn-database"` (same `apiKey` / `appId` / bucket) |
| Localhost still talks to prod | `public/auth.js`: `USE_EMULATORS = false` even when `hostname === "localhost"` |
| MCP login config is the same prod web config | `functions/index.js` `MCP_WEB_CONFIG` |
| MCP issuer default is the prod MCP site | `MCP_ISSUER_URL` default `https://mosaic-hymn-mcp.web.app`, pinned by `test/mcp-hosting.test.js` |
| SMS inbound URL is the prod Cloud Functions alias | `SMS_REPLY_WEBHOOK_URL` in `functions/index.js` |
| Storage trigger names the prod bucket | `sealEventAttachment` `bucket: "mosaic-hymn-database.firebasestorage.app"` |
| Secrets (per project) | `TEXTBELT_KEY`, `GEMINI_KEY` via `defineSecret` |
| Params (per project) | `MCP_ISSUER_URL`, `PUBLIC_FORM_APP_CHECK_MODE` (default `monitor`) |
| App Check is prod-origin | `public/app-check-config.js`: `mode: 'monitor'`, `liveOrigin: 'https://mosaic-hymn-database.web.app'`, reCAPTCHA Enterprise site key. Phone form page hops to that origin (MS-535) |
| Prod deploy is one Actions job | `.github/workflows/firebase-deploy.yml`: push to `main` (or `workflow_dispatch`) deploys `hosting` + the standing functions set + `firestore:rules` to whatever `.firebaserc` `default` is. SA from `FIREBASE_SERVICE_ACCOUNT` / `FIREBASE_SERVICE_ACCOUNT_MOSAIC_HYMN_DATABASE` |
| Standing functions set is *not* the whole backend | `docs/ops/ms-545-functions-deploy-set.md`: `publicForm`, `onAttendanceCreated`, `syncAccountRankToPerson`, `sendPrayerRequestNow`, `mcp`. Dozens of other exports (`createUser`, trades, SMS, scheduled jobs, `scoreTheme`, …) exist in `functions/index.js` and are not in that job |
| Agents must not deploy | `AGENTS.md` |
| Cursor Cloud env has no Firebase secrets | `.cursor/environment.json` lists emulator ports only; `.cursor/install.sh` is `npm ci` × 2 |
| Emulator suite exists and is used for tests | `firebase.json` emulators: Auth 9099, Functions 5001, Firestore 8080, Hosting 5005. **No Storage emulator.** Tests use throwaway `demo-mosaic-ms20` (`scripts/run-emulator-tests.mjs`) so a slip cannot write the church database |
| Seed scripts talk to prod | `scripts/seed-events.js`, `scripts/seed-elder-assignments.js`, and every `scripts/backfill-*.js` hardcode `mosaic-hymn-database` and resolve `mosaic-hymn-database-firebase-adminsdk-*.json` (`scripts/service-account.js`) |
| Phone is one flavor | Capacitor `com.mosaicmanagercstx.app` (`capacitor.config.json`, `android/app/build.gradle`). No productFlavors. No `google-services.json` in git |
| Church data is PII | `people` (name, email, phone, address, birthday), directory photos, shepherding notes, elder documents, prayer requests, form responses, Auth emails. ADR-0031 / ADR-0040 already treat a leak as a pastoral failure |

PR template "preview URL" means a Hosting preview channel **on
`mosaic-hymn-database`**. That is a frontend preview of prod, not a twin. The
hardcoded `firebaseConfig` would make even a ghost Hosting site talk to
**production Firestore** unless the config is parameterized first.

Firebase Hosting **site IDs are globally unique**. A second project cannot
reuse `mosaic-hymn-database` or `mosaic-hymn-mcp`. The ghost needs its own
two site IDs, mapped with Hosting targets.

## Decision

**Create one dedicated Firebase project (recommended id `mosaic-hymn-ghost`)
with the same *shape* as prod — Hosting (church + MCP sites), Functions,
Firestore, Auth, Storage, Rules — and point Cursor Cloud Agents at that
project only. Seed it with synthetic fixtures. Never clone production people,
notes, Auth users, or photos. Never put the prod service account in the Cloud
environment. Never let a ghost deploy retarget `mosaic-hymn-database`.**

Keep the Local Emulator Suite for what it already does well: `npm test`
skips, `npm run test:emulator` against `demo-…`, and optional laptop work.
The emulator is complementary. It is not the ghost.

Firebase names this a **development / staging** environment. We call it the
**ghost** so nobody hears "staging" and copies the congregation into it.

### Why a second project (and not the other two)

Agents need a **persistent, shared, internet-reachable** backend they can
deploy to and mutate: Hosting URLs, callable Functions, Firestore, Auth,
the MCP origin (ADR-0038), scheduled jobs, Storage triggers. Only a real
Firebase project gives all of that without sharing prod data.

A Hosting multi-site or preview channel on `mosaic-hymn-database` shares
Auth, Firestore, Storage, Functions, and billing with the church. Deploying
Rules or a trigger there *is* a prod change. Preview URLs still use the real
backend (Firebase Hosting docs, 2026-09-17). That fails the ticket.

An emulator-only ghost dies with the Cloud Agent VM, has no stable MCP
issuer, does not run Storage triggers (Storage is not even in
`firebase.json` `emulators`), and this repo already leaves localhost on prod
(`USE_EMULATORS = false`). Fine for tests. Not a place Grok can drive
Agents for a week.

### Shape of the ghost

1. **Project.** Human creates `mosaic-hymn-ghost` on Blaze (Functions
   require it; prod already pays that way). Tag it **Development** in the
   Firebase console. Same Google Cloud billing account is fine; isolation
   is the project boundary, not a second invoice.
2. **Apps.** Register a Web app. Do **not** register the store Android /
   iOS app ids against the ghost (see Phone). Optional: a debug Web /
   Android app used only by developers.
3. **Hosting sites (new global IDs).** Recommended:
   `mosaic-hymn-ghost` (church) and `mosaic-hymn-ghost-mcp` (OAuth / MCP).
   `firebase.json` should switch from hardcoded `"site"` to Hosting
   **targets** (`church`, `mcp`) so `.firebaserc` maps:

   | Alias | Project | `church` site | `mcp` site |
   | --- | --- | --- | --- |
   | `prod` (keep `default` = this) | `mosaic-hymn-database` | `mosaic-hymn-database` | `mosaic-hymn-mcp` |
   | `ghost` | `mosaic-hymn-ghost` | `mosaic-hymn-ghost` | `mosaic-hymn-ghost-mcp` |

   `test/mcp-hosting.test.js` must keep pinning **prod** issuer ↔ prod site.
   Ghost issuer is a param (`MCP_ISSUER_URL=https://mosaic-hymn-ghost-mcp.web.app`),
   never a second default that would break the prod pin.
4. **Frontend config.** One committed module (or generated file) chosen at
   **build / deploy time**, not two hand-kept copies. Today `auth.js` and
   `mobile/data.js` each embed the prod config. A ghost Hosting deploy that
   still ships those literals is a **prod-mutation bug with a ghost URL**.
   The ghost deploy must fail if the shipped `projectId` ≠ the `--project`
   being deployed to.
5. **Functions config.** Parameterize the prod literals:
   `MCP_WEB_CONFIG`, `SMS_REPLY_WEBHOOK_URL`, `sealEventAttachment` bucket,
   `MCP_ISSUER_URL` (already a param). Ghost values come from
   `functions/.env.mosaic-hymn-ghost` (gitignored, same pattern as
   `functions/.env.mosaic-hymn-database` in the prod workflow).
6. **Rules.** Same `firestore.rules` and `storage.rules` as the branch
   under test. Firebase's security guide: rules in pre-prod should match
   prod, with the caveat that the branch may be ahead.
7. **Deploy surface.** Ghost deploys **the whole backend**
   (`hosting,functions,firestore:rules,firestore:indexes,storage`) so an
   Agent can exercise `createUser`, trades, SMS *test* paths, scheduled
   converters, `scoreTheme`, and anything not in the MS-545 standing set.
   Prod stays on the standing set and the existing `main` workflow.
8. **Cursor Cloud.** A Cloud Environment that holds **only** a ghost
   service account (e.g. `FIREBASE_SERVICE_ACCOUNT_GHOST`). No prod SA.
   `AGENTS.md` then allows `firebase deploy --project mosaic-hymn-ghost`
   and still forbids `mosaic-hymn-database`. Install stays `npm ci`; it
   does not start emulators or deploy.

### Seed: synthetic fixtures, not a church clone

Firebase: development data "should never contain any real users' data";
staging "you shouldn't use actual user data"
([Overview of environments](https://firebase.google.com/docs/projects/dev-workflows/overview-environments)).

Mosaic's collections that must **not** be copied from prod:

- `people` and subcollections (`shepherding_notes`, `shepherding_activity`,
  `prayer_requests`, `away`, `involvement`, pastoral-prayer history)
- `users`, Auth accounts, `directory_requests`
- `elder_documents`, `elder_document_structure`, `families`, `households`
- `form_responses`, `form_ledger`, event `attachments` / Storage
  `people_photos/` and `event_attachments/`
- `sms_messages`, `sms_test_replies` (real numbers)

**Do this instead:** a committed, idempotent seed script that writes a
small fake congregation — enough graph for the app to feel real:

- ~20–40 People (Visitor through Previous Member, plus Inactive), fake
  names, `+1555…` phones, `*@example.test` emails, invented addresses
- Households / families, a few Relationships, Shepherding Tags (including
  the projected Membership / Elder tags)
- Users at every Permission Level plus one Pastoral Assistant, known
  passwords (test-only), linked to People
- Sunday Service series (`scripts/seed-events.js` already knows this
  reconcile — retarget it), a handful of Events, occurrences, attendance,
  assignments, one Trade
- A few hymns, one Service with liturgy, one public Form, one elder Form,
  one Printable, a couple of Shepherding Notes / Tasks / Elder Documents
- Dummy Storage objects (not real directory photos)

Auth: **create** those test accounts on the ghost. Do not import prod
password hashes or congregation emails. Anonymous sign-in can stay off on
the ghost (prod has it on; rules already reject it via `isSignedIn()`).

**Rejected seed modes**

| Mode | Why not |
| --- | --- |
| Nightly prod → ghost sync | Copies PII onto a project Agents will smash; logs, traces, and MCP sessions would hold church data |
| One-shot anonymized clone | Possible later as a *human-only* ops script, but names, notes, and photos are not anonymizable by stripping a field or two. Do not build it in v1 |
| Empty project | The app is relationship-shaped (People, Roles, Events, Track). An empty ghost does not behave like Mosaic |

Re-seed is a wipe + seed, allowed on ghost, never on prod. Scripts that
today assume `mosaic-hymn-database` must require an explicit `--project`
and refuse prod unless a human passes a loud flag (`--i-mean-prod`).

### Secrets and App Check on the ghost

| Item | Ghost | Prod |
| --- | --- | --- |
| `TEXTBELT_KEY` | A **different** key, or a dummy that cannot send. Prefer unset + keep `app_config/prayer_request_sms.autoSendEnabled` false (the hourly job already no-ops). `smsSendTest` / `sendPrayerRequestNow` must not be able to text a real number | Existing prepaid key. Do not copy into ghost |
| `GEMINI_KEY` | Separate key with its own quota (theme embeddings). Same Google Cloud project is not required | Existing |
| `MCP_ISSUER_URL` | `https://mosaic-hymn-ghost-mcp.web.app` (no trailing slash) | `https://mosaic-hymn-mcp.web.app` |
| `PUBLIC_FORM_APP_CHECK_MODE` | `off` until someone is testing the door. Then `monitor`. Never `enforce` on ghost unless a ghost reCAPTCHA key exists | `monitor`; enforce is Atlas-escalated (`docs/ops/ms-508-app-check-break-glass.md`) |
| App Check site key / `liveOrigin` | Ghost church origin, or collection disabled | Current Enterprise key + `mosaic-hymn-database.web.app` |
| Debug tokens | Allowed on ghost | Operator-only, not committed |
| Service account | Ghost-only JSON, Cloud env + ghost workflow | GitHub Actions only. Never in `.cursor/environment.json` |
| Analytics | Off (Firebase: do not pollute prod Analytics from pre-prod) | Existing `measurementId` |

Scheduled functions will install on the ghost if Agents deploy `functions`
wholesale. That is intended (`convertConfirmedAssignments` should run on
fake Sundays). The SMS sender is the one that can leave the building:
dummy Textbelt + kill switch **before** the first ghost deploy.

### Phone builds

**No Play Store / App Store ghost flavor in v1.** Agent work is the web
app and MCP. The phone is a Capacitor shell over `public/` with one
`applicationId` and the same hardcoded config. A store twin would put a
second app in elders' pockets and still need a ghost `google-services.json`.

Later, if a person wants to tap through a change: a **debug** Android
build (not a store flavor) that points at ghost config, distributed with
Firebase App Distribution — Firebase's own pre-prod advice. Do not
register `com.mosaicmanagercstx.app` on the ghost; a mis-built release
would then talk to the ghost or, worse, a debug key would ship in a
release that still says it is prod.

The form-answer hop to `liveOrigin` (MS-535) is a prod-origin hop. On a
ghost web origin, leave App Check `off` so the phone is not required.

### Cost

Ballpark, not a quote. Church-scale Firestore + Hosting on a second
Blaze project is typically **single-digit to low tens of USD / month**
if Agents are not running tight write loops. The real spend risks are
not Firestore:

- **Gemini** embeddings (`scoreTheme`, MCP theme tools) — separate key,
  quota alert
- **Textbelt** — do not share the prod prepaid key
- **Functions** — no `minInstances: 1` today (ADR-0038); keep it that
  way on ghost. Hourly `sendPrayerRequestTexts` is cheap if it no-ops
- **Storage + App Check Enterprise** — skip or keep tiny on ghost

Set a Cloud Billing budget alert on `mosaic-hymn-ghost` the day it is
created. Tag prod **Production** in the Firebase console so the two
projects cannot be mistaken for each other.

### Who may promote ghost → prod

**Nobody promotes data. Code promotes through `main`.**

- Agents commit on a branch, open a PR, deploy **ghost** to prove it.
- Maintain review (existing Cursor pass) + human merge to `main`.
- Only `.github/workflows/firebase-deploy.yml` deploys prod, and only
  from `main` (or an explicit `workflow_dispatch` on that workflow).
- That workflow must **pin** `mosaic-hymn-database` as a literal, not
  read `.firebaserc` `default` (it does that today — a default flip
  would silently retarget prod).
- Ghost gets its **own** workflow (or a job with a hardcoded
  `mosaic-hymn-ghost` and a ghost-only secret). If the resolved project
  id is `mosaic-hymn-database`, the job fails.
- Do not `firebase hosting:clone` ghost → prod live as the ship path.
  Hosting clone can cross projects; that is a footgun, not a pipeline.
- Do not copy ghost Firestore into prod. Ever.

Jonathan / Helm (or whoever already merges Mosaic) are the promoters.
Agents do not merge `main` and do not hold the prod SA.

## Rejected alternatives

### A. Multi-site Hosting / preview channels on `mosaic-hymn-database`

We already have two sites and a leftover `test-site` target. Adding
`mosaic-hymn-ghost` as a third site on the **same** project would give
Agents a second URL and the **same** Firestore, Auth, Storage, and
Functions. Rules deploys and triggers are project-wide. Preview channels
are documented to use the real backend. The PR template already treats
"preview" as a prod-project Hosting channel. That is the opposite of
isolation.

Use preview channels later **on the ghost project** if two Agents need
two frontends against the same fake church.

### B. Emulator-only ghost (Cursor Cloud ports already listed)

Right for unit / emulator tests (`demo-mosaic-ms20`). Wrong as the only
twin: ephemeral, no public MCP issuer, no Storage emulator, scheduled
and App Check behavior diverge, and `auth.js` does not connect to
emulators unless someone flips a flag that today is `false`. Firebase
reserves the emulator for disposable single-person / CI environments.
Keep it. Do not make it the Grok/Agent target.

### C. Second project + production data clone

Matches infrastructure and fails pastoral care. Shepherding notes, phone
numbers, addresses, and directory photos would sit on a project whose
purpose is "mutate freely" and whose logs Agents paste into chats. GDPR /
church-data risk, and a Textbelt slip would SMS the congregation from
the ghost. Firebase says pre-prod must not hold real user data.

### D. Shared secrets / shared service account "for convenience"

A ghost that can deploy with the prod SA *is* prod. A ghost that sends
SMS with `TEXTBELT_KEY` *is* the church's phone bill and the members'
inboxes. Separate keys, or the twin is a lie.

### E. Store-listed phone flavor

See Phone. Cost and confusion, no Agent need in v1.

## Follow-up tickets (file after this ADR is accepted)

These are the implementation Features this research is meant to unlock.
Do not start them from this PR.

1. **Parameterize project config + fail-closed deploy guards** (code
   only, still one Firebase project). One config module for
   `auth.js` / `mobile/data.js` / `MCP_WEB_CONFIG`; Hosting targets in
   `firebase.json`; pin prod project id in
   `firebase-deploy.yml`; scripts require `--project`; add a check that
   shipped `projectId` matches `--project`. No ghost project yet.
2. **Provision `mosaic-hymn-ghost` (human).** Console: project, Blaze,
   two Hosting sites, Auth email/password, App Check left off, budget
   alert, ghost SA, `GEMINI_KEY` / dummy `TEXTBELT_KEY`,
   `MCP_ISSUER_URL`. Not an Agent task.
3. **Synthetic seed + ghost deploy path + Cloud env.** Seed script,
   ghost Actions workflow (refuses prod), Cursor Environment with
   ghost-only SA, `AGENTS.md` permission to deploy ghost only.
4. **HAS ghost** (later, same pattern). Out of scope until Mosaic ghost
   has been used.

## Consequences

**Accepted now (this PR):** the written path. Prod is untouched.

**If accepted and built:** Agents can deploy and break a fake church.
Prod ship stays `main` + the standing workflow. The cost is a second
Blaze project, a seed to maintain when the domain model grows, and the
config work in ticket 1 — which this repo needs anyway: localhost and
Hosting previews already hit prod because the config cannot point
anywhere else.

**HAS / Method:** HAS can copy the pattern (own project, synthetic seed,
own MCP site if it has one). Method is a desktop app and is not this
shape.

## Out of scope

Implementing the ghost. Creating the Firebase project. Changing
`firebase.json` / `.firebaserc` / workflows in this PR. Adding
credentials. Cloning prod. A Method twin. A HAS twin beyond the note
above.
