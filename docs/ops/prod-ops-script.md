# Prod ops scripts (GitHub Actions)

Some one-off Firestore or Admin SDK jobs are too sensitive to run from an
agent VM. The **Prod ops script** workflow runs an explicit allowlist of
`scripts/*.js` against **`mosaic-hymn-database`** using the same service
account as [Deploy Firebase (hosting + publicForm)](../../.github/workflows/firebase-deploy.yml)
(`FIREBASE_SERVICE_ACCOUNT`, or `FIREBASE_SERVICE_ACCOUNT_MOSAIC_HYMN_DATABASE`).

## When to use it

- You need prod credentials but not a full deploy.
- The script already supports `--project mosaic-hymn-database --i-mean-prod`
  and dry-run vs `--commit` (same pattern as other `scripts/` ops tools).

## Dispatch (main only)

From GitHub **Actions → Prod ops script → Run workflow**, branch **`main`**.

| Input | Meaning |
| --- | --- |
| **script** | Allowlisted basename under `scripts/` (see `scripts/prod-ops-allowlist.js`). |
| **args** | Extra flags passed to the script after the pinned prod flags. No shell: metacharacters `; & \| \` $(` and newlines are rejected. |
| **commit** | Default `false` (dry-run). When `true`, the runner appends `--commit`. |

The runner always prepends:

```text
--project mosaic-hymn-database --i-mean-prod
```

Full stdout is printed in the job log and copied into the job summary.

### CLI equivalent

```bash
gh workflow run "Prod ops script" --ref main \
  -f script=<allowlisted-script.js> \
  -f 'args=...' \
  -f commit=false
```

## Adding a script

1. Implement the script under `scripts/` with `--project`, `--i-mean-prod`,
   and dry-run / `--commit` semantics consistent with the other ops tools.
2. Add its basename to `scripts/prod-ops-allowlist.js`.
3. Add the same basename to `inputs.script.options` in
   `.github/workflows/prod-ops-script.yml`.
4. Document the intended dispatch `args` in the ticket’s `docs/ops/` note.

## Allowlisted scripts

| Script | Ops note |
| --- | --- |
| `set-liturgy-order-flags.js` | [MS-770 — Textbelt order flag](./ms-770-textbelt-order-flag.md) (`--list`, `--name-match`, `--id`, `--ops` / `--hidden`) |

<!-- MS-769: row for hymn-sheet migration script when that lands. -->
