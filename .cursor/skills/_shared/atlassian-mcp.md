# Jira via Atlassian MCP (not Claude ToolSearch)

Mosaic Jira is `methodllc.atlassian.net`.

- **Cloud ID:** `68876fc2-c674-4750-9610-e4c9bb834d8d`
- **Project:** `MS` — Mosaic Services
- **Types:** Epic · Feature · Task · Bug · Subtask

Use the **Atlassian** MCP namespace. Do not use Claude `ToolSearch`, `~/.claude`, or a local Jira CLI.

| Job | Tool |
| --- | --- |
| Read a ticket | `getJiraIssue` (`cloudId`, `issueIdOrKey`, `responseContentFormat: "markdown"`) |
| Search | `searchJiraIssuesUsingJql` (`cloudId`, `jql`) |
| Write description / fields | `editJiraIssue` (`contentFormat: "markdown"`) |
| Create | `createJiraIssue` (`projectKey: "MS"`, `issueTypeName`, markdown description) |
| Comment | `addCommentToJiraIssue` |
| Move columns | `getTransitionsForJiraIssue` then `transitionJiraIssue` |
| Parent a Subtask | `createJiraIssue` with `parent` = the level-0 key |
| Link tickets | `getIssueLinkTypes` then `createIssueLink` |

Issue-type names are exact: `Epic`, `Feature`, `Task`, `Bug`, `Subtask`.

Current MS transitions (ids can move; always re-read): `To Plan`, `To Do`, `In Progress`, `In Review`, `Done`. There is **no** `On Deck` or `Night Work` status in the workflow today. Keep those words as **queue language** in comments and in `CLAUDE.md`; do not invent a status.
