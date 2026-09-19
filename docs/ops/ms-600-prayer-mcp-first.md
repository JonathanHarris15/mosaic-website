# MS-600 — Prayer + MCP dry_run → CLEAR → live; unlock #82

Helm lock **A** (same class as MS-545 / MS-557 / MS-565): widen
standing Actions first, then ship through that path. No one-off
`firebase deploy --only functions:sendPrayerRequestNow` or
`functions:mcp` that leaves `.github/workflows/firebase-deploy.yml`
behind. Not Hosting-first. Not prayer-only.

This note is the operator path after **MS-599** (the widen). Do **not**
run live deploy from a cloud-agent box. Do **not** merge PR #82 from
here. Do **not** chase Firebase secrets.

The PA admit itself stays on **MS-594 / #82**. This branch does not
change product, UI, AccessCore, or prayer admit logic.

## Standing `--only` after the widen

```
hosting,functions:publicForm,functions:onAttendanceCreated,functions:syncAccountRankToPerson,functions:sendPrayerRequestNow,functions:mcp,firestore:rules
```

Documented at `docs/ops/ms-545-functions-deploy-set.md`. Workflow
display name stays `Deploy Firebase (hosting + publicForm)` so the
existing `gh workflow run` command still matches.

## 1. dry_run (plan only)

From a machine with `gh` and Actions write on this repo. Do not omit
`-f dry_run=true`: `workflow_dispatch` defaults to a live deploy.

```bash
gh workflow run "Deploy Firebase (hosting + publicForm)" --ref MS-598 -f dry_run=true
```

Then open the run under Actions and confirm the log prints:

- `targets=hosting,functions:publicForm,functions:onAttendanceCreated,functions:syncAccountRankToPerson,functions:sendPrayerRequestNow,functions:mcp,firestore:rules`
- `dry_run=true`
- `PUBLIC_FORM_APP_CHECK_MODE=monitor`
- `Dry run complete!`

App Check stays **monitor**. This job never writes `enforce`.

## 2. Maintain CLEAR

Paste the dry_run Actions URL on **MS-598**. Hold merge until Maintain
**CLEAR**. Do not merge. Do not live-deploy. Do not merge MS-594 /
PR #82. Do not one-off CLI deploy.

## 3. Live (after CLEAR)

Merge this PR (`MS-598` → `main`). Push to `main` deploys for real via
the standing workflow (or `workflow_dispatch` without `dry_run=true`).
That live run ships `functions:sendPrayerRequestNow` and `functions:mcp`
as standing targets.

This first live ships whatever those exports are on `main` at merge
(no PA admit yet). That is the path unlock, not the #82 Hosting merge.

## 4. Proof, then unlock #82

Paste on **MS-598**:

| Proof | What to paste |
| --- | --- |
| dry_run Actions URL | Green `workflow_dispatch` on `MS-598` with `dry_run=true` |
| live Actions URL | Green push-to-`main` (or dispatch without dry_run) after CLEAR |
| Function revision note | Live log shows both `functions:sendPrayerRequestNow` and `functions:mcp` in `targets=` and a create/update for each |
| #82 tip SHA | `999ca5cf4a92e0b01d004c75f78cc2808e5e7c45` (`999ca5c`) — PA admit lives here, not on this branch |

Then comment **MS-594 / #82**: standing path now deploys
`sendPrayerRequestNow` and `mcp`; both are live; Maintain may
**CLEAR-to-merge** #82.

#82 stays HOLD until that comment. When #82 merges, the same
push-to-`main` deploy ships Hosting and the PA admit together from tip
`999ca5c` (or the merge commit that contains it).

## Out of scope (parked)

- MS-594 product / UI / AccessCore / prayer admit logic
- App Check enforce
- One-off CLI deploy
- Chasing Cursor / Actions Firebase secrets
- Widening any other functions
