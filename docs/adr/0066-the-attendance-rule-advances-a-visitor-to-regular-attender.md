# ADR 0066 — The attendance rule advances a Visitor to Regular Attender

**Status:** Accepted
**Date:** 2026-09-18
**Follows:** [ADR 0012](0012-membership-track-field-and-tag-projection.md),
[ADR 0026](0026-the-account-sync-moves-the-stage-not-the-tag.md),
[ADR 0042](0042-attendance-is-written-live-and-lives-on-the-event.md)
**Ticket:** MS-425 (decision MS-466)

## Context

A Person created at the Kiosk starts at **Visitor**. The Membership Track
([ADR 0012](0012-membership-track-field-and-tag-projection.md)) says that is
the first stage, and until now the only way off it was an editor dragging the
stage slider. Most people who keep coming never get that drag. The directory
fills with "visitors" who have been present for months, and the elders' filters
for Visitor and Regular Attender stop meaning anything.

Sam stated the church's rule at the 2026-09-08 elders training: a visitor who
keeps showing up is a regular attender. The count he settled on is **four
distinct days in two months**.

Attendance is already a fact the moment it is written
([ADR 0042](0042-attendance-is-written-live-and-lives-on-the-event.md)). The
account sync already moves a Person along the Track without a slider, and logs
a Membership Change authored by nobody
([ADR 0026](0026-the-account-sync-moves-the-stage-not-the-tag.md)). This is the
same kind of move, from a different fact.

## Decision

**When a Visitor is marked present at the Kiosk, and they have Attendance on
4 distinct calendar days inside a rolling 2-calendar-month window, the server
moves them to Regular Attender — the same move the slider makes.**

### 1. Live, on Attendance create — not a nightly job

The rule hangs off the Attendance record being **created** under an Event
occurrence (`event_occurrences/{id}/attendance/{personId}`). A mark is true
the moment it is made (ADR 0042); waiting until tonight would leave an elder
looking at a Visitor all Sunday morning. Re-marks overwrite the same record
and do not fire the rule. Deleting a mis-tap never moves anyone.

The trigger runs after the Attendance write has committed. A failure in the
rule is logged and never reaches the greeter.

### 2. What counts as a visit

A visit is a **calendar day** on which the Person has an Attendance record at
**any** Event occurrence. The day is the occurrence's own date. Several Events
on one day, or several marks, count once. Occurrence dates after today do not
count — the Kiosk also lists upcoming Events.

"Today" is the church's date (America/Chicago), the same clock the nightly
assignment conversions use. The window runs from the same calendar day two
months earlier — clamped to the month's end, so 31 Oct looks back to 31 Aug
and 30 Apr to the last day of February — up to and including today.

### 3. Forward only, Visitor only, never undo a human

The rule only ever moves **Visitor → Regular Attender**. It never touches
any other stage, never moves anyone back, never puts a Person with no stage
onto the Track, and never reactivates an Inactive Person.

It reads the Person's most recent Membership Change of any kind. If there is
one, only visit days **strictly after the day of that change** count. An
elder who moves somebody back to Visitor — or reactivates them as a Visitor —
resets the count. A Person who has never had a Membership Change (every
Kiosk-created Visitor) counts all their history inside the window.

### 4. The move is the slider's move

In one atomic write, and only if the Person is still a Visitor when it
commits: set `membership.stage` to `regular_attender` (dotted paths, so
`joinedAt` and the back-compat `status` field survive), keep Inactive false,
re-project the Membership Tags from the new stage, register the Regular
Attender tag in the tag list, stamp `updatedAt`, and append one Membership
Change. The tag swap is silent — no Tag Changes — as ADR 0012 already
requires.

Attribution follows the account-sync precedent (ADR 0026): `authorUid: null`,
`authorName: "Attendance rule"`, `source: "attendance_rule"`, and an
explanation naming the counted days (for example "Marked present on 4 days
in two months: 20 Jul, 3 Aug, 31 Aug, 14 Sep."). The existing Pastoral Record
already renders "Advanced to Regular Attender · by Attendance rule" on web
and phone.

### 5. Server-only; no backfill; threshold not editable

The decisions live in a server-only module of pure functions, plus a thin
writer the Attendance-created trigger calls — the same shape as the account
sync. Nothing on a device runs the rule. Existing Visitors are not swept on
deploy; each is evaluated the next time they are marked present, against
their full history. The 4-day / 2-month threshold is not a user setting.

## Consequences

- CONTEXT.md's Membership Track line that "only an editor (via the stage
  slider) can move someone along it" is no longer true — it has not been
  true since ADR 0026, and this is the second automatic forward move.
- Elders will see Pastoral Record entries attributed to "Attendance rule"
  that nobody typed. That is the visibility; there is no notification.
- A Visitor an elder has just moved back stays a Visitor until they have
  four new visit days after that change. The system does not argue on
  Sunday morning.
- Concurrent marks for the same Person produce one move and one Membership
  Change, because the write re-reads the Person and refuses if they are no
  longer a Visitor.
