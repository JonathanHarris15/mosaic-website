**PickList** — The list half of a SplitView: rows you choose between, one of them current, each carrying a colour dot and two lines of detail.

```html
<div class="m-picklist"><button class="m-picklist__item m-picklist__item--current"><span class="m-picklist__dot" style="background: var(--event-navy)"></span><span class="m-picklist__main"><span class="m-picklist__name">Sunday Service</span><span class="m-picklist__line">Every Sunday at 10:30 am</span><span class="m-picklist__meta">5 roles · next 17 Aug</span></span></button></div>
```

**state:** `default` · `current`

Base class `.m-picklist`, modifiers `.m-picklist--<variant>`.

- Not a CardList of Rows. A Row carries one sub-line, has no current state, and TRUNCATES its title — and the one list that names the subject of the whole screen must be allowed to wrap. A clipped name there is a bug waiting to be filed.
- The current row is a tonal step plus a 3px --primary left edge. Both, because the tonal step alone is too quiet against a warm surface and the edge alone reads as decoration.

Built from the Mosaic tokens only — no raw colours, no second icon set.
Icons are Material Symbols Outlined.
