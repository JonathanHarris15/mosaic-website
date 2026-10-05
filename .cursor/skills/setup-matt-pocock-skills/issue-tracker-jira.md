# Issue tracker: Jira (Atlassian)

Issues and specs for this repo live in **Jira**. Use the **Atlassian MCP** connector on Cursor Cloud Agents for all operations.

## Conventions

- **Read an issue:** `getJiraIssue` with `cloudId`, issue id or key `MS-NNN`, fields as needed.
- **Search:** `searchJiraIssuesUsingJql` with `cloudId` and JQL (project = MS …).
- **Create:** `createJiraIssue` with `projectKey: "MS"`, `issueTypeName`, `summary`, `contentFormat: "markdown"` for description.
- **Edit:** `editJiraIssue` — read first; descriptions and labels are replace-all.
- **Comment:** `addCommentToJiraIssue` with `contentFormat: "markdown"`.
- **Transition:** `getTransitionsForJiraIssue` → `transitionJiraIssue` (never hardcode status names).
- **Links:** `createIssueLink` for `Blocks` dependencies.

Full Mosaic rules: [docs/agents/issue-tracker.md](../../../docs/agents/issue-tracker.md) and [.cursor/skills/plan-ticket/JIRA.md](../../plan-ticket/JIRA.md).

## Pull requests as a triage surface

**PRs as a request surface: no.**

## When a skill says "publish to the issue tracker"

Update or create a Jira issue per [docs/agents/issue-tracker.md](../../../docs/agents/issue-tracker.md).

## When a skill says "fetch the relevant ticket"

`getJiraIssue` for key `MS-*` (from argument, branch name, or PR title).

## Wayfinder

Use a Jira epic or parent issue as the map; children as linked issues or sub-tasks. See `/wayfinder` skill — interpret GitHub examples as Jira parent/link equivalents.
