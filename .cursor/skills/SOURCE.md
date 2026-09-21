# Provenance

Upstream: `https://github.com/JonathanHarris15/claude-config` `skills/` tree.

**Clone succeeded** (repo is public). This directory is that tree, overlaid into `.cursor/skills/`, with only these Mosaic / Cursor Cloud adaptations:

- [plan-ticket/JIRA.md](plan-ticket/JIRA.md) and [plan-ticket/SKILL.md](plan-ticket/SKILL.md) load Jira via **Atlassian MCP** on Cursor Cloud Agents, not Claude `ToolSearch` or `~/.claude`.
- [plan-ticket/SKILL.md](plan-ticket/SKILL.md) and [create-epic/SKILL.md](create-epic/SKILL.md) carry the operator note: Cursor Agents run them; Grok Bot answers routine questions for Jonathan and escalates only crucial decisions.
- `implement`, `to-prd`, and `to-issues` point at that same JIRA.md / Atlassian MCP connector.

Mosaic `CLAUDE.md` still wins where it disagrees with [plan-ticket/BOARD.md](plan-ticket/BOARD.md) (`On Deck` is the front of the queue here, not a parking space). Grok Bot’s skill library stays out of scope.
