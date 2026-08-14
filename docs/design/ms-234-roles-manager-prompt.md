# MS-234 — Roles Manager: design brief

**Date:** 2026-08-14
**For:** Claude Design, against the **Mosaic Website Design** system (project `f2292e35-4adc-4d33-a42d-7ca9373364c9`).
**Deliverable:** a UI kit at `ui_kits/roles-manager/`, following `ui_kits/recurring-events/` — an `index.html` entry point, JSX screens, and a `README.md` naming the screens and the components used.

---

## Read first

**In the design system project:** `readme.md`, `styles.css`, `guidelines/`, `tokens/`,
and all of `components/`. That is what this is composed from. Then
`ui_kits/recurring-events/` — the nearest sibling already designed: an editor
authoring surface with a list, a pane, and rules written as sentences. This screen
should look like it belongs beside it.

**In the repo:** `JonathanHarris15/mosaic-website`, branch `main` — attach it with
*Choose a repository*, or *Link local code* against a checkout. It is a plain
HTML/Alpine app; there is no build step to reason about. Read these, and only these:

| Question | Where |
| --- | --- |
| The screen exactly as it stands today | `public/roles-manager.html` |
| What every control does, and every string it prints | `public/roles-manager.js` |
| The model — the locked Role names, the requirement values, the rule kinds, the caps | `public/roles-core.js` |
| The phone rules for this page, already settled | the `<style>` block at the head of `public/roles-manager.html` (lines 31–74) |
| The component library — the source of every `m-` class | `build/design-components.mjs` |
| All 32 components rendered | `public/components-demo.html` |
| The domain language | `CONTEXT.md` — the entries **Role**, **Servant Role**, **Role Definition**, **Role Description**, **Roles Manager**, **Cross-Role Rule**, **Doesn't Serve** |
| Why the Sunday Roles are locked | `docs/adr/0016-roles-as-events-locked-liturgical-editable-servant.md` |
| Why only *some* relationship types can be used in a rule | `docs/adr/0017-shared-relationship-types-elder-controlled-editor-disclosure.md` |

**Out of scope, and easy to open by mistake:** `public/roles-panel.js` and
`public/roles-panel.css` are the **Roles tab** — a different screen, which puts named
people into one date's Roles. Nothing there belongs here.

---

## 1. The job

An editor — the person who staffs the church's rota — opens this screen to set up the
jobs the church needs doing. For each one: how many people it needs, whether each place
wants a man, a woman, or anyone, what the job actually involves in a sentence, how much
rest it owes somebody afterwards, and any rules about who may fill it. They come here
when a new job appears, or when an existing one has changed, and then they leave. It is
not a screen anybody sits in.

What is hard today is that **the screen wastes most of the space it has and makes you
scroll for the rest.** It is two columns: a 360px list on the left, and the Role you have
open on the right, inside a 1200px page. Whichever side has more in it is the side you
scroll, and the other one sits empty beside it. On the left, three unrelated things are
stacked in one column — the list of Roles, the six locked Sunday Roles with their rest
settings, and the church-wide list of people who never serve — so getting to the bottom
of the Roles list means scrolling past both of the others. On the right, the open Role is
a single tall stack of five groups of settings, each capped at 440–560px wide inside a
pane about twice that, so it is a narrow ribbon of controls running well past the fold
with empty space the whole way down beside it. Neither column knows what the other is
doing, and nothing on the page fills the width it was given.

---

## 2. What is real — use these, do not invent

These are the actual values from the product. Use them exactly. If you need something
that is not on this list, look for it in the code first; if it is not there either, mark
what you used as a suggestion.

**This section is a digest of the code, not a replacement for it. Where the two disagree,
the code wins — and say where you found a difference.**

### The six Sunday Service Roles — the whole set, in this order, and there is no seventh

Service Leader · Preacher · Music Leader · Music Helper · Sermonette · Prayer

They are code-defined and **locked**: they cannot be renamed, deleted, given slots, given
rules, or given a description. Two of them are stored under a name that does not match
what is shown — `worship_leader` is **Music Leader**, `worship_helper` is **Music
Helper**. Never print a stored id anywhere on this screen.

The one thing an editor may set on them is **rest**, in weeks, and that is a number box
with the unit `weeks' rest` beside it. The sentence on the card today:

> Built into the app — filled on the service page and printed in the service guide, so
> who does them, and what they need, can't be changed here. The one thing you can set is
> how much rest each one owes, because preparing a sermon and reading a prayer aren't the
> same work and the rota needs to know.

### Real Servant Roles — the editable ones, and the subject of the screen

Welcome Team · Sound Desk · Coffee · Kids Leader · Kids Helper · Setup ·
Children's Ministry

**There is no stored cap on a Role's name.** Include one long enough to break a row —
`Children's Ministry — Under 5s, Second Hall` is a real shape somebody will type.

### What a place can ask for — three choices, all three shown at once today

`A man` · `A woman` · `Anyone`

One line per person. Three people needed means three lines, which is what lets an editor
ask for two women and one man. The help text: *"One line per person — three people means
three lines, so you can ask for two women and one man."*

### The six rule openers — exact words, in this order

| Opener | Second half |
| --- | --- |
| `Must be tagged` | a tag |
| `Cannot be tagged` | a tag |
| `Cannot serve together if` | a relationship type — only shown when one is shared |
| `No two people from the same` | a group type |
| `Everyone from the same` | a group type |
| `Only these people` | collects people one at a time |

The last one is deliberately last: naming people directly is right for the four who serve
communion and wrong for anything a tag could say.

### Rules read back as sentences, in serif, one per row — exact strings

- `Must be tagged "Sound Trained"`
- `Cannot be tagged "Red Flag"`
- `Two people connected by "Marriage" cannot serve in this Role together`
- `No two people from the same "House Group" group can serve in this Role together`
- `Everyone in this Role must be from one "House Group" group`
- `Only these people can fill this Role` — the names are **not** in the sentence; they sit
  under it as removable chips, because printing eleven names twice is how one gets lost.

Three sentences a rule can degrade into, all real and all needing a home in the design:

- `This rule uses a tag an elder keeps private. It still applies — ask an elder if it needs changing.`
- `This rule is unavailable — an elder is no longer sharing the relationship type it uses with editors. Remove it, or ask an elder to share that type again.`
- `This list is empty, so nobody could ever fill this Role — remove it or add someone`

### The things a rule is built from

**Group types always on offer:** Family, Marriage. They come from the Membership
Directory and need nobody's permission.
**Shared types, real ones:** House Group, Small Group. These exist only if an elder has
shared them, which is why the pickers can be empty.
**Tags, real ones:** Member · Regular Attender · Visitor · Elder · Married ·
Red Flag · New Member Follow-up · Sound Trained

### People — the same cast the recurring-events kit uses

Sarah Whitfield · Tom Brackley · Ann Kerrigan · David Osei · Priya Raman ·
Michael Doyle · Ruth Aldridge · Joseph Nkemelu

### The numbers, and their real limits

- **Rest between turns** — a number, minimum 0, steps of 0.25, unit `weeks`. Real values:
  Setup 4, Coffee 1.25, Sound Desk 1. Absent reads as 1.
- **Description** — capped at **600 characters**, with a live counter that reads `· 412 left`
  and turns to the error colour when it goes under zero. Real text, and the placeholder
  in the box today: *"Arrive by 9:15, put the urns on, and set out the mugs on the side
  table."* Design a Role carrying a description near the full 600, because that is the one
  that changes the row's height.
- **Counts, exact wording:** `Needs 1 person` / `Needs 4 people` · `1 rule` / `3 rules` ·
  `1 role` / `7 roles`

### One checkbox, whose label has to make the *unchecked* state legible

`They can also take another Role that day`

Unchecked by default, which means the Role uses up the person's morning. It must stay a
**visibly separate setting from rest** — rest says the job *tires* you, this says the job
*occupies* you. Sound Desk is plausibly one week's rest and still exclusive.

### Every state the screen has

- **Loading** — a spinner, nothing else.
- **No Servant Roles yet** — `volunteer_activism`, and: *"No serving roles yet. Name one
  above — kids ministry, setup, coffee, sound — and say who it needs."*
- **Nothing open** — today a 520px-tall dashed box saying *"Choose a Role on the left to
  set who it needs."* This is what an editor sees the moment the page loads, so it is not
  a minor state.
- **A Role with no rules** — `how_to_reg`, and *"No rules — anyone can fill this Role."*
- **Nobody excluded from serving** — *"Nobody yet. Everyone in the directory can be
  offered a Role."*
- **Save refused** — every problem at once in one error-container block, headed *"This
  role can't be saved yet:"*. Real problems: *"A Role needs a name."*, *"Intensity must be
  a number of weeks, and cannot be negative."*
- **A clash on load** — *"A saved Role called "Coffee" clashes with the built-in Role
  "prayer" and is not shown. Ask an admin to remove it."*
- **The directory could not be read** — *"The directory could not be read, so there is
  nobody to choose from."*
- **Nothing shared to build rules from** — *"Family and Marriage come from the Membership
  Directory and are always available. For anything else — a house group, a book study —
  an elder can share a relationship type in Manage Tags and Relationships."*
- **Saved** — a toast, centred, low on the screen.

### Who does not serve — and what it is not

A church-wide list of people no rota should ever offer: the youngest children, anyone too
frail, anyone in a season of not serving. It is **not a privacy setting and it hides
nobody** — the name stays everywhere else in Mosaic. Added by searching a name, removed
with an undo control. The wording today:

> People no rota should ever offer — the youngest children, anyone too frail, anyone in a
> season of not serving. They stay everywhere else in Mosaic; they just stop coming up
> when a Role needs filling.

---

## 3. Compose from these

The design system's components, and this screen should use them: `m-btn`, `m-icon-btn`,
`m-input`, `m-select`, `m-check`, `m-search`, `m-field`, `m-label`, `m-serif-head`,
`m-card`, `m-card-list`, `m-row`, `m-badge`, `m-chip`, `m-notice`, `m-empty`, `m-divider`,
`m-toast`, `m-spinner`, `m-header`, `m-back`, `m-page`, `m-split`, `m-tabs`, `m-actionbar`,
`m-picklist`. The gallery at `public/components-demo.html` has all of them rendered.

Two are worth reading properly before deciding anything, because they were built for
roughly this problem and this page does not use either:

- **`m-split`** — "a list of things beside the one that is open, where picking a row
  changes the whole right-hand side rather than navigating away." Its list width is a
  variable (`--m-split-list`), and it collapses to one column below 1000px.
- **`m-tabs`** — "the tab bar inside a pane, when one selected thing has more sides to it
  than a page can sensibly stack." Note its own warning: a page with tabs is usually a
  page that should have been two pages.

⚠ **The page today is hand-written Tailwind and uses almost none of this** — only the
header, the back link and the spinner. So do not read the current markup as evidence of
what the system offers.

**If none of them fit, say so and design the new thing.** A real new primitive is a good
outcome here. A `m-card` bent into a shape it was never meant for is not, and it is much
harder to spot on the way back.

---

## 4. What is open — where you should have opinions

**How the page divides its space so that neither side is a long scroll.** This is the
whole ticket. The current answer — a fixed narrow list beside a tall pane — is the thing
being questioned, not a starting point to refine. Whether "a list beside the open one" is
still right at all is yours to answer.

**Where the three things that are not about one Role go.** Creating a Role, the six
locked Sunday Roles' rest settings, and the people who never serve are all church-wide,
and all three are currently stacked underneath the list of Roles for no better reason
than that there was a column there. They are read rarely and changed rarely. The locked
card in particular carries four lines of explanation and six number boxes to say one
thing.

**How one Role's settings use a wide pane.** Five groups — name, what it involves, how
often it can be asked, who it needs, and the rules — each a different shape, currently
stacked in a 440px ribbon. Some of them are short and some are lists that grow.

**What the screen says when nothing is open.** An editor arriving sees a half-empty page
and a dashed box. That is the first impression of the whole screen and it currently
carries no information at all.

**The rules composer.** One row of two dropdowns and a button that has to read as a
sentence, sitting under a list of rules that already read as sentences, with a third
control that appears only for one of the six openers. It is the widest and most awkward
thing on the screen.

**Whether the list of Roles should answer more without being opened.** Each row today
says the name, `Needs 4 people`, and `3 rules`. An editor checking whether the rota is set
up properly currently opens all seven Roles one at a time.

---

## 5. Constraints

- **Tokens only.** No raw hex, anywhere. The system's variables are the palette.
- **Material Symbols**, matching all 23 pages of the app. Not Lucide.
- **1200px container**, and two real widths: a **390px phone** and a desktop wide enough
  to show the problem — the app ships both.
- **The phone answer is already settled and is not being redesigned.** On a phone this is
  a list, *then* an editor, never both, because there is only room for one. The page opens
  whole inside the mobile shell (`?shell=mobile`) rather than being ported: this is where
  a Role's slots and rules are decided, and a second copy of that screen would be a second
  place for those rules to drift. The shell draws the page header, so the page must not
  draw its own; delete lives in the open Role's own bar, never on a list row a thumb-width
  from the tap that opens it; and the open Role carries its own way back. Draw the phone
  screens to that shape — improve within it, do not replace it.
- **The Sunday Roles must still read as locked.** They carry exactly one editable control
  and it must not look like the lock has been lifted.
- **Rest and "can also take another Role" stay visibly separate settings**, never one
  control with two halves.
- **"Doesn't serve" must keep saying it hides nobody.** Confusing it with the tags that do
  hide people would mean a small child's name quietly leaving the directory.
- **One screen.** The Roles tab, Auto-assign and the Calendar are elsewhere and are not
  part of this.

---

## 6. What to send back

1. **The export prompt**, as `EXPORT_PROMPT.md` in the kit, following the one in
   `ui_kits/recurring-events/`.
2. **Anything you placeholdered or invented** — every value you needed that was not in
   section 2 and not in the code, named, so it can be checked rather than found later in
   the port.
3. **Anywhere the code and section 2 disagreed, and which one you followed.** One of the
   two is stale when that happens, and which one matters.
