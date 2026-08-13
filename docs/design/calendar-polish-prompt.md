# Calendar — a cleanup pass: design brief

**Ticket:** none. Raised in conversation, 13 August 2026.
**For:** Claude Design, against the **Mosaic Website Design** system (project `f2292e35-4adc-4d33-a42d-7ca9373364c9`).
**Deliverable:** a UI kit at `ui_kits/calendar/`, following `ui_kits/recurring-events/` — an `index.html` entry point, JSX screens, and a `README.md` naming the screens and the components used.
**Read first, in the design system project:** `readme.md`, `styles.css`, `guidelines/`, `components/`. Tokens were verified current against the app on 13 August 2026 — nothing to re-check.

**Then read the code.** Link the repo — `JonathanHarris15/mosaic-website`, branch `main` — or link the local copy, and read these before drawing anything:

| File | What it settles |
| --- | --- |
| `public/calendar.html` | The screen itself. All of it is in scope: the header, the toolbar, the month grid, the list view, the right rail, the legend, the day menu, and the phone block (`.cal-phone-only`). |
| `public/calendar.js` | What each thing on screen *is*: `chipKind` (the five chip families), `chipBar`, `showsYou`, `placesToFill`, `stripDots`, `seriesFilters`, `phoneGroups`, `myMonthHeading`. |
| `public/calendar-view.js` | The eight event colours, the sentences (`spanSentence`, `myCommitmentsSentence`, `placesToFillLabel`, `needsSorting`), and `monthGrid` / `weekGroups`. |
| `public/events-occurrence-core.js` | The three assignment states, `stateLabel` (which differs by who is looking), `notHappening`, `movedNote`. |
| `public/roles-core.js` | `LITURGICAL_ROLES` — the six locked ones, which never appear on this screen as fillable. |
| `public/components-demo.html` | The component gallery — every `m-*` class, rendered. |
| `CONTEXT.md` | The domain model. Read **Calendar**, **Month strip**, **Event occurrence**, **Assignment**, **Commitment**, **Cover**, **Warning**, **Event visibility**. This is the ubiquitous language and the words on screen have to match it. |

**Section 2 below is a digest of those files, not a replacement for them.** It is there so the load-bearing facts sit in one place and so you can tell at a glance what is settled. **Where the digest and the code disagree, the code wins — and say so in your notes back**, because that disagreement is a bug in one of them and it matters which.

---

## 1. The job

Most people who open this are answering two questions and nothing else: *what is on*, and
*am I in it*. Members open it to check a date. Editors open it to find the week that is
still short of people. It is the front door to everything dated in the app.

It works. It is not pretty. It reads as cramped and unprofessional — too much crammed
into too little, with no rhythm to it, and the eye has nowhere to rest. The month cell is
128px tall and can hold four chips; the list row can carry four badges at once; the rail
card can carry six rows of tick-and-cross; the toolbar carries five controls across; and
under the grid there is a four-item legend explaining the colour scheme to somebody who
did not ask.

Nothing about what the screen *says* is wrong. This is a pass over how it looks and how
it breathes.

---

## 2. What is real — use these, do not invent

These are the actual values from the product, pulled out of the files named above.
**Use them exactly. If you need something not on this list, check the code for it first,
and if it is not there either, mark what you used as a suggestion.**

### The nouns, spelled the way the app spells them

**Event occurrence** (one dated instance) · **Event series** (the recurring thing) ·
**Assignment** (the plan) · **Involvement** (the fact) · **Commitment** (what a person is
down for — the member's word for an Assignment) · **Cover** · **Servant Role** ·
**Liturgical Role** · **Warning** · **Event visibility** · **Away**.

In UI copy the word is just **event** and **role** — lowercase, ordinary. "Event
occurrence" is model language and does not appear on screen.

### The three views this screen has

1. **Desktop Month** — the seven-column grid plus the right rail. Cells are `min-h-128px`.
2. **Desktop List** — weeks as headed groups, one row per event, plus the same right rail.
3. **The phone** — a genuinely different screen, not a narrower one. Swapped on
   `html.shell-mobile`, never on a media query: the same 390px window on a desktop still
   has a mouse and gets the desktop screen. Top to bottom it is: the month row, the
   month strip (a seven-column grid of day numbers each carrying up to **three 5px
   dots**), the navy *You in {month}* card, then the day you tapped — or the whole month
   grouped by week, if List is on. The phone opens on **List**.

### The five chip families, in order of loudness — this order is settled

`chipKind()` returns exactly one of these, and the whole screen keys off it.

| Kind | When | How it draws today |
| --- | --- | --- |
| `off` | cancelled, or moved to another date | dashed left bar, struck through, 55% opacity |
| `declined` | somebody said no — `needsEditor` | `--error-container` background, `priority_high` glyph |
| `unfilled` | places still to fill, **editors only** | `--warning-container` background, small `warning` glyph |
| `mine` | you hold a role here | `--surface-container` background |
| `sunday` | the Sunday Service | left bar only, `church` glyph on the right |
| `other` | everything else | `--surface-container-low` background |

Two rules underneath it, and they are load-bearing:

- **A chosen event colour only ever draws the bar down the side. A tint only ever fills
  the background.** So a tinted chip always means the app is saying something, and a bar
  always means an editor picked a shade. They cannot be confused.
- **The navy "you" dot reads off `mine`, not off the chip kind** — otherwise an amber
  chip would swallow it. It is a 5px `--primary` dot at the front of the chip.

### The eight event colours — the whole palette, and there is no ninth

Steel · Ocean · Navy · Green · Gold · Amber · Plum · Rose

Each is a bar and a tint: `--event-steel` / `--event-steel-tint`, and so on. Default is
**Steel**; the Sunday Service defaults to **Ocean**. **There is no red in it,
deliberately** — red means "somebody declined and this needs sorting", and it always
overrides a chosen colour.

### Real events for the month

| Name | Pattern | Where | Colour | Who can see it |
| --- | --- | --- | --- | --- |
| Sunday Service | Every Sunday at 10:30 am | — | Ocean | Anyone |
| Midweek Gathering | Every Wednesday at 7:30 pm | The hall | Steel | Members |
| Wednesday Morning Prayer & Bible Study | Every Wednesday at 10:00 am | Church hall | Green | Members |
| Elders' Meeting | The first Tuesday of the month at 8:00 pm | — | Plum | Elders |
| Youth Group | Every other Friday at 7:00 pm | The annexe | Rose | Only those serving |
| Half-term Holiday Club | 23–27 November | The hall | Gold | Anyone |

**"Wednesday Morning Prayer & Bible Study" is 38 characters and is there on purpose.**
There is no stored cap on an event name. On a desktop chip the label **wraps** rather
than truncating — at ~110px wide, "Midweek Gath…" is not a name. On a desktop list row it
truncates; on a phone card it wraps. Draw the long one in a cell and prove it survives.

**Half-term Holiday Club runs over five days**, and that is one event on five days, not
five events. It appears in every cell it covers. Day two onwards is drawn quieter (70%
opacity) so a five-day break does not read as five separate breaks, and the chip's title
attribute carries `Half-term Holiday Club · 23–27 November`.

### People, for the rail and the needs-sorting rows

Sarah Whitfield · Tom Brackley · Ann Kerrigan · David Osei · Priya Raman ·
Michael Doyle · Ruth Aldridge · Joseph Nkemelu

### Real Servant Roles

Welcome Team · Sound Desk · Coffee · Kids Leader · Kids Helper · Setup ·
Children's Ministry

### The six Liturgical Roles — never drawn as a fillable place, anywhere

Service Leader · Preacher · Music Leader · Music Helper · Sermonette · Prayer

They are fields on the Service and print in the booklet. This screen never counts them as
places to fill and never draws one as a slot.

### The exact strings on this screen

The rail card's heading and sentence:

- Heading: `You in August 2026` — the month **on screen**, not a rolling window.
- `Nothing on for you.`
- `Sound Desk, still waiting on your yes.` — one commitment, named.
- `Sound Desk, answered.`
- `3 things, all answered.`
- `3 things, all still waiting on your yes.`
- `3 things. 2 still waiting on your yes.`

State labels — **the same state reads differently depending on who is looking**. To the
person themselves, `pending` is **Unconfirmed**; to an editor it is **Pending**. The rail
card uses the owner's wording. Confirmed and Declined are the same to both.

The rest, verbatim:

- `2 places to fill` — the amber count. Said the same way on the chip, the row and the card.
- `Needs sorting` — the red one.
- `Out for cover` — **not** red. The system working, so it says what is happening and gets
  out of the way.
- `You · Sound Desk` (list row) · `You · Sound Desk · Unconfirmed` (phone card).
- `Moved to 15 August` · `Moved from 1 August` · `Not happening`.
- `23–27 November` — how a multi-day event says its span. Empty for a single day.
- `Week of 17 August — this week` — the list's group heading. Only the current week gets
  the suffix.
- `All your commitments` and `Something needing somebody` — the two links out of the rail
  card, both in tracked caps today.
- `New event on 15 Aug` — the menu that opens where you click an empty day.
- Needs-sorting rows: `**15 Aug** Ann Kerrigan declined Sound Desk. The place still needs
  someone.` and `**3 Aug** Four people were never confirmed. Did they serve?`

The legend under the grid, all four items: `You are serving` · `Needs sorting` ·
`Places to fill` (editors only) · `Sunday service`.

### Every state the screen has

- **Loading** — a full-page spinner. The header stays put.
- **Signed out** — a gold-edged bar: *"You are not signed in."* / *"This is only what the
  church shows publicly — anything you serve at, and anything for members, is missing."*
  with a **Sign in** button. **This is not the same as an empty month**, and the two look
  identical unless the page says so: a signed-out calendar still draws the Sunday, because
  the Sunday Service is fetched by id regardless of who is asking.
- **Error** — an error-container bar. Four real messages, one per cause; the
  index-still-building one carries a **Try again** button:
  *"The calendar is still being set up — an index it needs is being built. That usually
  takes a minute or two, and then this will work."*
- **Empty month** — `Nothing on this month.`
- **Empty day** (phone, Month view) — `Nothing on this day.` A different fact, said
  differently.
- **A month with one event**, and **a month where a single Sunday carries four events**.
- **The rail's own bad day** — the *Needs sorting* panel with six rows in it.

### Who sees what

- **Places to fill** is **editors only**. A member cannot fill a place, and a count they
  can do nothing about is weather.
- The **Away** button appears for anybody with a Person to their name, not just editors.
- The **New event** button and the click-an-empty-day menu are editors only.
- The rail card and the phone's navy card only appear for somebody the church knows by
  name — with no Person there is no "you" to answer about.

---

## 3. Compose from these

The design system already has these, and this screen should use them:

`m-btn` (`--primary` `--secondary` `--ghost` `--quiet` `--danger` `--danger-outline`;
`--sm` `--lg`; wrap words in `m-btn__label`) · `m-icon-btn` · `m-input` · `m-select` ·
`m-check` · `m-search` · `m-label` · `m-serif-head` · `m-card` · `m-nav-card` ·
`m-medallion` · `m-badge` · `m-avatar` · `m-divider` · `m-spinner` · `m-toast` ·
`m-empty` · `m-page` · `m-header` · `m-back` · `m-row` · `m-card-list` · `m-tabs` ·
`m-notice` · `m-settled` · `m-actionbar` · `m-split` · `m-picklist` · `m-rota`

The full set with variants and examples is in the gallery.

Two of them are worth a look before you draw anything: **`m-notice`** already exists for
the signed-out and error bars, which this page currently hand-rolls; and **`m-badge`**
already exists for the four badges the list row carries inline.

**If none of them fit, say so and design the new thing — do not force it into an existing
component.** The month cell and its chips are almost certainly a real new primitive — this
is the only grid of its kind in the app, and an `m-card` bent into a day cell is not the
answer. So, probably, is the month strip. A new primitive is a good outcome.

---

## 4. What is open — have opinions here

This is a cleanup pass, so most of the *look* is yours. Specifically:

- **Density and rhythm, everywhere.** This is the whole commission. The cell height, the
  chip's padding, the gap between chips, the list row's height, the rail card's line
  spacing, and the space between the toolbar and the grid. Say what the screen's vertical
  rhythm actually is, rather than tuning each number on its own.
- **The chip.** Six families have to stay distinguishable at a glance and the loudness
  order must survive — but how each one draws is yours. Today four of the six carry a
  tinted background and it reads as a lot of colour at once.
- **The toolbar.** Five controls across one row: two arrows, the month name, Today, Only
  mine, and a two-up view toggle. It is the first thing you see and the busiest.
- **The right rail.** Three stacked panels at 300px — *You in {month}*, *Needs sorting*,
  and *Show* (a checkbox per series with a count). Whether all three earn their place at
  that width, and what the card looks like with six commitments in it.
- **The legend.** Four items in a bar under the grid, permanently. Whether a screen this
  well-labelled needs one at all.
- **Typography.** Where the display face (Cinzel) and the serif (EB Garamond) belong on a
  grid of small type. The date numbers, the month name, the event names and the rail
  card's sentence are the four candidates.
- **The empty month.** One line of centred text today. It is the state a new church sees
  first.
- **The phone.** The strip's dots, the navy card, and the agenda cards below it. The
  card can carry five stacked notices at once and reads as a stack of alerts.
- **How much colour this screen should have at rest**, on a quiet week where nothing is
  declined and nothing is short of people. That is the common case, and it is the one that
  should look calm.

---

## 5. Constraints

- **Tokens only.** Every colour a `var(--token)`. No raw hex anywhere.
- **Material Symbols Outlined**, matching all 34 pages. Never Lucide. Never emoji or
  unicode as an icon.
- **Two widths, both real designs**: 1440px desktop and 390px phone.
- **The header is settled and is not yours.** `.m-header` with `__lead` / `__titles` /
  `__title` / `__actions` / `__rule` / `__auth`, in that order — decided in MS-187 and
  shared by 34 pages. Take a view on *how many* actions belong in it (there are three:
  Away, Recurring events, New event) but do not redesign the bar.
- **Red is spoken for.** It means somebody declined. Nothing decorative may be red, and
  amber is the colour for "this needs looking at". A place still to fill three weeks out
  is normal; somebody saying no is not.
- **The phone is a swap, not a breakpoint.** The desktop grid, toolbar and rail stand down
  on `html.shell-mobile`. Do not solve the phone with a media query on the desktop layout.
- **The month rail moves by transform, not by scrolling.** Five months sit in one row and
  the visible one is a window onto it, so paging slides. A clipped box will not
  smooth-scroll. Keep the sliding month; do not replace it with a swap.
- **Nothing on this screen writes to the roster** except the tick and cross on the rail
  card, which answer one Assignment. **Those two controls must stay identical to each
  other** — same size, same border, same weight, neither filled. The moment yes is the
  prettier of the two the card starts collecting agreements people cannot keep.
- **A Liturgical Role never draws as a fillable place.**
- **Motion:** background, opacity and border-colour only. No bounces, no loops. Honour
  `prefers-reduced-motion`.
- Tone: warm, grounded, plain English. Sentence case. Closer to a parish noticeboard than
  to enterprise software.

---

## 6. What to send back

- The **export prompt** for the kit.
- A short note on **anything you placeholdered or invented** — any string, value, state,
  role or event name that is neither in section 2 nor in the code. A design that flags its
  own guesses saves the whole grilling session on the way back.
- **Anywhere the code and section 2 disagreed**, and which you followed.
- One line on **what you took away**, and what it cost. This is a cleanup pass, so the
  removals are the interesting half of it.
