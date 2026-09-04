**Type** — The type scale, as classes. Six roles over the three families — display for the church's own voice, serif for headings, sans for everything you read.

```html
<h1 class="m-display-lg">Mosaic</h1>
<h2 class="m-headline-lg">Inductive Bible Study</h2>
<p class="m-body-md">A box that grows as they type.</p>
<span class="m-label-md">Answering rung</span>
```

**role:** `display-lg` · `headline-lg` · `headline-md` · `body-lg` · `body-md` · `label-md`

Base class `.m-body-md`, modifiers `.m-body-md--<variant>`.

- ⚠ These classes existed in build/design-tokens/typography.css — the file we PUSH to Claude Design — and nowhere the app could reach. The custom properties were spliced into the app's stylesheet; the classes wrapping them were not. So the design system documented a scale the app could not use, and a design composed against it came back full of classes that resolve to nothing in a browser. Found on the MS-360 pull (2026-09-02), where the type would have looked right in the design and silently fallen back to browser defaults in the page.
- They live here now because this file is the one source of m-* classes and generates into BOTH public/mosaic.css and public/mobile/tokens.css. Adding them to the token file again would recreate the split.
- Purely additive — no existing page used one, so nothing re-renders.
- m-label-md uppercases. It is the small caps label above a field, not a <label> element's default styling; m-label is the form component and a different thing.

Built from the Mosaic tokens only — no raw colours, no second icon set.
Icons are Material Symbols Outlined.
