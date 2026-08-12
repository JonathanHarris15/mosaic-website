**Button** — The standard action. Primary for the one thing a screen is for, secondary for the alternative, ghost for everything that would otherwise be a link.

```html
<button class="m-btn m-btn--primary">Save the service</button>
<button class="m-btn m-btn--secondary m-btn--sm">Cancel</button>
<button class="m-btn m-btn--ghost">Show past dates</button>
<button class="m-btn m-btn--quiet m-btn--sm"><span class="material-symbols-outlined">print</span><span class="m-btn__label">Print PDF</span></button>
```

**variant:** `primary` · `secondary` · `ghost` · `quiet` · `danger` · `danger-outline`
**size:** `sm` · `md` · `lg`

Base class `.m-btn`, modifiers `.m-btn--<variant>`.

- Shadow only on primary, and only --shadow-xs. Everything else is flat — depth here comes from tonal layers and warm hairlines.
- Disabled drops to 40% and takes not-allowed; it is never hidden, because a control that vanishes reads as a bug.
- 46px tall, not 40. The phone shipped 46 and it is above the 44px touch floor; one height that works on both beats two that each work on one.
- Wrap the word in `.m-btn__label` when the button sits somewhere that collapses to icons — a PageHeader's tool or compact mode. Elsewhere the text can go straight in.

Built from the Mosaic tokens only — no raw colours, no second icon set.
Icons are Material Symbols Outlined.
