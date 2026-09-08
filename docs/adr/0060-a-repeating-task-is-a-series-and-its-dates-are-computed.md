# ADR 0060 — A repeating Task is a series, and its dates are computed

**Status:** Accepted
**Date:** 2026-09-08
**Ticket:** MS-79 (Tasks & Reminders)
**Follows:** [ADR 0018](0018-event-occurrences-assignments-and-visibility.md) (Event series and sparse occurrences)

## Context

"Check on the widows every month" is a standing commitment, not twelve pieces of
work somebody typed out. MS-79 puts repeats in scope.

The app has already answered this question once, for the Calendar: an **Event
series** carries a recurrence rule, its dates are computed from that rule, and an
**Event occurrence** document exists only once there is something to say about a
particular date. Writing a second, different recurrence model for Tasks would
mean two places where "every other month" is interpreted, and two chances to
interpret it differently.

The awkward part is [ADR 0058](0058-finishing-is-the-clock-not-the-date.md): a
missed occurrence must show as overdue and pile up. It is tempting to conclude
that missed dates have to be written down in order to be shown.

## Decision

**A repeating Task is a Task series carrying a recurrence rule. Its dates are
computed; an occurrence document is minted only when something is said about that
date — a tick, a skip, a reassignment, a nudge.**

So:

- The rule reuses the Calendar's vocabulary unchanged — **weekly, fortnightly,
  monthly**, ending **never, on a date, or after a count** — from the same shared
  core, so adding daily or yearly later improves both features at once.
- **A missed occurrence is computed, not stored.** Every date the rule produces
  up to today is a Task; one with no document, and a date in the past, is
  overdue. Nothing has to run nightly to create it, and nothing has to be
  backfilled if the app is not opened for a month.
- **What is true of every occurrence lives on the series** — title, body,
  recurrence, default assignees. **One occurrence may only be ticked, skipped,
  reassigned, or nudged to another day.** Same rule as an Event, so elders learn
  it once.
- A one-off Task has no series, exactly as a one-off Event has none.
- **Deleting a series stops the future and keeps the past.** The occurrence
  documents that record finished work survive; only computed future dates go.

## Alternatives considered

**Materialise every occurrence up front.** Rejected: it needs a horizon, a
scheduled job to extend it, and a migration whenever a rule changes. The
Calendar rejected this for the same reasons.

**Roll one document forward on each tick.** Rejected: it cannot represent two
outstanding months at once, which ADR 0058 requires, and it destroys the history.

**A general RRULE editor.** Rejected here as it was for the Calendar — "every
third Tuesday except in Lent" is a calendar app's problem, not a church's.

## Consequences

- The Tasks page reads a bounded window of computed dates and merges the
  documents that exist, exactly as the Calendar does. It never asks the database
  for something that has not happened yet.
- A rule change re-computes history as well as the future. Occurrences that were
  ticked keep their documents, so a date that is no longer produced by the rule
  can still hold a finished record — the page shows those under completed work
  rather than dropping them.
- The assistant can author a recurrence rule. Because a rule dictated in
  conversation is easy to get subtly wrong, **the tool reads the next few
  computed dates back** in its reply, so a misread "every other month" is visible
  at the time rather than three months later.
