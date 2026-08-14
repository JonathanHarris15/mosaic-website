**Token** — A name, and the control that takes it off the list. Serif, because it is a Person.

```html
<span class="m-token">Sarah Whitfield<button class="m-icon-btn m-icon-btn--sm m-icon-btn--ghost" title="Take Sarah Whitfield off this list"><span class="material-symbols-outlined">close</span></button></span>
<span class="m-token m-token--plain">Tom Brackley</span>
```

**variant:** `default` · `plain`
**size:** `md` · `lg`

Base class `.m-token`, modifiers `.m-token--<variant>`.

- Not a Badge and not an EventChip. A Badge is a STATE and cannot be removed; an EventChip is an event on a calendar. This is one member of a list somebody is building.
- --plain where there is nothing to remove — a list being read rather than edited.
- The remove control is an IconButton, so it inherits the touch floor rather than inventing a second small-target rule.

Built from the Mosaic tokens only — no raw colours, no second icon set.
Icons are Material Symbols Outlined.
