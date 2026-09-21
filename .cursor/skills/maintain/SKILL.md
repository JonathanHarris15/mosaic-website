---
name: maintain
description: Review a Mosaic pull request against its Jira PRD and say CLEAR, CLEAR-with-nits, or HOLD. Use when asked to Maintain, review a PR, Ready for Maintain, or CLEAR a ticket.
---

# Maintain

Maintain is the Cursor review pass before merge. It is not Build. Read the PR, the ticket PRD, `CLAUDE.md`, and `AGENTS.md`.

## Verdicts

| Verdict | Meaning |
| --- | --- |
| **CLEAR** | AC met; constraints held; merge under ship rules |
| **CLEAR-with-nits** | Same, plus non-blocking nits. Merge; nits can be later To Plan |
| **HOLD** | AC missed, constraint broken, or inventing product. Do not merge |

## Check

1. PR template is filled (Jira `MS-*`, AC, test evidence, risk, preview). An empty template is not ready.
2. Ticket has a PRD. Diff matches the AC — nothing extra that is a new Feature.
3. Constraints the PRD named actually held (rules, secrets, eslint, deploy, role locks).
4. Named commands were run: `npm test`, `npm run lint --prefix functions` for code PRs. Quote results; do not paste full logs.
5. No `firestore.rules` / `storage.rules` / secrets / live deploy unless the ticket is that work.
6. Parent stays **In Review** after merge unless the PRD says otherwise. **No auto-Done.**

## Write

Comment the ticket (and the PR if asked) with the verdict, what you verified, nits, and ship steps. Do not merge unless the user or ship rule explicitly says to.
