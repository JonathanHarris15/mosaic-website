# Provenance

## Upstream pin

| Field | Value |
| --- | --- |
| Repository | https://github.com/mattpocock/skills |
| Commit | `4588b32ecab9ecc9fc8cc6b6c5e7d675b6004b0d` |
| Adopted | 2026-10-05 |

Skills are copied from `skills/engineering/` and `skills/productivity/` into `.cursor/skills/<name>/` (flat layout). Reference files and `agents/openai.yaml` ship with each skill where upstream provides them.

Mosaic overlays: [MOSAIC-CONVENTIONS.md](MOSAIC-CONVENTIONS.md), [docs/agents/](../../docs/agents/), patches in grilling-family + `implement` + `to-spec` + `setup-matt-pocock-skills/issue-tracker-jira.md`, rule [mosaic-skills.mdc](../rules/mosaic-skills.mdc).

## Skill delta (this adoption)

| Skill | Status | Notes |
| --- | --- | --- |
| `setup-matt-pocock-skills` | **refreshed** | + `issue-tracker-jira.md`; Mosaic fast-path when `docs/agents/` exists |
| `ask-matt` | **added** | verbatim |
| `grill-with-docs` | **refreshed** | + Mosaic CONTEXT + team-lead |
| `grilling` | **refreshed** | + team-lead mode |
| `grill-me` | **added** | + Mosaic pointer |
| `to-spec` | **refreshed** | Jira publish + team-lead seams + Open decisions |
| `to-tickets` | **added** | prefer `to-issues` on Mosaic |
| `triage` | **added** | Jira + board note |
| `implement` | **kept local** | Mosaic Jira board phases; merged upstream tone; never Done; merge on green CI |
| `implement-spec` | **added** | + Mosaic overlay |
| `tdd` | **refreshed** | upstream copy |
| `diagnosing-bugs` | **added** | replaces stale diagnose body |
| `diagnose` | **aliased** | → `diagnosing-bugs` |
| `codebase-design` | **refreshed** | upstream copy |
| `improve-codebase-architecture` | **refreshed** | upstream copy |
| `domain-modeling` | **refreshed** | upstream copy; glossary = `CONTEXT.md` via domain.md |
| `prototype` | **refreshed** | + ui-prototype-first gate |
| `research` | **refreshed** | upstream copy |
| `code-review` | **added** | replaces multi-agent `review` body |
| `review` | **aliased** | → `code-review` |
| `pr` | **added** | + Mosaic PR template / smoke test |
| `retro` | **refreshed** | upstream copy |
| `wayfinder` | **added** | Jira notes in issue-tracker.md |
| `wizard` | **refreshed** | upstream copy |
| `handoff`, `teach`, `to-questionnaire` | **added** | productivity pack |
| `wait-what` | **refreshed** | upstream copy |
| `writing-for-agents` | **refreshed** | upstream copy |
| `plan-ticket` | **kept local** | claude-config Jira spine; still references `to-issues` |
| `create-epic` | **kept local** | |
| `to-prd` | **kept local** | Jira PRD on ticket |
| `to-issues` | **kept local** | Mosaic sub-task slicer (maps to upstream `to-tickets` intent) |
| `jev-smoke-test` | **kept local** | |
| `frontend-design` | **kept local** | anthropics vendored — [frontend-design/SOURCE.md](frontend-design/SOURCE.md) |
| `web-interface-guidelines` | **kept local** | Vercel vendored — [web-interface-guidelines/SOURCE.md](web-interface-guidelines/SOURCE.md) |
| `design-*`, `sync-config` | **kept local** | Mosaic / legacy |
| `sync-config` | **kept** | points at JonathanHarris15/claude-config (not mattpocock) |

**Removed as primary:** stale claude-config forks for skills replaced by mattpocock copies (e.g. old `diagnose` tree, old `review` three-agent SKILL).

## Jira mapping (mattpocock → Mosaic)

| Upstream concept | Mosaic |
| --- | --- |
| `gh issue create` / GitHub Issues | Atlassian MCP: `createJiraIssue`, project `MS` |
| Issue `#123` | `MS-123` |
| `ready-for-agent` label | Spec complete → `To Do` after `to-prd` + `to-issues` |
| `GLOSSARY.md` | `CONTEXT.md` |
| `docs/agents/issue-tracker.md` | [docs/agents/issue-tracker.md](../../docs/agents/issue-tracker.md) |
| Close issue on ship | Transition to **`In Review` only** — Jonathan → `Done` |
| Wait for maintainer merge | **Mosaic Dev** merges on green CI |

Board columns, epic rules, and `On Deck` meaning: **`CLAUDE.md`** (wins over generic `BOARD.md`).

## Prior upstream

Before this adoption, many skills came from [JonathanHarris15/claude-config](https://github.com/JonathanHarris15/claude-config) `skills/` (Sep 2025 fork). That lineage is superseded for engineering/productivity packs except the Jira spine skills listed **kept local** above.
