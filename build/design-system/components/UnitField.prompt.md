**UnitField** — A number and the unit it is in, as one field.

```html
<span class="m-unitfield"><input type="number" min="0" step="0.25" value="4" /><span class="m-unitfield__unit">weeks</span></span>
<span class="m-unitfield m-unitfield--sm"><input type="number" min="0" step="0.25" value="1" /><span class="m-unitfield__unit">week's rest</span></span>
```

**size:** `md` · `sm`

Base class `.m-unitfield`, modifiers `.m-unitfield--<variant>`.

- The unit sits INSIDE the border. A word floating beside a box is a word that wraps away from it in a narrow column, and a number of weeks read as a number of anything is a rota that rests people for four days.
- The unit is text the page supplies, so it can take the singular: "1 week's rest", never "1 weeks' rest".
- Focus ring is the Input's, on the wrapper rather than the input, so the whole field lights up.

Built from the Mosaic tokens only — no raw colours, no second icon set.
Icons are Material Symbols Outlined.
