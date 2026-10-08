# Mosaic page language

The token sync names colours and classes. This document is the design: how a page reads, how a person is shown, how a control behaves. A new page inherits it. It does not re-state it in a `<style>` block.

The look stays Modern Liturgy: parchment, navy ink, Cinzel for a place, EB Garamond for a record, Libre Franklin for chrome. The step above is craft. Type is large enough to read, words are sentence case, a person is a name before they are a label, and a control moves when it can be pressed.

Classes live in `build/design-components.mjs` and ship in `public/mosaic.css`. A restyle of a page that already exists lands on that page, on a test branch. A lightweight HTML prototype is only for a feature that has no page yet.

This file grows with the site. When a page update settles a choice another page could follow — spacing, a type role, how a person is shown, how a control moves, what stays on screen, empty and error — that convention is added here in the same change, and the class that carries it is named. A one-off wording change is not a convention.

Every convention here also passes the another-church test in `AGENTS.md`. It works for another case of the same kind, and for another church within ordinary variation. A heading, a field list, or a workflow that only fits this congregation is not a convention.

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

8. **Type has a job.** Cinzel names a place. EB Garamond names a record, including a person. Libre Franklin is every control, label, and meta line. Nothing else. Work Sans and Noto Serif are not chrome. Home place cards are the exception: the name is Libre Franklin, because the card is a control in a grid of them. Cinzel on that page stays on the wordmark and the Sunday date.

9. **Flat and warm.** A hairline, not a shadow, except the primary button. No gradient washes, no photographic heroes. Colour comes from parchment, navy, and one tint for status. Home is the one place with corner rings: `.dash-ambient` draws the seal’s rings on the window, bleeding off its edges, behind the page. They drift and follow the pointer. A faint hexagon (`.dash-ambient__cursor`) turns slowly and trails the pointer by about 0.4 seconds. `prefers-reduced-motion` holds them still. The window itself does not scroll. The column does, and its scrollbar is a thin thumb on a clear track. A card does not grow rings of its own.

10. **Empty, waiting, and failed are components.** `.m-empty` says what to do. `.m-spinner` waits. `.m-notice` says what failed, without an apology. A filter that is on is a chip you can clear, not a second copy of the sidebar.

11. **Chrome is the header, once.** Back link, the place or the record, up to three actions, the account. Tools (the service builder, the printable editor, the guide editor) may fill the window, and they still use these controls. They do not invent a second button language.

12. **The two desks do not match.** Home is the congregation's door. Shepherd is the elders' blotter. They share the header and the tokens, and they do not share a layout. Home (`m-page m-page--app m-dense`) leads with this Sunday (`.dash-sunday`): the date in Cinzel, the theme in EB Garamond, the other facts beside that, and — for someone who can fix the Order of Service — whether it is ready. That readiness is one tally, the same “N of M set” on this card, on the phone, and as the service editor’s progress: the three leaders, then each element of this Sunday's Liturgy Order. A song counts once it is linked to the book, and a song pulled out of the order does not count. A people element (a baptism) is in the tally once somebody is on it. An element somebody carries is blank until that person is named. A Sunday that still has an old irregular list, and has not been given a Liturgy Order, is not in the tally: the editor says Custom order, and the home card does not call it unfinished. Theme, the key verse, and the optional prayer leaders are readings on the service, not part of the tally. Place cards (`.dash-tiles`) sit under that, five across from 1100px, three from 720px, two below. Each card is a filled primary medallion, a Libre Franklin name, and one description; the description hides below 720px. They stay reorderable. Under the cards, a commitments line and a this-week line (`.dash-strip`) appear only when there is something to say. The seal’s rings (`.dash-ambient`) sit on the window, run off its edges, and follow the pointer; a faint hexagon (`.dash-ambient__cursor`) turns slowly and trails the pointer by about 0.4 seconds. The window does not scroll; the column does. The shepherd desk is one even band of smaller Cinzel place names — four across from 1100px, two across below that — then, for accounts that read as editor, a quieter **Insights** strip (`.shep-insights`) linking to Service Analytics, then a to-do ledger the full width of that band. Service Analytics is not a home tile. Saved views of people live on the People page. The People side panel swaps from the search to the tag vocabulary and back; it does not open a second page. On that page the one primary action sits in the header (`.m-header__actions`). Search, sort, and the count are one row (`.people-toolbar`), and the filter card starts in that same band. Sort words are sentence case. Relationship types and families are tabs on the Relations viewer, under that viewer's own bar, and that viewer is their only home. The blotter ground is `--surface-container`. Home stays on `--background`.

## Pick a recipe

Every page is `<body class="m-page">` plus at most one modifier, then `<header class="m-header">`, then `<main class="m-page__body">`.

| Recipe | Body | When |
| --- | --- | --- |
| List | `m-page` | A list, a dashboard, a form index. Column is `--container-max` (1200px). |
| Wide | `m-page`, main also `m-page__body--wide` | A directory or a month that needs 1600px. |
| Reading | `m-page m-page--reading` | Settings, a policy, commitments, the sign-in card’s quieter cousins. Column is 720px. |
| Tool | `m-page m-page--tool` and header `m-header--tool` | The page fills the window and scrolls inside its own panes. |
| Door | `m-page m-page--door` | One card, centred. Sign-in. |
| Home | `m-page m-page--app m-dense` | The congregation's door only. Sunday across the top (`.dash-sunday`), then reorderable place cards (`.dash-tiles`). |

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

## Named shapes

Some records follow one of several named shapes the congregation keeps. A Sunday and its Liturgy Order is the first ([ADR 0080](../adr/0080-liturgy-orders.md)); `service-builder.html`, `liturgy-orders.html` and the Services table are the example. A second record like this uses the same pieces.

- **Picking the shape.** A labelled `<select>` on the record, and beside it a manage `m-icon-btn m-icon-btn--sm m-icon-btn--ghost` with the `tune` icon and an `aria-label` that says what it manages. The default shape comes first and reads “(default)”. The rest follow by name. Changing the select moves only the record's pointer, saved as one field. Values the new shape does not show stay on the record and come back with the shape.
- **Composing the shape.** The parts are a fixed set of kinds. A shape is a sequence of instances of those kinds, and the same kind can be placed more than once. Composing happens on the shape's own page, and only there. The record shows the sequence already locked, and fills each row's value. The kinds are a panel to the left of the sequence. Below 1024px that panel stacks above it. The kind's row itself drags into the sequence — the drag indicator is a cue, and the row is the handle — and **Add** does the same insert. A kind that takes a name is named on the shape. A kind that takes a value is filled on the record. A row with nothing to fill does not open. A prayer can say it sends requests. Each person is one line — a man, a woman, or anyone — and a plus adds a line. The days they are told are a list on that prayer. Clicking the prayer opens a card for the message that goes out and the response that comes back. The prayer's name keeps its own line, and its settings sit under the name, so they stay readable beside that card. A prayer can say it can be prayed by someone other than the service leader. On the record, that person is named in the row's panel, and only when the prayer says so. The people a prayer asks for are filled in that same panel, with the request text under them. Older leader and pastoral fields, from before a shape had those prayers, are filled in the panel of the row the shape already uses for that moment. Each instance can take a note. Rows already in the shape rearrange by the grip, with move-up and move-down beside it. Taking an instance out leaves the record's values. The page names the shape, because the combination changes for every record that follows it. That write is the shape page's Save, and it is separate from the record's own fields. A failed read of the shapes shows the default and does not offer the gesture, so the stand-in cannot be written back.
- **Editing the shapes.** Their own page fills the window (`m-page m-page--tool`). The header and the kinds panel stay put. The sequence scrolls on its own. Selecting a prayer that sends requests opens a card to the right of the sequence, holding the message and the response, and that card scrolls on its own. Below 1280px the card sits under the sequence. Below 1024px the kinds panel keeps its own height and the sequence scrolls in what is left. The kinds are the left panel. Which shape is open is a labelled select above the sequence; the default reads “(default)”. An `m-icon-btn m-icon-btn--lg m-icon-btn--outline` with the `add` icon sits to the right of that select. Its `aria-label` names the new shape (“New order”). It makes an empty one and focuses the name. Other records read every edit, so this page is the exception to autosave. The header holds an `m-btn--primary` **Save**, disabled until something changed, and an `m-btn--quiet` **Discard**, shown only when there is a draft. Leaving with a draft asks first. A delete confirmation says what stays: “Sundays that follow it will read as Standard. Nothing they hold is deleted.” A failed read is an `.m-notice.m-notice--error` with **Try again**, and the sentence names the cause. The default shape stays on the page under that notice, and it is not a draft: Save and Discard stay off until the read succeeds, so the stand-in cannot be written back.
- **Reordering a list.** Each `.m-row` leads with `.m-row__handle` (`drag_indicator`, `aria-hidden`) and ends with move-up and move-down `m-icon-btn`s whose labels name the row (“Move Sermon up”). The buttons are the keyboard and screen-reader path. The grip is never the only way. After a move, focus stays on the same button in the moved row, or on its other move button at the end of the list. The first row's up and the last row's down are disabled, not hidden.
- **Columns from named sets.** A table whose columns come from several shapes has an `m-toolbar` over it. The toolbar holds an `m-label` naming the sets, one `m-check` per set, and at the end a quiet `m-btn--sm` through to the editing page. The columns are the union: the default set first in its own order, then each other set's new columns, with the sets taken by name and each column placed where it is first seen. The default set alone is on until somebody changes it, and the choice is remembered on that device. Identity columns (the date, who leads) stay whatever is ticked.

## Do not

- A sticky `top` written on the page. That is `.m-side`.
- A hover transition written on the page. That is `.m-btn`.
- A long body class instead of `m-page`.
- A hero band, a gradient wash, or a ring in the corner.
- `text-[10px] uppercase tracking-widest` on a button.
- A title in both the header and the body.
- Raw hex or `rgb()`. `npm run check:design-drift` keeps that honest.

## Hymn book

The hymn book is a tool (`m-page m-page--tool`) with a standing header, not a tool header. The bar keeps the words on Copy attribution and Cancel. The title in that bar is the place, **Hymns**. The hymn’s own name is the record, set in the reading rail in EB Garamond.

On a wide window the book is two panes that scroll on their own.

- **The list.** A tag rail (220px) of checkbox rows, each with how many hymns that tag would leave in the list. Chosen tags also read “Tagged with all of” above the cards, and a tag narrows by AND. The cards are the sheets: the printing version’s first page, or a staff when the hymn has no scan, then the name and the words writer.
- **A hymn.** The chosen version’s pages sit on the warm pane. The rail (320px) holds the name, the words and music credit, the tags, the versions, and the attribution. Picking a version changes which pages are open. Which version prints is set in the editor, with the star.
- **The editor.** The same split. Pages and versions on the warm pane; the hymn’s fields on the rail. Delete stays on the rail, and only for a hymn that already exists.

Below 1024px the reading and the editor stack, sheets first. On a phone the tag rail gives way to the tag menu, and the frame around a sheet goes so the staves get the width of the phone.

## States

Every list and every reading page has four states, using the same components:

- **Empty** — `.m-empty` with the action that fills it, when there is one.
- **One** — the same row or section the many-state uses. Do not design a special case for a single record.
- **Many** — `.m-card-list` of `.m-row`, or `.m-section` groups.
- **Error** — `.m-notice.m-notice--error` with a sentence and, when a retry exists, the button.

Waiting is `.m-loading` with `.m-spinner`, not the word “Loading…” in 13px grey.

## Printable folio print

**Print folio** (editor File menu, view-only header) lays two pages on one landscape sheet, the same saddle-stitch order as the service guide editor. The sheet class is `.pr-folio-sheet`; each page sits in a `.pr-folio-leaf` at the page's own inch size. A half-letter page therefore prints at letter landscape. The label is **Print folio** (with `…` inside the editor's File menu, where the other print item already uses it). Flat **Print** stays the one-page-per-sheet path. On a Sunday booklet the view page says which button folds on the copier and which one is already paired.

## Printable editor — scalar inserts (MS-689)

The data drawer opens on two jobs. **Repeat a box** (`.pe-drawer__cta`, heading “Repeat a box”) is always there until a box is already repeating. A selected box gets **Make this element iterated**. Quick lists — Announcements, Hymn pages, Order of service, Kids questions, Sundays — call the same path and open the **Query** builder on that list. **All lists…** opens the builder with every iterable list. A text or a picture tells you to select the box around it; the query builder stays shut until that box repeats.

**This Sunday** (`.pe-sunday`) sits above the single-value cards. Chips are grouped **Service**, **Hymns**, and **Booklet text**. Drag a chip onto a text. A hymn name is the hymn slot (Second hymn, Closing hymn). Booklet text is one list of the Sunday booklet fields. It does not split into a heading per pamphlet. Scripture citations are not in this card.

Below that, **single values** use stacked **`.pe-typecard`** cards (Variant C): **Scripture references**, **Filled on the event**, then **Date, page, and files**. Scripture and the date group are **`.pe-fold`** (`<details>`), shut until opened, so they do not fill the drawer. Each open card configures inline (segmented mode controls, compact `.pe-in` fields) and ends with **`.pe-typecard__foot`**: a live preview (`.pe-typecard__live`) and one draggable **`.pe-chip`**. Divider copy is **`.pe-scalars-divider`** (“Single values”). Brand assets upload only — no pre-seeded church constants; list rows use **`.pe-asset-row`**. Dense desktop type (10–12px labels, 6px gaps) matches the rest of the printable drawer.

**Scripture references** lists this Sunday's citations (key verse, calls, reading, sermon, benediction). Each row is **`.pe-scripture-row`** with the live reference and two chips: **Reference** (the citation) and **Words** (the verses, styled, citation line on, short copyright on). Plain text, verse numbers, and copyright off stay on the element panel after the wire lands.

**Filled on the event** is a blank the occurrence supplies. Add **Text**, **Image**, **Number**, **Date**, or **List**. A scalar chip drags onto an element. A list iterates the selected box; its columns are **`.pe-event-col`** chips dragged inside that box. The names live on the printable. The values live on the occurrence for that date.

**Wired to this element** (`.pe-drawer__section--wired`) sits at the top of the data drawer whenever the selection is bound. The connector lands on that chip (`.pe-chip--land`). A hymn name, a Sunday date, or a country map whose catalog card is hidden still has a chip here, so the line stays in the drawer.

## View date

The clock a printable is read as of sits in the editor header, always visible: a week-earlier control, an **As of** date, and a week-later control (`.pe-asof`). It is not only in the File menu. The view-only page names the same date in the header. **Send snapshot to…** stays in the File menu, next to Print.

On a Sunday's Files tab, a linked printable offers two text buttons, **From this date** and **Before this date**. A date that is not a Sunday keeps the edit icon and opens as of that date. A scripture wire offers **Citation** and **Passage** in the element panel; a passage then offers **Styled** / **Plain** and the verse-number, heading, footnote, citation-line, and copyright-line checks. The same Reference and Words chips live on the **Scripture references** card in the data drawer.

## Filled on the event

A printable is linked from the recurring event's **Printables** tab, and from a Sunday's **Files** tab. The button is **Link a printable**. The link is stored on the series, so every date of that event opens it. The same button stays on a single date's page.

Where a printable is linked, the row opens the preview. An editor — and anyone who writes as an editor — types on that preview, in the spot the blank already occupies. Below editor the same page is static: no boxes and no count. Print and folio stay static either way.

The preview header stays on screen (`.m-header--sticky`) while the pages scroll under it. Zoom sits in the bottom-right corner (`.pv-zoom`): minus, the percent, plus. The percent fits the page again. Control-scroll, or command-scroll, zooms the same way, and so do Control-plus, Control-minus, and Control-zero. A zoom someone chose stays until they fit the page again.

A blank is a value a person supplies. That is a field filled on the event (text, image, number, date, or one cell of a list) and Sunday booklet text the page is wired to: prayer-country facts and Mosaic Kids. A live Sunday, a hymn, scripture, and announcements are not blanks. Announcements stay on the Announcements tab. The same blank placed twice is one blank. An empty list that drew no rows is one blank, with **Add a row** or **Add a question** on the list itself.

A card on the preview (`.pv-go`, `role="status"`) reads **16 left to go** or **1 left to go**. It is hidden when the page has no blanks. The words are a button: they open the next blank. Arrows on the card move through the blanks still empty, wrapping. The blank you land on is scrolled into view and focused. When the last blank is filled, the card becomes a green check (`.pv-go--done`) and the check pops once; a page that was already full shows the check still, without the pop. `prefers-reduced-motion` skips the pop. Typing saves when the box loses focus. The words for the event stay on that occurrence. Sunday booklet text stays on that Sunday, so every printable bound to it reads the same words. The Files tab does not list the blanks again.

## Sunday announcements

The Announcements tab on a Sunday (`service-builder.html`) is two lists. **This Sunday** is what an editor types for that date and saves on the Sunday. **From events** is every printed announcement the handed-out guide would include — any public event, and the Sunday Service — each card linking to the event where those words are edited. The printed lines are not copied onto the Sunday. Empty uses `.m-empty`. One card and many cards are the same `.m-card`. A failed read is `.m-notice.m-notice--error` with **Try again**.
