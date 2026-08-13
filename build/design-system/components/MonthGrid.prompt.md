**MonthGrid** — The month, seven columns wide. Rows floor at 112px and grow to what is on them; the numeral sits out of the way on the right, and a day carrying more than its row holds says so rather than hiding it.

```html
<section class="m-cal"><div class="m-cal__days"><div class="m-cal__day">SUN</div>…</div><div class="m-cal__grid"><div class="m-cal__cell"><div class="m-cal__head"><span class="m-cal__num">3</span></div><div class="m-cal__events">…</div></div>…</div></section>
```

Base class `.m-cal`, modifiers `.m-cal--<variant>`.

- ⚠ A CELL IS NOT A CARD. `.m-card` was tried and bent out of shape: this needs seven equal columns, a row that grows, a per-cell overflow line and a chip whose colour bar comes from data. It is the only grid of its kind in the app.
- Sunday carries one tonal step and nothing else does. The church's week has a shape and the grid should show it before you read a word — but tinting both ends draws a box round the weekend, which is somebody else's week, not this one's.
- ⚠ WHICH COLUMN A CELL IS IN IS A CLASS — `--sunday`, `--rowend` — NEVER `nth-child`. Alpine's `<template x-for>` stays put as the grid's first child, so the nth cell is not the nth child and a positional rule lands one column out. That shipped once: Saturday tinted, Friday missing its rule.
- A day from the month either side keeps the week rule under it — a horizontal line has to run the full width — but loses its vertical, so the corners of the month dissolve rather than being ruled off into boxes nobody is meant to read. It is not tinted: two tones in a row is one too many.
- `--fit` divides whatever height is left into equal rows, so the month ends where the window does. You scroll for more information, never to see the rest of what is already on screen.
- ⚠ `--open` IS A WEEK, NOT A DAY. A cell cannot be taller than its row, so opening one opens the row — and every day on that row then shows everything, rather than sitting beside empty space with events still hidden. `--open` stops the grid dividing the window; the caller pins the other rows to the height they already had, so the opened week is the only thing that moves.

Built from the Mosaic tokens only — no raw colours, no second icon set.
Icons are Material Symbols Outlined.
