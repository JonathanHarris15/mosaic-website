**Button** — The standard action. Primary for the one thing a screen is for, secondary for the alternative, ghost for everything that would otherwise be a link.

```html
<button class="m-btn m-btn--primary">Save the service</button>
<button class="m-btn m-btn--secondary m-btn--sm">Cancel</button>
<button class="m-btn m-btn--ghost">Show past dates</button>
```

**variant:** `primary` · `secondary` · `ghost` · `quiet` · `danger`
**size:** `sm` · `md` · `lg`

Base class `.m-btn`, modifiers `.m-btn--<variant>`.

- Shadow only on primary, and only --shadow-xs. Everything else is flat — depth here comes from tonal layers and warm hairlines.
- Disabled drops to 40% and takes not-allowed; it is never hidden, because a control that vanishes reads as a bug.
- 46px tall, not 40. The phone shipped 46 and it is above the 44px touch floor; one height that works on both beats two that each work on one.

Built from the Mosaic tokens only — no raw colours, no second icon set.
Icons are Material Symbols Outlined.
