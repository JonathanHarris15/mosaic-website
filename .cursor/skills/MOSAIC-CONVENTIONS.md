# Mosaic agent conventions

Repo-specific rules that adapt [mattpocock/skills](https://github.com/mattpocock/skills) to Mosaic Services (`MS` on Jira). Upstream skills defer here when they conflict.

## Target workflow

```
grill-with-docs → to-spec (or to-prd via plan-ticket) → to-tickets / to-issues → implement (+ tdd / diagnosing-bugs) → pr / code-review → jev smoke test (user-visible only)
```

**UI work** is gated by [ui-prototype-first](../rules/ui-prototype-first.mdc): standalone HTML in `docs/design/prototypes/`, draft PR with htmlpreview link, stop for Jonathan's approval before landing in `public/`.

## Grilling and spec questions (team-lead mode)

In this repo, **product and design questions during grilling, `to-spec`, `to-prd`, and planning are answered by the agent acting as project team lead on Jonathan's behalf** — using `CONTEXT.md`, `docs/adr/`, the PRD on the Jira ticket, `docs/design/design-language.md`, and standing rules (`AGENTS.md`, `CLAUDE.md`).

- **Do not stop** for Jonathan to answer routine grill/spec questions. State your recommended answer, **adopt it**, and record **question + chosen answer + brief rationale** in the spec or ticket (e.g. `## Implementation Decisions` or a `## Decisions log` section) so it is reviewable.
- **Escalate only** rare, irreversible calls: billing/payments, public app-store or listing publish, destroying or migrating real production data, or genuine product-strategy forks. Put those in **`## Open decisions`** at the top of the PR and/or spec/ticket; do not guess.

When `grilling` would "wait for the user's answers", **Mosaic mode** means: run one round with recommendations, **apply the recommendations**, append to the decisions log, recompute the frontier, repeat until empty — then summarize for review in the artifact (ticket/PR), not in chat.

Facts (code, docs, Jira fields) are still looked up, never invented.

## Jira vs GitHub Issues

- **Tracker:** Jira project `MS`, site `methodllc.atlassian.net`, cloud ID in `CLAUDE.md`. Use **Atlassian MCP** (`GetDynamicTools` / `CallDynamicTool`, namespace `Atlassian`). See [plan-ticket/JIRA.md](plan-ticket/JIRA.md) and [docs/agents/issue-tracker.md](../../docs/agents/issue-tracker.md).
- **Board spine:** `To Plan` → `To Do` → `On Deck` → `In Progress` → `In Review` → `Done` (plus `On Hold`). **`CLAUDE.md` wins** over [plan-ticket/BOARD.md](plan-ticket/BOARD.md) for `On Deck`.
- **Levels:** Epic → level-0 ticket (`Feature` / `Task` / `Bug`) → sub-task. [to-issues](to-issues/SKILL.md) slices a specced ticket into Jira sub-tasks; [to-tickets](to-tickets/SKILL.md) is the upstream tracer-bullet graph (use for greenfield specs; prefer `to-issues` inside `plan-ticket`).
- **Agents never transition tickets to `Done`.** After ship, leave **`In Review`**; Jonathan moves to `Done`.
- **One branch per ticket**; sub-task work is commits on that branch (not separate branches per sub-task).

## PRs, merge, deploy

- **Merge:** Coordinating agent (**Mosaic Dev**) merges on **green CI** (`npm test`, `npm run lint --prefix functions`). Skills must **not** tell agents to wait for Jonathan to merge.
- **PR body:** Use `.github/PULL_REQUEST_TEMPLATE.md` and the [`pr`](pr/SKILL.md) skill. User-visible changes: **Smoke test** section per [jev-smoke-test](jev-smoke-test/SKILL.md).
- **Deploy:** Agents **never** `firebase deploy` from the VM. Church deploy is GitHub Actions `.github/workflows/firebase-deploy.yml` on `main`. Ghost sandbox: `ghost-main` only (`docs/ops/ghost-main.md`).

## Domain docs

- **Glossary:** `CONTEXT.md` (not `GLOSSARY.md`). ADRs: `docs/adr/`.
- **Desktop UI:** dense, professional-tool scale (`docs/design/design-language.md`).

## Skill name aliases

| Legacy / alias | Use |
| --- | --- |
| `diagnose` | `diagnosing-bugs` |
| `review` | `code-review` |
| `to-issues` | Mosaic Jira sub-task slicer (keep for `plan-ticket`) |
| `to-tickets` | Upstream tracer-bullet ticket graph |
