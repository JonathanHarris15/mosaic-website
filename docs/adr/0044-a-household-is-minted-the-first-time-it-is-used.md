# ADR 0044: A Household is minted the first time it is used

## Status

Accepted. Extends [ADR 0043](0043-households-are-stored-as-their-own-collection.md).

## Context

ADR 0043 gave Households their own collection but left almost nothing in it.
So the kiosk *projected* one Household per Family and one per unattached
Person, built fresh on every page load. That kept the foyer search from being
empty on day one, and it cost more than it looked.

A projection is not a record. Nothing can point at it, an editor cannot see it,
the Relations Viewer cannot draw it, and — the part that bit — two greeters
looking at the same family get two different answers. ADR 0043 accepted
duplicate Households on the grounds that an editor could tidy them up. But the
duplicates were not an accident of a busy Sunday. They were designed in:

- The kiosk could only ever CREATE. A greeter adding a brother to a household
  that already existed had no way to say so, so they made a second household.
- Two greeters on two screens creating the same new family wrote two documents,
  because both were writing brand-new auto-ids.
- A projection minted twice minted twice.

## Decision

**A Household is written down the moment somebody uses it**, and it keeps the
projection's own id.

- The minted document id is the projection id — `family:<familyId>` or
  `person:<personId>`. Minting is therefore idempotent: two greeters minting
  the same household write the same document twice, not two documents. This is
  the whole duplicate class, closed by the id rather than by a cleanup script.
- Marking people present from a projected Household mints it. Attendance is
  written first and the mint runs after, so a mint that fails never costs the
  attendance (ADR-0042 still holds).
- **A Kiosk may add people to a Household**, which is the move it was missing.
  The rule lets it add and nothing else: the name may not change and no member
  already recorded may be dropped
  (`request.resource.data.memberIds.hasAll(resource.data.memberIds)`). Growing a
  household is a greeter's job; renaming or emptying one is an editor's.
- The create screen names a Household that already has that name and offers it,
  rather than letting the same family be typed a second time.
- `scripts/mint-households.js` writes down the backlog — every projection that
  has never been used — and can be re-run safely for the same reason.

Projection stays, but only as the fallback for a household nobody has touched
yet. It is the guess; the collection is the record.

**Households draw as bubbles in the Relations Viewer**, using the hull machinery
Relationship Groups already have, with three differences: only STORED Households
are drawn (the viewer shows records, never guesses), every Household takes one
colour rather than a cycling palette (they are one kind of thing), and there is
never a leader, because a Household has no head — it is who lives together, not
who is in charge.

**The Households toggle starts off**, and no View Preset turns it back on. There
is one bubble per household in the directory; drawn by default they would bury
the web the page exists to show.

## Consequences

- The `households` collection grows to roughly one document per family. That is
  the point — it is a record now.
- A Person can still belong to more than one Household (a child of separated
  parents). Nothing here forbids it; the kiosk still cannot cause it.
- A Family that gains a child after its Household was minted does not update the
  Household. The Household is who walks in together, and the two are allowed to
  disagree — that is why they are separate collections. The kiosk's "Add someone"
  is how the foyer catches up.
- Duplicates are no longer designed in, but they are not impossible: a greeter
  who ignores the twin warning and types a new name still gets a second
  household. An editor still owns the merge.
