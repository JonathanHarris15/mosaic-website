# ADR 0024 — A run of days belongs to a one-off, and the read has to reach back for it

**Status:** Accepted
**Date:** 2026-08-05
**Supersedes:** nothing. Extends [ADR 0018](0018-event-occurrences-assignments-and-visibility.md).

## Context

The church's Fall 2026 plan has four things on it that do not happen on a day.
CSISD Fall Break runs two days, Thanksgiving Break five, TAMU finals four, and
the CAMO conference in Indianapolis five. Every one of them is a real entry on
the calendar the staff plan around.

The Event model had nowhere to put any of them. An Event occurrence is one date —
`date`, and nothing else — so the only ways to record a five-day break were five
separate one-day Events, or one Event on the Monday with "runs to Friday" typed
into the description. The first is five things to edit, five chips that look like
five breaks, and five chances to move four of them. The second is a fact the app
cannot read, so nothing can act on it.

## Decision

An Event occurrence may carry **`endDate`**: the last day, **inclusive**.

### 1. Inclusive, because that is what a person means

"23rd to 27th" is five days. An exclusive end would make every Event read a day
short to the person who typed it, and the model would be right in a way nobody
could use.

### 2. A span belongs to a one-off, and to nothing else

**How long an Event runs is true of every date of it.** On a repeating Event that
puts it beside the pattern, on the series — never on one occurrence of it.

This is the trap `time` and `seriesColour` were already pulled out of, one line
apart in `occurrencePayload`. A value stamped onto one date is indistinguishable
from somebody deliberately choosing it for that date, so the moment one is
written the series can never move it again — and it fails silently, with the top
of the screen and the bottom disagreeing while both read real stored data.

So `endDateOf` returns null for anything carrying a `seriesId`, `occurrencePayload`
strips the field on the way to the database, and `saveOccurrenceDetails` refuses
it with a sentence saying where it does belong.

No repeating Event in this church runs over several days. When one does, the span
goes on the **recurrence rule**, beside the time. It is deliberately not
half-built now.

### 3. The read reaches back further than the window asked for

**This is the part that would have shipped broken.**

An Event that runs over several days is stored under its **first** day. The
calendar query is a Firestore range on `date`, so `date >= from` drops any run
that started before the window and is still going inside it. A break from 28
December to 3 January simply would not appear in January — not as a wrong date,
as an absence, which is the failure nobody reports.

Firestore cannot express "starts before `from` but ends after it": that is two
ranges on two fields. So:

- the read widens its lower bound by `MAX_SPAN_DAYS`, and
- the overlap is settled client-side in `Core.overlapsRange`.

**The cap is what makes this affordable.** Without a bound on how long an Event
may run, the widening has no bound either and the only correct query is "since
records began". So `MAX_SPAN_DAYS = 60` is not tidiness — it is what keeps the
read a fixed 60-day overshoot instead of a full-collection scan. It also catches
the common typo, which is the wrong year on the last day.

The same correction applies to every "is this in the month" test on the Calendar
page. `monthOf(o.date) === month` answers "does it start here", and that is not
the question.

### 4. A run moves as a whole

`shiftOccurrences` slides the schedule by a week. Shifting the first day and
leaving the last where it was gives a run that ends before it starts — which the
model then reads as no run at all, so a five-day break would quietly become a
one-day Event rather than announce anything. Both dates move.

### 5. One Event on five days, not five Events

`monthGrid` places the occurrence in every cell it covers, each carrying
`spanDay` / `spanOf` / `spanStart` / `spanEnd` / `spanContinues`. Day two onwards
draws quieter. The name still appears on every day, because somebody scanning
Wednesday needs to know half-term is on — but five full chips would read as five
separate breaks.

In the list it appears **once**, at its start, with "23–27 November" beside it.

### 6. A run of days is not an all-day flag

An Event with a `time` still has one. A conference starting at 9am on the Friday
is both, and the model says both.

## Consequences

- One Event, one thing to edit, one thing to move.
- The calendar query overshoots by up to 60 days on the lower bound. Rows outside
  the window are filtered client-side. Measured against the alternative — a break
  vanishing from the month it runs in — this is cheap.
- `MAX_SPAN_DAYS` is now load-bearing in two places. Raising it widens every
  calendar read by the same amount.
- A repeating Event still cannot run over several days. That is a refusal with a
  sentence, not a silent drop.
