# ADR 0086 — A whole tag or group can be marked "doesn't serve"

**Status:** Accepted
**Date:** 2026-11-19

## Context

A [[Non-server]] was one Person at a time (`people/{id}.doesNotServe`). A church
that never asks its under-twelves, or its youth group, had to mark every child
by hand and remember every new one.

## Decision

1. **An editor may mark a whole Shepherding Tag or Relationship Group as not
   serving** — the same editors who may mark one Person. Everybody carrying the
   tag, or leading or in the group, is never offered a Role, now and whenever
   they join later.
2. **Only from what the editor can see.** The Roles Manager offers the tags
   `RolesCore.visibleTags` gives this account and the groups an elder has
   shared with editors. Marking one never names something hidden from them.
3. **One home: `serving_settings/church`** — `doesNotServeTagIds` and
   `doesNotServeGroupIds`. Not on the tag or group: a group is an elder's
   record, and this is an editor's call. Readable by any signed-in account (it
   is ids only); writable by `isEditor()`, that one document, those fields.
4. **Read through `RolesCore.assignablePeople`**, on the same side of the elder
   bypass as a Person's own mark: it hides nobody and is not a privacy rule.
   Every page that offers people loads it once through `non-serving.js`.
5. **Fails open.** A setting that cannot be read, or a group this account
   cannot read (a member, on the Trades picker), takes nobody out.

## Consequences

- A member asking somebody to trade does not see group exclusions, because a
  member cannot read groups. Tag exclusions apply.
- The server's own take and trade checks do not read `doesNotServe` at all,
  for a Person or a tag — unchanged from before, and worth closing separately.
