# ADR 0033 — A sermonette is an Event, not a liturgical Role

**Status:** Accepted
**Date:** 2026-08-14
**Amends:** [ADR 0016](0016-roles-as-events-locked-liturgical-editable-servant.md) (the locked liturgical set is now five, not six). Touches [ADR 0018](0018-event-occurrences-assignments-and-visibility.md) and [ADR 0019](0019-liturgical-involvement-is-written-after-the-date.md).

## Context

`sermonette` was one of the six locked liturgical Roles: a field on the Service,
a column in the services table, a badge on the list cards, and a slug the
scheduled job converted into Involvement the night a Sunday passed.

It was never really part of the Sunday liturgy. A sermonette is a shorter
message given at a members meeting — a different gathering, on a different day,
with its own people. Modelling it as a field on the Sunday Service meant the
only way to record one was to attach it to a Sunday it did not happen on, and
the printed booklet carried a slot for something the service did not include.

Every other gathering the church holds is already an Event with its own Roles
([ADR 0016](0016-roles-as-events-locked-liturgical-editable-servant.md)). The
members meeting is a gathering. There is nothing left for the exception to buy.

## Decision

**`sermonette` leaves the liturgy.** It is no longer a locked liturgical Role, no
longer a field the Order of Service writes, and no longer a slug the Service's
Involvement conversion knows about. A sermonette is recorded the way every other
non-Sunday serving is: as an Event with a Servant Role on it, authored in the
Roles Manager.

The locked liturgical set is now five — service leader, preacher, music leader,
music helper, prayer.

### 1. Nothing already recorded is deleted

Involvement records carrying `type: 'sermonette'` stay exactly where they are,
and so do the `sermonette` / `sermonetteId` fields on the Service documents that
have them. They are simply no longer read or written. History is a record of
what happened, and a modelling decision taken afterwards does not make it not
have happened.

The practical consequence is that the fields go quiet rather than empty. A
Sunday saved from now on stops carrying them; the ones already stored keep their
values and nothing shows them.

### 2. The slug is deliberately left free

`RolesCore.allRoles` refuses a Servant Role whose slug would collide with a
liturgical one, so while `sermonette` was locked, no editor could create a Role
by that name. Removing it from the locked set opens the name back up — which is
the point. A Servant Role called "Sermonette" will take the slug `sermonette`
and, with it, the Involvement history already written under it.

That is the right outcome here: it is the same people doing the same thing,
recorded in the same place, and the alternative is a fresh slug that reads as
though nobody had ever given a sermonette before.

### 3. The future-serve cleanup no longer claims the slug

`scripts/clean-future-involvement.js` deletes serve records dated ahead of today
whose slug a Service save writes. `sermonette` is now absent from that list, and
must stay absent: once the slug belongs to a Servant Role, a record carrying it
is an Assignment conversion, and deleting those is exactly what the list exists
to prevent.

## Consequences

- **Future-dated sermonette records already in the database are now orphaned.**
  They were written by the old Service save and the cleanup script can no longer
  claim them. There should be few — the deferral rule in
  [ADR 0019](0019-liturgical-involvement-is-written-after-the-date.md) means a
  Sunday still ahead usually writes nothing at all — but "few" is not "none",
  and a targeted sweep is the honest fix if any turn up.
- The services table drops a column and the preacher cell stops carrying a
  second line. The list cards drop the purple badge and the "Add Sermonette"
  ghost button.
- `import-schedule.js` no longer reads the sermonette column from the original
  Master Schedule CSV. That script is a one-off that has already run; re-running
  it now would import five roles rather than six.
- The Order of Service's irregular-service flattening loses one entry. A Sunday
  already saved as irregular with a sermonette element keeps the element in its
  stored list, where it will no longer map to a canonical field — it reads as a
  free-text element, which is what an irregular service is for.
