# MS-731 — Restore hymns onto live Standard Liturgy Order ids

## What happened

The live `liturgy_orders/standard` document was re-composed with new hymn
element ids (`hymn2`, `hymn6`, `hymn7`, `hymn`, `hymn3`, `hymn4`, `hymn5`).
Sundays kept hymn values under the seed ids (`preparatoryHymn`, `hymn1`,
`hymn2`, `hymnMid1`, `hymnMid2`, `hymnEnd1`, `hymnEnd2`). The Order of Service
only shows the live ids, so hymns disappeared from the UI. `hymn2` collides:
live = Preparatory Hymn; legacy = Hymn 2.

## Mapping

| Legacy | Live |
| --- | --- |
| `preparatoryHymn` | `hymn2` |
| `hymn1` | `hymn6` |
| `hymn2` | `hymn7` |
| `hymnMid1` | `hymn` |
| `hymnMid2` | `hymn3` |
| `hymnEnd1` | `hymn4` |
| `hymnEnd2` | `hymn5` |

Legacy keys stay. `decidedBy` / `notes` move with the value when present.

## Run

```bash
# Dry run (default)
node scripts/migrate-legacy-hymns-to-live-order.js \
  --project mosaic-hymn-database --i-mean-prod

# Apply
node scripts/migrate-legacy-hymns-to-live-order.js \
  --project mosaic-hymn-database --i-mean-prod --commit
```

Planner: `public/liturgy-hymn-migrate-core.js`. Tests:
`test/liturgy-hymn-migrate-core.test.js`.

## Counts

Recorded when the agent ran the recovery (2026-10-12). Sample plans:
`docs/ops/ms-731-hymn-migrate-dry-summary.json`.

| Pass | Sundays to write | Unchanged | Field writes |
| --- | --- | --- | --- |
| Dry run | 171 | 37 | 1276 |
| Commit | _(fill after apply)_ | | |
| Second dry run | _(expect 0)_ | | |

### Spot checks (dry run)

- **2026-09-13:** preparatory `'Tis So Sweet…` (was wrongly showing Jesus! What a Friend); all six other hymns restored from legacy.
- **2026-10-04:** preparatory `Rock of Ages` (was O Lord, My Rock…); six others restored.
- **2026-10-11:** only preparatory corrected to `Come, Thou Fount…` (other live slots already matched).
