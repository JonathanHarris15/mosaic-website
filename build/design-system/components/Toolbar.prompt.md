**Toolbar** — The row above a list: search on the left, filters and a quiet count on the right. Not a second header.

```html
<div class="m-toolbar"><span class="m-search"><span class="material-symbols-outlined">search</span><input type="search" placeholder="Search people" /></span><div class="m-toolbar__cluster"></div></div>
```

Base class `.m-toolbar`, modifiers `.m-toolbar--<variant>`.

- One search field. Filters sit beside it, not in a panel of their own, unless there are more than three.
- The primary action of the page stays in the header. The toolbar does not grow a second primary button.

Built from the Mosaic tokens only — no raw colours, no second icon set.
Icons are Material Symbols Outlined.
