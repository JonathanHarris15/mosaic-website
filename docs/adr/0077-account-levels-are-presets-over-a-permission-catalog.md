# ADR 0077 — Account levels are presets over a permission catalog

**Status:** Accepted
**Date:** 2026-10-02
**Follows:** [ADR 0076](0076-a-pastoral-assistant-is-a-permission-level.md), [ADR 0041](0041-a-kiosk-account-reads-like-any-signed-in-account.md), [ADR 0013](0013-elder-tag-projection-and-derived-relationships.md)
**Ticket:** MS-695

## Context

Today each User carries a single `permissionLevel` string (`viewer` → `super_admin`, plus `pastoral_assistant` and `kiosk`). Access is answered by a shared **AccessCore** (`public/access-core.js`, copied to `functions/shared/`) with composite helpers (`readsAsElder`, `writesAsEditor`, `canDecide`, `isAnElder`, event visibility rungs, and so on). Firestore and Storage **restate** those helpers; Cloud Functions callables and the MCP apply parallel gates (`functions/access-assert.js`, `functions/mcp-actor.js`). MS-694 shipped the Admin Dashboard **Accounts** tab (Variant B): provision users and assign a level from a fixed dropdown.

The product wants **granular permissions**: each capability is isolated; today's levels become **presets** (starting templates). Churches may define **custom account levels** and assign people to them. Admin surfaces stay **dense professional desktop** UI on the church site (`main`); ghost is out of scope for the ship path.

**Pastoral Assistant** remains product-locked: elder-equivalent software access **except** they do **not** carry the [[Elder Tag]], are **not** counted as an elder (pickers, digest, Relations Viewer elder nodes), and **cannot be assigned** as someone's shepherding elder. They may still **set** Elder Assignment on others when `canDecide` applies (MS-594).

Jonathan (via Helm) requires a **Discord-inspired prototype** of the permissions admin UI on the Accounts / account-management page **before** any AccessCore, rules, or MCP behavior ships.

## Decision

1. **Permission catalog** — A versioned, church-wide list of stable string keys (e.g. `shep.decide.tags.edit`), each with metadata (domain, label, description, view/edit pair where relevant). AccessCore maps keys to the answers pages and rules already ask today.

2. **Account levels** — Documents in `account_levels/{id}` (name, description, color, `presetKey` if seeded from a built-in, `permissions` map key → boolean, `lockedKeys` for product-locked presets). Built-in presets: **Super admin**, **Elder**, **Pastoral Assistant**, **Editor**, **Member** (plus **Viewer**, **Admin**, **Kiosk** as system presets — not deletable; custom levels are clones with edits).

3. **User assignment** — `users/{uid}` holds `accountLevelId` (required once migrated). During transition, `permissionLevel` remains writable and is **derived** from the assigned level's effective matrix until cutover; `pastoralAssistant` boolean is retired when PA is only a preset.

4. **Enforcement** — One module evaluates `hasPermission(account, key)` from the user's resolved level. Helpers become thin wrappers over key sets for backward compatibility during migration. Rules restate a generated or hand-maintained mirror; tests pin AccessCore ↔ rules parity (existing pattern).

5. **Projections** — [[Elder Tag]] and `people.accountRank` read **counted-as-elder** and **visibility rung** permissions from the resolved level, not raw `permissionLevel` strings. PA preset keeps `shep.count_as_elder` off.

6. **Ship order** — (a) Approve prototype variant on Accounts tab; (b) ADR accepted; (c) schema + migration + AccessCore; (d) rules/MCP/callables; (e) admin UI wired to real data. No step (c–e) merges before (a).

## Consequences

- Large blast radius: every `pageFlags`, rules helper, MCP `SHEP_CAL_GATES` entry, and `dashboard-nav` gate must eventually consult the catalog or derived helpers.
- Custom levels can accidentally grant admin SMS/push powers; preset **Admin** and **Super admin** separate operational from pastoral keys in the UI.
- Migration must map every existing `permissionLevel` (+ legacy `pastoralAssistant` flag) to a preset level id without narrowing access.
- MS-127 `role` field removal stays blocked until migration completes.

## Alternatives considered

- **Keep boolean grant for PA** — Rejected; ADR 0076 made PA a level; presets subsume it.
- **Field-level Firestore rules per permission** — Rejected; rules stay composite helpers, not hundreds of `hasPermission` calls per collection.
- **Implement before prototype** — Rejected by product (Discord-like UX must be approved first).
