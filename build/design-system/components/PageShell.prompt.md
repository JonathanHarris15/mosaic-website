**PageShell** — The body of a desktop page: warm background, navy ink, and one of four columns. Pick the recipe; do not invent a fifth width.

```html
<body class="m-page"><header class="m-header">…</header><main class="m-page__body">…</main></body>
<body class="m-page m-page--reading"><header class="m-header">…</header><main class="m-page__body">…</main></body>
<body class="m-page m-page--door"><header class="m-header">…</header><main class="m-page__body"><div class="m-door">…</div></main></body>
```

**recipe:** `list` · `wide` · `reading` · `tool` · `door`

Base class `.m-page`, modifiers `.m-page--<variant>`.

- The body class is `m-page` plus at most one recipe. The long Tailwind string (`bg-background font-body-md antialiased min-h-screen flex flex-col`) is the same thing, written out, and it is retired.
- List (`m-page__body`) caps at --container-max. Wide (`m-page__body--wide`) is 1600px, for a directory or a month that needs the room. Reading (`m-page--reading`) caps at 720px: settings, a policy, commitments. Tool (`m-page--tool`) fills the window and scrolls inside its panes. Door (`m-page--door`) centres one card. Home is a list that also carries `m-page--app` so the tiles fit the viewport.
- The gutter is --space-margin, the same inset the header uses. A 24px body beside a 32px bar is how pages started to look like they were not the same product.
- The bar is PageHeader's job. `.m-header` is a sibling of `.m-page__body`, not a child of the column. The page title is not repeated in the body.
- The kiosk and the Relations Viewer are the two exceptions, and both are written down where they break the rule. A new page is not an exception.

Built from the Mosaic tokens only — no raw colours, no second icon set.
Icons are Material Symbols Outlined.
