# MS-229 — Recurring events, merged: what came back from Claude Design

**Pulled:** 12 August 2026. **Brief:** [`ms-229-recurring-events-merged-prompt.md`](ms-229-recurring-events-merged-prompt.md).
**Source:** `ui_kits/recurring-events/` in the **Mosaic Website Design** project
(`f2292e35-4adc-4d33-a42d-7ca9373364c9`), read with `DesignSync get_file`.

Files in the kit: `index.html` · `README.md` · `EXPORT_PROMPT.md` · `app.jsx` ·
`data.jsx` · `kit.jsx` · `screens.jsx` · `phone.jsx` · `page.css` · `recurring.css`.
The two documents below are the design's own account of itself, copied here verbatim so
the reasoning does not live only in the design tool.

---

# README.md

# Mosaic — Recurring events, merged

**MS-229.** One screen where there were two. Open `index.html`.

Files: `recurring.css` (the six proposed primitives, tokens only) · `page.css` (this
page's own layout — not proposed as components) · `data.jsx` (the real values, and the
label/sentence logic lifted from `recurring-events.js`) · `kit.jsx` (primitives) ·
`screens.jsx` (the screen and its four tabs) · `phone.jsx` (390px) · `app.jsx` (the cases).
The header is MS-187's `.m-header`, linked from `../headers/header.css` — the shipped
`recurring-events.html` already uses it.

---

## The screens in the kit

| # | Screen | What it settles |
| --- | --- | --- |
| 1 | **The shape** — 1440, Sunday Service, Rota tab | List panel left, four tabs right, the sticky footer at the foot of the pane |
| 2 | **Nothing ticked** | The buttons say which dates they would take before you press them |
| 3 | **Five ticked, scattered** | The run sweeps two more, and **both** buttons say seven |
| 4 | **Four ticked, one of them past** | Emptying works on the set, not the run, and leaves the past alone |
| 5 | **Ticked, then another tab** | The count survives the tab change and offers the way back |
| 6 | **Roles & rules** | Liturgical shown and locked; servant roles; the cross-role composer |
| 7 | **The event · Sunday** | Settled in three places on one tab; the fourth is on *Who can see it* |
| 8 | **The event · Youth Group, half-typed** | Unsaved work, and what the tab looks like carrying it |
| 9 | **Who can see it · Youth Group** | The five rungs, and the checkbox that sometimes means nothing |
| 10 | **Who can see it · Sunday** | A sentence where a control would be greyed out |
| 11–12 | **The reader's lane** | Same room, fewer doors; and a pattern that has run out |
| 13–19 | **States** | Loading · signed out · nothing repeats · no roles on this event · a rule whose type is no longer shared · the rota half-emptied · a read that failed |
| 20–23 | **390px** | The events · one event's rota · one event's details · the reader's lane |

## Components used

| | |
| --- | --- |
| Composed as-is | `.m-header` (MS-187, with `--sticky`, `--compact`, `__title--serif`) · `.m-back` · `.m-btn` (`--primary` `--secondary` `--ghost` `--quiet` `--sm`) · `.m-icon-btn` (`--sm --ghost`) · `.m-input` · `textarea.m-input` · `.m-input-hint` · `.m-select` + `.m-select-wrap` · `.m-check` · `.m-label` (`--sm`) · `.m-badge` (`--neutral`) · `.m-card` · `.m-card-list` · `.m-row` (`--interactive`, `__main` `__title` `__sub` `__chevron`) · `.m-empty` · `.m-spinner` · `.m-field` |
| **New primitives** | **SplitView** `.m-split` (`__list` `__pane`) · **PickList** `.m-picklist` (`__item` `--current` `__dot` `__main` `__name` `__line` `__meta`) · **Tabs** `.m-tabs` (`__tab` `--current` `__dot`) · **RotaGrid** `.m-rota` (`__scroll` `__table` `__stick` `__col` `__head` `__day` `__date` `__state` `--picked` `__cell` `__place` `__initials` `__name` `__hole` `__none` `__role` `__rolesub`) · **ActionBar** `.m-actionbar` (`__said` `__count` `__note` `__acts`) · **Notice** `.m-notice` (`--gold` `--info` `--warning` `--error`) · **Settled** `.m-settled` |
| **New variant** | `.m-btn--danger-outline` — the destructive action that must be findable without being the thing your eye lands on. `--danger` is a filled red button, and red on this screen means somebody declined. |
| Small helpers | `.m-locked-role`, `.m-rule-row` (`--unavailable`, `__text`) — two rows that are nearly `.m-row` but carry a lock/serif sentence instead of a title |

`.m-card` was not bent into a table. The rota is its own primitive because it needs a
sticky first column, tickable column headers, and cells that draw an absence.

---

## The decisions section 4 left open

**Four tabs: Rota · Roles & rules · The event · Who can see it.** Colour rides with the
event's details — it is one row of eight swatches and nobody opens this screen to change
it. *Who can see it* earns its own tab: five rungs each carrying a sentence, a checkbox
that means nothing at two of them, and the only setting here with a security consequence.
Burying it under a name field is how an Elders' Meeting ends up readable by members. The
cross-role rules sit under the roles they are about, because a rule you cannot read the
role names beside is a sentence with no subject.

**The drafting buttons are the pane's sticky footer, on every tab.** The hardest thing on
the screen. The ticks are made on the rota and the count rides on the buttons, so the
buttons cannot be a tab away; and the grid is long enough that a header would scroll them
off — which is why the shipped page draws them twice, once above the grid and once in the
count panel. A footer that belongs to the *pane* draws them once, holds still while the
grid scrolls under it, and stays honest on the other three tabs: the count says "on the
rota" and a ghost button goes back to them.

**The list rows** carry a colour dot, the name, the pattern, and `5 roles · next 17 Aug`.
"Edit the event" is gone — the tabs are that door. The selected row keeps a navy left edge,
a tonal step, a semibold name and a chevron. **The name wraps rather than truncating**:
the longest one is 38 characters, there is no stored cap, and a truncated name in the one
list that identifies the subject of the whole screen is a bug waiting to be filed.

**Nothing selected does not exist.** Five rows, and an empty right half teaches nobody
anything. The first event is always open; the URL still carries `?series=`.

**The phone is two screens, not two columns.** At 390px a 320px panel beside anything is a
panel and nothing else. The list is a screen; tapping an event replaces it, and the back
chevron returns to it. The rota is kept and scrolls sideways inside its own container with
the role column pinned — reading a rota on a phone is a real thing to want. Drafting is
not offered at all, and the footer says why rather than ending the journey with a shrug.

**Unsaved work.** The typed fields need a press; the time saves on change (both as
shipped). Switching tabs keeps the edit, and *The event* carries an amber dot — amber,
because red means somebody declined. Nothing is discarded and nothing is auto-saved, so
there is no "are you sure" to write.

**The header stays `Recurring events`, with Calendar behind the chevron.** The selected
event's name is the pane's own EB Garamond head, not the page title: the list is still on
screen, so the page is still a place. A Cinzel title that changed as you clicked rows
would make one screen feel like five. On the phone, where the list is gone, the event's
name *is* the title — and it is a record, so EB Garamond, exactly as the phone's TopBar
already does it.

---

## Where the digest and the code disagreed — and which I followed

1. **The count on the drafting buttons. Followed the code.** §2 says `Auto-assign` →
   `Auto-assign 5 dates` from a panel reading `5 dates ticked`. `recurring-events.js`
   reads `range.spans`, which is the ticked dates **plus the ones swept in between** — so
   a scattered five-tick selection labels both buttons `7 dates` while the panel says `5
   dates ticked`. That is the honest number (seven dates really do open) but the two
   numbers sitting an inch apart is the part worth a decision. Screen 3 shows it as the
   code behaves. If the intended reading is §2's, `draftLabel` and `byHandLabel` should
   use `range.count` and the sweep sentence stops being load-bearing.
2. **When the emptying sentence appears. Followed the code.** §2 presents both the sweep
   sentence and "Taking everybody off would empty 3 dates…" as if they co-occur.
   `wipeNote` is deliberately **silent** when the button will do exactly what the ticks
   say, and speaks only about past or already-empty ticks. Screens 3 and 4 split them.
3. **`2 places` on a role row.** The code writes `placeCount + (placeCount === 1 ? '
   place' : ' places')`, so a one-place role reads `1 place`, not `1 places` and not
   nothing. Rendered as the code does.
4. **A bug found on the way, in neither document.** The list row's third line is
   `roleCountOf(s) + ' · next ' + nextDateOf(s)`, and `nextDateOf` returns the string
   `Nothing coming up` when the pattern has run out — so a finished series reads
   **"4 roles · next Nothing coming up"**. §2 says the row should say `Nothing coming up`.
   No event in the kit's list has run out, so the kit does not render the fault; it is
   flagged here because the fix is in `roleCountOf`/the template (emit `4 roles · nothing
   coming up`), not in the design.
5. **The two lanes' empty states are different strings in the code.** The editor gets "A
   recurring event is anything that comes round — a Sunday, a midweek gathering, an
   elders' meeting. Make the first one and its rota appears here."; the reader gets "When
   the church has something that comes round — a Sunday, a midweek gathering — it appears
   here." §2 quotes only the first. Both kept, each in its own lane.

---

## What the tabbed shape forced

Worth knowing before it is built, not after.

- **The rules and the rows they constrain are now one click apart.** On the shipped page
  the cross-role rules sat directly under the grid, so you read "Kids Leader and Kids
  Helper cannot be from the same Marriage" with those two rows in view. Tabs break that
  pair. If it bites, the answer is a rule marker on the rota's role rows — not a fifth tab.
- **The pattern and the rota were on two screens and are now on two tabs**, which is no
  better on its own. So the pane header restates the pattern and the place above the tab
  bar, on every tab: the one fact the rota needed from the other screen never leaves the
  screen.
- **"The next few" dates and the grid columns are the same dates in two shapes.** The old
  event screen had to hand you a date because it had no grid; now the Rota tab is the
  better answer and the list on *The event* survives only for the Sunday's second link,
  Order of service. If that link moves to the rota's column menu, the list can go.

---

## Invented, placeholdered, or otherwise not in §2 or the code

Everything below is a guess. Nothing else on the screen is.

**Structure and labels** — the four tab names; the amber unsaved dot; the `Settled` badge
and the visibility badge in the pane header; the `Events` back label on the phone; the
`Show the rota` button.

**Copy** — "Tick columns **on the rota** to open exactly those dates instead." (the code's
string says "below", which is only true on the Rota tab) · "5 dates ticked **on the
rota**" · "Unsaved. Your changes stay here until you press save." · "Drafting a rota is a
wide grid of dates against roles, so it waits for a computer. Reading this one does not."
(phone) · "Everything that comes round again. Open one for its rota and its settings."
(phone list) · "Saved as you set it." prefixed to the shipped "Unless one date has its own
time." · "The rota could not be read." as a stand-in error message · `1 person` / `2
people` trailing a role row (the code renders an unread `role.needed`).

**Data** — which of the eight people sit in which cell; the place counts (Welcome Team 2,
Sound Desk 1, Coffee 2, Kids Leader 1, Kids Helper 1); which roles each event carries; the
one-off job **"Unlock the hall"** on 24 Aug; the cancelled 14 Sep; the two declines (Tom
Brackley on the sound desk, Ann Kerrigan on coffee, both 31 Aug); the descriptions for
Midweek Gathering and Youth Group; every "next" date and the Coming-up dates; the windows
`17 Aug – 5 Oct` and `10 Aug – 28 Sep`. The dates are the brief's — 17 Aug is treated as a
Sunday because §2 says so.

**CSS** — the six primitive names and their class trees, `.m-btn--danger-outline`,
`.m-locked-role`, `.m-rule-row`. Every colour is a `var(--token)`; the two tints on a
ticked column are `color-mix` over `--tertiary`, which is what `rgba(93,148,169,.07)` in
the shipped page already was.

**Kit chrome only** — each frame mounts its screen when it comes near the viewport, so a
page holding twenty-three screens stays usable. Nothing about the design depends on it.

---

# EXPORT_PROMPT.md

# Export prompt — MS-229 Recurring events, merged

Paste this into `/design-sync` (or hand it to whoever carries the change into
`mosaic-website`).

---

Merge `public/calendar-event.html?series=<id>` into `public/recurring-events.html`. The
merged page replaces both. The screen for one **date** —
`calendar-event.html?id=<seriesId>_<date>` — is untouched and out of scope.

**The shape.** `.m-header` stays as it is (`--m-header-max: 1600px`, back label
`Calendar`, the `New recurring event` primary action, `#auth-container` untouched). Under
it, `<main>` holds one `.m-split`: the event list in `__list`, and one `.m-split__pane`
carrying **everything about the selected series** as four tabs — **Rota · Roles & rules ·
The event · Who can see it**. One series is always open; `?series=<id>` still selects it
and the first is the default. `series-list` rows lose the `Edit the event` link: the tabs
are that destination, and `calendar-event.html?series=` stops being reachable as a page.

**Add to `build/design-components.mjs`**, exactly as written in
`ui_kits/recurring-events/recurring.css`, tokens only, no shadows,
`@media print { .m-actionbar { display: none } }`:

- **SplitView** `.m-split` — Layout. `__list`, `__pane`; `--m-split-list` (default 320px);
  stacks under 1000px by media **and** container query.
- **PickList** `.m-picklist` — Layout. `__item`, `__item--current`, `__dot`, `__main`,
  `__name`, `__line`, `__meta`. The selected row is a tonal step plus a 3px `--primary`
  left edge. `__name` **wraps**; it must not truncate.
- **Tabs** `.m-tabs` — Layout. `__tab`, `__tab--current`, `__dot`. 44px tall, tracked caps,
  2px `--primary` underline, `overflow-x: auto` so a phone scrolls it. `__dot` is
  `--warning`, static.
- **RotaGrid** `.m-rota` — Display. `__scroll`, `__table`, `__stick`, `__col`, `__head`,
  `__day`, `__date`, `__state` (`--full` `--declined` `--off`), `--picked`, `__cell`,
  `__place`, `__initials` (`--declined`), `__name` (`--declined`), `__hole`, `__hole-dot`,
  `__hole-label`, `__none`, `__role`, `__rolesub`. Replaces the page-local `.re-grid`
  block. The sticky first column and the tinted ticked column are the component, not the
  page.
- **ActionBar** `.m-actionbar` — Layout. `__said`, `__count`, `__note`, `__acts`. Sticky to
  the bottom of its pane.
- **Notice** `.m-notice` — Feedback. `__icon`, `__body`, `__title`, `__text`, `__acts`;
  `--gold` `--info` `--warning` `--error`. This replaces the hand-rolled edged bars in
  `recurring-events.html` (signed out, error, the ticked-count panel) and the matching ones
  in `calendar-event.html`.
- **Settled** `.m-settled` (+`--sm`) — Display. The serif sentence that stands where a
  greyed-out control would be. Four of them on this screen.
- **Button** gains `.m-btn--danger-outline`. `Take everybody off` uses it. Do not use
  `--danger`: a filled red button on this screen collides with "somebody declined".

**Move, do not rebuild:** the `managingSeries` block of `calendar-event.js`/`.html` moves
into `recurring-events.js`/`.html` unchanged in behaviour — `seriesDraft`,
`saveSeriesDetails`, `saveSeriesTime`, `openPattern`, `addSeriesRole`,
`askRemoveSeriesRole`, `setColour`, `setSeriesVisibility`, `setSeriesRosterShared`,
`seriesNextDates`, `orderOfServiceHref`, `liturgicalRoles`, `servantRoles`, and the
`isSundaySeries` settled sentences. The cross-role rule composer (MS-221) stays exactly as
it is and moves onto the **Roles & rules** tab. `restampSeriesVisibility` and its rank
argument are unchanged. Delete the `managingSeries` branch from `calendar-event` once the
tab ships, and the `backHref`/`backSentence` pair with it.

**The drafting footer.** `draftHref`, `byHandHref`, `draftLabel`, `byHandLabel`,
`wipeLabel`, `wipeNote`, `wipeWarning`, `takeEverybodyOff()`, `clearSelection()` are
unchanged and render **once**, in `.m-actionbar` at the foot of the pane — not twice as
today. The bar is present on all four tabs; on a tab other than the rota the count reads
`… on the rota` and a ghost `Show the rota` switches tab. `selected` is per series and
clears when the selection in the list changes (it already does).

**Two things to decide, not to code around:**
1. `draftLabel`/`byHandLabel` use `range.spans`, so with a scattered selection the panel
   says `5 dates ticked` and the buttons say `7 dates`. That is truthful and it is also two
   numbers an inch apart. Either keep it (the sweep sentence carries the explanation) or
   move both labels to `range.count`. The design ships the code's behaviour.
2. `roleCountOf(s) + ' · next ' + nextDateOf(s)` renders **"4 roles · next Nothing coming
   up"** for a series whose pattern has run out. Fix the composition, not the design: emit
   `4 roles · nothing coming up`.

**The phone.** `html.shell-mobile` keeps hiding `body > header`; the shell's own bar draws
the title. At `≤640px` the list and the pane become two screens: the pane is shown when a
series is selected and the shell's back returns to the list. Keep the rota (it scrolls
inside `.m-rota__scroll`, role column pinned, `min-width` reduced by the component's own
container query) and keep `.re-desktop-only` on everything that opens the draft room —
`.m-actionbar` renders its one explanatory sentence instead. The event's name is the phone
title in **serif** mode, not display.

**Unchanged contracts:** every read stays constrained by visibility
(`Core.visibilityQueryFor`); the Liturgical Roles are shown, locked, and never a row on the
grid or a fillable place anywhere on this screen; `wipeFor` still works on the ticked SET
and leaves the past alone while `rangeFor` still sweeps; the page never scrolls sideways —
only `.m-rota__scroll` does.

**Flag for content, not code:** the page title `Recurring events` is still sentence case
against the readme's Title Case rule (raised in MS-187, still nobody's).

---

## Component prompt (for the new `components/*.prompt.md` files)

**RotaGrid** — Roles down the side, dates across the top, and what is really stored in the
cells. The role column stays put while the dates scroll, each column header ticks, and an
unfilled place is drawn rather than left blank — seeing the hole before the morning it
matters is the whole point of reading ahead.

```html
<div class="m-rota"><div class="m-rota__scroll"><table class="m-rota__table">…</table></div></div>
```

**Tabs** — The tab bar inside a pane, when one selected thing has more sides to it than a
page can stack. 44px, tracked caps, a 2px underline on the current one, and a `__dot` when
a tab is holding unsaved work.

**ActionBar** — A pane's own sticky footer: what the current selection adds up to, said in
words on the left, and the actions that take it somewhere on the right.

**Notice** — The edged bar: signed out, a read that failed, a write that half-failed, or
what the ticks add up to. One component, four tones, replacing eleven hand-rolled copies.

**Settled** — Where something cannot change because it is settled, the sentence is the
control. Greying one out implies a permission you might one day be given.

**SplitView** / **PickList** — A list of things beside the one that is open, where picking
a row changes the whole right-hand side rather than navigating away.

Built from the Mosaic tokens only — no raw colours, no second icon set.
Icons are Material Symbols Outlined.
