# ADR 0026 — The account sync moves the stage, not the tag

**Status:** Accepted
**Date:** 2026-08-05
**Amends:** [ADR 0012](0012-membership-track-field-and-tag-projection.md). Closes an issue raised by [ADR 0025](0025-link-requests-are-self-raised-and-editor-resolved.md).

## Context

Two Firestore triggers keep a login and its directory Person in step. Direction
A took a User at `member` or above and stapled the `"Member"` tag onto their
linked Person. Direction B takes a Person carrying that tag and promotes their
login from viewer to member. Both are add-only and neither ever demotes.

Direction A was written before the Membership Track existed. ADR 0012 then made
a Person's membership tags a **projection** of `membership.stage` — the stage is
the source of truth, the tags are its shadow, and the two are always written
together. Direction A never got the memo. It kept writing the shadow.

The result is a Person who is two things at once:

```
membership.stage = 'visitor'
tags             = ['Visitor', 'Member']
```

And it matters, because `personMatchesDirectoryTab` picks the Membership
Directory's Members tab off `tags.includes('Member')` and never looks at the
stage. So that Person appears on the **Members** tab while the Track slider on
their own card reads **Visitor**. The directory and the Track disagree about the
same human, and neither is obviously wrong to look at.

ADR 0025 made this easier to hit — an account already sitting at `member` or
above can now get itself linked to a brand-new Visitor Person through a Link
Request — but the bug is older than that, and fires whenever an admin links a
member-or-higher account through the existing modal.

## Decision

**Direction A moves the Membership Stage. The projection writes the tag.**

The trigger is renamed `syncRoleToMemberTag` → **`syncPermissionLevelToMembershipStage`**,
which is what it now does and what the domain calls it.

### 1. It advances to `member`, and re-projects

The write is the same one the stage slider makes: dotted paths so only
`membership.stage` and `membership.inactive` move (`joinedAt` and the back-compat
`status` field on that object survive), and `tags` **re-projected** from the new
stage rather than appended to. Re-projection is what removes the stale `Visitor`
that made the Person read as both.

### 2. Three refusals, each a decision a permission level does not get to make

- **Already a member.** Stage `member`, or `moving_membership` — which projects
  the Member tag as well. This is also the loop guard: once in sync the write is
  skipped, so the two triggers never ping-pong.
- **Previous Member.** They left. A login does not re-admit anyone. Note this
  stage sits **later** on the Track than `member`, so "is their stage index at
  least member's?" would silently drag a departed member back onto the rolls.
  Membership is therefore asked of the **projection** (`carriesMemberTag`), never
  of a stage's index.
- **Inactive.** Someone marked inactive stays inactive until an editor says
  otherwise. Reactivating a person as a side effect of a role change is not a
  decision a trigger gets to make.

A Person with **no stage at all** is placed at `member` — that is the case the
old tag-writing version was really serving.

### 3. It logs a Membership Change

An editor moving the slider writes a Membership Change to the Pastoral Record
(ADR 0012), and ADR 0005 requires the denormalized field and the history to move
in one batch. A stage moved by the account sync does the same, in the same batch,
with `authorUid: null`, `authorName: "Account sync"` and `source: "account_sync"`
— because no human did it, and a stage that moved with nothing in the record
credits the change to nobody.

### 4. Direction B still reads the tag, deliberately

Direction B asks "does this Person carry the Member tag?" and promotes their
login if so. That stays. After this change the tag is a faithful projection of
the stage, so it gives the same answer — and it *additionally* still catches
records the Track migration has not reached, which carry a hand-applied Member
tag and no stage at all. Switching it to read the stage would quietly stop
promoting those.

### 5. The Track exists twice on purpose

Cloud Functions deploy only the `functions/` directory, so a trigger that moves a
Person along the Track cannot import `public/shepherding-core.js`. Rather than
scatter fragments of the projection through the triggers that need it (the Link
Request approval already had one), the server copy is consolidated in
**`functions/membership-track.js`**, and `test/membership-track-server.test.js`
pins every table and both projection functions against the canonical ones across
every stage × Inactive combination. Two copies of a state machine is exactly the
thing that drifts silently and then disagrees about whether somebody is a member.

## Consequences

- ⚠ **The old function must be deleted on deploy.** `syncRoleToMemberTag` and
  `syncPermissionLevelToMembershipStage` both fire on `users/{uid}`. If the old
  one survives the rename it will keep stapling the Member tag on behind the new
  one's back, which is the exact bug this ADR removes. `firebase deploy` will
  offer to delete it; say yes.
- **Existing damage is not repaired by this change.** Any Person already carrying
  a stray `Member` tag from the old trigger keeps it until something re-projects
  their tags — which happens automatically the first time anyone moves their
  Track slider, and not before. A one-off sweep would find them:
  Persons where `tags` includes `Member` but `membership.stage` is neither
  `member` nor `moving_membership`.
- Advancing someone now appears in their Pastoral Record, where before it was
  invisible. That is the point, but it does mean elders will see entries
  attributed to "Account sync" that were previously silent.
- `shouldAddMemberTag` is gone from `functions/member-sync.js`, replaced by
  `shouldAdvanceToMember` / `memberAdvanceUpdate` / `buildMemberAdvanceRecord`.
