# Cursor Cloud skills (Mosaic)

Upstream `skills/` from [JonathanHarris15/claude-config](https://github.com/JonathanHarris15/claude-config), overlaid at `.cursor/skills/<skill-name>/`. See [SOURCE.md](SOURCE.md).

Jira calls use **Atlassian MCP** on Cursor Cloud Agents. Mosaic board override: `CLAUDE.md` wins over [plan-ticket/BOARD.md](plan-ticket/BOARD.md).

## Skills ported

| Skill | Role |
| --- | --- |
| `plan-ticket` | Front door: To Plan → PRD + sub-tasks → To Do / On Deck |
| `create-epic` | Epic (never a board card) + sibling level-0 tickets |
| `to-prd` | Write the PRD onto the ticket description |
| `to-issues` | Slice a specced ticket into AFK/HITL sub-tasks |
| `implement` | Build a ticket that has a PRD; drive the board |
| `grill-with-docs` | Grill against CONTEXT.md, ADRs, and the code |
| `grilling` | Interview in rounds |
| `prototype` | Light specimen (logic / UI) |
| `research` | Factual unknowns |
| `diagnose` | Reproduce a bug first |
| `review` | Code / spec / domain review |
| `retro` | Look back |
| `tdd` | Red-green-refactor |
| `domain-modeling` | CONTEXT.md and ADRs |
| `codebase-design` | Module / seam vocabulary |
| `improve-codebase-architecture` | Architecture pass |
| `design-sync` | Design system ↔ code |
| `design-pull` | Pull design into code |
| `design-push` | Push code into design |
| `design-prototype` | Design-system specimen |
| `wait-what` | Clarify a surprise |
| `wizard` | Guided script |
| `writing-for-agents` | Writing style |
| `sync-config` | Sync the claude-config git remote |

Grok Bot’s skill library is out of scope.
