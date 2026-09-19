# MS-545 — Standing Firebase deploy set

Locked **option B** (Jonathan via Helm): widen the standing Actions
target first, then ship through that path. No one-off
`firebase deploy --only functions:…` that leaves
`.github/workflows/firebase-deploy.yml` behind.

## Standing `--only` targets

```
hosting,functions:publicForm,functions:onAttendanceCreated,functions:syncAccountRankToPerson,functions:sendPrayerRequestNow,functions:mcp,firestore:rules
```

| Target | Why it is in the set |
| --- | --- |
| `hosting` | Church site (`mosaic-hymn-database`). App Check collection lives here. |
| `functions:publicForm` | Public form door (ADR-0051). |
| `functions:onAttendanceCreated` | Attendance rule (MS-425 / ADR-0066). Export name in `functions/index.js`. Create on `event_occurrences/{occurrenceId}/attendance/{personId}`. Without this target the Visitor → Regular Attender promotion never installs. |
| `functions:syncAccountRankToPerson` | Account Rank projection (MS-539 / MS-557). Export name in `functions/index.js`. Write on `users/{uid}` (link, unlink, permission change, delete). Without this target `people.accountRank` never updates; merging the Trade picker before it is live fail-closes existing Linked Users on non-public Trades. |
| `functions:sendPrayerRequestNow` | Service Builder "Send Prayer Request Text Now" (MS-598). Export name in `functions/index.js` (`onCall`). Without this target a Hosting merge that admits Pastoral Assistants on that button (MS-594 / #82) would show PA chrome against an elder-only deployed function. |
| `functions:mcp` | MCP HTTP surface (MS-598). Export name in `functions/index.js` (`onRequest`). Without this target a Hosting merge that admits PAs on `shep_` DECIDE tools (MS-594 / #82) would show PA chrome against a stale deployed MCP. |
| `firestore:rules` | Live `firestore.rules` (MS-565). Without this target a Hosting merge that needs a rules hole (MS-530 / #69 Pastoral Assistant `lastNoteAt`) ships writers against the old rules. `firestore:indexes` stays out of this set. |

The CLI filter uses the **export name** (`onAttendanceCreated`,
`syncAccountRankToPerson`, `sendPrayerRequestNow`, `mcp`), not a
renamed Cloud Console label. The functions codebase is `default`;
`functions:<export>` is enough. `firestore:rules` is the Firebase CLI
rules target (`firebase.json` → `firestore.rules`), not a function
export.

## App Check stays monitor

This workflow writes `PUBLIC_FORM_APP_CHECK_MODE=monitor` on every run
and never writes `enforce`. Enforce is an Atlas-escalated param flip:
`docs/ops/ms-508-app-check-break-glass.md`.

## Do not one-off around this list

Agents must not `firebase deploy` from a cloud box (AGENTS.md). Adding
another function — or `firestore:rules` — to prod means adding it here
(and to the agreement test), not a laptop CLI that skips the workflow.

## Dry-run (MS-566) — Maintain CLEAR before live

Same B path as MS-545 / MS-557. Plan only, through the **widened**
workflow. Do not omit `-f dry_run=true`: `workflow_dispatch` defaults to
a live deploy. Operator sequence (proof shape, #69 unlock) is
`docs/ops/ms-566-rules-first.md`.

From a machine with `gh` and Actions write on this repo:

```bash
gh workflow run "Deploy Firebase (hosting + publicForm)" --ref MS-565 -f dry_run=true
```

Then open the run under Actions and confirm the log prints
`targets=hosting,functions:publicForm,functions:onAttendanceCreated,functions:syncAccountRankToPerson,functions:sendPrayerRequestNow,functions:mcp,firestore:rules`
and `dry_run=true`. App Check must stay `monitor`.

Live (push to `main`, or `workflow_dispatch` without `dry_run=true`) waits
on Maintain **CLEAR**. Do not merge this branch. Do not live-deploy. Do
not merge MS-530 / PR #69. Do not one-off CLI deploy.

## Backfill (after live function install)

`syncAccountRankToPerson` only sees future `users/{uid}` writes. Existing
Linked Users stay unprojected until a one-shot backfill. After the
function is live in Firebase — not before, and not from a cloud-agent
box:

```bash
node scripts/backfill-account-rank.js            # dry run (default)
node scripts/backfill-account-rank.js --commit   # apply
```

Note the result on MS-539. Unlock merge of #67 only after live install +
this backfill are recorded there.
