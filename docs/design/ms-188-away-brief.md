# MS-188 — Away: design brief

**For:** Claude Design, against the **Mosaic Website Design** system (project `f2292e35-4adc-4d33-a42d-7ca9373364c9`).
**Deliverable:** a UI kit at `ui_kits/away/`, following `ui_kits/calendar/` (MS-99) — an `index.html` entry point, JSX screens, and a `README.md` naming the screens and the components used.
**Read first:** `readme.md`, `styles.css`, `guidelines/`, and `ui_kits/calendar/` — this screen is reached from the Calendar and must look like it belongs to it. Reuse `Button`, `IconButton`, `Input`, `Badge`, `Card`, `SectionLabel`. Flag it if a screen genuinely needs a primitive that doesn't exist. **Material Symbols**, matching the other 23 pages.

---

## What this is

One screen where a person says **which whole days they will not be there** — a holiday, a term off, a weekend at a wedding. The church's scheduler reads it and stops putting them on those dates.

Today this fact only exists in an editor's head. Somebody mentions in the car park that they're away in August, the editor types it into a draft, the draft is thrown away, and the fact is gone. This screen gives the fact a home, owned by the person it's about.

**One screen, two shapes** — a desktop page and a phone page, reached from the Calendar. Following the Calendar's own rule (MS-99): on a phone this is *a different screen, not a narrower one*.

---

## The thing to get right

**This is not a leave request.** Nobody approves it. There is no pending state, no submission, no "your request has been received". A person says they're away and it is simply true from that moment.

If the design makes it feel like filing for annual leave with HR, it has failed — and that's the easy mistake to make, because every visual reference for "mark yourself unavailable" comes from workplace software. The tone is the design system's: warm, grounded, unhurried. Closer to writing on the family calendar on the fridge than to booking time off.

**Used often, in seconds.** Somebody should be able to open this, say "away next weekend", and be gone. If adding a stretch takes more than a few taps the screen will not be used, and an unused screen here is worse than none — the scheduler would then be trusting a record nobody maintains.

---

## Screens to design

### 1. My Away — the main screen

Two things at once, and the balance between them matters:

- **Add a stretch.** A start date and an end date, whole days, inclusive. This is the primary action and should be the loudest thing on the screen.
- **What I've already said.** The stretches currently on record, each removable. Someone glancing at this should immediately see whether they've already told the church about August.

Design for **several stretches per person** — a holiday, a weekend, a term off. One date is a stretch of length one, and saying "just this Sunday" must not feel like filling in a form designed for a fortnight.

Worth exploring: **quick choices** beside the date pickers — *this Sunday*, *next weekend*, *a week*, *pick dates*. Most stretches are probably one of a few shapes, and offering them turns the common case into one tap. Show whether this earns its space or clutters the primary action.

### 2. The clash — the most important state on the screen

When the stretch someone is entering **covers a date they're already down to serve on**, the screen has to say so, right there, before they leave.

> *You're down for Coffee on Sunday 14 September, inside these dates.*

This is the heart of the ticket. The rule Mosaic is committing to is: **say it before you're scheduled and nothing ever puts you there; say it after, and it's yours to sort out** — you find someone to swap with, rather than handing the hole to an organiser. So this message is not a warning that something went wrong. It's the moment the person learns they have something to do.

Design it as **information with a next step**, not an error. It must not read as "you can't do that" — the Away is recorded either way, and the place stays theirs until they deal with it. Amber, never the error red, matching the Calendar's rule that red is spoken for.

The next step itself (offering the place to somebody) doesn't exist yet — it's a later ticket. **Design the space for it** so it can be dropped in without redrawing the screen, and design what the message says today, when there's nothing to click.

Also handle: the stretch covers **several** places (a fortnight over three Sundays). A list, not one sentence repeated.

### 3. Empty state

Somebody who has never used this. It should explain what the screen is for in a line, and make the first stretch obvious to add. This is most people most of the time, so it is not a minor state.

### 4. The phone

Picking a date range on a phone is the hard problem on this screen, and it's where the streamlining has to pay off. Consider a compact calendar with tap-start, tap-end, versus two native date fields, versus the quick choices doing most of the work. Show at least two approaches — this is worth deciding with something in front of us rather than in the abstract.

The phone reaches this inside the mobile shell, from the Calendar.

### 5. How it appears to an editor staffing a date

Not a screen in this kit, but the **wording** belongs here so it's decided once.

In the person picker, somebody Away on that date is **shown, greyed, with a reason, and still placeable** — the editor may place them anyway. But this reason is unlike every other one, and must read unlike them. Every other reason is impersonal, a rule the church wrote: *"Excluded by tag"*, *"This slot needs a woman"*. This one is a person's own words, and is attributed:

- **"Sarah said she's away"** — she entered it herself
- **"Ann marked Sarah away"** — an editor entered it on her behalf

Never *"Unavailable"*. The attributed sentence is the safeguard: an editor overruling a rule is exercising judgement, but an editor overruling *"Sarah said she's away"* should feel like what it is.

---

## Constraints

- **Whole days only.** No times, no morning/evening. Somebody in Spain on the 14th is in Spain for all of the 14th.
- **No reason field.** "Away" is all the rota needs. A *why* is pastoral and has its own elder-only home in Mosaic.
- **Never the word "unavailable", "blackout" or "absence".** It is **Away**, everywhere, in every string.
- **Private.** Only the person and editors ever see it. Nothing about this screen should imply the congregation can see who's on holiday.
- **Not a recurring pattern.** "Every third Sunday" is deliberately out of scope — that's a shape of availability, not an absence.
- Desktop and phone, both real designs.

---

## Open questions the design should answer

- **Do past stretches stay visible?** Proposal: upcoming only, past ones fall away quietly — but show what that looks like.
- **How far ahead can someone reach?** Probably no limit, but the date picker has to behave sensibly a year out.
- Does the screen show the person **what they're already down for** in general, or only when a stretch clashes? The Calendar's *Upcoming* card already answers "what am I doing", so duplicating it here may be waste.

---

## Explicitly not in this kit

- Offering a place to somebody else, or accepting one — a later ticket (MS-190).
- Confirming or declining an assignment — MS-20.
- The editor's own surface for recording an Away on someone's behalf; that lives on the person's record in the directory.
- The auto-assign draft's **Out** control, which is a different thing with a different name: a drafting move that dies with the draft and says nothing about the person.
