**MonthStrip** — The phone's month: seven columns of day numbers, each carrying up to three dots. A glance, not a list — the count lives in the cards underneath it.

```html
<div class="m-strip"><div class="m-strip__day">S</div>…</div><div class="m-strip"><button class="m-strip__cell m-strip__cell--current"><span class="m-strip__num">16</span><span class="m-strip__dots"><span class="m-strip__dot" style="background: var(--event-ocean)"></span></span></button>…</div>
```

Base class `.m-strip`, modifiers `.m-strip--<variant>`.

- Three dots and no more. A fourth 5px dot in a ~46px cell has nowhere to go, and asking the strip to be exhaustive is asking it to stop being a glance.
- A dot takes the same colour the chip's family would, so the strip and the cards under it cannot disagree about what a day looks like.
- Two grids, not one: the weekday letters and the days. They share the column count so they line up without either knowing about the other.

Built from the Mosaic tokens only — no raw colours, no second icon set.
Icons are Material Symbols Outlined.
