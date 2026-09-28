**NavCard** — The dashboard tile: a medallion, a title, one line of description. Four identical copies of this lived in shepherding-dashboard.html alone.

```html
<a class="m-nav-card" href="#"><span class="m-medallion"><span class="material-symbols-outlined">groups</span></span><span class="m-nav-card__body"><h2 class="m-nav-card__title">People</h2><p class="m-nav-card__desc">View and manage member profiles.</p></span></a>
```

**density:** `default` · `dense`

Base class `.m-nav-card`, modifiers `.m-nav-card--<variant>`.

- One descriptive line, never two. The Medallion fills on hover to say the whole tile is the target.
- Wrap the title and the description in `.m-nav-card__body`. The centred column does not need it, but --dense lays the tile out as a row and a row needs the words to be one flex child rather than two.
- --dense is for the surface that shows a DOZEN of these rather than four. The centred column puts a 56px plate over a 24px serif title in --space-lg padding, which fills a fold with three tiles; --dense turns the same tile on its side, drops the plate to 40px and clamps the description at two lines. It only applies from 1024px up — a phone has the room for the shipped tile and a 56px plate is the comfortable target there.

Built from the Mosaic tokens only — no raw colours, no second icon set.
Icons are Material Symbols Outlined.
