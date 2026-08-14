# ADR 0032 — A page saves itself, a dialog does not

**Status:** Accepted
**Date:** 2026-08-14
**Extends:** [ADR 0004](0004-person-panel-sync-model.md) (the 1.5s debounce, first used for elder documents).

## Context

Two ways of saving grew up side by side. Elder documents and care lists write
themselves 1.5 seconds after the last edit. Almost everything else waited for a
button — and on the Order of Service, waited for a button while the Roles tab
next to it had already been saving every assignment as it was made. The same
page therefore answered "is my work safe?" two different ways depending on which
tab you were on.

Making everything autosave sounds like the fix, and it is not. Roughly half the
Save buttons on the site sit in a dialog, next to a Cancel, and most of those
dialogs double as the way you *create* a thing — a Role, a shepherding view, a
relationship type, a pastoral note. Autosave there breaks two promises at once:
Cancel stops meaning "discard", and opening a form starts writing a record
before anyone has decided there should be one.

## Decision

**A page editor saves itself. A dialog keeps its button.**

The line is whether you are looking at a thing or at a form about a thing. A
page editor is already open on a record that exists; every edit is a further
fact about it, and the button between you and saving is friction with nothing on
the other side. A dialog is a proposal — nothing it holds is true until you say
so — and its Cancel is what makes it safe to open.

Four surfaces autosave: the Order of Service, both Service Guide editors, and
your own details on the profile page.

### 1. The button stays, and means "now"

Autosave did not remove the Save buttons; it removed the *need* to press them.
Pressing one cancels the pending timer and writes immediately. Keeping it costs
a line of code and buys the thing an autosave cannot give you on its own — a way
to be certain before you close the laptop.

The status chip carries the actual answer. Unsaved changes → Saving… → Saved,
the same three states and the same markup the elder documents have shown since
ADR 0004.

### 2. The Order of Service waits three seconds, not 1.5

Its save is not one write. It reconciles who served into Involvement records and
hands the fairness engine new numbers, in a batch. At 1.5 seconds a sentence
typed into the theme field is several rounds of that.

Three seconds is past the end of a normal sentence and still short enough that
leaving the page loses nothing worth having. Everywhere else keeps the house
1.5s.

### 3. Three guards, because a save that edits its own input can loop

The watcher fires on any change to the service object. Saving an irregular
Sunday rewrites part of that object. Without care, the save triggers the watcher
triggers the save.

- **Nothing to do, nothing written.** The timer re-checks that the current state
  still differs from the last saved state before writing. This is also what stops
  merely opening a Sunday from writing it.
- **A save in flight arms nothing.** Edits made during the write are picked up
  once, at the end, rather than racing it.
- **A failed save does not queue itself again.** Re-arming on failure is a retry
  loop: a Sunday you have no permission to save would ask Firestore again every
  three seconds for as long as the tab stayed open. A failure leaves the marker
  up and waits for a person.

### 4. An autosave that fails is quiet, a save you asked for is not

A dialog thrown at someone mid-sentence by a write they did not ask for is worse
than the failure it reports — they cannot act on it and it takes the keyboard.
So a failed autosave logs, sets the chip back to "Unsaved changes", and lets the
next edit try again. Pressing Save is a question, so it still gets an answer.

### 5. Sex on the profile page is deliberately excluded

Contact details, phone, address and birthday save on the timer. Sex does not,
because it is set-once (ADR 0012): brushing a dropdown and having that stick a
second later shuts a door only an editor can reopen. It waits for the button.

## Consequences

- The `beforeunload` warning on the Order of Service survives, but now fires only
  in the three-second window or after a failed write. That is the right residue:
  it means something is genuinely still owed.
- Editing a Sunday now produces several writes where it produced one. That is the
  price of not losing work, and the debounce is what keeps it to several rather
  than dozens.
- **A half-finished Sunday is visible to everyone sooner.** It always became
  visible the moment somebody pressed Save; now that moment arrives without being
  chosen. Nothing in the app treats a Service as a draft, and this ADR does not
  add that idea — it is worth knowing it is now the difference between a Sunday
  people can see and one they cannot.
- The eight dialog forms are unchanged and stay that way. If one of them later
  wants autosave, it needs the record to exist first — which is a different
  decision about creating things, not this one.
