**NavCard** — The dashboard tile: a medallion, a title, one line of description. Four identical copies of this lived in shepherding-dashboard.html alone.

```html
<a class="m-nav-card" href="#"><span class="m-medallion"><span class="material-symbols-outlined">groups</span></span><h2 class="m-nav-card__title">People</h2><p class="m-nav-card__desc">View and manage member profiles.</p></a>
```

Base class `.m-nav-card`, modifiers `.m-nav-card--<variant>`.

- One descriptive line, never two. The Medallion fills on hover to say the whole tile is the target.

Built from the Mosaic tokens only — no raw colours, no second icon set.
Icons are Material Symbols Outlined.
