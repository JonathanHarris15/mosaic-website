**ActionBar** — A pane's own sticky footer: what the current selection adds up to, said in words on the left, and the actions that take it somewhere on the right.

```html
<div class="m-actionbar"><div class="m-actionbar__said"><p class="m-actionbar__count">5 dates ticked</p><p class="m-actionbar__note">Two more come with them.</p></div><div class="m-actionbar__acts"><button class="m-btn m-btn--primary m-btn--sm">Auto-assign 7 dates</button></div></div>
```

Base class `.m-actionbar`, modifiers `.m-actionbar--<variant>`.

- It belongs to the PANE, not to a tab. Where a selection is made in one place and acted on from another, a footer that scrolls away gets drawn twice — which is exactly what it replaces.
- The words on the left are not a caption. They are what makes the buttons honest: how many, which ones, and what the action will quietly not touch.
- Hidden in print. A sticky bar over a printed rota covers the last row.

Built from the Mosaic tokens only — no raw colours, no second icon set.
Icons are Material Symbols Outlined.
