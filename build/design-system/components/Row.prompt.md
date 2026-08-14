**Row** — One line of a list: an optional leading avatar or medallion, a title, an optional second line, something trailing. The shape the phone already used, adopted whole rather than reinvented.

```html
<div class="m-row"><span class="m-avatar m-avatar--sm">SA</span><div class="m-row__main"><div class="m-row__title">Sarah Adams</div><div class="m-row__sub">Elder · Kids Ministry</div></div><span class="m-badge m-badge--secondary">Elder</span></div>
```

**variant:** `default` · `interactive` · `current`
**title:** `sans` · `serif`

Base class `.m-row`, modifiers `.m-row--<variant>`.

- On a phone the trailing action is always visible — there is no hover on touch.
- A serif title is for something a person reads: a hymn, a Role, somebody's name. Sans is for everything operational.
- --current is for a Row that is a DESTINATION: a list where picking one changes a pane beside it, rather than navigating away. Same job as `.m-picklist__item--current`, and it carries the same 3px edge on purpose, so a screen holding both kinds of list says "you are here" once rather than twice. A Row that merely leads somewhere never wears it.

Built from the Mosaic tokens only — no raw colours, no second icon set.
Icons are Material Symbols Outlined.
