# MS-780 / MS-781 / MS-782 — legacy Services cleanup

After the PR that removes loose `liturgy_elements` reads, dotted-key folds, and
`seriesId` fallbacks is on **main**, run these prod-ops scripts **in order**.
Each is dry-run by default; dispatch with `commit=true` only after the log looks
right.

| Order | Script | What it does |
| --- | --- | --- |
| 1 | `migrate-inline-liturgy-elements.js` | Embeds any order still on `elementIds` + loose docs; deletes `liturgy_elements` |
| 2 | `migrate-service-dotted-keys.js` | Folds dotted top-level `services/{date}` keys into nested objects |
| 3 | `backfill-involvement-series.js` | Stamps `seriesId: sunday_service` on involvement rows missing it |

```bash
gh workflow run "Prod ops script" --ref main \
  -f script=migrate-inline-liturgy-elements.js -f commit=false
# then commit=true

gh workflow run "Prod ops script" --ref main \
  -f script=migrate-service-dotted-keys.js -f commit=false
# then commit=true

gh workflow run "Prod ops script" --ref main \
  -f script=backfill-involvement-series.js -f commit=false
# then commit=true
```

Run **1** before editors rely on orders that still only have `elementIds`. Run
**2** before any remaining dotted service fields matter (the app no longer folds
them on read). Run **3** before fairness queries that filter `seriesId`.

None of these scripts delete canonical nested fields — only loose element docs,
flat dotted key names, and the absence of `seriesId` on involvement.
