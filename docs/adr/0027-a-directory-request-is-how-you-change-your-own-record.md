# ADR 0027 — A Directory Request is how you change your own record

**Status:** Accepted
**Date:** 2026-08-05
**Generalises:** [ADR 0025](0025-link-requests-are-self-raised-and-editor-resolved.md). Constrained by [ADR 0012](0012-membership-track-field-and-tag-projection.md) (Families) and [ADR 0014](0014-relationship-types-as-structures-and-relationship-groups.md) §4 (the Family write-through planners).

## Context

ADR 0025 gave a person with no directory record a way to ask for one. The shape
turned out to be more general than the problem it was built for.

The directory is **editor-authored on purpose**. That is right — a congregation's
records should not be whatever the last person to log in typed. But it leaves
the one person who knows a record is wrong unable to say so. Two cases came up
immediately:

- **Your name is misspelt.** You can see it on your own profile page. You cannot
  change it, and you should not be able to: a name is how the whole church refers
  to you, and it is read in the Service Builder, the Calendar, the rosters and
  every elder's notes. A member quietly renaming themselves would ripple further
  than they can see.
- **Your household is missing or wrong.** A Family is a first-class entity with
  real rules — one husband, one wife, a Person is a child in at most one Family.
  The member knows who their spouse and children are. An editor has to be told.

Both are the same shape as a Link Request: *the subject of a record proposes a
change, and someone who knows the congregation confirms it.* Building a second
and third queue for them would have been the same fact recorded three times.

## Decision

`link_requests` becomes **`directory_requests`**, and a request carries a
**kind**. There is one queue and one inbox.

| Kind | Asked by | Approval does |
|---|---|---|
| `link_match` | someone with no Person | links them to an existing Person |
| `link_new` | someone with no Person | creates a Person and links it |
| `name_fix` | a Linked User | renames their own Person |
| `family` | a Linked User | applies one Family relation |

### 1. The name is shown, read-only, with a way to ask

The self-editable set from ADR 0012 is unchanged: contact, birthday, and sex
while unset. The name is **not** added to it. It appears on the profile page as
text, with a "Spelt wrong?" link that files a `name_fix`. The rule stays "the
directory is editor-authored"; what changes is that disagreeing with it now has
somewhere to go.

### 2. A family request is one relation, and approval REPLAYS the planner

A member does not edit their Family. They propose a single relation —
`{op: add|remove, relation: spouse|parent|child, otherId}` — and approval runs it
through `planAddFamilyRelation` / `planRemoveFamilyRelation`, the same planners
the Membership Directory's write-through already uses, against families and
people **as they stand at approval time**.

This is the important part. Those planners already hold every household rule:
both spouses need a recorded sex, nobody takes two spouses, a Person is a child
in at most one Family, removing a parent detaches the child rather than the
parent. Re-deriving that on the approval path would have been a second
implementation of the marriage rules, drifting against the first. Replaying it
also means a request filed last week that has since become impossible — because
one of them got married in the meantime — is refused with the planner's own
words rather than applied over the top.

The consequence worth naming: a member can propose something that will never be
approvable, and only finds out when an editor tries. That is the right way round.
The alternative is the browser pre-judging with a stale copy of the households
and telling someone "no" that the church would have said "yes" to.

### 3. Request ids are namespaced, and the rules require it

Every document id begins `${uid}_`. The security rules enforce it, which keeps
one person's requests out of everyone else's namespace **without the rules
having to trust a field in the document**.

ADR 0025 used the bare uid as the id, which made "one live request per account"
true by construction. That is now relaxed, deliberately: a member may well want
to add a spouse and two children at once. Link and name-fix ids are still fully
determined by the kind, so a second ask of those overwrites the first; a family
id additionally carries the relation, so different relations coexist and the
*same* relation asked twice still overwrites rather than piling up.

### 4. Still no `allow update`, for a wider reason now

ADR 0025 kept approval on the server because it writes `users/{uid}.personId`
and `users` is admin-only. The reason has broadened: approval now also writes
`people/{id}.name` and the `families` collection **on behalf of someone who may
be a plain member**. The `directory_requests` rules therefore grant create, read
and delete only. No browser ever resolves a request.

### 5. The planners exist twice, and a matrix test keeps them honest

Cloud Functions deploy only the `functions/` directory, so the approval path
cannot import `public/family-core.js`. `functions/family-plan.js` is the planner
half of it, and `test/family-plan-server.test.js` runs **both** implementations
over the same matrix of households × people × relations — over a thousand
comparisons — asserting they agree write for write. Two copies of the marriage
rules quietly disagreeing about who is married to whom is exactly the failure
worth spending a test on.

## Consequences

- The editor inbox is now mixed, so each row carries a kind badge. "Confirm" and
  "Add & connect" stay; the "Already on file…" redirect applies only to link
  requests, because a name fix or a family change is already about a known
  Person.
- Approving a family change is the only approval that reads the whole `families`
  collection. At a congregation's scale that is nothing; at ten thousand
  households it would want narrowing.
- `link_requests` is migrated to `directory_requests` and the old kinds `match` /
  `new` are renamed `link_match` / `link_new`.
- **A name fix leaves no trace in the Pastoral Record.** A Membership Change logs
  one and a name change does not, because there is no activity kind for it. An
  elder looking at a Person will not see that their name was changed or by whom.
  That is a gap, not a decision — it wants a `name_change` activity kind.
- **Nobody is told they have been named.** If a member proposes someone as their
  spouse, that person finds out when the directory changes, if they notice. The
  approver is the only check. For a congregation where an editor knows both
  people that is probably right, but it is worth revisiting if the church grows
  past the point where the approver recognises every name.
