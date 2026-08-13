**EventChip** — One event, in a day cell or anywhere else that lists them. One shape, six families, and only the two that ask something of somebody carry a fill.

```html
<button class="m-chip m-chip--other" style="border-left-color: var(--event-steel)"><span class="m-chip__label">Midweek Gathering</span></button>
<button class="m-chip m-chip--unfilled" style="border-left-color: var(--event-ocean)"><span class="m-chip__you"></span><span class="material-symbols-outlined m-chip__icon">warning</span><span class="m-chip__label">Sunday Service</span></button>
```

**family:** `other` · `sunday` · `mine` · `unfilled` · `declined` · `off`

Base class `.m-chip`, modifiers `.m-chip--<variant>`.

- ⚠ THE RULE THE WHOLE CALENDAR RESTS ON. A chosen event colour only ever draws the BAR down the side; a tint only ever fills the BACKGROUND. So a filled chip always means the app is saying something, and a bar always means somebody picked a shade. Set the bar with an inline `border-left-color` from data — it is the one value that cannot be a class.
- Loudness, and it is deliberate: off · declined · unfilled · mine · sunday · other. Only `--declined` (error) and `--unfilled` (warning) fill. `mine` is a semibold name and the navy dot; `other` is a bar and a name.
- ⚠ RED IS SPOKEN FOR. `--declined` means somebody said no. Nothing decorative is ever red, and no event colour includes one.
- The `__you` dot reads off whether the person is serving, NOT off the family — so an amber chip you are on still says so.
- A name WRAPS rather than truncating, and breaks at a space and nowhere else: `overflow-wrap: break-word` put "Servic / e" in a 90px cell, which is worse than either.
- A chip carrying a leading glyph drops its trailing one. Two glyphs and a name in a 110px chip is one too many.
- ⚠ THE FAMILIES ARE BUILT, NOT TYPED — `'m-chip--' + chipKind(ev)`. So the class checker reports most of them as unused and always will. They are not dead; deleting one silently drops a whole state off the Calendar.

Built from the Mosaic tokens only — no raw colours, no second icon set.
Icons are Material Symbols Outlined.
