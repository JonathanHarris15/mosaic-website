**DataTable** — A list with columns. Headers are sentence case and quiet. Rows are tall enough to read a name.

```html
<table class="m-table"><thead><tr><th>Name</th><th>Raised</th></tr></thead><tbody><tr><td>General fund</td><td class="m-table__num">0</td></tr></tbody></table>
```

Base class `.m-table`, modifiers `.m-table--<variant>`.

- Use this when a row has more than a name and one fact. A name plus a way to reach someone is .m-person, not a table.
- Numbers align end. Names align start. Do not uppercase the headers.

Built from the Mosaic tokens only — no raw colours, no second icon set.
Icons are Material Symbols Outlined.
