**Card** — A flat container with a warm hairline. The default surface for grouping anything.

```html
<div class="m-card"><span class="m-label">Next Sunday</span></div>
```

**variant:** `default` · `interactive` · `raised`
**padding:** `sm` · `md` · `lg`

Base class `.m-card`, modifiers `.m-card--<variant>`.

- Flat by default. Depth is a tonal layer and a 1px --outline-variant line, not a shadow.
- The interactive variant lifts its background on hover; it does not grow a shadow.

Built from the Mosaic tokens only — no raw colours, no second icon set.
Icons are Material Symbols Outlined.
