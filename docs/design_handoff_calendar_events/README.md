# Handoff: Calendar & Events (MS-99)

## Overview

A general **Calendar** for the Mosaic Services app. Today the only dated thing in the
system is a Sunday; this adds every other church event — a midweek gathering, an elders'
meeting, a picnic, a workday. Each event declares the **Roles** it needs filled, an editor
puts people into those roles, and each assignment is tracked as **Pending / Confirmed /
Declined**. Events carry a five-rung **visibility** setting, may **recur**, and once past,
anyone never confirmed surfaces a gentle "did they serve?" question.

The people using it are church volunteers and staff. The tone is warm, grounded, unhurried.
It must not feel like a project-management tool.

Authoritative specs already in the repo — read these first, they are the source of truth for
the model and this design follows them exactly:

- `docs/adr/0018-event-occurrences-assignments-and-visibility.md` — assignments vs
  involvement, sparse occurrences, the visibility ladder, one-off roles
- `docs/adr/0016-roles-as-events-locked-liturgical-editable-servant.md`
- `public/roles-core.js` — slots, requirements, restrictions, slug rules
- `public/events-core.js` — the series layer
- `docs/design/ms-99-calendar-brief.md` — the design brief this was built against

## About the design files

The files in this bundle are **design references created in HTML** — prototypes showing
intended look and behaviour. They are **not production code to copy**.

The target codebase is **vanilla JS + Alpine + Tailwind (CDN) + Firebase**, in
`public/*.html` / `public/*.js`, with a `*-core.js` pure model module per domain and a
`mosaic-theme.js` token layer. Recreate these designs there, in that idiom:

- Markup goes in a new `public/calendar.html` (+ `calendar-event.html` or a single page with
  Alpine views), styled with the existing Tailwind theme utilities
  (`bg-surface-container-lowest`, `text-on-surface-variant`, `px-md`, `font-label-md`, …) —
  **not** the inline styles used in the prototypes. The prototypes are inline-styled only
  because that is how these design components work.
- Pure model logic goes in a new `public/events-occurrence-core.js` alongside
  `events-core.js`, following the same self-contained, no-dependency, returns-new-objects
  pattern.
- Display helpers listed under **State & helpers** below are pure formatting and belong with
  the page's Alpine component or the core module, matching how
  `shepherding-relationships.js` and `relations-graph-core.js` were extended in earlier
  passes.

## Fidelity

**High-fidelity.** Final colours, typography, spacing, copy, and interaction states.
Recreate the UI faithfully using the app's existing Tailwind theme tokens. Every value in
the prototypes is a design-system token (`var(--primary)`, `var(--outline-variant)`, …) that
maps 1:1 onto the Tailwind theme; there is exactly one raw value in the whole set, the
steel-teal focus ring `rgba(93,148,169,.18)`, which already matches the `Input` component.

Copy is final and considered — the wording carries the tone the brief asks for. Prefer
keeping it verbatim.

---

## Screens / Views

Each `.dc.html` file is a canvas holding every state of one screen group side by side, with
a badge id on each (`1a`, `2c`, `4b`…) you can reference.

### 1. Calendar — `Calendar.dc.html`

**Purpose.** The front door. Most people are answering "what's coming up and am I in it",
not administering. It must work at three events a month and three a week.

**1a · Desktop (1200px container inside a 1280px frame)**

- Standard page chrome: `arrow_back DASHBOARD` breadcrumb (12px/600/`.08em`/uppercase,
  `--on-surface-variant`), 34px circular initials avatar right.
- Title block: `Calendar` in Cinzel 600/32px/`.02em`/`--primary`; one-line description
  14px/1.55/`--on-surface-variant`, `max-width:64ch`; **+ NEW EVENT** primary button right;
  20px bottom padding then a 1px `--outline-variant` rule.
- Toolbar row (24px below): left = prev/next 34px icon buttons joined into one 10px-radius
  pair, month label in Cinzel 21px `--primary`, a ghost `TODAY` text button in
  `--secondary`. Right = **Only mine** checkbox in a 10px-radius bordered chip (background
  switches `--surface-container-lowest` → `--surface-container` when on), then a
  **Month / List** segmented control (3px padding on `--surface-container`, active pill
  `--surface-container-lowest` + `--primary` text, 8px radius, min-width 96px per option).
- Body: `display:grid; grid-template-columns:minmax(0,1fr) 300px; gap:24px;
  align-items:start`. **`minmax(0,1fr)` is required** — with a plain `1fr` the event chips
  give the track a min-content floor and the grid overflows the container by ~120px.

**Month grid (default view)**

- Card: `--surface-container-lowest`, 1px `--outline-variant`, 10px radius,
  `overflow:hidden`.
- Weekday header: `grid-template-columns:repeat(7,minmax(0,1fr))`, background
  `--surface-container-low`, 1px bottom rule; labels `SUN…SAT` 10.5px/700/`.12em`/uppercase
  `--on-surface-variant`, padding `10px 8px`.
- Cells: same 7-column grid, Sunday-start, 5 rows / 35 cells including leading and trailing
  days from the neighbouring months. Each cell `min-width:0; overflow:hidden;
  min-height:128px; padding:9px 6px 11px`, 1px right + bottom hairlines. Out-of-month cells
  get `--surface-container-low` background and `--outline` day numbers. Hover
  `--surface-container-low`.
- Day number: 23px min-width circle, 12.5px/600. **Today** is `--primary` fill with
  `--on-primary` text at weight 700.
- A cell containing a declined assignment shows an `error` glyph (17px, `--error`) top-right.
- Event chips, stacked with 3px gaps: `display:flex; align-items:flex-start; gap:5px;
  padding:5px 5px 5px 4px; border-radius:6px; border-left:3px solid <bar>`. The label
  **wraps to two lines** (`overflow-wrap:break-word; line-height:1.22`) rather than
  truncating — at ~110px cells "Midweek Gathering" must read in full.
  - yours → bar `--primary`, background `--surface-container`, label weight 700, and a 5px
    `--primary` dot (`margin-top:5px` to sit on the first line)
  - declined → bar `--error`, background `--error-container`, label
    `--on-error-container`, plus a 14px `priority_high` glyph
  - Sunday → bar `--secondary`, label in **EB Garamond 13.5px**, plus a 13px `north_east`
    glyph in `--outline` (it links across to Services, it does not open an editor)
  - anything else → bar `--tertiary`, background `--surface-container-low`, Libre Franklin
    12px/500
- Legend under the grid, 11.5px `--on-surface-variant`, 18px gaps: navy dot "You are
  serving" · red `priority_high` "Needs sorting" · `north_east` "Sunday — opens on Services".

**List view (the alternative)**

Same card, grouped by week with a `--surface-container-low` sub-header per group
(10.5px/700/`.14em`/uppercase, e.g. "Week of Jul 26 — this week"). Each row: 52px date
column (uppercase day-of-week over Cinzel 23px date, `--primary` if today), 1px vertical
hairline, then title (EB Garamond 18px for Sundays, Libre Franklin 18px otherwise) with a
`Services north_east` badge on Sundays, and a meta line of time · place · fill state
(12.5px `--on-surface-variant`, 3px dot separators). Right side: a "You · <role>" chip for
your own rows, an `error` + "1 declined" badge (`--error-container` on 1px `--error`) when
something needs sorting, then `chevron_right`. Rows that are yours tint
`--surface-container-low`.

**Right rail**

1. **You in July** — flat card. Overline, then the summary sentence in EB Garamond
   16.5px/1.4 ("Five things — Kids Ministry, Setup, Prayer on the 19th, the picnic grill,
   and Sound on Wednesday. 2 are still waiting on your yes."), then one row per commitment:
   34px date column, role (13.5px/600) over event name (12px `--on-surface-variant`), and a
   state dot + tracked-caps state label. **Rows are derived from the events themselves and
   sorted by date** — do not maintain a second list.
2. **Needs sorting** — `--surface-container-low` card. One row per open problem: an
   `error` or `help` glyph in `--error`, a bold date, and one plain sentence
   ("Bethany Croft declined Kids Ministry. The place still needs someone." /
   "4 people were never confirmed. Did they serve?").
3. **Show** — checkbox filters per series/kind with counts in `--outline`.

**1b · Phone (390px)**

Order flips — the answer to "am I serving?" comes first:

1. Compact header (back / `CALENDAR` in Cinzel tracked caps / `tune`).
2. A **navy summary card** (`--primary`, 10px radius): overline in `--primary-fixed-dim`,
   the same sentence in EB Garamond 19px `--on-primary`.
3. Month nav row + a two-icon view toggle (36×30px).
4. **Month dot-strip** instead of a grid: 7 columns, each day a 12px number over up to a few
   5px dots — `--primary` yours, `--error` needs sorting, `--sand` everything else. Today
   gets a `--surface-container` pill.
5. **Agenda list** grouped by week. Cards `--surface-container-lowest`, 1px hairline, 3px
   left bar (`--error` / `--primary` / `--outline-variant`), 34px date column, title, meta,
   then — when it's yours — a "You · <role> · <state>" chip with the state dot; a red
   `error` strip when a place needs sorting; an "Open on Services `north_east`" line on
   Sundays.

### 2. Event detail — `Event Detail.dc.html`

One event; one screen serving two very different readers.

**2a · Editor.** Breadcrumb, then a title block with badges above the name
(`Repeats weekly` in `--tertiary-container`, `assignment_ind Participants` in
`--secondary-container` — both rectangular 6px), `Midweek Gathering` in Cinzel 32px, and a
meta row of `event` date · `schedule` time · `location_on` place. Right: ghost
**Edit details** + primary **`group_add` Add a role**.

Below, when anything is declined, a **banner**: `--error-container` on 1px `--error` with a
4px `--error` left bar, a 22px `error` glyph, a bold line ("One place needs reassigning"), a
plain explanation ("Bethany Croft said no to Kids Ministry. She still holds the place until
someone takes it."), and a solid `--error` **Find someone** button.

Two columns, `1fr 372px`:

- **Description** card — EB Garamond 17px/1.55.
- **Roles** section — Cinzel 19px heading with a summary line, then managed role cards, then
  the one-off strip (see screen 3 for the full spec of both).
- **Who can see this** card — the five-rung visibility ladder.
- **When it happens** card — `--surface-container-low`, the pattern in EB Garamond 17px
  ("Every Wednesday at 7:00 pm"), a 12.5px sub-line ("Until further notice · 14 dates
  ahead"), and two buttons: secondary-outline **Change pattern**, ghost **Skip this one**.

**2b · Member, roster shared.** No controls. A **Your part** card in `--primary`: overline
in `--primary-fixed-dim`, the role in EB Garamond 24px `--on-primary`, the state as a dot +
tracked caps in `--primary-fixed`, and one line of guidance ("Let Caleb know either way and
he'll mark it."). Then the description, then a **Serving this evening** list — 28px avatar,
name (your own row bolded, suffixed "(you)", avatar tinted `--primary-fixed`), role right.
A closing 12.5px line acknowledges the unresolved place without alarm.

**2c · Member, own part only.** Same Your-part card (Confirmed variant, `check_circle` in
`--success`), then instead of a roster a calm `--surface-container-low` note with a
`visibility_off` glyph: "Only your own part is shown for this event. Ask an elder if you
need to know who else is coming."

**2d · Sunday.** Visibility is **settled, not disabled** — there is no control at all.
A `--surface-container-low` strip with a `public` glyph in `--gold`: "**Sunday is public.**
Everyone can see it, signed in or not — that is how Sundays work." Then the liturgical roles
as label/value rows (120px tracked-caps captions, EB Garamond 17px names, drawn from the
existing `services/{date}` denormalised fields, **not** assignments). Footer in
`--secondary-container` with an **Open on Services `north_east`** button.

**2e · Phone**, member and editor at 390px. The editor variant keeps the red strip, the role
cards, and the one-off list, with slot rows at `min-height:48px`.

### 3. Roles & assignment — `Roles and Assignment.dc.html`

**3a · Adding a role.** Two halves of a 1000px card, at deliberately different weights:

- **Left, "A role we keep"** — from the Roles Manager. Bordered rows on `--surface`:
  `badge` glyph in `--secondary`, name in EB Garamond 17.5px, a meta line of places +
  rules (rules in `--secondary`), and a solid `--primary` **+ Add** pill. Rows already on
  the event drop to 55% opacity and read "On already". A footer link out to the Roles
  Manager.
- **Right, "Just for this evening"** — `--surface-container-low` in a **1px dashed
  `--sand`** container, no card border. One large text input
  ("Someone to unlock the hall…"), an `Enter` key-cap hint, and a list of the ones already
  added as plain `label` + name + people rows.

**The distinction is structural, not cosmetic.** A managed role is a bordered card with a
header, a rule line, a count badge, and numbered slot rows. A one-off is a plain row on a
dashed strip. If a one-off ever grows a border, a header, or a count, the design has failed.

**Managed role card** (as rendered on the event): header on `--surface-container-low` with a
`badge` glyph, name in EB Garamond 19px, an optional rule line (`rule` glyph in `--gold`,
11.5px), and a count badge right (`--surface-container`, or `--error-container` when
something needs sorting — in which case the whole card border turns `--error`). Then one row
per **slot**, in author order: a Cinzel index number, a 74px tracked-caps requirement caption
(`Either` / `A man` / `A woman`), then the person (28px avatar + 14.5px name) or an empty
state (28px dashed circle with `person_add` + "Nobody yet"), then the state, then hover-
revealed 30px icon buttons: `how_to_reg` change state, `swap_horiz` replace,
`close` clear.

**One-off row**: `label` glyph in `--outline`, the label, pill person chips (22px avatar +
name + `close`), and a ghost `+ Someone`. Adding is a single always-visible dashed-underline
input ending in "Press Enter".

**3b · The picker.** A 640px panel. Header names the slot ("Kids Ministry · place 3 of 3"),
asks "Who's taking this place?", and shows the slot's constraints as badges (`woman`
"Needs a woman" in `--tertiary-container`; `rule` "No married couple" in
`--surface-container`). Then a search field, a count line ("4 can take it · 8 can't"), and a
**Hide the ones who can't** checkbox that is **off by default**.

**Everyone is listed.** An eligible person shows a fairness note as their subtitle
("Kids Ministry group · last served 6 weeks ago"); a blocked person is 45% opacity with a
`block` glyph and **the reason** in the same subtitle slot:

- `Already serving here — Setup and Sound`
- `This place needs a woman`
- `Married to Caleb Munro, who is already in this role`
- `Not in the Kids Ministry group`
- `Already in this role — she said no to it`

Blocked rows are `cursor:not-allowed` and do nothing on click; the chosen row tints
`--surface-container` and shows `check_circle` in `--primary`. Footer: a hint naming the
consequence ("Hannah Bright will go in as Pending until you hear from her.") plus Cancel /
**Put them in**.

That subtitle slot is also where a suggested name's rationale will sit when auto-assign
lands — the row already has room, so no relayout is needed later.

**3c · The three states.** Three specimens side by side plus the editor's control.

| State | Dot | Row | Label |
| --- | --- | --- | --- |
| **Pending** | hollow, 1.5px `--outline` ring | `--surface`, no bar | `--on-surface-variant` tracked caps |
| **Confirmed** | filled `--success` | `--surface`, no bar | `--success` |
| **Declined** | filled `--error` | `--error-container`, 1px `--error` border, 3px `--error` left bar, name bold in `--on-error-container` | solid `--error` badge, `do_not_disturb_on` + **REASSIGN** |

Pending is the resting state and must stay quiet — if every unconfirmed assignment shouts,
nothing does. **Declined escalates across four surfaces** so a glance finds it: the slot row,
the role card's border, the event banner, and the calendar cell/chip.

The control is a three-option segmented pill (`radio_button_unchecked` /
`check_circle` / `do_not_disturb_on`), active text tinted per state. Only an editor ever
changes it — members confirming for themselves is a later ticket.

### 4. Recurring events — `Recurring Events.dc.html`

**4a · The pattern.** A 560px card. **How often** as a 2×2 of bordered buttons (Just once /
Every week / Every other week / Every month; selected = `--primary` border +
`--surface-container` fill + `--primary` text). Then a row of seven 56×44px day buttons
(selected = `--primary` fill, `--on-primary` text). Then **Starts at** / **Runs for** text
inputs. Then **Carries on** as three radio rows (Until further notice / Until a date / For a
set number of times). Then a `--surface-container-low` **Reads as** panel: the pattern as one
EB Garamond 19px sentence ("Every Wednesday at 7:00 pm, until further notice.") plus a row of
the next 5–6 dates as small chips ending in a soft "and on". Weekly, fortnightly, monthly —
nothing more. No RRULE editor.

**4b · Dates that no longer fit.** The screen that needs the most care. It is a **question in
gold, not an error in red**: a 720px card with a 1px `--gold` border, a 26px `help` glyph in
`--gold`, a heading that states the fact ("Five evenings already have people on them"), and a
paragraph naming the change ("moving from **Wednesdays** to **Thursdays**") and the promise
("These evenings don't fit the new pattern, and each one already has a roster. We won't guess
— tell us what to do with each.").

Sub-header: a count ("5 evenings · 13 people assigned") and **All of them: Move / Delete**
shortcuts. Then one row per orphaned date: a 66px date block (tracked-caps day, Cinzel 22px
date, month), the people on it as pill chips (avatar + name + role), a consequence line, and
a per-row **Move / Delete** segmented control. Choosing Delete strikes the date through,
greys it, drops the chips to 50%, and swaps the line to "This evening goes, and so do its 4
assignments." Footer: a sentence that **recomputes** from the choices ("3 moving, 2 going —
which loses 5 assignments"), then **Leave the pattern as it was** / **Go ahead**.

Nothing red, nothing pre-decided except a default of Move.

### 5. "Did they serve?" — `Did They Serve.dc.html`

Temporary scaffolding — it disappears once members can confirm for themselves — so it must
not dominate.

**5a · Where it turns up.** On the past event, a **single row**, not a banner and not a
modal: `--surface-container-low`, 1px hairline, a 3px `--gold` left bar, a
`contact_support` glyph in `--gold`, "Four people were never confirmed. Did they serve?",
a 12.5px sub-line ("Takes a moment. Anything you leave stays unanswered."), and a
"Have a look `chevron_right`" affordance. No count badge in the nav anywhere.

**5b · Tidying up.** A 600px card. Heading "Who actually served?" and an EB Garamond
16.5px/1.55 explanation: "These four were put down for something and we never heard either
way. Tick anyone who did it — the rest stay an open question and don't count." A sub-header
with a live count and an **All four served** / **Untick all** button. Then one row per
person: a 20px 6px-radius checkbox (`--primary` fill + `--on-primary` check when ticked),
30px avatar, name over role, and a right-hand label flipping **Served** (`--success`) /
**Unanswered** (`--on-surface-variant`). Footer sentence recomputes
("2 serves are recorded. 2 stay unanswered, for good."), then **Not now** / **Save**.

**5c · Afterwards.** Unanswered is shown as a **resting state**: rows with `check_circle` in
`--success` / a plain `remove` dash in `--outline`, and a closing `balance` note — "Two are
recorded as having served. Two stay unanswered — they don't count towards their turn, and
nobody will be asked about them again."

---

## Interactions & behaviour

- **Month / List** and **Only mine** are live in the prototype; both re-derive the view from
  one event list. Only-mine filters on the presence of a `mine` role, so the signed-in
  person's own commitments must live on the event data, not in a parallel list.
- **A Sunday chip navigates to Services.** It never opens the event editor. The Sunday detail
  view is read-only for visibility and links out for editing.
- **Assignment state** is set only by an editor, only from the slot row's control.
- **Assigning a replacement overwrites the slot.** Per ADR-0018 §5 that single write clears
  the declined flag and removes the decliner from `participantIds` — so a decliner keeps
  visibility until someone else takes the slot, and there is no record of who declined once
  refilled.
- **Changing a recurrence pattern never migrates silently.** Compute the orphans, show 4b,
  and act only on the editor's per-date choice.
- **Hover** reveals slot-row icon buttons on desktop; on touch they are always visible (see
  Responsive).
- **Motion**: `150ms cubic-bezier(0.2,0,0,1)` on background, opacity, and filter only.
  Button press shrinks to `scale(0.98)`. No bounces, no loops.
- **Empty and loading states**: an empty month shows the grid with no chips, not a message;
  a role with no one shows the dashed "Nobody yet" slot row. A leaderless/unanswered/
  unconfirmed state is never styled as an error.

### Responsive

Phone layouts exist for the Calendar (`1b`) and Event detail (`2e`) at 390px; the heavier
editors (3a–3c, 4a–4b, 5b) may assume desktop. Port the phone rules as
`html.shell-mobile` overrides, the same approach as the Tags and Relationships tabs:

- the desktop right rail becomes the top summary card
- the month grid becomes the dot-strip
- row action buttons are always visible (no hover on touch)
- slot rows get `min-height:48px`; every tap target stays ≥44px

## State & helpers

Page state (Alpine):

```
view: 'month' | 'list'
onlyMine: boolean
month: YYYY-MM                  // the displayed month
occurrences: [...]              // computed from rules + merged sparse docs
selectedOccurrenceId
visibility: 'public'|'member'|'participant'|'editor'|'elder'
rosterShared: boolean
picker: { open, slotId, query, hideBlocked, picked }
recurrence: { freq, day, time, duration, ends }
orphanChoices: { [date]: 'move' | 'delete' }
serveTicks: { [assignmentId]: boolean }
```

Display helpers — pure formatting, no behaviour:

- `stateLabel(assignment)` → `'Pending' | 'Confirmed' | 'Declined'`
- `stateTone(assignment)` → `'calm' | 'good' | 'attention'` — the three-way switch every
  surface keys off; add tones here rather than branching on state in markup
- `needsAttention(occurrence)` → true if any assignment is Declined; drives the calendar cell
  glyph, the chip flag, the card border, the banner, and the *Needs sorting* rail from one
  place
- `visibilityLabel(level)` / `visibilityIcon(level)` / `visibilityWho(level)` — the ladder's
  display name, Material Symbol, and plain-language sentence
- `recurrenceSentence(rule)` → the EB Garamond "Reads as" string
- `blockReason(person, slot, role, occurrence)` → the picker subtitle, or null when eligible.
  **Must return a reason string, never a boolean** — that is the whole point of the picker
- `orphanOutcome(date, choice)` / `orphanSummary(choices)` → the per-row and footer sentences
- `unconfirmedCount(occurrence)` → drives 5a; zero renders nothing
- `initials(name)` → 1–2 letter avatar text (already exists in the shepherding modules)

Data requirements: two merged queries per ADR-0018 §5 (one by rank, one `array-contains` me),
because Firestore cannot express `participant` as a single filter. **Constrain every calendar
query by visibility** — an unconstrained query does not return fewer rows, it errors, and the
error looks exactly like "this church has no events."

## Design tokens

All from `tokens/colors.css` / `tokens/typography.css` / `tokens/spacing.css` in the design
system (mirrored in the bundled `_ds/` folder), which mirror `public/mosaic-theme.js`.

**Colour**

| Token | Hex | Used for |
| --- | --- | --- |
| `--primary` | `#182F57` | buttons, selected states, your-commitment accents, navy hero cards |
| `--on-primary` | `#F2EAE2` | text on navy (cream, not white) |
| `--primary-fixed` / `--primary-fixed-dim` | `#D8E2FF` / `#B2C6F8` | text and overlines inside navy cards |
| `--secondary` | `#3E6181` | links, Sunday chip bars, secondary outlines |
| `--secondary-container` / `--on-secondary-container` | `#CFE0F1` / `#34506E` | Services badges, visibility badge, Sunday footer |
| `--tertiary` / `--tertiary-container` / `--on-tertiary-container` | `#5D94A9` / `#D7E7EC` / `#2D4F5B` | ordinary event bars, "repeats" and requirement badges |
| `--sand` | `#C2B79D` | the dashed hairline that marks one-off roles; neutral dots on the phone strip |
| `--gold` | `#B89B6A` | rule glyphs, the "settled" Sunday note, and the whole 4b / 5a "careful question" register |
| `--background` | `#F7F3ED` | page |
| `--surface` | `#FBF7F0` | inputs, slot rows |
| `--surface-container-lowest` | `#ffffff` | cards |
| `--surface-container-low` | `#FAF5EE` | sub-headers, hover, secondary cards |
| `--surface-container` | `#F4ECE2` | segmented-control troughs, selected rows, your-event chips |
| `--surface-container-high` | `#EEE4D8` | avatar fills |
| `--on-surface` | `#0E1C36` | ink |
| `--on-surface-variant` | `#5E6B82` | meta, labels, helper text |
| `--outline` | `#8A93A6` | pending ring, muted glyphs, out-of-month numbers |
| `--outline-variant` | `#DAD0C0` | **every** hairline |
| `--error` / `--on-error` / `--error-container` / `--on-error-container` | `#A8463E` / `#fff` / `#F3D9D4` / `#5C231C` | declined, and only declined |
| `--success` | `#4B8A6B` | confirmed, served |

**Type**

- `--font-display` **Cinzel** — page titles 32px/600/`.02em`, panel titles 19–27px, date
  numerals 17–23px
- `--font-serif` **EB Garamond** — role names 17–19px, "Reads as" and summary sentences
  16.5–19px, Sunday chip labels 13.5px, liturgical names 17px
- `--font-sans` **Libre Franklin** — everything else. Overlines/labels
  10–11px/700/`.14em`/uppercase; buttons 11.5–12px/600–700/`.08–.1em`/uppercase; body
  13–14.5px; meta 12–12.5px
- Minimum text size 11px, and only for tracked-caps labels.

**Spacing / radius / shadow / motion**

8px rhythm. Page padding 40px, card padding 20–30px, grid gaps 24–28px, form field gaps
8–16px. Radius: cards/inputs/buttons **10px**, badges/checkboxes/chips **6px**, pills and
avatars fully round. Shadows: `--shadow-xs` on primary buttons only; everything else flat.
Motion `150ms cubic-bezier(0.2,0,0,1)`.

## Assets

**Icons: Material Symbols (Outlined)**, loaded from Google Fonts:

```html
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap">
```

Glyphs used: `arrow_back` `add` `chevron_left` `chevron_right` `north_east` `east`
`calendar_month` `view_agenda` `event` `schedule` `location_on` `error` `priority_high`
`help` `contact_support` `do_not_disturb_on` `check` `check_circle`
`radio_button_unchecked` `remove` `done_all` `how_to_reg` `swap_horiz` `close` `delete`
`person_add` `group_add` `badge` `label` `rule` `lock` `public` `groups` `assignment_ind`
`edit_note` `shield` `visibility_off` `search` `block` `tune` `more_vert` `balance`
`history` `repeat` `repeat_one` `woman` `open_in_new`.

**Note on the design system's docs.** `readme.md` named **Lucide** as the icon system, per
`mosaic-theme.js` finding #7. That swap never happened — all 23 pages of the app use
Material Symbols, including the Roles Manager as rebuilt in MS-120. The rule's *intent* (one
icon set, ~1.75px stroke, `currentColor`, no emoji) stands; only the library name was wrong,
and it is corrected in the bundled `_ds/…/readme.md`. `SKILL.md` carries no icon rule at
all. The one remaining Lucide artefact is the chevron SVG inside the bundled `Select`
component — visually identical to `expand_more` at these sizes, worth swapping when `Select`
is next touched.

No images. The church seal in `assets/` is not used by these screens. **No emoji, ever.**

## Files

Design references (open any of them directly in a browser):

- `Calendar.dc.html` — screen 1
- `Event Detail.dc.html` — screen 2
- `Roles and Assignment.dc.html` — screen 3
- `Recurring Events.dc.html` — screen 4
- `Did They Serve.dc.html` — screen 5
- `support.js` — the runtime the `.dc.html` files need in order to render. Not production code.
- `_ds/` — the design-system tokens, stylesheet, and component bundle the screens load.
  `_ds/…/readme.md` carries the corrected iconography section.
- `KIT_README.md` — the short kit README, for `ui_kits/calendar/`
- `DESIGN_NOTES.md` — the decision log: why the month grid is default, why declined escalates
  across four surfaces, why a one-off role must stay structurally lighter, and the exact
  `readme.md` diff
