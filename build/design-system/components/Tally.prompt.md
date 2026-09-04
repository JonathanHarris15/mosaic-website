**Tally** — What came back from a form — a labelled bar per option, and free-text answers as quotes.

```html
<div class="f-tally"><div class="f-bar"><span class="f-barname">Chili</span><span class="f-bartrack"><span class="f-barfill" style="width:100%"></span></span><span class="f-barnum">14 · 41%</span></div></div>
```

**part:** `tally` · `bar` · `quote`

Base class `.f-tally`, modifiers `.f-tally--<variant>`.

- ⚠ A quote carries its handle and NEVER a date when the form is anonymous. Arrival order plus a timestamp is what lines the answers back up against the ledger of who answered, which is the join ADR-0052 exists to prevent. An attributed form may show times; the component does not care, the page decides.
- The bar is a track and a fill rather than a chart library. Four options on a phone is not a visualisation problem.
- f-barname is a fixed 8.5rem so the bars start at the same x and can be compared by eye, which is the only thing a tally is for.

Built from the Mosaic tokens only — no raw colours, no second icon set.
Icons are Material Symbols Outlined.
