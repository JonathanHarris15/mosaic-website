# Issue tracker: Jira (Mosaic Services)

Work for this repo is tracked in **Jira**, not GitHub Issues. GitHub is for code, PRs, and CI only.

## Connection

- **Site:** `methodllc.atlassian.net`
- **Cloud ID:** `68876fc2-c674-4750-9610-e4c9bb834d8d` (also accepted as `cloudId` in Atlassian MCP)
- **Project key:** `MS` (Mosaic Services)
- **Tools:** Atlassian MCP on Cursor Cloud Agents — discover with `GetDynamicTools` / call with `CallDynamicTool`, namespace `Atlassian`. Do **not** use Claude `ToolSearch` or `~/.claude`.

Authoritative mechanics: [.cursor/skills/plan-ticket/JIRA.md](../../.cursor/skills/plan-ticket/JIRA.md).

## Issue types and hierarchy

| Level | Jira type | On board? |
| --- | --- | --- |
| Epic | `Epic` | No — groups level-0 tickets |
| Ticket | `Feature`, `Task`, `Bug` | Yes — level-0 cards only |
| Step | `Subtask` (often renamed "Task" in UI) | No — lives inside parent card |

Sub-tasks are created by **`to-issues`** (Mosaic) or **`to-tickets`** (upstream graph, blocking links). **`implement`** builds one level-0 ticket and its sub-tasks on **one branch**.

## Board columns (status names)

Discover real names with `getJiraProjectIssueTypesMetadata` and transitions with `getTransitionsForJiraIssue`. Intended spine (see `CLAUDE.md`):

`To Plan` → `To Do` → `On Deck` → `In Progress` → `In Review` → `Done` (and `On Hold`)

**Rules:**

- No ticket right of `To Plan` without a PRD (`## Problem Statement` + `## Acceptance Criteria` on the description).
- **`On Deck`** here is the **front of the queue** (next after current work), not a parking column — `CLAUDE.md` overrides generic `BOARD.md`.
- **Agents never move tickets to `Done`.** Stop at **`In Review`** after PR is ready/merged.

## Creating and editing

- **Create:** `createJiraIssue` with `contentFormat: "markdown"` for descriptions.
- **Edit:** Read before write — `editJiraIssue` replaces fields you send.
- **Dependencies:** `createIssueLink` type `Blocks` — inward = blocker, outward = blocked (see JIRA.md).
- **Search:** `searchJiraIssuesUsingJql`.

## When a skill says "publish to the issue tracker"

Write the spec/PRD onto a Jira issue (usually an `MS-*` key):

1. Fetch current description with `getJiraIssue`.
2. Merge or replace per skill (PRD on ticket for `to-prd`; spec template for `to-spec`).
3. Apply labels / transition per skill and [triage-labels.md](./triage-labels.md).

For **new** tracer-bullet tickets from `to-tickets`, create level-0 issues in dependency order and link blockers.

## When a skill says "fetch the relevant ticket"

`getJiraIssue` with fields: `summary, description, status, labels, parent, issuelinks, comment, assignee, subtasks`.

Parse `MS-123` from PR titles, commit messages, and branch names.

## Pull requests

**PRs as a triage surface: no.** External PR triage (`/triage` PR flow) is disabled. PRs are opened by agents implementing `MS-*` work; linkage is via Development panel + issue key in title.

## Wayfinder

`/wayfinder` on Mosaic uses Jira as the map (epic or parent issue as map, children as tickets). Prefer epic + linked issues or sub-tasks per [wayfinder SKILL](../../.cursor/skills/wayfinder/SKILL.md); adapt GitHub examples in upstream docs to Jira parent/links.

## Setup

This file was produced by adopting `setup-matt-pocock-skills` for Jira. Re-run that skill only to change tracker or restart config.
