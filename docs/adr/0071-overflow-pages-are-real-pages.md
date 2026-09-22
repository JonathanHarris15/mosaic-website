# ADR 0071 — Overflow pages are real pages

**Status:** Accepted
**Date:** 2026-09-22
**Amends:** [ADR 0057](0057-a-printable-reads-live-data-the-snapshot-on-an-event-is-the-frozen-copy.md) (canvas used to draw generated copies that could not be edited)

## Context

A list that **Makes a new page** used to keep drawing copies of one page —
the page the list started on, or a page chosen as `continueWith`. Those
copies shared one tree. Changing a page number changed every overflow
page. The Elements panel showed one page. The copies were drawn, never
stored.

That was honest about live data (reopen, different row count) and wrong
for an editor who lays a booklet out by hand. Page two of a directory is
a page: it has a number, a header, a footer, and it has to be selectable.

## Decision

**An overflowing list keeps real pages.** Each continuation is stored on
the Printable, has its own element tree, and is edited like any other
page. It remembers which list it continues (`page.continues`).

The rows stay live. Layout slices today's list across the chain: the
origin page, then each stored continuation, then a newly cloned page when
the rows still do not fit. The editor writes that clone into the project
so the Elements panel can address it. The view-only page and the PDF
snapshot draw the same extras for that open so leftover rows are never
dropped, and they do not write the record.

If the list shrinks, leftover continuation pages stay. They are the
editor's pages; delete them if they are no longer wanted.

A new page still starts as a copy of the page the list started on, or of
`continueWith`. After that the copy is its own.

## Alternatives considered

**Keep drawing ghosts.** Rejected: the brief is an editor who changes
page numbers and the Elements panel.

**Freeze the rows onto each page.** Rejected: ADR 0057. The record still
holds which field feeds which element, never the value.

**One master page, overrides per overflow leaf.** Rejected: two ways to
edit the same box, and the Elements panel would still be lying.

## Consequences

- Reopening a Printable can still show a different page count than last
  time. New pages are added when the list grows; extras are not removed
  when it shrinks.
- `continueWith` is only the template for a page that does not exist yet.
- MCP `printable_add_page` is still the way to put a blank page in; the
  list grows its own stored pages when it overflows.
