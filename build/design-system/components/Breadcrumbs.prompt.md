**Breadcrumbs** — Where you are in a library you can navigate into.

```html
<nav class="f-crumbs"><span class="material-symbols-outlined">folder_open</span><a href="#">Forms</a><span class="material-symbols-outlined">chevron_right</span><span>Sign-ups</span></nav>
```

Base class `.f-crumbs`, modifiers `.f-crumbs--<variant>`.

- MS-360 ships it reading 'Forms' and nothing else, because there is nowhere yet to go — folders arrive with MS-361 (ADR-0053). It is here now so that ticket adds depth to a page already shaped for it rather than rebuilding the navigation.

Built from the Mosaic tokens only — no raw colours, no second icon set.
Icons are Material Symbols Outlined.
