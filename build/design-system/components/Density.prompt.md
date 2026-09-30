**Density** — A desktop scale, set on the element a dense surface starts at. A professional tool has small elements; a toy has big letters and big blocks. This is the whole of the difference, expressed as tokens.

```html
<body class="m-dense">…</body>
```

Base class `.m-dense`, modifiers `.m-dense--<variant>`.

- It moves NOTHING on its own — it re-points the tokens the components already read, so one class on a <body> takes a whole page down a step: Card padding is --space-md, NavCard's title is --headline-md-size, SerifHead's is --headline-md-size, and so on.
- ⚠ FROM 1024px ONLY, AND THAT IS THE POINT. A phone is a thumb on glass and keeps every shipped size; the desktop is a mouse and can afford a 34px control. Set the class unconditionally and the phone is unharmed.
- Two floors are held and neither is negotiable: nothing that is a SENTENCE drops under 13px, and no pointer target drops under 32px (--m-dense-target-min). The label scale is deliberately untouched — --label-sm already ships at 11.5px, and taking tracked caps to 10px reads as cramped rather than as precise. Density comes from the space around a label, not from the label.
- Adopt it per surface rather than app-wide. It landed on the dashboard (MS-686); every other desktop page still carries the shipped scale until somebody has looked at it.
- ⚠ THE HEADER IS NOT DENSE. It once dropped to 48px under this class, which made the dashboard the one page whose bar was shorter than every other page's — the top of the app jumped on the way in and out of Home. The bar belongs to the window, not to the surface below it, so it keeps PageHeader's height here too.

Built from the Mosaic tokens only — no raw colours, no second icon set.
Icons are Material Symbols Outlined.
