# ADR 0069 — A person's name is entered in parts

**Status:** Accepted
**Date:** 2026-09-21
**Follows:** [ADR 0043](0043-households-are-stored-as-their-own-collection.md),
[ADR 0044](0044-a-household-is-minted-the-first-time-it-is-used.md)
**Ticket:** MS-602

## Context

A Person has one name: the full name every screen already reads. Create
household, the Membership Directory, and the other add-person blanks each
offer a single field for it. A Household's display name is suggested from
the last word of that string, so "Jonathan Harris Jr." becomes "The Jr.
Household".

Jonathan asked for a first name, a last name, and a suffix, on the Kiosk
and in the Directory, with the last name informing the Household, and with
a person who has no last name still allowed through.

## Decision

A name is **entered** as a first name, a last name, and an optional suffix.
It is **stored** as the same full `name` as before: the parts in that order,
skipping a blank. The parts are remembered beside that name so the
Household can be told the last name, and so the blanks can be reopened,
without guessing which word was which.

They are not a top-level `firstName` / `lastName` pair. The app already
treats `name` as the only name, and a parallel pair has made a screen show
the wrong name while its tests stayed green. The parts sit beside `name`
as `nameParts`. Existing people are not parsed apart. A record that has
only `name` stays valid, and a Household suggested from that person still
uses the last word of the full name until the parts are entered.

On create, the suggested Household name comes from the first adult's last
name ("The Harris Household"). A suffix never does. The greeter can still
edit that suggestion before saving. Adding a person to a Household that
already exists does not rename it (ADR 0044).

A new person needs a first name. A last name is required unless they have
none — an explicit pass, not a blank that slipped through. Someone already
in the directory, whose name was never split, is not sent back to fill one
in.

## Consequences

- Booklets that still take the last word of `name` can still read a suffix
  as a last name. Teaching them the entered last name is a later change.
- A Name Fix (the member's own Directory Request) is still one string.
  That request is a different door and is not this decision.
- Kiosk create may already write a Person, and an editor may already update
  one. Remembering the parts does not widen who may write a name: a member
  still cannot edit their own.
