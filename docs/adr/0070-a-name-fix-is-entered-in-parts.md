# ADR 0070 — A Name Fix is entered in parts

**Status:** Accepted
**Date:** 2026-09-22
**Follows:** [ADR 0069](0069-a-persons-name-is-entered-in-parts.md),
[ADR 0027](0027-a-directory-request-is-how-you-change-your-own-record.md)
**Ticket:** MS-612

## Context

A Person's name is entered as a first name, a last name, and an optional
suffix, and those parts are remembered beside the full name (ADR 0069). A
Name Fix — the Directory Request a member files about their own name — was
left as one string. Approving that string writes the full name and nothing
else. It can overwrite a carefully split name, and it can leave an older
split standing beside a spelling that was never entered in parts.

## Decision

A Name Fix asks for the same parts, with the same pass. A first name is
required. A last name is required unless the person has no last name, which
is an explicit pass, not a blank that slipped through. A suffix is optional.
Approval writes the full name the same way a greeter's or an editor's save
does, and remembers the parts the same way.

A Name Fix that carries only a full name — one filed before the parts, or
any request never entered in parts — is not taken apart. Approval writes
that full name and clears any remembered parts. Guessing which word was the
last name is the alternative already refused for people already in the
directory.

If the full name would not change and the parts would not change, there is
nothing to approve. A full name that stays the same is still a real ask when
the parts are new: that is how a split gets remembered without renaming the
person.

A Name Fix does not rename a Household. A member still cannot write their
own name. A New Record Request is a different door and still proposes one
name.

## Consequences

- The approver confirms the composed full name, and can see the parts when
  the request has them, rather than retyping the name.
- Booklets that still take the last word of the full name are unchanged.
  ADR 0069 already left that for later.
