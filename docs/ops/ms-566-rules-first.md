# MS-566 — Rules-first dry_run → CLEAR → live; unlock #69

Helm lock (same **B** as MS-545 / MS-557): widen standing Actions
first, then ship through that path. No one-off
`firebase deploy --only firestore:rules` that leaves
`.github/workflows/firebase-deploy.yml` behind.

This note is the operator path after **MS-567** (the widen). Do **not**
run live deploy from a cloud-agent box. Do **not** merge PR #69 from
here. Do **not** chase Firebase secrets. Live `lastNoteAt` backfill
stays parked.

The PA `lastNoteAt` hole itself stays on **MS-530 / #69**. This branch
does not rewrite `firestore.rules`.

## Standing `--only` after the widen

```
hosting,functions:publicForm,functions:onAttendanceCreated,functions:syncAccountRankToPerson,firestore:rules
```

Documented at `docs/ops/ms-545-functions-deploy-set.md`. Workflow
display name stays `Deploy Firebase (hosting + publicForm)` so the
existing `gh workflow run` command still matches.

## 1. dry_run (plan only)

From a machine with `gh` and Actions write on this repo. Do not omit
`-f dry_run=true`: `workflow_dispatch` defaults to a live deploy.

```bash
gh workflow run "Deploy Firebase (hosting + publicForm)" --ref MS-565 -f dry_run=true
```

Then open the run under Actions and confirm the log prints:

- `targets=hosting,functions:publicForm,functions:onAttendanceCreated,functions:syncAccountRankToPerson,firestore:rules`
- `dry_run=true`
- `PUBLIC_FORM_APP_CHECK_MODE=monitor`
- `Dry run complete!`

App Check stays **monitor**. This job never writes `enforce`.

## 2. Maintain CLEAR

Paste the dry_run Actions URL on **MS-565**. Hold merge until Maintain
**CLEAR**. Do not merge. Do not live-deploy. Do not merge MS-530 /
PR #69. Do not one-off CLI deploy.

## 3. Live (after CLEAR)

Merge this PR (`MS-565` → `main`). Push to `main` deploys for real via
the standing workflow (or `workflow_dispatch` without `dry_run=true`).
That live run ships `firestore:rules` as a standing target.

This first live ships whatever `firestore.rules` is on `main` at merge
(no PA hole yet). That is the path unlock, not the #69 hole.

## 4. Proof, then unlock #69

Paste on **MS-565**:

| Proof | What to paste |
| --- | --- |
| dry_run Actions URL | Green `workflow_dispatch` on `MS-565` with `dry_run=true` |
| live Actions URL | Green push-to-`main` (or dispatch without dry_run) after CLEAR |
| Rules revision note | Live log shows `firestore:rules` in `targets=` and a rules deploy / no-op |
| #69 tip SHA | `2f12842af9a08a5c3c00c32a550acb787b9a30c5` (`2f12842`) — rules hole lives here, not on this branch |

Then comment **MS-530 / #69**: standing path now deploys
`firestore:rules`; rules are live; Maintain may **CLEAR-to-merge** #69.

#69 stays HOLD until that comment. When #69 merges, the same
push-to-`main` deploy ships Hosting and the PA `lastNoteAt` hole
together from tip `2f12842` (or the merge commit that contains it).

## Out of scope (parked)

- Live `lastNoteAt` backfill (`docs/ops/ms-530-last-note-at-backfill.md`)
- App Check enforce
- Rewriting the PA hole
- One-off CLI deploy
- Chasing Cursor / Actions Firebase secrets
