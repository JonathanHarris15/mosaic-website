# ADR 0058 — Finishing is the clock, not the date

**Status:** Accepted
**Date:** 2026-09-08
**Ticket:** MS-79 (Tasks & Reminders)
**Replaces, for this entity:** the "automatically disappears after its due date" rule
on the former Follow-up Reminder

## Context

The Follow-up Reminder was a title and a due time, shared with every elder, and
it vanished the moment its time passed. That was coherent while the date was the
only thing holding it up: nothing had to expire it, and the list could never grow
stale, because the calendar swept it.

MS-79 adds an owner and a done state. The moment a thing can be *finished*, the
date and the finishing compete for the right to end it, and they disagree exactly
where it matters: at 5pm on Tuesday, on the follow-up nobody made.

A self-clearing list is also a list that never accuses anybody. The elders asked
for this feature because loose ends from meetings were being lost, and a list
whose worst failure mode is silence cannot be the fix.

## Decision

**A Task ends when somebody finishes it, skips it, or deletes it. Its due date
only decides when it starts shouting.**

So:

- An unfinished Task past its due date stays on the list and reads as overdue.
  It is not hidden, aged out, or rolled forward.
- **Missed occurrences of a repeating Task pile up.** March's unfinished check
  is still there in April, beside April's. Three red months is the news, and
  collapsing them would be the app being tactful about the elders' diligence on
  their behalf.
- A finished Task is **kept, not deleted**. It draws struck through until the end
  of the day it was finished, then leaves the dashboard panel; the Tasks &
  Reminders page still lists it, thirty days back by default.
- **A skip is not a tick.** Standing down one occurrence — December, because it is
  Christmas — is its own action, so that "done" keeps meaning done.

A date remains **required**; a time on it is optional, and an undated Task cannot
be written. Without a date there is no overdue, and the whole signal collapses.

## Alternatives considered

**Keep vanishing, and let "done" only tidy up early.** Rejected: the task you
most need to see is the one whose date went by.

**Roll a missed repeat forward silently.** Rejected for the same reason in slower
motion — a monthly check could go a year unmade and always look current.

**Cap the pile at the most recent N.** Rejected as tact the elders did not ask
for. If the pile is embarrassing, that is information.

**Allow undated Tasks.** Rejected: a list with no clock grows and nobody prunes
it, and "overdue" stops being computable.

## Consequences

- The list can grow. It is bounded in practice by elders finishing things, which
  is the point, and the page's default view hides nothing.
- Completed Tasks are stored for good. One boolean and a timestamp per row; the
  page reads a bounded window rather than the whole history.
- Anything that used to rely on a Task disappearing on its own — the assistant's
  reminder tools, the dashboard panel query — must now filter on the done state
  instead of on the date alone.
