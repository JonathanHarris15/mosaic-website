# MS-229 — Recurring Events, merged with the event's own screen: design brief

**Ticket:** [MS-229](https://methodllc.atlassian.net/browse/MS-229) — To Plan, no PRD yet.
**Date:** 12 August 2026.
**For:** Claude Design, against the **Mosaic Website Design** system (project `f2292e35-4adc-4d33-a42d-7ca9373364c9`).
**Deliverable:** a UI kit at `ui_kits/recurring-events/`, following `ui_kits/headers/` — an `index.html` entry point, JSX screens, and a `README.md` naming the screens and the components used.
**Read first:** `readme.md`, `styles.css`, `guidelines/`, `components/`. Tokens were verified current against the app on 12 August 2026 — nothing to re-check.

---

## 1. The job

An editor at a church opens this to answer one of two questions about a thing that
comes round: *who is on the next few of these*, and *what is this event, actually*.
Today those are two screens. The list of recurring events, its rota and the buttons
that start a drafting run live on one; the event's own name, time, place, pattern,
colour, who may see it and which Roles it carries live on another, reached by a link
that leaves the page. So changing the Sunday's start time means losing sight of the
Sunday's rota, and coming back means finding the event in the list again.

Merge them into one screen. The list of events is a panel down the left. Everything
about **whichever event is selected** — its rota, its settings, its cross-role rules,
and the buttons that launch a drafting run — fills the rest, arranged as **tabs**, not
as one long scroll.

The people on the other end of this are volunteers doing it on a weeknight. Nothing
here is a professional scheduling tool and it must not read like one.

---

## 2. What is real — use these, do not invent

These are the actual values from the product. **Use them exactly. If you need
something not on this list, mark it as a suggestion.**

### The two things being merged

- **`recurring-events.html`** — the list, the rota grid, the cross-role rules, the
  drafting launch buttons, and the one write on the screen ("take everybody off").
- **`calendar-event.html?series=<id>`** — the event's own settings: details, pattern,
  the Roles it carries, colour, who can see it, and the next few dates.

The merged screen replaces both. It is **not** the screen for one *date* of an event —
that stays at `calendar-event.html?id=<seriesId>_<date>` and is out of scope.

### The nouns, spelled the way the app spells them

**Event series** (the recurring thing) · **Event occurrence** (one dated instance of
it) · **Servant Role** · **Liturgical Role** · **Cross-Role Rule** · **Assignment**
(the plan) · **Involvement** (the fact) · **Auto-assign** · **Blank draft** ·
**Fairness** · **Event visibility** · **Warning** · **One-off Role**.

In UI copy the word is just **event** and **role** — lowercase, ordinary. "Event
series" is model language and does not appear on screen.

### The six Liturgical Roles — the whole set, locked, never fillable here

Service Leader · Preacher · Music Leader · Music Helper · Sermonette · Prayer

They are **shown and locked** on the Sunday Service, with a `lock` glyph and a
**Locked** tag. They are never drawn as a fillable place, and they never appear as a
row on the rota grid. The reason, said once on the screen:

> These belong to the Sunday itself, not to the event — you put names against them
> when you build that Sunday's order of service. They can't be taken off, because the
> printed booklet expects them.

### Real Servant Roles

Welcome Team · Sound Desk · Coffee · Kids Leader · Kids Helper · Setup ·
Children's Ministry

### The eight event colours — the whole palette, and there is no ninth

Steel · Ocean · Navy · Green · Gold · Amber · Plum · Rose

Each is a bar colour and a tint: `--event-steel` / `--event-steel-tint`, and so on.
**There is no red in it, deliberately** — red means "somebody declined and this needs
sorting", and always overrides a chosen colour. A chosen colour only ever draws a bar
down the side of something; a tint only ever fills a background.

### The five visibility rungs — in this order, with these exact words

| Label | Icon | The sentence under it |
| --- | --- | --- |
| Anyone | `public` | Anyone at all, signed in or not. Use this for things you would put on a poster. |
| Members | `groups` | Everyone who has an account here. Not the open internet. |
| Only those serving | `assignment_ind` | Only the people given a Role at this event — plus editors and elders. |
| Editors | `edit_note` | Editors, admins and elders. Members will not see it at all. |
| Elders | `shield` | Elders and super admins only. |

Under the ladder, one checkbox: **"The people serving can see the rest of the roster"**.
At *Anyone* and *Members* it means nothing, so it drops to 45% and says why rather than
silently doing nothing: *"Everyone can see this event anyway, so this makes no
difference here."* And under all of it: *"This applies to every date of this event,
past ones included."*

### The pattern — four options and no more

Just once · Every week · Every other week · Every month

Carries on: **Until further notice** · **Until a date** · **For a set number of times**.

The whole rule reads back as one English sentence. Real examples:

- `Every Sunday at 10:30 am, until further notice.`
- `Every Wednesday at 7:30 pm, until further notice.`
- `The first Tuesday of the month at 8:00 pm, until 16 Dec.`
- `Every other Friday at 7:00 pm, 12 times.`

### Cross-Role Rules — the exact sentence, and the exact composer

A rule about a **pair** of roles, which neither role can state on its own, so it
belongs to the event that runs both. Written here, and only here.

Rendered sentences, in serif, one per row:

- `Kids Leader and Kids Helper cannot be from the same "Marriage"`
- `Welcome Team and Coffee must be from the same "House Group"`

The composer is four controls and a button, in this order:
`[ Pick a role… ]` **and** `[ Pick a role… ]` — then
`[ cannot be from the same | must be from the same ]` `[ Choose a relationship… ]`
`Add rule`.

Relationship types always on offer: **Family**, **Marriage**. Others come from what an
elder has shared — real ones: **House Group**, **Small Group**.

Two error states with real copy:

- A rule whose type is no longer shared draws in the error colour, with:
  *"This rule is unavailable — an elder is no longer sharing the relationship type it
  uses with editors. Remove it, or ask an elder to share that type again."*
- The types could not be read at all:
  *"The relationship types could not be read, so only Family and Marriage are on offer.
  Ask an elder or admin to check."*

The section's own heading and standfirst:

> **Rules across two roles**
> For things no single role can say — a leader and their helper who must not be from
> one household, or a team drawn from one house group.

### The rota grid — roles down, eight dates across

Eight date columns at a time, paged. The **role column stays put** when the grid
scrolls sideways: three columns in, you are otherwise reading names with no idea which
role they are in.

Each column header carries a tick box, the weekday in tracked caps, the short date, and
**one line saying the state of that date** — the real strings:

`Cancelled` · `Nobody yet` · `3 to fill` · `Full` · appended: ` · 2 declined`

Cells:

- **Filled** — a 22px circle of initials and the name.
- **Declined** — same, in the error colour, struck through, circle in the error
  container.
- **Unfilled** — a dashed circle and *Nobody yet* in italic. **Drawn, never blank**:
  seeing the hole before the morning it matters is the whole point of reading ahead.
- **Cancelled date** — an em dash.
- **A role that does not apply to that column** — a middot.

Role rows can carry a subtitle: `2 places`, or `Just this date` for a one-off role.

Paging is `Earlier` · the window in words · `Later` · `Back to now`, and the window
reads `17 Aug – 5 Oct`. While it loads: *Reading the rota*.

Under the grid, on a Sunday:

> Preaching, leading and the rest of the liturgy are not on this grid — they belong to
> the order of service, one date at a time, which is what keeps the printed booklet
> safe.

And always: *"Tap a date to open it on its own. Tick dates to redraw them together."*

### Ticking columns, and the two doors out

With nothing ticked:

> Both buttons open the next stretch of dates from tomorrow — auto-assign with a rota
> drafted for you, by hand with the grid empty. Tick columns below to open exactly
> those dates instead.

With columns ticked, a panel appears saying `5 dates ticked`, and the buttons take
their count from it. The exact labels — the count sits on **both**, because they open
the same dates and a count on one would read as the difference between them:

- `Auto-assign` → `Auto-assign 5 dates`
- `By hand` → `By hand, 5 dates`
- `Take everybody off` — **never** carries a count
- `Clear` — unticks. It does not empty anything, and the two sit an inch apart.

Two sentences that only appear when they are true:

- *"The draft room works in a run of dates, so 2 dates in between will come too — 24 Aug
  and 31 Aug. What is already on them is kept unless you say otherwise."*
- *"Taking everybody off would empty 3 dates — 17 Aug, 24 Aug and 31 Aug. The date you
  ticked in the past is left alone — its rota is the record of who served."*

### The Sunday Service is settled in four places, and settled is not disabled

It is one locked series. Where a control would be greyed out, **there is a sentence
instead** — greying implies a permission you might one day get:

- Name: the field is disabled, with *"The Sunday Service keeps its name — everything
  else in the app refers to it."*
- Pattern: *"Every Sunday, by definition. That one is settled."*
- Who can see it: *"Anyone at all. A Sunday Service is always public — that is settled,
  not a setting."*
- Each of its next dates carries a second link the others do not: **Order of service**.

### Real events for the list

| Name | Pattern | Where | Colour | Who can see it |
| --- | --- | --- | --- | --- |
| Sunday Service | Every Sunday at 10:30 am, until further notice. | — | Navy | Anyone (settled) |
| Midweek Gathering | Every Wednesday at 7:30 pm, until further notice. | The hall | Steel | Members |
| Wednesday Morning Prayer & Bible Study | Every Wednesday at 10:00 am, until further notice. | Church hall | Green | Members |
| Elders' Meeting | The first Tuesday of the month at 8:00 pm, until further notice. | — | Plum | Elders |
| Youth Group | Every other Friday at 7:00 pm, 12 times. | The annexe | Rose | Only those serving |

**"Wednesday Morning Prayer & Bible Study" is 38 characters and is there on purpose** —
there is no stored cap on the name, so the list row and the tab bar have to survive it.

Each list row carries: a colour dot, the name, the pattern in one line, and a third line
of `4 roles · next 17 Aug`. A series with none says `No roles yet`; a series whose
pattern has run out says `Nothing coming up`.

### People, for the grid cells

Sarah Whitfield · Tom Brackley · Ann Kerrigan · David Osei · Priya Raman ·
Michael Doyle · Ruth Aldridge · Joseph Nkemelu

### Every state the screen has

- **Loading** — a spinner, and *Reading the rota*.
- **Signed out** — a gold-edged bar: *"You are not signed in."* / *"Sign in to see the
  events that repeat and who is on them."* and a **Sign in** button.
- **Signed in, not an editor** — a genuinely different lane, see below.
- **Nothing repeats yet** — *"Nothing repeats yet."* / *"A recurring event is anything
  that comes round — a Sunday, a midweek gathering, an elders' meeting. Make the first
  one and its rota appears here."*
- **The event has no roles** — *"No roles on this event yet."* / *"Add the jobs that come
  round every time — welcome team, sound desk, coffee — and the rota appears here."*
  plus an **Add roles** button.
- **No roles added yet, in the settings** — *"None yet. Add the jobs that come round
  every time — welcome team, sound desk, coffee."*
- **Error** — an error-container bar with the message in it.
- **This screen's own bad day**: the rota half-emptied. *"Some of those dates could not
  be emptied. The grid below is what is really stored — read it before trying again."*

### The reader's lane — the same page, nothing that writes

Anybody signed in who is not an editor sees the same list of events and none of the
controls. *What runs every week, and until when?* is an ordinary question. Their copy:

> Everything that comes round again. Open one to see when it next falls.

Opening one shows **Coming up**: the next dates, each a row. A skipped date is struck
through and tagged `Not on`; a date they are on carries `You're on` with a
`person_check` glyph. Under it: *"The Calendar has the rest."* And if the pattern has
ended: *"This one has finished — there are no more dates coming."*

Design this lane inside the merged layout. It is the same room with fewer doors, not a
second page.

---

## 3. Compose from these

The design system already has these, and this screen should use them:

`m-btn` (`--primary` `--secondary` `--ghost` `--quiet` `--danger`; `--sm` `--md` `--lg`;
wrap words in `m-btn__label`) · `m-icon-btn` · `m-input` · `m-select` · `m-check` ·
`m-search` · `m-label` · `m-serif-head` · `m-card` · `m-nav-card` · `m-medallion` ·
`m-badge` · `m-avatar` · `m-divider` · `m-spinner` · `m-toast` · `m-empty` · `m-page` ·
`m-header` · `m-back` · `m-row` · `m-card-list`

The full set with variants and examples is in the gallery.

**If none of them fit, say so and design the new thing — do not force it into an
existing component.** Two places on this screen are likely to need a real new primitive:
the **rota grid** (a sticky first column, tickable column headers, and cells that draw an
absence), and whatever carries the **tabs**. A new primitive is a good outcome. An
`m-card` bent into a table is not.

---

## 4. What is open — have opinions here

- **The tabs themselves.** How many, what they are called, and where they sit. The
  content that has to be housed: the rota, the event's details and pattern, the roles it
  carries, the cross-role rules, colour, and who can see it. Whether that is three tabs
  or five, and whether colour and visibility earn a tab or ride along with something
  else, is yours to argue.
- **Where the drafting buttons live**, now that the rota is one tab among several. The
  ticks are made on the rota tab and the count is on the buttons — so the buttons
  probably cannot simply be a tab away. Solve this; it is the hardest thing on the
  screen.
- **What the list rows carry** now that "Edit the event" is no longer a separate
  destination, and how the selected row reads against the rest.
- **Nothing selected.** Whether that state exists at all, or the first event is always
  open.
- **The phone.** The rota is a wide grid and drafting is desktop-only. Reading a rota on a
  phone is a real thing to want; drafting one is not. What the list-plus-tabs shape
  becomes at 390px is genuinely undecided.
- **Unsaved changes.** The details fields need a press to save (a name is half-typed for
  most of the time somebody is typing it) while the time saves on change. What a tab with
  unsaved work looks like when you switch away from it.
- **The header.** Whether the selected event's name is the page title, and what the back
  arrow says.

---

## 5. Constraints

- **Tokens only.** Every colour a `var(--token)`. No raw hex anywhere.
- **Material Symbols Outlined**, matching all 34 pages. Never Lucide. Never emoji or
  unicode as an icon.
- **Two widths, both real designs**: 1440px desktop and 390px phone.
- Wide content scrolls **inside its own container**. The page never scrolls sideways.
- **Red is spoken for.** It means somebody declined. Nothing decorative may be red, and
  amber is the colour for "this needs looking at".
- **Settled is not disabled.** Where something cannot change because it is settled, write
  the sentence; do not grey out a control.
- **A Liturgical Role never draws as a fillable place**, anywhere on this screen.
- **This screen is almost read-only, on purpose.** Everything on the rota has a screen
  that owns it. The only write over the roster here is emptying the ticked dates, which
  earns its place because it reads across a run rather than down a single date. Do not
  invent inline editing of the rota.
- Tone: warm, grounded, plain English. Sentence case. Closer to a parish noticeboard
  than to enterprise software.

---

## 6. What to send back

- The **export prompt** for the kit.
- A short note on **anything you placeholdered or invented** — any string, value, state
  or role name that is not on the list above. A design that flags its own guesses saves
  the whole grilling session on the way back.
- A line on any place where the tabbed shape forced something that the two separate
  screens did better. That is worth knowing before it is built, not after.
