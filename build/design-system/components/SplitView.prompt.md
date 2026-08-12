**SplitView** — A list of things beside the one that is open, where picking a row changes the whole right-hand side rather than navigating away.

```html
<div class="m-split"><div class="m-split__list">…</div><div class="m-split__pane">…</div></div>
```

Base class `.m-split`, modifiers `.m-split--<variant>`.

- The list is a PANEL, not a page. This is the shape for a screen whose subject is one of several similar things — not for a sidebar of navigation.
- Stacks below 1000px by media query AND container query, so it collapses correctly whether the page is narrow or the pane it sits in is.
- It only stops the two columns. A phone that wants the pane to REPLACE the list entirely does that itself — the component has no opinion about which of the two you are looking at.
- --m-split-list overrides the list width; 320px otherwise.

Built from the Mosaic tokens only — no raw colours, no second icon set.
Icons are Material Symbols Outlined.
