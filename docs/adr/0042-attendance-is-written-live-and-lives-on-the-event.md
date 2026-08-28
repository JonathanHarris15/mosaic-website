# ADR 0042: Attendance Is Written Live and Lives on the Event

## Status
Accepted.

## Context

MS-318 needs a record that a Person was present at a particular Event. The
ticket described this as following "the same way the app already records
who served" — but that existing pattern, Involvement ([ADR 0016](0016-roles-as-events-locked-liturgical-editable-servant.md),
[ADR 0018](0018-event-occurrences-assignments-and-visibility.md)), doesn't
actually fit: Involvement is stored on the Person
(`people/{id}/involvement`), and it is written by a nightly scheduled Cloud
Function converting a pre-existing **Confirmed** Assignment into a fact,
once the date has passed. A kiosk mark is nothing like that — there is no
prior Assignment, no RSVP, and the mark happens live, on the day, the
moment someone taps a name at the kiosk.

## Decision

Attendance is a new domain concept, not an Involvement:

- **Storage**: a subcollection on the Event occurrence
  (`event_occurrences/{id}/attendance/{personId}`), mirroring how `roster`
  (Assignments) already lives on the occurrence rather than on the Person —
  because the natural read is "who was here at this Event," not "everywhere
  this Person has been."
- **Write path**: written directly by the kiosk, at the moment of marking.
  No plan, no confirm step, no nightly conversion. Idempotent on
  `personId` — marking someone present twice at the same Event overwrites
  rather than duplicates.
- **Relationship to Involvement**: none. Attendance never becomes an
  Involvement and vice versa; they answer different questions (was this
  person physically here vs. did this person serve in a Role) and can both
  be true, both false, or either alone for the same Person and Event.

## Consequences

- Opening an Event elsewhere in the app (Roles tab, Event detail) reads
  this subcollection to show who attended, alongside but separate from who
  served.
- Fairness, Auto-assign, and the serve log are entirely untouched —
  Attendance carries no Role and moves no scheduling dial.
- A future "attendance history on a Person's profile" (symmetrical to
  Involvement's collection-group query) would need its own collection-group
  read rule, same as Involvement's — not built here, since MS-318 only
  needs the event-side view.
