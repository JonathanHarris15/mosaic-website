**Tabs** — The tab bar inside a pane, when one selected thing has more sides to it than a page can sensibly stack.

```html
<div class="m-tabs"><button class="m-tabs__tab m-tabs__tab--current">Rota</button><button class="m-tabs__tab">The event<span class="m-tabs__dot"></span></button></div>
```

**state:** `default` · `current`

Base class `.m-tabs`, modifiers `.m-tabs--<variant>`.

- Inside a PANE, over a hairline — not across the top of a page. A page with tabs is usually a page that should have been two pages.
- Tracked caps at the same weight the header uses for a label, so the pane's chrome and the page's agree rather than competing.
- 46px is the button height; this is 44 — it is chrome, not an action, and it still clears the touch floor.
- __dot marks a tab holding work that has not been saved. Amber, never red: red on a roster surface means somebody declined. Static, because the motion rule forbids a pulse.
- overflow-x: auto with the scrollbar hidden, so four tabs survive a 390px phone.

Built from the Mosaic tokens only — no raw colours, no second icon set.
Icons are Material Symbols Outlined.
