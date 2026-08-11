**IconButton** — A square button holding one Material Symbol. Toolbar actions, close buttons, the floating action button. Always carries an aria-label — an icon alone is not a name.

```html
<button class="m-icon-btn m-icon-btn--ghost" aria-label="Close"><span class="material-symbols-outlined">close</span></button>
<button class="m-icon-btn m-icon-btn--fab" aria-label="Add an event"><span class="material-symbols-outlined">add</span></button>
```

**variant:** `ghost` · `outline` · `primary` · `fab`
**size:** `sm` · `md` · `lg`

Base class `.m-icon-btn`, modifiers `.m-icon-btn--<variant>`.

- Material Symbols Outlined, never Lucide and never emoji. One icon set across the product.
- The fab variant is the only elevated one: navy, 16px radius, --shadow-md.

Built from the Mosaic tokens only — no raw colours, no second icon set.
Icons are Material Symbols Outlined.
