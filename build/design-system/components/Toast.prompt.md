**Toast** — A short confirmation at the foot of the screen. Error is the only loud tone; everything else is the calm one.

```html
<div class="m-toast">Saved</div>
<div class="m-toast m-toast--error">That date is taken</div>
```

**tone:** `default` · `error`

Base class `.m-toast`, modifiers `.m-toast--<variant>`.

- Its ink follows its background — cream on primary, white on error. --on-primary is cream, not pure white.

Built from the Mosaic tokens only — no raw colours, no second icon set.
Icons are Material Symbols Outlined.
