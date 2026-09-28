**Drawer** — The navigation panel a header's hamburger opens: a navy head saying who you are, the list of places you may go, and the way out at the foot. The phone had two hand-drawn copies of this and the desktop had none.

```html
<div class="m-drawer" id="app-drawer"><button class="m-drawer__scrim" tabindex="-1" aria-hidden="true"></button><nav class="m-drawer__panel" aria-label="Menu"><div class="m-drawer__head"><button class="m-icon-btn m-icon-btn--lg" aria-label="Close menu"><span class="material-symbols-outlined">menu</span></button><a class="m-drawer__who" href="profile.html"><span class="m-avatar">JH</span><span class="m-drawer__who-main"><span class="m-drawer__name">Jonathan Harris</span><span class="m-drawer__role">Elder</span></span></a></div><div class="m-drawer__list"><a class="m-drawer__item" href="index.html" aria-current="page"><span class="material-symbols-outlined">home</span><span class="m-drawer__label">Home</span></a></div><div class="m-drawer__foot"></div></nav></div>
```

Base class `.m-drawer`, modifiers `.m-drawer--<variant>`.

- ⚠ THE LIST IS NOT THE COMPONENT'S BUSINESS. What goes in a drawer is a permission question, and this answers none of it — a caller hands it entries. On the dashboard those entries are the TILES the page just drew, so the drawer and the grid cannot disagree about who may see what.
- The scrim is a <button>, so clicking outside closes the drawer without a click handler on a <div>; tabindex=-1 and aria-hidden keep it out of both the tab order and the accessibility tree. Escape is the keyboard way out.
- The safe-area padding on the head and the foot is not decoration. On a desktop window both insets are 0, so it costs nothing — and it is what stops the panel sliding under an iPhone's status bar if this becomes the one Drawer both surfaces use.
- Nothing behind an open drawer is reachable: the caller sets `inert` on the page, and the component stops the body scrolling under the panel. A drawer you can Tab out of and behind is worse than no drawer.
- The head is navy — the one filled surface in the app besides a primary button — because the drawer is the only chrome that covers the page rather than bordering it, and it should not read as more parchment.

Built from the Mosaic tokens only — no raw colours, no second icon set.
Icons are Material Symbols Outlined.
