# Arena synthesis — MS-730 Printable data drawer

Parent pick: **candidate 1** as the base (cross-judge agreed: C1 29/30, C3 27, C2 20).
Landed on `cursor/ms-730-data-drawer-dd2c`.

## Why C1

One mental model (browse / own Repeat / row), query builder never folds, Fill-in
library open by default, General live data folded. Event lists stay unlocked.
Liturgy-driven Sunday chips, emulator walkthrough, and behaviour tests cover the
grounding use cases. Safer for a maintainer than C3’s false-lock on `event_list`
or C2’s thinner string-match suite.

## Grafted from C3

- **`drawerPartOf` in `printable-data-core`** — every source has exactly one
  home (`query` / `fill` / `general`); `querySourcesFor` filters by it. New
  catalog sources need no drawer HTML.
- **Browse other data / Back to this box’s rows** — look at a single (or other
  source) while an iterated box stays selected, without rewriting its Repeat.

## Grafted from C2

- **Do not retarget an `event_list` Repeat** from the query menu — columns stay
  in the Fill-in library; the menu shuts for that box.

## Rejected

- **C3 as base** — `event_list` showed as locked; Fill-in / General hidden when
  `!canEdit`.
- **C2 as base** — no catalog partition helpers; weaker tests; event_list looked
  unpicked.
- **Tabs** (all three rejected) — hide chips from the wire.
- **Keeping This Sunday / quick lists** — parallel paths to the same data.

## Verification

- `npm test` after the graft (targeted drawer/core suites green; full suite
  re-run).
- Shared copy synced: `node scripts/sync-shared-to-functions.js`.
- Cross-judge: [Arena cross-judge drawer](bc-5ea1a71e-76ba-515f-8dab-f6c43cd00c1f)
  on Grok; parent agreed on C1.
