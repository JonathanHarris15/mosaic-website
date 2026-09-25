## Jira

- Key: `MS-___` (required — Mosaic Services tickets are `MS-*`)
- Link: https://methodllc.atlassian.net/browse/MS-___

## Acceptance Criteria

Copy the ticket's AC here. Check only what this PR actually meets.

- [ ]

## Test Evidence

Name the commands you ran and what they proved. Prefer `npm test` and `npm run lint --prefix functions` for code PRs. Do not paste full logs.

-

## Smoke test

Required for user-visible / hosted UI changes (`.cursor/rules/smoke-test.mdc`, `.cursor/skills/jev-smoke-test/SKILL.md`). List fastbrowse task(s), status, observations, and cost — or exactly `jev smoke test skipped: key(s) absent`, or one line why N/A (pure tests/docs/infra, no UI effect).

-

## Risk

What this can break, who would feel it, and how you checked it did not. Infra-only PRs still name risk (CI, agent setup, review process).

-

## Preview URL

Firebase Hosting preview channel for `mosaic-hymn-database`, or `n/a` if this PR does not change a user-visible surface.

-

## Ready for Maintain

Tick this only when Jira, AC, test evidence, Smoke test, and risk are filled. Maintain is the Cursor review pass before merge — an empty template is not ready.

- [ ] Ready for Maintain
