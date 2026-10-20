# MS-769 — hymn sheet Storage prefix migration

Hymn scans used to live at the bucket root (`{hymn_name}/{file}`). MS-769
namespaces new bytes under `hymn-sheets/{hymn_name}/{file}` so `storage.rules`
can drop the `{allPaths=**}` catch-all.

## Order of operations (production)

1. **Merge and deploy** this PR (code writes to `hymn-sheets/`; rules still
   ship on merge via CI).
2. **Dry-run** the migration workflow (see PR body).
3. **Commit run** the same workflow with `--commit`.
4. **Confirm** the Hymns page loads existing sheets (Firestore URLs rewritten).
5. **Later cleanup** (separate ops run, not in this PR): delete orphaned root
   objects once logs show zero legacy URLs in `hymns` documents.

## Script

`scripts/migrate-hymn-sheets-prefix.js`

- Default: dry run (logs copies and URL rewrites only).
- `--commit` with `--project mosaic-hymn-database --i-mean-prod` applies.
- Uses Application Default Credentials (GitHub Actions deploy service account).
- Idempotent: skips pages already pointing at `hymn-sheets/…`; copies only when
  the destination object is missing.
- Does **not** delete legacy root blobs.

## Inventory

| Location | Field / path | Notes |
| --- | --- | --- |
| Firestore `hymns/{id}` | `versions[].pages[]` | String URL or `{url}`; only store of sheet links |
| `public/hymns.js` | upload/delete | Now uses `HymnSheetsCore.storageFolderFor` |
| Legacy bucket root | `{hymn_name}/*` | Orphaned after migration until cleanup |

No other collection stores hymn sheet Storage paths. Reads in the UI use the
tokenized download URL on the hymn record (ADR-0046).

## Root object cleanup (follow-up)

After the commit migration and a spot-check on Hymns:

```bash
# Example: list legacy root prefixes (manual review — hymn names are free text)
# gsutil ls gs://mosaic-hymn-database.firebasestorage.app/ | …
```

Delete only objects with **no** remaining Firestore reference. A dedicated
cleanup script is intentionally out of scope for MS-769; file a follow-up if
automation is wanted.
