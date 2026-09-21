# Cursor Cloud skills (Mosaic)

Project skills for Cursor Cloud Agents. Each folder is `.cursor/skills/<skill-name>/` with a `SKILL.md`.

These are the board-spine skills this repo already names (`CLAUDE.md`, live MS PRDs, Maintain comments). They are adapted for **Cursor Cloud Agents + Atlassian MCP**. Claude-only tooling (`ToolSearch`, `~/.claude`) is not used.

Grok Bot’s own skill library is out of scope.

## Skills ported

| Skill | When |
| --- | --- |
| `file-ticket` | File a thin idea in **To Plan** |
| `grill-with-docs` | Settle decisions against `CONTEXT.md`, ADRs, and the code before a PRD |
| `plan-ticket` | Write the PRD, split subtasks, move right of To Plan only when thinking is finished |
| `create-epic` | Open an Epic (never a board card) and child level-0 tickets |
| `prototype` | Light HTML specimen for a ticket — not product |
| `implement` | Build a ticket that already has a PRD |
| `maintain` | Review the PR: CLEAR / CLEAR-with-nits / HOLD |

Shared notes (not skills): `_shared/`.

## Mosaic board (authoritative)

Read `CLAUDE.md` before any Jira move. Where `_shared/BOARD.md` and `CLAUDE.md` disagree, **`CLAUDE.md` wins**.
