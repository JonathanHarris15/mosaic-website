# MS-545 — Standing Firebase deploy set

Locked **option B** (Jonathan via Helm): widen the standing Actions
target first, then ship through that path. No one-off
`firebase deploy --only functions:…` that leaves
`.github/workflows/firebase-deploy.yml` behind.

## Standing `--only` targets

```
hosting,functions:publicForm,functions:onAttendanceCreated,functions:syncAccountRankToPerson,functions:sendPrayerRequestNow,functions:mcp,functions:notificationOverview,functions:notificationHistory,functions:notificationRevokeToken,functions:notificationTestPush,firestore:rules
```

| Target | Why it is in the set |
| --- | --- |
| `hosting` | Church site (`mosaic-hymn-database`). App Check collection lives here. |
| `functions:publicForm` | Public form door (ADR-0051). |
| `functions:onAttendanceCreated` | Attendance rule (MS-425 / ADR-0066). Export name in `functions/index.js`. Create on `event_occurrences/{occurrenceId}/attendance/{personId}`. Without this target the Visitor → Regular Attender promotion never installs. |
| `functions:syncAccountRankToPerson` | Account Rank projection (MS-539 / MS-557). Export name in `functions/index.js`. Write on `users/{uid}` (link, unlink, permission change, delete). Without this target `people.accountRank` never updates; merging the Trade picker before it is live fail-closes existing Linked Users on non-public Trades. |
| `functions:sendPrayerRequestNow` | Service Builder "Send Prayer Request Text Now" (MS-598). Export name in `functions/index.js` (`onCall`). Without this target a Hosting merge that admits Pastoral Assistants on that button (MS-594 / #82) would show PA chrome against an elder-only deployed function. |
| `functions:mcp` | MCP HTTP surface (MS-598). Export name in `functions/index.js` (`onRequest`). Without this target a Hosting merge that admits PAs on `shep_` DECIDE tools (MS-594 / #82) would show PA chrome against a stale deployed MCP. |
| `functions:notificationOverview` | Push notifications tab (MS-682). Export name in `functions/index.js` (`onCall`). The tab's only opening read: the send-path constants, the registry with its counts, and **the device list**. **This is the only way masked Device tokens reach a browser** — `users/{uid}/push_tokens` stays owner-only in the rules (ADR-0036) and this reads it with the Admin SDK. Without this target the tab falls back to its offline registry and says so. |
| `functions:notificationHistory` | Push notifications tab (MS-682). Export name in `functions/index.js` (`onCall`). Paged, filtered read of `notifications`. |
| `functions:notificationRevokeToken` | Push notifications tab (MS-682). Export name in `functions/index.js` (`onCall`). Deletes one device token. Admin-gated, and refused without `confirm: true`. |
| `functions:notificationTestPush` | Push notifications tab (MS-682). Export name in `functions/index.js` (`onCall`). Pushes to the **caller's own** devices only; the address is `request.auth.uid` and the only payload field read is `confirm`. |

There is deliberately **no** `functions:notificationDevices`. The device list
rides on `notificationOverview` because on the server both halves are the same
two reads — every Device token, and thirty days of the log. A second callable
meant opening the tab did each of them twice.
| `firestore:rules` | Live `firestore.rules` (MS-565). Without this target a Hosting merge that needs a rules hole (MS-530 / #69 Pastoral Assistant `lastNoteAt`) ships writers against the old rules. `firestore:indexes` stays out of this set. |

### MS-682 did not need `firestore:indexes`, and did not take a rules hole

Worth saying plainly, because the ticket allowed for both. The Push
notifications tab reads `notifications` ordered by `createdAt` alone and
filters the page in the function, so every query it makes is served by
Firestore's automatic single-field indexes. Nothing was added to
`firestore.indexes.json`, and `firestore:indexes` stays out of this set.

`firestore.rules` is likewise unchanged: the owner-only rule on
`users/{uid}/push_tokens` is what the callables exist to work around, not
something to widen. The `firestore:rules` target above is the standing one
from MS-565.

Ship order still matters. These five functions must be live **before** the
Hosting that calls them, which the single workflow run already guarantees —
`firebase deploy` installs functions before hosting in one invocation. Do not
split them across two runs.

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

## Dry-run (MS-600) — Maintain CLEAR before live

Same B path as MS-545 / MS-557 / MS-565. Plan only, through the
**widened** workflow. Do not omit `-f dry_run=true`: `workflow_dispatch`
defaults to a live deploy. Operator sequence (proof shape, #82 unlock)
is `docs/ops/ms-600-prayer-mcp-first.md`.

From a machine with `gh` and Actions write on this repo:

```bash
gh workflow run "Deploy Firebase (hosting + publicForm)" --ref MS-598 -f dry_run=true
```

Then open the run under Actions and confirm the log prints
`targets=hosting,functions:publicForm,functions:onAttendanceCreated,functions:syncAccountRankToPerson,functions:sendPrayerRequestNow,functions:mcp,functions:notificationOverview,functions:notificationHistory,functions:notificationRevokeToken,functions:notificationTestPush,firestore:rules`
and `dry_run=true`. App Check must stay `monitor`.

Live (push to `main`, or `workflow_dispatch` without `dry_run=true`) waits
on Maintain **CLEAR**. Do not merge this branch. Do not live-deploy. Do
not merge MS-594 / PR #82. Do not one-off CLI deploy.

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
