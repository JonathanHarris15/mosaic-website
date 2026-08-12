**Checkbox** — A checkbox and its label, as one target. The whole row is clickable, because a 16px box is a miss on a phone.

```html
<label class="m-check"><input type="checkbox" /><span>Only mine</span></label>
```

**state:** `default` · `checked` · `disabled`

Base class `.m-check`, modifiers `.m-check--<variant>`.

- Minimum 44px of tappable height even though the box itself is 18px.

Built from the Mosaic tokens only — no raw colours, no second icon set.
Icons are Material Symbols Outlined.
