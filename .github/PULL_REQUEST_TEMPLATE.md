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

## No legacy

When this PR replaces a system (a new data shape, or a new code path for the same job), the replacement is finished in this change. See `.cursor/rules/no-legacy.mdc`. Tick N/A only when it does not replace one.

- [ ] N/A — this PR does not replace a system
- [ ] Old code paths are deleted in this change
- [ ] Prod data moves through an allowlisted **Prod ops script** (`workflow_dispatch`): dry run (`commit=false`) first, then `commit=true` on `main`
- [ ] Read and write fallbacks to the old shape are removed
- [ ] One data shape remains — no dual-shape records

## Preview URL

Firebase Hosting preview channel for `mosaic-hymn-database`, or `n/a` if this PR does not change a user-visible surface.

-

## Ready for Maintain

Tick this only when Jira, AC, test evidence, Smoke test, risk, and No legacy are filled. Maintain is the Cursor review pass before merge — an empty template is not ready.

- [ ] Ready for Maintain
