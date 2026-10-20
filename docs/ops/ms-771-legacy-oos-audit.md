# MS-771 — Legacy OOS prayer leaders audit

Jonathan directive (Oct 2026): remove legacy Order-of-Service assignee paths that
override liturgy-order `carriedBy` per-item leaders (e.g. **Prayer Leader (Praise)**
nested under a scripture row while `prayerOfPraise` uses `carriedBy`).

## Root cause (Luke Metcalf / Colin Beers class)

| Layer | What happened |
| --- | --- |
| **Data** | Prod had duplicate `people` for Colin Beers (`Rqu2n9V9vRBLF8TKkEwg` active, `qBZMVskmS1CBJl8aCPcT` inactive duplicate). |
| **Legacy UI** | `prayerPraiseId` / `prayerConfessionId` top-level fields + `legacyPrayerHomes` drew **Prayer Leader (Praise/Confession)** under `callToWorship` / `callToConfession` scripture rows. |
| **New model** | Prayer elements with `prayedByOther` use `carriedBy.<elementId>` (e.g. `prayerOfPraise`, `prayerOfConfession`). |
| **Picker** | Full-registry search could list inactive duplicate; fixed via `people-picker-core.js` (dedupe + assignable filter). |

## Removed in this PR (code)

### Web — Service Builder (`public/service-builder.js`, `.html`)

- `showsPraise` / `showsConfession` / `legacyHomes` / `legacyPrayerHomes` nesting.
- Nested **Prayer Leader (Praise)** and **(Confession)** blocks under scripture rows.
- In-memory `service.prayerPraise` / `service.prayerConfession` editor fields and save flatten keys.
- Involvement sync for top-level prayer fields → `_syncPrayerLeaderInvolvement` from `carriedBy` (+ legacy read fallback until migrated).
- **Read path (removed post-migration):** was `hydrateCarriedByFromLegacy` until prod migration completed; runtime no longer reads legacy fields.

### Web — Service Calendar (`public/service-calendar.js`, `.html`)

- Planning inline edit for `prayerPraiseName` / `prayerConfessionName`.
- Person selector labels/field maps for those legacy keys.
- **P:/C:** rows now read `carriedBy.prayerOfPraise` / `prayerOfConfession`.

### Shared cores

| Module | Change |
| --- | --- |
| `public/liturgy-order-core.js` | Removed `LEGACY_*_ID`, `legacyPrayerHomes`. |
| `public/legacy-oos-migrate-core.js` | **New** — plan/hydrate migration, prayer involvement from `carriedBy`. |
| `public/service-involvement-core.js` | Prayer serving from `mergePrayerInvolvement`; removed `prayerPraiseId` / `prayerConfessionId` from `SERVING_FIELDS`. |
| `public/service-read-core.js` | Removed praise/confession from `PEOPLE_FIELDS` (MCP read uses per-row `carriedBy`). |
| `public/events-occurrence-core.js` | Removed prayer top-level fields from `LITURGICAL_SERVICE_FIELDS`; `liturgicalHolders` includes `mergePrayerInvolvement`. |
| `public/usage-stats-store.js` | Removed `prayerPraise*` / `prayerConfession*` field stat keys. |
| `public/people-picker-core.js` | Dedupe + inactive filter (Colin duplicate). |

### Functions / MCP

| Path | Change |
| --- | --- |
| `functions/service-involvement.js` | Same prayer involvement rules as browser core. |
| `functions/shared/*` | Synced copies of updated cores + `legacy-oos-migrate-core.js`. |
| MCP `oos_get_service` | Reads `carriedBy` on liturgy rows via `service-read-core` (no top-level praise/confession names). |

### Mobile

- No direct `prayerPraise` / `showsPraise` references under `public/mobile/` (OOS uses hosted Service Builder).

### Scripts / ops

| Script | Role |
| --- | --- |
| `scripts/migrate-legacy-oos-prayer-carriers.js` | Copy legacy top-level prayer leader fields → `carriedBy` (no field deletion). |
| `scripts/delete-legacy-oos-prayer-fields.js` | **Destructive** — `FieldValue.delete()` legacy top-level prayer fields after migration; aborts if `carriedBy` slot missing. |
| `scripts/merge-duplicate-person.js` | **Destructive** — repoint all references from duplicate person → canonical person; move subcollections; delete source when clean. |

## Intentionally retained (not “liturgy-order legacy”)

Per ADR-0080, these remain **global Sunday roles** (not per-element `carriedBy`):

- `serviceLeader` / `serviceLeaderId`
- `musicLeader` / `musicLeaderId`, `musicHelpers`
- `preacher` / `preacherId`
- `elements` / `other` involvement fields
- `liturgy.prayerMale` / `prayerFemale` (pastoral prayer **subjects**, not serving)

## Deploy order (do not hide data)

1. **Merge and deploy this PR** — readers hydrate legacy → `carriedBy` in memory; saves write `carriedBy` only.
2. **Prod ops dry-run** migration (counts in job log).
3. **`commit=true`** migration when counts look right.
4. After migration counts look right, run **`delete-legacy-oos-prayer-fields.js`** (dry-run, then `commit=true`) to remove legacy top-level fields.
5. Merge Colin Beers duplicate: **`merge-duplicate-person.js`** with `--from qBZMVskmS1CBJl8aCPcT --to Rqu2n9V9vRBLF8TKkEwg`.

## Prod migration dispatch

Workflow: [Prod ops script](./prod-ops-script.md) on **`main`**.

| Step | `script` | `args` | `commit` |
| --- | --- | --- | --- |
| Dry-run (all services) | `migrate-legacy-oos-prayer-carriers.js` | *(empty)* | `false` |
| Dry-run (date window) | `migrate-legacy-oos-prayer-carriers.js` | `--from 2025-01-01 --to 2026-12-31` | `false` |
| Apply | `migrate-legacy-oos-prayer-carriers.js` | *(empty or same window)* | `true` |

```bash
gh workflow run "Prod ops script" --ref main \
  -f script=migrate-legacy-oos-prayer-carriers.js \
  -f 'args=' \
  -f commit=false
```

### Delete legacy top-level prayer fields

| Step | `script` | `args` | `commit` |
| --- | --- | --- | --- |
| Dry-run | `delete-legacy-oos-prayer-fields.js` | *(empty)* | `false` |
| Apply | `delete-legacy-oos-prayer-fields.js` | *(empty)* | `true` |

### Merge duplicate person (Colin Beers)

| Step | `script` | `args` | `commit` |
| --- | --- | --- | --- |
| Dry-run | `merge-duplicate-person.js` | `--from qBZMVskmS1CBJl8aCPcT --to Rqu2n9V9vRBLF8TKkEwg` | `false` |
| Apply | `merge-duplicate-person.js` | `--from qBZMVskmS1CBJl8aCPcT --to Rqu2n9V9vRBLF8TKkEwg` | `true` |

Local (service account):

```bash
node scripts/migrate-legacy-oos-prayer-carriers.js --project mosaic-hymn-database --i-mean-prod
node scripts/migrate-legacy-oos-prayer-carriers.js --project mosaic-hymn-database --i-mean-prod --commit
node scripts/delete-legacy-oos-prayer-fields.js --project mosaic-hymn-database --i-mean-prod
node scripts/merge-duplicate-person.js --project mosaic-hymn-database --i-mean-prod --from qBZMVskmS1CBJl8aCPcT --to Rqu2n9V9vRBLF8TKkEwg
```
