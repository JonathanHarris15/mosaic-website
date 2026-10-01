**Section** — One labelled group. The name sits above a single surface. Rows that belong together share that surface.

```html
<section class="m-section"><div class="m-section__head"><h2 class="m-section__title">Security</h2><p class="m-section__hint">Change the password on this account.</p></div><div class="m-card">…</div></section>
```

Base class `.m-section`, modifiers `.m-section--<variant>`.

- The label is outside the card. A title repeated inside every card is how a list starts to look like a stack of products.
- The hint is one sentence, sentence case, and it is optional. It says what the group is for.
- Put one m-card or one m-card-list inside. Do not put a card inside a card.

Built from the Mosaic tokens only — no raw colours, no second icon set.
Icons are Material Symbols Outlined.
