**Side** — Facts that stay beside the work: a glance, an identity, the frame a form is written inside. They do not scroll off the screen.

```html
<div class="m-with-side"><div class="m-side"><h2 class="m-section__title">Sunday</h2><div class="m-side__scroll">…</div></div><div>…</div></div>
```

Base class `.m-side`, modifiers `.m-side--<variant>`.

- Put `m-with-side` on the row that holds the work and the card, and `m-side` on the card. From 1024px the card sticks under the header, grows no taller than the viewport, and scrolls inside itself. Below that the card stacks, because a side column that cannot stay in view is a second page.
- The card holds a title and a defined set of facts — about six — not the rest of the page. If the facts run long, `.m-side__scroll` is the part that moves. The title stays.
- A button lifts. A side card does not. Motion on the card would say it is a control.

Built from the Mosaic tokens only — no raw colours, no second icon set.
Icons are Material Symbols Outlined.
