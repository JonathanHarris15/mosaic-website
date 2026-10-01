**Craft** — The site still has hand-rolled controls that shout in 10px tracked capitals. This is the rule that quiets them, so a page does not have to be rewritten before it can be read.

```html
<button class="uppercase tracking-widest text-[10px]">Save my info</button>
```

Base class `.m-craft`, modifiers `.m-craft--<variant>`.

- Sentence case. A button is 14px and at least 36px tall, and it lifts on hover the same way .m-btn does.
- The utilities layer would otherwise win, because these classes (.uppercase, .tracking-widest, .text-[10px]) are utilities. The overridden properties are !important for that reason alone.
- A finished control is still .m-btn. This only stops an unfinished one from shouting.

Built from the Mosaic tokens only — no raw colours, no second icon set.
Icons are Material Symbols Outlined.
