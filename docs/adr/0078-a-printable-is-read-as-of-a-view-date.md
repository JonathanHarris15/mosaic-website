# ADR 0078 — A Printable is read as of a view date

**Status:** Accepted
**Date:** 2026-10-05
**Amends:** [ADR 0057](0057-a-printable-reads-live-data-the-snapshot-on-an-event-is-the-frozen-copy.md) (the clock was always the wall clock)

## Context

ADR 0057 keeps a Printable live: it stores which field feeds which element,
and every open resolves against today's data. "This Sunday" is the Sunday
on or after that clock. That is right for a directory. It is wrong for the
weekly booklet. On a Wednesday the coming Sunday and the Sunday after it
are different services, and a guide laid out with "this Sunday" cannot be
aimed at the later one without waiting for the week to arrive.

The day before a Sunday does not fix it. "This Sunday" is the Sunday on or
after the clock, so Saturday still reads as the Sunday it is about to
become.

## Decision

**A Printable is resolved as of a view date.** The view date is the clock
passed into resolution. It is not stored on the Printable. With no view
date, the clock is today.

A Sunday's Files tab opens a linked Printable two ways:

- **From this date** — the view date is that Sunday.
- **Before this date** — the view date is the previous Sunday. Not the
  calendar day before, which would still resolve as this Sunday.

The same clock is what a snapshot is rendered with. Filing one from an
event's Files tab uses that occurrence's date. **Send snapshot to…** in
the editor renders as of the view date and files the PDF on an occurrence
the editor picks. The Sunday Service for the Sunday of the view date is
pinned at the top of that list. The PDF is still the only frozen copy
(ADR 0057); the Printable itself goes on changing.

## Alternatives considered

**Copy the Printable per week.** Rejected. That is ADR 0008, which this
system replaced so one layout could be reused.

**Store the view date on the Printable.** Rejected. The record would then
be "the guide for 11 October", and the next week would need another copy.

**"Before" means yesterday.** Rejected for a Sunday. Yesterday still names
that same Sunday.

## Consequences

- Reopening a Printable on another view date can show different rows and a
  different page count. That is the feature.
- Weekly typed text (prayer country, Mosaic Kids, announcements) is the
  Sunday the view date names, so editing it while the clock is set writes
  that Sunday, not whichever Sunday the wall clock would have picked.
