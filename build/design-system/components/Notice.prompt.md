**Notice** — The edged bar: signed out, a read that failed, a write that half-failed, or what a selection adds up to. One component, four tones, replacing eleven hand-rolled copies.

```html
<div class="m-notice m-notice--gold"><span class="material-symbols-outlined m-notice__icon">person_off</span><div class="m-notice__body"><p class="m-notice__title">You are not signed in.</p><p class="m-notice__text">Sign in to see the events that repeat and who is on them.</p></div><div class="m-notice__acts"><a class="m-btn m-btn--primary m-btn--sm" href="#">Sign in</a></div></div>
```

**tone:** `gold` · `info` · `warning` · `error`

Base class `.m-notice`, modifiers `.m-notice--<variant>`.

- Gold is 'you are not signed in' and other doors. Info (tertiary) is what the app is telling you about your own selection. Warning is amber — something needs looking at. Error is a read or a write that failed.
- ⚠ There is no 'danger' tone beyond --error, and nothing decorative is ever red. On the serving surfaces red already means somebody declined.
- The left edge carries the tone at 3px; gold and info keep the ordinary surface behind them, warning and error take their container. A gold bar with a gold background would shout as loudly as an error.

Built from the Mosaic tokens only — no raw colours, no second icon set.
Icons are Material Symbols Outlined.
