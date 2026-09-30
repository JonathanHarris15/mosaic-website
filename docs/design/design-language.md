# Mosaic page language

The token sync names colours and classes. It does not decide how a page behaves. This document is those decisions. A new page inherits them. It does not re-state them in a `<style>` block.

The look stays Modern Liturgy: parchment, navy ink, Cinzel for a place, EB Garamond for a record, Libre Franklin for chrome. The step above is how things move and how much of the screen they are allowed to occupy.

Classes that carry the decisions live in `build/design-components.mjs` and ship in `public/mosaic.css`.

## Decisions

These are the choices. They are already true of `.m-btn`, `.m-icon-btn`, and `.m-side`. A page that draws its own button or its own sticky `top` has left the language.

1. **A control that can be pressed lifts.** Hover raises a button or an icon button by 1px and shifts its colour, over 200ms, on the standard ease. Pressing settles it. There is no bounce and no scale. `prefers-reduced-motion` keeps the colour and drops the lift. A row you can open does not lift — it tints — so a list does not bob. If a control does not do this, it is not finished: use `.m-btn` or `.m-icon-btn`.

2. **A side card stays on screen.** Facts beside the work — Sunday at a glance, who you are, the frame a form is written in — are `.m-side` inside `.m-with-side`. From 1024px the card sticks under the header, never grows taller than the viewport, and scrolls inside itself. The title stays put; `.m-side__scroll` is the part that moves. The card holds a title and a short set of facts, about six, not a second copy of the page. Below 1024px it stacks under the work. A side column that cannot stay in view is not a side column.

3. **One primary action.** It is `.m-btn.m-btn--primary`, and it lives in the header when the page has one. Everything else is quieter. A destructive action is an outline until deleting is the whole screen.

4. **One group is one surface.** The name sits above the card (`.m-section`), not inside a stack of cards that all say the same thing. Rows that belong together share one `.m-card-list`.

5. **Chrome is the header, once.** Back link, the place or the record, up to three actions, the account. The body does not repeat the title and does not open with an eyebrow and a fading rule.

6. **Type has a job.** Cinzel names a place. EB Garamond names a record, including a person. Libre Franklin is every control, label, and meta line. Nothing else. Work Sans and Noto Serif are not chrome.

7. **Flat and warm.** A hairline, not a shadow, except the primary button. No gradient washes, no corner rings, no photographic heroes.

8. **Empty, waiting, and failed are components.** `.m-empty` says what to do. `.m-spinner` waits. `.m-notice` says what failed, without an apology.

Comparable lists and settings ([GoPay](https://mobbin.com/screens/afec092d-2620-488d-a489-9d7707a748f0), [monday.com](https://mobbin.com/screens/14483d5b-e7d8-42ae-9d1b-95260e55574b), [Devin](https://mobbin.com/screens/3a534135-db62-4fcd-8df3-b974c2c880ed), [Aboard](https://mobbin.com/screens/ae9e27ea-e5ec-4ce8-8585-1056c78151ca)) are where the grouping and the single column came from. Their grey canvases, shadows, and pills are not part of this.

## Pick a recipe

Every page is `<body class="m-page">` plus at most one modifier, then `<header class="m-header">`, then `<main class="m-page__body">`.

| Recipe | Body | When |
| --- | --- | --- |
| List | `m-page` | A list, a dashboard, a form index. Column is `--container-max` (1200px). |
| Wide | `m-page`, main also `m-page__body--wide` | A directory or a month that needs 1600px. |
| Reading | `m-page m-page--reading` | Settings, a policy, commitments, the sign-in card’s quieter cousins. Column is 720px. |
| Tool | `m-page m-page--tool` and header `m-header--tool` | The page fills the window and scrolls inside its own panes. |
| Door | `m-page m-page--door` | One card, centred. Sign-in. |
| Home | `m-page m-page--app m-dense` | The dashboard only. Tiles fit the viewport from 1024px up. |

The gutter is `--space-margin` (32px), the same inset as the header. Do not set a page width with `max-w-6xl`, `max-w-7xl`, `max-w-[760px]`, or an inline `max-width`.

Two pages are allowed to break the header rule, and both already say so in the file: the kiosk (a foyer desk, seal and welcome, no account) and the Relations Viewer (its own bar). A new page is not a third exception.

### List

```html
<body class="m-page">
  <header class="m-header">
    <div class="m-header__inner">
      <div class="m-header__lead">
        <a class="m-back" href="index.html">
          <span class="material-symbols-outlined">chevron_left</span>
          <span class="m-back__label">Home</span>
        </a>
        <div class="m-header__titles">
          <h1 class="m-header__title">People</h1>
        </div>
      </div>
      <div class="m-header__actions">
        <button type="button" class="m-btn m-btn--primary m-btn--sm">Add person</button>
      </div>
      <div class="m-header__rule"></div>
      <div class="m-header__auth" id="auth-container"></div>
    </div>
  </header>
  <main class="m-page__body">
    <div class="m-toolbar">
      <span class="m-search">
        <span class="material-symbols-outlined">search</span>
        <input type="search" placeholder="Search people" />
      </span>
    </div>
    <div class="m-card-list">
      <a class="m-row m-row--interactive" href="#">
        <span class="m-avatar">AL</span>
        <span class="m-row__main">
          <span class="m-row__title">Ada Lowell</span>
          <span class="m-row__sub">Member</span>
        </span>
        <span class="material-symbols-outlined">chevron_right</span>
      </a>
    </div>
  </main>
</body>
```

### Reading (settings)

```html
<body class="m-page m-page--reading">
  <header class="m-header">…<h1 class="m-header__title">Profile</h1>…</header>
  <main class="m-page__body">
    <section class="m-section">
      <div class="m-section__head">
        <h2 class="m-section__title">Security</h2>
        <p class="m-section__hint">Change the password on this account.</p>
      </div>
      <form class="m-card">
        <label class="m-field">
          <span class="m-label">Current password</span>
          <input class="m-input" type="password" autocomplete="current-password" />
        </label>
        <button type="submit" class="m-btn m-btn--primary">Update password</button>
      </form>
    </section>
  </main>
</body>
```

### Door

```html
<body class="m-page m-page--door">
  <header class="m-header">…</header>
  <main class="m-page__body">
    <div class="m-door">
      <img class="m-door__mark" src="assets/mosaic-logo.png" alt="" />
      <h1 class="m-door__title">Log in</h1>
      <form class="m-card">…</form>
    </div>
  </main>
</body>
```

## Building a control

- Back link names where it goes: `Home`, `Calendar`, `People`. Never `Back`.
- A field is `.m-field`, a `.m-label`, and `.m-input` or `.m-select`. 48px tall, 16px type. The focus ring is the steel wash. Do not draw another one.
- `.m-label` is the tracked overline on a field. A section title is `.m-section__title`. Do not invent a third.
- Button copy is sentence case and names the result: “Log in”, “Update password”. The confirmation uses the same verb. Domain words come from `CONTEXT.md`.
- Icons are Material Symbols Outlined. `.m-btn--block` only inside a narrow card such as the door.

## Do not

- A sticky `top` written on the page. That is `.m-side`.
- A hover transition written on the page. That is `.m-btn`.
- A long body class instead of `m-page`.
- A hero band, a gradient wash, or a ring in the corner.
- `text-[10px] uppercase tracking-widest` on a button.
- A title in both the header and the body.
- Raw hex or `rgb()`. `npm run check:design-drift` keeps that honest.

## States

Every list and every reading page has four states, using the same components:

- **Empty** — `.m-empty` with the action that fills it, when there is one.
- **One** — the same row or section the many-state uses. Do not design a special case for a single record.
- **Many** — `.m-card-list` of `.m-row`, or `.m-section` groups.
- **Error** — `.m-notice.m-notice--error` with a sentence and, when a retry exists, the button.

Waiting is `.m-loading` with `.m-spinner`, not the word “Loading…” in 13px grey.
