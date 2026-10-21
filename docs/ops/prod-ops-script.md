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
| `migrate-hymn-sheets-prefix.js` | [MS-769 — hymn sheet prefix](./ms-769-hymn-sheets-migration.md) (empty `args`; `commit=true` to apply) |
| `textbelt-test-send.js` | [P0 prayer SMS — Textbelt smoke](./ms-prayer-sms-textbelt-reply-webhook.md) (empty `args`; `commit=true` to send one text to Jonathan Harris) |
| `reset-prayer-send-attempt.js` | [P0 prayer SMS — clear send attempt](./ms-prayer-sms-textbelt-reply-webhook.md) (`--service-date`, `--ids`) |
| `migrate-legacy-oos-prayer-carriers.js` | [MS-771 — OOS legacy prayer leaders → `carriedBy`](./ms-771-legacy-oos-audit.md) (optional `--from` / `--to`; `commit=true` to apply) |
| `delete-legacy-oos-prayer-fields.js` | [MS-771 — delete legacy prayer top-level fields](./ms-771-legacy-oos-audit.md) (empty `args`; `commit=true` to apply) |
| `merge-duplicate-person.js` | [MS-771 — merge duplicate person](./ms-771-legacy-oos-audit.md) (`--from` / `--to`; `commit=true` to apply) |
| `diagnose-storage-fill-in-upload.js` | [Storage fill-in upload diagnostic](./ms-storage-fill-in-upload-diagnostic.md) (empty `args`; read-only — never use `commit=true`) |
| `access-diff.js` | [MS-776 — account access diff](./ms-776-access-diff.md) (empty `args`; read-only — `commit=true` is ignored) |
