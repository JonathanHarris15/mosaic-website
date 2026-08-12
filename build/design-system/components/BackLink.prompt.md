**BackLink** — The way out of a page, top left. Eight pages wrote the same chevron-and-label by hand.

```html
<a class="m-back" href="index.html"><span class="material-symbols-outlined">chevron_left</span><span class="m-back__label">Home</span></a>
```

Base class `.m-back`, modifiers `.m-back--<variant>`.

- The glyph is `chevron_left`, not `arrow_back`. The phone's TopBar always drew a chevron and twenty desktop pages drew an arrow; two glyphs for one idea is the bug, and the phone's was the older and more-used answer (MS-187).
- The label names WHERE IT GOES — `Home`, `Calendar`, `People`. Never `Back` and never `Back to Dashboard`: the chevron already says back, so the word is wasted. This collapsed five spellings into one rule.
- 44px minimum, because it renders on a phone in six pages and was a bare text link with no touch target.
- The label is a slot so the header's compact and tool modes can hide it and leave a square chevron. A bare text node cannot be addressed.

Built from the Mosaic tokens only — no raw colours, no second icon set.
Icons are Material Symbols Outlined.
