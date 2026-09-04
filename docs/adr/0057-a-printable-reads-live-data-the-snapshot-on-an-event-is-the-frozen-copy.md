# ADR 0057 — A Printable reads live data; the PDF filed on an event is the frozen copy

**Status:** Accepted
**Date:** 2026-09-03
**Ticket:** MS-359 (the Printables epic), decided in MS-396 and MS-400
**Departs from, for Printables:** [ADR 0008](0008-service-guide-template-system.md) §3 (per-week snapshot)

## Context

ADR 0008 froze each Sunday's guide at the moment its template was applied:
the record stored the resolved pages, so reprinting an old week reproduced
what was handed out. That was the right call for a weekly booklet with a
frozen history.

The brief for Printables asks for the opposite. A membership directory is
laid out once and printed whenever it is needed; "in two months they can
come back and the directory and the person giving the sermonette will be
updated." A service guide is meant to be reused week after week with a
*relative* date — "this Sunday" — rather than copied per week. A Printable
that froze its values on save would be a Printable that had to be rebuilt to
print again.

And yet the brief also wants what ADR 0008 wanted: a record of what was
handed out on a given date, kept even though the Printable goes on changing.

## Decision

**A Printable stores which field feeds which element, never the value. Every
open, view and print resolves against today's data. The one frozen thing is
the PDF snapshot an editor files into an event's files, on purpose, on a
date.**

So:

- The record holds bindings (`{ scope, source, params, field }`) and
  repeats (`{ source, params, layout, overflow }`), and no rows. A test pins
  that a saved record contains no resolved value.
- Resolution is pure over plain records and *today's date*
  (`PrintableDataCore.resolve`), so "this Sunday" and "the next fortnight" are
  computed at open time, and can be tested on a fixed calendar.
- The view-only page resolves *as the viewer*: a member sees the rows a
  member may read, and a field they may not read falls back with a warning
  rather than an error.
- **File a PDF snapshot** on an event renders every page — overflow pages
  included — as it stands, and files it as an ordinary event attachment on
  that date. It obeys the attachment rules (fetched, never linked; ADR 0046)
  and is never regenerated. Unlinking the Printable leaves it where it is.

## Alternatives considered

**Freeze on save, like ADR 0008.** Rejected for the reason above: the brief's
central example is a Printable that is *not* rebuilt.

**Freeze per print.** Every print writes a snapshot record. Rejected: printing
is `window.print()`, which the page cannot observe reliably, and a directory
printed for a proof would be recorded as if handed out.

**Both — a live copy and a frozen copy in one record.** Rejected as two
sources of truth in one document; the PDF *is* the frozen copy and lives
with the event it was for, which is where somebody will look for it.

## Consequences

- Reopening a Printable can show different rows, and a different page count,
  than last time. That is the feature, and the canvas draws the generated
  pages so it is visible rather than surprising.
- A field with nothing behind it today shows the element's own stand-in text
  and is listed under **Not all data could be pulled**, so an empty slot on
  paper is never silent.
- The catalog is the first half of the permission boundary — nothing
  elder-only is in it — and `firestore.rules` is the second; a Printable
  therefore never becomes a way to print what its viewer could not read.
