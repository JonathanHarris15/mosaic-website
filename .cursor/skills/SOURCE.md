# Provenance

Upstream: `https://github.com/JonathanHarris15/claude-config` `skills/` tree.

**Clone succeeded** (repo is public). This directory is that tree, overlaid into `.cursor/skills/`, with only these Mosaic / Cursor Cloud adaptations:

- [plan-ticket/JIRA.md](plan-ticket/JIRA.md) and [plan-ticket/SKILL.md](plan-ticket/SKILL.md) load Jira via **Atlassian MCP** on Cursor Cloud Agents, not Claude `ToolSearch` or `~/.claude`.
- [plan-ticket/SKILL.md](plan-ticket/SKILL.md) and [create-epic/SKILL.md](create-epic/SKILL.md) carry the operator note: Cursor Agents run them; Grok Bot answers routine questions for Jonathan and escalates only crucial decisions.
- `implement`, `to-prd`, and `to-issues` point at that same JIRA.md / Atlassian MCP connector.

Mosaic `CLAUDE.md` still wins where it disagrees with [plan-ticket/BOARD.md](plan-ticket/BOARD.md) (`On Deck` is the front of the queue here, not a parking space). Grok Bot’s skill library stays out of scope.

## Vendored skills (not from claude-config)

| Skill | Upstream | License | Pin |
| --- | --- | --- | --- |
| [frontend-design](frontend-design/SOURCE.md) | [anthropics/skills](https://github.com/anthropics/skills/tree/main/skills/frontend-design) | Apache-2.0 | `33375500bcea98d610eb30ce10ac4e59b89c390d` |
| [web-interface-guidelines](web-interface-guidelines/SOURCE.md) | [vercel-labs/web-interface-guidelines](https://github.com/vercel-labs/web-interface-guidelines) | MIT | `e3d624baaf29dc1fc645aff3e38f03e564d2d6b1` |

Always-applied rule (repo-local): [ui-prototype-first](../rules/ui-prototype-first.mdc).
