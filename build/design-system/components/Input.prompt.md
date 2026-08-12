**Input** — A single-line text field, its label, and its error. There were four spellings of this across the app before it was named.

```html
<label class="m-field"><span class="m-label">Email address</span><input class="m-input" type="email" /></label>
<input class="m-input m-input--invalid" aria-invalid="true" value="not an email" />
```

**state:** `default` · `invalid` · `disabled`

Base class `.m-input`, modifiers `.m-input--<variant>`.

- 48px tall on purpose: iOS zooms into any focused field under 16px and often fails to zoom back out, so the font floor and the height go together.
- The focus ring is steel-teal at low alpha, the one place the system uses a colour outside the token set — see --m-focus-ring.

Built from the Mosaic tokens only — no raw colours, no second icon set.
Icons are Material Symbols Outlined.
