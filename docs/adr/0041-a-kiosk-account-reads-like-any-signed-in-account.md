# ADR 0041: A Kiosk Account Reads Like Any Signed-In Account

## Status
Accepted.

## Context

MS-318 introduces a kiosk: an unattended, permanently-signed-in device in the
foyer that marks people present at an Event. It needs read access to Person
names and Family membership, and only that — the ticket as originally written
asked for that promise to be enforced in the security rules, not just hidden
in the page ("A kiosk account can read only what the kiosk screen shows...
This is checked against the security rules, not just hidden in the page").

Firestore has no field-level read rules ([ADR 0031](0031-the-directory-asks-for-an-account.md)
§2: "the tempting middle path — names public, contact details closed — is not
available"). Enforcing the narrower promise for real would mean a
purpose-built projection collection (name + familyId only) that the kiosk
reads instead of `people`/`families` directly — a small, one-screen version
of the split ADR-0031 rejected for the whole directory.

## Decision

Kiosk gets a new `permissionLevel` value, `kiosk`, checked with its own
explicit `isKiosk()` allowlist — following the existing pattern where
`isElder()`/`isAdmin()` are parallel branches, not rungs on a ladder;
`permissionLevel` is not a strict hierarchy (CONTEXT.md's flagged
ambiguity). An admin sets it from the existing account panel; no new
provisioning UI.

For reading, `isKiosk()` is added alongside `isSignedIn()` on `people` and
`families` — the same floor ADR-0031 already grants any account.
**No projection collection.** The kiosk UI itself only ever fetches and
renders name + family grouping; contact details, tags, and shepherding data
stay off its screens, but are not blocked at the rules layer beyond what
already applies (elder-gated subcollections stay elder-gated regardless of
this decision).

This was a deliberate relaxation of the acceptance criterion as originally
written, made and confirmed in planning (2026-08-27): the chosen trade was
the smaller, contained cost of a UI-only boundary over building and
maintaining a new projection collection for one screen.

## Consequences

- If the kiosk device or its session is ever compromised (stolen,
  jailbroken, devtools opened on the foyer machine), whoever holds it can
  read full Person records — email, phone, home address — for the whole
  congregation, same as any signed-in account can today. This is not a new
  hole (any account already has this reach per ADR-0031); what's new is that
  the risk now sits on an unattended public-room machine rather than a
  device someone is personally answerable for.
- The acceptance criterion "checked against the security rules, not just
  hidden in the page" no longer holds literally — MS-318's PRD documents
  this supersession rather than silently dropping it.
- Revisit if kiosk devices multiply, or if a kiosk login is ever shared more
  loosely than "one machine, one admin-set account" — the trade was made for
  exactly one foyer machine.
