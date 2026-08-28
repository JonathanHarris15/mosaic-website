# ADR 0043: Households are stored as their own collection

## Status

Accepted

## Context

Family is the kinship tree: one husband, one wife, a shared list of children.
The kiosk needs a named group of whoever walked in together — a grandmother,
two households of separated parents, a family friend. Stretching Family to
hold that would corrupt the Membership Directory and the Relations Viewer,
which both read Family as marriage-and-children.

MS-318 therefore searched a projection. MS-319 has to persist what a greeter
creates at the desk.

## Decision

A **Household** is its own `households` collection: a name and a list of
People, each marked adult or kid. The kiosk creates People (Visitor, with
name / phone / sex / kid) and one Household in a single batch. It cannot
edit or delete anyone already in the directory.

Family is left alone. Families still *project* as Households for search, and
a Person in no Family and no stored Household appears as a singleton, so the
foyer is never empty while Households are still sparse.

## Consequences

- A Person can belong to more than one Household in the data. The kiosk
  cannot cause that, because it only ever creates brand-new people.
- Duplicate Households are possible; an editor cleans them up. That is
  cheaper than blocking a Sunday-morning line.
- Kid for name tags lives on the Person (and is copied onto the Household
  member list). Being a child on a Family still projects as kid at the kiosk.
