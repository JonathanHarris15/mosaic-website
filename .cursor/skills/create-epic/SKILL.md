---
name: create-epic
description: Create a Jira Epic and child Feature, Task, or Bug tickets for Mosaic Services. Use when asked to /create-epic, open an epic, or break a large idea into a parent plus level-0 children.
---

> **Operator.** This skill is run by Cursor Cloud Agents. Grok Bot is the project owner: it answers routine questions for Jonathan and escalates only crucial decisions.

# Create an epic

Read `CLAUDE.md`, `.cursor/skills/plan-ticket/BOARD.md`, `.cursor/skills/_shared/operator.md`, and `.cursor/skills/_shared/atlassian-mcp.md` first. Jira is **Atlassian MCP** only.

An **Epic is never a board card.** It groups level-0 tickets. Children start in **To Plan** as thin ideas unless the user already has a PRD for a child — then that child still needs `/plan-ticket` before it leaves To Plan.

## Do

1. Confirm the idea is a *collection* of tickets, not one Feature. If one ticket will do, use `file-ticket` instead.
2. `createJiraIssue` with `projectKey: "MS"`, `issueTypeName: "Epic"`, markdown description: problem, why it is an epic, child list (intent only), out of scope. Do not invent product behavior.
3. Create each child as `Feature`, `Task`, or `Bug` with `parent` = the epic key. Children are thin To Plan cards (Context / Problem / Out of scope). No PRD yet unless the user supplied one.
4. `createIssueLink` (`Blocks`) only when a child truly cannot start before another. Do not decorate every pair.
5. Do not transition children right of To Plan.
6. Comment the epic with child keys. Point at `/plan-ticket <KEY>` for the first child that is ready to think through.

## Do not

- Put the Epic on the board.
- Plan every child in this skill (that is `/plan-ticket`).
- Copy Grok Bot’s skill library into this repo.
- Edit Firebase secrets, rules, or deploy config.
