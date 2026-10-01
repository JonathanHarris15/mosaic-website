**SettingRow** — One setting: what it is and a sentence of help on the left, the control on the right. Not a stack of identical inputs with no explanation.

```html
<div class="m-setting"><div><div class="m-setting__title">Public list</div><p class="m-setting__hint">Anyone in the church can see it.</p></div><button class="m-btn m-btn--secondary m-btn--sm" type="button">Change</button></div>
```

Base class `.m-setting`, modifiers `.m-setting--<variant>`.

- The control is a switch, a button, or a short field. A long form stays a stack of .m-field, not a row of settings.
- Rows in one group share one card. The hairline is the separator. Do not put a card inside each row.

Built from the Mosaic tokens only — no raw colours, no second icon set.
Icons are Material Symbols Outlined.
