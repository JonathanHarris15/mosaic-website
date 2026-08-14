**Segmented** — Two to four named choices with one of them chosen, all visible at once. For the choice that is the point of the row rather than something to go looking for in a menu.

```html
<div class="m-seg"><button class="m-seg__opt" aria-pressed="true">A man</button><button class="m-seg__opt" aria-pressed="false">A woman</button><button class="m-seg__opt" aria-pressed="false">Anyone</button></div>
<div class="m-seg m-seg--fill m-seg--lg"><button class="m-seg__opt" aria-pressed="true">Anyone</button><button class="m-seg__opt" aria-pressed="false">A woman</button></div>
```

**fill:** `default` · `fill`
**size:** `md` · `lg`

Base class `.m-seg`, modifiers `.m-seg--<variant>`.

- `aria-pressed="true"` IS the selected state — there is no --current class. A screen reader has to be told which one is chosen, and a class alone does not.
- Two to four. More than that is a Select, and a single on/off is a Checkbox.
- --fill gives equal thirds across the full width, which is what a phone wants; --lg takes the options to 44px for touch.

Built from the Mosaic tokens only — no raw colours, no second icon set.
Icons are Material Symbols Outlined.
