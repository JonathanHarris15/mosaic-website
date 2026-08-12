**RotaGrid** — Roles down the side, dates across the top, and what is really stored in the cells. The role column stays put while the dates scroll, each column header ticks, and an unfilled place is drawn rather than left blank.

```html
<div class="m-rota"><div class="m-rota__scroll"><table class="m-rota__table">…</table></div></div>
```

**column:** `default` · `picked`

Base class `.m-rota`, modifiers `.m-rota--<variant>`.

- ⚠ THE ROLE COLUMN STAYS PUT. Eight date columns are wider than any screen, and scrolling that took the row headings away would leave you reading names three columns in with no idea which Role they are in.
- An unfilled place is DRAWN — a dashed ring and a word. A blank cell reads as a place somebody forgot to fill; seeing the hole before the morning it matters is the whole point of reading ahead.
- A ticked column is tinted the whole way down, so a selection reads as 'these dates' rather than as a row of checkboxes at the top. The header tint is stronger than the body's.
- __state is the one line that lets an editor pick columns from the header instead of reading every cell under it.
- Only __scroll scrolls sideways. The page never does.

Built from the Mosaic tokens only — no raw colours, no second icon set.
Icons are Material Symbols Outlined.
