**Row** — One line of a list: an optional leading avatar or medallion, a title, an optional second line, something trailing. The shape the phone already used, adopted whole rather than reinvented.

```html
<div class="m-row"><span class="m-avatar m-avatar--sm">SA</span><div class="m-row__main"><div class="m-row__title">Sarah Adams</div><div class="m-row__sub">Elder · Kids Ministry</div></div><span class="m-badge m-badge--secondary">Elder</span></div>
```

**variant:** `default` · `interactive`
**title:** `sans` · `serif`

Base class `.m-row`, modifiers `.m-row--<variant>`.

- On a phone the trailing action is always visible — there is no hover on touch.
- A serif title is for something a person reads: a hymn, a Role, somebody's name. Sans is for everything operational.

Built from the Mosaic tokens only — no raw colours, no second icon set.
Icons are Material Symbols Outlined.
