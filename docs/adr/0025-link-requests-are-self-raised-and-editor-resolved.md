# ADR 0025 — A Link Request is raised by the person and resolved by an editor

**Status:** Accepted
**Date:** 2026-08-05
**Extends:** [ADR 0012](0012-membership-track-field-and-tag-projection.md) (the Membership Track a new Person joins at).

## Context

Three things have to line up before someone can use this app as themselves: a
**User** (a login), a **Person** (their directory record), and the **Linked User**
association between them. Until now only the first two had a front door.

Anyone could sign up at `login.html` and get a `users/{uid}` document as a
`viewer`. Editors could add People in the Membership Directory. But the link
between them existed in exactly one place: a modal buried in the admin panel of
the profile page, where an admin picked a Person out of a list of the whole
church and clicked. Nobody was prompted to do it, nothing queued it, and there
was no matching of any kind — an account whose email was character-for-character
a Person's `contact.email` still had to be linked by hand.

So the lived experience of signing up was: you become a viewer, you see almost
nothing, you cannot edit your own details, you are not in the directory, and you
stay that way until an admin happens to notice a new row in a list they have no
reason to be looking at. Meanwhile an editor may already have typed you into the
directory separately, so the church now has two records of you and nothing that
notices.

The gap is not that linking is hard. It is that **the only person who knows the
link should exist has no way to say so.**

## Decision

A **Link Request** is a User's own request to become a Linked User. The person
raises it; an editor, elder or admin answers it.

### 1. Two kinds, because there are only two answers

Someone who signs up is in one of exactly two situations, and the request asks
which:

- a **Match Request** names an existing Person — "that one is me";
- a **New Record Request** carries proposed details — "I am not in your
  directory yet".

There is deliberately no third option and no free-text "other". A request that
cannot be resolved into "link this Person" or "create this Person" is a request
an approver cannot act on in one click, which is the whole point.

### 2. The document id is the uid

A Link Request lives at `link_requests/{uid}`. That is not shorthand — it is what
makes "one live request per account" true by construction instead of by a query
the security rules would have to trust. There is no way to file a second request
while one is open, because there is nowhere to put it.

### 3. Editors and elders resolve, not just admins

The question a request asks is "is this person who they say they are?" That is
answered by someone who knows the congregation. Restricting it to admins would
reintroduce exactly the bottleneck this ADR exists to remove, and an elder who
cannot confirm that a name belongs to a face they see every Sunday is a strange
elder. So the approver set is `editor, elder, admin, super_admin` — the same set
as the directory's Edit Mode and the Firestore `isEditor()` helper.

### 4. Approval is a callable, and no browser ever updates a request

Approving writes `users/{uid}.personId`, and the `users` collection is admin-only
in the Firestore rules for a good reason: a rule loose enough to let an editor
link an account is a rule loose enough to let them change permission levels. So
the `link_requests` rules grant **create**, **read** and **delete** — and no
update at all. Resolution happens in the `resolveLinkRequest` callable, which
runs with admin privileges and bypasses the rules.

Approval is one atomic batch: create-or-claim the Person, write both sides of the
link, close the request. Anything less leaves a Person pointing at an account
that does not point back — the exact ghost `tearDownLogin` already exists to
clean up.

### 5. The plan is computed from fresh reads, never from the request as filed

A request can sit in the queue for days. In that time an admin may have linked
the account by hand, the Person may have been merged away, or another account may
have claimed it. So `planApproval` is given the world as it is at approval time
and refuses rather than guesses:

- the account is already linked → refuse, and say so;
- the named Person no longer exists → refuse;
- the named Person belongs to another account → refuse, never steal it;
- the request is already resolved → refuse.

### 6. An approver can redirect a New Record Request onto an existing Person

The obvious failure of a self-service "add me" is that it manufactures the
duplicate record the church was going to have to merge later. So an approver
reading "please add me as Jane Doe" who recognises Jane as someone already on
file approves **onto that record** instead. One click, no merge, no duplicate.
This is why approval accepts an override `personId` rather than trusting the kind
of the request.

### 7. A Person created this way is a Visitor

Someone who says "I am not in your directory" is, as far as the church's records
go, exactly that. The new Person starts at the first Membership Stage — `visitor`
— with that stage's projected Membership Tag, and an editor moves them along the
Track from there. Nobody self-declares into membership; the proposal carries no
tags, no stage and nothing shepherding, and the fields a person may propose about
themselves are exactly the fields a Linked User may later edit about themselves.

## Consequences

- Signing up now leads somewhere. A viewer with no Person sees the request panel
  on their profile page rather than an empty screen.
- The admin link modal stays. It is still the right tool for re-pointing an
  existing link, which is an admin act and not a self-service one.
- The pure decision logic is split across two files that cannot import each
  other, because Cloud Functions deploy only the `functions/` directory:
  `public/link-request-core.js` decides what may be asked, and
  `functions/link-request.js` decides what approval does. Their shared vocabulary
  is duplicated on purpose and pinned to each other by `test/link-request.test.js`
  — the same arrangement `functions/member-sync.js` already uses.
- **Resolved by [ADR 0026](0026-the-account-sync-moves-the-stage-not-the-tag.md):**
  the add-only member sync used to put the `Member` tag on a newly created
  Visitor if the requesting account already sat at `member` or above, because it
  predated the Membership Track and treated the tag as a fact rather than a
  projection of the stage. It now moves the stage instead.
- **Not decided here:** whether the mobile app gets a native request screen.
  `profile.html` is shell-adapted and opens inside the phone app, so the flow is
  reachable there today; a purpose-built screen is a later question.
