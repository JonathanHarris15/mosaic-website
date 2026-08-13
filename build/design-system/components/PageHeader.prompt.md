**PageHeader** — The strip across the top of every desktop page: the way back, the page's name, the page's actions, and the account. One component replacing the eight shapes thirty-four pages had arrived at.

```html
<header class="m-header"><div class="m-header__inner"><div class="m-header__lead"><a class="m-back" href="index.html"><span class="material-symbols-outlined">chevron_left</span><span class="m-back__label">Home</span></a><div class="m-header__titles"><h1 class="m-header__title">Calendar</h1></div></div><div class="m-header__actions"></div><div class="m-header__rule"></div><div class="m-header__auth" id="auth-container"></div></div></header>
<header class="m-header m-header--tool m-header--sticky"><div class="m-header__inner"><div class="m-header__lead"><div class="m-header__titles"><h1 class="m-header__title m-header__title--serif">Service Guide Editor: Sunday, November 9, 2025</h1></div></div></div></header>
<span class="m-badge m-badge--warning m-header__chip"><span class="m-chip-dot m-chip-dot--pulse"></span><span class="m-btn__label">Unsaved</span></span>
```

**type:** `standing` · `tool`
**title:** `display` · `serif`

Base class `.m-header`, modifiers `.m-header--<variant>`.

- WHICH TYPE, in three questions. 1) Does the page fill the viewport and scroll inside its own panes? Yes → --tool. No → the Standing Bar. 2) Is the body one long scroll passing under the top of the window? Yes → --sticky. 3) Is the title a place in the app or a record in the database? A place → Cinzel. A record → __title--serif.
- ⚠ THE BAR USES THE WHOLE WINDOW, AND HAS NO SETTING FOR ANYTHING ELSE. There was a fourth question once — how wide is the page's column? — and `--m-header-max` to answer it with. It made the top of the app move from page to page: a 720px reading page crushed Home, the title, the actions and the account into the middle third of the screen with empty parchment either side, while a 1600px table spread the same four things right out. One page bound it to a tab, so the bar jumped when you switched. Chrome is not content; it belongs to the window, and Home being in the same place on every page is the whole of what a person wants from it.
- Its contents sit on `--space-margin`, the same gutter the page's own body uses, so the bar lines up with the window rather than with whatever is under it.
- A Person's name is not chrome. Cinzel is the app's own word for a place — Calendar, Roles Manager. A record the database holds — a Person, a dated Service Guide — is set in EB Garamond, because setting somebody's name in tracked caps makes a member of the church look like a menu item.
- The account slot reserves 40px unconditionally. auth.js injects into #auth-container after Firebase resolves, and a bar that changes height when it lands is the layout shift this replaces.
- Actions live here, not stacked under the title in main. Up to three. A fourth would go behind a more_vert menu — that rule is written down but deliberately NOT built, because no page has four today and speculative chrome rots (MS-187).
- The header never prints. That is in the component, so no page needs its own no-print.
- MOTION EXCEPTION: --pulse is an infinite animation, which the system's motion rule otherwise forbids. It is kept on purpose for the two chips that mean something is broken — 'Unsaved', and a booklet over its page limit — because the pulse is what makes anyone notice. Ruled on in MS-187. It yields to prefers-reduced-motion.

Built from the Mosaic tokens only — no raw colours, no second icon set.
Icons are Material Symbols Outlined.
