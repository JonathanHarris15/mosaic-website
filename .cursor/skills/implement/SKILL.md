---
name: implement
description: Build a Mosaic Services Jira ticket that already has a PRD. Use when asked to /implement, build, or ship an MS-* Feature, Task, or Bug.
---

# Implement a ticket

Read `CLAUDE.md`, `AGENTS.md`, `.cursor/skills/_shared/atlassian-mcp.md`, and the ticket PRD first.

## Integrity door

**Do not build a ticket that has no PRD.** If the description has no `> **PRD.**` lead and no Problem / Solution / Acceptance criteria, stop and say to run `/plan-ticket <KEY>`.

## Do

1. `getJiraIssue` the parent. Confirm level-0. Read subtasks as the commit list.
2. Transition the parent to **In Progress** when Build starts. One parent In Progress at a time unless Helm said otherwise.
3. Branch from current `main` (fetch first if this environment may be stale). Name the branch after the ticket (`MS-123` or the Cloud Agent `cursor/…` name if this run already has one).
4. Implement only what the PRD accepts. Do not invent product behavior. Do not edit `firestore.rules` or `storage.rules` unless the ticket is about those rules. Do not deploy. Do not commit secrets. Do not set App Check to enforce.
5. Domain words from `CONTEXT.md`. Existing ADRs stand.
6. One commit per subtask, in Build order, on one parent PR.
7. Verify with the real scripts: `npm test` and `npm run lint --prefix functions`. Quote what you ran and what failed. After editing an authored `public/` shared module, run `node scripts/sync-shared-to-functions.js`.
8. Fill `.github/PULL_REQUEST_TEMPLATE.md`: Jira key, AC, test evidence, risk, preview URL (`n/a` if infra-only). Tick Ready for Maintain only when those are filled.
9. Comment the ticket with the PR URL. Transition to **In Review**. **Do not mark Done.** Maintain CLEARs; merge is a human/ship-rule step.

## Do not

- Sweep the board.
- Mix a second Feature into the PR.
- Weaken eslint or mass-reformat to keep lint green.
- Start from To Plan.
