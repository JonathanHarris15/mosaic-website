# Cursor Cloud skills (Mosaic)

Upstream: [mattpocock/skills](https://github.com/mattpocock/skills) @ pin in [SOURCE.md](SOURCE.md). Mosaic-specific overlays: [MOSAIC-CONVENTIONS.md](MOSAIC-CONVENTIONS.md), [docs/agents/](../../docs/agents/), Jira spine in `CLAUDE.md`.

**Setup:** `/setup-matt-pocock-skills` (already applied for Jira `MS` — see `docs/agents/*.md`).

## Target workflow

```
grill-with-docs → to-spec (or plan-ticket → to-prd) → to-tickets / to-issues → implement (+ tdd / diagnosing-bugs) → pr / code-review → jev smoke test (user-visible)
```

Prototype-first UI: [ui-prototype-first](../rules/ui-prototype-first.mdc). Agent workflow rule: [mosaic-skills](../rules/mosaic-skills.mdc).

## Engineering (mattpocock)

| Skill | Role |
| --- | --- |
| `setup-matt-pocock-skills` | Issue tracker + triage labels + domain doc layout (Jira preconfigured) |
| `ask-matt` | Escalation-style questions to Matt Pocock patterns |
| `grill-with-docs` | Grill + update CONTEXT/ADRs |
| `grilling` | Core grill rounds |
| `to-spec` | Conversation → spec on tracker |
| `to-tickets` | Tracer-bullet ticket graph on tracker |
| `triage` | Triage state machine + agent briefs |
| `implement` | Build one Jira ticket (Mosaic board discipline) |
| `implement-spec` | Multi-ticket integration branch |
| `tdd` | Red-green at seams |
| `diagnosing-bugs` | Reproduce-first bug loop (`diagnose` = alias) |
| `codebase-design` | Deep modules vocabulary |
| `improve-codebase-architecture` | Architecture pass |
| `domain-modeling` | CONTEXT.md + ADRs |
| `prototype` | Throwaway logic/UI specimen (UI superseded by prototype-first rule) |
| `research` | Factual unknowns |
| `code-review` | Standards + Spec review (`review` = alias) |
| `pr` | PR body shape |
| `retro` | Environment retrospective |
| `wayfinder` | Map + frontier of tickets |
| `wizard` | Guided human script |

## Productivity (mattpocock)

| Skill | Role |
| --- | --- |
| `grill-me` | Non-code grill entry |
| `handoff` | Session handoff |
| `teach` | Explain while building |
| `to-questionnaire` | Structured questions |
| `wait-what` | Clarify a surprise |
| `writing-for-agents` | Docs for agents |

## Mosaic Jira spine (kept / adapted)

| Skill | Role |
| --- | --- |
| `plan-ticket` | To Plan → PRD + sub-tasks → board |
| `create-epic` | Epic + sibling tickets |
| `to-prd` | PRD on ticket description |
| `to-issues` | Jira sub-tasks under a specced ticket (prefer over `to-tickets` here) |

## Mosaic-only (kept)

| Skill | Role |
| --- | --- |
| `jev-smoke-test` | Pre-PR UI smoke (fastbrowse + Jev) |
| `frontend-design` | Mosaic design-system brief |
| `web-interface-guidelines` | Vercel guidelines pass |
| `design-sync` / `design-pull` / `design-push` / `design-prototype` | Claude Design bridge |
| `sync-config` | Sync claude-config git remote (legacy) |

Grok Bot's skill library is out of scope.
