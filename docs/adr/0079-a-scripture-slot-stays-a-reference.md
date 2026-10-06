# ADR 0079 — A scripture slot stays a reference; a passage is how a Printable reads it

**Status:** Accepted
**Date:** 2026-10-05
**Departs from, for Printables:** [ADR 0008](0008-service-guide-template-system.md) (per-slot scripture text was deferred; only the key verse was fetched)

## Context

An Order of Service stores a scripture citation on each slot that has one:
the key verse, the calls, the reading, the sermon passage, the benediction.
It does not store the verses. The old guide fetched ESV text for the key
verse only, and ADR 0008 left the other slots as citations because no page
showed the text.

A service guide needs both. The order of service prints "John 3:16". A
notes page prints the verses, sometimes with numbers and headings,
sometimes as a plain paragraph in the page's own type.

## Decision

**The Order of Service keeps the citation. A Printable chooses how to read it.**

The wire on an element bound to a scripture slot is either a **citation**
(the reference as typed — the default, and what every existing wire already
is) or a **passage** (the verses that citation names). A passage carries
its own presentation, so two elements can read one slot differently:

- **Styled** or **plain**. Styled is set as scripture (the citation line,
  line breaks, poetry). Plain is one run of text in the element's own type.
- **Verse numbers** on or off.
- **Section headings** on or off.
- **Footnotes** on or off.
- **Its citation line** on or off. On by default, so a passage is not an
  untitled block.

The verses are fetched when the Printable is resolved, as of the view date
([ADR 0078](0078-a-printable-is-read-as-of-a-view-date.md)). They are not
written onto the Sunday. A passage carries the short copyright line; a
citation does not. The stored element stays one text element
([ADR 0056](0056-a-printable-is-a-tree-of-boxes-not-a-template-of-tags.md)).
Styled drawing is a projection at render time, not child elements an
editor rearranges.

## Alternatives considered

**Save the ESV text on the Sunday.** Rejected. The citation would stop
being the source, a later correction of the reference would leave stale
verses, and the Sunday document would hold copyrighted text it does not
need.

**One catalog field per presentation.** Rejected. Styled-with-numbers and
plain-without is a choice about the element, not a different fact about
the Sunday.

**Inject the publisher's HTML.** Rejected. The page would be trusting
markup it did not write. The text is fetched and the styling is ours.

## Consequences

- A passage that does not load leaves the element blank and says so under
  the gaps, the same way any other missing field does.
- Changing the citation on the Order of Service changes every passage
  bound to that slot the next time the Printable is opened.
