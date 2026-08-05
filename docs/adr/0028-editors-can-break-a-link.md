# ADR 0028 — Editors can break a link

**Status:** Accepted
**Date:** 2026-08-05
**Extends:** [ADR 0025](0025-link-requests-are-self-raised-and-editor-resolved.md) and [ADR 0027](0027-a-directory-request-is-how-you-change-your-own-record.md).

## Context

ADR 0025 gave editors and elders the power to connect an account to a directory
record, and ADR 0027 widened what they approve. Neither gave them any way to
undo it.

Unlinking existed, but only for admins, and only from a modal buried in the
profile page's admin panel — the same place ADR 0025 was written to get people
out of. So the shape was: an elder can confirm "yes, that account is Jane Doe"
in one click from the directory, and if they get it wrong, correcting it means
finding an admin and sending them somewhere else entirely.

The mistake is not hypothetical. Two people share a name; an approver confirms
the wrong one; the account now edits a stranger's contact details and, because
of ADR 0027, can propose that stranger's household.

## Decision

**Whoever may connect an account may disconnect it.** The unlink permission set
is exactly the resolver set — editor, elder, admin, super_admin — and a test
pins the two together, because letting someone create a mistake they cannot then
correct is worse than not letting them create it at all.

### 1. It lives on the Person's card, in Edit Mode

The directory already showed an "Account" chip in Edit Mode when a Person has a
login. The chip gains a disconnect button. That is where the mistake is spotted,
so that is where it is fixed.

### 2. A callable, for the same reason as everything else here

Clearing `users/{uid}.personId` needs privileges an editor deliberately does not
have: the `users` collection is admin-only because a rule loose enough to clear a
personId is loose enough to change a permission level. So `unlinkDirectoryPerson`
is a callable, and the rules stay shut.

### 3. Both sides, or neither

One batch. Clearing only `people.userId` leaves the account pointing at a Person
that no longer points back — invisible, and the state in which the next editor to
connect that account is fighting something they cannot see. The `users` write is
conditional on that document still existing (a login may have been deleted
without the reciprocal clear); the `people` write is not, because a missing
account is no reason to leave a Person half-linked.

### 4. It does not undo anything else

The Person keeps their Membership Stage, their tags, their Family and every
shepherding note. Unlinking corrects an *account connection*; it does not say
somebody stopped being a member, and the member-status sync is add-only by design
(ADR 0026) precisely so that nothing infers a demotion from a mechanical change.

The Elder Tag is the exception, and it clears itself: it is projected from the
linked account's permission level, and the reciprocal trigger reconciles the
Person it was unlinked from. That is the projection working, not this reaching
further than it should.

### 5. The email is not shown

The chip says "Account", not which one. Reading `users` is admin-only, and
widening it so the directory could show an email would also expose every
account's permission level. Not worth it to label a button.

## Consequences

- An editor can disconnect an account they cannot otherwise see anything about.
  They are acting on "this record has *a* login and it should not", which is the
  fact the directory actually shows them.
- The admin panel's link/unlink modal stays. Re-pointing a link at a different
  Person is still an admin act; this is only the break.
- **Pending Directory Requests are left alone.** A name fix or family request
  from a now-unlinked account will be refused on approval with "this account is
  no longer linked to that directory record", which is accurate and tells the
  editor what happened. Deleting them on unlink would be lossy if the same
  account is reconnected to the same Person, which is the likely correction.
