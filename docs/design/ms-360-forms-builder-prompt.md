# MS-360 — Claude Design prompt: the Forms page (builder + responses)

**Ticket:** MS-360, sub-tasks MS-370 (the page) and MS-372 (the Responses tab)
**Written:** 2026-09-02
**Covers:** the editor's screen only. The answerer's fill-in page is a separate
prompt — `ms-360-form-fill-in-prompt.md` — because it is a different surface for
a different person.

---

## What to read first

**In this design system project** (Mosaic Website Design,
`f2292e35-4adc-4d33-a42d-7ca9373364c9`): the readme, the stylesheet, the
guidelines, and the components. Compose from those.

**In the repo** — `JonathanHarris15/mosaic-website`, branch `main`. Use *Choose a
repository*, or *Link local code* if you have it checked out. Do not skip this;
the facts below are a digest, not a replacement.

Which file settles which question:

| Question | File |
| --- | --- |
| The library navigation this page should feel like — drill into a folder, breadcrumb back, name a new thing inline with no dialog | `public/shepherding-documents.html` and `.js` |
| The list-then-editor pattern, and how one page serves desktop and phone via `?shell=mobile` | `public/roles-manager.html` and `.js` |
| Every component class, rendered | `public/components-demo.html` |
| The tokens | `build/design-tokens/colors.css`, `spacing.css`, `typography.css`, and `tailwind.config.js` |
| The domain language | `CONTEXT.md` — the **Forms and Registrations** section |
| Why the settings are shaped the way they are | `docs/adr/0051-a-public-form-is-served-and-answered-through-one-closed-door.md` and `docs/adr/0052-a-secret-ballot-keeps-two-lists-that-cannot-be-joined.md` |
| The page shell, header and auth block every page here wears | `public/roles-manager.html` lines 317–338 |

## 1. The job

An editor at a church needs to make a form and then read what came back. Today
they open Google Forms, because Mosaic has nowhere to do it — which means the
church's sign-ups, polls and waivers live outside the system that already holds
its people. They come to this screen to build one form (a title and a handful of
questions), decide who may answer it, publish it to get a link they can text
round, and later come back to see what people said. The hard part is that a form
is two things at once — a thing being *authored* and a thing that is *live and
collecting* — and the screen has to make both legible without becoming a
settings panel with a preview stapled to it.

## 2. What is real — use these, do not invent

**This section is a digest of the code, not a replacement for it. Where the two
disagree, the code wins — and tell me where you found a difference.**

**Question types.** Three exist in this version, in this order:
`Short answer`, `Paragraph`, `Multiple choice`.
Ten more are coming and the type picker has to survive them, so design it for
thirteen even though you can only show three: *Select all that apply, Dropdown,
Number, Image, File submission, Date, Time, Linear scale, Stripe payment,
Directory Person picker.*

**Answering rung** — one closed set, reusing the app's existing visibility
ladder. Two are live now: `public`, `member`. Two more come later: `editor`,
`elder`. `public` is the only rung that needs no account.

**Attribution** — on or off. On means the answer records who gave it. Off means
it does not. On a `public` form it is forced off and the reason is shown: there
is no account to attach.

**One Response Each** — on or off. **Only available when the rung is `member` or
above** — on `public` it is disabled with its reason shown, because a form
anyone can open has no way to tell one person from another.

**The combination that needs words on screen.** Attribution off + One Response
Each on is a secret ballot, and the form has to say what it is doing in plain
language: *we record that you answered, we do not record what you said.* That
sentence is a real product requirement, not filler.

**Closed.** A form is closed if an editor pressed it closed, **or** its closing
date has passed. Both exist. A closed form still has a working link.

**Real forms to draw with** — these are the church's actual cases:

- `What do you want to eat at the Monday gathering?` — public, anonymous, 34 answers
- `Inductive Bible Study — Spring sign-up (the book is $18)` — member, named, one each, closes 2026-09-21
- `Counselling intake` — public, named, 2 answers
- `Elder interview` — a form that is filled in as a document rather than published (this mode is not in this ticket, but the page will grow it — do not design it, just do not design it out)
- `Volunteer waiver — Fall work day` — public, named, closed 2026-08-30

**Real answers**, for the Responses tab, from the Monday gathering poll:
Chili 14 · Soup and bread 9 · Tacos 7 · Sandwiches 4. Free-text answers to
"Anything else we should know?": *"I can bring a slow cooker if that helps"*,
*"nut allergy in our family — two of us"*, *"we'll be late, around 6:30"*.

**Limits.** ⚠ **No title cap has been decided.** I am not inventing one. Draw a
long title — `Inductive Bible Study — Spring sign-up (the book is $18)` is 54
characters — and if the layout wants a cap, say what it should be and I will put
it in the model.

**States that must exist**: no forms at all (first run); one form; a dozen forms;
a form being built with no questions yet; a form with one question; a published
form; a closed form; a form with zero responses; a form with 34 responses; an
anonymous form's Responses tab (which must show **no names anywhere**); and a
failed save.

## 3. Compose from these

Read the class list from `build/design-components.mjs` and see them rendered in
`public/components-demo.html`. The ones most likely to fit:
`m-page`, `m-header`, `m-card`, `m-card-list`, `m-row`, `m-row--interactive`,
`m-tabs`, `m-seg`, `m-field`, `m-input`, `m-select`, `m-check`, `m-btn`,
`m-icon-btn`, `m-badge`, `m-chip`, `m-notice`, `m-empty`, `m-count`,
`m-actionbar`, `m-divider`, `m-search`, `m-toast`.

**If none of them fit, say so and design the new thing.** A question editor is
plausibly a new primitive this design system does not have yet, and that is a
good outcome — much better than an `m-card` bent into a shape it was never meant
for, which is very hard to spot on the way back into the code.

## 4. What is open — have opinions here

- **How a question reads while being edited.** This is the main event. Thirteen
  types eventually, each with its own little settings (options for a multiple
  choice, a required toggle). Inline and always-open, or collapsed to a summary
  row you click into? Nobody has decided.
- **Where the three form-level settings live** — rung, attribution, one-each —
  so they are findable but do not greet you before the questions do. Two of them
  disable each other depending on state, which has to read as *explained*, not
  broken.
- **The publish moment.** You press publish and a link exists. What does that
  look like, and where does the link live afterwards so you can copy it again on
  Thursday?
- **How the tally draws** — bars, numbers, both — and what forty free-text
  answers look like without becoming a wall of grey.
- **How the two tabs relate.** Is the Responses tab dead while the form is
  unpublished, or absent?

## 5. Constraints

- Tokens only. No raw hex.
- Icons: **Material Symbols Outlined** (`class="material-symbols-outlined"`).
- Draw **both a phone width and a desktop width**. The phone opens this same
  page inside the app shell, list-then-editor, exactly as the Roles Manager
  does — it is not a separate design and must not become one.
- **No folders in this version.** They arrive in the next ticket, so leave room
  for them but do not draw them.
- The header, auth block and page chrome already exist — match them, do not
  reinvent them.

## 6. Send back

1. The export prompt.
2. Anything you placeholdered or invented, listed plainly — especially any
   domain value not given above.
3. **Anywhere the repo and section 2 disagreed, and which one you followed.**
   A disagreement means one of the two is stale, and which one matters.
