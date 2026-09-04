**Dropdown** — A picker with grouped options that opens downward, caps its height, and scrolls inside.

```html
<div class="m-dropdown"><button class="m-dropdown__button">Short answer<span class="material-symbols-outlined">expand_more</span></button><div class="m-dropdown__panel"><div class="m-dropdown__group">Text</div><button class="m-dropdown__opt m-dropdown__opt--picked">Short answer</button></div></div>
```

**part:** `button` · `panel` · `group` · `option`
**state:** `picked` · `later`

Base class `.m-dropdown`, modifiers `.m-dropdown--<variant>`.

- ⚠ THIS EXISTS BECAUSE A NATIVE <select> CANNOT BE MADE TO BEHAVE. Its popup is drawn by the operating system: it will not take a font, a colour, a corner or a max-height, and the browser decides whether it opens up or down. On the form page the question-type picker had thirteen options in six groups and opened UPWARD off the top of the window, in system chrome that looked nothing like the rest of the app. None of that is fixable with CSS on the select.
- Opens DOWN, always, and caps at min(320px, 50vh) with the list scrolling inside. Predictable beats clever: a picker that sometimes flips is a picker you have to look for.
- __opt--later is for an option that is named but not built yet. It is shown, greyed and unselectable, with the word 'later' after it — a picker that grows from three entries to thirteen is a redesign, and one that shows all thirteen from the start is not.
- Escape closes it and a click outside closes it. Both are the caller's to wire; this is CSS.
- It needs an ancestor that does not clip. f-pane carries overflow:visible for exactly this.

Built from the Mosaic tokens only — no raw colours, no second icon set.
Icons are Material Symbols Outlined.
