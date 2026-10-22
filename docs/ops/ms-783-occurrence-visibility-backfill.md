# MS-783 — occurrence visibility backfill

Occurrence documents written without `visibility` match no Firestore read rule
(`stampedVisibility()` answers `none`). They are invisible on every surface, and
`restampSeriesVisibility` cannot query them because it filters on `visibility`.

New creates stamp visibility. This script repairs existing rows with admin
credentials.

## Prod ops script

From `main` after the MS-783 change ships:

| Step | `script` | `args` | `commit` |
| --- | --- | --- | --- |
| Dry-run | `backfill-occurrence-visibility.js` | *(empty)* | `false` |
| Apply | `backfill-occurrence-visibility.js` | *(empty)* | `true` |

```bash
gh workflow run "Prod ops script" --ref main \
  -f script=backfill-occurrence-visibility.js \
  -f commit=false
```

Review the log. When the count to stamp is acceptable (or zero), dispatch again
with `commit=true`.

Occurrences with no `seriesId` are listed and skipped; set those by hand.
