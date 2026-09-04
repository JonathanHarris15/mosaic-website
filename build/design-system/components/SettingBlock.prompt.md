**SettingBlock** — A group of settings that constrain each other, each carrying its own reason.

```html
<div class="f-set"><label class="m-check"><input type="checkbox" disabled><span>Record who answered</span></label><p class="f-why">Off, and not yours to change: a public form has no account to attach a name to.</p></div>
```

**part:** `block` · `why`

Base class `.f-set`, modifiers `.f-set--<variant>`.

- ⚠ f-why is the load-bearing half. On a public form both Attribution and One Response Each are off and cannot be turned on, FOR DIFFERENT REASONS — no account to attach a name to, and no way to tell one person from another. A greyed checkbox with no why is the thing this exists to prevent, and one blanket sentence over both would be a lie about one of them.
- Indented to 28px so the reason lines up under its checkbox's label rather than its box.

Built from the Mosaic tokens only — no raw colours, no second icon set.
Icons are Material Symbols Outlined.
