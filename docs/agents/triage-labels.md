# Triage labels (Mosaic)

The `/triage` skill uses **category** and **state** roles. Canonical role names are below. On Jira, map them to **labels** (create if missing) unless the project uses a dedicated field.

## Canonical roles (`/triage`)

**Category (one):**

- `bug`
- `enhancement`

**State (one):**

- `needs-triage`
- `needs-info`
- `ready-for-agent`
- `ready-for-human`
- `wontfix`

## Mosaic board vs triage

Mosaic's **primary** workflow is the Jira **board** (`plan-ticket`, `implement`), not GitHub-style triage queues. Use `/triage` for **incoming** items (new bugs, vague requests, support echoes) before they enter `To Plan`.

Rough mapping when both apply:

| Triage state | Board hint |
| --- | --- |
| `needs-triage` | New or unprocessed — often still `To Plan` |
| `needs-info` | Stay in `To Plan` / `On Hold` until answered |
| `ready-for-agent` | Spec'd — target `To Do` after PRD + sub-tasks |
| `ready-for-human` | `On Deck` or HITL sub-task |
| `wontfix` | Close or `On Hold` with comment |

## Mosaic-specific labels (in addition)

These are used across the project (not all are triage roles):

| Label | Meaning |
| --- | --- |
| `needs-jonathan` | Human decision required — see `## Open decisions` |
| `P0`, `P1`, `P2` | Priority (when used) |
| `afk` / `hitl` | Sub-task reachability (`to-issues`) |
| `trivial` | Fast-path ticket (`plan-ticket`) |

When applying triage labels on Jira, **read existing labels** and re-set the full array (Jira replaces labels atomically).

## Agent-ready briefs

For `ready-for-agent`, post an agent brief per [triage/AGENT-BRIEF.md](../../.cursor/skills/triage/AGENT-BRIEF.md). On Mosaic, the **PRD on the ticket** is usually the brief after `to-prd`; triage briefs are for work entering before `plan-ticket`.
