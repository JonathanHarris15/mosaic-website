# ADR 0072 — Related lists are of a parent row

**Status:** Accepted
**Date:** 2026-09-22
**Amends:** the Printable catalog in `printable-data-core.js` (a list used to be a flat directory only)

## Context

A directory card that lists each child of a household, and skips homes with
no children, cannot be built from the flat lists the drawer already had.
Households carry a joined `members` string. People have no "is a child"
filter. Nesting two repeats already walked the tree, but `rowsFor` ignored
the parent row, so an inner list was a second directory of everyone.

A join builder (households × people, hide if empty) would be a query
nightmare and would invent a language the rest of the catalog does not
speak.

## Decision

**A list may be related.** It declares `of` a parent source. Its rows are
of one parent row. The query picker offers it only on a box inside that
parent list, grouped as **Of this household**.

`household_children` is of `households`. A child is a household member
marked `kid` (Family `childIds` on a projected home; the stored
Household's own `kid` flags at the foyer). Without a parent row the list
flattens every matching home, so a preview still has something to show.

**Hide childless homes on the outer query**, not as a general "hide if
related list empty". Households gain a `hasChildren` filter (`any` /
`with children` / `without children`) and `childMembership` (`any` /
`a member child` / `a non-member child`).

Expand passes the parent row into `rowsFor(node, parentRow)`. Resolve
reads `ctx.parent`. Live caches related resolves per parent id.

## Alternatives considered

**A join / hide-if-empty on any nested list.** Rejected: every pair of
lists would need a join key, and the drawer would become a query language.

**Filter people to kids and nest blindly.** Rejected: a person is a child
in a Family, not in the air; foyer kids live on the Household. The inner
list has to be of that home.

**Put children on the household row as a joined string.** Rejected: a card
per child needs rows, not a sentence.

## Consequences

- A household → children booklet is two queries: households with children,
  then children of this household on a box inside the card. The children
  list has its own Who filter (members / non-members / every child).
- Related lists are not top-level chips in the drawer. They appear when
  the selected box sits inside their parent.
- Other related lists can follow the same `of` seam later.
