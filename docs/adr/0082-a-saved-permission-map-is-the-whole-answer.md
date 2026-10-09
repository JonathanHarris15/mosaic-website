# ADR 0082 — A saved permission map is the whole answer

**Status:** Accepted
**Date:** 2026-10-09
**Ticket:** MS-725 (follows MS-722)
**Keeps:** [ADR 0077](0077-account-levels-are-presets-over-a-permission-catalog.md), [ADR 0081](0081-a-page-you-can-change-is-live.md)

## Context

MS-695 gave an account a permission map, and Admin → Accounts the screen to
set it. MS-722 then taught nineteen write doors in `firestore.rules` to honour
the one key each door's page is about:

```
function editsWith(key) {
  return isEditor() || hasPermission(key);
}
```

The `isEditor()` OR was deliberate. It meant nobody lost a door they already
had, which is the right way to land a rules change. It also meant the grant
only worked in one direction. `isEditor()` reads the **stored**
`permissionLevel` string, so an account whose string is `editor` held all
nineteen doors whatever the map said, and unticking a key in Admin → Accounts
did nothing at all. A permission that cannot be taken away is not a
permission; it is a label.

The same screen is where the drift started. Assigning a level writes
`userWriteFromLevel()`'s map onto `users/{uid}`, so from that moment the
account has a statement of what it may do that an admin wrote on purpose.
Carrying the level string alongside it as a second, louder answer means two
records of the same decision, and the louder one is the one nobody edits.

## Decision

**Once a permission map has been saved on an account, the key is the whole
answer. An account with no saved map keeps the level names.**

```
function editsWith(key) {
  return hasPermission(key) || (!usesPermissionMap() && isEditor());
}
```

`usesPermissionMap()` — a `permissions` map present on `users/{uid}` — is the
marker, and it is the marker because it is exactly what Admin → Accounts
writes. An account that has never been through that screen has nothing saved
to read, so it falls back to the ladder it has always been on. This is the
shape `readsAsEditor()`, `writesTheRecord()` and `countsAsElder()` already
use; the write doors now match them.

**A UI gate mirrors the rule, clause for clause.** `AccessCore.writesWith(account,
key)` is that mirror, and `canFixSundayService` / `canEditEvents` are named
cases of it. A page may not offer a control the rules will refuse, and may not
hide one they would allow.

**Mirroring means reading what the rules read.** The rules see the stored
document. They cannot run `normalizeAccount()`, cannot recompute a builtin
rung's preset the way `effectivePermissions()` does, and cannot overlay the
Pastoral Assistant grant. `auth.js` and the phone's profile loader rewrite both
fields the rules read — `permissions` becomes the effective map,
`permissionLevel` becomes the canonical rung — so they now carry the stored
pair forward as `savedPermissions` and `storedLevel`, and
`AccountLevelsCore.savedPermissionMap()` / `storedPermissionLevel()` read
those. A raw `users/{uid}` document has neither field and falls through to its
own, which is why a callable asking the same gate gets the same answer.

**Whoever may write a Sunday may read who else is in it.** `presence` is the
one read in `firestore.rules` that names a write surface's key. A level built
from Member plus `services.builder.edit` holds neither
`directory.edit_identity` nor `printables.edit`, so `readsAsEditor()` refused
it: it could publish a claim and never see one, which is ADR 0035's lock
failing open for exactly the person it binds. Nothing else widens. The clause
is on that collection and no other, and `shepherding_presence` stays
elders-only.

## Consequences

- Revoking a key in Admin → Accounts now takes the door away, on the account
  and on the screen, for any account that has been saved through that screen.
- An account's access is readable in one place. The level string on a saved
  account is a label for the rung, not a second grant.
- **A preset that is missing a key a rung needs becomes visible as lost
  access.** The Editor preset used to leave `calendar.events.edit` off
  `EDITOR_SURFACE_KEYS`, so an account saved onto that level had a map that
  never had it, and under this decision it lost the nine calendar doors the
  level string used to carry. Helm chose option A (2026-10-09): the key is
  now on the Editor (and Admin) preset, and saved Editor maps that still
  equal that old preset are backfilled. Changing the preset alone is not
  enough — the rules read the map that was saved — which is why the
  backfill exists (`scripts/backfill-editor-calendar-key.js`).
- A rules change that narrows access is audited against the real congregation
  before it ships — every account's write access per collection, before and
  after, and whether a real person uses what they would lose.
