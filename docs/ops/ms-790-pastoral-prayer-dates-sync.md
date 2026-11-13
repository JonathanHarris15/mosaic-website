# MS-790 — pastoral prayer date cache sync

`people.lastPastoralPrayerDate` is a cache of the newest date in
`pastoral_prayer_history`. Older writers stored the sentinel `0000-00-00` for
"never"; the app now normalizes that on read and writes `null`.

This script rebuilds every Person's cache from history (including clearing the
field when history is empty) and normalizes legacy sentinels to `null`.

## Prod ops script

From `main` after the MS-790 change ships:

| Step | `script` | `args` | `commit` |
| --- | --- | --- | --- |
| Dry-run | `sync-pastoral-prayer-dates.js` | *(empty)* | `false` |
| Apply | `sync-pastoral-prayer-dates.js` | *(empty)* | `true` |

```bash
gh workflow run "Prod ops script" --ref main \
  -f script=sync-pastoral-prayer-dates.js \
  -f commit=false
```

Review corrections in the log, then dispatch with `commit=true`.
