---
name: file-ticket
description: File a thin Mosaic idea in Jira To Plan as a Feature, Task, or Bug. Use when capturing a new idea that is not ready to plan, or when asked to file a ticket.
---

# File a ticket

New idea, however rough → **To Plan**. Do not plan it here. Do not invent product behavior.

Read `CLAUDE.md` and `.cursor/skills/_shared/atlassian-mcp.md`.

## Type

| Type | Use |
| --- | --- |
| **Feature** | User-visible product work |
| **Task** | Ops, CI, agent, or non-feature work |
| **Bug** | Broken existing behavior |

Epics are `/create-epic`. Subtasks are created by `/plan-ticket` under a parent.

## Description (thin)

```markdown
## Context
Who asked, and how thin this is.

## Problem
What is wrong or missing, in their words.

## Out of scope
What this must not become.
```

Keep it short. Labels like `intake` or `needs-jonathan` only when true.

`createJiraIssue` (`projectKey: "MS"`). Default status is fine if it is To Plan or To Do — if it lands in To Do without a PRD, `transitionJiraIssue` back to **To Plan**. Comment the key.
