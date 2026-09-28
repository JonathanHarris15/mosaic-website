# MS-683 — Cloud Functions on Node.js 22

The MS-682 deploy on 2026-09-25 warned:

> Runtime Node.js 20 was deprecated on 2026-04-30 and will be
> decommissioned on 2026-10-30, after which you will not be able to
> deploy without upgrading.

That is not a soft landing. Already-deployed functions keep serving, but
`firebase deploy` **refuses** after the date, so every target in
`docs/ops/ms-545-functions-deploy-set.md` becomes unshippable at once —
including whatever hotfix you were trying to ship that morning.

## What moved

| Thing | Was | Now |
| --- | --- | --- |
| `functions/package.json` `engines.node` | `20` | `22` |
| `functions/` `firebase-functions` | 7.1.1 | 7.4.0 |
| `functions/` `firebase-admin` | 13.6.0 | 13.10.0 |
| root `firebase-admin` | 13.6.0 | 13.10.0 |
| `node-version` in all four workflows | `"20"` | `"22"` |

The standing `--only` deploy set is **unchanged**. So is `firestore.rules`,
`storage.rules`, and every line of function code.

`nodejs22` is GA in firebase-tools' own runtime table, deprecated
2027-04-30 and decommissioned 2028-10-31 — so this buys real runway
rather than the next cliff.

## The runtime lives in exactly one place

The CLI reads `runtime` from `firebase.json` **first** and only falls back
to `functions/package.json` `engines.node`
(`firebase-tools/lib/deploy/functions/runtimes/node/parseRuntimeAndValidateSDK.js`).
Setting both would be two places to disagree, and the loser is silent — no
warning names the value it ignored. So there is deliberately **no**
`runtime` key in `firebase.json`; `engines.node` is the only statement of
it, and it is also what `npm ci` enforces locally.

`test/functions-node-runtime.test.js` is the guard. It holds four things
together and fails loudly rather than skipping:

- `engines.node` names a runtime firebase-tools still knows;
- that runtime is not decommissioned;
- it has more than 90 days before its decommission date;
- every `node-version:` in `.github/workflows/*.yml` equals `engines.node`;
- a `runtime` key in `firebase.json`, if anyone adds one, agrees with it.

The 90-day runway check is the part that matters. Run against the old
values it fails with *"Node.js 20 stops accepting deploys on 2026-10-30"*,
which is the warning MS-683 needed and did not get. It will now fire on
2028-08-02 for Node 22, on an ordinary PR, months before anything breaks.

## Evidence the deploy still works

There is no deploy from an agent box (AGENTS.md), so the check is the
CLI's own discovery step — the thing that runs before every deploy and
decides what to ship:

```bash
cd functions
FUNCTIONS_CONTROL_API=true \
  GCLOUD_PROJECT=demo-ms683 \
  FIREBASE_CONFIG='{"projectId":"demo-ms683"}' \
  MCP_ISSUER_URL=https://mosaic-hymn-mcp.web.app \
  PUBLIC_FORM_APP_CHECK_MODE=monitor \
  FUNCTIONS_MANIFEST_OUTPUT_PATH=/tmp/manifest.json \
  node node_modules/firebase-functions/lib/bin/firebase-functions.js .
```

Run on `origin/main` and on this branch, the two manifests are
**byte-identical** after a key sort: the same 54 endpoints, the same
trigger config, the same four declared params (`TEXTBELT_KEY`,
`GEMINI_KEY`, `MCP_ISSUER_URL`, `PUBLIC_FORM_APP_CHECK_MODE`). All nine
functions in the deploy set are present. The only thing the upgrade
changes at deploy time is `nodejs20` → `nodejs22`.

## Why firebase-admin stays on v13

`firebase-admin@14` is **not** needed for Node 22 and was deliberately not
taken here.

v13.10.0 supports Node 22 outright — v13 deprecated Node 18 and 20, so 22
is the version it targets. It is also enough to clear the security debt:
the functions tree goes from **33 advisories (3 critical, 11 high, 17
moderate, 2 low) to 10 moderate**, with nothing critical or high left. The
10 that remain are transitive under `@google-cloud/firestore`,
`@google-cloud/storage` and `firebase-functions-test`.

What v14 costs is the whole legacy namespace. `require("firebase-admin")`
in v14 exports only `initializeApp`, `getApp(s)`, `deleteApp`, `cert`,
`applicationDefault`, `refreshToken` and the error types. Gone from the
default export: `admin.firestore()`, `admin.firestore.FieldValue`,
`admin.firestore.Timestamp`, `admin.firestore.FieldPath`, `admin.auth()`,
`admin.storage()`, `admin.messaging()`, `admin.apps`,
`admin.credential.cert`. Every one is in use here — roughly 200 call sites
across ~65 files, 107 of them in `functions/index.js` alone, and ~50 more
in the one-off production data scripts under `scripts/` (backfills,
merges, cleanups) which have no test coverage and write to the church
database.

Bundling that rewrite into the runtime move would have made a green CI a
much weaker claim right when the deadline made the claim matter. The
runtime change is provably inert — the deploy manifest does not move at
all — and a v14 migration is not. They are separate pieces of work and
should be separate tickets.

**Follow-up:** file a ticket for the `firebase-admin` v14 modular-API
migration. It is mechanical (`admin.firestore()` → `getFirestore()` from
`firebase-admin/firestore`, and so on for each namespace), but it is broad
and the `scripts/` half is destructive if it is got wrong. Worth splitting
`functions/` from `scripts/` — only `functions/` is deployed, and the root
`firebase-admin` is dev tooling.
