---
name: plan-ticket
description: Write a PRD onto a Mosaic Jira ticket in To Plan, create subtasks, and move it right of To Plan only when thinking is finished. Use when asked to /plan-ticket, plan a ticket, plan ALL of To Plan, or empty the To Plan column.
---

> **Operator.** This skill is run by Cursor Cloud Agents. Grok Bot is the project owner: it answers routine questions for Jonathan and escalates only crucial decisions.

# Plan a ticket

Read first, in this order:

1. `CLAUDE.md` (Mosaic board — **wins** where this skill and `BOARD.md` disagree)
2. `.cursor/skills/plan-ticket/BOARD.md`
3. `.cursor/skills/_shared/operator.md`
4. `.cursor/skills/_shared/atlassian-mcp.md`
5. `.cursor/skills/_shared/prd-shape.md`
6. `CONTEXT.md` for domain words
7. Relevant `docs/adr/` — do not re-litigate them

Jira is Atlassian MCP only. No `ToolSearch`. No `~/.claude`.

## Arguments

- `/plan-ticket <KEY>` — one ticket (`MS-123`)
- `/plan-ticket ALL` — every level-0 ticket in **To Plan** (not Epics, not Subtasks)

## Integrity door

**Do not land a ticket right of To Plan without a PRD on it.** If a crucial decision is still open, leave the ticket in To Plan (or To Do only after the PRD names the decision on a subtask). Mosaic never parks a decision in On Deck.

## Phases

### 1. Fetch

`getJiraIssue` with `responseContentFormat: "markdown"`. Confirm it is level-0 (`Feature`, `Task`, or `Bug`), not an Epic or Subtask. Read comments. Search siblings with `searchJiraIssuesUsingJql` if the ticket names them.

### 2. Read the product, do not invent it

Read `CONTEXT.md` and the ADRs the ticket touches. Read the code paths it names. If the ticket is thin, that is allowed — file the holes as named decisions, do not fill them with new product behavior.

### 3. Grill only what is unset

If a design question is still open, run `grill-with-docs` (or point Grok Bot at it). Escalate to Jonathan only when the answer would invent behavior or override a lock.

### 4. Write the PRD

`editJiraIssue` the description using the shape in `_shared/prd-shape.md`. Keep existing locks. Use Mosaic words (Elder, Pastoral Assistant, Shepherding Note, …).

### 5. Split subtasks

Each subtask is one commit on the parent branch. Create with `createJiraIssue` (`issueTypeName: "Subtask"`, `parent: <KEY>`). Subtasks are **not** board cards. Order them in **Build order** on the parent.

### 6. Place the ticket

Phase 6 decides **Night Work** / **On Deck** / **To Do** as *queue language*, then move Jira:

| Decision | Jira status | Comment |
| --- | --- | --- |
| Thinking unfinished / crucial decision open | stay **To Plan** | name the decision |
| Specced; not next | **To Do** | `DoR complete → To Do` |
| Next 1–2 after the thing In Progress | **To Do** + comment **On Deck** | Mosaic: front of the queue, not a parking space |
| Can run unattended tonight | **To Do** + comment **Night Work** | Cloud Agent may `/implement` without a new Jonathan question |

Then `transitionJiraIssue` only to a real status (`To Do`, never a made-up On Deck status).

### 7. Report

Comment the parent: PRD written, subtask keys, Phase 6 placement, any escalation. Optional notes under `.board/conversations/` (gitignored). Do not start `/implement` from this skill unless the user asked for both.

## ALL

List `project = MS AND status = "To Plan" AND type in (Feature, Task, Bug) ORDER BY rank`. Plan each. Stop if a crucial decision blocks the column; do not sweep.
