# ADR 0084 — The account level is the only door

**Status:** Accepted
**Date:** 2026-10-22
**Ticket:** MS-776
**Supersedes:** the second sentence of [ADR 0082](0082-a-saved-permission-map-is-the-whole-answer.md) ("an account with no saved map keeps the level names")

## Context

ADR 0082 made a saved permissions map the whole answer, and left
`permissionLevel`, `role`, and `pastoralAssistant` as the answer when no map
was saved. That second path is the ladder. Two answers for the same fact
means the old one is still in the product.

The backfill wrote a builtin `accountLevelId` and that preset's map onto
every ladder-only account. The diff after that write showed no blocking
loss. The two pastoral-assistant accounts already had
`level_pastoral_assistant` and the pastoral-assistant map; their stored
string was `member`.

## Decision

Access checks read the account and nothing else.

1. A saved `permissions` object is the whole answer. `system.super_admin: true` is every catalog key. A `permissions` field that is present but not a map is a saved map of no keys. It does not fall through to `accountLevelId`.
2. Otherwise a builtin `accountLevelId` contributes that preset.
3. Otherwise no doors.

`role`, `permissionLevel`, and `pastoralAssistant` grant nothing. A rank-label string in memory (`'editor'`, `'level_editor'`) is that builtin preset, because it is the label `accessRank` already produced. It is not a read of the stored field.

New writes (sign-up, create user, assign level, member promote) emit `accountLevelId` and `permissions` only. They do not delete the old fields on existing documents. There is no second migration.

Week-shift tools open when `services.week_shift` is on, or when the account can edit the Sunday table and its builtin preset is editor, admin, elder, super admin, or pastoral assistant. A custom level does not get them from the rank label alone.

## Consequences

Firestore rules, Storage rules, the client, Cloud Functions, and MCP share this resolver. The rules restate the preset key lists because they cannot import the module. A drift test pins those lists to `buildPresetPermissions`.

`scripts/access-diff-core.js` keeps a frozen picture of the pre-cutover resolvers so a later diff can still see a ladder-only loss. That freeze is an audit, not a grant.
