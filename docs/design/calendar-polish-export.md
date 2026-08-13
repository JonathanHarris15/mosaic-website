# MS-230 — Calendar cleanup pass: what came back

**Pulled from:** `ui_kits/calendar/` in the Mosaic Website Design project
(`f2292e35-4adc-4d33-a42d-7ca9373364c9`), 13 August 2026.
**Asked for in:** `docs/design/calendar-polish-prompt.md`.

Files in the kit: `index.html` · `calendar.css` (the three proposed primitives) ·
`page.css` (the page's own furniture) · `data.jsx` · `kit.jsx` · `screens.jsx` ·
`phone.jsx` · `app.jsx` · `grid-options.html` / `grid-options.css` / `grids.jsx` (three
grids drawn before the chosen one) · `README.md` · `EXPORT_PROMPT.md`.

Both of the design's own documents are reproduced below, verbatim. Decisions taken on the
pull go at the top of the PRD on MS-230, not here.

---

## The design's README

### The thesis

**A quiet week should be parchment, eight thin colour bars and type.**

Today four of the six chip families carry a tinted background, so an ordinary Wednesday
with a prayer meeting and a midweek gathering draws two filled blocks — and by the time
something is actually wrong, the screen has no louder register left to use. The rule the
code already states is the fix: *a chosen event colour only ever draws the bar, a tint
only ever fills.* Extended one step — **a fill means the app is asking something of you** —
it settles the whole screen:

| Family | Was | Is |
| --- | --- | --- |
| `off` | dashed bar, struck through, 55% | unchanged |
| `declined` | error fill, `priority_high` | unchanged — the loudest thing on the page |
| `unfilled` | warning fill, small `warning` | unchanged, glyph up from 8px to 13px |
| `mine` | `--surface-container` fill | **no fill** — the navy dot and a semibold name |
| `sunday` | bar only | unchanged, name in EB Garamond |
| `other` | `--surface-container-low` fill | **no fill** — bar and name |

Loudness order survives, and the two that ask something of somebody are now the only two
that fill.

### The screens in the kit

| # | Screen | What it settles |
| --- | --- | --- |
| 1 | **At rest** — 1440, August, a member | The common case: no fills, no legend, the weekend washed |
| 2 | **The editor's bad week** | A decline, two dates short, one moved, one out for cover |
| 3 | **Four things on one Sunday** | Three chips and "{n} more"; the 38-character name wraps |
| 4 | **One event on five days** — November | Half-term named every day, quieter after the first |
| 5 | **List** | Weeks as headed groups; the four badges are `m-badge` |
| 6 | **The rail** | Two panels; six commitments and six rows needing sorting, at 300px |
| 7 | **States** | Empty month · signed out · the four load failures · loading |
| 8 | **A day you clicked** | The menu, at the mouse |
| 9 | **390px** | List (how the phone opens) · Month with the strip · an empty day |
| 10 | **What this settles** | The rhythm, as a table |

### Components used

| | |
| --- | --- |
| Composed as-is | `.m-header` (`__lead` `__titles` `__title` `__actions` `__rule` `__auth`) · `.m-back` (+`__label`) · `.m-btn` (`--primary` `--secondary` `--sm`, `.m-btn__label`) · `.m-icon-btn` (`--sm` `--outline`) · `.m-avatar--sm` · `.m-badge` (`--neutral` `--warning` `--error`) · `.m-card` · `.m-label` (`--sm`) · `.m-serif-head` · `.m-check` · `.m-divider` (`--vertical`) · `.m-notice` (`--gold` `--error`) · `.m-spinner` / `.m-loading` |
| **New primitives** | **MonthGrid** `.m-cal` (`__days` `__day` `__grid` `__cell` `--outside` `--clickable` `__head` `__num` `--today` `--outside` `__flag` `__events` `__more`) · **EventChip** `.m-chip` (`__label` `__icon` `__trail` `__you`; `--mine` `--sunday` `--declined` `--unfilled` `--off` `--continues`) · **MonthStrip** `.m-strip` (`__day` `__cell` `--current` `--outside` `__num` `__dots` `__dot`) |
| Small helpers | `.cal-monthbar` / `.cal-stepper` / `.cal-viewtoggle` (the toolbar) · `.cal-commit` (a commitment row, on both grounds) · `.cal-navy` · `.cal-answer` · `.cal-link` · `.cal-agenda` · `.cal-note` · `.cal-daymenu` · `.cal-list*` |

`.m-card` was not bent into a day cell. The grid is its own primitive because it needs
seven equal columns, a row that grows to its content, a per-cell overflow line and a chip
whose colour bar is set from data — and it is the only grid of its kind in the app.

The chip is a separate primitive from the grid on purpose: the phone's agenda card and
the List row read the same six families, and a family that lived inside `.m-cal` could
not be reused by either.

### Decisions

**The rhythm is 8.** Chips 3px apart and full-bleed to the cell, panels and the toolbar
`--space-md` apart, rail rows 10px. The cell's 128px fixed height became a **112px floor
with rows that grow**: a quiet week is a short row, and the Sunday carrying four things
takes the room it needs without every other row taking it too.

**The lattice stays; the metrics were the problem.** Three grids were drawn before this
one (`grid-options.html`): unlined, cards-on-parchment, and this. What fixed the grid was
not removing lines but **the numeral out of the way on the right in tabular figures**, the
**chip running the full width of its cell** so the column edges do the aligning, and
**both weekend columns washed one tonal step** — the church's week has a shape and the
grid should show it before you read a word. A day belonging to the month either side is
pale rather than shaded, so no three tones ever sit in a row.

**A name breaks at a space and nowhere else.** It still wraps rather than truncating —
"Midweek Gath…" is not a name — but `overflow-wrap: break-word` was putting "Servic / e"
in a 90px cell, which is worse than either. 12px over 1.3, `text-wrap: pretty`, and a
loud chip drops the church glyph: two glyphs and a name in one chip is one too many.

**The month fits the window.** The page is one viewport tall and the grid's rows divide
whatever height is left after the header, the toolbar and the padding, so the last week
ends where the window does. You scroll for more information — never to see the rest of
what is already on screen, which is what made the page feel unfinished before anybody
read a word of it. On the phone it scrolls as it always did.

**As many chips as the row holds, then "{n} more".** At 1440×900 that is two, and the
count rides in the corner opposite the numeral rather than taking a line of its own. Two
things this costs, both deliberate: **a fourth event on a day is a click away rather than
drawn**, and **a name past two lines is cut with an ellipsis in the cell** — it is whole
on the chip's title, the list row and the day. The alternative was a grid that either
wrapped past the fold or truncated at one line, and "Midweek Gath…" is not a name.

**The neighbouring months lose their verticals.** A day from July or September keeps the
week rule under it — the horizontal line has to run the width of the grid — but is not
ruled off into a box of its own, so the corners of the month dissolve rather than being
drawn as cells nobody is meant to read. They are not weekend-tinted either: three tones
in a row was one too many.

**Type.** Cinzel for the month's name — the app's own word for a place. **EB Garamond for
every date number**, the Sunday Service's name and the rail's sentence: a date is a record
you read, and Cinzel numerals are wide enough to read as headings. Libre Franklin for all
other chrome. This is the MS-187 place/record split applied to a grid of small type.

**The toolbar is three objects, not five controls.** The arrows and *Today* became one
bordered stepper with the month beside it; *Show* and the view toggle sit opposite.

**Show is a disclosure, not a panel.** "Only mine" left the toolbar and joined the series
ticks, and the two together became one control that opens under the button — because the
rail at 1440×900 has room for two panels, and a set of ticks asked for about once a month
is the one that should not be permanently occupying the third. *You in {month}* takes the
height it needs and *Needs sorting* takes what is left, scrolling inside itself so no
panel is ever sliced by the fold.

**The legend is gone.** Three of its four items are already said in words where they
matter — "Needs sorting" and "2 places to fill" are on the chip and the row, and the
church glyph sits next to the word Sunday on every list row. *Cost: the navy "you" dot is
now the one mark on the page with no printed key.* It is answered by the card directly
beside it, which names what you are down for; if that proves too thin, the honest fix is
one legend item, not four.

**One notice per phone card.** The card could stack five at once and read as a list of
alarms. It now carries what is about *you* (role and state) and the single loudest thing
about the event — needs sorting, else places to fill, else out for cover.

**The empty month** gets the serif line it always had plus, for an editor, a *New event*
button. It is the state a new church sees first, and it should offer the one thing that
fixes it.

### What I placeholdered or invented

- **The people on the needs-sorting rows** beyond Ann Kerrigan — Tom Brackley, David Osei,
  Priya Raman — are from section 2's list of people, paired with real Servant Roles. The
  six-row panel needed six sentences; only two are given.
- **`Moved from 12 August`** (on the 15th) is mine. The brief gives `Moved to 15 August`
  and `Moved from 1 August`; the second cannot sit on the same pair as the first, so the
  return leg is written the way `movedNote` builds it.
- **The two extra sentences on the six-commitment card** (Kids Helper, Setup, Kids Leader
  on Midweek/Sunday) are real Servant Roles on real dates, invented to fill the state.
- **Series counts in *Show*** are counted off the August data, not taken from the brief.
- **"{n} more"** is a new string. Nothing in the code says it, because nothing in the code
  ever hid a chip.
- **The seven rail-card sentences** are not invented — they are `myCommitmentsSentence`,
  ported verbatim — but only three of the seven appear in the kit, on the states that
  produce them.

### Where the brief and the code disagreed

1. **"The five chip families"** — the heading says five, the table under it lists six, and
   `chipKind()` returns six. Followed the code.
2. **The navy dot "reads off `mine`, not off the chip kind."** True as far as it goes:
   `showsYou()` requires `mine` **and** a family of `mine` or `unfilled`. So a declined or
   struck-through chip you are on does *not* draw the dot. Followed the code, which is
   also the better answer — the dot on a red chip would be a third thing to read.
3. **The needs-sorting dates.** The brief's rows are dated 15 Aug and 3 Aug; neither is a
   date any of the six listed events falls on in August 2026 (a Saturday and a Monday).
   Kept the sentences verbatim, moved them onto 16 and 2 August, which are Sundays that
   exist. This is the one that is worth checking: if those dates are real, the events list
   in section 2 is short something.
4. **`.m-page__bar`** is named nowhere in the brief but is in PageShell's prompt as
   removed. Not used.

### What I took away, and what it cost

Four fills, four legend items, the fourth chip in a cell, one toolbar control and four of
the five notices a phone card could stack. **The cost is the navy dot's key** — the only
mark on the screen that no longer has one printed anywhere — and **a fourth event on a
day is now one click away rather than drawn**. Everything else that went was saying
something the screen says again three inches away.

---

## The design's EXPORT_PROMPT

For the engineer or agent applying this kit to `public/calendar.html`. Nothing here
changes behaviour, a query, a permission or a sentence. If a change below appears to
alter what the screen *says*, stop — that is a mistake in this document.

### Add to the component layer (`build/design-components.mjs`)

**MonthGrid `.m-cal`** · **EventChip `.m-chip`** · **MonthStrip `.m-strip`** — the three
blocks at the top of `ui_kits/calendar/calendar.css`, verbatim. Tokens only. They are
proposals: they belong in the generated layer, not hand-written into the page.

Everything else in that file prefixed `.cal-` is this page's own furniture and stays in
`calendar.html`'s `<style>` block, where its predecessors already are.

### Change, do not add beside

- **The chip's class list** in the month cell: replace the six-branch `:class` object with
  `'m-chip m-chip--' + chipKind(ev)`, plus `m-chip--continues` when `ev.spanContinues`.
  The `:style="'border-left-color:' + chipBar(ev)"` binding is unchanged.
  **`mine` and `other` lose their background** — that is the pass, and it is the one edit
  a reviewer should look at hardest.
- **The page fits the window.** `<body>` becomes a `height:100vh` flex column, `main`
  gets `flex:1 1 auto; min-height:0`, `.cal-layout` the same, and the grid section takes
  `.m-cal--fit` — `grid-auto-rows: minmax(0,1fr)` on the cells, `overflow:hidden` on each.
  The right rail gets `overflow-y:auto`. **Phone unchanged: it scrolls.** The chip cap
  should be computed rather than hard-coded — `Math.max(1, Math.floor((rowHeight - 30) / 26))`
  off the measured row, falling back to 2.
- **A cell from the month either side** loses its vertical rule
  (`border-right-color:transparent`, and a left border restored on the in-month cell that
  follows it) and keeps its week rule. It is not weekend-tinted.
- **The cell** `min-h-[128px]` → `.m-cal__cell` (112px floor, rows grow). Both weekend
  columns carry `--surface-container-low`; an out-of-month cell is `opacity:.5` rather
  than shaded.
- **The day number** → `.m-cal__num`, and it moves to the **right** of the cell head in
  tabular EB Garamond, with the red day glyph to its left. Not `font-label-md`.
- **The chip is full-bleed in a cell** — no horizontal cell padding, no chip radius. The
  label breaks at spaces only (`overflow-wrap: normal`), and a chip carrying a leading
  glyph drops the trailing church glyph.
- **The cell's chip loop** takes `cell.events.slice(0, 3)`, with a `.m-cal__more` button
  when there are more. It sets `view = 'list'` and `focusDate = cell.date`; on the desktop
  that means the List view scrolled to that week. **New state, no new query.**
- **The toolbar** → `.cal-monthbar` + `.cal-stepper` (prev · next · Today) and
  `.cal-viewtoggle`. `Today` keeps `:disabled="!awayFromToday"`.
- **`Only mine` and the *Show* panel become one disclosure in the toolbar.** The panel
  leaves the rail; a `Show` button (`m-btn--secondary m-btn--sm`, `tune`) opens it in a
  `.cal-filters` popover with `Only mine` as its first row above a `.m-divider`.
  `x-model="onlyMine"`, `toggleSeries` and `isShown` are unchanged; the button carries an
  `m-badge--primary` count of `hiddenSeries.length + (onlyMine ? 1 : 0)` so a filter left
  on is never invisible. Close on `@click.outside` and `escape`, as the day menu does.
- **The rail is two panels.** `Needs sorting` gets `flex:0 1 auto` with its rows in a
  `.cal-rail__scroll`, so it absorbs the overflow instead of the rail growing past the
  window.
- **The signed-out bar and the error bar** → `.m-notice--gold` and `.m-notice--error`.
  Both are currently hand-rolled; the strings, the `Sign in` link and the `Try again`
  button (`x-show="retryable"`) are unchanged.
- **The list row's four badges** → `.m-badge--neutral` / `--warning` / `--error`. Same
  four conditions, same strings.
- **The phone agenda card** — the five stacked notice blocks become at most two: the
  `ev.mine` chip, then the first of `needsAttention` → `placesToFill(ev)` → `outForCover`.
  The other conditions stay in the template as `x-show` on one element, not five.
- **The empty month** gains a `New event` link under the line, `x-show="canCreate"`.

### Delete

- **The legend** — the whole `<div>` of four items under the grid.
- The `.cal-chip-label` rule (it is `.m-chip__label` now) and the chip's per-family
  Tailwind class strings.

### Do not touch

`chipKind`, `chipBar`, `showsYou`, `stripDots`, `placesToFill`, `seriesFilters`,
`phoneGroups`, `myMonthHeading`, the rail's transform paging, the swipe thresholds, the
day menu's clamping, `answerCommitment` and the tick/cross pair — which must stay
identical to each other, on both grounds.

### Check after

1. A quiet month draws **no filled chips at all**.
2. A day with four events draws three and "1 more".
3. `Wednesday Morning Prayer & Bible Study` wraps in a cell and truncates on a list row.
4. Half-term draws on all five days, day two onwards at 70%.
5. A member sees no amber anywhere — `placesToFill` is still gated on `isEditor`.
6. The navy dot still appears on an amber chip you are serving on.
7. `prefers-reduced-motion` still kills the rail's transition.
