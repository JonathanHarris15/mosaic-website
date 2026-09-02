**LinkRow** — A URL you are meant to copy, with the button to copy it.

```html
<div class="f-linkrow"><span class="material-symbols-outlined">link</span><code>mosaicmanagercstx.com/f/7bQm2xK9vRt4Lp8sYw3NcF</code><button class="m-btn m-btn--quiet m-btn--sm">Copy</button></div>
```

Base class `.f-linkrow`, modifiers `.f-linkrow--<variant>`.

- For a published form's link. You publish on Sunday and want the link again on Thursday, so it lives on the page rather than only in the moment of publishing.
- Monospace, because it is a string somebody may have to read out or check character by character.
- The URL carries the form's id, which is 128 bits of base58 and never its title — a readable slug would be a guessable one (ADR-0051). So it is long, and this does not try to hide that.
- ⚠ --radius, not --radius-full. It was drawn as a pill and shipped as one, and on the form page it was then the only round-cornered thing among cards, buttons, question rows and setting blocks that are all 10px. One pill among square corners does not read as emphasis, it reads as a mistake.

Built from the Mosaic tokens only — no raw colours, no second icon set.
Icons are Material Symbols Outlined.
