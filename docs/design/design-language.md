# Mosaic page language

The token sync names colours and classes. This document is the design: how a page reads, how a person is shown, how a control behaves. A new page inherits it. It does not re-state it in a `<style>` block.

The look stays Modern Liturgy: parchment, navy ink, Cinzel for a place, EB Garamond for a record, Libre Franklin for chrome. The step above is craft. Type is large enough to read, words are sentence case, a person is a name before they are a label, and a control moves when it can be pressed.

Classes live in `build/design-components.mjs` and ship in `public/mosaic.css`. A restyle of a page that already exists lands on that page, on a test branch. A lightweight HTML prototype is only for a feature that has no page yet.

This file grows with the site. When a page update settles a choice another page could follow — spacing, a type role, how a person is shown, how a control moves, what stays on screen, empty and error — that convention is added here in the same change, and the class that carries it is named. A one-off wording change is not a convention.

## Where this came from

Mobbin does not carry Planning Center, Subsplash, Pushpay, or Church Center. These five are the closest jobs, and the structure is what transferred. Their grey canvases, black sidebars, and purple accents did not.

1. [Workable — People directory](https://mobbin.com/screens/d1b37b21-53ef-4518-b344-854c0bf7639e). The name is the headline of the row. The role is the second line. Mail and phone sit quietly beside. Filters are ordinary controls, and the active one is a chip you can clear.
2. [folk — a person](https://mobbin.com/screens/0154da86-4bbd-44fb-a38e-455f6d0e1a22). The record opens with the name, a short row of actions, then labelled facts. Notes are the work, not a panel of identical inputs.
3. [Fresha — a week and a person](https://mobbin.com/screens/8efc25e9-bef8-4514-b874-e5d62a83f6b3). The calendar is the page. The selected person is a column of a few facts with icons. Services are a grouped list you can search.
4. [HoneyBook — a list of services](https://mobbin.com/screens/a01c45ac-97dc-422f-bf2e-9be5d27fbf89). Each row is a name, a quiet description, and an overflow. One primary action. The sentence they put under the page title did not transfer: a second line in the header makes every bar a different height.
5. [Squarespace — funds](https://mobbin.com/screens/ae6d6939-d97a-4ac6-add9-9359ce214eae). A church-admin table: sentence-case headers, air, one solid primary, a sidebar that does not compete with the list.

## Decisions

A page that draws its own button, its own sticky `top`, or its own 10px tracked label has left the language.

1. **Words are sentence case.** Buttons, field labels, section names, crumbs, and status say “Save my info”, not “SAVE MY INFO”. `.m-label` is 13px and untracked. A hand-rolled control that still carries `uppercase` or `tracking-widest` is quieted by `.m-craft` until it is rebuilt as `.m-btn`. Nothing on a page is 8px or 9px.

2. **A control that can be pressed lifts.** Hover raises a button or an icon button by 1px and shifts its colour, over 200ms, on the standard ease. Pressing settles it. There is no bounce and no scale. `prefers-reduced-motion` keeps the colour and drops the lift. A row you can open does not lift — it tints. A finished control is `.m-btn` or `.m-icon-btn`, at least 36px tall, 14px type.

3. **A person is a name, then how to reach them.** `.m-person`: face, name in EB Garamond, one line of role or household, then mail and phone in the quiet colour. A stage such as Member is `.m-status`, a short tinted word beside the name, never a stamp in place of it.

4. **The header is one line, and one height.** The title names the place or the record. Nothing sits under it. A count, a template name, a date, or an event range lives in the body, or in the header’s action cluster, where it stays vertically centred and cannot change the bar’s height. `.m-header--tall` is not used to make room for a second line. A page reached from more than one place may keep `.m-header__crumbs` above the title; that trail replaces the back link and still fits the standing 64px bar. The body does not open with an eyebrow and a fading rule. A `.m-lede` belongs in a document (a policy), not under a dashboard title.

5. **One primary action.** It is `.m-btn.m-btn--primary`, and it lives in the header when the page has one. Everything else is quieter. A destructive action is an outline until deleting is the whole screen.

6. **One group is one surface.** The name sits above the card (`.m-section`), not inside a stack of cards that all say the same thing. Rows that belong together share one `.m-card-list`. A setting is `.m-setting`: the name and one sentence of help, the control on the right. A list with real columns is `.m-table`, headers in sentence case, rows tall enough for a name.

7. **A side card stays on screen.** Facts beside the work are `.m-side` inside `.m-with-side`. From 1024px the card sticks under the header, never grows taller than the viewport, and scrolls inside itself. The title stays; `.m-side__scroll` moves. The card holds a title and about six facts. Below 1024px it stacks.

8. **Type has a job.** Cinzel names a place. EB Garamond names a record, including a person. Libre Franklin is every control, label, and meta line. Nothing else. Work Sans and Noto Serif are not chrome.

9. **Flat and warm.** A hairline, not a shadow, except the primary button. No gradient washes, no corner rings, no photographic heroes. Colour comes from parchment, navy, and one tint for status.

10. **Empty, waiting, and failed are components.** `.m-empty` says what to do. `.m-spinner` waits. `.m-notice` says what failed, without an apology. A filter that is on is a chip you can clear, not a second copy of the sidebar.

11. **Chrome is the header, once.** Back link, the place or the record, up to three actions, the account. Tools (the service builder, the printable editor, the guide editor) may fill the window, and they still use these controls. They do not invent a second button language.

12. **The two desks do not match.** Home is the congregation's door. Shepherd is the elders' blotter. They share the header and the tokens, and they do not share a layout. Home (`m-page m-page--app m-dense`) is reorderable place cards, each one a large Cinzel name, with Sunday as a column the same height as that band (`#sunday-glance` inside `.m-with-side`). Four or more cards fill the window and scroll inside the grid. Three or fewer stay the height of the type, so a short row does not become a blank poster. The shepherd desk is one even band of smaller Cinzel place names — five across from 1100px, two across below that, so a leftover card stays one cell — then a to-do ledger the full width of that band. Saved views of people live on the People page. The blotter ground is `--surface-container`. Home stays on `--background`.

## Pick a recipe

Every page is `<body class="m-page">` plus at most one modifier, then `<header class="m-header">`, then `<main class="m-page__body">`.

| Recipe | Body | When |
| --- | --- | --- |
| List | `m-page` | A list, a dashboard, a form index. Column is `--container-max` (1200px). |
| Wide | `m-page`, main also `m-page__body--wide` | A directory or a month that needs 1600px. |
| Reading | `m-page m-page--reading` | Settings, a policy, commitments, the sign-in card’s quieter cousins. Column is 720px. |
| Tool | `m-page m-page--tool` and header `m-header--tool` | The page fills the window and scrolls inside its own panes. |
| Door | `m-page m-page--door` | One card, centred. Sign-in. |
| Home | `m-page m-page--app m-dense` | The congregation's door only. Reorderable place cards fill the window. Sunday is a column that stays. |

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
