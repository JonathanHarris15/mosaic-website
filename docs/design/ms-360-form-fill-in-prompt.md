# MS-360 — Claude Design prompt: the fill-in page

**Ticket:** MS-360, sub-task MS-371
**Written:** 2026-09-02
**Covers:** what the person *answering* sees. The editor's builder screen is a
separate prompt — `ms-360-forms-builder-prompt.md`.

This is deliberately its own brief. It is the only page in the whole app a
signed-out stranger ever reaches, it carries no navigation and no app shell, and
for many people it will be the first and only thing they ever see of Mosaic.
Designing it alongside the editor's screen would make it look like a page of an
admin tool, which is exactly what it must not be.

---

## What to read first

**In this design system project** (Mosaic Website Design,
`f2292e35-4adc-4d33-a42d-7ca9373364c9`): the readme, the stylesheet, the
guidelines, and the components.

**In the repo** — `JonathanHarris15/mosaic-website`, branch `main`. Use *Choose a
repository*, or *Link local code*. The facts below are a digest, not a
replacement.

| Question | File |
| --- | --- |
| Every component class, rendered | `public/components-demo.html` |
| The tokens | `build/design-tokens/colors.css`, `spacing.css`, `typography.css`, and `tailwind.config.js` |
| The domain language | `CONTEXT.md` — the **Forms and Registrations** section |
| Why a signed-out person is served this way at all, and why the page shows no results | `docs/adr/0051-a-public-form-is-served-and-answered-through-one-closed-door.md` |
| Why an anonymous form makes an explicit promise | `docs/adr/0052-a-secret-ballot-keeps-two-lists-that-cannot-be-joined.md` |
| The church's own visual language, on a page anyone may see | `public/index.html` |

⚠ Do **not** copy the layout of the signed-in pages (`roles-manager.html`,
`shepherding-documents.html`). Those are tools for staff. This page has a
different audience and no shell.

## 1. The job

Somebody gets a text message with a link. They tap it on a phone, standing up,
possibly having never heard of this church's software and with no account and no
intention of making one. They need to understand what they are being asked, fill
it in, and know it worked. That is the whole job. The difficulty is that this
page has to be trustworthy to a stranger — a form asking for your name and
phone number from an organisation you half know is a page people abandon — while
being the same product as the tool that made it.

## 2. What is real — use these, do not invent

**This section is a digest of the code, not a replacement for it. Where the two
disagree, the code wins — and tell me where you found a difference.**

**Question types on the page now**: `Short answer`, `Paragraph`,
`Multiple choice`. Ten more come later (select all, dropdown, number, image,
file, date, time, linear scale, payment, person picker) — the page must not be
built in a way that only fits three.

**A real form to draw**, with its actual questions:

> **Inductive Bible Study — Spring sign-up**
> *The book is $18. Sign up by 21 September.*
>
> 1. Your name — short answer, **required**
> 2. Best phone number — short answer, **required**
> 3. Which session works? — multiple choice, **required**: *Tuesday 7am · Tuesday 7pm · Thursday 7pm*
> 4. Have you done an inductive study before? — multiple choice: *Yes · No · Not sure what that means*
> 5. Anything we should know? — paragraph, optional

**Every state this page has**, and they all need drawing:

1. **Open, public** — the questions, ready to answer, no sign-in anywhere.
2. **Submitted** — a thank-you, and **nothing else**. Never the results, never a
   tally. This is a hard rule from ADR-0051, not a preference: whoever holds a
   forwarded link would otherwise read everybody else's answers.
3. **Required question left blank** — the submission is refused by the server and
   the blank questions are named. Show what that looks like against question 2.
4. **Member-only, viewer signed out** — asks them to sign in and **does not show
   the questions**. Not an error; a door.
5. **Closed** — shows the form's title and *when* it closed, and nothing else. No
   questions, no results. It must not read as broken, because the link works
   fine; the form is just over.
6. **Anonymous** — carries an explicit promise in plain words: *we record that
   you answered, we do not record what you said.* This has to be legible and
   believable, not fine print.
7. **Already answered** (member form, one-each) — they are shown the answer they
   gave and can change it, rather than being refused.
8. **Something went wrong** — the network died mid-submit, with what they typed
   still there.

**Limits.** ⚠ No character caps have been decided for question text or form
titles. I am not inventing them. Draw a long question — *"Have you done an
inductive study before?"* is short, so also draw one at about 90 characters —
and tell me what cap the layout wants.

## 3. Compose from these

Read the class list from `build/design-components.mjs`, rendered in
`public/components-demo.html`. Likely fits: `m-page`, `m-card`, `m-field`,
`m-input`, `m-input--invalid`, `m-input-hint`, `m-input-hint--error`, `m-label`,
`m-check`, `m-btn`, `m-btn--primary`, `m-btn--lg`, `m-notice`, `m-notice--info`,
`m-notice--error`, `m-empty`, `m-divider`, `m-spinner`, `m-serif-head`.

**If none of them fit, say so and design the new thing.** This page has no
sibling in the app, so a new primitive here is likely and welcome. Do not force
it into components built for a dense staff tool.

## 4. What is open — have opinions here

- **Nearly all of it.** There is no existing page to be consistent with, which
  is why this brief is short on prescription.
- **How the page earns trust in the first two seconds.** Whose form is this,
  what is it for, why is it asking. The church's name and mark are available in
  `public/index.html` and `design/`.
- **How a question reads when you are answering rather than authoring** — the
  gap between a form that feels like paperwork and one that feels like a
  question someone asked you.
- **How "required" is signalled** before it is violated, not only after.
- **The anonymous promise** — how to say it so a person believes it without it
  looking like a cookie banner.
- **The thank-you.** It is the last thing anyone sees, and right now it is the
  only thing they get. It should not feel like a dead end.

## 5. Constraints

- Tokens only. No raw hex.
- Icons: **Material Symbols Outlined** (`class="material-symbols-outlined"`).
- **Phone width is the primary design**, desktop second. Most people meet this
  through a text message.
- **No navigation, no app shell, no sign-in prompt on a public form.** The page
  assumes nothing about who the viewer is.
- It must be readable and answerable by somebody who has never used Mosaic and
  never will again.

## 6. Send back

1. The export prompt.
2. Anything you placeholdered or invented, listed plainly.
3. **Anywhere the repo and section 2 disagreed, and which one you followed.**
