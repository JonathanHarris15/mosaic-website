**PageShell** — The body of a desktop page: warm background, navy ink, a column capped at --container-max.

```html
<body class="m-page"><header class="m-header">…</header><main class="m-page__body">…</main></body>
```

Base class `.m-page`, modifiers `.m-page--<variant>`.

- The width is the token, not Tailwind's max-w-7xl. Ten pages reached for the framework default before this.
- The bar is PageHeader's job now. `.m-page__bar` was removed in MS-187: its declarations sat INSIDE the capped column, so a bar built on it could never run its background or its hairline to the window edge — which is most of why the eight hand-rolled headers read as eight products. `.m-header` is a sibling of `.m-page__body`, not a child of the column.

Built from the Mosaic tokens only — no raw colours, no second icon set.
Icons are Material Symbols Outlined.
