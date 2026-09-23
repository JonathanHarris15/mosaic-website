# Arena synthesis — query builder nuance

Parent pick: **candidate 1** as the base (cross-judge agreed: C1 28/30, C2 21, C3 6).
C3 dropped (rationale only). Landed on `cursor/printables-hotfixes-0da3`.

## Why C1

A 5-Sunday preaching schedule is one Repeat over **Sundays**: 5 from this
Sunday, every Sunday whether written or not, TBA on empty *text*. One range
param, not a new source. Church words, existing catalog.

## Grafted from C2

- **Announcements of a Sunday** — iterable rows (typed first, then printed
  Event announcements). Booklet text still joins the same items.
- **Next N event dates** — `range.mode === 'count'` on the existing range
  helper, then slice. Not a second range type. Editor: **Next dates**.
- **`dateShort` (6 Sep)** beside C1’s `shortDate` (Sep 6).
- **TBA only on text fields.** Dates stay dates.
- **`holderOn` / `holdersOf`** share one assignment rule.
- **Bound text with newlines** keeps `pre-line` (not only the booklet field).

## Rejected

- **`role_dates` as a second source** — C1’s rota on `event_dates` is smaller.
- Renaming **Sundays** to “Preaching schedule” — the list is Sundays; the
  schedule is how you wire it.
- C2’s empty-means-stand-in default — C1’s editor-chosen TBA matches the old
  guide; blanking it still hands rows back to the stand-in.
- C3’s extra engine / catalog split.

## Known leftover

A weekday service inside a “5 Sundays” window can add a sixth row. Same as
the old guide. Not changed.

## Verification

`npm test` after the graft. Shared copy synced with
`node scripts/sync-shared-to-functions.js`.
