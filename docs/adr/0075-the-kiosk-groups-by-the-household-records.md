# ADR 0075 — The kiosk groups by the Household records

**Status:** Accepted
**Date:** 2026-09-30
**Supersedes:** [ADR 0043](0043-households-are-stored-as-their-own-collection.md) and [ADR 0044](0044-a-household-is-minted-the-first-time-it-is-used.md), for the kiosk
**Ticket:** MS-709

## Context

MS-709 made a `families` record read as a **Household**: a husband and a wife
(either may be empty) and the children still at home. A child who marries is a
husband or wife in a record of their own, so they leave home in the data without
anybody editing their parents' record. The Household card, the Families tab and
the Relations Viewer all read that.

The kiosk did not. It kept its own `households` collection (ADR 0043) and wrote a
projection into it the first time a greeter used one (ADR 0044). A minted group
is a snapshot, and it went stale. It kept a married son in his parents' group,
and it filed first-name-only visitors under a family's name because they arrived
with them. So the desk and the directory gave different answers to "who lives
with whom", and the kiosk had no way to change its answer.

## Decision

**The kiosk's Households are the Household records.** Search projects one group
per `families` record, and a Household of one for each Person in none. Each
Person is placed once, in `FamilyCore.householdOf`: their marriage, otherwise
the record they grew up in. The `households` collection is no longer read or
written by any screen. Nothing is minted.

- **Create and "Add someone"** write the new People and the record that seats
  them, in one batch. Each row is a Parent (seated as husband or wife by sex) or
  a Child. Ticking Kid makes the row a Child, and a Child need not be a Kid. A
  taken seat is refused, and so are children with no parent. A lone new Person
  writes no record. The Household's name is not typed: it is the first parent's
  last name, as on every other screen.
- **Edit household** is a quiet button under check-in. It opens a full edit:
  every member's name as first, last and suffix blanks, and the same Household
  card the directory uses, to seat and unseat the people in that Household.
  Its search offers only the people listed in the edit (the members, and
  anyone taken out during it), never the directory: the kiosk is a shared
  screen, and browsing everyone from it is not the job. Someone new to the
  Household still goes in through "Add someone". The rules cannot see that
  list, so this limit is the page's, not the rules'.
- **The rules give the kiosk exactly that, and no more.** On `families` it may
  create and update a record whose keys are only `husbandId`, `wifeId`,
  `childIds` and `anniversary`, and it may delete one (the card deletes a record
  when its last person leaves). On `people` it may update `name`, `nameParts`
  and `updatedAt`, and nothing else.

## Consequences

- A grouping that only ever existed in the old collection no longer groups
  anyone at the desk. Guests who came in with a family show up as Households of
  one until somebody seats them in a record. That is the fix, not a regression:
  if they belong together, the record should say so.
- A foyer account can now rewire any Household record and rename any Person.
  That is the same reach an editor has over those fields, on a shared device.
  The limits are the field lists above: contact details, sex, membership and
  notes stay out of its reach.
- The `households` documents and their rules are left in place until the
  leftover documents are cleared. `scripts/mint-households.js` is removed, since
  there is nothing to mint.
- ADR 0044's duplicate guard stays in a lighter form: creating a Household whose
  name matches an existing one still offers to open that one instead.
