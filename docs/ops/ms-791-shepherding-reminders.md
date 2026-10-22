# MS-791 — retire `shepherding_reminders`

Follow-up reminders were replaced by `shepherding_tasks` (MS-79). The app no longer reads the old collection; rules blocks are removed in code after prod data is migrated.

## Prod ops (main only)

`ms-776-backfill-account-levels.js` is already committed in prod; only run the steps below for MS-791.

1. **Migrate** (dry-run, then commit):

   ```bash
   gh workflow run "Prod ops script" --ref main \
     -f script=migrate-reminders-to-tasks.js \
     -f commit=false
   ```

   When the log shows only `moved` / `skipped` and no `left` undated rows, repeat with `commit=true`.

2. **Delete** (dry-run, then commit) — only when every reminder has a Task with `migratedFrom`:

   ```bash
   gh workflow run "Prod ops script" --ref main \
     -f script=delete-shepherding-reminders.js \
     -f commit=false
   ```

   Then `commit=true` when `canDelete` is reported.

Never delete prod data without a green dry-run. The migration script does not delete source rows; deletion is the separate allowlisted script.
